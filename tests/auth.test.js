import { test, describe, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';
import {
  signJwt,
  verifyJwt,
  authenticate,
  requireAuth,
  requireTenant,
  requireRole,
  AuthenticationError,
  AuthorizationError
} from '../backend/src/middleware/auth.js';
import {
  SessionManager,
  sessionManager,
  SessionOwnershipError,
  TenantMismatchError
} from '../backend/src/session-manager.js';

const TEST_JWT_SECRET = 'test-secret-key-do-not-use-in-production-12345';
const ALT_JWT_SECRET = 'different-secret-key-for-mismatch-testing-67890';

describe('Milestone 4 — Backend Authentication and Authorization', () => {

  describe('1. Cryptographic JWT Signing & Verification (verifyJwt / signJwt)', () => {
    test('signJwt generates valid 3-part HS256 JWT string', () => {
      const token = signJwt({ sub: 'user_123', role: 'admin' }, TEST_JWT_SECRET);
      assert.equal(typeof token, 'string');
      const parts = token.split('.');
      assert.equal(parts.length, 3);
    });

    test('verifyJwt successfully verifies signature and decodes claims', () => {
      const payload = { sub: 'user_456', tenant_id: 'tenant_abc', role: 'candidate' };
      const token = signJwt(payload, TEST_JWT_SECRET, { expiresIn: 300 });

      const decoded = verifyJwt(token, TEST_JWT_SECRET);
      assert.equal(decoded.sub, 'user_456');
      assert.equal(decoded.tenant_id, 'tenant_abc');
      assert.equal(decoded.role, 'candidate');
      assert.ok(decoded.exp > Math.floor(Date.now() / 1000));
      assert.ok(decoded.iat <= Math.floor(Date.now() / 1000));
    });

    test('verifyJwt rejects missing or empty token with MISSING_CREDENTIALS', () => {
      assert.throws(
        () => verifyJwt('', TEST_JWT_SECRET),
        (err) => err instanceof AuthenticationError && err.code === 'MISSING_CREDENTIALS'
      );
      assert.throws(
        () => verifyJwt(null, TEST_JWT_SECRET),
        (err) => err instanceof AuthenticationError && err.code === 'MISSING_CREDENTIALS'
      );
    });

    test('verifyJwt rejects malformed token with INVALID_TOKEN', () => {
      assert.throws(
        () => verifyJwt('not.a.valid.jwt.token', TEST_JWT_SECRET),
        (err) => err instanceof AuthenticationError && err.code === 'INVALID_TOKEN'
      );
      assert.throws(
        () => verifyJwt('only-one-part', TEST_JWT_SECRET),
        (err) => err instanceof AuthenticationError && err.code === 'INVALID_TOKEN'
      );
    });

    test('verifyJwt rejects token with tampered signature with INVALID_TOKEN', () => {
      const token = signJwt({ sub: 'user_tamper' }, TEST_JWT_SECRET);
      const parts = token.split('.');
      // Tamper with payload
      const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'user_admin_escalated' })).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      assert.throws(
        () => verifyJwt(tamperedToken, TEST_JWT_SECRET),
        (err) => err instanceof AuthenticationError && err.code === 'INVALID_TOKEN'
      );
    });

    test('verifyJwt rejects token signed with wrong secret with INVALID_TOKEN', () => {
      const token = signJwt({ sub: 'user_wrong_key' }, ALT_JWT_SECRET);

      assert.throws(
        () => verifyJwt(token, TEST_JWT_SECRET),
        (err) => err instanceof AuthenticationError && err.code === 'INVALID_TOKEN'
      );
    });

    test('verifyJwt rejects expired token with EXPIRED_TOKEN', () => {
      // Token expired 10 seconds ago
      const token = signJwt({ sub: 'user_expired' }, TEST_JWT_SECRET, { expiresIn: -10 });

      assert.throws(
        () => verifyJwt(token, TEST_JWT_SECRET, { clockTolerance: 0 }),
        (err) => err instanceof AuthenticationError && err.code === 'EXPIRED_TOKEN'
      );
    });

    test('verifyJwt validates issuer (iss) and rejects mismatch', () => {
      const token = signJwt({ sub: 'user_iss' }, TEST_JWT_SECRET, { issuer: 'auth.example.com' });

      // Matching issuer passes
      const valid = verifyJwt(token, TEST_JWT_SECRET, { issuer: 'auth.example.com' });
      assert.equal(valid.sub, 'user_iss');

      // Mismatched issuer throws INVALID_TOKEN
      assert.throws(
        () => verifyJwt(token, TEST_JWT_SECRET, { issuer: 'other.example.com' }),
        (err) => err instanceof AuthenticationError && err.code === 'INVALID_TOKEN' && err.message.includes('Token issuer mismatch')
      );
    });

    test('verifyJwt validates audience (aud) and rejects mismatch', () => {
      const token = signJwt({ sub: 'user_aud' }, TEST_JWT_SECRET, { audience: 'ai-assistant-api' });

      // Matching audience passes
      const valid = verifyJwt(token, TEST_JWT_SECRET, { audience: 'ai-assistant-api' });
      assert.equal(valid.sub, 'user_aud');

      // Mismatched audience throws INVALID_TOKEN
      assert.throws(
        () => verifyJwt(token, TEST_JWT_SECRET, { audience: 'other-api' }),
        (err) => err instanceof AuthenticationError && err.code === 'INVALID_TOKEN' && err.message.includes('Token audience mismatch')
      );
    });
  });

  describe('2. Authentication Middleware Unit Behavior (authenticate / requireAuth)', () => {
    test('passes unauthenticated requests in development when auth is not required', (t, done) => {
      const middleware = authenticate({ required: false, mode: 'none' });
      const req = { headers: {} };
      const res = {};
      middleware(req, res, (err) => {
        assert.ifError(err);
        assert.equal(req.user, null);
        done();
      });
    });

    test('authenticates valid Bearer token and populates req.user without trusting body identity', (t, done) => {
      const token = signJwt({ sub: 'user_trusted', tenant_id: 'tenant_trusted', role: 'admin' }, TEST_JWT_SECRET);
      const middleware = authenticate({ required: true, jwtSecret: TEST_JWT_SECRET, mode: 'jwt' });

      const req = {
        headers: { authorization: `Bearer ${token}` },
        body: { userId: 'untrusted_spoofed_user', tenantId: 'untrusted_spoofed_tenant' }
      };
      const res = {};

      middleware(req, res, (err) => {
        assert.ifError(err);
        assert.ok(req.user);
        assert.equal(req.user.id, 'user_trusted'); // Trusted token claim
        assert.equal(req.user.tenantId, 'tenant_trusted'); // Trusted token claim
        assert.equal(req.user.role, 'admin');
        assert.notEqual(req.user.id, req.body.userId); // Body field ignored
        done();
      });
    });

    test('maps HirePool user_type claim to the trusted SDK role', (t, done) => {
      const token = signJwt({ sub: 'candidate-123', user_type: 'candidate' }, TEST_JWT_SECRET);
      const middleware = authenticate({ required: true, jwtSecret: TEST_JWT_SECRET, mode: 'jwt' });
      const req = { headers: { authorization: `Bearer ${token}` }, body: { role: 'admin' } };

      middleware(req, {}, (err) => {
        assert.ifError(err);
        assert.equal(req.user.role, 'candidate');
        assert.notEqual(req.user.role, req.body.role);
        done();
      });
    });

    test('rejects a valid JWT without a stable user identity', (t, done) => {
      const token = signJwt({ user_type: 'candidate' }, TEST_JWT_SECRET);
      const middleware = authenticate({ required: true, jwtSecret: TEST_JWT_SECRET, mode: 'jwt' });
      const req = { headers: { authorization: `Bearer ${token}` } };

      middleware(req, {}, (err) => {
        assert.ok(err instanceof AuthenticationError);
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'INVALID_TOKEN');
        assert.equal(req.user, undefined);
        done();
      });
    });

    test('rejects missing credentials with 401 MISSING_CREDENTIALS when required', (t, done) => {
      const middleware = authenticate({ required: true, jwtSecret: TEST_JWT_SECRET, mode: 'jwt' });
      const req = { headers: {} };
      const res = {};

      middleware(req, res, (err) => {
        assert.ok(err);
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'MISSING_CREDENTIALS');
        done();
      });
    });

    test('rejects invalid Bearer token with 401 INVALID_TOKEN', (t, done) => {
      const middleware = authenticate({ required: true, jwtSecret: TEST_JWT_SECRET, mode: 'jwt' });
      const req = { headers: { authorization: 'Bearer invalid.token.signature' } };
      const res = {};

      middleware(req, res, (err) => {
        assert.ok(err);
        assert.equal(err.statusCode, 401);
        assert.equal(err.code, 'INVALID_TOKEN');
        done();
      });
    });

    test('authenticates valid API Key via X-API-Key header', (t, done) => {
      const testApiKey = 'service-api-key-xyz-789';
      const middleware = authenticate({ required: true, apiKey: testApiKey, mode: 'api-key' });
      const req = { headers: { 'x-api-key': testApiKey, 'x-tenant-id': 'untrusted-tenant' } };
      const res = {};

      middleware(req, res, (err) => {
        assert.ifError(err);
        assert.ok(req.user);
        assert.equal(req.user.id, 'service_principal');
        assert.equal(req.user.isService, true);
        assert.equal(req.user.tenantId, null);
        done();
      });
    });

    test('production defaults to required JWT authentication instead of anonymous access', (t, done) => {
      const previous = {
        nodeEnv: process.env.NODE_ENV,
        authMode: process.env.AUTH_MODE,
        authRequired: process.env.AUTH_REQUIRED,
        jwtSecret: process.env.JWT_SECRET
      };
      process.env.NODE_ENV = 'production';
      delete process.env.AUTH_MODE;
      delete process.env.AUTH_REQUIRED;
      delete process.env.JWT_SECRET;
      let authError;
      authenticate()({ headers: {} }, {}, (err) => {
        authError = err;
      });
      if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous.nodeEnv;
      if (previous.authMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previous.authMode;
      if (previous.authRequired === undefined) delete process.env.AUTH_REQUIRED;
      else process.env.AUTH_REQUIRED = previous.authRequired;
      if (previous.jwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous.jwtSecret;
      assert.ok(authError);
      assert.equal(authError.statusCode, 500);
      assert.equal(authError.code, 'CONFIG_ERROR');
      done();
    });

    test('fails safely with 500 when required auth mode is misconfigured without secret', (t, done) => {
      const middleware = authenticate({ required: true, jwtSecret: null, mode: 'jwt' });
      const req = { headers: {} };
      const res = {};

      middleware(req, res, (err) => {
        assert.ok(err);
        assert.equal(err.statusCode, 500);
        assert.equal(err.code, 'CONFIG_ERROR');
        assert.ok(err.message.includes('not configured'));
        done();
      });
    });

    test('requireTenant rejects authenticated request without tenantId with 403', (t, done) => {
      const guard = requireTenant();
      const req = { user: { id: 'user_no_tenant', tenantId: null } };
      const res = {};

      guard(req, res, (err) => {
        assert.ok(err);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'TENANT_REQUIRED');
        done();
      });
    });

    test('requireRole permits permitted role and rejects unauthorized role with 403', (t, done) => {
      const guard = requireRole(['admin', 'consultancy']);
      const allowedReq = { user: { id: 'u1', role: 'consultancy' } };
      const forbiddenReq = { user: { id: 'u2', role: 'candidate' } };

      guard(allowedReq, {}, (err) => {
        assert.ifError(err);

        guard(forbiddenReq, {}, (forbiddenErr) => {
          assert.ok(forbiddenErr);
          assert.equal(forbiddenErr.statusCode, 403);
          assert.equal(forbiddenErr.code, 'INSUFFICIENT_PERMISSIONS');
          done();
        });
      });
    });
  });

  describe('3. Session Ownership & Tenant Isolation in SessionManager', () => {
    let sm;

    beforeEach(() => {
      sm = new SessionManager({ ttlMs: 10000, maxContextMessages: 10 });
    });

    afterEach(() => {
      sm.close();
    });

    test('creates session with authenticated userId and tenantId', () => {
      const session = sm.getOrCreate('sess-100', 'default', { userId: 'user_alice', tenantId: 'tenant_acme' });
      assert.equal(session.id, 'sess-100');
      assert.equal(session.userId, 'user_alice');
      assert.equal(session.tenantId, 'tenant_acme');
    });

    test('allows same user to access their own session', () => {
      sm.getOrCreate('sess-own', 'default', { userId: 'user_bob' });
      const retrieved = sm.getOrCreate('sess-own', 'default', { userId: 'user_bob' });
      assert.equal(retrieved.id, 'sess-own');
      assert.equal(retrieved.userId, 'user_bob');
    });

    test('rejects cross-user session access with 403 SESSION_ACCESS_DENIED', () => {
      // User Alice creates session
      sm.getOrCreate('sess-alice', 'default', { userId: 'user_alice' });

      // User Bob tries to access Alice's session
      assert.throws(
        () => sm.getOrCreate('sess-alice', 'default', { userId: 'user_bob' }),
        (err) => err instanceof SessionOwnershipError && err.code === 'SESSION_ACCESS_DENIED' && err.statusCode === 403
      );
    });

    test('rejects unauthenticated access to an authenticated user session with 403', () => {
      sm.getOrCreate('sess-alice-secure', 'default', { userId: 'user_alice' });

      assert.throws(
        () => sm.getOrCreate('sess-alice-secure', 'default', { userId: null }),
        (err) => err instanceof SessionOwnershipError && err.code === 'SESSION_ACCESS_DENIED'
      );
    });

    test('rejects cross-tenant access with 403 TENANT_MISMATCH', () => {
      sm.getOrCreate('sess-tenant-1', 'default', { userId: 'user_1', tenantId: 'tenant_alpha' });

      assert.throws(
        () => sm.getOrCreate('sess-tenant-1', 'default', { userId: 'user_1', tenantId: 'tenant_beta' }),
        (err) => err instanceof TenantMismatchError && err.code === 'TENANT_MISMATCH' && err.statusCode === 403
      );
    });

    test('binds unowned anonymous session to authenticated user upon first login', () => {
      // Created anonymously
      const anon = sm.getOrCreate('sess-anon');
      assert.equal(anon.userId, null);

      // User logs in and provides credentials
      const claimed = sm.getOrCreate('sess-anon', 'default', { userId: 'user_claimed', tenantId: 'tenant_claimed' });
      assert.equal(claimed.userId, 'user_claimed');
      assert.equal(claimed.tenantId, 'tenant_claimed');

      // Now another user cannot access it
      assert.throws(
        () => sm.getOrCreate('sess-anon', 'default', { userId: 'user_intruder' }),
        (err) => err instanceof SessionOwnershipError
      );
    });

    test('protects clear and destroy operations against cross-user manipulation', () => {
      sm.getOrCreate('sess-protected', 'default', { userId: 'user_owner' });

      // Intruder cannot clear session
      assert.throws(
        () => sm.clear('sess-protected', { userId: 'user_intruder' }),
        (err) => err instanceof SessionOwnershipError
      );

      // Intruder cannot destroy session
      assert.throws(
        () => sm.destroy('sess-protected', { userId: 'user_intruder' }),
        (err) => err instanceof SessionOwnershipError
      );

      // Owner can clear and destroy
      assert.equal(sm.clear('sess-protected', { userId: 'user_owner' }), true);
      assert.equal(sm.destroy('sess-protected', { userId: 'user_owner' }), true);
    });
  });

  describe('4. Express HTTP Integration Tests (Chat, Streaming, Sessions, Connectors)', () => {
    let app;
    const testSecret = 'integration-test-secret-777';

    before(() => {
      process.env.JWT_SECRET = testSecret;
      process.env.AUTH_MODE = 'jwt';
      process.env.AUTH_REQUIRED = 'true';

      setAIProvider(new MockAIProvider());
      app = createApp();
    });

    afterEach(() => {
      sessionManager.sessions.clear();
    });

    after(() => {
      delete process.env.JWT_SECRET;
      delete process.env.AUTH_MODE;
      delete process.env.AUTH_REQUIRED;
      sessionManager.sessions.clear();
    });

    test('POST /api/chat rejects unauthenticated request with 401 MISSING_CREDENTIALS', async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({
          assistantId: 'default',
          message: 'Hello'
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'MISSING_CREDENTIALS');
      assert.ok(res.body.error.message.includes('credentials are required'));
    });

    test('POST /api/chat rejects forged JWT token with 401 INVALID_TOKEN', async () => {
      const forgedToken = signJwt({ sub: 'user_attacker' }, 'wrong-secret-key-666');

      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${forgedToken}`)
        .send({
          assistantId: 'default',
          message: 'Hello'
        });

      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_TOKEN');
    });

    test('POST /api/chat succeeds with valid JWT Bearer token', async () => {
      const validToken = signJwt({ sub: 'user_valid_1', tenant_id: 'tenant_main' }, testSecret);

      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          assistantId: 'default',
          message: 'ECHO_RESPONSE:Authenticated chat message reply.'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.text, 'Authenticated chat message reply.');
      assert.ok(res.body.conversationId);
    });

    test('POST /api/chat/stream succeeds with valid JWT and streams events', async () => {
      const validToken = signJwt({ sub: 'user_stream_1' }, testSecret);

      const res = await request(app)
        .post('/api/chat/stream')
        .set('Authorization', `Bearer ${validToken}`)
        .send({
          assistantId: 'default',
          message: 'ECHO_RESPONSE:Streamed auth test'
        });

      assert.equal(res.status, 200);
      assert.ok(res.text.includes('"type":"start"'));
      assert.ok(res.text.includes('"type":"chunk"'));
      assert.ok(res.text.includes('"type":"done"'));
    });

    test('Public endpoints remain accessible without authentication', async () => {
      // 1. Health probe
      const healthRes = await request(app).get('/api/health');
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.body.status, 'ok');

      // 2. Public assistant config
      const configRes = await request(app).get('/api/config/default');
      assert.equal(configRes.status, 200);
      assert.ok(configRes.body.assistant);
      assert.ok(configRes.body.assistant.name);
    });

    test('Enforces cross-user session ownership across chat requests (403 SESSION_ACCESS_DENIED)', async () => {
      const user1Token = signJwt({ sub: 'user_alice_http' }, testSecret);
      const user2Token = signJwt({ sub: 'user_bob_http' }, testSecret);
      const sharedConversationId = 'conv-alice-shared-123';

      // User Alice creates session
      const aliceRes = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          assistantId: 'default',
          conversationId: sharedConversationId,
          message: 'ECHO_RESPONSE:Hello Alice'
        });
      assert.equal(aliceRes.status, 200);

      // User Bob attempts to access Alice's session
      const bobRes = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          assistantId: 'default',
          conversationId: sharedConversationId,
          message: 'ECHO_RESPONSE:Hello Bob from Alice session'
        });

      assert.equal(bobRes.status, 403);
      assert.equal(bobRes.body.error.code, 'SESSION_ACCESS_DENIED');
      assert.equal(bobRes.body.error.message, 'Access denied: session belongs to another user');
    });

    test('Enforces cross-tenant session isolation across chat requests (403 TENANT_MISMATCH)', async () => {
      const tenant1Token = signJwt({ sub: 'user_corp_a', tenant_id: 'corp_alpha' }, testSecret);
      const tenant2Token = signJwt({ sub: 'user_corp_b', tenant_id: 'corp_beta' }, testSecret);
      const tenantConvId = 'conv-tenant-isolation-456';

      // Corp Alpha creates session
      const alphaRes = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${tenant1Token}`)
        .send({
          assistantId: 'default',
          conversationId: tenantConvId,
          message: 'ECHO_RESPONSE:Alpha message'
        });
      assert.equal(alphaRes.status, 200);

      // Corp Beta attempts to access session
      const betaRes = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${tenant2Token}`)
        .send({
          assistantId: 'default',
          conversationId: tenantConvId,
          message: 'ECHO_RESPONSE:Beta intruder'
        });

      assert.equal(betaRes.status, 403);
      assert.equal(betaRes.body.error.code, 'TENANT_MISMATCH');
      assert.equal(betaRes.body.error.message, 'Access denied: session belongs to another tenant');
    });

    test('POST /api/sessions/clear enforces session ownership', async () => {
      const ownerToken = signJwt({ sub: 'user_sess_owner' }, testSecret);
      const intruderToken = signJwt({ sub: 'user_sess_intruder' }, testSecret);
      const convId = 'conv-sess-clear-test';

      // Create session as owner
      await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          assistantId: 'default',
          conversationId: convId,
          message: 'ECHO_RESPONSE:Test message'
        });

      // Intruder cannot clear
      const intruderClear = await request(app)
        .post('/api/sessions/clear')
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ conversationId: convId });

      assert.equal(intruderClear.status, 403);
      assert.equal(intruderClear.body.error.code, 'SESSION_ACCESS_DENIED');

      // Owner can clear
      const ownerClear = await request(app)
        .post('/api/sessions/clear')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ conversationId: convId });

      assert.equal(ownerClear.status, 200);
      assert.equal(ownerClear.body.success, true);
    });

    test('Connector authorization remains independent and fail-closed even for authenticated users', async () => {
      const userToken = signJwt({ sub: 'authenticated_user_123' }, testSecret);

      // 1. Authenticated user calls connector without connector authToken -> fails closed with 401 from connector
      const failRes = await request(app)
        .post('/api/connectors/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          connectorId: 'mock-knowledge',
          action: 'getCustomerProfile',
          parameters: { customerId: 'cust-001' }
          // authToken intentionally omitted
        });

      assert.equal(failRes.status, 401);
      assert.ok(failRes.body.error.message.includes('Unauthorized') || failRes.body.error.code);

      // 2. Authenticated user provides valid connector authToken -> succeeds
      const passRes = await request(app)
        .post('/api/connectors/execute')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          connectorId: 'mock-knowledge',
          action: 'getCustomerProfile',
          parameters: { customerId: 'cust-001' },
          authToken: 'secret-demo-token-123'
        });

      assert.equal(passRes.status, 200);
      assert.equal(passRes.body.success, true);
      assert.equal(passRes.body.data.customer.id, 'cust-001');
    });

    test('Unauthenticated attacker cannot execute connector actions through chat', async () => {
      const attackerRes = await request(app)
        .post('/api/chat')
        .send({
          assistantId: 'default',
          message: 'MOCK_TOOL_CALL:{"id":"call_attack","name":"mock-knowledge:searchKnowledge","arguments":{"query":"test"}}'
        });

      // Rejected at auth boundary with 401 before any tool or connector is executed!
      assert.equal(attackerRes.status, 401);
      assert.equal(attackerRes.body.error.code, 'MISSING_CREDENTIALS');
    });
  });
});
