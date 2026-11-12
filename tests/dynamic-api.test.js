import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, test } from 'node:test';
import { ActionRegistry, hasActionPermissions } from '../backend/src/actions/registry.js';
import { parametersToJsonSchema } from '../backend/src/actions/tool-converter.js';
import {
  clearDynamicApiIntegrations,
  createDynamicActions,
  createRequestActionRegistry,
  executeDynamicApiAction,
  getAssistantApplicationId,
  isDynamicApiDiscoveryEnabled,
  registerDynamicApiIntegration
} from '../backend/src/dynamic-api/catalog.js';
import { parseOpenApiSpec } from '../backend/src/dynamic-api/openapi.js';
import {
  getDynamicApiLimits,
  isPublicAddress,
  requestJson,
  requestText,
  validateApiUrl
} from '../backend/src/dynamic-api/secure-http.js';
import { buildSystemInstruction, extractActionProposal } from '../backend/src/routes/chat.js';
import { dispatchActionProposal } from '../connectors/bridge.js';
import { SessionManager, SessionOwnershipError } from '../backend/src/session-manager.js';

const originalEnv = new Map([
  'DYNAMIC_API_DISCOVERY_ENABLED',
  'API_DISCOVERY_ALLOWED_HOSTS',
  'API_DISCOVERY_TIMEOUT_MS',
  'API_DISCOVERY_MAX_SPEC_BYTES',
  'NODE_ENV',
  'VERCEL_ENV'
].map(key => [key, process.env[key]]));

afterEach(() => {
  clearDynamicApiIntegrations();
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const jsonSpec = {
  openapi: '3.0.3',
  info: { title: 'Jobs API', version: '1' },
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
    },
    parameters: {
      JobId: { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }
    },
    schemas: {
      Limit: { type: 'integer', minimum: 1, maximum: 25 }
    }
  },
  paths: {
    '/jobs/{jobId}': {
      get: {
        operationId: 'getJob',
        summary: 'Read one job',
        parameters: [
          { $ref: '#/components/parameters/JobId' },
          { name: 'limit', in: 'query', required: false, schema: { $ref: '#/components/schemas/Limit' } }
        ],
        security: [{ apiKey: [] }],
        responses: { 200: { description: 'Job' } }
      },
      delete: {
        operationId: 'deleteJob',
        responses: { 204: { description: 'Deleted' } }
      }
    },
    '/jobs': {
      get: {
        operationId: 'listJobs',
        summary: 'List jobs',
        responses: { 200: { description: 'Jobs' } }
      }
    }
  }
};

const yamlSpec = `openapi: 3.0.3
info:
  title: Jobs API
  version: '1'
paths:
  /jobs:
    get:
      operationId: listJobs
      summary: List jobs
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [open, closed]
      responses:
        '200':
          description: Jobs
`;

function registerTestIntegration(authorize = async user => user.tenantId === 'tenant-a') {
  registerDynamicApiIntegration({
    id: 'jobs',
    assistantId: 'jobs-assistant',
    applicationId: 'jobs-app',
    openApiSpecUrl: 'https://spec.example.test/openapi.json',
    apiBaseUrl: 'https://api.example.test/v1/',
    allowedHosts: ['spec.example.test', 'api.example.test'],
    enabled: true,
    authenticationRequired: true,
    allowedOperationIds: ['getJob'],
    roleOperationIds: { user: ['getJob'], candidate: ['getJob'] },
    responseFields: { getJob: ['id', 'status', 'items.id', 'items.status'] },
    permissions: { getJob: ['jobs:read'] },
    authorize,
    getAuthHeaders: async user => ({ Authorization: `Bearer ${user.apiToken}` })
  });
}

function createMockRequestFactory({ statusCode = 200, contentType = 'application/json', body = '{}' } = {}) {
  return (_options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      queueMicrotask(() => {
        const response = new Readable({ read() {} });
        response.statusCode = statusCode;
        response.headers = { 'content-type': contentType };
        response.destroy = () => response.push(null);
        callback(response);
        response.push(body);
        response.push(null);
        request.emit('close');
      });
    };
    request.destroy = error => {
      if (error) request.emit('error', error);
      request.emit('close');
    };
    return request;
  };
}

function sampleValue(schema) {
  const type = Array.isArray(schema.type)
    ? schema.type.find(candidate => candidate !== 'null')
    : schema.type;
  if (type === 'object') {
    const result = {};
    for (const key of schema.required || []) {
      result[key] = sampleValue(schema.properties[key]);
    }
    return result;
  }
  if (type === 'array') {
    return Array.from({ length: schema.minItems || 0 }, () => sampleValue(schema.items));
  }
  if (schema.enum?.length) return schema.enum[0];
  if (type === 'string') return 'sample'.padEnd(schema.minLength || 1, 'x');
  if (type === 'integer') return schema.minimum ?? 1;
  if (type === 'number') return schema.minimum ?? 1;
  if (type === 'boolean') return schema.default ?? true;
  return null;
}

