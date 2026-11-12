import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import { ActionRegistry } from '../actions/registry.js';
import { getAllowedApiHosts, getDynamicApiLimits, requestJson, requestText, validateApiUrl } from './secure-http.js';
import { parseOpenApiSpec } from './openapi.js';

const integrations = new Map();
const pendingConfirmations = new Map();
const confirmationOutcomes = new Map();
const CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const forbiddenHeaders = new Set([
  'connection', 'content-length', 'cookie', 'host', 'origin', 'proxy-authorization',
  'referer', 'set-cookie', 'transfer-encoding'
]);

export function isDynamicApiDiscoveryEnabled(env = process.env) {
  return env.DYNAMIC_API_DISCOVERY_ENABLED === 'true' &&
    env.NODE_ENV !== 'production' &&
    env.VERCEL_ENV !== 'production';
}

function assertUrlConfiguration(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
  }
  const isAllowedLocalHirePoolUrl = process.env.NODE_ENV === 'development' &&
    process.env.VERCEL_ENV !== 'production' &&
    process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE === 'true' &&
    url.protocol === 'http:' &&
    url.hostname === 'localhost' &&
    url.port === '8000' &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash;
  if (!isAllowedLocalHirePoolUrl &&
      (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash)) {
    throw new Error(`${name} must be an HTTPS URL without credentials, port, query, or fragment`);
  }
  return url;
}

