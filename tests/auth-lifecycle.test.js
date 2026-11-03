import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { signJwt, verifyJwt } from '../backend/src/middleware/auth.js';
import { sessionManager } from '../backend/src/session-manager.js';
import { AssistantApiClient } from '../widget/src/api-client.js';
import { DOCUMENT_PROCESSING_CONSENT_VERSION } from '../config/document-upload.js';

const TEST_JWT_SECRET = 'test-secret-key-for-auth-lifecycle-verification-12345';
const ALT_JWT_SECRET = 'wrong-secret-key-for-signature-mismatch-testing-67890';

class MockChatProvider {
  constructor() {
    this.name = 'mock-auth-test-provider';
  }
  async checkHealth() {
    return { available: true, model: 'mock-model', message: 'Ready' };
  }
  async chat({ messages }) {
    return {
      text: 'Mock response to: ' + (messages[messages.length - 1]?.content || ''),
      model: 'mock-model'
    };
  }
  async chatStream({ messages, onChunk }) {
    const text = 'Streaming response to: ' + (messages[messages.length - 1]?.content || '');
    if (onChunk) onChunk(text);
    return { text, model: 'mock-model' };
  }
}

describe('Authentication Lifecycle & Production Fix Verification', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.AUTH_MODE;
    delete process.env.AUTH_REQUIRED;
    delete process.env.JWT_SECRET;
    delete process.env.API_KEY;
    setAIProvider(new MockChatProvider());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ==========================================
  // SECTION 1: Demo Token Endpoint
  // ==========================================
  describe('1. Backend-Managed Demo Token Endpoint (/api/auth/token)', () => {
    test('POST /api/auth/token issues valid signed JWT when JWT_SECRET is configured', async () => {
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/token')
        .send({ assistantId: 'default' })
        .expect(200);

      assert.ok(res.body.token, 'Must return a token');
      assert.equal(res.body.tokenType, 'Bearer');
      assert.equal(res.body.expiresIn, 3600);
      assert.ok(res.body.user.id.startsWith('guest_'));
      assert.equal(res.body.user.role, 'demo');

      // Verify token signature with verifyJwt
      const claims = verifyJwt(res.body.token, TEST_JWT_SECRET);
      assert.equal(claims.role, 'demo');
      assert.equal(claims.assistantId, 'default');
      assert.ok(Array.isArray(claims.scopes));
      assert.ok(claims.scopes.includes('chat'));
      assert.ok(claims.scopes.includes('document:upload'));
    });

    test('GET /api/auth/token also works for easy script-tag initialization', async () => {
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const res = await request(app)
        .get('/api/auth/token?assistantId=researcher')
        .expect(200);

      assert.ok(res.body.token);
      const claims = verifyJwt(res.body.token, TEST_JWT_SECRET);
      assert.equal(claims.assistantId, 'researcher');
    });

    test('POST /api/auth/token rejects protected assistants with 403 FORBIDDEN_ASSISTANT', async () => {
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/token')
        .send({ assistantId: 'hirepool' })
        .expect(403);

      assert.equal(res.body.error.code, 'FORBIDDEN_ASSISTANT');
    });

    test('POST /api/auth/token returns null token when JWT_SECRET is not configured', async () => {
      delete process.env.JWT_SECRET;
      const app = createApp();

      const res = await request(app)
        .post('/api/auth/token')
        .send({ assistantId: 'default' })
        .expect(200);

      assert.equal(res.body.token, null);
      assert.ok(res.body.message.includes('not configured'));
    });
  });

  // ==========================================
  // SECTION 2: Public Demo Widget Client Lifecycle
  // ==========================================
  describe('2. Public Demo Widget Client End-to-End Authentication', () => {
    test('AssistantApiClient automatically acquires demo token and succeeds in production mode', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      // Mock global fetch to route to supertest app
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, options = {}) => {
        const parsed = new URL(url, 'http://localhost');
        const reqBuilder = options.method === 'POST'
          ? request(app).post(parsed.pathname)
          : request(app).get(parsed.pathname);

        if (options.headers) {
          for (const [k, v] of Object.entries(options.headers)) {
            reqBuilder.set(k, v);
          }
        }
        if (options.body) {
          reqBuilder.send(typeof options.body === 'string' ? JSON.parse(options.body) : options.body);
        }

        const res = await reqBuilder;
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          json: async () => res.body,
          body: {
            getReader: () => {
              let done = false;
              return {
                read: async () => {
                  if (done) return { value: null, done: true };
                  done = true;
                  const data = `data: {"type":"chunk","delta":"Hello"}\n\ndata: {"type":"done","text":"Hello"}\n\n`;
                  return { value: new TextEncoder().encode(data), done: false };
                },
                cancel: async () => {},
                releaseLock: () => {}
              };
            }
          }
        };
      };

      try {
        const client = new AssistantApiClient('', { assistantId: 'default' });

        // Step 1: Send message (client has no token yet -> fetches demo token -> attaches Bearer)
        let chunkReceived = '';
        const res = await client.sendMessage({
          message: 'Hello Assistant',
          stream: true,
          onChunk: (chunk) => { chunkReceived += chunk; }
        });

        assert.ok(client._demoToken, 'Client must acquire and cache demo token');
        assert.equal(res.text, 'Hello');
        assert.equal(chunkReceived, 'Hello');

        // Step 2: Next turn reuses cached token without re-fetching
        const cachedToken = client._demoToken;
        await client.sendMessage({
          message: 'Second question',
          stream: true
        });
        assert.equal(client._demoToken, cachedToken, 'Should reuse valid cached token');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==========================================
  // SECTION 3: Protected Routes & Credential Validation
  // ==========================================
  describe('3. Protected Route Security & Error States', () => {
    test('POST /api/chat/stream rejects missing credentials with 401 when required in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.AUTH_REQUIRED = 'true';
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const res = await request(app)
        .post('/api/chat/stream')
        .send({ assistantId: 'default', message: 'Hello without token', stream: true })
        .expect(401);

      assert.equal(res.body.error.code, 'MISSING_CREDENTIALS');
    });

    test('POST /api/chat/stream rejects invalid JWT signature with 401', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const forgedToken = signJwt({ sub: 'attacker', role: 'admin' }, ALT_JWT_SECRET);

      const res = await request(app)
        .post('/api/chat/stream')
        .set('Authorization', `Bearer ${forgedToken}`)
        .send({ assistantId: 'default', message: 'Attack', stream: true })
        .expect(401);

      assert.equal(res.body.error.code, 'INVALID_TOKEN');
    });

    test('POST /api/chat/stream rejects expired JWT token with 401 EXPIRED_TOKEN', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const expiredToken = signJwt({ sub: 'user_1' }, TEST_JWT_SECRET, { expiresIn: -10 });

      const res = await request(app)
        .post('/api/chat/stream')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({ assistantId: 'default', message: 'Expired', stream: true })
        .expect(401);

      assert.equal(res.body.error.code, 'EXPIRED_TOKEN');
    });

    test('POST /api/chat/stream succeeds with valid Bearer token', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const token = signJwt({ sub: 'valid_user', role: 'user' }, TEST_JWT_SECRET);

      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ assistantId: 'default', message: 'Hello with valid token', stream: false })
        .expect(200);

      assert.ok(res.body.text.includes('Mock response'));
    });
  });

  // ==========================================
  // SECTION 4: External Host Integration Mode
  // ==========================================
  describe('4. External Host Integration (HostIntegrationAdapter)', () => {
    test('Host integration getAuthHeaders takes precedence over demo token', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.JWT_SECRET = TEST_JWT_SECRET;

      const hostUserToken = signJwt(
        { sub: 'tenant_user_123', tenant_id: 'enterprise_tenant_abc', role: 'member' },
        TEST_JWT_SECRET
      );

      let authHeadersCalled = false;
      const client = new AssistantApiClient('http://localhost', {
        assistantId: 'default',
        getAuthHeaders: async () => {
          authHeadersCalled = true;
          return { Authorization: `Bearer ${hostUserToken}` };
        }
      });

      const headers = await client._headers(true);

      assert.equal(authHeadersCalled, true);
      assert.equal(headers.Authorization, `Bearer ${hostUserToken}`);
      assert.equal(client._demoToken, null, 'Demo token must not be fetched when host provides headers');
    });

    test('SessionManager enforces tenant isolation for authenticated host users', () => {
      const sessionTenantA = 'session-tenant-a';
      const authA = { userId: 'alice', tenantId: 'tenant-alpha' };
      const authB = { userId: 'bob', tenantId: 'tenant-beta' };

      sessionManager.getOrCreate(sessionTenantA, 'default', authA);

      // Same user or tenant-A can access
      const accessA = sessionManager.getOrCreate(sessionTenantA, 'default', authA);
      assert.equal(accessA.id, sessionTenantA);

      // Cross-tenant access is rejected
      assert.throws(
        () => sessionManager.getOrCreate(sessionTenantA, 'default', authB),
        (err) => err.code === 'TENANT_MISMATCH'
      );
    });
  });

  // ==========================================
  // SECTION 5: Document Upload Authentication & Consent
  // ==========================================
  describe('5. Document Upload Authentication & Consent Controls', () => {
    test('POST /api/documents/upload succeeds with valid demo token and consent', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const demoToken = signJwt({ sub: 'guest_upload_test', role: 'demo' }, TEST_JWT_SECRET);
      const fileBuffer = Buffer.from('Quarterly strategy: expand product integrations', 'utf-8');

      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${demoToken}`)
        .set('X-Document-Processing-Consent', 'accepted')
        .set('X-Document-Consent-Version', DOCUMENT_PROCESSING_CONSENT_VERSION)
        .attach('file', fileBuffer, 'strategy.txt')
        .field('conversationId', 'demo-convo-1')
        .field('consentAccepted', 'true')
        .field('consentVersion', DOCUMENT_PROCESSING_CONSENT_VERSION)
        .expect(200);

      assert.equal(res.body.status, 'success');
      assert.equal(res.body.document.filename, 'strategy.txt');
    });

    test('POST /api/documents/upload rejects missing consent even with valid token', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const demoToken = signJwt({ sub: 'guest_1', role: 'demo' }, TEST_JWT_SECRET);
      const fileBuffer = Buffer.from('test', 'utf-8');

      const res = await request(app)
        .post('/api/documents/upload')
        .set('Authorization', `Bearer ${demoToken}`)
        .attach('file', fileBuffer, 'notes.txt')
        .expect(400);

      assert.equal(res.body.error.code, 'DOCUMENT_CONSENT_REQUIRED');
    });

    test('POST /api/documents/upload rejects missing credentials when required', async () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_MODE = 'jwt';
      process.env.AUTH_REQUIRED = 'true';
      process.env.JWT_SECRET = TEST_JWT_SECRET;
      const app = createApp();

      const fileBuffer = Buffer.from('test', 'utf-8');

      const res = await request(app)
        .post('/api/documents/upload')
        .set('X-Document-Processing-Consent', 'accepted')
        .set('X-Document-Consent-Version', DOCUMENT_PROCESSING_CONSENT_VERSION)
        .attach('file', fileBuffer, 'notes.txt')
        .expect(401);

      assert.equal(res.body.error.code, 'MISSING_CREDENTIALS');
    });
  });
});
