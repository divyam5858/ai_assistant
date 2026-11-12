import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {
  HirePoolSignupCoordinator,
  HIREPOOL_SIGNUP_STATES,
  ROLE_DEFINITIONS
} from '../widget/src/hirepool-signup.js';
import { createHirePoolSignupRouter } from '../backend/src/routes/hirepool-signup.js';
import { hirePoolAuthRouter } from '../backend/src/local-integrations/hirepool-auth.js';
import { chatRouter } from '../backend/src/routes/chat.js';
import { sessionManager } from '../backend/src/session-manager.js';
import {
  findHirePoolContextBySdkCredential,
  storeHirePoolSession,
  getHirePoolSessionTtlMs
} from '../backend/src/local-integrations/hirepool-session-store.js';
import { registerHirePoolLocalDevelopmentIntegration } from '../integrations/hirepool/local-development.js';

function createMockBackend() {
  const users = new Map();
  const profiles = new Map();
  const agreements = {
    candidate: { id: 'agr-cand-1', role: 'candidate', version: '1.0', content: 'Candidate agreement' },
    client: { id: 'agr-client-1', role: 'client', version: '1.0', content: 'Client agreement' },
    consultancy: { id: 'agr-cons-1', role: 'consultancy', version: '1.0', content: 'Consultancy agreement' }
  };

  return {
    users,
    profiles,
    agreements,
    fetchMock: async (url, options = {}) => {
      const urlStr = url.toString();
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : {};

      // Agreement endpoint
      if (urlStr.includes('/api/v1/agreements/current')) {
        const parsedUrl = new URL(urlStr);
        const role = parsedUrl.searchParams.get('role');
        const agr = agreements[role];
        if (agr) {
          return { ok: true, status: 200, json: async () => agr };
        }
        return { ok: false, status: 404, json: async () => ({ detail: 'Agreement not found' }) };
      }

      // Register endpoint
      if (urlStr.includes('/api/v1/auth/register') && method === 'POST') {
        if (!['candidate', 'client', 'consultancy'].includes(body.user_type)) {
          return { ok: false, status: 400, json: async () => ({ detail: 'Invalid user_type: only candidate, client, consultancy allowed' }) };
        }
        const user = {
          id: `usr-${Date.now()}`,
          email: body.email,
          user_type: body.user_type,
          is_verified: false
        };
        users.set(body.email, user);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            access_token: `mock-token-${user.id}`,
            refresh_token: `mock-refresh-${user.id}`,
            user: { ...user, is_active: true, has_completed_onboarding: false }
          })
        };
      }

      // Auth /me endpoint
      if (urlStr.includes('/api/v1/auth/me')) {
        const auth = options.headers?.Authorization || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        const user = [...users.values()].find(u => `mock-token-${u.id}` === token);
        if (user) {
          return { ok: true, status: 200, json: async () => user };
        }
        return { ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) };
      }

      // Profiles endpoint
      if (urlStr.includes('/profile') && method === 'POST') {
        const auth = options.headers?.Authorization || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        const user = [...users.values()].find(u => `mock-token-${u.id}` === token);
        profiles.set(user?.id || 'default', body);
        return { ok: true, status: 200, json: async () => ({ id: 'prof-1', ...body }) };
      }

      if (urlStr.includes('/profile') && method === 'GET') {
        const auth = options.headers?.Authorization || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        const user = [...users.values()].find(u => `mock-token-${u.id}` === token);
        const p = profiles.get(user?.id || 'default') || { name: 'Verified Profile' };
        return { ok: true, status: 200, json: async () => p };
      }

      return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) };
    }
  };
}

function createFullApp(mockBackend) {
  const app = express();
  app.use(express.json());

  // Setup environment for testing
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.AI_PROVIDER = 'mock';
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';

  registerHirePoolLocalDevelopmentIntegration();

  const signupRouter = createHirePoolSignupRouter({
    fetchImpl: mockBackend.fetchMock,
    baseUrl: 'http://localhost:8000/'
  });

  app.use('/api/hirepool/signup', signupRouter);
  app.use('/api/hirepool', hirePoolAuthRouter);
  app.use('/api/chat', chatRouter);

  return app;
}