function sampleArguments(schema) {
  return Object.fromEntries((schema.required || []).map(key => [
    key,
    sampleValue(schema.properties[key])
  ]));
}

test('OpenAPI JSON and YAML parsing emits only GET operations with local references resolved', () => {
  const parsedJson = parseOpenApiSpec(jsonSpec);
  assert.equal(parsedJson.operations.length, 2);
  assert.equal(parsedJson.operations[0].operationId, 'getJob');
  assert.equal(parsedJson.operations[1].operationId, 'listJobs');
  assert.deepEqual(parsedJson.operations[0].parameters.path.required, ['jobId']);
  assert.equal(parsedJson.operations[0].parameters.query.properties.limit.type, 'integer');
  assert.deepEqual(parsedJson.operations[0].security, [{ apiKey: [] }]);

  const parsedYaml = parseOpenApiSpec(yamlSpec);
  assert.equal(parsedYaml.operations[0].operationId, 'listJobs');
  assert.deepEqual(parsedYaml.operations[0].parameters.query.properties.status.enum, ['open', 'closed']);
  assert.equal(parsedJson.inventory.length, 3);
  assert.deepEqual(parsedJson.diagnostics.map(item => item.operationId), ['deleteJob']);
  assert.equal(parsedJson.inventory.find(item => item.operationId === 'deleteJob').parserStatus, 'rejected');
});

test('OpenAPI 3.1 nullable forms, nested objects, defaults, and per-operation rejection are represented safely', () => {
  const specification = {
    openapi: '3.1.0',
    info: { title: 'Nullable API', version: '1' },
    components: {
      schemas: {
        NullableString: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
        Filters: {
          type: 'object',
          properties: {
            active: { type: 'boolean', default: true },
            tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
            nested: { type: 'object', properties: { query: { type: 'string' } } }
          },
          required: ['active']
        }
      },
      parameters: {
        NullableFilter: {
          name: 'filter',
          in: 'query',
          style: 'deepObject',
          schema: { $ref: '#/components/schemas/Filters' }
        }
      }
    },
    paths: {
      '/jobs/{jobId}': {
        get: {
          operationId: 'readNullableJob',
          parameters: [
            { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'q', in: 'query', schema: { $ref: '#/components/schemas/NullableString' } },
            { $ref: '#/components/parameters/NullableFilter' }
          ],
          responses: { 200: { description: 'Job', content: { 'application/json': { schema: { $ref: '#/components/schemas/Filters' } } } } }
        },
        post: {
          operationId: 'createJob',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 201: { description: 'Created' } }
        }
      },
      '/broken': {
        get: {
          operationId: 'brokenJob',
          parameters: [{ name: 'bad', in: 'query', schema: { $ref: '#/components/schemas/Missing' } }],
          responses: { 200: { description: 'Bad' } }
        }
      }
    }
  };
  specification.paths['/jobs/{jobId}'].get.parameters.push({
    name: 'typedNullable',
    in: 'query',
    schema: { type: ['string', 'null'] }
  });
  const parsed = parseOpenApiSpec(specification);
  assert.deepEqual(parsed.operations.map(operation => operation.operationId), ['readNullableJob']);
  assert.deepEqual(parsed.diagnostics.map(item => item.operationId), ['createJob', 'brokenJob']);
  const querySchema = parsed.operations[0].parameters.query.properties;
  assert.deepEqual(querySchema.q.type, ['string', 'null']);
  assert.equal(querySchema.filter.properties.nested.type, 'object');
  assert.equal(querySchema.filter.properties.active.default, true);
  assert.equal(parsed.inventory.find(item => item.operationId === 'readNullableJob').parserStatus, 'supported');
  assert.equal(parsed.inventory.find(item => item.operationId === 'readNullableJob').responses['200'].content['application/json'].schema,
    '#/components/schemas/Filters');
});

test('OpenAPI fails closed on duplicate IDs and invalid structural path references', () => {
  const duplicate = structuredClone(jsonSpec);
  duplicate.paths['/jobs'].get.operationId = 'getJob';
  assert.throws(() => parseOpenApiSpec(duplicate), /duplicate operation ID/);
  const brokenPath = {
    openapi: '3.1.0',
    info: { title: 'Broken', version: '1' },
    paths: { '/bad': { $ref: '#/components/pathItems/Missing' } }
  };
  assert.throws(() => parseOpenApiSpec(brokenPath), /path item reference/);
});