export function registerDynamicApiIntegration(configuration) {
  const {
    id,
    assistantId,
    applicationId,
    openApiSpecUrl,
    apiBaseUrl,
    allowedOperationIds,
    responseFields,
    destructiveOperationIds = [],
    authorize,
    prepareAction,
    getAuthHeaders,
    getSpecAuthHeaders,
    permissions = {},
    roleOperationIds = {},
    allowLocalDevelopment = false,
    allowedHosts,
    enabled = false,
    authenticationRequired = true,
    limits: configuredLimits = {}
  } = configuration || {};

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id || '')) throw new Error('Dynamic API integration id is invalid');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(assistantId || '')) throw new Error('Dynamic API assistantId is invalid');
  if (typeof applicationId !== 'string' || !applicationId.trim() || applicationId.length > 100) {
    throw new Error('Dynamic API applicationId is required');
  }
  if (typeof authorize !== 'function') throw new Error('A server-side authorization callback is required');
  if (prepareAction !== undefined && typeof prepareAction !== 'function') {
    throw new Error('prepareAction must be a server-side function');
  }
  if (getAuthHeaders !== undefined && typeof getAuthHeaders !== 'function') {
    throw new Error('getAuthHeaders must be a function');
  }
  if (getSpecAuthHeaders !== undefined && typeof getSpecAuthHeaders !== 'function') {
    throw new Error('getSpecAuthHeaders must be a function');
  }
  if (typeof enabled !== 'boolean' || typeof authenticationRequired !== 'boolean') {
    throw new Error('Dynamic API enabled and authenticationRequired settings must be boolean');
  }
  if (typeof allowLocalDevelopment !== 'boolean') {
    throw new Error('allowLocalDevelopment must be boolean');
  }
  if (allowLocalDevelopment && (
    process.env.NODE_ENV !== 'development' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE !== 'true' ||
    enabled !== true
  )) {
    throw new Error('Local HTTP integrations require explicit local development enablement');
  }
  if (enabled && authenticationRequired && typeof getAuthHeaders !== 'function') {
    throw new Error('A server-side credential callback is required for authenticated integrations');
  }
  if (!Array.isArray(allowedOperationIds) || allowedOperationIds.length === 0 || allowedOperationIds.length > 50) {
    throw new Error('At least one and no more than 50 operation IDs must be allowlisted');
  }
  if (new Set(allowedOperationIds).size !== allowedOperationIds.length) {
    throw new Error('Allowed operation IDs must be unique');
  }
  for (const operationId of allowedOperationIds) {
    if (
      typeof operationId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(operationId)
    ) {
      throw new Error('An allowlisted operation ID is invalid');
    }
    const fields = responseFields?.[operationId];
    if (!Array.isArray(fields) || fields.length === 0 || fields.length > 60) {
      throw new Error(`A non-empty response field allowlist is required for '${operationId}'`);
    }
    if (fields.some(field =>
      typeof field !== 'string' ||
      field.length > 150 ||
      field.split('.').some(part =>
        !/^[a-zA-Z0-9_-]+$/.test(part) ||
        ['__proto__', 'prototype', 'constructor'].includes(part)
      )
    )) {
      throw new Error(`Response field allowlist for '${operationId}' contains an invalid path`);
    }
  }

  const specUrl = assertUrlConfiguration(openApiSpecUrl, 'openApiSpecUrl');
  const baseUrl = assertUrlConfiguration(apiBaseUrl, 'apiBaseUrl');
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0 || allowedHosts.length > 10) {
    throw new Error('An exact HTTPS host allowlist is required');
  }
  const normalizedHosts = allowedHosts.map(host => {
    if (typeof host !== 'string' || host !== host.trim() || host.includes('*')) {
      throw new Error('Dynamic API allowed hosts must be exact hostnames');
    }
    let normalized;
    try {
      normalized = new URL(`https://${host}`).hostname.toLowerCase();
    } catch {
      throw new Error('Dynamic API allowed host is invalid');
    }
    if (normalized !== host.toLowerCase() || normalized.includes(':') || net.isIP(normalized)) {
      throw new Error('Dynamic API allowed host is invalid');
    }
    return normalized;
  });
  if (!new Set(normalizedHosts).has(specUrl.hostname.toLowerCase()) ||
      !new Set(normalizedHosts).has(baseUrl.hostname.toLowerCase())) {
    throw new Error('The OpenAPI and API hosts must both be in the exact host allowlist');
  }
  if (!roleOperationIds || typeof roleOperationIds !== 'object' || Array.isArray(roleOperationIds)) {
    throw new Error('Role-specific operation allowlists must be an object');
  }
  const normalizedRoleOperationIds = {};
  for (const [role, operationIds] of Object.entries(roleOperationIds)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(role) ||
        ['superadmin', 'super_admin', 'super-admin'].includes(role.toLowerCase()) ||
        !Array.isArray(operationIds) || operationIds.length === 0) {
      throw new Error(`Role-specific operation allowlist for '${role}' is invalid`);
    }
    if (operationIds.some(operationId => !allowedOperationIds.includes(operationId))) {
      throw new Error(`Role '${role}' allows an operation outside the integration allowlist`);
    }
    normalizedRoleOperationIds[role] = Object.freeze([...new Set(operationIds)]);
  }
  if (!Array.isArray(destructiveOperationIds) ||
      destructiveOperationIds.some(operationId =>
        typeof operationId !== 'string' || !allowedOperationIds.includes(operationId)
      )) {
    throw new Error('Destructive operation IDs must be included in the integration allowlist');
  }
  const limits = {
    timeoutMs: 5000,
    maxSpecBytes: 1024 * 1024,
    maxResponseBytes: 64 * 1024,
    maxResultBytes: 16 * 1024,
    ...configuredLimits
  };
  if (
    !Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 100 || limits.timeoutMs > 15000 ||
    !Number.isInteger(limits.maxSpecBytes) || limits.maxSpecBytes < 1024 || limits.maxSpecBytes > 5 * 1024 * 1024 ||
    !Number.isInteger(limits.maxResponseBytes) || limits.maxResponseBytes < 1024 || limits.maxResponseBytes > 512 * 1024 ||
    !Number.isInteger(limits.maxResultBytes) || limits.maxResultBytes < 1024 || limits.maxResultBytes > 64 * 1024
  ) throw new Error('Dynamic API integration limits are invalid');
  if (integrations.has(id)) throw new Error(`Dynamic API integration '${id}' is already registered`);
  const integration = Object.freeze({
    id,
    assistantId,
    applicationId,
    openApiSpecUrl: specUrl.href,
    apiBaseUrl: baseUrl.href.endsWith('/') ? baseUrl.href : `${baseUrl.href}/`,
    allowedHosts: Object.freeze([...new Set(normalizedHosts)]),
    allowLocalDevelopment,
    enabled,
    authenticationRequired,
    limits: Object.freeze(limits),
    allowedOperationIds: Object.freeze([...allowedOperationIds]),
    roleOperationIds: Object.freeze(normalizedRoleOperationIds),
    destructiveOperationIds: Object.freeze([...new Set(destructiveOperationIds)]),
    responseFields: Object.freeze(Object.fromEntries(allowedOperationIds.map(operationId => [
      operationId,
      Object.freeze([...responseFields[operationId]])
    ]))),
    permissions: Object.freeze({ ...permissions }),
    authorize,
    prepareAction,
    getAuthHeaders,
    getSpecAuthHeaders
  });
  integrations.set(id, integration);
  return { id: integration.id, assistantId: integration.assistantId, applicationId: integration.applicationId };
}

export function unregisterDynamicApiIntegration(id) {
  return integrations.delete(id);
}

export function getDynamicApiIntegration(id) {
  return integrations.get(id) || null;
}

export function clearDynamicApiIntegrations() {
  integrations.clear();
}

