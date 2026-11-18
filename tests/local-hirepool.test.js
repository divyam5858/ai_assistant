import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { afterEach, test } from 'node:test';
import request from 'supertest';
import { ActionRegistry } from '../backend/src/actions/registry.js';
import { createApp } from '../backend/src/app.js';
import { signJwt } from '../backend/src/middleware/auth.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import {
  executeCandidateMatchingWorkflow,
  executeCandidateApplicationHistoryWorkflow,
  executeCachedDynamicRead,
  finalizeHirePoolResponse,
  formatApplicationHistory,
  formatHirePoolReadResults,
  resolveHirePoolCandidateFollowup
} from '../backend/src/routes/chat.js';
import {
  clearDynamicApiIntegrations,
  createRequestActionRegistry,
  executeDynamicApiAction,
  getDynamicApiIntegration,
  stageDynamicApiConfirmation,
  cancelDynamicApiConfirmation,
  executeApprovedDynamicApiConfirmation
} from '../backend/src/dynamic-api/catalog.js';
import { validateApiUrl, requestText } from '../backend/src/dynamic-api/secure-http.js';
import {
  authenticateHirePoolLocalCredential,
  isHirePoolLocalBridgeEnabled
} from '../backend/src/local-integrations/hirepool-auth.js';
import {
  findHirePoolContextBySdkCredential,
  getHirePoolApiAccessToken,
  getHirePoolSessionTtlMs,
  storeHirePoolSession
} from '../backend/src/local-integrations/hirepool-session-store.js';
import {
  createHirePoolContinuation
} from '../backend/src/local-integrations/hirepool-continuation-store.js';
import { sessionManager } from '../backend/src/session-manager.js';
import { createSessionOptions } from '../backend/src/session-scope.js';
import {
  getHirePoolLoginUrl,
  getHirePoolAccountUrl,
  isHirePoolAccountWindow,
  clearHirePoolAccountWindow,
  openHirePoolLogin
} from '../widget/src/hirepool-login.js';
import {
  HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS,
  isHirePoolLocalPublicSiteUrl,
  isHirePoolPublicSiteUrl,
} from '../config/hirepool-site-policy.js';
import { HIREPOOL_LOCAL_EXTENSION_ORIGIN } from '../extension/hirepool/site-policy.js';
import {
  HIREPOOL_LOCAL_INTEGRATION_ID,
  registerHirePoolLocalDevelopmentIntegration
} from '../integrations/hirepool/local-development.js';
import { executeAndVerifyProfileUpdate } from '../backend/src/routes/dynamic-api-confirmation.js';

const environmentKeys = [
  'NODE_ENV',
  'AUTH_MODE',
  'AUTH_REQUIRED',
  'JWT_SECRET',
  'VERCEL_ENV',
  'DYNAMIC_API_DISCOVERY_ENABLED',
  'API_DISCOVERY_ALLOWED_HOSTS',
  'ENABLE_HIREPOOL_LOCAL_BRIDGE',
  'HIREPOOL_LOCAL_API_BASE_URL',
  'HIREPOOL_LOCAL_OPENAPI_URL',
  'HIREPOOL_LOCAL_ALLOWED_ORIGINS',
  'CORS_ALLOWED_ORIGINS'
];
const originalEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));

function configureLocalIntegration() {
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS =
    `http://localhost:3001,http://localhost:5173,${HIREPOOL_LOCAL_EXTENSION_ORIGIN}`;
  process.env.CORS_ALLOWED_ORIGINS =
    `http://localhost:3001,http://localhost:5173,${HIREPOOL_LOCAL_EXTENSION_ORIGIN}`;
}

function configureDisabledBridge() {
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
  delete process.env.DYNAMIC_API_DISCOVERY_ENABLED;
  delete process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE;
  delete process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS;
  delete process.env.CORS_ALLOWED_ORIGINS;
}

afterEach(() => {
  clearDynamicApiIntegrations();
  setAIProvider(null);
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('local bridge and HTTP transport require explicit non-production local configuration', () => {
  configureLocalIntegration();
  assert.equal(isHirePoolLocalBridgeEnabled(), true);
  assert.equal(
    validateApiUrl('http://localhost:8000/api/openapi.json', new Set(['localhost']), {
      allowLocalDevelopment: true,
      allowedPorts: [8000]
    }).hostname,
    'localhost'
  );
  assert.throws(() => validateApiUrl(
    'http://127.0.0.1:8000/api/openapi.json',
    new Set(['localhost']),
    { allowLocalDevelopment: true, allowedPorts: [8000] }
  ));
  assert.throws(() => validateApiUrl(
    'http://localhost:8001/api/openapi.json',
    new Set(['localhost']),
    { allowLocalDevelopment: true, allowedPorts: [8000] }
  ));
  process.env.NODE_ENV = 'production';
  assert.equal(isHirePoolLocalBridgeEnabled(), false);
  assert.throws(() => registerHirePoolLocalDevelopmentIntegration(), /explicit local development flags/);
});

test('HirePool public-site policy rejects dashboard origins and unapproved paths', () => {
  assert.equal(isHirePoolLocalPublicSiteUrl('http://localhost:3001/'), true);
  assert.equal(isHirePoolLocalPublicSiteUrl('http://127.0.0.1:3000/features?utm_source=local'), true);
  assert.equal(isHirePoolLocalPublicSiteUrl('http://localhost:5173/'), false);
  assert.equal(isHirePoolLocalPublicSiteUrl('http://localhost:3001/dashboard'), false);
  assert.equal(isHirePoolLocalPublicSiteUrl('https://localhost:3001/'), false);
  assert.equal(isHirePoolPublicSiteUrl('https://hirepool.ai/'), true);
  assert.equal(isHirePoolPublicSiteUrl('https://hirepool.ai/contact'), true);
  assert.equal(isHirePoolPublicSiteUrl('https://hirepool.ai/dashboard'), false);
  assert.equal(isHirePoolPublicSiteUrl('https://www.hirepool.ai/'), false);
  assert.equal(isHirePoolPublicSiteUrl('http://localhost:5173/'), false);
});

test('HirePool account navigation uses separate existing routes and preserves the opener', () => {
  assert.equal(getHirePoolLoginUrl('https://hirepool.ai/'), 'https://app.hirepool.ai/login');
  assert.equal(getHirePoolLoginUrl('https://hirepool.ai/features'), 'https://app.hirepool.ai/login');
  assert.equal(
    getHirePoolLoginUrl('http://localhost:3001/features'),
    'http://localhost:5173/login?assistant_origin=http%3A%2F%2Flocalhost%3A3001'
  );
  assert.equal(
    getHirePoolAccountUrl('http://127.0.0.1:3000/', 'hirepool_signup'),
    'http://localhost:5173/register?assistant_origin=http%3A%2F%2F127.0.0.1%3A3000'
  );
  assert.equal(getHirePoolAccountUrl('https://hirepool.ai/', 'hirepool_signup'), 'https://app.hirepool.ai/register');
  assert.throws(() => getHirePoolAccountUrl('http://localhost:3001/', 'unknown'), /Unsupported HirePool account action/);
  assert.throws(
    () => getHirePoolLoginUrl('https://app.hirepool.ai/login'),
    /approved public website page/
  );

  let openedUrl;
  const fakeWindow = {
    opener: {},
    location: {
      replace(url) {
        openedUrl = url;
      }
    }
  };
  const result = openHirePoolLogin({
    currentUrl: 'https://hirepool.ai/',
    openWindow: (...args) => {
      assert.deepEqual(args, ['about:blank', '_blank']);
      return fakeWindow;
    }
  });
  assert.equal(openedUrl, 'https://app.hirepool.ai/login');
  assert.deepEqual(fakeWindow.opener, {});
  assert.equal(isHirePoolAccountWindow(fakeWindow), true);
  assert.match(result.message, /conversation will remain open/);
  assert.equal(result.message.includes('https://app.hirepool.ai'), false);
  assert.throws(
    () => openHirePoolLogin({
      currentUrl: 'https://hirepool.ai/',
      openWindow: () => null
    }),
    /blocked by the browser/
  );

  const failedWindow = {
    opener: {},
    closed: false,
    location: {
      replace() {
        throw new Error('Navigation failed');
      }
    },
    close() {
      this.closed = true;
    }
  };
  assert.throws(
    () => openHirePoolLogin({
      currentUrl: 'http://localhost:3001/',
      openWindow: () => failedWindow
    }),
    /Navigation failed/
  );
  assert.equal(failedWindow.closed, true);
  clearHirePoolAccountWindow();
});

test('HirePool extension identity and content-script hosts match the bridge policy', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../extension/hirepool/manifest.json', import.meta.url),
    'utf8'
  ));
  const digest = createHash('sha256')
    .update(Buffer.from(manifest.key, 'base64'))
    .digest();
  const extensionId = [...digest.subarray(0, 16)]
    .map(byte => [byte >> 4, byte & 15].map(nibble => String.fromCharCode(97 + nibble)).join(''))
    .join('');
  assert.equal(`chrome-extension://${extensionId}`, HIREPOOL_LOCAL_EXTENSION_ORIGIN);
  assert.deepEqual(
    manifest.content_scripts[0].matches,
    HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS.map(origin => `${origin}/*`)
  );
  assert.equal(manifest.content_scripts[0].matches.includes('http://localhost:5173/*'), false);
});