test('conversation sessions are isolated by user, tenant, application, and assistant', () => {
  const sessions = new SessionManager({ ttlMs: 1000 });
  const owner = {
    userId: 'user-a',
    tenantId: 'tenant-a',
    applicationId: 'application-a',
    assistantId: 'candidate'
  };
  const session = sessions.getOrCreate(undefined, owner.assistantId, owner);
  assert.equal(session.applicationId, owner.applicationId);
  assert.equal(sessions.getOrCreate(session.id, owner.assistantId, owner), session);
  assert.throws(() => sessions.getOrCreate(session.id, 'client', owner), SessionOwnershipError);
  assert.throws(() => sessions.getOrCreate(session.id, owner.assistantId, {
    ...owner,
    applicationId: 'application-b'
  }), SessionOwnershipError);
  assert.throws(() => sessions.getOrCreate(session.id, owner.assistantId, {
    ...owner,
    userId: 'user-b'
  }), SessionOwnershipError);
  assert.throws(() => sessions.getOrCreate(session.id, owner.assistantId, {
    ...owner,
    tenantId: 'tenant-b'
  }), /tenant/);
  sessions.destroy(session.id, owner);
});

test('full saved HirePool OpenAPI inventory parses writes while executing only explicitly allowlisted reads', async () => {
  const specificationText = await readFile(new URL('./fixtures/hirepool-openapi.json', import.meta.url), 'utf8');
  const specification = parseOpenApiSpec(specificationText);
  const roles = {
    candidate: [
      'get_current_user_info_api_v1_auth_me_get',
      'get_my_profile_api_v1_candidates_profile_get',
      'search_jobs_api_v1_jobs_search_get',
      'get_my_applications_api_v1_applications_my_applications_get'
    ],
    client: [
      'get_my_user_profile_api_v1_clients_me_get',
      'get_dashboard_stats_api_v1_clients_dashboard_get',
      'get_my_jobs_api_v1_jobs_my_jobs_get'
    ],
    consultancy: [
      'get_my_user_profile_api_v1_consultancies_me_get',
      'get_placement_stats_api_v1_consultancies_placements_stats_get'
    ]
  };
  assert.equal(specification.inventory.length, 432);
  assert.equal(specification.inventory.filter(operation => operation.method === 'GET').length, 194);
  assert.ok(specification.operations.length > 194);
  assert.ok(specification.operations.some(operation =>
    operation.operationId === 'create_application_api_v1_applications_post' &&
    operation.method === 'POST' &&
    operation.requestBody?.required
  ));
  assert.ok(specification.diagnostics.some(operation => operation.method === 'DELETE'));
  for (const operationIds of Object.values(roles)) {
    for (const operationId of operationIds) {
      assert.ok(specification.operations.some(operation => operation.operationId === operationId), operationId);
    }
  }

  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'api.example.test,spec.example.test';
  registerDynamicApiIntegration({
    id: 'hirepool-fixture',
    assistantId: 'hirepool-fixture-assistant',
    applicationId: 'hirepool-fixture-app',
    openApiSpecUrl: 'https://spec.example.test/openapi.json',
    apiBaseUrl: 'https://api.example.test/api/v1/',
    allowedHosts: ['spec.example.test', 'api.example.test'],
    enabled: true,
    authenticationRequired: true,
    allowedOperationIds: Object.values(roles).flat(),
    roleOperationIds: roles,
    responseFields: Object.fromEntries(Object.values(roles).flat().map(operationId => [operationId, ['id']])),
    authorize: async user => user.applicationId === 'hirepool-fixture-app',
    getAuthHeaders: async user => ({ Authorization: `Bearer mock-${user.id}` })
  });

  let mockCalls = 0;
  for (const [role, operationIds] of Object.entries(roles)) {
    const user = { id: `${role}-fixture-user`, role, applicationId: 'hirepool-fixture-app' };
    const registry = await createRequestActionRegistry(
      'hirepool-fixture-assistant',
      user,
      new ActionRegistry(),
      { fetchSpec: async () => specificationText }
    );
    const actions = registry.list().filter(action => action.metadata?.dynamicApi);
    assert.deepEqual(actions.map(action => action.metadata.dynamicApi.operationId).sort(), [...operationIds].sort());
    for (const action of actions) {
      const args = sampleArguments(action.metadata.dynamicApi.parameterJsonSchema);
      await executeDynamicApiAction(action, args, user, {
        request: async (url, options) => {
          mockCalls++;
          assert.equal(new URL(url).origin, 'https://api.example.test');
          assert.equal(options.headers.Authorization, `Bearer mock-${user.id}`);
          return { id: action.metadata.dynamicApi.operationId, email: 'not-projected@example.test' };
        }
      });
    }
  }
  assert.equal(mockCalls, 9);
});