export function getAssistantApplicationId(assistantId) {
  const applicationIds = new Set(
    Array.from(integrations.values())
      .filter(integration => integration.assistantId === assistantId)
      .map(integration => integration.applicationId)
  );
  if (applicationIds.size > 1) {
    throw new Error('Assistant is registered to more than one application');
  }
  return applicationIds.values().next().value || null;
}

function getUserRole(user) {
  return typeof user?.role === 'string' ? user.role : 'user';
}

function getRoleOperationIds(integration, user) {
  return integration.roleOperationIds[getUserRole(user)] || [];
}

function getIntegrationAllowedHosts(integration) {
  const globallyAllowed = getAllowedApiHosts();
  return new Set(integration.allowedHosts.filter(host => globallyAllowed.has(host)));
}

function getIntegrationUrlOptions(integration) {
  return integration.allowLocalDevelopment
    ? { allowLocalDevelopment: true, allowedPorts: [8000] }
    : {};
}

function isScalarSchema(schema) {
  const type = Array.isArray(schema?.type)
    ? schema.type.find(candidate => candidate !== 'null')
    : schema?.type;
  return ['string', 'number', 'integer', 'boolean'].includes(type);
}

function validateSchema(value, schema, path = 'parameters') {
  const type = Array.isArray(schema.type)
    ? schema.type.find(candidate => candidate !== 'null')
    : schema.type;
  if (value === null && schema.nullable) return null;
  function validateFreeformValue(entryValue, entryPath, depth = 0) {
    if (depth > 6) {
      return `${entryPath} exceeds maximum nesting depth`;
    }
    if (entryValue === null || typeof entryValue === 'boolean') {
      return null;
    }
    if (typeof entryValue === 'number') {
      return Number.isFinite(entryValue) ? null : `${entryPath} must be a finite number`;
    }
    if (typeof entryValue === 'string') {
      return entryValue.length <= 2048 ? null : `${entryPath} exceeds maximum length`;
    }
    if (Array.isArray(entryValue)) {
      if (entryValue.length > 100) {
        return `${entryPath} exceeds maximum array length`;
      }
      for (let idx = 0; idx < entryValue.length; idx += 1) {
        const err = validateFreeformValue(entryValue[idx], `${entryPath}[${idx}]`, depth + 1);
        if (err) return err;
      }
      return null;
    }
    if (typeof entryValue === 'object') {
      const keys = Object.keys(entryValue);
      if (keys.length > 50) {
        return `${entryPath} exceeds maximum key count`;
      }
      for (const k of keys) {
        if (k.length > 100 || ['__proto__', 'prototype', 'constructor'].includes(k)) {
          return `${entryPath}.${k} is not allowed`;
        }
        const err = validateFreeformValue(entryValue[k], `${entryPath}.${k}`, depth + 1);
        if (err) return err;
      }
      return null;
    }
    return `${entryPath} has unsupported value type`;
  }

  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object`;
    const allowed = new Set(Object.keys(schema.properties || {}));
    const keys = Object.keys(value);
    if (!schema.additionalProperties) {
      const extra = keys.find(key => !allowed.has(key));
      if (extra) return `${path}.${extra} is not allowed`;
    } else {
      if (keys.length > 50) return `${path} exceeds maximum key count`;
      for (const key of keys) {
        if (key.length > 100 || ['__proto__', 'prototype', 'constructor'].includes(key)) {
          return `${path}.${key} is not allowed`;
        }
        if (!allowed.has(key)) {
          const freeformError = validateFreeformValue(value[key], `${path}.${key}`, 1);
          if (freeformError) return freeformError;
        }
      }
    }
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) return `${path}.${key} is required`;
    }
    for (const [key, nestedSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) {
        const error = validateSchema(value[key], nestedSchema, `${path}.${key}`);
        if (error) return error;
      }
    }
    return null;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (value.length > (schema.maxItems ?? 50)) return `${path} has too many items`;
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} has too few items`;
    for (const [index, item] of value.entries()) {
      const error = validateSchema(item, schema.items, `${path}[${index}]`);
      if (error) return error;
    }
    return null;
  }

  if (
    (type === 'string' && typeof value !== 'string') ||
    (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) ||
    (type === 'integer' && !Number.isSafeInteger(value)) ||
    (type === 'boolean' && typeof value !== 'boolean')
  ) return `${path} has the wrong type`;

  if (typeof value === 'string') {
    if (value.length > 2048) return `${path} is too long`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} is too short`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is too long`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} has an invalid format`;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} is below the minimum`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} exceeds the maximum`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path} is not an allowed value`;
  return null;
}

