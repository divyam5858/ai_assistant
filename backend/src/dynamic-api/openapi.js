import { parseDocument } from 'yaml';

const MAX_SCHEMA_DEPTH = 12;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function decodePointerPart(value) {
  return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveReference(value, document, depth = 0) {
  if (!value?.$ref) return value;
  if (depth >= MAX_SCHEMA_DEPTH || !value.$ref.startsWith('#/')) {
    throw new Error('OpenAPI contains an unsupported or recursive reference');
  }

  const resolved = value.$ref.slice(2).split('/').reduce((current, part) => {
    const key = decodePointerPart(part);
    if (!current || !Object.hasOwn(current, key)) {
      throw new Error('OpenAPI contains an unresolved reference');
    }
    return current[key];
  }, document);
  const dereferenced = resolveReference(resolved, document, depth + 1);
  const { $ref, ...siblings } = value;
  return Object.keys(siblings).length && dereferenced && typeof dereferenced === 'object'
    ? { ...dereferenced, ...siblings }
    : dereferenced;
}

function normalizeSchema(rawSchema, document, depth = 0) {
  if (depth >= MAX_SCHEMA_DEPTH) throw new Error('OpenAPI schema is nested too deeply');
  const schema = resolveReference(rawSchema || {}, document);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('OpenAPI contains an invalid parameter schema');
  }

  if (Array.isArray(schema.anyOf)) {
    if (schema.anyOf.length < 2 || schema.anyOf.length > 4) {
      throw new Error('OpenAPI contains an unsupported anyOf parameter schema');
    }
    const nonNull = schema.anyOf.filter(candidate =>
      !(candidate && typeof candidate === 'object' &&
        (candidate.type === 'null' || (Array.isArray(candidate.type) && candidate.type.length === 1 && candidate.type[0] === 'null')))
    );
    const nullVariants = schema.anyOf.length - nonNull.length;
    if (nullVariants !== 1 || nonNull.length !== 1) {
      throw new Error('OpenAPI anyOf is supported only for a nullable parameter schema');
    }
    return normalizeSchema({ ...nonNull[0], ...schema, anyOf: undefined, nullable: true }, document, depth + 1);
  }

  const declaredTypes = Array.isArray(schema.type) ? schema.type : [schema.type].filter(Boolean);
  if (declaredTypes.length > 2 || (declaredTypes.includes('null') && declaredTypes.length !== 2)) {
    throw new Error('OpenAPI contains an unsupported union parameter schema');
  }
  const types = declaredTypes.filter(type => type !== 'null');
  if (types.length > 1) throw new Error('OpenAPI contains an unsupported union parameter schema');
  const nullable = schema.nullable === true || declaredTypes.includes('null');
  const enumType = Array.isArray(schema.enum) && schema.enum.length
    ? typeof schema.enum[0]
    : null;
  const type = types[0] || enumType;
  const output = {};
  if (nullable) output.nullable = true;

  if (schema.enum !== undefined) {
    if (
      !Array.isArray(schema.enum) ||
      schema.enum.length === 0 ||
      schema.enum.length > 100 ||
      schema.enum.some(value => !['string', 'number', 'boolean'].includes(typeof value))
    ) {
      throw new Error('OpenAPI contains an invalid enum');
    }
    output.enum = schema.enum;
  }
  if (schema.description) {
    output.description = String(schema.description)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 250);
  }
  if (schema.default !== undefined) {
    const defaultValue = schema.default;
    const defaultType = Array.isArray(defaultValue) ? 'array' : (defaultValue === null ? 'null' : typeof defaultValue);
    if (
      (['string', 'number', 'boolean'].includes(defaultType) || (defaultType === 'null' && nullable)) &&
      (defaultType === 'null' || type === undefined || defaultType === type || (type === 'integer' && defaultType === 'number')) &&
      (typeof defaultValue !== 'string' || defaultValue.length <= 2048) &&
      (typeof defaultValue !== 'number' || Number.isFinite(defaultValue))
    ) {
      output.default = defaultValue;
    } else {
      throw new Error('OpenAPI contains an unsafe or unsupported parameter default');
    }
  }
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined) {
      if (!Number.isFinite(schema[key]) || schema[key] < 0) {
        throw new Error(`OpenAPI contains an invalid ${key} constraint`);
      }
      const max = key === 'maxLength' ? 2048 : (key === 'maxItems' ? 50 : Infinity);
      if ((key === 'minLength' && schema[key] > 2048) || (key === 'minItems' && schema[key] > 50)) {
        throw new Error(`OpenAPI ${key} exceeds the supported request limit`);
      }
      output[key] = Math.min(schema[key], max);
    }
  }

  if (type === 'string' || type === 'number' || type === 'integer' || type === 'boolean') {
    output.type = nullable ? [type, 'null'] : type;
    return output;
  }
  if (type === 'array') {
    output.type = nullable ? ['array', 'null'] : 'array';
    output.items = normalizeSchema(schema.items, document, depth + 1);
    return output;
  }
  if (type === 'object' || schema.properties) {
    output.type = nullable ? ['object', 'null'] : 'object';
    output.properties = {};
    for (const [name, property] of Object.entries(schema.properties || {})) {
      if (
        name.length > 100 ||
        !/^[a-zA-Z0-9_.-]+$/.test(name) ||
        ['__proto__', 'prototype', 'constructor'].includes(name)
      ) throw new Error('OpenAPI parameter name is invalid');
      output.properties[name] = normalizeSchema(property, document, depth + 1);
    }
    output.required = Array.isArray(schema.required) ? schema.required.filter(name => Object.hasOwn(output.properties, name)) : [];
    output.additionalProperties = schema.additionalProperties === true && Object.keys(output.properties).length === 0;
    return output;
  }

  throw new Error(`OpenAPI contains an unsupported parameter schema type: ${String(type || 'unspecified')}`);
}