test('HirePool Signup-to-Authentication Transition and Persistence', async (t) => {
  await t.test('executes complete 16-step deterministic FSM from IDLE to COMPLETED', async () => {
    const mockBackend = createMockBackend();
    const app = createFullApp(mockBackend);
    const recordedStates = [];

    // Create apiClient mock that routes to our express app
    const apiClient = {
      getSignupAgreement: async (role) => {
        const res = await request(app).get(`/api/hirepool/signup/agreement?role=${role}`)
          .set('Origin', 'http://localhost:3000');
        return res.body;
      },
      signupRegister: async (payload) => {
        const res = await request(app).post('/api/hirepool/signup/register')
          .set('Origin', 'http://localhost:3000')
          .send(payload);
        return res.body;
      },
      checkSignupVerificationStatus: async (signupToken) => {
        const res = await request(app).post('/api/hirepool/signup/check-verification')
          .set('Origin', 'http://localhost:3000')
          .send({ signupToken });
        return res.body;
      },
      completeSignupProfile: async (payload) => {
        const res = await request(app).post('/api/hirepool/signup/complete-profile')
          .set('Origin', 'http://localhost:3000')
          .send(payload);
        return res.body;
      },
      validateHirePoolSession: async (credential) => {
        const res = await request(app).get('/api/hirepool/session/validate')
          .set('Origin', 'http://localhost:3000')
          .set('Authorization', `Bearer ${credential}`);
        return res.body;
      }
    };

    let authenticatedSession = null;
    const coordinator = new HirePoolSignupCoordinator({
      apiClient,
      onAuthenticated: async (session) => {
        authenticatedSession = session;
        // Verify smoke test passes
        const smoke = await apiClient.validateHirePoolSession(session.credential);
        assert.equal(smoke.valid, true);
      },
      onStateChange: (st) => {
        recordedStates.push(st);
      }
    });

    // Step 1: IDLE
    assert.equal(coordinator.state, HIREPOOL_SIGNUP_STATES.IDLE);

    // Step 2: ROLE_SELECTION
    await coordinator.start();
    assert.equal(coordinator.state, HIREPOOL_SIGNUP_STATES.ROLE_SELECTION);

    // Step 3 & 4: AGREEMENT_FETCHING -> SIGNUP_FORM
    await coordinator.selectRole('consultancy');
    assert.equal(coordinator.state, HIREPOOL_SIGNUP_STATES.SIGNUP_FORM);
    assert.ok(coordinator.agreement);
    assert.equal(coordinator.agreement.role, 'consultancy');

    // Step 5, 6, 7: REGISTERING -> REGISTRATION_CONFIRMED -> EMAIL_VERIFICATION_PENDING
    await coordinator.submitSignup({
      email: 'recruiter@agency.test',
      password: 'SecurePassword123',
      confirmPassword: 'SecurePassword123'
    });
    assert.equal(coordinator.state, HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING);
    assert.ok(coordinator.session?.signupToken);

    // Check verification before clicking link (should remain pending)
    const pendingCheck = await coordinator.checkVerificationStatus();
    assert.equal(pendingCheck.isVerified, false);

    // Simulate user clicking magic link in email (updates backend record)
    const user = mockBackend.users.get('recruiter@agency.test');
    assert.ok(user);
    user.is_verified = true;

    // Step 8, 9, 10: EMAIL_VERIFICATION_IN_PROGRESS -> EMAIL_VERIFIED -> PROFILE_COLLECTION
    const verifiedCheck = await coordinator.checkVerificationStatus();
    assert.equal(verifiedCheck.isVerified, true);
    assert.equal(coordinator.state, HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION);

    // Step 11: PROFILE_REVIEW
    coordinator.profileData = {
      consultancy_name: 'Apex Talent Partners',
      consultancy_type: 'staffing',
      industry_specialization: ['Technology', 'Cloud Computing'],
      headquarters_location: 'Bengaluru',
      primary_contact: {
        full_name: 'Vikram Mehta',
        designation: 'Managing Partner',
        phone: '+91 98765 43210'
      }
    };
    coordinator.setState(HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW);
    assert.equal(coordinator.state, HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW);

    // Step 12, 13, 14, 15, 16: PROFILE_SUBMITTING -> PROFILE_READBACK -> AUTH_SESSION_ESTABLISHED -> AUTHENTICATION_SMOKE_TEST -> COMPLETED
    const completionResult = await coordinator.completeProfile();
    assert.equal(coordinator.state, HIREPOOL_SIGNUP_STATES.COMPLETED);
    assert.equal(completionResult.status, 'success');
    assert.ok(completionResult.credential);
    assert.ok(authenticatedSession);
    assert.equal(authenticatedSession.role, 'consultancy');
    assert.equal(authenticatedSession.identity.userType, 'consultancy');

    // Verify sequential states visited
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.ROLE_SELECTION));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.AGREEMENT_FETCHING));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.SIGNUP_FORM));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.REGISTERING));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.REGISTRATION_CONFIRMED));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.PROFILE_SUBMITTING));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.PROFILE_READBACK));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.AUTH_SESSION_ESTABLISHED));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.AUTHENTICATION_SMOKE_TEST));
    assert.ok(recordedStates.includes(HIREPOOL_SIGNUP_STATES.COMPLETED));
  });

  await t.test('maps Staffing Agency to consultancy role and preserves staffing consultancy_type', async () => {
    const mockBackend = createMockBackend();
    const app = createFullApp(mockBackend);

    const coordinator = new HirePoolSignupCoordinator({
      apiClient: {
        getSignupAgreement: async (role) => {
          assert.equal(role, 'consultancy'); // Crucial: must request consultancy agreement!
          const res = await request(app).get(`/api/hirepool/signup/agreement?role=${role}`)
            .set('Origin', 'http://localhost:3000');
          return res.body;
        }
      }
    });

    // User selects 'staffing'
    await coordinator.selectRole('staffing');
    assert.equal(coordinator.selectedRole, 'consultancy');
    assert.equal(coordinator.profileData.consultancy_type, 'staffing');
    assert.equal(coordinator.agreement.role, 'consultancy');
  });

  await t.test('GET /api/hirepool/session/validate performs robust authentication smoke testing', async () => {
    const mockBackend = createMockBackend();
    const app = createFullApp(mockBackend);

    // 1. Unauthenticated request without bearer token
    const resNoAuth = await request(app).get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000');
    assert.equal(resNoAuth.status, 401);

    // 2. Invalid bearer token
    const resInvalid = await request(app).get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', 'Bearer invalid-token-xyz-1234567890');
    assert.equal(resInvalid.status, 401);

    // 3. Valid stored session
    const validSession = storeHirePoolSession(
      'token-smoke-test',
      { id: 'usr-smoke-1', email: 'smoke@example.test', userType: 'consultancy', organizationRole: 'admin' },
      Date.now(),
      Date.now()
    );

    const resValid = await request(app).get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${validSession.credential}`);
    assert.equal(resValid.status, 200);
    assert.equal(resValid.body.valid, true);
    assert.equal(resValid.body.identity.userType, 'consultancy');
    assert.equal(resValid.body.identity.email, 'smoke@example.test');
  });

  await t.test('post-signup chat turn with newly established credential executes as authenticated consultancy user without login redirect', async () => {
    const mockBackend = createMockBackend();
    const app = createFullApp(mockBackend);

    // Create session in store directly (simulating complete-profile output)
    const sdkSession = storeHirePoolSession(
      'token-cons-turn',
      {
        id: 'cons-user-42',
        email: 'agency-lead@talentsource.test',
        userType: 'consultancy',
        organizationRole: 'admin'
      },
      Date.now(),
      Date.now()
    );

    // Context lookup verification
    const context = findHirePoolContextBySdkCredential(sdkSession.credential);
    assert.ok(context);
    assert.equal(context.identity.userType, 'consultancy');

    // Execute chat turn as authenticated consultancy partner: "I have candidates currently on the bench"
    const convoId = 'bench-convo-101';
    const chatRes = await request(app).post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({
        assistantId: 'hirepool',
        conversationId: convoId,
        message: 'I have candidates currently on the bench',
        stream: false
      });

    assert.equal(chatRes.status, 200);
    // Crucial: Must NEVER return hirepool_login action!
    assert.notEqual(chatRes.body.action?.action, 'hirepool_login');
    // Must NEVER return guest limitation message
    assert.doesNotMatch(chatRes.body.text, /I can't verify a HirePool login/);
    assert.doesNotMatch(chatRes.body.text, /I understand that you completed login in another tab/);

    // Verify session persistence in sessionManager
    const storedSession = sessionManager.sessions.get(convoId);
    assert.ok(storedSession);
    assert.equal(storedSession.userId, 'cons-user-42');
    assert.equal(storedSession.hirePoolLoginOffered, false);
    assert.equal(storedSession.hirePoolAccountActionOffered, null);
  });
});