function createParameterSchema(jsonSchema) {
  const validate = value => {
    const error = validateSchema(value, jsonSchema);
    return error
      ? { success: false, error: { format: () => ({ _errors: [error] }) } }
      : { success: true, data: value };
  };
  return {
    jsonSchema,
    safeParse: validate,
    parse(value) {
      const result = validate(value);
      if (!result.success) throw new Error(result.error.format()._errors[0]);
      return result.data;
    }
  };
}

function sanitizeDescription(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250);
}

function createActionName(integrationId, operationId) {
  const slug = `${integrationId}_${operationId}`
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 42);
  const digest = createHash('sha256').update(`${integrationId}\0${operationId}`).digest('hex').slice(0, 16);
  return `api_${slug}_${digest}`;
}

function operationParameterSchema(operation) {
  const properties = {};
  const required = [];
  for (const section of ['path', 'query']) {
    const sectionSchema = operation.parameters[section];
    if (!Object.keys(sectionSchema.properties).length) continue;
    for (const [name, property] of Object.entries(sectionSchema.properties)) {
      const propertyType = Array.isArray(property.type)
        ? property.type.find(candidate => candidate !== 'null')
        : property.type;
      if (propertyType === 'array' && !isScalarSchema(property.items)) {
        throw new Error(`Operation '${operation.operationId}' parameter '${name}' uses unsupported array items`);
      }
      if (section === 'path' && propertyType === 'object' &&
          Object.values(property.properties || {}).some(nested => nested.type === 'object' || nested.type === 'array')) {
        throw new Error(`Operation '${operation.operationId}' path parameter '${name}' uses unsupported nested serialization`);
      }
    }
    properties[section] = sectionSchema;
    required.push(section);
  }
  if (operation.requestBody) {
    properties.body = operation.requestBody.schema;
    if (operation.requestBody.required) required.push('body');
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

function guidelineParameters(parameterSchema) {
  const describe = (schema, required = false) => {
    const type = Array.isArray(schema.type)
      ? schema.type.find(candidate => candidate !== 'null')
      : schema.type;
    return {
      type,
      required,
      ...(schema.description ? { description: schema.description } : {}),
      ...(type === 'object'
        ? {
            properties: Object.fromEntries(Object.entries(schema.properties || {}).map(([name, property]) => [
              name,
              describe(property, (schema.required || []).includes(name))
            ]))
          }
        : {}),
      ...(type === 'array' ? { items: describe(schema.items) } : {})
    };
  };
  return Object.fromEntries(Object.entries(parameterSchema.properties).map(([section, schema]) => [
    section,
    describe(schema, parameterSchema.required.includes(section))
  ]));
}

export function createDynamicActions(integration, specification) {
  const operations = new Map(specification.operations.map(operation => [operation.operationId, operation]));
  const actions = [];
  for (const operationId of integration.allowedOperationIds) {
    const operation = operations.get(operationId);
    if (!operation || !['GET', 'POST', 'PUT'].includes(operation.method)) {
      throw new Error(`Allowlisted operation '${operationId}' is missing or unsupported in the OpenAPI document`);
    }
    if ((operation.security.length || integration.authenticationRequired) &&
        typeof integration.getAuthHeaders !== 'function') {
      throw new Error(`Operation '${operationId}' requires server-configured API credentials`);
    }
    const parameterJsonSchema = operationParameterSchema(operation);
    const parameterSchema = createParameterSchema(parameterJsonSchema);
    const name = createActionName(integration.id, operationId);

    actions.push({
      name,
      title: `${operation.method === 'GET' ? 'Read' : operation.method === 'PUT' ? 'Update' : 'Submit'} ${sanitizeDescription(operation.description || operationId)}`,
      description: `${operation.method === 'GET' ? 'Read-only' : 'Write'} API operation '${sanitizeDescription(operationId)}'. ${sanitizeDescription(operation.description)}`,
      parameters: guidelineParameters(parameterJsonSchema),
      parameterSchema,
      permissions: integration.permissions[operationId] || [],
      risk: operation.method === 'GET'
        ? 'read'
        : integration.destructiveOperationIds.includes(operationId) ? 'destructive' : 'write',
      promptable: true,
      requiresConfirmation: operation.method !== 'GET',
      metadata: {
        dynamicApi: {
          integrationId: integration.id,
          operationId,
          method: operation.method,
          path: operation.path,
          description: operation.description,
          parameterJsonSchema,
          serialization: operation.parameters.serialization,
          requestBody: operation.requestBody,
          responseFields: integration.responseFields[operationId],
          requiresAuth: operation.security.length > 0 || integration.authenticationRequired,
          roles: Object.freeze(Object.keys(integration.roleOperationIds)
            .filter(role => integration.roleOperationIds[role].includes(operationId))),
          applicationId: integration.applicationId,
          assistantId: integration.assistantId
        }
      }
    });
  }
  return actions;
}

function cleanExpiredConfirmations(now = Date.now()) {
  for (const [digest, confirmation] of pendingConfirmations) {
    if (confirmation.expiresAt <= now) pendingConfirmations.delete(digest);
  }
  for (const [key, outcome] of confirmationOutcomes) {
    if (outcome.expiresAt <= now) confirmationOutcomes.delete(key);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createOutcomeKey(actionDefinition, argumentsValue, user) {
  const metadata = actionDefinition.metadata.dynamicApi;
  const operationArguments = metadata.operationId === 'create_application_api_v1_applications_post'
    ? { job_id: argumentsValue.body?.job_id }
    : argumentsValue;
  return createHash('sha256')
    .update(`${user.id}\0${metadata.integrationId}\0${metadata.operationId}\0${stableJson(operationArguments)}`)
    .digest('hex');
}

export async function stageDynamicApiConfirmation(
  actionDefinition,
  argumentsValue,
  user,
  { readActions = [], request = requestJson, conversationId = null, profileMergeMode = null, signal } = {}
) {
  if (!isDynamicApiDiscoveryEnabled()) throw new Error('Dynamic API discovery is disabled');
  const metadata = actionDefinition?.metadata?.dynamicApi;
  const integration = metadata && integrations.get(metadata.integrationId);
  if (!integration ||
      metadata.method === 'GET' ||
      !metadata.roles?.includes(getUserRole(user)) ||
      !getRoleOperationIds(integration, user).includes(metadata.operationId) ||
      !(await authorizeIntegration(integration, user))) {
    throw new Error('Dynamic API write action is not authorized');
  }
  const validation = actionDefinition.parameterSchema.safeParse(argumentsValue || {});
  if (!validation.success) throw new Error('Dynamic API action parameters are invalid');

  let preparation = null;
  let approvedArguments = validation.data;
  if (integration.prepareAction) {
    const readActionsByOperationId = new Map(
      readActions
        .filter(action => action.metadata?.dynamicApi?.method === 'GET')
        .map(action => [action.metadata.dynamicApi.operationId, action])
    );
    preparation = await integration.prepareAction({
      actionDefinition,
      argumentsValue: validation.data,
      user,
      options: { profileMergeMode },
      readOperation: async (operationId, readArguments = {}) => {
        const readAction = readActionsByOperationId.get(operationId);
        if (!readAction) throw new Error(`Required verification operation '${operationId}' is unavailable`);
        return executeDynamicApiRead(readAction, readArguments, user, { request, signal });
      }
    });
    if (preparation?.ready === false) {
      return { ready: false, reviewMessage: preparation.reviewMessage };
    }
    if (preparation?.argumentsValue !== undefined) {
      approvedArguments = preparation.argumentsValue;
    }
  }
  const preparedValidation = actionDefinition.parameterSchema.safeParse(approvedArguments);
  if (!preparedValidation.success) throw new Error('Prepared dynamic API action parameters are invalid');

  cleanExpiredConfirmations();
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  pendingConfirmations.set(digest, {
    actionDefinition,
    argumentsValue: structuredClone(preparedValidation.data),
    userId: user.id,
    integrationSessionId: user.integrationSessionId,
    conversationId: typeof conversationId === 'string' ? conversationId : null,
    outcomeKey: createOutcomeKey(actionDefinition, preparedValidation.data, user),
    reviewMessage: typeof preparation?.reviewMessage === 'string'
      ? preparation.reviewMessage.slice(0, 4000)
      : null,
    formattedReview: preparation?.formattedReview || null,
    expiresAt: Date.now() + CONFIRMATION_TTL_MS,
    state: 'pending'
  });
  return {
    ready: true,
    confirmationToken: token,
    parameters: preparedValidation.data,
    formattedReview: preparation?.formattedReview || null,
    reviewMessage: pendingConfirmations.get(digest).reviewMessage
  };
}

export function cancelDynamicApiConfirmationWithContext(token, user) {
  cleanExpiredConfirmations();
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return { cancelled: false, conversationId: null, operationId: null };
  }
  const digest = createHash('sha256').update(token).digest('hex');
  const confirmation = pendingConfirmations.get(digest);
  if (!confirmation ||
      confirmation.userId !== user?.id ||
      confirmation.integrationSessionId !== user?.integrationSessionId ||
      confirmation.state !== 'pending') {
    return { cancelled: false, conversationId: null, operationId: null };
  }
  const context = {
    cancelled: true,
    conversationId: confirmation.conversationId || null,
    operationId: confirmation.actionDefinition?.metadata?.dynamicApi?.operationId || null
  };
  confirmation.state = 'cancelled';
  pendingConfirmations.delete(digest);
  return context;
}

export function cancelDynamicApiConfirmation(token, user) {
  return cancelDynamicApiConfirmationWithContext(token, user).cancelled;
}

export async function executeApprovedDynamicApiConfirmation(token, user, execute, { onSuccess } = {}) {
  cleanExpiredConfirmations();
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    const error = new Error('The confirmation has expired or is invalid. No write was attempted. Ask me to re-check the requirements and prepare a fresh confirmation.');
    error.code = 'CONFIRMATION_INVALID_OR_EXPIRED';
    throw error;
  }
  const digest = createHash('sha256').update(token).digest('hex');
  const confirmation = pendingConfirmations.get(digest);
  if (!confirmation || confirmation.expiresAt <= Date.now()) {
    pendingConfirmations.delete(digest);
    const error = new Error('The confirmation has expired or is invalid. No write was attempted. Ask me to re-check the requirements and prepare a fresh confirmation.');
    error.code = 'CONFIRMATION_INVALID_OR_EXPIRED';
    throw error;
  }
  if (confirmation.userId !== user?.id ||
      confirmation.integrationSessionId !== user?.integrationSessionId) {
    throw new Error('The confirmation does not belong to this authenticated HirePool session.');
  }
  const notifySuccess = async result => {
    if (typeof onSuccess === 'function') {
      try {
        await onSuccess({
          actionDefinition: confirmation.actionDefinition,
          argumentsValue: confirmation.argumentsValue,
          conversationId: confirmation.conversationId,
          result
        });
      } catch (error) {
        console.error('[Dynamic API] Could not update confirmed conversation workflow state:', error?.message || error);
      }
    }
    return result;
  };
  if (confirmation.state === 'executing') return confirmation.promise.then(notifySuccess);
  if (confirmation.state === 'completed') return notifySuccess(confirmation.result);
  if (confirmation.state === 'failed') throw confirmation.error;

  const priorOutcome = confirmationOutcomes.get(confirmation.outcomeKey);
  if (priorOutcome?.state === 'executing') {
    return priorOutcome.promise.then(async result => {
      confirmation.state = 'completed';
      confirmation.result = result;
      return notifySuccess(result);
    });
  }
  if (priorOutcome?.state === 'completed') {
    confirmation.state = 'completed';
    confirmation.result = priorOutcome.result;
    return notifySuccess(priorOutcome.result);
  }
  if (priorOutcome?.state === 'uncertain') {
    throw new Error('A previous submission may have reached HirePool. Check application history before trying again.');
  }

  const outcome = {
    state: 'executing',
    expiresAt: Date.now() + CONFIRMATION_TTL_MS
  };
  confirmationOutcomes.set(confirmation.outcomeKey, outcome);
  confirmation.state = 'executing';
  confirmation.promise = Promise.resolve()
    .then(() => execute(confirmation.actionDefinition, confirmation.argumentsValue))
    .then(result => {
      outcome.state = 'completed';
      outcome.result = result;
      confirmation.state = 'completed';
      confirmation.result = result;
      return notifySuccess(result);
    })
    .catch(error => {
      confirmation.state = 'failed';
      confirmation.error = error;
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
        confirmationOutcomes.delete(confirmation.outcomeKey);
      } else {
        outcome.state = 'uncertain';
      }
      throw error;
    });
  return confirmation.promise;
}

function isTransientReadError(error) {
  if (!error) return false;
  if (/timed?\s*out|timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|network/i.test(String(error?.message || ''))) {
    return true;
  }
  const status = Number(error?.statusCode);
  return Number.isInteger(status) && status >= 502 && status <= 504;
}

export async function executeDynamicApiRead(actionDefinition, argumentsValue, user, options = {}) {
  if (actionDefinition?.metadata?.dynamicApi?.method !== 'GET') {
    throw new Error('Only safe dynamic API reads may use the read executor');
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await executeDynamicApiAction(actionDefinition, argumentsValue, user, options);
    } catch (error) {
      if (attempt > 0 || options.signal?.aborted || !isTransientReadError(error)) {
        throw error;
      }
    }
  }
}

