import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { sessionManager, SessionManager } from '../backend/src/session-manager.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import {
  buildProviderMessages,
  MAX_PROVIDER_HISTORY_ITEMS
} from '../backend/src/history-manager.js';
import { storeHirePoolSession } from '../backend/src/local-integrations/hirepool-session-store.js';
import { SERVER_DEFAULTS } from '../config/defaults.js';
import {
  classifyHirePoolMessage,
  HIREPOOL_DOMAIN_CATEGORIES,
  HIREPOOL_OUT_OF_SCOPE_RESPONSE,
  HIREPOOL_COMPETITOR_POLICY_RESPONSE,
  HIREPOOL_AMBIGUOUS_CLARIFICATION_RESPONSE
} from '../integrations/hirepool/domain-policy.js';
import { AssistantStorage } from '../widget/src/storage.js';
import { AssistantWidgetUI } from '../widget/src/widget.js';
import {
  HIREPOOL_SIGNUP_STATES,
  HirePoolSignupCoordinator
} from '../widget/src/hirepool-signup.js';

function setupEnv() {
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.ENABLE_HIREPOOL_INTEGRATION = 'true';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = 'http://localhost:3000';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3000';
}

function parseSseEvents(rawText) {
  const events = [];
  for (const chunk of String(rawText || '').split('\n\n')) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('data:')) continue;
    const jsonPart = trimmed.slice(5).trim();
    if (!jsonPart) continue;
    events.push(JSON.parse(jsonPart));
  }
  return events;
}

class MemoryStorageBackend {
  constructor() {
    this.data = new Map();
  }
  getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
  setItem(k, v) { this.data.set(k, String(v)); }
  removeItem(k) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.className = '';
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.parentNode = null;
    this.scrollHeight = 40;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter(c => c !== child);
    child.parentNode = null;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  addEventListener(eventName, handler) {
    if (!this.listeners[eventName]) this.listeners[eventName] = [];
    this.listeners[eventName].push(handler);
  }
  querySelector(selector) {
    if (selector === '.ai-btn-action-confirm') return new FakeElement('button');
    if (selector === '.ai-btn-action-cancel') return new FakeElement('button');
    if (selector === '.ai-action-status-msg') return new FakeElement('div');
    if (selector === '.ai-action-controls') return new FakeElement('div');
    return null;
  }
  querySelectorAll() {
    return [];
  }
  focus() {}
}

function createWidgetHarness({ sessionData = null, onSendMessage = null } = {}) {
  let currentSession = sessionData;
  const mockSessionStorage = new MemoryStorageBackend();
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;

  globalThis.window = { sessionStorage: mockSessionStorage, localStorage: new MemoryStorageBackend() };
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };

  try {
    const storage = new AssistantStorage('hirepool', 'session');
    const apiClient = {
      getAuthenticatedSession: () => currentSession,
      setAuthenticatedSession: (s) => { currentSession = s; },
      clearAuthenticatedSession: () => { currentSession = null; },
      getDocuments: async () => [],
      clearSession: async () => {},
      validateHirePoolSession: async () => ({ valid: true }),
      getSignupAgreement: async (role) => ({
        id: `agr-${role}-v1`,
        version: '1.0',
        role,
        title: `${role} User Agreement`,
        summary: 'Standard terms'
      }),
      cancelSignup: async () => ({ cancelled: true }),
      resendSignupVerification: async () => ({ sent: true }),
      checkSignupVerificationStatus: async () => ({ isVerified: false }),
      sendMessage: async (payload) => {
        if (onSendMessage) {
          await onSendMessage(payload);
        }
        payload.onDone?.({
          conversationId: payload.conversationId || 'convo-widget-1',
          text: 'Mocked backend answer for informational question.'
        });
      }
    };

    const events = {
      emitted: [],
      emit(name, data) {
        this.emitted.push({ name, data });
      }
    };

    const widget = new AssistantWidgetUI(
      {
        assistantId: 'hirepool',
        context: {},
        features: { streaming: true },
        hasActionHandler: () => true
      },
      apiClient,
      storage,
      events
    );

    widget.messagesList = new FakeElement('div');
    widget.body = new FakeElement('div');
    widget.textarea = new FakeElement('textarea');
    widget.sendBtn = new FakeElement('button');
    widget.stopBtn = new FakeElement('button');
    widget.statusDot = { classList: { add() {}, remove() {} } };
    widget.statusText = new FakeElement('span');
    widget.streamingIndicator = new FakeElement('div');
    widget.errorBanner = null;
    widget._renderMessageBubble = (role, content) => {
      const el = new FakeElement('div');
      el.textContent = `${role}: ${content}`;
      widget.messagesList.appendChild(el);
    };
    widget._renderHirePoolSignupState = (state, data) => {
      const snapshot = widget.hirePoolSignup.getSafeProgressSnapshot();
      if (snapshot) {
        storage.saveSignupProgress(snapshot);
      } else {
        storage.clearSignupProgress();
      }
      widget._renderedSignupStates = widget._renderedSignupStates || [];
      widget._renderedSignupStates.push({ state, role: data?.role || widget.hirePoolSignup.selectedRole });
    };
    widget._renderErrorBanner = (msg) => {
      widget._lastErrorBanner = msg;
    };

    return {
      widget,
      storage,
      apiClient,
      events,
      mockSessionStorage,
      cleanup() {
        globalThis.window = prevWindow;
        globalThis.document = prevDocument;
      }
    };
  } catch (err) {
    globalThis.window = prevWindow;
    globalThis.document = prevDocument;
    throw err;
  }
}