function parameterKey(parameter) {
  return `${parameter.in}:${parameter.name}`;
}

function collectParameters(pathItem, operation, document) {
  const combined = new Map();
  const allParameters = [];
  for (const parameter of [...(pathItem.parameters || []), ...(operation.parameters || [])]) {
    const resolved = resolveReference(parameter, document);
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
      throw new Error('OpenAPI contains an invalid parameter');
    }
    allParameters.push(resolved);
    if (resolved.in === 'header' && String(resolved.name).toLowerCase() === 'authorization') continue;
    if (!['path', 'query'].includes(resolved.in)) continue;
    if (
      typeof resolved.name !== 'string' ||
      !resolved.name ||
      resolved.name.length > 100 ||
      !/^[a-zA-Z0-9_.-]+$/.test(resolved.name) ||
      ['__proto__', 'prototype', 'constructor'].includes(resolved.name)
    ) throw new Error('OpenAPI parameter name is invalid');
    combined.set(parameterKey(resolved), resolved);
  }
  if (combined.size > 30) throw new Error('OpenAPI operation has too many path/query parameters');

  const path = {};
  const query = {};
  const serialization = { path: {}, query: {} };
  for (const parameter of combined.values()) {
    const style = parameter.style || (parameter.in === 'path' ? 'simple' : 'form');
    const explode = parameter.explode ?? (style === 'form' || style === 'deepObject');
    const supportedStyle = parameter.in === 'path'
      ? style === 'simple'
      : ['form', 'deepObject'].includes(style);
    if (!supportedStyle || (style === 'deepObject' && (!explode || parameter.in !== 'query'))) {
      throw new Error(`OpenAPI parameter '${parameter.name}' uses unsupported serialization`);
    }
    const schema = normalizeSchema(parameter.schema, document);
    schema.description ||= String(parameter.description || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 250);
    const target = parameter.in === 'path' ? path : query;
    target[parameter.name] = schema;
    serialization[parameter.in][parameter.name] = { style, explode };
    if (parameter.in === 'path' && parameter.required !== true) {
      throw new Error(`Path parameter '${parameter.name}' must be required`);
    }
    if (schema.type === 'object' && parameter.in === 'query' && style === 'form' && !explode) {
      throw new Error(`OpenAPI object query parameter '${parameter.name}' requires explode serialization`);
    }
    if (schema.type === 'object' && parameter.in === 'query' && style === 'form' &&
        Object.values(schema.properties || {}).some(property =>
          property.type === 'object' ||
          (property.type === 'array' && !['string', 'number', 'integer', 'boolean'].includes(property.items?.type))
        )) {
      throw new Error(`OpenAPI object query parameter '${parameter.name}' has unsupported nested form serialization`);
    }
    if (style === 'deepObject' && schema.type !== 'object') {
      throw new Error(`OpenAPI deepObject parameter '${parameter.name}' must have an object schema`);
    }
  }
  return {
    path: { type: 'object', properties: path, required: Object.keys(path), additionalProperties: false },
    query: {
      type: 'object',
      properties: query,
      required: Array.from(combined.values())
        .filter(parameter => parameter.in === 'query' && parameter.required === true)
        .map(parameter => parameter.name),
      additionalProperties: false
    },
    serialization,
    headerParameters: allParameters
      .filter(parameter => parameter.in === 'header')
      .map(parameter => ({
        name: String(parameter.name || '').slice(0, 100),
        required: parameter.required === true
      }))
  };
}