async function authorizeIntegration(integration, user) {
  if (!integration.enabled || !user ||
      user.applicationId !== integration.applicationId ||
      !getRoleOperationIds(integration, user).length) return false;
  try {
    return await integration.authorize(user) === true;
  } catch {
    return false;
  }
}

export async function createRequestActionRegistry(
  assistantId,
  user,
  baseRegistry,
  { fetchSpec = requestText, signal } = {}
) {
  if (!isDynamicApiDiscoveryEnabled()) return baseRegistry;
  const registry = new ActionRegistry({
    tag: baseRegistry.tag,
    actions: baseRegistry.list()
  });

  const candidates = Array.from(integrations.values()).filter(item => item.enabled && item.assistantId === assistantId);
  const authorized = [];
  for (const integration of candidates) {
    if (await authorizeIntegration(integration, user)) authorized.push(integration);
  }
  if (authorized.length > 1) {
    throw new Error('More than one dynamic API integration is authorized for this assistant');
  }
  if (!authorized.length) return registry;

  const integration = authorized[0];
  const allowedHosts = getIntegrationAllowedHosts(integration);
  const { timeoutMs, maxSpecBytes } = getDynamicApiLimits({
    API_DISCOVERY_TIMEOUT_MS: String(integration.limits.timeoutMs),
    API_DISCOVERY_MAX_SPEC_BYTES: String(integration.limits.maxSpecBytes)
  });
  const urlOptions = getIntegrationUrlOptions(integration);
  const specUrl = validateApiUrl(integration.openApiSpecUrl, allowedHosts, urlOptions);
  let specHeaders = {};
  if (integration.getSpecAuthHeaders) {
    try {
      specHeaders = validateAuthHeaders(await integration.getSpecAuthHeaders(user));
    } catch {
      throw new Error('Dynamic API specification credentials are unavailable');
    }
  }
  const specificationText = await fetchSpec(specUrl, {
    allowedHosts,
    ...urlOptions,
    headers: specHeaders,
    timeoutMs,
    maxBytes: maxSpecBytes,
    allowYaml: true,
    signal
  });
  const specification = parseOpenApiSpec(specificationText);
  const roleOperationIds = getRoleOperationIds(integration, user);
  const roleIntegration = {
    ...integration,
    allowedOperationIds: integration.allowedOperationIds.filter(operationId =>
      roleOperationIds.includes(operationId)
    ),
    roleOperationIds: { [getUserRole(user)]: roleOperationIds }
  };
  registry.registerMany(createDynamicActions(roleIntegration, specification));
  return registry;
}