test('feature is disabled by default and always disabled in production', () => {
  assert.equal(isDynamicApiDiscoveryEnabled({}), false);
  assert.equal(isDynamicApiDiscoveryEnabled({
    DYNAMIC_API_DISCOVERY_ENABLED: 'true',
    NODE_ENV: 'production'
  }), false);
  assert.equal(isDynamicApiDiscoveryEnabled({
    DYNAMIC_API_DISCOVERY_ENABLED: 'true',
    VERCEL_ENV: 'production'
  }), false);
  assert.equal(isDynamicApiDiscoveryEnabled({
    DYNAMIC_API_DISCOVERY_ENABLED: 'true',
    NODE_ENV: 'test'
  }), true);
});

test('disabled and production configurations do not fetch or expose dynamic actions', async () => {
  registerTestIntegration();
  const base = new ActionRegistry();
  let fetchCount = 0;
  for (const env of [
    { DYNAMIC_API_DISCOVERY_ENABLED: 'false', NODE_ENV: 'test' },
    { DYNAMIC_API_DISCOVERY_ENABLED: 'true', NODE_ENV: 'production' },
    { DYNAMIC_API_DISCOVERY_ENABLED: 'true', VERCEL_ENV: 'production' }
  ]) {
    Object.assign(process.env, env);
    const registry = await createRequestActionRegistry(
      'jobs-assistant',
      { id: 'user-a', tenantId: 'tenant-a' },
      base,
      { fetchSpec: async () => { fetchCount++; return JSON.stringify(jsonSpec); } }
    );
    assert.equal(registry.list().some(item => item.metadata?.dynamicApi), false);
  }
  assert.equal(fetchCount, 0);
});

test('execution rechecks the feature flag and production gate', async () => {
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'api.example.test,spec.example.test';
  registerTestIntegration();
  const registry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'user-a', tenantId: 'tenant-a' },
    new ActionRegistry(),
    { fetchSpec: async () => JSON.stringify(jsonSpec) }
  );
  const action = registry.list().find(item => item.metadata?.dynamicApi);

  let requestCount = 0;
  for (const env of [
    { DYNAMIC_API_DISCOVERY_ENABLED: 'false', NODE_ENV: 'test' },
    { DYNAMIC_API_DISCOVERY_ENABLED: 'true', NODE_ENV: 'production' },
    { DYNAMIC_API_DISCOVERY_ENABLED: 'true', VERCEL_ENV: 'production' }
  ]) {
    Object.assign(process.env, env);
    await assert.rejects(() => executeDynamicApiAction(
      action,
      { path: { jobId: 'job-42' }, query: {} },
      { id: 'user-a', tenantId: 'tenant-a' },
      { request: async () => { requestCount++; return {}; } }
    ), /disabled/);
  }
  assert.equal(requestCount, 0);
});

test('registry compatibility preserves the default/custom tag and static actions', async () => {
  const defaultRegistry = new ActionRegistry();
  defaultRegistry.register({
    name: 'static_read',
    description: 'Read an existing static record',
    risk: 'read',
    requiresConfirmation: false
  });
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'false';
  const disabledRegistry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'user-a' },
    defaultRegistry
  );
  assert.equal(disabledRegistry, defaultRegistry);
  assert.equal(disabledRegistry.tag, 'action');
  assert.equal(disabledRegistry.has('static_read'), true);

  const customRegistry = new ActionRegistry({ tag: 'action:tenant', actions: defaultRegistry.list() });
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'api.example.test,spec.example.test';
  registerTestIntegration();
  const requestRegistry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'user-a', tenantId: 'tenant-a', applicationId: 'jobs-app', role: 'user' },
    customRegistry,
    { fetchSpec: async () => JSON.stringify(jsonSpec) }
  );
  assert.notEqual(requestRegistry, customRegistry);
  assert.equal(requestRegistry.tag, 'action:tenant');
  assert.equal(requestRegistry.has('static_read'), true);
  const dynamicAction = requestRegistry.list().find(action => action.metadata?.dynamicApi);
  assert.ok(dynamicAction);
  assert.equal(dynamicAction.metadata.dynamicApi.operationId, 'getJob');
  assert.equal(requestRegistry.list().some(action => action.metadata?.dynamicApi?.operationId === 'listJobs'), false);
  assert.match(requestRegistry.formatPromptGuidelines(undefined), /action:tenant/);

  const extracted = extractActionProposal(`\`\`\`action:tenant
{"id":"test-action","action":"static_read","title":"Read record","explanation":"Read it","parameters":{}}
\`\`\``, requestRegistry);
  assert.equal(extracted.action.action, 'static_read');
  const dispatch = await dispatchActionProposal(extracted.action, { actionRegistry: requestRegistry });
  assert.equal(dispatch.hostAction.action, 'static_read');
});