test('local HTTP request pins localhost to loopback and retains response bounds', async () => {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.headers = { 'content-type': 'application/json' };
  response.destroy = () => {};
  response.resume = () => {};
  const request = new EventEmitter();
  request.end = () => {
    queueMicrotask(() => {
      response.emit('data', Buffer.from('{"openapi":"3.1.0"}'));
      response.emit('end');
    });
  };
  request.destroy = () => {};
  let observedOptions;
  const result = await requestText('http://localhost:8000/api/openapi.json', {
    allowedHosts: new Set(['localhost']),
    allowLocalDevelopment: true,
    allowedPorts: [8000],
    timeoutMs: 1000,
    maxBytes: 1024,
    requestFactory: (options, callback) => {
      observedOptions = options;
      queueMicrotask(() => callback(response));
      return request;
    }
  });
  assert.equal(result, '{"openapi":"3.1.0"}');
  assert.equal(observedOptions.hostname, '127.0.0.1');
  assert.equal(observedOptions.protocol, 'http:');
  assert.equal(observedOptions.port, '8000');
  assert.equal(observedOptions.headers.Host, 'localhost:8000');
});

test('opaque local session credentials bind a verified role without returning raw host tokens', () => {
  configureLocalIntegration();
  const accessToken = `dashboard-exchange-test-token-${Date.now()}`;
  const issued = storeHirePoolSession(accessToken, {
    id: 'test-user',
    userType: 'candidate',
    organizationRole: null
  });
  assert.notEqual(issued.credential, accessToken);
  assert.equal(typeof issued.sessionScope, 'string');
  assert.equal(authenticateHirePoolLocalCredential(issued.credential).role, 'candidate');
  assert.equal(getHirePoolApiAccessToken(authenticateHirePoolLocalCredential(issued.credential)), accessToken);
  assert.equal(findHirePoolContextBySdkCredential(accessToken), null);
});

test('expired HirePool credentials are rejected and same-user reauthentication retains the conversation', () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const now = Date.now();
  const identity = {
    id: 'reauth-candidate',
    email: 'reauth@example.test',
    userType: 'candidate',
    organizationRole: null
  };
  const expiredSession = storeHirePoolSession('expired-host-token', identity, now, now);
  const sessionTtl = getHirePoolSessionTtlMs();
  const conversationId = `same-user-reauth-${now}`;
  const oldUser = authenticateHirePoolLocalCredential(expiredSession.credential);
  const oldOptions = createSessionOptions(oldUser, 'hirepool');
  sessionManager.getOrCreate(conversationId, 'hirepool', oldOptions);
  sessionManager.addMessage(conversationId, 'assistant', 'Ranked shortlist: Software Engineer.', oldOptions);
  assert.ok(findHirePoolContextBySdkCredential(expiredSession.credential, now + sessionTtl - 1));
  assert.equal(findHirePoolContextBySdkCredential(expiredSession.credential, now + sessionTtl), null);

  const renewedSession = storeHirePoolSession(
    'renewed-host-token',
    identity,
    now + sessionTtl + 1,
    now + sessionTtl + 1
  );
  assert.notEqual(renewedSession.credential, expiredSession.credential);
  const renewedUser = authenticateHirePoolLocalCredential(renewedSession.credential);
  const renewedOptions = createSessionOptions(renewedUser, 'hirepool');
  sessionManager.getOrCreate(conversationId, 'hirepool', renewedOptions);
  assert.deepEqual(sessionManager.getContextMessages(conversationId, renewedOptions), [{
    role: 'assistant',
    content: 'Ranked shortlist: Software Engineer.'
  }]);
});

