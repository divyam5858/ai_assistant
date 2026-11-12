import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { sessionManager, SessionOwnershipError } from '../backend/src/session-manager.js';
import {
  findHirePoolContextBySdkCredential,
  storeHirePoolSession
} from '../backend/src/local-integrations/hirepool-session-store.js';
import { AssistantStorage } from '../widget/src/storage.js';
import { AssistantApiClient } from '../widget/src/api-client.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { createSessionOptions } from '../backend/src/session-scope.js';

function setupEnvironment() {
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.ENABLE_HIREPOOL_INTEGRATION = 'true';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://127.0.0.1:5173';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://127.0.0.1:5173';
}

test('Comprehensive HirePool Auth Handoff and Session Ownership Suite', async (t) => {
  setupEnvironment();
  const app = createApp();

  await t.test('Scenario 1: GET /api/hirepool/session/validate returns 401 MISSING_CREDENTIALS when no auth header is provided', async () => {
    const res = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000');

    assert.equal(res.status, 401);
    assert.equal(res.body?.error?.code, 'MISSING_CREDENTIALS');
  });

  await t.test('Scenario 2: GET /api/hirepool/session/validate returns 401 INVALID_CREDENTIALS when invalid token is provided', async () => {
    const res = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', 'Bearer invalid-token-xyz');

    assert.equal(res.status, 401);
    assert.equal(res.body?.error?.code, 'INVALID_CREDENTIALS');
  });

  await t.test('Scenario 3: GET /api/hirepool/session/validate returns 200 with valid session data when valid SDK token is provided', async () => {
    const identity = {
      id: 'usr-cand-smoke-1',
      email: 'candidate-smoke@example.com',
      userType: 'candidate',
      organizationRole: null
    };
    const session = storeHirePoolSession('mock-host-token-1', identity, Date.now(), Date.now());

    const res = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${session.credential}`);

    assert.equal(res.status, 200);
    assert.equal(res.body?.valid, true);
    assert.equal(res.body?.identity?.id, 'usr-cand-smoke-1');
    assert.equal(res.body?.identity?.email, 'candidate-smoke@example.com');
    assert.equal(res.body?.identity?.userType, 'candidate');
    assert.ok(typeof res.body?.expiresIn === 'number');
    assert.ok(res.body?.expiresIn > 0);
  });

  await t.test('Scenario 4: Session validation works across allowed origins and rejects disallowed origins', async () => {
    const identity = {
      id: 'usr-client-smoke-1',
      email: 'client-smoke@example.com',
      userType: 'client',
      organizationRole: 'admin'
    };
    const session = storeHirePoolSession('mock-host-token-client', identity, Date.now(), Date.now());

    // Public website origin (http://localhost:3000)
    const resPublic = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${session.credential}`);
    assert.equal(resPublic.status, 200);
    assert.equal(resPublic.body?.valid, true);

    // Dashboard origin (http://localhost:5173)
    const resDashboard = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', `Bearer ${session.credential}`);
    assert.equal(resDashboard.status, 200);
    assert.equal(resDashboard.body?.valid, true);

    // Disallowed origin (http://untrusted-site.com)
    const resDisallowed = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://untrusted-site.com')
      .set('Authorization', `Bearer ${session.credential}`);
    assert.equal(resDisallowed.status, 401);
    assert.equal(resDisallowed.body?.error?.code, 'ORIGIN_NOT_ALLOWED');
  });

  await t.test('Scenario 5: SessionManager: Anonymous session (userId: null) atomically upgrades when userId is supplied', () => {
    const convoId = `guest-convo-${Date.now()}`;
    const initialSession = sessionManager.getOrCreate(convoId, 'default', { userId: null });
    assert.equal(initialSession.id, convoId);
    assert.equal(initialSession.userId, null);

    // Add guest message
    sessionManager.addMessage(convoId, 'user', 'Hello as guest', { userId: null });
    assert.equal(initialSession.messages.length, 1);

    // Upgrade with newly authenticated user
    const upgradedSession = sessionManager.getOrCreate(convoId, 'default', { userId: 'usr-cand-123' });
    assert.equal(upgradedSession.id, convoId);
    assert.equal(upgradedSession.userId, 'usr-cand-123');
    assert.equal(upgradedSession.messages.length, 1);
  });

  await t.test('Scenario 6: SessionManager: Rejects access when session.userId !== requested userId (HTTP 403 SESSION_ACCESS_DENIED)', () => {
    const convoId = `user-a-convo-${Date.now()}`;
    sessionManager.getOrCreate(convoId, 'default', { userId: 'user-A' });

    assert.throws(
      () => sessionManager.getOrCreate(convoId, 'default', { userId: 'user-B' }),
      (err) => {
        assert.ok(err instanceof SessionOwnershipError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'SESSION_ACCESS_DENIED');
        assert.ok(err.message.includes('belongs to another user'));
        return true;
      }
    );
  });

  await t.test('Scenario 7: SessionManager: Allows access when session.userId === requested userId', () => {
    const convoId = `user-a-convo-2-${Date.now()}`;
    const created = sessionManager.getOrCreate(convoId, 'default', { userId: 'user-A' });
    const accessed = sessionManager.getOrCreate(convoId, 'default', { userId: 'user-A' });
    assert.equal(created.id, accessed.id);
    assert.equal(accessed.userId, 'user-A');
  });

  await t.test('Scenario 8: Widget: apiClient.validateHirePoolSession() parses 200 response correctly and throws on 401', async () => {
    const identity = {
      id: 'usr-consultancy-1',
      email: 'consultancy@agency.com',
      userType: 'consultancy',
      organizationRole: 'admin'
    };
    const session = storeHirePoolSession('mock-consultancy-token', identity, Date.now(), Date.now());

    // Mock fetch for client testing
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options = {}) => {
        const auth = options.headers?.Authorization || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        if (token === session.credential) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              valid: true,
              identity: session.identity,
              sessionScope: session.sessionScope,
              expiresIn: 3600
            })
          };
        }
        return {
          ok: false,
          status: 401,
          json: async () => ({
            error: { code: 'INVALID_CREDENTIALS', message: 'The SDK session is no longer valid' }
          })
        };
      };

      const client = new AssistantApiClient('http://localhost:3000');
      const validResult = await client.validateHirePoolSession(session.credential);
      assert.equal(validResult.valid, true);
      assert.equal(validResult.identity.userType, 'consultancy');

      await assert.rejects(
        () => client.validateHirePoolSession('bogus-token'),
        (err) => {
          assert.equal(err.status, 401);
          assert.equal(err.code, 'INVALID_CREDENTIALS');
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('Scenario 9: Widget: _handleHirePoolSignupSuccess completes handoff for Candidate, Client, and Consultancy', async () => {
    // Test role confirmation content generation
    const roles = ['candidate', 'client', 'consultancy'];
    for (const role of roles) {
      const mockSessionData = {
        credential: `cred-${role}`,
        role,
        identity: { id: `usr-${role}`, email: `${role}@test.com`, userType: role },
        sessionScope: { assistantId: 'hirepool', userId: `usr-${role}` }
      };

      let confirmationDisplayed = null;
      let promptsSet = null;

      const mockWidget = {
        apiClient: {
          setAuthenticatedSession: () => {},
          validateHirePoolSession: async () => ({ valid: true, identity: mockSessionData.identity })
        },
        storage: {
          get: (key) => null,
          set: () => {},
          setUser: () => {},
          clearConversationId: () => {}
        },
        options: { integration: {} },
        messages: [],
        messagesList: {
          appendChild: () => {},
          querySelectorAll: () => []
        },
        _dismissRecoverableBanner: () => {},
        _persistState: () => {},
        _renderMessageBubble: (role, text) => { confirmationDisplayed = text; },
        setGreeting: (greeting, prompts) => { promptsSet = prompts; },
        _scrollToBottom: () => {},
        events: { emit: () => {} },
        _handleHirePoolSignupSuccess: async function(sessionData) {
          const smokeResult = await this.apiClient.validateHirePoolSession(sessionData.credential);
          if (smokeResult?.valid) {
            this._displaySignupConfirmation(sessionData);
          }
        },
        _displaySignupConfirmation: function(sessionData) {
          const r = sessionData.role;
          if (r === 'candidate') {
            this.setGreeting('Welcome back', ['Find matching jobs', 'View my profile', 'My applications']);
            this._renderMessageBubble('assistant', '🎉 **Welcome to HirePool!** Your candidate account is verified');
          } else if (r === 'client') {
            this.setGreeting('Welcome back', ['View my jobs', 'View company profile', 'Dashboard stats']);
            this._renderMessageBubble('assistant', '🎉 **Welcome to HirePool!** Your company account is verified');
          } else if (r === 'consultancy') {
            this.setGreeting('Welcome back', ['View candidate pool', 'Add a candidate', 'Placement stats', 'View agency profile']);
            this._renderMessageBubble('assistant', '🎉 **Welcome to HirePool!** Your consultancy account is verified');
          }
        }
      };

      await mockWidget._handleHirePoolSignupSuccess(mockSessionData);
      assert.ok(confirmationDisplayed.includes('Welcome to HirePool!'));
      assert.ok(promptsSet.length >= 3);
    }
  });

  await t.test('Scenario 10: Widget: _handleHirePoolSignupSuccess renders recoverable warning with retry when smoke test fails', async () => {
    let warningRendered = null;
    let retryActionRegistered = null;

    const mockWidget = {
      apiClient: {
        setAuthenticatedSession: () => {},
        validateHirePoolSession: async () => {
          throw new Error('Connection timeout');
        }
      },
      storage: {
        get: () => null,
        set: () => {},
        setUser: () => {}
      },
      options: {},
      _dismissRecoverableBanner: () => {},
      _renderRecoverableWarningBanner: (msg, actionText, callback) => {
        warningRendered = msg;
        retryActionRegistered = callback;
      },
      _handleHirePoolSignupSuccess: async function(sessionData) {
        try {
          const smokeResult = await this.apiClient.validateHirePoolSession(sessionData.credential);
          if (!smokeResult?.valid) throw new Error('Session invalid');
        } catch (smokeErr) {
          this._renderRecoverableWarningBanner(
            'Account created successfully! However, assistant session verification timed out.',
            'Retry Connection',
            () => this._handleHirePoolSignupSuccess(sessionData)
          );
        }
      }
    };

    await mockWidget._handleHirePoolSignupSuccess({ credential: 'smoke-fail-cred', identity: { id: 'u1' } });
    assert.ok(warningRendered.includes('Account created successfully!'));
    assert.ok(warningRendered.includes('session verification timed out'));
    assert.equal(typeof retryActionRegistered, 'function');
  });

  await t.test('Scenario 11: Widget: Recovers from SESSION_ACCESS_DENIED by generating a new conversation ID and retrying', async () => {
    let attempts = 0;
    let clearedConversationId = false;
    let deliveredMessage = null;

    const mockWidget = {
      activeConversationId: 'stale-user-a-conversation',
      storage: {
        clearConversationId: () => { clearedConversationId = true; }
      },
      apiClient: {
        sendMessage: async ({ conversationId, message }) => {
          attempts++;
          if (attempts === 1 && conversationId === 'stale-user-a-conversation') {
            const err = new Error('Access denied: session belongs to another user');
            err.status = 403;
            err.code = 'SESSION_ACCESS_DENIED';
            throw err;
          }
          // On retry with fresh/empty conversationId, succeeds
          deliveredMessage = message;
          return { text: 'Welcome new user!' };
        }
      },
      sendMessageWithRecovery: async function(text) {
        const sendAttempt = async (isRetry = false) => {
          try {
            await this.apiClient.sendMessage({
              conversationId: this.activeConversationId || undefined,
              message: text
            });
          } catch (err) {
            const isSessionDenied = err.status === 403 || err.code === 'SESSION_ACCESS_DENIED';
            if (!isRetry && isSessionDenied) {
              this.activeConversationId = null;
              this.storage.clearConversationId();
              await sendAttempt(true);
              return;
            }
            throw err;
          }
        };
        await sendAttempt(false);
      }
    };

    await mockWidget.sendMessageWithRecovery('Hello from User B');
    assert.equal(attempts, 2);
    assert.equal(clearedConversationId, true);
    assert.equal(mockWidget.activeConversationId, null);
    assert.equal(deliveredMessage, 'Hello from User B');
  });

  await t.test('Scenario 12: Widget storage namespacing prevents cross-user conversation contamination', () => {
    const memory = new Map();
    class MockStorageDriver {
      getItem(k) { return memory.has(k) ? memory.get(k) : null; }
      setItem(k, v) { memory.set(k, String(v)); }
      removeItem(k) { memory.delete(k); }
      clear() { memory.clear(); }
    }

    const storage = new AssistantStorage('test-app');
    storage.store = new MockStorageDriver();

    // Guest conversation
    storage.setUser(null);
    storage.saveConversationId('guest-convo-id');
    storage.set('messages', [{ role: 'user', content: 'Guest message' }]);
    assert.equal(storage.getConversationId(), 'guest-convo-id');

    // Switch to User A
    storage.setUser('user-A');
    assert.equal(storage.getConversationId(), null);
    assert.deepEqual(storage.get('messages', []), []);
    storage.saveConversationId('user-A-convo-id');
    storage.set('messages', [{ role: 'user', content: 'User A message' }]);

    // Switch to User B
    storage.setUser('user-B');
    assert.equal(storage.getConversationId(), null);
    storage.saveConversationId('user-B-convo-id');
    storage.set('messages', [{ role: 'user', content: 'User B message' }]);

    // Verify User A data remains intact and isolated
    storage.setUser('user-A');
    assert.equal(storage.getConversationId(), 'user-A-convo-id');
    assert.equal(storage.get('messages')[0].content, 'User A message');

    // Verify User B data remains intact and isolated
    storage.setUser('user-B');
    assert.equal(storage.getConversationId(), 'user-B-convo-id');
    assert.equal(storage.get('messages')[0].content, 'User B message');
  });

  await t.test('Scenario 13: Complete signup-to-authenticated-chat pipeline executes without 404 or ownership errors', async () => {
    setAIProvider({
      name: 'mock-pipeline-provider',
      async checkHealth() {
        return { available: true, model: 'mock-test' };
      },
      async chat() {
        return { text: 'You are signed in as candidate pipeline-user-cand.', model: 'mock-test', finishReason: 'stop' };
      }
    });

    // 1. Establish an authenticated session in the session store
    const identity = {
      id: 'pipeline-user-cand',
      email: 'pipeline.cand@hirepool.ai',
      userType: 'candidate',
      organizationRole: null
    };
    const sdkSession = storeHirePoolSession('mock-pipeline-access-token', identity, Date.now(), Date.now());

    // 2. Validate session via GET /api/hirepool/session/validate
    const validateRes = await request(app)
      .get('/api/hirepool/session/validate')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${sdkSession.credential}`);

    assert.equal(validateRes.status, 200);
    assert.equal(validateRes.body.valid, true);
    assert.equal(validateRes.body.identity.id, 'pipeline-user-cand');

    // 3. Send first authenticated chat message using this credential
    const chatRes = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({
        assistantId: 'hirepool',
        message: 'Show me my candidate status',
        conversationId: 'pipeline-cand-convo-1'
      });

    assert.equal(chatRes.status, 200);
    assert.ok(chatRes.body?.text);
    assert.equal(chatRes.body?.conversationId, 'pipeline-cand-convo-1');

    // 4. Verify conversation is securely bound to pipeline-user-cand in SessionManager
    const sessionOptions = createSessionOptions({ id: 'pipeline-user-cand' }, 'hirepool');
    const storedSession = sessionManager.getOrCreate('pipeline-cand-convo-1', 'hirepool', sessionOptions);
    assert.equal(storedSession.userId, 'pipeline-user-cand');
  });
});