test('enabled request registries remain isolated while preserving static definitions', async () => {
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'api.example.test,spec.example.test';
  registerTestIntegration();
  const base = new ActionRegistry({ tag: 'action:isolated' });
  base.register({
    name: 'manual_action',
    description: 'A manually registered static action',
    risk: 'read',
    requiresConfirmation: false
  });
  const options = { fetchSpec: async () => JSON.stringify(jsonSpec) };
  const [first, second] = await Promise.all([
    createRequestActionRegistry('jobs-assistant', { id: 'one', tenantId: 'tenant-a', applicationId: 'jobs-app', role: 'user' }, base, options),
    createRequestActionRegistry('jobs-assistant', { id: 'two', tenantId: 'tenant-b', applicationId: 'jobs-app', role: 'user' }, base, options)
  ]);
  assert.notEqual(first, second);
  assert.notEqual(first, base);
  assert.notEqual(second, base);
  assert.equal(first.has('manual_action'), true);
  assert.equal(second.has('manual_action'), true);
  assert.equal(first.list().some(action => action.metadata?.dynamicApi), true);
  assert.equal(second.list().some(action => action.metadata?.dynamicApi), false);
  assert.equal(first.tag, 'action:isolated');
  assert.equal(second.tag, 'action:isolated');
  assert.equal(base.list().some(action => action.metadata?.dynamicApi), false);
});

test('integration and spec operation identifiers are restricted and generated names avoid slug collisions', () => {
  const invalidOperationIds = [' contains space', 'bad\nid', '__proto__', 'x'.repeat(101)];
  for (const operationId of invalidOperationIds) {
    assert.throws(() => registerDynamicApiIntegration({
      id: `integration-${invalidOperationIds.indexOf(operationId)}`,
      assistantId: 'jobs-assistant',
      applicationId: 'jobs-app',
      openApiSpecUrl: 'https://spec.example.test/openapi.json',
      apiBaseUrl: 'https://api.example.test/v1/',
      allowedOperationIds: [operationId],
      responseFields: Object.fromEntries([[operationId, ['id']]]),
      authorize: async () => true
    }), /operation ID/);
  }
  const invalidSpec = structuredClone(jsonSpec);
  invalidSpec.paths['/jobs'].get.operationId = 'bad operation id';
  assert.equal(parseOpenApiSpec(invalidSpec).operations.some(operation => operation.operationId === 'bad operation id'), false);

  const integrationBase = {
    id: `${'i'.repeat(42)}a`,
    allowedOperationIds: ['getJob'],
    roleOperationIds: { user: ['getJob'] },
    authenticationRequired: true,
    responseFields: { getJob: ['id'] },
    permissions: {},
    getAuthHeaders: async () => ({ Authorization: 'test-token' })
  };
  const specification = parseOpenApiSpec(jsonSpec);
  const firstName = createDynamicActions(integrationBase, specification)[0].name;
  const secondName = createDynamicActions({
    ...integrationBase,
    id: `${'i'.repeat(42)}b`
  }, specification)[0].name;
  assert.notEqual(firstName, secondName);
  assert.ok(firstName.length <= 64);
});