test('HirePool Phase 1: Visitor Context, Auth Routing & Signup Continuity Suite', async (t) => {
  setupEnv();
  const app = createApp();

  await t.test('1. Exact 8-turn unauthenticated visitor conversation never locks out and retains context (POST /api/chat)', async () => {
    const providerCalls = [];
    setAIProvider({
      name: 'phase1-visitor-provider',
      async checkHealth() { return { available: true, model: 'test' }; },
      async chat(input) {
        providerCalls.push(input);
        return {
          text: `HirePool assistant response #${providerCalls.length} (${input.systemInstruction.includes('Selected role: candidate') ? 'candidate-aware' : 'visitor-aware'}).`,
          model: 'test',
          finishReason: 'stop'
        };
      }
    });

    const convoId = `visitor-8turn-${Date.now()}`;

    // Turn 1: "I'm new to HirePool."
    const t1 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: "I'm new to HirePool.", conversationId: convoId });
    assert.equal(t1.status, 200);
    assert.ok(!t1.body.text.includes("can’t verify a HirePool login"));
    assert.equal(providerCalls.length, 1);

    // Turn 2: "I'm looking for job opportunities."
    const t2 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: "I'm looking for job opportunities.", conversationId: convoId });
    assert.equal(t2.status, 200);
    assert.ok(!t2.body.text.includes("can’t verify a HirePool login"));
    assert.equal(providerCalls.length, 2);

    // Turn 3: "I don't have an account." -> signup action offered smoothly
    const t3 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: "I don't have an account.", conversationId: convoId });
    assert.equal(t3.status, 200);
    assert.equal(t3.body.action?.action, 'hirepool_signup');
    assert.ok(!t3.body.text.includes("can’t verify a HirePool login"));

    // Turn 4: "What's HirePool about?" -> MUST NOT lock out after Turn 3 signup card offer
    const t4 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: "What's HirePool about?", conversationId: convoId });
    assert.equal(t4.status, 200);
    assert.ok(!t4.body.text.includes("can’t verify a HirePool login"));
    assert.equal(providerCalls.length, 3);

    // Turn 5: "What can you do for me?"
    const t5 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'What can you do for me?', conversationId: convoId });
    assert.equal(t5.status, 200);
    assert.ok(!t5.body.text.includes("can’t verify a HirePool login"));
    assert.notEqual(t5.body.text, HIREPOOL_OUT_OF_SCOPE_RESPONSE);
    assert.notEqual(t5.body.text, HIREPOOL_AMBIGUOUS_CLARIFICATION_RESPONSE);
    assert.equal(providerCalls.length, 4);

    // Turn 6: "Tell me more." -> contextual follow-up allowed by active session context
    const t6 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'Tell me more.', conversationId: convoId });
    assert.equal(t6.status, 200);
    assert.ok(!t6.body.text.includes("can’t verify a HirePool login"));
    assert.notEqual(t6.body.text, HIREPOOL_AMBIGUOUS_CLARIFICATION_RESPONSE);
    assert.equal(providerCalls.length, 5);
    assert.ok(providerCalls[4].messages.length >= 9, 'Prior turns should be retained in provider history');

    // Turn 7: "Signup." -> re-offers hirepool_signup instead of hitting HIREPOOL_AUTH_LIMITATION_MESSAGE
    const t7 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'Signup.', conversationId: convoId });
    assert.equal(t7.status, 200);
    assert.equal(t7.body.action?.action, 'hirepool_signup');
    assert.ok(!t7.body.text.includes("can’t verify a HirePool login"));

    // Turn 8: "I want to join as a candidate." -> emits hirepool_signup with role='candidate'
    const t8 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'I want to join as a candidate.', conversationId: convoId });
    assert.equal(t8.status, 200);
    assert.equal(t8.body.action?.action, 'hirepool_signup');
    assert.deepEqual(t8.body.action?.parameters, { role: 'candidate' });

    const stored = sessionManager.sessions.get(convoId);
    assert.equal(stored.hirePoolVisitor.selectedRole, 'candidate');
    assert.equal(stored.hirePoolVisitor.authenticationStatus, 'unauthenticated');
    assert.equal(stored.hirePoolVisitor.registrationIntent, 'wants_signup');
    assert.ok(stored.hirePoolVisitor.signupCardOfferedCount >= 3);
  });

  await t.test('2. Streaming endpoint (POST /api/chat/stream) maintains visitor continuity across signup and follow-up turns', async () => {
    setAIProvider({
      name: 'phase1-stream-provider',
      async checkHealth() { return { available: true, model: 'test' }; },
      async chatStream({ onChunk }) {
        const text = 'HirePool connects candidates, employers, and recruitment consultancies cleanly.';
        onChunk(text);
        return { text, toolCalls: [], model: 'test' };
      }
    });

    const convoId = `visitor-stream-${Date.now()}`;

    const s1 = await request(app)
      .post('/api/chat/stream')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'Help me get started.', conversationId: convoId, stream: true });
    assert.equal(s1.status, 200);
    const ev1 = parseSseEvents(s1.text).find(e => e.type === 'done');
    assert.ok(ev1.text.includes('HirePool connects'));

    const s2 = await request(app)
      .post('/api/chat/stream')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'Continue.', conversationId: convoId, stream: true });
    assert.equal(s2.status, 200);
    const ev2 = parseSseEvents(s2.text).find(e => e.type === 'done');
    assert.notEqual(ev2.text, HIREPOOL_AMBIGUOUS_CLARIFICATION_RESPONSE);

    const s3 = await request(app)
      .post('/api/chat/stream')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'I want to join as a candidate.', conversationId: convoId, stream: true });
    assert.equal(s3.status, 200);
    const ev3 = parseSseEvents(s3.text).find(e => e.type === 'done');
    assert.equal(ev3.action?.action, 'hirepool_signup');
    assert.deepEqual(ev3.action?.parameters, { role: 'candidate' });

    const s4 = await request(app)
      .post('/api/chat/stream')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'How do I sign up?', conversationId: convoId, stream: true });
    assert.equal(s4.status, 200);
    const ev4 = parseSseEvents(s4.text).find(e => e.type === 'done');
    assert.equal(ev4.action?.action, 'hirepool_signup');
    assert.ok(!ev4.text.includes("can’t verify a HirePool login"));
  });

  await t.test('3. Additional visitor phrases vs strict domain blocking and empty/OOS ambiguity', async () => {
    for (const phrase of [
      "I'm new.",
      'I want to join.',
      'Help me get started.',
      'I want to register.',
      'How do I sign up?',
      'What can you do for me?'
    ]) {
      const result = classifyHirePoolMessage(phrase, null);
      assert.equal(
        result.category,
        HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
        `Expected "${phrase}" to classify HIREPOOL_IN_SCOPE`
      );
    }

    // Empty session short follow-ups remain AMBIGUOUS
    for (const shortPhrase of ['Tell me more', 'Tell me more.', 'Continue', 'Yes', 'Show me']) {
      const result = classifyHirePoolMessage(shortPhrase, null);
      assert.equal(
        result.category,
        HIREPOOL_DOMAIN_CATEGORIES.AMBIGUOUS,
        `Expected standalone "${shortPhrase}" to remain AMBIGUOUS`
      );
    }

    // With active visitor context, short follow-ups resolve in-scope
    const visitorSession = {
      hirePoolVisitor: { activeContext: 'platform_overview', registrationIntent: 'exploring' }
    };
    for (const shortPhrase of ['Tell me more.', 'Continue.', 'Yes.', 'Show me.']) {
      const result = classifyHirePoolMessage(shortPhrase, visitorSession);
      assert.equal(
        result.category,
        HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
        `Expected contextual "${shortPhrase}" to classify HIREPOOL_IN_SCOPE`
      );
    }

    // Unrelated trivia & competitors remain strictly blocked even mid-visitor session
    assert.equal(
      classifyHirePoolMessage("What's the national animal of India?", visitorSession).category,
      HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE
    );
    assert.equal(
      classifyHirePoolMessage('rate Naukri', visitorSession).category,
      HIREPOOL_DOMAIN_CATEGORIES.PRODUCT_COMPARISON
    );
    assert.equal(
      classifyHirePoolMessage('Who is the Prime Minister?', visitorSession).category,
      HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE
    );

    // OOS-only history must still treat "Can you help?" as AMBIGUOUS
    const oosOnlySession = {
      messages: [
        { role: 'user', content: 'Who is the Prime Minister?', scope: 'OUT_OF_SCOPE', isOutOfScope: true },
        { role: 'assistant', content: HIREPOOL_OUT_OF_SCOPE_RESPONSE, scope: 'OUT_OF_SCOPE', isOutOfScope: true }
      ]
    };
    assert.equal(
      classifyHirePoolMessage('Can you help?', oosOnlySession).category,
      HIREPOOL_DOMAIN_CATEGORIES.AMBIGUOUS
    );
  });

  await t.test('4. Auth separation & session isolation: private data requires server auth; different visitors stay isolated', async () => {
    setAIProvider({
      name: 'phase1-auth-provider',
      async checkHealth() { return { available: true, model: 'test' }; },
      async chat() {
        return { text: 'HirePool overview response.', model: 'test', finishReason: 'stop' };
      }
    });

    const visitorA = `iso-visitor-a-${Date.now()}`;
    const visitorB = `iso-visitor-b-${Date.now()}`;

    // Visitor A selects candidate role
    await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'I want to join as a candidate.', conversationId: visitorA });

    // Visitor B asks to join as consultancy -> independent visitor state
    await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'Register as a consultancy.', conversationId: visitorB });

    assert.equal(sessionManager.sessions.get(visitorA).hirePoolVisitor.selectedRole, 'candidate');
    assert.equal(sessionManager.sessions.get(visitorB).hirePoolVisitor.selectedRole, 'consultancy');

    // Unauthenticated protected request -> requires login
    const priv1 = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'Show my applications.', conversationId: visitorA });
    assert.equal(priv1.status, 200);
    assert.equal(priv1.body.action?.action, 'hirepool_login');

    // Unverified login claim -> must NOT unlock auth, but subsequent non-account question stays open
    const claim = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: 'I have logged in', conversationId: visitorA });
    assert.equal(claim.status, 200);
    assert.match(claim.body.text, /still need to verify/i);
    assert.equal(sessionManager.sessions.get(visitorA).hirePoolVisitor.authenticationStatus, 'unverified_claim');

    const overviewAfterClaim = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .send({ assistantId: 'hirepool', message: "What's HirePool about?", conversationId: visitorA });
    assert.equal(overviewAfterClaim.status, 200);
    assert.equal(overviewAfterClaim.body.text, 'HirePool overview response.');

    // Authenticated user cannot collide with another user's session; verified auth resets unverified flags
    const user1Session = storeHirePoolSession(
      'hp-token-user-1',
      { id: 'usr-phase1-1', email: 'u1@hirepool.ai', userType: 'candidate' },
      Date.now(),
      Date.now()
    );
    const user2Session = storeHirePoolSession(
      'hp-token-user-2',
      { id: 'usr-phase1-2', email: 'u2@hirepool.ai', userType: 'client' },
      Date.now(),
      Date.now()
    );

    const authConvo = `auth-convo-${Date.now()}`;
    const u1Res = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${user1Session.credential}`)
      .send({ assistantId: 'hirepool', message: 'How does matching work?', conversationId: authConvo });
    assert.equal(u1Res.status, 200);
    assert.equal(sessionManager.sessions.get(authConvo).hirePoolVisitor.authenticationStatus, 'authenticated');

    const u2Forbidden = await request(app)
      .post('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .set('Authorization', `Bearer ${user2Session.credential}`)
      .send({ assistantId: 'hirepool', message: 'Hello', conversationId: authConvo });
    assert.equal(u2Forbidden.status, 403);
  });

  await t.test('5. SessionManager limit & history summarization (>20 and >28 turns + eviction above max)', () => {
    assert.ok(
      SERVER_DEFAULTS.SESSION.MAX_MESSAGES_IN_CONTEXT > MAX_PROVIDER_HISTORY_ITEMS,
      'Session context limit must exceed MAX_PROVIDER_HISTORY_ITEMS so summarization runs instead of silent 20-msg slicing'
    );

    const manager = new SessionManager({ maxContextMessages: 60 });
    const convoId = 'history-retention-convo';

    // Add 32 in-scope messages (16 user + 16 assistant) -> previously silently truncated at 20!
    for (let i = 1; i <= 16; i += 1) {
      manager.addMessage(convoId, 'user', `Turn ${i}: Asking about HirePool onboarding step ${i}`, {
        scope: 'HIREPOOL_IN_SCOPE'
      });
      manager.addMessage(convoId, 'assistant', `Answer ${i}: HirePool guides candidate and client profiles step ${i}.`, {
        scope: 'HIREPOOL_IN_SCOPE'
      });
    }

    const session = manager.sessions.get(convoId);
    assert.equal(session.messages.length, 32, 'Session retains > 20 messages cleanly up to 60');

    const providerMsgs32 = buildProviderMessages({
      session,
      incomingMessage: 'Continue with my HirePool signup'
    });
    assert.ok(providerMsgs32.length <= 29, `Provider history (${providerMsgs32.length}) stays <= 29 items`);
    assert.ok(
      providerMsgs32[0].content.includes('[Context from earlier conversation turns'),
      'buildProviderMessages activates earlier-turn summarization above 28 messages'
    );

    // Push past 60 messages -> evicted turns are compacted into conversationSummary cleanly & redacted
    for (let i = 17; i <= 35; i += 1) {
      const fakeSecretToken = 'SuperSecretTokenValue12345678901234567890';
      manager.addMessage(convoId, 'user', `Turn ${i}: token ${fakeSecretToken} for HirePool`, {
        scope: 'HIREPOOL_IN_SCOPE'
      });
      manager.addMessage(convoId, 'assistant', `Answer ${i}: Handled HirePool onboarding step ${i}.`, {
        scope: 'HIREPOOL_IN_SCOPE'
      });
    }

    const evictedSession = manager.sessions.get(convoId);
    assert.equal(evictedSession.messages.length, 60);
    assert.ok(evictedSession.conversationSummary, 'Evicted messages are compacted into conversationSummary');
    assert.ok(!evictedSession.conversationSummary.includes('SuperSecretTokenValue'), 'Long secret tokens redacted');

    const providerMsgs70 = buildProviderMessages({
      session: evictedSession,
      incomingMessage: 'What should I do next?'
    });
    assert.ok(providerMsgs70.length <= 29);
    assert.ok(providerMsgs70[0].content.includes('[Context from earlier conversation turns'));

    // Clearing resets summary & visitor state
    manager.clear(convoId);
    assert.equal(evictedSession.messages.length, 0);
    assert.equal(evictedSession.conversationSummary, null);
    assert.equal(evictedSession.hirePoolVisitor, null);
  });

  await t.test('6. Widget signup conversation continuity & non-sensitive sessionStorage persistence', async () => {
    const sentToBackend = [];
    const harness = createWidgetHarness({
      onSendMessage: (payload) => sentToBackend.push(payload)
    });

    try {
      const { widget, storage, mockSessionStorage } = harness;
      assert.equal(widget._isGuestSession(), true);

      // Turn 7 in widget: "Signup." -> starts Role Selection & saves safe progress
      await widget.sendMessage('Signup.');
      assert.equal(widget.hirePoolSignup.state, HIREPOOL_SIGNUP_STATES.ROLE_SELECTION);
      assert.equal(sentToBackend.length, 0);

      // Turn 8 in widget: "I want to join as a candidate." -> advances into Candidate SIGNUP_FORM
      await widget.sendMessage('I want to join as a candidate.');
      assert.equal(widget.hirePoolSignup.state, HIREPOOL_SIGNUP_STATES.SIGNUP_FORM);
      assert.equal(widget.hirePoolSignup.selectedRole, 'candidate');

      // Check persisted snapshot in sessionStorage contains ONLY safe fields (no tokens/passwords/email)
      const persistedKeys = [...mockSessionStorage.data.keys()];
      const progressKey = persistedKeys.find(k => k.includes('hirepool_signup_progress'));
      assert.ok(progressKey, 'Signup progress key written to scoped sessionStorage');
      const rawProgress = JSON.parse(mockSessionStorage.data.get(progressKey));
      assert.equal(rawProgress.state, 'signup_form');
      assert.equal(rawProgress.selectedRole, 'candidate');
      assert.equal(rawProgress.agreement?.id, 'agr-candidate-v1');
      for (const secretKey of ['password', 'confirmPassword', 'signupToken', 'verificationToken', 'accessToken', 'refreshToken', 'credential', 'email']) {
        assert.equal(rawProgress[secretKey], undefined, `Must NEVER store ${secretKey} in browser storage`);
      }

      // Informational question during SIGNUP_FORM forwards to backend with non-secret signup state tag
      await widget.sendMessage('What happens after I submit this form?');
      assert.equal(sentToBackend.length, 1);
      assert.ok(sentToBackend[0].context.includes('[HIREPOOL_SIGNUP_STATE state=signup_form role=candidate]'));
      assert.equal(widget.hirePoolSignup.state, HIREPOOL_SIGNUP_STATES.SIGNUP_FORM);

      // Simulate page reload into a fresh widget sharing the same sessionStorage -> restores SIGNUP_FORM safely
      const storageAfterReload = new AssistantStorage('hirepool', 'session');
      const coordinatorAfterReload = new HirePoolSignupCoordinator({
        apiClient: harness.apiClient
      });
      const restored = await coordinatorAfterReload.restoreProgress(storageAfterReload.getSignupProgress());
      assert.equal(restored, true);
      assert.equal(coordinatorAfterReload.state, HIREPOOL_SIGNUP_STATES.SIGNUP_FORM);
      assert.equal(coordinatorAfterReload.selectedRole, 'candidate');

      // Cancellation via chat resets signup and clears stored progress
      await widget.sendMessage('cancel');
      assert.equal(widget.hirePoolSignup.state, HIREPOOL_SIGNUP_STATES.IDLE);
      assert.equal(storage.getSignupProgress(), null);

      // Authenticated session flips _isGuestSession to false
      harness.apiClient.setAuthenticatedSession({
        credential: 'sdk-token-verified',
        identity: { id: 'usr-99', user_type: 'candidate' }
      });
      assert.equal(widget._isGuestSession(), false);

      // Action card Confirm forwards preserved parameters.role into hirePoolSignup.start(role)
      harness.apiClient.clearAuthenticatedSession();
      const startedRoles = [];
      widget._startHirePoolSignup = async (role) => { startedRoles.push(role); };
      let confirmHandler = null;
      const confirmBtn = {
        disabled: false,
        addEventListener: (ev, cb) => { if (ev === 'click') confirmHandler = cb; }
      };
      const cancelBtn = { disabled: false, addEventListener: () => {} };
      const origCreate = globalThis.document.createElement;
      globalThis.document.createElement = () => ({
        className: '',
        innerHTML: '',
        setAttribute: () => {},
        appendChild: () => {},
        remove: () => {},
        querySelector: (sel) => {
          if (sel === '.ai-btn-action-confirm') return confirmBtn;
          if (sel === '.ai-btn-action-cancel') return cancelBtn;
          if (sel === '.ai-action-acknowledge') return null;
          return new FakeElement('div');
        }
      });
      try {
        const bubble = new FakeElement('div');
        bubble.querySelector = () => null;
        widget._renderActionCard(bubble, {
          id: 'act-signup-consultancy',
          action: 'hirepool_signup',
          title: 'Sign up for HirePool',
          explanation: 'Open signup for consultancy role',
          parameters: { role: 'consultancy' },
          risk: 'read',
          requiresConfirmation: true
        });
        assert.ok(confirmHandler, 'Confirm button listener registered');
        confirmHandler();
        assert.deepEqual(startedRoles, ['consultancy']);
      } finally {
        globalThis.document.createElement = origCreate;
      }
    } finally {
      harness.cleanup();
    }
  });
});