function pickResponseFields(value, fields) {
  const project = (source, parts) => {
    if (Array.isArray(source)) {
      return source.map(item => project(item, parts) ?? {});
    }
    if (!source || typeof source !== 'object' || !Object.hasOwn(source, parts[0])) return undefined;
    const [head, ...tail] = parts;
    if (!tail.length) {
      const fieldValue = source[head];
      if (fieldValue !== null && typeof fieldValue === 'object' &&
          (!Array.isArray(fieldValue) || fieldValue.some(item => item !== null && typeof item === 'object'))) {
        return undefined;
      }
      return { [head]: fieldValue };
    }
    const nested = project(source[head], tail);
    return nested === undefined ? undefined : { [head]: nested };
  };
  const merge = (target, source) => {
    if (Array.isArray(source)) {
      if (!Array.isArray(target)) return source;
      return source.map((item, index) => merge(target[index], item));
    }
    if (!source || typeof source !== 'object') return source;
    const result = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
    for (const [key, value] of Object.entries(source)) {
      result[key] = merge(result[key], value);
    }
    return result;
  };
  let output = {};
  for (const field of fields) {
    const projected = project(value, field.split('.'));
    if (projected !== undefined) output = merge(output, projected);
  }
  return output;
}

function buildOperationUrl(baseUrl, metadata, args) {
  let path = metadata.path;
  const pathSchema = metadata.parameterJsonSchema.properties.path?.properties || {};
  for (const name of Object.keys(pathSchema)) {
    if (!Object.hasOwn(args.path || {}, name)) throw new Error(`Required path parameter '${name}' is missing`);
    const rawValue = args.path[name];
    const serialization = metadata.serialization?.path?.[name] || { style: 'simple', explode: false };
    if (rawValue === null) throw new Error(`Path parameter '${name}' cannot be null`);
    let value;
    if (Array.isArray(rawValue)) {
      value = rawValue.map(String).join(',');
    } else if (rawValue && typeof rawValue === 'object') {
      const entries = Object.entries(rawValue);
      value = serialization.explode
        ? entries.map(([key, item]) => `${key}=${item}`).join(',')
        : entries.flatMap(([key, item]) => [key, String(item)]).join(',');
    } else {
      value = String(rawValue);
    }
    if (value === '.' || value === '..' || /[\\/]/.test(value)) {
      throw new Error(`Path parameter '${name}' is invalid`);
    }
    path = path.replaceAll(`{${name}}`, encodeURIComponent(value));
  }
  if (/\{[^}]+\}/.test(path)) throw new Error('An OpenAPI path parameter is unresolved');

  const base = new URL(baseUrl);
  const url = new URL(path.replace(/^\/+/, ''), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error('Dynamic API operation escaped its configured base URL');
  }
  const query = args.query || {};
  for (const [name, value] of Object.entries(query)) {
    const serialization = metadata.serialization?.query?.[name] || { style: 'form', explode: true };
    if (value === null) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (serialization.style === 'deepObject') {
        const appendNested = (prefix, nested) => {
          for (const [key, item] of Object.entries(nested)) {
            const nestedName = `${prefix}[${key}]`;
            if (item && typeof item === 'object' && !Array.isArray(item)) appendNested(nestedName, item);
            else if (Array.isArray(item)) {
              for (const element of item) url.searchParams.append(nestedName, String(element));
            } else url.searchParams.append(nestedName, String(item));
          }
        };
        appendNested(name, value);
      } else {
        for (const [key, item] of Object.entries(value)) {
          if (Array.isArray(item)) {
            for (const element of item) url.searchParams.append(key, String(element));
          } else {
            url.searchParams.append(key, String(item));
          }
        }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, String(item));
    } else {
      url.searchParams.set(name, String(value));
    }
  }
  if (url.href.length > 8192) throw new Error('Dynamic API request URL exceeded the configured size limit');
  return url;
}

function validateAuthHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new Error('Dynamic API auth callback returned invalid headers');
  }
  const result = {};
  const seen = new Set();
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (
      !/^[a-z0-9-]+$/.test(normalized) ||
      seen.has(normalized) ||
      forbiddenHeaders.has(normalized) ||
      !(
        normalized === 'authorization' ||
        normalized === 'x-api-key' ||
        normalized.startsWith('x-api-') ||
        normalized.startsWith('x-auth-') ||
        normalized === 'x-tenant-id'
      ) ||
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > 4096 ||
      /[\r\n]/.test(value)
    ) {
      throw new Error('Dynamic API auth callback returned a disallowed header');
    }
    seen.add(normalized);
    result[name] = value;
  }
  return result;
}

export async function executeDynamicApiAction(
  actionDefinition,
  argumentsValue,
  user,
  { request = requestJson, signal, approved = false } = {}
) {
  if (!isDynamicApiDiscoveryEnabled()) {
    throw new Error('Dynamic API discovery is disabled');
  }
  const metadata = actionDefinition?.metadata?.dynamicApi;
  const integration = metadata && integrations.get(metadata.integrationId);
  if (!integration ||
      metadata.assistantId !== integration.assistantId ||
      metadata.applicationId !== integration.applicationId ||
      !metadata.roles?.includes(getUserRole(user)) ||
      !getRoleOperationIds(integration, user).includes(metadata.operationId) ||
      !(await authorizeIntegration(integration, user))) {
    throw new Error('Dynamic API action is not authorized');
  }
  if (metadata.method !== 'GET' && !approved) {
    throw new Error('Dynamic API write actions require explicit user confirmation');
  }
  const validation = actionDefinition.parameterSchema.safeParse(argumentsValue || {});
  if (!validation.success) throw new Error('Dynamic API action parameters are invalid');

  const allowedHosts = getIntegrationAllowedHosts(integration);
  const urlOptions = getIntegrationUrlOptions(integration);
  const apiBase = validateApiUrl(integration.apiBaseUrl, allowedHosts, urlOptions);
  const url = buildOperationUrl(apiBase, metadata, validation.data);
  let authHeaders = {};
  if (integration.getAuthHeaders) {
    try {
      authHeaders = validateAuthHeaders(await integration.getAuthHeaders(user));
    } catch {
      throw new Error('Dynamic API credentials are unavailable');
    }
  }
  if (metadata.requiresAuth && Object.keys(authHeaders).length === 0) {
    throw new Error('Required API credentials are unavailable');
  }
  const { timeoutMs } = getDynamicApiLimits({
    API_DISCOVERY_TIMEOUT_MS: String(integration.limits.timeoutMs),
    API_DISCOVERY_MAX_SPEC_BYTES: String(integration.limits.maxSpecBytes)
  });
  const response = await request(url, {
    allowedHosts,
    ...urlOptions,
    headers: authHeaders,
    method: metadata.method,
    body: validation.data.body,
    contentType: metadata.requestBody?.contentType,
    timeoutMs,
    maxBytes: integration.limits.maxResponseBytes,
    signal
  });
  const projected = pickResponseFields(response, metadata.responseFields);
  if (Buffer.byteLength(JSON.stringify(projected), 'utf8') > integration.limits.maxResultBytes) {
    throw new Error('Dynamic API result exceeded the configured size limit');
  }
  return projected;
}