test('request-scoped discovery builds isolated, schema-validated read-only tools', async () => {
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'api.example.test,spec.example.test';
  registerTestIntegration();

  const base = new ActionRegistry();
  let discoveryOptions;
  const registry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'user-a', tenantId: 'tenant-a', applicationId: 'jobs-app', role: 'user', apiToken: 'server-token', scopes: ['jobs:read'] },
    base,
    {
      fetchSpec: async (url, options) => {
        discoveryOptions = { url: String(url), options };
        return JSON.stringify(jsonSpec);
      }
    }
  );
  const action = registry.list().find(item => item.metadata?.dynamicApi);

  assert.ok(action);
  assert.equal(action.risk, 'read');
  assert.equal(action.requiresConfirmation, false);
  assert.equal(registry.has(action.name), true);
  assert.equal(base.has(action.name), false);
  assert.equal(discoveryOptions.url, 'https://spec.example.test/openapi.json');
  assert.equal(discoveryOptions.options.maxBytes, 1024 * 1024);
  assert.deepEqual(discoveryOptions.options.headers, {});
  assert.deepEqual(parametersToJsonSchema(action), action.metadata.dynamicApi.parameterJsonSchema);
  assert.equal(hasActionPermissions(action, ['jobs:read']), true);
  assert.equal(hasActionPermissions(action, []), false);
  assert.match(registry.formatPromptGuidelines(undefined, ['jobs:read']), /jobId/);
  assert.equal(action.parameterSchema.safeParse({ path: { jobId: 'job-42' }, query: { limit: 6 } }).success, true);
  assert.equal(action.parameterSchema.safeParse({ path: { jobId: 'job-42' }, query: { limit: 50 } }).success, false);
  assert.equal(action.parameterSchema.safeParse({ path: { jobId: 'job-42', extra: 'x' } }).success, false);

  const request = {};
  const result = await executeDynamicApiAction(
    action,
    { path: { jobId: 'job 42' }, query: { limit: 6 } },
    { id: 'user-a', tenantId: 'tenant-a', applicationId: 'jobs-app', role: 'user', apiToken: 'server-token' },
    {
      request: async (url, options) => {
        request.url = String(url);
        request.options = options;
        return {
          id: 'job-42',
          status: 'open',
          email: 'not-allowed@example.test',
          items: [{ id: 'item-1', status: 'active', email: 'private@example.test' }]
        };
      }
    }
  );
  assert.equal(request.url, 'https://api.example.test/v1/jobs/job%2042?limit=6');
  assert.equal(request.options.headers.Authorization, 'Bearer server-token');
  assert.deepEqual(result, {
    id: 'job-42',
    status: 'open',
    items: [{ id: 'item-1', status: 'active' }]
  });

  let requestCount = 0;
  await assert.rejects(() => executeDynamicApiAction(
    action,
    { path: { jobId: '..' }, query: {} },
    { id: 'user-a', tenantId: 'tenant-a', applicationId: 'jobs-app', role: 'user', apiToken: 'server-token' },
    { request: async () => { requestCount++; return {}; } }
  ), /invalid/);
  const originalPath = action.metadata.dynamicApi.path;
  action.metadata.dynamicApi.path = '/https://other.example.test';
  await assert.rejects(() => executeDynamicApiAction(
    action,
    { path: { jobId: 'job-42' }, query: {} },
    { id: 'user-a', tenantId: 'tenant-a', applicationId: 'jobs-app', role: 'user', apiToken: 'server-token' },
    { request: async () => { requestCount++; return {}; } }
  ), /escaped/);
  action.metadata.dynamicApi.path = originalPath;
  assert.equal(requestCount, 0);
});

test('role and application bindings filter tools and are rechecked at execution', async () => {
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'api.example.test,spec.example.test';
  registerTestIntegration();
  assert.equal(getAssistantApplicationId('jobs-assistant'), 'jobs-app');

  const fetchSpec = async () => JSON.stringify(jsonSpec);
  const base = new ActionRegistry();
  const candidateRegistry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'candidate-a', role: 'candidate', applicationId: 'jobs-app', tenantId: 'tenant-a' },
    base,
    { fetchSpec }
  );
  assert.equal(candidateRegistry.list().filter(action => action.metadata?.dynamicApi).length, 1);

  const unknownRoleRegistry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'admin-a', role: 'super_admin', applicationId: 'jobs-app', tenantId: 'tenant-a' },
    base,
    { fetchSpec }
  );
  assert.equal(unknownRoleRegistry.list().some(action => action.metadata?.dynamicApi), false);

  const wrongApplicationRegistry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'candidate-b', role: 'candidate', applicationId: 'another-app', tenantId: 'tenant-a' },
    base,
    { fetchSpec }
  );
  assert.equal(wrongApplicationRegistry.list().some(action => action.metadata?.dynamicApi), false);

  const action = candidateRegistry.list().find(item => item.metadata?.dynamicApi);
  let requestCount = 0;
  await assert.rejects(() => executeDynamicApiAction(
    action,
    { path: { jobId: 'job-42' } },
    { id: 'candidate-a', role: 'candidate', applicationId: 'another-app', tenantId: 'tenant-a' },
    { request: async () => { requestCount++; return {}; } }
  ), /not authorized/);
  assert.equal(requestCount, 0);
});

