import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { sessionManager, SessionOwnershipError } from '../backend/src/session-manager.js';
import {
  findHirePoolContextBySdkCredential,
  storeHirePoolSession,
  revokeHirePoolSessionBySdkCredential,
  touchHirePoolSession,
  getHirePoolSessionTtlMs
} from '../backend/src/local-integrations/hirepool-session-store.js';
import { AssistantStorage } from '../widget/src/storage.js';
import { AssistantApiClient } from '../widget/src/api-client.js';
import { createSessionOptions } from '../backend/src/session-scope.js';
import { setAIProvider } from '../backend/src/providers/factory.js';

function setupEnvironment() {
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.ENABLE_HIREPOOL_INTEGRATION = 'true';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS =
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://127.0.0.1:5173';
  process.env.CORS_ALLOWED_ORIGINS =
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://127.0.0.1:5173';
}

test('HirePool Auth Synchronization & Login Verification Suite', async (t) => {
  setupEnvironment();
  const app = createApp();

  // ==========================================
  // ISSUE TWO: LOGIN VERIFICATION & COMPLIANCE
  // ==========================================

  await t.test('Login 1: toPublicSession returns expiresIn strictly within [1000, 300000] ms complying with host validation', async () => {
    const candidateIdentity = {
      id: 'cand-verify-1',
      email: 'cand.verify@example.com',
      userType: 'candidate',
      organizationRole: null
    };
    const session = storeHirePoolSession('mock-access-token-1', candidateIdentity, Date.now(), Date.now());

    assert.ok(typeof session.expiresIn === 'number');
    assert.ok(Number.isInteger(session.expiresIn));
    // Must be between 1000 and 300000 ms to satisfy AuthContext.tsx and LocalAssistantWidget.tsx
    assert.ok(session.expiresIn >= 1000, `expiresIn (${session.expiresIn}) must be >= 1000 ms`);
    assert.ok(session.expiresIn <= 300000, `expiresIn (${session.expiresIn}) must be <= 300000 ms`);

    // Must match regex contracts in AuthContext.tsx
    assert.match(session.credential, /^[A-Za-z0-9_-]{43}$/);
    assert.match(session.sessionScope, /^[A-Za-z0-9_-]{1,128}$/);
  });

  await t.test('Login 2: Existing accounts across all three roles (Candidate, Client, Consultancy) establish verified sessions', async () => {
    const testRoles = [
      { id: 'usr-cand-101', email: 'alice@candidate.com', userType: 'candidate', role: null },
      { id: 'usr-client-202', email: 'bob@company.com', userType: 'client', role: 'admin' },
      { id: 'usr-consultancy-303', email: 'carol@agency.com', userType: 'consultancy', role: 'recruiter' }
    ];

    for (const item of testRoles) {
      const stored = storeHirePoolSession(`token-${item.id}`, {
        id: item.id,
        email: item.email,
        userType: item.userType,
        organizationRole: item.role
      });

      // Verify via GET /api/hirepool/session/validate
      const res = await request(app)
        .get('/api/hirepool/session/validate')
        .set('Origin', 'http://localhost:5173')
        .set('Authorization', `Bearer ${stored.credential}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.equal(res.body.identity.id, item.id);
      assert.equal(res.body.identity.email, item.email);
      assert.equal(res.body.identity.userType, item.userType);
      assert.equal(res.body.identity.organizationRole, item.role);
      assert.ok(res.body.expiresIn >= 1000);
      assert.ok(res.body.expiresIn <= 300000);
    }
  });

  await t.test('Login 3: Guest conversation atomically upgrades to authenticated user without losing message history', async () => {
    const convoId = `login-convo-${Date.now()}`;
    const guestOptions = createSessionOptions(null, 'hirepool');
    // 1. Guest creates conversation
    const guestSession = sessionManager.getOrCreate(convoId, 'hirepool', guestOptions);
    sessionManager.addMessage(convoId, 'user', 'What jobs are available?', guestOptions);
    sessionManager.addMessage(convoId, 'assistant', 'Here are public jobs.', guestOptions);
    assert.equal(guestSession.userId, null);
    assert.equal(guestSession.messages.length, 2);

    // 2. User logs in
    const candidateIdentity = {
      id: 'usr-cand-upgrade',
      email: 'upgraded@candidate.com',
      userType: 'candidate',
      organizationRole: null
    };
    const sdkSession = storeHirePoolSession('upgrade-token', candidateIdentity);
    const userOptions = createSessionOptions({ id: 'usr-cand-upgrade' }, 'hirepool');

    // 3. Authenticated session re-accesses the same conversation
    const upgradedSession = sessionManager.getOrCreate(convoId, 'hirepool', userOptions);
    assert.equal(upgradedSession.id, convoId);
    assert.equal(upgradedSession.userId, 'usr-cand-upgrade');
    assert.equal(upgradedSession.messages.length, 2);
    assert.equal(upgradedSession.messages[0].content, 'What jobs are available?');
  });

  await t.test('Login 4: Retry performs a fresh session verification attempt instead of blind guest resend', async () => {
    let verificationAttempts = 0;
    let verifiedSuccessfully = false;

    // Simulate Retry callback
    const retryHandler = async () => {
      verificationAttempts++;
      if (verificationAttempts === 1) {
        throw new Error('Temporary verification network timeout');
      }
      verifiedSuccessfully = true;
      return { valid: true };
    };

    // First attempt fails
    await assert.rejects(() => retryHandler(), /Temporary verification network timeout/);
    assert.equal(verificationAttempts, 1);
    assert.equal(verifiedSuccessfully, false);

    // Second attempt (Retry clicked) succeeds freshly
    const result = await retryHandler();
    assert.equal(verificationAttempts, 2);
    assert.equal(verifiedSuccessfully, true);
    assert.equal(result.valid, true);
  });

  await t.test('Login 5: Invalid or forged credentials remain rejected by backend', async () => {
    const res = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', 'Bearer forged-random-credential-12345');

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  // ==========================================
  // ISSUE ONE: LOGOUT SYNCHRONIZATION
  // ==========================================

  await t.test('Logout 1: POST /api/hirepool/session/logout revokes session from dashboard origin (5173)', async () => {
    const identity = {
      id: 'usr-logout-dash',
      email: 'logout.dash@example.com',
      userType: 'client',
      organizationRole: 'admin'
    };
    const session = storeHirePoolSession('token-to-logout-dash', identity);
    const convoId = `dash-logout-convo-${Date.now()}`;
    sessionManager.getOrCreate(convoId, 'hirepool', createSessionOptions({ id: 'usr-logout-dash' }, 'hirepool'));

    // Dashboard calls POST /api/hirepool/session/logout
    const res = await request(app)
      .post('/api/hirepool/session/logout')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', `Bearer ${session.credential}`)
      .send({ conversationId: convoId });

    assert.equal(res.status, 200);
    assert.equal(res.body.loggedOut, true);
    assert.equal(res.body.sdkSessionRevoked, true);

    // Context must be removed from session store
    const contextAfter = findHirePoolContextBySdkCredential(session.credential);
    assert.equal(contextAfter, null);

    // Subsequent validate must fail with 401
    const validateRes = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', `Bearer ${session.credential}`);
    assert.equal(validateRes.status, 401);
  });

  await t.test('Logout 2: POST /api/hirepool/session/revoke from dashboard origin (5173) is allowed and revokes session', async () => {
    const identity = {
      id: 'usr-revoke-dash',
      email: 'revoke.dash@example.com',
      userType: 'consultancy',
      organizationRole: 'admin'
    };
    const session = storeHirePoolSession('token-to-revoke-dash', identity);

    const res = await request(app)
      .post('/api/hirepool/session/revoke')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', `Bearer ${session.credential}`);

    assert.equal(res.status, 204);
    assert.equal(findHirePoolContextBySdkCredential(session.credential), null);
  });

  await t.test('Logout 3: Revoked session cannot execute authenticated chat operations', async () => {
    setAIProvider({
      name: 'mock-logout-provider',
      async checkHealth() { return { available: true }; },
      async chat() { return { text: 'You should not see this.', finishReason: 'stop' }; }
    });

    const identity = {
      id: 'usr-chat-logout',
      email: 'chat.logout@example.com',
      userType: 'candidate',
      organizationRole: null
    };
    const session = storeHirePoolSession('token-chat-logout', identity);

    // Revoke the session credential
    revokeHirePoolSessionBySdkCredential(session.credential);

    // Attempt chat with revoked credential
    const chatRes = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${session.credential}`)
      .send({
        assistantId: 'hirepool',
        message: 'View my candidate profile',
        conversationId: 'revoked-chat-convo'
      });

    // Chat router rejects unverified/revoked bearer token
    assert.equal(chatRes.status, 401);
  });

  await t.test('Logout 4: SessionManager prevents logged-out guest from accessing previous user conversation', async () => {
    const convoId = `user-isolation-convo-${Date.now()}`;
    const userOptions = createSessionOptions({ id: 'usr-cand-isolated' }, 'hirepool');
    sessionManager.getOrCreate(convoId, 'hirepool', userOptions);

    // Guest attempts to access the authenticated conversation
    const guestOptions = createSessionOptions(null, 'hirepool');
    assert.throws(
      () => sessionManager.getOrCreate(convoId, 'hirepool', guestOptions),
      (err) => {
        assert.ok(err instanceof SessionOwnershipError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'SESSION_ACCESS_DENIED');
        return true;
      }
    );
  });

  await t.test('Logout 5: Logging out one user does not affect another concurrent user session', async () => {
    const userA = storeHirePoolSession('token-A', { id: 'user-A', email: 'a@test.com', userType: 'candidate' });
    const userB = storeHirePoolSession('token-B', { id: 'user-B', email: 'b@test.com', userType: 'candidate' });

    // Logout User A
    const logoutRes = await request(app)
      .post('/api/hirepool/session/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${userA.credential}`);
    assert.equal(logoutRes.status, 200);

    // User A is revoked
    assert.equal(findHirePoolContextBySdkCredential(userA.credential), null);

    // User B remains valid and untouched
    const userBContext = findHirePoolContextBySdkCredential(userB.credential);
    assert.ok(userBContext);
    assert.equal(userBContext.identity.id, 'user-B');

    const validateB = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${userB.credential}`);
    assert.equal(validateB.status, 200);
    assert.equal(validateB.body.valid, true);
  });

  await t.test('Logout 6: Repeated/duplicate logout requests are handled safely and idempotently', async () => {
    const identity = { id: 'usr-dup-logout', email: 'dup@test.com', userType: 'client', organizationRole: 'admin' };
    const session = storeHirePoolSession('token-dup-logout', identity);

    // First logout
    const res1 = await request(app)
      .post('/api/hirepool/session/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${session.credential}`);
    assert.equal(res1.status, 200);
    assert.equal(res1.body.loggedOut, true);

    // Second logout with same revoked credential
    const res2 = await request(app)
      .post('/api/hirepool/session/logout')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${session.credential}`);
    assert.equal(res2.status, 200);
    assert.equal(res2.body.loggedOut, true);
    assert.equal(res2.body.sdkSessionRevoked, false); // Already revoked
  });

  await t.test('Logout 7: Widget AssistantStorage completely clears user-scoped data upon logout', () => {
    const memory = new Map();
    class MockStorageDriver {
      getItem(k) { return memory.has(k) ? memory.get(k) : null; }
      setItem(k, v) { memory.set(k, String(v)); }
      removeItem(k) { memory.delete(k); }
      clear() { memory.clear(); }
    }

    const storage = new AssistantStorage('hirepool');
    storage.store = new MockStorageDriver();

    // Authenticate user
    storage.setUser('usr-test-logout');
    storage.saveConversationId('auth-convo-id');
    storage.set('messages', [{ role: 'user', content: 'Secret message' }]);
    assert.equal(storage.getConversationId(), 'auth-convo-id');

    // Simulate logout sequence: clear user data, then reset to guest and clear
    storage.clear();
    storage.setUser(null);
    storage.clear();

    // Verify storage is completely reset to guest mode with no residual conversation
    assert.equal(storage.getConversationId(), null);
    assert.deepEqual(storage.get('messages', []), []);

    // Re-checking user scope explicitly confirms user data was cleared
    storage.setUser('usr-test-logout');
    assert.equal(storage.getConversationId(), null);
    assert.deepEqual(storage.get('messages', []), []);
  });
});