test('bridge validates organization roles against the matching HirePool account type', async () => {
  configureLocalIntegration();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  const originalFetch = globalThis.fetch;
  let identityUserType = 'client';
  let membershipRole = '';
  globalThis.fetch = async url => {
    const pathname = url.pathname;
    if (pathname === '/api/v1/auth/me') {
      return new Response(JSON.stringify({
        id: `test-${identityUserType}-user`,
        email: `${identityUserType}@example.test`,
        user_type: identityUserType,
        is_active: true,
        is_verified: true
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (pathname === '/api/v1/clients/me' || pathname === '/api/v1/consultancies/me') {
      return new Response(JSON.stringify({ role: membershipRole }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected HirePool identity URL: ${pathname}`);
  };

  try {
    const app = createApp();
    for (const [userType, role] of [['client', 'hiring_manager'], ['consultancy', 'member']]) {
      identityUserType = userType;
      membershipRole = role;
      const response = await request(app)
        .post('/api/hirepool/session')
        .set('Origin', HIREPOOL_LOCAL_EXTENSION_ORIGIN)
        .set('Authorization', `Bearer test-${userType}-access-token`)
        .send({})
        .expect(200);
      const principal = authenticateHirePoolLocalCredential(response.body.credential);
      assert.equal(principal.role, userType);
      assert.equal(principal.organizationRole, role);
    }

    identityUserType = 'consultancy';
    membershipRole = 'hiring_manager';
    const rejected = await request(app)
      .post('/api/hirepool/session')
      .set('Origin', HIREPOOL_LOCAL_EXTENSION_ORIGIN)
      .set('Authorization', 'Bearer test-invalid-consultancy-role')
      .send({})
      .expect(401);
    assert.equal(rejected.body.error.code, 'INELIGIBLE_HOST_ROLE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dashboard session exchange requires a verified HirePool identity and returns only the opaque SDK session', async () => {
  configureLocalIntegration();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  const originalFetch = globalThis.fetch;
  let verified = true;
  globalThis.fetch = async url => {
    if (url.pathname === '/api/v1/clients/me') {
      return new Response(JSON.stringify({ role: 'admin' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname !== '/api/v1/auth/me') throw new Error(`Unexpected HirePool identity URL: ${url.pathname}`);
    return new Response(JSON.stringify({
      id: 'local-client-id',
      email: 'client@example.test',
      user_type: 'client',
      is_active: true,
      is_verified: verified
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const app = createApp();
    const accessToken = 'test-only-hirepool-access-token';
    const response = await request(app)
      .post('/api/hirepool/session')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(200);
    assert.notEqual(response.body.credential, accessToken);
    assert.deepEqual(response.body.identity, {
      id: 'local-client-id',
      email: 'client@example.test',
      userType: 'client',
      organizationRole: 'admin'
    });
    assert.equal(JSON.stringify(response.body).includes(accessToken), false);

    await request(app)
      .post('/api/hirepool/session')
      .set('Origin', 'http://localhost.evil:5173')
      .set('Authorization', 'Bearer another-test-token')
      .send({})
      .expect(401);

    verified = false;
    await request(app)
      .post('/api/hirepool/session')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', 'Bearer another-test-token')
      .send({})
      .expect(401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verified HirePool principal identity is server-derived for the assistant response', async () => {
  configureLocalIntegration();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  registerHirePoolLocalDevelopmentIntegration();
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'false';
  const sdkSession = storeHirePoolSession('server-only-test-token', {
    id: 'verified-candidate-id',
    email: 'candidate@example.test',
    userType: 'candidate',
    organizationRole: null
  });
  let providerInput;
  setAIProvider({
    name: 'hirepool-verified-identity-test-provider',
    async chat(input) {
      providerInput = input;
      return { text: 'Verified candidate account.', model: 'test', finishReason: 'stop' };
    }
  });

  const response = await request(createApp())
    .post('/api/chat')
    .set('Authorization', `Bearer ${sdkSession.credential}`)
    .send({
      assistantId: 'hirepool',
      message: 'Which HirePool account am I logged in with?',
      context: JSON.stringify({ authentication: { status: 'authenticated', role: 'consultancy' } }),
      stream: false
    })
    .expect(200);

  assert.match(providerInput.systemInstruction, /User ID: verified-candidate-id/);
  assert.match(providerInput.systemInstruction, /Account type: candidate/);
  assert.match(providerInput.systemInstruction, /Email: candidate@example\.test/);
  assert.match(providerInput.systemInstruction, /assessment is required.*no candidate-authorized API.*do not prepare an application confirmation/);
  assert.match(providerInput.systemInstruction, /Never claim an assessment is absent or complete without verified API data/);
  assert.match(providerInput.systemInstruction, /Never answer, suggest answers to, or submit screening, assessment/);
  assert.doesNotMatch(providerInput.systemInstruction, /Account type: consultancy/);
  assert.equal(response.body.text, 'Verified candidate account.');
  assert.equal(sdkSession.identity.userType, 'candidate');
});

test('candidate follow-ups retain the prior ranked shortlist and resolve the first job', async () => {
  configureLocalIntegration();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  registerHirePoolLocalDevelopmentIntegration();
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'false';
  const sdkSession = storeHirePoolSession('candidate-follow-up-test-token', {
    id: 'candidate-follow-up-user',
    email: 'follow-up@example.test',
    userType: 'candidate',
    organizationRole: null
  });
  const inputs = [];
  setAIProvider({
    name: 'hirepool-shortlist-follow-up-test-provider',
    async chat(input) {
      inputs.push(input);
      return {
        text: inputs.length === 1
          ? '## Matching job shortlist\n1. Software Engineer — Example Co — HirePool match: 87%'
          : 'I will check the current details and readiness for Software Engineer.',
        model: 'test',
        finishReason: 'stop'
      };
    }
  });
  const app = createApp();
  const first = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${sdkSession.credential}`)
    .send({
      assistantId: 'hirepool',
      message: 'Apply to a job matching my profile.',
      stream: false
    })
    .expect(200);
  const followUp = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${sdkSession.credential}`)
    .send({
      assistantId: 'hirepool',
      conversationId: first.body.conversationId,
      message: 'Apply for the first one.',
      stream: false
    })
    .expect(200);
  assert.match(inputs[1].systemInstruction, /resolve "the first one", "apply for the first one"/);
  assert.ok(inputs[1].messages.some(message =>
    message.role === 'assistant' && message.content.includes('Software Engineer')
  ));
  assert.match(followUp.body.text, /Software Engineer/);
});

test('local integration exposes configured role-specific API operations', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const integration = getDynamicApiIntegration(HIREPOOL_LOCAL_INTEGRATION_ID);
  assert.equal(integration.enabled, true);
  assert.equal(integration.allowLocalDevelopment, true);
  assert.equal(integration.apiBaseUrl, 'http://localhost:8000/');
  assert.ok(integration.allowedOperationIds.length >= 35);

  const fixture = await readFile(new URL('./fixtures/hirepool-openapi.json', import.meta.url), 'utf8');
  const candidateSession = storeHirePoolSession('candidate-test-token', {
    id: 'candidate-test-user',
    userType: 'candidate'
  });

  test('candidate application requires verified preflight and an argument-bound one-use confirmation', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    const fixture = await readFile(new URL('./fixtures/hirepool-openapi.json', import.meta.url), 'utf8');
    const sdkSession = storeHirePoolSession('candidate-application-test-token', {
      id: 'candidate-application-test-user',
      userType: 'candidate'
    });
    const candidate = authenticateHirePoolLocalCredential(sdkSession.credential);
    const registry = await createRequestActionRegistry(
      'hirepool',
      candidate,
      new ActionRegistry({ actions: [] }),
      { fetchSpec: async () => fixture }
    );
    const action = registry.list().find(item =>
      item.metadata.dynamicApi.operationId === 'create_application_api_v1_applications_post'
    );
    assert.ok(action);
    assert.equal(action.metadata.dynamicApi.method, 'POST');
    assert.equal(action.risk, 'write');
    assert.equal(action.requiresConfirmation, true);

    const jobId = 'c0ffee00-0000-4000-8000-000000000001';
    assert.equal(action.parameterSchema.safeParse({
      body: { job_id: jobId, candidate_id: 'attacker-chosen-id' }
    }).success, false);

    let submissions = 0;
    const requestMock = async (url, options) => {
      const path = new URL(url).pathname;
      if (path === `/api/v1/jobs/${jobId}`) {
        return {
          id: jobId,
          title: 'Software Engineer',
          company_name: 'Local Test Company',
          status: 'active',
          has_screening: false,
          locations: ['Local City'],
          job_type: 'full_time'
        };
      }
      if (path === '/api/v1/candidates/profile') {
        return {
          first_name: 'Test',
          last_name: 'Candidate',
          job_title: 'Software Engineer',
          skills: ['TypeScript']
        };
      }
      if (path === '/api/v1/applications/my-applications') {
        return { items: [], total: 0, page: 1, page_size: 100, total_pages: 0 };
      }
      if (path === `/api/v1/jobs/${jobId}/screening-questions/for-candidate`) {
        return { questions: [] };
      }
      assert.equal(path, '/api/v1/applications');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer candidate-application-test-token');
      assert.deepEqual(options.body, { job_id: jobId, auto_submitted: false });
      submissions += 1;
      return {
        id: 'app-created-by-test-api',
        job_id: jobId,
        status: 'applied',
        job_title: 'Software Engineer',
        company_name: 'Local Test Company',
        candidate_id: 'must-not-be-projected',
        created_at: '2026-11-05T00:00:00Z'
      };
    };
    const prepared = await stageDynamicApiConfirmation(
      action,
      { body: { job_id: jobId } },
      candidate,
      { readActions: registry.list(), request: requestMock }
    );
    assert.equal(prepared.ready, true);
    assert.match(prepared.reviewMessage, /verified the available job and screening requirements/);
    assert.match(prepared.reviewMessage, /Software Engineer/);
    assert.match(prepared.reviewMessage, /Local Test Company/);
    assert.match(prepared.reviewMessage, /Test Candidate/);
    assert.match(prepared.confirmationToken, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(JSON.stringify(action.parameters), /confirmationToken/);
    assert.equal(submissions, 0, 'preparing a confirmation must not submit the application');

    const cancelledProposal = await stageDynamicApiConfirmation(
      action,
      { body: { job_id: jobId } },
      candidate,
      { readActions: registry.list(), request: requestMock }
    );
    assert.equal(cancelDynamicApiConfirmation(cancelledProposal.confirmationToken, candidate), true);
    assert.equal(cancelDynamicApiConfirmation(cancelledProposal.confirmationToken, candidate), false);
    await assert.rejects(() => executeApprovedDynamicApiConfirmation(
      cancelledProposal.confirmationToken,
      candidate,
      async () => {
        throw new Error('A cancelled application must never execute');
      }
    ), /expired or is invalid/);
    assert.equal(submissions, 0, 'cancelling must revoke the pending write confirmation');

    const screeningRequest = async (url, options) => {
      const path = new URL(url).pathname;
      if (path === `/api/v1/jobs/${jobId}`) {
        return {
          id: jobId,
          title: 'Software Engineer',
          company_name: 'Local Test Company',
          status: 'active',
          has_screening: true,
          locations: ['Local City'],
          job_type: 'full_time'
        };
      }
      if (path === '/api/v1/candidates/profile') {
        return {
          first_name: 'Test',
          last_name: 'Candidate',
          job_title: 'Software Engineer',
          skills: ['TypeScript']
        };
      }
      if (path === '/api/v1/applications/my-applications') {
        return { items: [], total: 0, page: 1, page_size: 100, total_pages: 0 };
      }
      if (path.endsWith('/screening-questions/for-candidate')) {
        return {
          questions: [{
            id: 'screening-question-1',
            question_text: 'How many years of experience do you have?',
            points: 99,
            is_correct: true,
            options: [{ label: '1 year' }, { label: '3 years' }]
          }]
        };
      }
      if (path === `/api/v1/applications/screening-eligibility/${jobId}`) {
        return { eligible: true };
      }
      return requestMock(url, options);
    };
    const missingScreeningAnswers = await stageDynamicApiConfirmation(
      action,
      { body: { job_id: jobId } },
      candidate,
      { readActions: registry.list(), request: screeningRequest }
    );
    assert.equal(missingScreeningAnswers.ready, false);
    assert.match(missingScreeningAnswers.reviewMessage, /screening question/);
    assert.match(missingScreeningAnswers.reviewMessage, /HirePool dashboard/);
    assert.doesNotMatch(missingScreeningAnswers.reviewMessage, /How many years|1 year|3 years|99/);
    assert.equal(missingScreeningAnswers.confirmationToken, undefined);

    const answeredScreening = await stageDynamicApiConfirmation(
      action,
      {
        body: {
          job_id: jobId,
          screening_responses: [{
            question_id: 'screening-question-1',
            question_text: 'How many years of experience do you have?',
            selected_option: '3 years',
            is_correct: true,
            points: 99
          }]
        }
      },
      candidate,
      { readActions: registry.list(), request: screeningRequest }
    );
    assert.equal(answeredScreening.ready, false);
    assert.match(answeredScreening.reviewMessage, /complete and submit the required questions yourself/);
    assert.equal(answeredScreening.confirmationToken, undefined);

    await assert.rejects(() => executeApprovedDynamicApiConfirmation(
      prepared.confirmationToken,
      { ...candidate, id: 'different-candidate' },
      async () => {
        throw new Error('Unbound confirmation reached execution');
      }
    ), /does not belong/);

    const execute = async (definition, argumentsValue) =>
      executeDynamicApiAction(definition, argumentsValue, candidate, {
        approved: true,
        request: requestMock
      });
    const result = await executeApprovedDynamicApiConfirmation(
      prepared.confirmationToken,
      candidate,
      execute
    );
    assert.equal(result.id, 'app-created-by-test-api');
    assert.equal(result.status, 'applied');
    assert.equal(Object.hasOwn(result, 'candidate_id'), false);
    assert.equal(submissions, 1);
    assert.deepEqual(
      await executeApprovedDynamicApiConfirmation(prepared.confirmationToken, candidate, execute),
      result
    );
    assert.equal(submissions, 1);

    const workflowConversationId = `application-workflow-${Date.now()}`;
    const workflowSession = sessionManager.getOrCreate(
      workflowConversationId,
      'hirepool',
      createSessionOptions(candidate, 'hirepool')
    );
    workflowSession.hirePoolWorkflow = {
      stage: 'READY_FOR_APPLICATION_CONFIRMATION',
      selectedJob: { id: jobId }
    };
    const duplicateProposal = await stageDynamicApiConfirmation(
      action,
      { body: { job_id: jobId } },
      candidate,
      { readActions: registry.list(), request: requestMock, conversationId: workflowConversationId }
    );
    assert.deepEqual(
      await executeApprovedDynamicApiConfirmation(
        duplicateProposal.confirmationToken,
        candidate,
        execute,
        {
          onSuccess: ({ result: confirmedApplication, conversationId }) => {
            assert.equal(confirmedApplication.id, 'app-created-by-test-api');
            sessionManager.setWorkflowState(conversationId, {
              stage: 'APPLICATION_SUBMITTED',
              selectedJob: {
                id: jobId,
                applicationStatus: confirmedApplication.status,
                applicationId: confirmedApplication.id
              }
            }, createSessionOptions(candidate, 'hirepool'));
          }
        }
      ),
      result
    );
    assert.equal(workflowSession.hirePoolWorkflow.stage, 'APPLICATION_SUBMITTED');
    assert.equal(workflowSession.hirePoolWorkflow.selectedJob.applicationStatus, 'applied');
    assert.equal(submissions, 1);
  });
  const candidate = authenticateHirePoolLocalCredential(candidateSession.credential);
  const registry = await createRequestActionRegistry(
    'hirepool',
    candidate,
    new ActionRegistry({ actions: [] }),
    { fetchSpec: async () => fixture }
  );
  const candidateActions = registry.list().map(action => action.metadata.dynamicApi.operationId);
  assert.deepEqual(candidateActions.sort(), [
    'check_screening_eligibility_api_v1_applications_screening_eligibility__job_id__get',
    'create_application_api_v1_applications_post',
    'get_job_api_v1_jobs__job_id__get',
    'get_matching_jobs_api_v1_matching_jobs_get',
    'get_my_applications_api_v1_applications_my_applications_get',
    'get_my_profile_api_v1_candidates_profile_get',
    'get_screening_questions_for_candidate_api_v1_jobs__job_id__screening_questions_for_candidate_get',
    'search_jobs_api_v1_jobs_search_get',
    'update_my_profile_api_v1_candidates_profile_put',
    'withdraw_application_api_v1_applications__application_id__withdraw_post'
  ]);
  const screeningAction = registry.list().find(action =>
    action.metadata.dynamicApi.operationId === 'get_screening_questions_for_candidate_api_v1_jobs__job_id__screening_questions_for_candidate_get'
  );
  const safeScreening = await executeDynamicApiAction(screeningAction, {
    path: { job_id: 'c0ffee00-0000-4000-8000-000000000001' }
  }, candidate, {
    request: async () => ({
      questions: [{
        id: 'question-safe-id',
        question_text: 'private screening text',
        points: 99,
        is_correct: true,
        options: [{ label: 'choice', is_correct: true }]
      }]
    })
  });
  assert.deepEqual(safeScreening, { questions: [{ id: 'question-safe-id' }] });
  assert.doesNotMatch(JSON.stringify(safeScreening), /question_text|points|is_correct|choice/);
  const expectedRoleOperations = {
    client: [
      'bulk_update_status_api_v1_applications_bulk_status_post',
      'create_job_api_v1_jobs_post',
      'get_client_applications_api_v1_applications_for_client_get',
      'get_dashboard_stats_api_v1_clients_dashboard_get',
      'get_job_api_v1_jobs__job_id__get',
      'get_job_applications_api_v1_applications_job__job_id__get',
      'get_matching_candidates_api_v1_matching_candidates__job_id__get',
      'get_my_company_profile_api_v1_clients_profile_get',
      'get_my_jobs_api_v1_jobs_my_jobs_get',
      'get_my_user_profile_api_v1_clients_me_get',
      'update_company_profile_api_v1_clients_profile_put',
      'update_job_api_v1_jobs__job_id__put',
      'update_my_user_profile_api_v1_clients_me_put'
    ],
    consultancy: [
      'add_candidate_api_v1_consultancies_candidates_post',
      'bulk_submit_consultancy_candidates_api_v1_applications_consultancy_submit_post',
      'create_consultancy_application_api_v1_applications_consultancy_post',
      'get_consultancy_submissions_api_v1_applications_for_consultancy_get',
      'get_dashboard_stats_api_v1_consultancies_dashboard_get',
      'get_job_api_v1_jobs__job_id__get',
      'get_matching_candidates_for_job_api_v1_consultancies_candidates_matching_get',
      'get_my_consultancy_profile_api_v1_consultancies_profile_get',
      'get_my_user_profile_api_v1_consultancies_me_get',
      'get_placement_stats_api_v1_consultancies_placements_stats_get',
      'get_placements_api_v1_consultancies_placements_get',
      'list_candidates_api_v1_consultancies_candidates_get',
      'search_jobs_api_v1_jobs_search_get',
      'update_candidate_api_v1_consultancies_candidates__candidate_id__put',
      'update_consultancy_profile_api_v1_consultancies_profile_put',
      'update_my_user_profile_api_v1_consultancies_me_put'
    ]
  };
  for (const [role, expectedOperations] of Object.entries(expectedRoleOperations)) {
    const roleSession = storeHirePoolSession(`${role}-test-token`, {
      id: `${role}-test-user`,
      userType: role,
      organizationRole: 'admin'
    });
    const roleRegistry = await createRequestActionRegistry(
      'hirepool',
      authenticateHirePoolLocalCredential(roleSession.credential),
      new ActionRegistry({ actions: [] }),
      { fetchSpec: async () => fixture }
    );
    assert.deepEqual(
      roleRegistry.list().map(action => action.metadata.dynamicApi.operationId).sort(),
      expectedOperations
    );
  }

  const profileAction = registry.list().find(action =>
    action.metadata.dynamicApi.operationId === 'get_my_profile_api_v1_candidates_profile_get'
  );
  const profileParameters = profileAction.metadata.dynamicApi.parameterJsonSchema;
  assert.deepEqual(Object.keys(profileParameters.properties), []);

  let requestOptions;
  let requestUrl;
  const projected = await executeDynamicApiAction(profileAction, {}, candidate, {
    request: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        first_name: 'Local',
        last_name: 'Candidate',
        phone: '555-0101',
        job_title: 'Engineer',
        current_location: 'Local City',
        professional_summary: 'Experienced engineer',
        skills: ['TypeScript'],
        years_of_experience: 5,
        months_of_experience: 3,
        education: [{ institution: 'Local University', degree: 'BS', field_of_study: 'Computer Science' }],
        work_experience: [{ company: 'Local Co', title: 'Engineer', description: 'Built software' }],
        certifications: [{ name: 'Cloud Professional' }],
        preferred_job_types: ['full_time'],
        preferred_work_types: ['remote'],
        expected_salary_min: 100000,
        expected_salary_max: 200000,
        salary_currency: 'INR',
        notice_period_days: 30,
        is_open_to_work: true,
        profile_completion_percentage: 85,
        email: 'must-not-be-projected@example.test',
        resume_url: 'must-not-be-projected'
      };
    }
  });
  assert.equal(new URL(requestUrl).pathname, '/api/v1/candidates/profile');
  assert.equal(requestOptions.headers.Authorization, 'Bearer candidate-test-token');
  assert.deepEqual(projected, {
    first_name: 'Local',
    last_name: 'Candidate',
    phone: '555-0101',
    professional_summary: 'Experienced engineer',
    job_title: 'Engineer',
    current_location: 'Local City',
    skills: ['TypeScript'],
    years_of_experience: 5,
    months_of_experience: 3,
    education: [{ institution: 'Local University', degree: 'BS', field_of_study: 'Computer Science' }],
    work_experience: [{ company: 'Local Co', title: 'Engineer', description: 'Built software' }],
    certifications: [{ name: 'Cloud Professional' }],
    preferred_job_types: ['full_time'],
    preferred_work_types: ['remote'],
    expected_salary_min: 100000,
    expected_salary_max: 200000,
    salary_currency: 'INR',
    notice_period_days: 30,
    is_open_to_work: true,
    profile_completion_percentage: 85
  });
  await assert.rejects(() => executeDynamicApiAction(profileAction, {
    headers: { Authorization: 'Bearer attacker-token' }
  }, candidate, {
    request: async () => {
      throw new Error('Invalid parameters reached the API executor');
    }
  }), /parameters are invalid/);
});

test('HirePool profile responses are concise and never echo raw profile JSON', async () => {
  const profile = {
    first_name: 'Local',
    last_name: 'Candidate',
    job_title: 'Engineer',
    current_location: 'Local City',
    years_of_experience: 5,
    months_of_experience: 3,
    is_open_to_work: true,
    skills: ['TypeScript', 'Python'],
    education: [{ institution: 'Local University', degree: 'BS', field_of_study: 'Computer Science' }],
    work_experience: [{ company: 'Local Co', title: 'Engineer', description: 'Built software' }],
    phone: '',
    professional_summary: 'PRIVATE FULL SUMMARY',
    profile_completion_percentage: 85
  };
  const results = [{
    operationId: 'get_my_profile_api_v1_candidates_profile_get',
    data: profile
  }];
  const response = finalizeHirePoolResponse(JSON.stringify(profile), results);
  assert.match(response, /## Profile overview/);
  assert.match(response, /Local Candidate/);
  assert.match(response, /## Skills/);
  assert.match(response, /TypeScript/);
  assert.match(response, /Local University/);
  assert.match(response, /Local Co/);
  assert.match(response, /85%/);
  assert.match(response, /Missing required profile information: phone/);
  assert.doesNotMatch(response, /PRIVATE FULL SUMMARY/);
  assert.doesNotMatch(response, /^\s*[{[]/);
  assert.doesNotMatch(finalizeHirePoolResponse('Here are your results: api_hirepool_local_development_action_1234567890123456 ' +
    'A'.repeat(43), results), /api_hirepool|A{43}/);

  const sparse = formatHirePoolReadResults([{
    operationId: 'get_my_profile_api_v1_candidates_profile_get',
    data: { skills: [] }
  }]);
  assert.match(sparse, /No education entries are listed/);
  assert.match(sparse, /No work-experience entries are listed/);
  assert.doesNotMatch(sparse, /undefined|null/);
});

test('HirePool application history is readable, sorted by submission time, and filtered safely', () => {
  const history = {
    data: {
      items: [
        {
          id: 'app-older',
          job_id: 'job-older',
          job_title: 'Data Engineer',
          company_name: 'Old Company',
          status: 'rejected',
          created_at: '2025-01-02T10:00:00Z',
          last_status_change_at: '2025-01-05T10:00:00Z'
        },
        {
          id: 'app-newer',
          job_id: 'job-newer',
          job_title: 'Software Engineer',
          company_name: 'New Company',
          status: 'applied',
          created_at: '2025-02-02T10:00:00Z'
        }
      ],
      total: 2,
      page: 1,
      page_size: 100,
      total_pages: 1,
      fetched_pages: 1,
      complete: true
    }
  };
  const list = formatApplicationHistory(history, 'Show my application history');
  assert.ok(list.indexOf('Software Engineer') < list.indexOf('Data Engineer'));
  assert.match(list, /New Company/);
  assert.match(list, /app-newer/);
  assert.match(list, /Last status update/);
  assert.doesNotMatch(list, /candidate_id|raw JSON|undefined|null/);

  const latest = formatApplicationHistory(history, 'Show my latest application');
  assert.match(latest, /Software Engineer/);
  assert.doesNotMatch(latest, /Data Engineer/);

  const submitted = formatApplicationHistory(history, "What's the status of the application I just submitted?", {
    applicationId: 'app-older',
    status: 'applied'
  });
  assert.match(submitted, /Application you just submitted/);
  assert.match(submitted, /app-older/);
  assert.match(submitted, /rejected/);
  assert.doesNotMatch(submitted, /Software Engineer/);

  const rejected = formatApplicationHistory(history, 'Show my rejected applications');
  assert.match(rejected, /Data Engineer/);
  assert.doesNotMatch(rejected, /Software Engineer/);

  const sparse = formatApplicationHistory({
    data: {
      items: [{ id: 'app-sparse', job_id: 'job-sparse', status: 'applied' }],
      total: 1,
      page: 1,
      page_size: 100,
      total_pages: 1,
      fetched_pages: 1,
      complete: true
    }
  });
  assert.match(sparse, /Job title unavailable/);
  assert.doesNotMatch(sparse, /Company:|Location:/);
});

test('HirePool application history distinguishes empty, failures, malformed and delayed submission results', () => {
  const empty = formatApplicationHistory({
    data: {
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
      total_pages: 0,
      fetched_pages: 0,
      complete: true
    }
  });
  assert.equal(empty, "You haven't submitted any applications yet.");

  const delayed = formatApplicationHistory({
    data: {
      items: [],
      total: 0,
      page: 1,
      page_size: 100,
      total_pages: 0,
      fetched_pages: 0,
      complete: true
    }
  }, 'Show my latest application', { applicationId: 'app-confirmed', status: 'applied' });
  assert.match(delayed, /confirmed application app-confirmed/);
  assert.match(delayed, /propagation delay/);

  const propagated = formatApplicationHistory({
    data: {
      items: [{
        id: 'another-app',
        job_id: 'another-job',
        status: 'applied',
        created_at: '2025-01-02T10:00:00Z'
      }],
      total: 1,
      page: 1,
      page_size: 100,
      total_pages: 1,
      fetched_pages: 1,
      complete: true
    }
  }, 'What is the status of the application I just submitted?', {
    applicationId: 'app-confirmed',
    status: 'applied'
  });
  assert.match(propagated, /app-confirmed/);
  assert.match(propagated, /not visible in the fresh application history/);

  for (const [category, expected] of [
    ['http_401', /session is expired or unauthorized/],
    ['http_403', /denied access/],
    ['http_500', /server error/],
    ['timeout', /too long.*not an empty history/],
    ['unexpected_schema', /unexpected format/]
  ]) {
    const message = formatApplicationHistory({ data: null, error: { category } });
    assert.match(message, expected);
    assert.doesNotMatch(message, /^\s*[{[]/);
  }

  const malformed = formatApplicationHistory({
    data: { items: [{ id: 'missing-job-and-status' }], total: 1, total_pages: 1 }
  });
  assert.match(malformed, /unexpected format/);
});

test('candidate application history fetches all bounded pages once and never submits a write', async () => {
  const context = await createCandidateApplicationContext();
  const action = context.registry.list().find(item =>
    item.metadata.dynamicApi.operationId === 'get_my_applications_api_v1_applications_my_applications_get'
  );
  assert.ok(action);
  const calls = [];
  const items = Array.from({ length: 101 }, (_, index) => ({
    id: `app-${index}`,
    job_id: `job-${index}`,
    status: 'applied',
    created_at: `2026-01-${String(Math.floor(index / 10) + 1).padStart(2, '0')}T00:00:00Z`
  }));
  const result = await executeCandidateApplicationHistoryWorkflow(
    action,
    {},
    context.candidate,
    undefined,
    async (url, options) => {
      const parsed = new URL(url);
      calls.push({ path: parsed.pathname, method: options.method, page: Number(parsed.searchParams.get('page')) });
      const page = Number(parsed.searchParams.get('page'));
      const pageSize = Number(parsed.searchParams.get('page_size'));
      return {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        page_size: pageSize,
        total_pages: Math.ceil(items.length / pageSize)
      };
    }
  );
  assert.equal(result.data.items.length, 101);
  assert.equal(result.data.complete, true);
  assert.deepEqual(calls.map(call => call.page), [1, 2]);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.every(call => call.path === '/api/v1/applications/my-applications'));
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  const formatted = formatHirePoolReadResults([{
    operationId: 'get_my_applications_api_v1_applications_my_applications_get',
    data: result.data
  }], 'List all my applications');
  assert.match(formatted, /Showing 50 of 101 applications/);
  assert.doesNotMatch(formatted, /safe readable format/);
});

test('candidate application history timeout and unexpected envelopes are not reported as empty', async () => {
  const context = await createCandidateApplicationContext();
  const action = context.registry.list().find(item =>
    item.metadata.dynamicApi.operationId === 'get_my_applications_api_v1_applications_my_applications_get'
  );
  let timedOutCalls = 0;
  const timedOut = await executeCandidateApplicationHistoryWorkflow(
    action,
    {},
    context.candidate,
    undefined,
    async () => {
      timedOutCalls += 1;
      throw new Error('request timed out');
    }
  );
  assert.equal(timedOut.error.category, 'timeout');
  assert.equal(timedOutCalls, 2, 'safe GET retries once after a timeout');
  assert.match(formatApplicationHistory(timedOut), /not an empty history/);

  const unauthorized = await executeCandidateApplicationHistoryWorkflow(
    action,
    {},
    context.candidate,
    undefined,
    async () => {
      const error = new Error('unauthorized');
      error.statusCode = 401;
      throw error;
    }
  );
  assert.equal(unauthorized.error.category, 'http_401');
  assert.match(formatApplicationHistory(unauthorized), /session is expired or unauthorized/);

  const malformed = await executeCandidateApplicationHistoryWorkflow(
    action,
    {},
    context.candidate,
    undefined,
    async () => ({ data: { items: [] } })
  );
  assert.equal(malformed.error.category, 'unexpected_schema');
  assert.match(formatApplicationHistory(malformed), /unexpected format/);
});

test('confirmed profile update is followed by a fresh profile read', async () => {
  const context = await createCandidateApplicationContext();
  const fixture = await readFile(new URL('./fixtures/hirepool-openapi.json', import.meta.url), 'utf8');
  const action = context.registry.list().find(item =>
    item.metadata.dynamicApi.operationId === 'update_my_profile_api_v1_candidates_profile_put'
  );
  const requests = [];
  const requestMock = async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, method: options.method });
    if (path !== '/api/v1/candidates/profile') throw new Error(`Unexpected mock profile URL: ${path}`);
    if (options.method === 'PUT') {
      return { first_name: 'Updated', profile_completion_percentage: 90 };
    }
    return { first_name: 'Updated', last_name: 'Candidate', profile_completion_percentage: 90 };
  };
  const verified = await executeAndVerifyProfileUpdate(
    action,
    { body: { first_name: 'Updated' } },
    context.candidate,
    { request: requestMock, fetchSpec: async () => fixture }
  );
  assert.deepEqual(requests, [
    { path: '/api/v1/candidates/profile', method: 'PUT' },
    { path: '/api/v1/candidates/profile', method: 'GET' }
  ]);
  assert.equal(verified.data.verificationStatus, 'verified');
  assert.equal(verified.data.verifiedProfile.first_name, 'Updated');
  assert.match(verified.message, /fresh profile read verified/);
});

test('candidate matching uses HirePool match scores and excludes applications and pending screening', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const fixture = await readFile(new URL('./fixtures/hirepool-openapi.json', import.meta.url), 'utf8');
  const session = storeHirePoolSession('candidate-match-test-token', {
    id: 'candidate-match-test-user',
    userType: 'candidate'
  });
  const candidate = authenticateHirePoolLocalCredential(session.credential);
  const registry = await createRequestActionRegistry(
    'hirepool',
    candidate,
    new ActionRegistry({ actions: [] }),
    { fetchSpec: async () => fixture }
  );
  const matchingAction = registry.list().find(action =>
    action.metadata.dynamicApi.operationId === 'get_matching_jobs_api_v1_matching_jobs_get'
  );
  assert.ok(matchingAction);
  assert.equal(matchingAction.metadata.dynamicApi.method, 'GET');
  let historyReads = 0;
  const paths = [];
  const result = await executeCandidateMatchingWorkflow(
    matchingAction,
    { query: {} },
    candidate,
    registry,
    undefined,
    async url => {
      const parsed = new URL(url);
      paths.push(parsed.pathname);
      if (parsed.pathname === '/api/v1/matching/jobs') {
        return [
          {
            id: 'job-low-score',
            title: 'Lower Match',
            matching_score: 72,
            status: 'active',
            has_screening: false
          },
          {
            id: 'job-applied',
            title: 'Already Applied',
            matching_score: 99,
            status: 'active',
            has_screening: false
          },
          {
            id: 'job-pending-screening',
            title: 'Screening Started',
            matching_score: 91,
            status: 'active',
            has_screening: true
          },
          {
            id: 'job-top-score',
            title: 'Top Match',
            matching_score: 88,
            status: 'active',
            has_screening: false
          },
          {
            id: 'job-no-score',
            title: 'Score Unavailable',
            status: 'active',
            has_screening: false
          }
        ];
      }
      if (parsed.pathname === '/api/v1/applications/my-applications') {
        historyReads += 1;
        return {
          items: [{ job_id: 'job-applied', status: 'applied' }],
          total: 1,
          page: 1,
          page_size: 100,
          total_pages: 1
        };
      }
      if (parsed.pathname === '/api/v1/applications/screening-eligibility/job-pending-screening') {
        return { eligible: true, application_id: 'pending-screening-application' };
      }
      throw new Error(`Unexpected mock matching request: ${parsed.pathname}`);
    }
  );
  assert.deepEqual(result.jobs.map(job => job.id), [
    'job-low-score',
    'job-top-score',
    'job-no-score'
  ]);
  assert.equal(historyReads, 1);
  assert.ok(paths.includes('/api/v1/matching/jobs'));
  const message = formatHirePoolReadResults([{
    operationId: 'get_matching_jobs_api_v1_matching_jobs_get',
    data: result.jobs,
    notes: result.notes
  }]);
  assert.ok(message.indexOf('88%') < message.indexOf('72%'));
  assert.match(message, /Unavailable \(not provided\)/);
  assert.match(message, /HirePool match:/);
  assert.doesNotMatch(message, /Application status|Screening:/i);
  assert.match(message, /HirePool’s candidate matching endpoint/);
  assert.doesNotMatch(message, /99%|job-applied|pending-screening-application/);
  assert.doesNotMatch(message, /MatchingService|matching_score/);
});

test('candidate follow-ups resolve apply, first-job, details, and prerequisite-return intents from session state', () => {
  const job = {
    id: 'job-software-engineer',
    title: 'Software Engineer',
    company: 'Example Co',
    matchingScore: 63,
    position: 1,
    applicationStatus: 'not_found_in_verified_history'
  };
  const secondJob = { ...job, id: 'job-designer', title: 'Product Designer', position: 2 };
  const actions = [
    {
      name: 'apply_action',
      metadata: { dynamicApi: { operationId: 'create_application_api_v1_applications_post' } }
    },
    {
      name: 'details_action',
      metadata: { dynamicApi: { operationId: 'get_job_api_v1_jobs__job_id__get' } }
    }
  ];
  const registry = { list: () => actions };
  const shortlist = { stage: 'JOB_SEARCH_COMPLETED', shortlist: [job], selectedJob: null };
  for (const phrase of ['Apply', 'Apply to this job', 'I want this job', 'Proceed']) {
    const result = resolveHirePoolCandidateFollowup(phrase, shortlist, registry);
    assert.equal(result.action.name, 'apply_action');
    assert.deepEqual(result.argumentsValue, { body: { job_id: job.id } });
    assert.equal(result.job.matchingScore, 63);
  }
  const firstResult = resolveHirePoolCandidateFollowup(
    'Apply for the first one',
    { ...shortlist, shortlist: [job, secondJob] },
    registry
  );
  assert.equal(firstResult.argumentsValue.body.job_id, job.id);

  const details = resolveHirePoolCandidateFollowup('Show its details', shortlist, registry);
  assert.equal(details.action.name, 'details_action');
  assert.deepEqual(details.argumentsValue, { path: { job_id: job.id } });

  const ambiguous = resolveHirePoolCandidateFollowup(
    'Apply to this job',
    { ...shortlist, shortlist: [job, secondJob] },
    registry
  );
  assert.match(ambiguous.clarification, /Which job/);

  const returned = resolveHirePoolCandidateFollowup(
    'I completed it',
    { ...shortlist, stage: 'CANDIDATE_PREREQUISITE_REQUIRED', selectedJob: job },
    registry
  );
  assert.deepEqual(returned.argumentsValue, { body: { job_id: job.id } });
  assert.equal(returned.stage, 'APPLICATION_READINESS_CHECK');
});

test('candidate matching retries timed-out safe reads once and distinguishes timeout from empty results', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const fixture = await readFile(new URL('./fixtures/hirepool-openapi.json', import.meta.url), 'utf8');
  const session = storeHirePoolSession('candidate-match-timeout-test-token', {
    id: 'candidate-match-timeout-user',
    userType: 'candidate'
  });
  const candidate = authenticateHirePoolLocalCredential(session.credential);
  const registry = await createRequestActionRegistry(
    'hirepool',
    candidate,
    new ActionRegistry({ actions: [] }),
    { fetchSpec: async () => fixture }
  );
  const matchingAction = registry.list().find(action =>
    action.metadata.dynamicApi.operationId === 'get_matching_jobs_api_v1_matching_jobs_get'
  );
  const calls = new Map();
  const requestMock = async url => {
    const path = new URL(url).pathname;
    const attempt = (calls.get(path) || 0) + 1;
    calls.set(path, attempt);
    if (attempt === 1) throw new Error('Dynamic API request timed out');
    if (path === '/api/v1/matching/jobs') {
      return [{
        id: 'job-timeout-recovered',
        title: 'Recovered Match',
        matching_score: 63,
        status: 'active',
        has_screening: false
      }];
    }
    if (path === '/api/v1/applications/my-applications') {
      return { items: [], total: 0, page: 1, page_size: 100, total_pages: 0 };
    }
    throw new Error(`Unexpected mock request: ${path}`);
  };
  const workflow = await executeCandidateMatchingWorkflow(
    matchingAction,
    { query: {} },
    candidate,
    registry,
    undefined,
    requestMock
  );
  assert.equal(workflow.jobs[0].matching_score, 63);
  assert.equal(calls.get('/api/v1/matching/jobs'), 2);
  assert.equal(calls.get('/api/v1/applications/my-applications'), 2);

  const timedOut = formatHirePoolReadResults([{
    operationId: 'get_matching_jobs_api_v1_matching_jobs_get',
    error: 'timed out'
  }]);
  assert.match(timedOut, /too long to respond/);
  assert.doesNotMatch(timedOut, /Dynamic API request timed out/);
  assert.doesNotMatch(formatHirePoolReadResults([{
    operationId: 'get_matching_jobs_api_v1_matching_jobs_get',
    data: []
  }]), /too long to respond/);
});

test('duplicate identical dynamic reads within one chat turn share a single request', async () => {
  const cache = new Map();
  let requests = 0;
  const execute = () => {
    requests += 1;
    return Promise.resolve([{ id: 'job-1' }]);
  };
  const [first, duplicate] = await Promise.all([
    executeCachedDynamicRead(cache, 'matching:{}', execute),
    executeCachedDynamicRead(cache, 'matching:{}', execute)
  ]);
  assert.deepEqual(first, [{ id: 'job-1' }]);
  assert.deepEqual(duplicate, first);
  assert.equal(requests, 1);
});

async function createCandidateApplicationContext() {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const fixture = await readFile(new URL('./fixtures/hirepool-openapi.json', import.meta.url), 'utf8');
  const session = storeHirePoolSession('candidate-readiness-test-token', {
    id: 'candidate-readiness-test-user',
    userType: 'candidate'
  });
  const candidate = authenticateHirePoolLocalCredential(session.credential);
  const registry = await createRequestActionRegistry(
    'hirepool',
    candidate,
    new ActionRegistry({ actions: [] }),
    { fetchSpec: async () => fixture }
  );
  const action = registry.list().find(item =>
    item.metadata.dynamicApi.operationId === 'create_application_api_v1_applications_post'
  );
  return { candidate, registry, action, jobId: 'c0ffee00-0000-4000-8000-000000000001' };
}

function createReadinessRequest(jobId, {
  job = {},
  profile = { first_name: 'Test', last_name: 'Candidate' },
  applications = [],
  screening = { questions: [] },
  eligibility = { eligible: true },
  postResponse
} = {}) {
  const verifiedJob = {
    id: jobId,
    title: 'Software Engineer',
    company_name: 'Local Test Company',
    status: 'active',
    has_screening: false,
    locations: ['Local City'],
    job_type: 'full_time',
    ...job
  };
  const calls = [];
  let submissions = 0;
  return {
    calls,
    get submissions() { return submissions; },
    request: async (url, options) => {
      const parsed = new URL(url);
      calls.push({ path: parsed.pathname, search: parsed.search, method: options?.method || 'GET' });
      if (parsed.pathname === `/api/v1/jobs/${jobId}`) return verifiedJob;
      if (parsed.pathname === '/api/v1/candidates/profile') return profile;
      if (parsed.pathname === '/api/v1/applications/my-applications') {
        const page = Number(parsed.searchParams.get('page') || 1);
        const pageSize = Number(parsed.searchParams.get('page_size') || 20);
        return {
          items: applications.slice((page - 1) * pageSize, page * pageSize),
          total: applications.length,
          page,
          page_size: pageSize,
          total_pages: Math.ceil(applications.length / pageSize)
        };
      }
      if (parsed.pathname === `/api/v1/jobs/${jobId}/screening-questions/for-candidate`) {
        if (screening instanceof Error) throw screening;
        return screening;
      }
      if (parsed.pathname === `/api/v1/applications/screening-eligibility/${jobId}`) {
        if (eligibility instanceof Error) throw eligibility;
        return eligibility;
      }
      if (parsed.pathname === '/api/v1/applications') {
        submissions += 1;
        if (postResponse instanceof Error) throw postResponse;
        return postResponse || {
          id: 'application-created-by-mock',
          job_id: jobId,
          status: 'applied',
          job_title: 'Software Engineer',
          company_name: 'Local Test Company',
          created_at: '2026-11-05T00:00:00Z'
        };
      }
      throw new Error(`Unexpected mock HirePool endpoint: ${parsed.pathname}`);
    }
  };
}

test('application readiness fails closed and revalidates requirements before confirmation', async t => {
  const context = await createCandidateApplicationContext();
  const { action, candidate, jobId, registry } = context;
  const stage = (request, body = { job_id: jobId }) => stageDynamicApiConfirmation(
    action,
    { body },
    candidate,
    { readActions: registry.list(), request }
  );

  await t.test('questions are detected even when has_screening is false and no token is staged', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    const api = createReadinessRequest(jobId, {
      screening: { questions: [{ id: 'screening-question-id' }] }
    });
    const result = await stage(api.request);
    assert.equal(result.ready, false);
    assert.equal(result.confirmationToken, undefined);
    assert.match(result.reviewMessage, /complete and submit the required questions yourself/);
    assert.ok(api.calls.some(call => call.path.endsWith('/screening-questions/for-candidate')));
    assert.equal(api.submissions, 0);
  });

  await t.test('empty questions and an explicit false flag allow a fresh confirmation', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    const api = createReadinessRequest(jobId);
    const first = await stage(api.request);
    const revalidated = await stage(api.request);
    assert.equal(first.ready, true);
    assert.equal(revalidated.ready, true);
    assert.notEqual(first.confirmationToken, revalidated.confirmationToken);
    assert.equal(api.submissions, 0);
    assert.equal(api.calls.filter(call => call.path === `/api/v1/jobs/${jobId}`).length, 2);
    assert.equal(api.calls.filter(call => call.path === '/api/v1/candidates/profile').length, 2);
    assert.equal(api.calls.filter(call => call.path === '/api/v1/applications/my-applications').length, 2);
  });

  await t.test('screening API failure is reported as unverifiable, never as absent', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    const api = createReadinessRequest(jobId, {
      screening: new Error('mock screening API unavailable')
    });
    const result = await stage(api.request);
    assert.equal(result.ready, false);
    assert.equal(result.confirmationToken, undefined);
    assert.match(result.reviewMessage, /couldn't verify/);
    assert.doesNotMatch(result.reviewMessage, /no screening questions|required no screening/i);
    assert.equal(api.submissions, 0);
  });

  await t.test('screening completion API failure is reported as unverifiable', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    const api = createReadinessRequest(jobId, {
      screening: { questions: [{ id: 'screening-question-id' }] },
      eligibility: new Error('mock screening eligibility unavailable')
    });
    const result = await stage(api.request);
    assert.equal(result.ready, false);
    assert.equal(result.confirmationToken, undefined);
    assert.match(result.reviewMessage, /couldn't verify whether the required screening has been completed/);
    assert.equal(api.submissions, 0);
  });

  await t.test('started but incomplete dashboard screening is not treated as complete', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    const api = createReadinessRequest(jobId, {
      screening: { questions: [{ id: 'screening-question-id' }] },
      eligibility: { eligible: true, application_id: 'started-screening-application' }
    });
    const result = await stage(api.request);
    assert.equal(result.ready, false);
    assert.equal(result.confirmationToken, undefined);
    assert.match(result.reviewMessage, /screening still incomplete/);
    assert.match(result.reviewMessage, /complete and submit the required questions yourself/);
    assert.equal(api.submissions, 0);
  });

  await t.test('malformed screening data and inconsistent required flag are inconclusive', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    for (const { job, screening } of [
      { job: {}, screening: {} },
      { job: { has_screening: true }, screening: { questions: [] } }
    ]) {
      const api = createReadinessRequest(jobId, { job, screening });
      const result = await stage(api.request);
      assert.equal(result.ready, false);
      assert.equal(result.confirmationToken, undefined);
      assert.match(result.reviewMessage, /couldn't verify|inconclusive/);
      assert.equal(api.submissions, 0);
    }
  });

  await t.test('screening responses supplied to the model cannot bypass dashboard completion', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    const api = createReadinessRequest(jobId, {
      screening: { questions: [{ id: 'screening-question-id' }] }
    });
    const result = await stage(api.request, {
      job_id: jobId,
      screening_responses: [{
        question_id: 'screening-question-id',
        question_text: 'test question',
        selected_option: 'model answer',
        is_correct: true,
        points: 999
      }]
    });
    assert.equal(result.ready, false);
    assert.equal(result.confirmationToken, undefined);
    assert.equal(api.submissions, 0);
  });

  await t.test('an existing screening-pending or completed application is never duplicated', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    for (const status of ['screening_pending', 'screening_completed']) {
      const api = createReadinessRequest(jobId, {
        applications: [{ id: `application-${status}`, job_id: jobId, status }],
        screening: { questions: [{ id: 'screening-question-id' }] },
        eligibility: status === 'screening_completed'
          ? { eligible: false, reason: 'screening_completed', application_id: `application-${status}` }
          : { eligible: true, application_id: `application-${status}` }
      });
      const result = await stage(api.request);
      assert.equal(result.ready, false);
      assert.equal(result.confirmationToken, undefined);
      assert.match(result.reviewMessage, /already has an application|application already exists/);
      assert.equal(api.submissions, 0);
      assert.ok(api.calls.some(call => call.path.endsWith('/screening-questions/for-candidate')));
    }
  });

  await t.test('inactive jobs cannot receive an application confirmation', async () => {
    configureLocalIntegration();
    registerHirePoolLocalDevelopmentIntegration();
    const api = createReadinessRequest(jobId, { job: { status: 'closed' } });
    await assert.rejects(() => stage(api.request), /no longer accepting applications/);
    assert.equal(api.submissions, 0);
  });

  await t.test('candidate identity cannot be overridden by model arguments', async () => {
    assert.equal(action.parameterSchema.safeParse({
      body: { job_id: jobId, candidate_id: 'model-chosen-candidate' }
    }).success, false);
  });
});

test('AI assessment readiness is not inferred from non-candidate APIs or absent job fields', async () => {
  const context = await createCandidateApplicationContext();
  const jobAction = context.registry.list().find(action =>
    action.metadata.dynamicApi.operationId === 'get_job_api_v1_jobs__job_id__get'
  );
  const operationIds = context.registry.list().map(action => action.metadata.dynamicApi.operationId);
  assert.equal(jobAction.metadata.dynamicApi.responseFields.includes('has_ai_interview'), false);
  assert.equal(operationIds.some(operationId => operationId.includes('ai_interview')), false);
  assert.equal(
    context.registry.list().some(action => action.metadata.dynamicApi.operationId ===
      'get_job_ai_interview_status_api_v1_ai_interview_jobs__job_id__status_get'),
    false
  );
});

test('invalid and expired application confirmations do not execute writes', async () => {
  const context = await createCandidateApplicationContext();
  const api = createReadinessRequest(context.jobId);
  const prepared = await stageDynamicApiConfirmation(
    context.action,
    { body: { job_id: context.jobId } },
    context.candidate,
    { readActions: context.registry.list(), request: api.request }
  );
  let executions = 0;
  const execute = async () => { executions += 1; };
  await assert.rejects(
    executeApprovedDynamicApiConfirmation('invalid-confirmation-token', context.candidate, execute),
    error => error.code === 'CONFIRMATION_INVALID_OR_EXPIRED' && /No write was attempted/.test(error.message)
  );
  assert.equal(executions, 0);

  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 3 * 60 * 1000;
    await assert.rejects(
      executeApprovedDynamicApiConfirmation(prepared.confirmationToken, context.candidate, execute),
      error => error.code === 'CONFIRMATION_INVALID_OR_EXPIRED' && /No write was attempted/.test(error.message)
    );
  } finally {
    Date.now = originalNow;
  }
  assert.equal(executions, 0);
  assert.equal(api.submissions, 0);
});

test('wrong-role tools and invalid local bridge origins are rejected', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const integration = getDynamicApiIntegration(HIREPOOL_LOCAL_INTEGRATION_ID);
  const clientSession = storeHirePoolSession('client-test-token', {
    id: 'client-test-user',
    userType: 'client',
    organizationRole: 'admin'
  });
  const client = authenticateHirePoolLocalCredential(clientSession.credential);
  const action = {
    metadata: {
      dynamicApi: {
        integrationId: integration.id,
        assistantId: integration.assistantId,
        applicationId: integration.applicationId,
        operationId: 'get_my_profile_api_v1_candidates_profile_get',
        roles: ['candidate']
      }
    },
    parameterSchema: { safeParse: () => ({ success: true, data: {} }) }
  };
  await assert.rejects(() => executeDynamicApiAction(action, {}, client, {
    request: async () => {
      throw new Error('Wrong-role operation reached the API executor');
    }
  }), /not authorized/);

  configureLocalIntegration();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  const missingCredential = await request(createApp())
    .post('/api/hirepool/session')
    .set('Origin', 'http://attacker.example.test')
    .send({})
    .expect(401);
  assert.equal(missingCredential.body.error.code, 'ORIGIN_NOT_ALLOWED');

  const websiteOrigin = await request(createApp())
    .post('/api/hirepool/session')
    .set('Origin', 'http://localhost:3001')
    .send({})
    .expect(401);
  assert.equal(websiteOrigin.body.error.code, 'ORIGIN_NOT_ALLOWED');

  const dashboardOrigin = await request(createApp())
    .post('/api/hirepool/session')
    .set('Origin', 'http://localhost:5173')
    .set('Authorization', 'Bearer dashboard-must-not-authenticate')
    .send({})
    .unset('Authorization')
    .expect(401);
  assert.equal(dashboardOrigin.body.error.code, 'MISSING_CREDENTIALS');

  const dashboardPreflight = await request(createApp())
    .options('/api/hirepool/session')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,content-type')
    .expect(204);
  assert.equal(dashboardPreflight.headers['access-control-allow-origin'], 'http://localhost:5173');

  const extensionPreflight = await request(createApp())
    .options('/api/hirepool/session')
    .set('Origin', HIREPOOL_LOCAL_EXTENSION_ORIGIN)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,content-type')
    .expect(204);
  assert.equal(extensionPreflight.headers['access-control-allow-origin'], HIREPOOL_LOCAL_EXTENSION_ORIGIN);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:8000/api/v1/auth/me');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Host, 'localhost:8000');
    assert.equal(options.headers.Authorization, 'Bearer invalid-test-token');
    return { ok: false, body: null };
  };
  try {
    const invalidCredential = await request(createApp())
      .post('/api/hirepool/session')
      .set('Origin', HIREPOOL_LOCAL_EXTENSION_ORIGIN)
      .set('Authorization', 'Bearer invalid-test-token')
      .send({})
      .expect(401);
    assert.equal(invalidCredential.body.error.code, 'INVALID_HOST_CREDENTIAL');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest HirePool account requests get one login action and never treat chat text as authentication', async () => {
  configureDisabledBridge();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  let providerCalls = 0;
  const provider = {
    name: 'hirepool-login-test-provider',
    async chat() {
      providerCalls++;
      throw new Error('Unverified HirePool account requests must not reach the model');
    }
  };
  setAIProvider(provider);

  const app = createApp();
  const firstResponse = await request(app)
    .post('/api/chat')
    .send({
      assistantId: 'hirepool',
      message: 'Show me the jobs I have applied for and their application statuses.',
      stream: false
    })
    .expect(200);

  assert.equal(firstResponse.body.text,
    'I can open HirePool login for you. Once your account is securely verified, I can retrieve your profile and personalized application information.');
  assert.equal(firstResponse.body.action.action, 'hirepool_login');
  assert.equal(firstResponse.body.action.title, 'Log in to HirePool');
  assert.equal(firstResponse.body.action.requiresConfirmation, true);
  assert.deepEqual(firstResponse.body.action.parameters, {});

  const response = await request(app)
    .post('/api/chat')
    .send({
      assistantId: 'hirepool',
      conversationId: firstResponse.body.conversationId,
      message: 'ok loggedin',
      stream: false
    })
    .expect(200);

  assert.equal(response.body.text,
    'I understand that you completed login in another tab, but I still need to verify your HirePool session before accessing your account information.');
  assert.equal(response.body.action, undefined);
  assert.equal(response.body.conversationId, firstResponse.body.conversationId);

  const applicationsResponse = await request(app)
    .post('/api/chat')
    .send({
      assistantId: 'hirepool',
      conversationId: firstResponse.body.conversationId,
      message: 'Show me my applications and their statuses.',
      stream: false
    })
    .expect(200);

  assert.match(applicationsResponse.body.text, /can’t verify a HirePool login/);
  assert.equal(applicationsResponse.body.action, undefined);
  assert.equal(applicationsResponse.body.conversationId, firstResponse.body.conversationId);
  assert.equal(providerCalls, 0);
});

test('guest signup requests propose the existing registration flow separately from login', async () => {
  configureDisabledBridge();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  setAIProvider({
    name: 'hirepool-signup-test-provider',
    async chat() {
      throw new Error('Unverified HirePool signup requests must not reach the model');
    }
  });

  const response = await request(createApp())
    .post('/api/chat')
    .send({
      assistantId: 'hirepool',
      message: 'I am new here and want to register.',
      stream: false
    })
    .expect(200);

  assert.equal(response.body.action.action, 'hirepool_signup');
  assert.equal(response.body.action.title, 'Sign up for HirePool');
  assert.match(response.body.text, /sign up for HirePool|role selection/i);
});

test('a candidate-shaped JWT without a validated HirePool session does not unlock account access', async () => {
  configureDisabledBridge();
  process.env.AUTH_MODE = 'jwt';
  process.env.AUTH_REQUIRED = 'false';
  process.env.JWT_SECRET = 'test-only-signing-secret';
  let providerCalls = 0;
  setAIProvider({
    name: 'hirepool-unverified-principal-test-provider',
    async chat() {
      providerCalls++;
      throw new Error('Unverified HirePool account requests must not reach the model');
    }
  });

  const token = signJwt({
    sub: 'unverified-candidate',
    role: 'candidate',
    assistantId: 'hirepool'
  }, process.env.JWT_SECRET);
  const response = await request(createApp())
    .post('/api/chat')
    .set('Authorization', `Bearer ${token}`)
    .send({
      assistantId: 'hirepool',
      message: 'Show me my candidate profile.',
      stream: false
    })
    .expect(200);

  assert.equal(response.body.action.action, 'hirepool_login');
  assert.match(response.body.text, /Once your account is securely verified/);
  assert.equal(providerCalls, 0);
});

test('HirePool SSE chat preserves the same one-off login and verification safeguards', async () => {
  configureDisabledBridge();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  let providerCalls = 0;
  setAIProvider({
    name: 'hirepool-sse-auth-test-provider',
    async chatStream() {
      providerCalls++;
      throw new Error('Unverified HirePool login claims must not reach the model');
    }
  });

  const app = createApp();
  const loginResponse = await request(app)
    .post('/api/chat/stream')
    .send({
      assistantId: 'hirepool',
      message: 'Please log in.',
      stream: true
    })
    .expect('Content-Type', /text\/event-stream/)
    .expect(200);
  assert.match(loginResponse.text, /"action":"hirepool_login"/);
  assert.match(loginResponse.text, /Once your account is securely verified/);

  const conversationId = loginResponse.text.match(
    /"type":"start","conversationId":"([^"]+)"/
  )[1];
  const verificationResponse = await request(app)
    .post('/api/chat/stream')
    .send({
      assistantId: 'hirepool',
      conversationId,
      message: 'done loggedin',
      stream: true
    })
    .expect(200);

  assert.match(verificationResponse.text, /I understand that you completed login in another tab/);
  assert.doesNotMatch(verificationResponse.text, /"type":"action"/);
  assert.equal(providerCalls, 0);
});

test('login continuation binds the guest conversation to a verified user and is single-use', async () => {
  configureLocalIntegration();
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  const app = createApp();
  const conversationId = `continuation-${Date.now()}`;
  sessionManager.getOrCreate(
    conversationId,
    'hirepool',
    createSessionOptions(null, 'hirepool')
  );
  const pendingRequest = 'I want to apply for a job.';
  const continuationReference = createHirePoolContinuation({
    conversationId,
    pendingRequest
  });
  const bridgeSession = storeHirePoolSession('continuation-test-token', {
    id: 'continuation-user',
    userType: 'candidate'
  });

  const resumed = await request(app)
    .post('/api/hirepool/continuation/consume')
    .set('Origin', HIREPOOL_LOCAL_EXTENSION_ORIGIN)
    .set('Authorization', `Bearer ${bridgeSession.credential}`)
    .send({ continuationReference })
    .expect(200);
  assert.equal(resumed.body.conversationId, conversationId);
  assert.equal(resumed.body.pendingRequest, pendingRequest);

  const boundSession = sessionManager.getOrCreate(
    conversationId,
    'hirepool',
    createSessionOptions(authenticateHirePoolLocalCredential(bridgeSession.credential), 'hirepool')
  );
  assert.equal(boundSession.userId, 'continuation-user');

  await request(app)
    .post('/api/hirepool/continuation/consume')
    .set('Origin', HIREPOOL_LOCAL_EXTENSION_ORIGIN)
    .set('Authorization', `Bearer ${bridgeSession.credential}`)
    .send({ continuationReference })
    .expect(410);
});