test('authorization denial omits tools and blocks API execution', async () => {
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'api.example.test,spec.example.test';
  registerTestIntegration();

  let fetchCount = 0;
  const base = new ActionRegistry();
  const registry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'user-b', tenantId: 'tenant-b', applicationId: 'jobs-app', role: 'user' },
    base,
    { fetchSpec: async () => { fetchCount++; return JSON.stringify(jsonSpec); } }
  );
  assert.equal(fetchCount, 0);
  assert.equal(registry.list().some(item => item.metadata?.dynamicApi), false);

  const authorizedRegistry = await createRequestActionRegistry(
    'jobs-assistant',
    { id: 'user-a', tenantId: 'tenant-a', applicationId: 'jobs-app', role: 'user' },
    base,
    { fetchSpec: async () => JSON.stringify(jsonSpec) }
  );
  const action = authorizedRegistry.list().find(item => item.metadata?.dynamicApi);
  let requestCount = 0;
  await assert.rejects(() => executeDynamicApiAction(
    action,
    { path: { jobId: 'job-42' } },
    { id: 'user-b', tenantId: 'tenant-b', applicationId: 'jobs-app', role: 'user' },
    { request: async () => { requestCount++; return {}; } }
  ), /not authorized/);
  assert.equal(requestCount, 0);
});

test('discovery rejects unallowlisted hosts before fetching and does not mutate base registry', async () => {
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'allowed.example.test';
  registerTestIntegration();

  let fetchCount = 0;
  await assert.rejects(
    () => createRequestActionRegistry(
      'jobs-assistant',
      { id: 'user-a', tenantId: 'tenant-a', applicationId: 'jobs-app', role: 'user' },
      new ActionRegistry(),
      { fetchSpec: async () => { fetchCount++; return JSON.stringify(jsonSpec); } }
    ),
    /allowlist/
  );
  assert.equal(fetchCount, 0);
  assert.throws(() => validateApiUrl('http://api.example.test/openapi.json', new Set(['api.example.test'])));
  assert.throws(() => validateApiUrl('https://api.example.test/openapi.json', new Set()));
});

test('IP classification accepts public addresses and rejects special-use IPv4/IPv6 ranges', () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  for (const address of [
    '0.1.2.3',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.31.196.1',
    '192.52.193.1',
    '192.88.99.1',
    '192.168.1.1',
    '192.175.48.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '999.1.1.1'
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} must not be public`);
  }

  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true);
  for (const address of [
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '2001::1',
    '2001:db8::1',
    '2002::1',
    '3fff::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:8.8.8.8',
    '::ffff:0808:0808',
    'fe80::1%12',
    'invalid::address',
    '2001:4860:4860::gggg'
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} must not be public`);
  }
});

test('network timeout defaults and invalid values are explicit', () => {
  assert.deepEqual(getDynamicApiLimits({}), {
    timeoutMs: 5000,
    maxSpecBytes: 1024 * 1024
  });
  assert.throws(() => getDynamicApiLimits({ API_DISCOVERY_TIMEOUT_MS: '' }), /TIMEOUT_MS/);
  assert.throws(() => getDynamicApiLimits({ API_DISCOVERY_TIMEOUT_MS: '15001' }), /TIMEOUT_MS/);
  assert.throws(() => getDynamicApiLimits({ API_DISCOVERY_MAX_SPEC_BYTES: '1023' }), /MAX_SPEC_BYTES/);
  assert.throws(() => getDynamicApiLimits({ API_DISCOVERY_MAX_SPEC_BYTES: '5242881' }), /MAX_SPEC_BYTES/);
});

