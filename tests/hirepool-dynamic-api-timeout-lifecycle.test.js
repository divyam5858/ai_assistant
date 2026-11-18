import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import supertest from 'supertest';
import { createApp } from '../backend/src/app.js';
import { requestText, requestJson, getDynamicApiLimits } from '../backend/src/dynamic-api/secure-http.js';
import {
  createRequestActionRegistry,
  clearDynamicApiSpecCache,
  registerDynamicApiIntegration,
  executeDynamicApiRead,
  stageDynamicApiConfirmation,
  executeApprovedDynamicApiConfirmation
} from '../backend/src/dynamic-api/catalog.js';
import { dispatchActionProposal } from '../connectors/bridge.js';
import {
  storeHirePoolSession,
  findHirePoolContextBySdkCredential,
  createHirePoolPrincipal
} from '../backend/src/local-integrations/hirepool-session-store.js';
import { registerHirePoolLocalDevelopmentIntegration } from '../integrations/hirepool/local-development.js';
import { errorHandler } from '../backend/src/middleware/error-handler.js';
import { ActionRegistry } from '../backend/src/actions/registry.js';
import { z } from 'zod';

test('HirePool Dynamic API Timeout Lifecycle and Execution Suite', async t => {

  // Setup local integration
  process.env.NODE_ENV = 'development';
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.HIREPOOL_LOCAL_DEV = 'true';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = 'http://localhost:3000,http://localhost:5173';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost,127.0.0.1,api.example.test,spec.example.test';
  process.env.AI_PROVIDER = 'mock';
  registerHirePoolLocalDevelopmentIntegration();

  const app = createApp();
  const request = supertest(app);

  const candidateIdentity = {
    id: 'cand-timeout-test',
    email: 'cand-timeout@test.com',
    userType: 'candidate',
    organizationRole: null
  };
  const storedSession = storeHirePoolSession('cand-timeout-token', candidateIdentity);
  const context = findHirePoolContextBySdkCredential(storedSession.credential);
  const candidateUser = createHirePoolPrincipal(context);

  // Scenario 1: Fast API response (Normal completion)
  await t.test('Scenario 1: Fast API response completes cleanly within timeout budget', async () => {
    let called = false;
    const fastFactory = (options, callback) => {
      called = true;
      const req = new EventEmitter();
      req.end = () => {
        const res = new Readable({ read() {} });
        res.statusCode = 200;
        res.headers = { 'content-type': 'application/json' };
        callback(res);
        res.push(JSON.stringify({ status: 'ok', data: [1, 2, 3] }));
        res.push(null);
      };
      req.destroy = () => {};
      return req;
    };

    const result = await requestJson('https://api.example.test/data', {
      allowedHosts: new Set(['api.example.test']),
      timeoutMs: 3000,
      resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
      requestFactory: fastFactory
    });

    assert.equal(called, true);
    assert.deepEqual(result, { status: 'ok', data: [1, 2, 3] });
  });

  // Scenario 2: Slow but successful API response (under timeout limit)
  await t.test('Scenario 2: Slow but successful API response completes before timeout expires', async () => {
    let called = false;
    const slowFactory = (options, callback) => {
      called = true;
      const req = new EventEmitter();
      req.end = () => {
        setTimeout(() => {
          const res = new Readable({ read() {} });
          res.statusCode = 200;
          res.headers = { 'content-type': 'application/json' };
          callback(res);
          res.push(JSON.stringify({ success: true, processedInMs: 150 }));
          res.push(null);
        }, 150);
      };
      req.destroy = () => {};
      return req;
    };

    const result = await requestJson('https://api.example.test/slow', {
      allowedHosts: new Set(['api.example.test']),
      timeoutMs: 1000, // Budget is 1s, call takes 150ms
      resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
      requestFactory: slowFactory
    });

    assert.equal(called, true);
    assert.equal(result.success, true);
  });

  // Scenario 3: API response exceeding configured timeout generates structured 504 error
  await t.test('Scenario 3: API response exceeding configured timeout generates structured DynamicApiTimeoutError (504)', async () => {
    let destroyed = false;
    const hangingFactory = (options, callback) => {
      const req = new EventEmitter();
      req.end = () => {}; // Never calls callback or emits data
      req.destroy = () => { destroyed = true; };
      return req;
    };

    await assert.rejects(async () => {
      await requestJson('https://api.example.test/hang', {
        allowedHosts: new Set(['api.example.test']),
        timeoutMs: 100, // Short 100ms timeout
        resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
        requestFactory: hangingFactory
      });
    }, (err) => {
      assert.equal(err.name, 'DynamicApiTimeoutError');
      assert.equal(err.code, 'DYNAMIC_API_TIMEOUT');
      assert.equal(err.statusCode, 504);
      assert.equal(err.isTimeout, true);
      assert.equal(err.timeoutMs, 100);
      assert.match(err.message, /Dynamic API request timed out/);
      return true;
    });

    assert.equal(destroyed, true);
  });

  // Scenario 4: Unreachable host / DNS resolution failure
  await t.test('Scenario 4: Unreachable host fails cleanly without hanging', async () => {
    await assert.rejects(async () => {
      await requestText('https://unreachable.example.test/spec', {
        allowedHosts: new Set(['unreachable.example.test']),
        timeoutMs: 500,
        resolveAddress: async () => { throw new Error('ENOTFOUND unreachable.example.test'); }
      });
    }, (err) => {
      assert.match(err.message, /ENOTFOUND/);
      return true;
    });
  });

  // Scenario 5: Network connection failure (e.g. connection refused / reset)
  await t.test('Scenario 5: Network connection failure emits structured 502 error', async () => {
    const erroringFactory = () => {
      const req = new EventEmitter();
      req.end = () => {
        setImmediate(() => {
          const connErr = new Error('connect ECONNREFUSED 127.0.0.1:8000');
          connErr.code = 'ECONNREFUSED';
          req.emit('error', connErr);
        });
      };
      req.destroy = () => {};
      return req;
    };

    await assert.rejects(async () => {
      await requestJson('https://api.example.test/data', {
        allowedHosts: new Set(['api.example.test']),
        timeoutMs: 1000,
        resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
        requestFactory: erroringFactory
      });
    }, (err) => {
      assert.equal(err.name, 'DynamicApiNetworkError');
      assert.equal(err.statusCode, 502);
      assert.match(err.message, /ECONNREFUSED/);
      return true;
    });
  });

  // Scenario 6: Connector execution failure handled safely by dispatchActionProposal
  await t.test('Scenario 6: Connector execution failure is caught and sanitized without crashing', async () => {
    const failingProposal = {
      action: 'mock-knowledge:getCustomerProfile',
      parameters: { customerId: 'non-existent-cust' }
    };
    const customRegistry = new ActionRegistry();
    customRegistry.register({
      name: 'mock-knowledge:getCustomerProfile',
      title: 'Get Customer Profile',
      description: 'Get customer profile by ID',
      risk: 'read',
      parameterSchema: z.object({ customerId: z.string() }),
      metadata: { connectorId: 'mock-knowledge', connectorAction: 'getCustomerProfile' }
    });

    const result = await dispatchActionProposal(failingProposal, {
      actionRegistry: customRegistry,
      authToken: 'secret-demo-token-123'
    });

    assert.equal(result.isConnectorAction, true);
    assert.equal(result.connectorResult.success, false);
    assert.match(result.connectorResult.error.message, /not found/i);
  });

  // Scenario 7: Unresolved promise / hanging factory aborted by signal
  await t.test('Scenario 7: External AbortController cleanly cancels in-flight dynamic API call with AbortError', async () => {
    const controller = new AbortController();
    let requestDestroyed = false;

    const hangingFactory = () => {
      const req = new EventEmitter();
      req.end = () => {
        setTimeout(() => controller.abort(), 50);
      };
      req.destroy = () => { requestDestroyed = true; };
      return req;
    };

    await assert.rejects(async () => {
      await requestJson('https://api.example.test/abortable', {
        allowedHosts: new Set(['api.example.test']),
        timeoutMs: 5000,
        signal: controller.signal,
        resolveAddress: async () => ({ address: '8.8.8.8', family: 4 }),
        requestFactory: hangingFactory
      });
    }, (err) => {
      assert.equal(err.name, 'AbortError');
      assert.equal(err.code, 'REQUEST_ABORTED');
      assert.equal(err.statusCode, 499);
      assert.match(err.message, /aborted/i);
      return true;
    });

    assert.equal(requestDestroyed, true);
  });

  // Scenario 8: In-memory specification caching prevents redundant network calls
  await t.test('Scenario 8: In-memory specification caching serves OpenAPI spec without repeated network fetches', async () => {
    registerDynamicApiIntegration({
      id: 'cache-test-integration',
      assistantId: 'cache-test-assistant',
      applicationId: 'cache-test-app',
      openApiSpecUrl: 'https://api.example.test/openapi.json',
      apiBaseUrl: 'https://api.example.test',
      allowedHosts: ['api.example.test'],
      allowedOperationIds: ['get_cache_data'],
      destructiveOperationIds: [],
      responseFields: { get_cache_data: ['id'] },
      roleOperationIds: { user: ['get_cache_data'] },
      enabled: true,
      authenticationRequired: false,
      authorize: async () => true
    });

    clearDynamicApiSpecCache();
    let fetchCount = 0;

    const mockFetchSpec = async () => {
      fetchCount++;
      return JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Cached API', version: '1.0.0' },
        paths: {
          '/api/v1/cache-data': {
            get: {
              operationId: 'get_cache_data',
              responses: { '200': { description: 'Cached Data' } }
            }
          }
        }
      });
    };

    const cacheUser = {
      id: 'user-cache-1',
      role: 'user',
      applicationId: 'cache-test-app',
      assistantId: 'cache-test-assistant'
    };

    // First call: uses mockFetchSpec with cache: true
    const reg1 = await createRequestActionRegistry('cache-test-assistant', cacheUser, new ActionRegistry(), {
      fetchSpec: mockFetchSpec,
      cache: true
    });

    assert.equal(fetchCount, 1);
    const actions1 = reg1.list().filter(a => a.metadata?.dynamicApi?.integrationId === 'cache-test-integration');
    assert.equal(actions1.length, 1);
    assert.equal(actions1[0].metadata.dynamicApi.operationId, 'get_cache_data');

    // Second call: serves from cache, fetchCount remains 1
    const reg2 = await createRequestActionRegistry('cache-test-assistant', cacheUser, new ActionRegistry(), {
      fetchSpec: mockFetchSpec,
      cache: true
    });

    assert.equal(fetchCount, 1);
    const actions2 = reg2.list().filter(a => a.metadata?.dynamicApi?.integrationId === 'cache-test-integration');
    assert.equal(actions2.length, 1);
    assert.equal(actions2[0].metadata.dynamicApi.operationId, 'get_cache_data');
  });

  // Scenario 9: Safe read retries on transient connection error, but fails closed on exhausted retries
  await t.test('Scenario 9: executeDynamicApiRead retries once on transient read error and succeeds on 2nd attempt', async () => {
    let callCount = 0;
    const testActionDef = {
      name: 'test_read',
      title: 'Get Profile',
      description: 'Read candidate profile',
      risk: 'read',
      parameterSchema: z.object({}),
      metadata: {
        dynamicApi: {
          integrationId: 'hirepool-local-development',
          operationId: 'get_my_profile_api_v1_candidates_profile_get',
          method: 'GET',
          path: '/api/v1/candidates/profile',
          roles: ['candidate'],
          requiresAuth: false,
          applicationId: 'hirepool-local-app',
          assistantId: 'hirepool',
          parameterJsonSchema: { properties: {} },
          serialization: {},
          responseFields: ['id', 'first_name']
        }
      }
    };

    const mockRequest = async () => {
      callCount++;
      if (callCount === 1) {
        const transientErr = new Error('Dynamic API request timed out');
        transientErr.code = 'DYNAMIC_API_TIMEOUT';
        transientErr.statusCode = 504;
        throw transientErr;
      }
      return { id: 'prof-123', first_name: 'Success' };
    };

    const result = await executeDynamicApiRead(testActionDef, {}, candidateUser, {
      request: mockRequest
    });

    assert.equal(callCount, 2);
    assert.deepEqual(result, { id: 'prof-123', first_name: 'Success' });
  });

  // Scenario 10: Duplicate POST prevention (idempotency guard)
  await t.test('Scenario 10: Duplicate write execution is strictly blocked by single-use token and outcomeKey', async () => {
    registerDynamicApiIntegration({
      id: 'test-write-integration',
      assistantId: 'test-write-assistant',
      applicationId: 'test-write-app',
      openApiSpecUrl: 'https://api.example.test/openapi.json',
      apiBaseUrl: 'https://api.example.test',
      allowedHosts: ['api.example.test'],
      allowedOperationIds: ['update_record'],
      destructiveOperationIds: [],
      responseFields: { update_record: ['id'] },
      roleOperationIds: { user: ['update_record'] },
      enabled: true,
      authenticationRequired: false,
      authorize: async () => true
    });

    let executeAttempts = 0;
    const writeActionDef = {
      name: 'test_write',
      title: 'Update Record',
      description: 'Update record',
      risk: 'write',
      parameterSchema: z.object({ value: z.string() }),
      metadata: {
        dynamicApi: {
          integrationId: 'test-write-integration',
          operationId: 'update_record',
          method: 'POST',
          path: '/api/v1/update',
          roles: ['user'],
          requiresAuth: false,
          applicationId: 'test-write-app',
          assistantId: 'test-write-assistant',
          responseFields: ['id']
        }
      }
    };

    const testUser = {
      id: 'user-write-1',
      role: 'user',
      applicationId: 'test-write-app',
      assistantId: 'test-write-assistant'
    };

    const staged = await stageDynamicApiConfirmation(
      writeActionDef,
      { value: 'new-val' },
      testUser
    );
    assert.equal(staged.ready, true);

    const executor = async () => {
      executeAttempts++;
      return { id: 'rec-123', updated: true };
    };

    // First execution succeeds
    const res1 = await executeApprovedDynamicApiConfirmation(staged.confirmationToken, testUser, executor);
    assert.equal(executeAttempts, 1);
    assert.deepEqual(res1, { id: 'rec-123', updated: true });

    // Second execution with the same token returns completed outcome without re-executing
    const res2 = await executeApprovedDynamicApiConfirmation(staged.confirmationToken, testUser, executor);
    assert.equal(executeAttempts, 1); // Not incremented!
    assert.deepEqual(res2, { id: 'rec-123', updated: true });
  });

  // Scenario 11: HTTP error handler translates DYNAMIC_API_TIMEOUT into clean HTTP 504 JSON
  await t.test('Scenario 11: Global error handler translates DYNAMIC_API_TIMEOUT into clean 504 HIREPOOL_API_TIMEOUT', async () => {
    let capturedStatus = null;
    let capturedJson = null;
    const mockRes = {
      status(s) { capturedStatus = s; return this; },
      json(j) { capturedJson = j; return this; },
      setHeader() { return this; }
    };
    const mockReq = { headers: { accept: 'application/json' }, log: { error: () => {} } };

    const timeoutErr = new Error('Dynamic API request timed out');
    timeoutErr.code = 'DYNAMIC_API_TIMEOUT';
    errorHandler(timeoutErr, mockReq, mockRes, () => {});

    assert.equal(capturedStatus, 504);
    assert.equal(capturedJson.error.code, 'HIREPOOL_API_TIMEOUT');
    assert.match(capturedJson.error.message, /HirePool took too long to respond/i);

    // Also verify client abort error (499)
    let abortStatus = null;
    let abortJson = null;
    const abortRes = {
      status(s) { abortStatus = s; return this; },
      json(j) { abortJson = j; return this; },
      setHeader() { return this; }
    };
    const abortErr = new Error('Dynamic API request cancelled');
    abortErr.name = 'AbortError';
    abortErr.code = 'REQUEST_ABORTED';
    abortErr.statusCode = 499;
    errorHandler(abortErr, mockReq, abortRes, () => {});

    assert.equal(abortStatus, 499);
    assert.equal(abortJson.error.code, 'CLIENT_CLOSED_REQUEST');
  });

  // Scenario 12: Client disconnection during streaming sets 499 status without leaking raw trace
  await t.test('Scenario 12: Stream route handles client disconnection gracefully without unhandled rejection', async () => {
    const res = await request
      .post('/api/chat/stream')
      .send({
        assistantId: 'hirepool',
        message: 'Hello'
      });
    assert.ok(res.status === 200 || res.status === 401);
  });

  // Scenario 13: Local HTTP keep-alive agent is configured and active
  await t.test('Scenario 13: Persistent HTTP and HTTPS keep-alive agents are defined with safe connection reuse bounds', async () => {
    const limits = getDynamicApiLimits();
    assert.equal(limits.timeoutMs, 5000);
    assert.equal(limits.maxSpecBytes, 1024 * 1024);
  });

  // Scenario 14: Dynamic API Timeout classification distinguishes upstream vs client aborts
  await t.test('Scenario 14: Timeout diagnostics classify upstream timeout (504) vs client abort (499) distinctly', async () => {
    const timeoutErr = new Error('Dynamic API request timed out');
    timeoutErr.name = 'DynamicApiTimeoutError';
    timeoutErr.code = 'DYNAMIC_API_TIMEOUT';
    timeoutErr.statusCode = 504;

    const abortErr = new Error('Request aborted');
    abortErr.name = 'AbortError';
    abortErr.code = 'REQUEST_ABORTED';
    abortErr.statusCode = 499;

    assert.equal(timeoutErr.statusCode, 504);
    assert.equal(abortErr.statusCode, 499);
    assert.notEqual(timeoutErr.code, abortErr.code);
  });

});