function hasInvalidPathTemplate(path) {
  return /[{}]/.test(path.replace(/\{[a-zA-Z0-9_]+\}/g, ''));
}

function normalizeRequestBody(requestBody, document) {
  if (!requestBody) return null;
  if (requestBody.invalidReference) throw new Error('OpenAPI request body reference is invalid');
  if (typeof requestBody.required !== 'boolean' && requestBody.required !== undefined) {
    throw new Error('OpenAPI request body required flag is invalid');
  }
  const content = requestBody.content && typeof requestBody.content === 'object'
    ? requestBody.content
    : {};
  const jsonContent = Object.entries(content).find(([contentType]) => {
    const normalized = contentType.toLowerCase().split(';', 1)[0].trim();
    return normalized === 'application/json' || normalized.endsWith('+json');
  });
  if (!jsonContent?.[1]?.schema) {
    throw new Error('Only JSON request bodies are supported for dynamic API operations');
  }
  return {
    required: requestBody.required === true,
    contentType: jsonContent[0],
    schema: normalizeSchema(jsonContent[1].schema, document)
  };
}

export function parseOpenApiSpec(input) {
  let document;
  if (typeof input === 'string') {
    const parsed = parseDocument(input, { maxAliasCount: 20 });
    if (parsed.errors.length) throw new Error('OpenAPI document is not valid JSON or YAML');
    document = parsed.toJS();
  } else {
    document = input;
  }

  if (
    !document ||
    typeof document !== 'object' ||
    !/^3\.(0|1)\.\d+/.test(document.openapi || '') ||
    !document.info ||
    !document.paths ||
    typeof document.paths !== 'object'
  ) {
    throw new Error('A valid OpenAPI 3.0 or 3.1 document is required');
  }
  if (Object.keys(document.paths).length > 500) throw new Error('OpenAPI contains too many paths');
  if (Object.keys(document.paths).some(path => !path.startsWith('/') || path.length > 500)) {
    throw new Error('OpenAPI contains an invalid or oversized path');
  }

  const operations = [];
  const inventory = [];
  const diagnostics = [];
  const operationIds = new Set();
  for (const [path, pathItemValue] of Object.entries(document.paths)) {
    if (
      !/^\/[a-zA-Z0-9_{}./:-]*$/.test(path) ||
      path.includes('//') ||
      path.split('/').some(part => part === '.' || part === '..') ||
      hasInvalidPathTemplate(path)
    ) throw new Error(`OpenAPI contains a structurally unsafe path '${path.slice(0, 120)}'`);

    let pathItem;
    try {
      pathItem = resolveReference(pathItemValue, document);
      if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) {
        throw new Error('OpenAPI path item is invalid');
      }
    } catch (error) {
      throw new Error(`OpenAPI path item reference for '${path}' is invalid: ${error.message}`);
    }

    const methodNames = Object.keys(pathItem).filter(name => HTTP_METHODS.has(name.toLowerCase()));
    for (const methodName of methodNames) {
      const method = methodName.toUpperCase();
      const operation = pathItem[methodName];
      const operationId = typeof operation?.operationId === 'string' ? operation.operationId : null;
      if (operationId && operationIds.has(operationId)) {
        throw new Error(`OpenAPI contains duplicate operation ID '${operationId}'`);
      }
      if (operationId) operationIds.add(operationId);
      let requestBody = operation?.requestBody;
      try {
        requestBody = requestBody ? resolveReference(requestBody, document) : null;
      } catch {
        requestBody = { invalidReference: true };
      }
      const responses = operation?.responses && typeof operation.responses === 'object'
        ? Object.fromEntries(Object.entries(operation.responses).map(([status, response]) => {
          let resolvedResponse = response;
          try {
            resolvedResponse = resolveReference(response, document);
          } catch {
            resolvedResponse = { invalidReference: true };
          }
          const content = resolvedResponse?.content && typeof resolvedResponse.content === 'object'
            ? Object.fromEntries(Object.entries(resolvedResponse.content).map(([contentType, definition]) => [
              contentType,
              { schema: definition?.schema?.$ref || definition?.schema?.type || null }
            ]))
            : {};
          return [status, { description: String(resolvedResponse?.description || '').slice(0, 200), content }];
        }))
        : {};

      const entry = {
        path,
        method,
        operationId,
        parserStatus: 'rejected',
        eligible: false,
        reason: null,
        parameters: [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
          ...(Array.isArray(operation?.parameters) ? operation.parameters : [])]
          .map(parameter => ({
            name: String(parameter?.name || '').slice(0, 100),
            in: String(parameter?.in || '').slice(0, 20),
            required: parameter?.required === true,
            schema: parameter?.schema?.$ref || parameter?.schema?.type ||
              (Array.isArray(parameter?.schema?.type) ? parameter.schema.type.join('|') :
                (Array.isArray(parameter?.schema?.anyOf) ? `anyOf(${parameter.schema.anyOf.map(item => item?.type || item?.$ref || 'unknown').join('|')})` : null))
          })),
        requestBody: requestBody
          ? {
            required: requestBody.required === true,
            contentTypes: Object.keys(requestBody.content || {})
          }
          : null,
        responses,
        authentication: {
          declared: Array.isArray(operation?.security ?? document.security) &&
            (operation?.security ?? document.security).length > 0,
          schemes: operation?.security ?? document.security ?? [],
          authorizationHeaderParameter: [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
            ...(Array.isArray(operation?.parameters) ? operation.parameters : [])]
            .some(parameter => parameter?.in === 'header' &&
              String(parameter.name || '').toLowerCase() === 'authorization')
        },
        roleAssumptions: 'not-defined-by-openapi'
      };
      inventory.push(entry);

      const reject = reason => {
        entry.reason = reason;
        diagnostics.push({ path, method, operationId, reason });
      };
      if (!operationId || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(operationId)) {
        reject('Operation ID is missing or invalid');
        continue;
      }
      if (!['GET', 'POST', 'PUT'].includes(method)) {
        reject('Only GET, POST, and PUT operations are supported');
        continue;
      }

      try {
        const parameters = collectParameters(pathItem, operation, document);
        const parameterDefinitions = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
          ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
          .map(parameter => resolveReference(parameter, document));
        entry.parameters = parameterDefinitions.map(parameter => ({
          name: parameter.name,
          in: parameter.in,
          required: parameter.required === true,
          schema: parameter.schema?.$ref || parameter.schema?.type ||
            (Array.isArray(parameter.schema?.type) ? parameter.schema.type.join('|') :
              (Array.isArray(parameter.schema?.anyOf) ? `anyOf(${parameter.schema.anyOf.map(item => item?.type || item?.$ref || 'unknown').join('|')})` : null))
        }));
        entry.authentication.authorizationHeaderParameter = parameters.headerParameters.some(parameter =>
          parameter.name.toLowerCase() === 'authorization'
        );
        const pathParameters = Array.from(path.matchAll(/\{([a-zA-Z0-9_]+)\}/g), match => match[1]);
        if (
          pathParameters.length !== Object.keys(parameters.path.properties).length ||
          pathParameters.some(name => !Object.hasOwn(parameters.path.properties, name))
        ) {
          throw new Error(`OpenAPI path parameters do not match the parameters for '${operationId}'`);
        }
        const security = operation.security ?? document.security ?? [];
        if (!Array.isArray(security) || security.some(requirement =>
          !requirement || typeof requirement !== 'object' || Array.isArray(requirement)
        )) throw new Error(`OpenAPI security configuration for '${operationId}' is invalid`);
        for (const requirement of security) {
          for (const schemeName of Object.keys(requirement)) {
            if (!Object.hasOwn(document.components?.securitySchemes || {}, schemeName)) {
              throw new Error(`OpenAPI security scheme '${schemeName}' is undefined`);
            }
          }
        }
        const normalizedRequestBody = normalizeRequestBody(requestBody, document);

        entry.parserStatus = 'supported';
        entry.reason = 'Requires explicit server-side operation and role allowlisting';
        operations.push({
          operationId,
          method,
          path,
          description: String(operation.summary || operation.description || operationId).slice(0, 300),
          parameters,
          security,
          requestBody: normalizedRequestBody,
          responses
        });
      } catch (error) {
        reject(error.message || 'Operation schema is unsupported');
      }
    }
  }
  return {
    title: String(document.info.title || 'API').slice(0, 120),
    version: document.openapi,
    operations,
    inventory,
    diagnostics
  };
}