test('DNS timeout and cancellation prevent any outbound request', async () => {
  let resolveDns;
  let requestCount = 0;
  const pendingDns = new Promise(resolve => { resolveDns = resolve; });
  const timeoutStarted = Date.now();
  await assert.rejects(() => requestText('https://api.example.test/data', {
    allowedHosts: new Set(['api.example.test']),
    timeoutMs: 100,
    resolveAddress: () => pendingDns,
    requestFactory: () => { requestCount++; }
  }), /timed out/);
  assert.ok(Date.now() - timeoutStarted < 1000);
  resolveDns({ address: '8.8.8.8', family: 4 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestCount, 0);

  let resolveCancelledDns;
  const cancelledDns = new Promise(resolve => { resolveCancelledDns = resolve; });
  const controller = new AbortController();
  const cancelledRequest = requestText('https://api.example.test/data', {
    allowedHosts: new Set(['api.example.test']),
    timeoutMs: 2000,
    signal: controller.signal,
    resolveAddress: () => cancelledDns,
    requestFactory: () => { requestCount++; }
  });
  controller.abort();
  await assert.rejects(() => cancelledRequest, /aborted/);
  resolveCancelledDns({ address: '8.8.8.8', family: 4 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestCount, 0);
});

test('connection and overall request timeouts destroy the pending request', async () => {
  let requestDestroyed = false;
  const hangingRequestFactory = () => {
    const request = new EventEmitter();
    request.end = () => {};
    request.destroy = error => {
      requestDestroyed = true;
      if (error) request.emit('error', error);
    };
    return request;
  };
  await assert.rejects(() => requestText('https://api.example.test/data', {
    allowedHosts: new Set(['api.example.test']),
    timeoutMs: 100,
    resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
    requestFactory: hangingRequestFactory
  }), /timed out/);
  assert.equal(requestDestroyed, true);

  let overallRequestDestroyed = false;
  const overallRequestFactory = () => {
    const request = new EventEmitter();
    request.end = () => {};
    request.destroy = error => {
      overallRequestDestroyed = true;
      if (error) request.emit('error', error);
    };
    return request;
  };
  await assert.rejects(() => requestText('https://api.example.test/data', {
    allowedHosts: new Set(['api.example.test']),
    timeoutMs: 120,
    resolveAddress: () => new Promise(resolve => setTimeout(
      () => resolve({ address: '8.8.8.8', family: 4 }),
      60
    )),
    requestFactory: overallRequestFactory
  }), /timed out/);
  assert.equal(overallRequestDestroyed, true);
});

test('response timeout and cancellation destroy the response and release request resources', async () => {
  let responseForTimeout;
  let requestDestroyed = false;
  const hangingResponseFactory = (_options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      responseForTimeout = new Readable({ read() {} });
      responseForTimeout.statusCode = 200;
      responseForTimeout.headers = { 'content-type': 'application/json' };
      callback(responseForTimeout);
    };
    request.destroy = () => { requestDestroyed = true; };
    return request;
  };
  await assert.rejects(() => requestText('https://api.example.test/data', {
    allowedHosts: new Set(['api.example.test']),
    timeoutMs: 100,
    resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
    requestFactory: hangingResponseFactory
  }), /timed out/);
  assert.equal(responseForTimeout.destroyed, true);
  assert.equal(requestDestroyed, true);

  let responseForAbort;
  const controller = new AbortController();
  const abortingResponseFactory = (_options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      responseForAbort = new Readable({ read() {} });
      responseForAbort.statusCode = 200;
      responseForAbort.headers = { 'content-type': 'application/json' };
      callback(responseForAbort);
      setImmediate(() => controller.abort());
    };
    request.destroy = () => { requestDestroyed = true; };
    return request;
  };
  await assert.rejects(() => requestText('https://api.example.test/data', {
    allowedHosts: new Set(['api.example.test']),
    timeoutMs: 2000,
    signal: controller.signal,
    resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
    requestFactory: abortingResponseFactory
  }), /aborted/);
  assert.equal(responseForAbort.destroyed, true);
  assert.equal(requestDestroyed, true);
});

test('secure HTTP retains DNS pinning and rejects redirects, oversized and non-JSON API responses', async () => {
  let requestCount = 0;

  await assert.rejects(
    () => requestText('https://api.example.test/openapi.json', {
      allowedHosts: new Set(['api.example.test']),
      resolveAddress: async () => { throw new Error('Dynamic API host resolves to a non-public address'); },
      requestFactory: () => { requestCount++; }
    }),
    /non-public/
  );
  assert.equal(requestCount, 0);

  const options = {
    allowedHosts: new Set(['api.example.test']),
    resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
    timeoutMs: 200,
    maxBytes: 10,
    requestFactory: createMockRequestFactory({ statusCode: 302 })
  };
  await assert.rejects(() => requestJson('https://api.example.test/data', options), /HTTP 302/);

  let pinnedAddress;
  const yamlText = await requestText('https://api.example.test/openapi.yaml', {
    ...options,
    allowYaml: true,
    maxBytes: 100,
    requestFactory: (requestOptions, callback) => {
      requestOptions.lookup('api.example.test', {}, (_error, address) => {
        pinnedAddress = address;
      });
      return createMockRequestFactory({
        contentType: 'application/yaml',
        body: 'openapi: 3.0.3'
      })(requestOptions, callback);
    }
  });
  assert.equal(yamlText, 'openapi: 3.0.3');
  assert.equal(pinnedAddress, '8.8.8.8');

  await assert.rejects(() => requestJson('https://api.example.test/data', {
    ...options,
    requestFactory: createMockRequestFactory({ body: '{"oversized":true}' })
  }), /size limit/);

  await assert.rejects(() => requestJson('https://api.example.test/data', {
    ...options,
    maxBytes: 100,
    requestFactory: createMockRequestFactory({ contentType: 'text/html' })
  }), /content type/);
});

test('chat instructions include action guidance even without host context or documents', () => {
  const registry = new ActionRegistry({
    actions: [{
      name: 'read_job',
      description: 'Read a job',
      risk: 'read',
      requiresConfirmation: false
    }]
  });
  const instruction = buildSystemInstruction('Base instruction', null, registry);
  assert.match(instruction, /Allowed Actions/);
  assert.match(instruction, /read_job/);
});
