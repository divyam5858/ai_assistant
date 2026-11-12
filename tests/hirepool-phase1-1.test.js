import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { sessionManager } from '../backend/src/session-manager.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { registerHirePoolLocalDevelopmentIntegration } from '../integrations/hirepool/local-development.js';
import {
  classifyHirePoolMessage,
  HIREPOOL_DOMAIN_CATEGORIES
} from '../integrations/hirepool/domain-policy.js';
import {
  isHirePoolSignupRequest,
  isHirePoolAccountRequest,
  isHirePoolVisitorExplorationRequest
} from '../integrations/hirepool/visitor-state.js';
import {
  createHirePoolSignupRouter,
  clearAllOnboardingSessions,
  extractSafeVerificationUrl
} from '../backend/src/routes/hirepool-signup.js';
import { AssistantStorage } from '../widget/src/storage.js';
import { AssistantWidgetUI } from '../widget/src/widget.js';
import {
  HirePoolSignupCoordinator,
  HIREPOOL_SIGNUP_STATES,
  isSafeVerificationUrl,
  renderVerificationCard,
  renderProfileCollectionCard
} from '../widget/src/hirepool-signup.js';

// ============================================================================
// Lightweight DOM / Browser Environment Shim for Widget Component Tests
// ============================================================================

const VOID_TAGS = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

class ClassListShim {
  constructor(el) {
    this.el = el;
  }
  _tokens() {
    return String(this.el.className || '').split(/\s+/).filter(Boolean);
  }
  add(...names) {
    const set = new Set(this._tokens());
    names.forEach(n => set.add(n));
    this.el.className = Array.from(set).join(' ');
  }
  remove(...names) {
    const rm = new Set(names);
    this.el.className = this._tokens().filter(n => !rm.has(n)).join(' ');
  }
  contains(name) {
    return this._tokens().includes(name);
  }
}

function parseAttributes(rawAttr) {
  const attrs = {};
  const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = attrRegex.exec(rawAttr || '')) !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = val;
  }
  return attrs;
}

function matchSingleSelector(el, selector) {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  const tagMatch = trimmed.match(/^([a-zA-Z0-9-]+)/);
  if (tagMatch && el.tagName !== tagMatch[1].toLowerCase()) {
    return false;
  }
  const classMatches = [...trimmed.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
  for (const [, cls] of classMatches) {
    if (!el.classList.contains(cls)) return false;
  }
  const attrMatches = [...trimmed.matchAll(/\[([a-zA-Z0-9_-]+)\s*=\s*"?([^"\]]+)"?\]/g)];
  for (const [, attr, expected] of attrMatches) {
    if ((el.attributes[attr] ?? el[attr]) !== expected) return false;
  }
  return true;
}

function matchesSelector(el, selector) {
  return selector
    .split(',')
    .some(part => matchSingleSelector(el, part));
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName || 'div').toLowerCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.listeners = {};
    this.parentElement = null;
    this.parentNode = null;
    this.className = '';
    this.classList = new ClassListShim(this);
    this._value = '';
    this._textContent = '';
    this._innerHTML = '';
    this.disabled = false;
    this.dataset = {};
  }

  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v == null ? '' : String(v);
  }

  get textContent() {
    return `${this._textContent || ''}${this.children.map(c => c.textContent).join('')}`;
  }
  set textContent(v) {
    this._textContent = v == null ? '' : String(v);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(html) {
    this._innerHTML = String(html || '');
    this.children = [];
    this._textContent = '';
    buildDomTree(this, this._innerHTML);
  }

  appendChild(child) {
    if (!child) return child;
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this._textContent += node;
      } else {
        this.appendChild(node);
      }
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    this.append(...nodes);
  }

  insertAdjacentElement(_position, elem) {
    return this.appendChild(elem);
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      this.parentElement = null;
      this.parentNode = null;
    }
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'class') this.className = String(val);
    if (name === 'value') this._value = String(val);
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    return this.attributes[name] ?? null;
  }

  addEventListener(eventName, cb) {
    this.listeners[eventName] = this.listeners[eventName] || [];
    this.listeners[eventName].push(cb);
  }

  async trigger(eventName, eventObj = {}) {
    const evt = {
      preventDefault() {},
      stopPropagation() {},
      target: this,
      ...eventObj
    };
    for (const cb of this.listeners[eventName] || []) {
      await cb(evt);
    }
  }

  click() {
    return this.trigger('click');
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  focus() {}
  scrollIntoView() {}
  reset() {}
}

function buildDomTree(root, html) {
  const stack = [root];
  const tokenRegex = /<(\/?)([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tokenRegex.exec(html)) !== null) {
    const current = stack[stack.length - 1] || root;
    if (match[4] !== undefined) {
      const txt = match[4].replace(/\s+/g, ' ');
      if (txt.trim()) {
        current._textContent = `${current._textContent || ''}${match[4]}`;
      }
      continue;
    }
    const isClose = match[1] === '/';
    const tag = match[2].toLowerCase();
    const rawAttr = match[3] || '';
    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].tagName === tag) {
        stack.pop();
      }
      continue;
    }
    const el = new FakeElement(tag);
    const attrs = parseAttributes(rawAttr);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (attrs.value !== undefined) el.value = attrs.value;
    current.appendChild(el);
    if (!VOID_TAGS.has(tag) && !rawAttr.trim().endsWith('/')) {
      stack.push(el);
    }
  }
}

function installBrowserGlobals({ openedUrls = [] } = {}) {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevFormData = globalThis.FormData;
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const winListeners = new Map();
  const docListeners = new Map();

  class MockFormData {
    constructor(formEl) {
      this._entries = [];
      if (formEl && typeof formEl.querySelectorAll === 'function') {
        const controls = formEl.querySelectorAll('input, select, textarea');
        for (const ctrl of controls) {
          const name = ctrl.getAttribute('name');
          if (!name) continue;
          this._entries.push([name, ctrl.value ?? '']);
        }
      }
    }
    get(name) {
      const hit = this._entries.find(([k]) => k === name);
      return hit ? hit[1] : null;
    }
    entries() {
      return this._entries[Symbol.iterator]();
    }
  }

  const mockWindow = {
    location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/' },
    localStorage,
    sessionStorage,
    openedUrls,
    open(url, target, features) {
      openedUrls.push({ url, target, features });
      return { closed: false };
    },
    addEventListener(name, fn) {
      if (!winListeners.has(name)) winListeners.set(name, new Set());
      winListeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      winListeners.get(name)?.delete(fn);
    },
    dispatchEvent(name) {
      for (const fn of winListeners.get(name) || []) {
        fn({ type: name });
      }
    }
  };

  const mockDocument = {
    visibilityState: 'visible',
    createElement: (tag) => new FakeElement(tag),
    addEventListener(name, fn) {
      if (!docListeners.has(name)) docListeners.set(name, new Set());
      docListeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      docListeners.get(name)?.delete(fn);
    },
    dispatchEvent(name) {
      for (const fn of docListeners.get(name) || []) {
        fn({ type: name });
      }
    }
  };

  globalThis.window = mockWindow;
  globalThis.document = mockDocument;
  globalThis.FormData = MockFormData;

  return {
    window: mockWindow,
    document: mockDocument,
    localStorage,
    sessionStorage,
    winListeners,
    docListeners,
    cleanup() {
      globalThis.window = prevWindow;
      globalThis.document = prevDocument;
      globalThis.FormData = prevFormData;
    }
  };
}

function parseSseEvents(rawText) {
  const events = [];
  const blocks = String(rawText || '').split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventName = 'message';
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length) {
      const joined = dataLines.join('\n');
      try {
        events.push({ event: eventName, data: JSON.parse(joined) });
      } catch {
        events.push({ event: eventName, data: joined });
      }
    }
  }
  return events;
}

// ============================================================================
// PRIORITY 1 TESTS: Profile Completion Form UI Overflow & Responsive Grid
// ============================================================================

test('Priority 1: styles.css enforces responsive containment and no horizontal overflow on signup/profile cards', async () => {
  const cssPath = path.resolve('widget/src/styles.css');
  const css = await fs.readFile(cssPath, 'utf8');

  assert.match(css, /\.ai-header\s*\{[\s\S]*?flex-shrink:\s*0;/);
  assert.match(css, /\.ai-footer\s*\{[\s\S]*?flex-shrink:\s*0;/);
  assert.match(css, /\.ai-body\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-x:\s*hidden;/);
  assert.match(css, /\.ai-message-row\.ai-signup-row\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.ai-signup-card\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?box-sizing:\s*border-box;/);
  assert.match(css, /\.ai-profile-form\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;[\s\S]*?box-sizing:\s*border-box;/);
  assert.match(css, /\.ai-form-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.ai-form-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.ai-form-input\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
  assert.match(css, /\.ai-action-controls\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
});

test('Priority 1: renderProfileCollectionCard uses .ai-form-row (no inline 1fr 1fr overflow grids) across all three roles', async () => {
  const env = installBrowserGlobals();
  try {
    const expectations = [
      {
        role: 'candidate',
        minRows: 3,
        fields: ['first_name', 'last_name', 'phone', 'current_location', 'job_title', 'skills', 'years_of_experience', 'notice_period_days'],
        validInputs: {
          first_name: 'Asha',
          last_name: 'Rao',
          phone: '9876543210',
          current_location: 'Bengaluru',
          job_title: 'Frontend Engineer',
          skills: 'TypeScript, Node.js',
          years_of_experience: '2',
          notice_period_days: '30'
        }
      },
      {
        role: 'client',
        minRows: 3,
        fields: ['company_name', 'industry', 'company_size', 'headquarters_location', 'contact_name', 'contact_phone', 'designation', 'company_website'],
        validInputs: {
          company_name: 'Acme Hiring',
          industry: 'Technology & Software',
          company_size: '11-50',
          headquarters_location: 'Bengaluru',
          contact_name: 'Rohan Sharma',
          contact_phone: '9876543210',
          designation: 'Head of Talent',
          company_website: 'https://acme.example.com'
        }
      },
      {
        role: 'consultancy',
        minRows: 3,
        fields: [
          'consultancy_name',
          'consultancy_type',
          'headquarters_location',
          'industry_specialization',
          'contact_name',
          'contact_phone',
          'designation',
          'website'
        ],
        validInputs: {
          consultancy_name: 'Apex Recruitment',
          consultancy_type: 'recruitment',
          headquarters_location: 'Mumbai',
          industry_specialization: 'Technology, Finance',
          contact_name: 'Meera Iyer',
          contact_phone: '9876543210',
          designation: 'Director',
          website: 'https://apex.example.com'
        }
      }
    ];

    for (const spec of expectations) {
      let submittedProfile = null;
      const card = renderProfileCollectionCard({
        role: spec.role,
        profileData: {},
        onReview: (profile) => {
          submittedProfile = profile;
        },
        onCancel: () => {}
      });

      assert.equal(card.innerHTML.includes('1fr 1fr'), false, `${spec.role} must not use inline 1fr 1fr grids`);
      const rows = card.querySelectorAll('.ai-form-row');
      assert.ok(rows.length >= spec.minRows, `${spec.role} should render at least ${spec.minRows} .ai-form-row grids`);

      const form = card.querySelector('form');
      assert.ok(form && form.classList.contains('ai-profile-form'));

      for (const fieldName of spec.fields) {
        const input = form.querySelector(`[name="${fieldName}"]`);
        assert.ok(input, `${spec.role} form should include input "${fieldName}"`);
        assert.ok(input.classList.contains('ai-form-input'), `${spec.role} field "${fieldName}" should carry .ai-form-input`);
        assert.ok(input.parentElement?.classList.contains('ai-form-group'), `${spec.role} field "${fieldName}" should sit inside .ai-form-group`);
        if (spec.validInputs[fieldName] !== undefined) {
          input.value = spec.validInputs[fieldName];
        }
      }

      // Trigger validation & submit
      await form.trigger('submit');
      assert.ok(submittedProfile, `${spec.role} valid profile should invoke onReview`);
    }
  } finally {
    env.cleanup();
  }
});

test('Priority 1 & 2: AssistantWidgetUI mounts signup cards in .ai-signup-row and manages verification watcher lifecycle', async () => {
  const openedUrls = [];
  const env = installBrowserGlobals({ openedUrls });
  try {
    const storage = new AssistantStorage('hirepool', 'session');
    let verificationState = false;
    let checkCalls = 0;

    const apiClient = {
      getAuthenticatedSession: () => null,
      setAuthenticatedSession: () => {},
      clearAuthenticatedSession: () => {},
      getDocuments: async () => [],
      clearSession: async () => {},
      validateHirePoolSession: async () => ({ valid: true }),
      getSignupAgreement: async (role) => ({ id: `agr-${role}`, version: '1.0', role, title: 'Terms' }),
      signupRegister: async ({ email, userType }) => ({
        status: 'pending_verification',
        signupToken: 'signup-tok-ui-1',
        email,
        userType,
        verificationUrl: 'http://localhost:5173/auth/verify-email?token=ui-magic-123'
      }),
      checkSignupVerificationStatus: async () => {
        checkCalls++;
        return {
          status: verificationState ? 'verified' : 'pending_verification',
          isVerified: verificationState
        };
      },
      resendSignupVerification: async () => ({
        status: 'verification_resent',
        verificationUrl: 'http://localhost:5173/auth/verify-email?token=ui-magic-456'
      }),
      cancelSignup: async () => ({ status: 'cancelled' })
    };

    const widget = new AssistantWidgetUI(
      { assistantId: 'hirepool', context: {}, features: { streaming: true }, hasActionHandler: () => true },
      apiClient,
      storage,
      { emit() {} }
    );

    widget.messagesList = new FakeElement('div');
    widget.body = new FakeElement('div');
    widget.textarea = new FakeElement('textarea');
    widget.sendBtn = new FakeElement('button');
    widget.stopBtn = new FakeElement('button');
    widget.statusDot = new FakeElement('span');
    widget.statusText = new FakeElement('span');
    widget.streamingIndicator = new FakeElement('div');
    widget._renderMessageBubble = (role, content) => {
      const bubble = new FakeElement('div');
      bubble.textContent = `${role}: ${content}`;
      widget.messagesList.appendChild(bubble);
    };

    await widget.hirePoolSignup.selectRole('candidate');
    await widget.hirePoolSignup.submitSignup({
      email: 'ui.verify@example.com',
      password: 'Password123',
      confirmPassword: 'Password123'
    });

    assert.equal(widget.hirePoolSignup.state, HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING);

    const signupRows = widget.messagesList.querySelectorAll('.ai-signup-row');
    assert.ok(signupRows.length >= 1);
    const verificationRow = signupRows[signupRows.length - 1];
    assert.ok(verificationRow.classList.contains('ai-message-row'));

    const verifyBtn = verificationRow.querySelector('.ai-btn-verify-email');
    assert.ok(verifyBtn, 'Verification card in widget UI should expose Verify Email button when URL is returned');
    await verifyBtn.click();
    assert.equal(openedUrls.length, 1);
    assert.equal(openedUrls[0].url, 'http://localhost:5173/auth/verify-email?token=ui-magic-123');
    assert.equal(openedUrls[0].target, '_blank');

    // Focus/visibility listeners must be registered while pending verification
    assert.ok((env.winListeners.get('focus')?.size || 0) >= 1);
    assert.ok((env.docListeners.get('visibilitychange')?.size || 0) >= 1);

    // Ensure verification URL/token is never written to browser storage
    const allStored = [
      ...env.localStorage.map.entries(),
      ...env.sessionStorage.map.entries()
    ]
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    assert.equal(allStored.includes('ui-magic-123'), false);
    assert.equal(allStored.includes('verify-email'), false);

    // User finishes verification in tab and returns focus to assistant tab
    verificationState = true;
    env.window.dispatchEvent('focus');
    await new Promise(resolve => setTimeout(resolve, 25));

    assert.equal(checkCalls >= 1, true);
    assert.equal(widget.hirePoolSignup.state, HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION);
    // Watcher must tear down automatically upon advancing past verification
    assert.equal(env.winListeners.get('focus')?.size || 0, 0);
    assert.equal(env.docListeners.get('visibilitychange')?.size || 0, 0);

    // Latest card row uses .ai-signup-row + .ai-profile-form without inline 1fr 1fr
    const profileRow = widget.messagesList.children[widget.messagesList.children.length - 1];
    assert.ok(profileRow.classList.contains('ai-signup-row'));
    assert.ok(profileRow.querySelector('.ai-profile-form'));
    assert.ok(profileRow.querySelectorAll('.ai-form-row').length >= 2);

    widget._stopVerificationWatcher();
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// PRIORITY 2 TESTS: Backend Contract, Security Validation & Verification Flow
// ============================================================================

test('Priority 2: extractSafeVerificationUrl & isSafeVerificationUrl allow valid HirePool verify links and reject unsafe URLs', () => {
  const validLocal = 'http://localhost:5173/auth/verify-email?token=abc.def.ghi';
  const validProd = 'https://app.hirepool.ai/auth/verify-email?token=xyz123';

  assert.equal(extractSafeVerificationUrl(validLocal), validLocal);
  assert.equal(extractSafeVerificationUrl(validProd), validProd);
  assert.equal(isSafeVerificationUrl(validLocal), true);
  assert.equal(isSafeVerificationUrl(validProd), true);

  const unsafeUrls = [
    'javascript:alert(1)',
    'https://evil.example.com/auth/verify-email?token=123',
    'http://localhost:3000/dashboard?token=123',
    'http://localhost:5173/dashboard?token=123',
    'http://localhost:5173/auth/verify-email',
    'https://hirepool.ai/auth/verify-email#token=123',
    ''
  ];

  for (const bad of unsafeUrls) {
    assert.equal(extractSafeVerificationUrl(bad), null, `Server validator must reject: ${bad}`);
    assert.equal(isSafeVerificationUrl(bad), false, `Widget validator must reject: ${bad}`);
  }
});

test('Priority 2: signup router supports verification_url passthrough, missing-URL fallback, 401 refresh check, and expiry', async () => {
  clearAllOnboardingSessions();
  let backendVerified = false;
  let meAttempts = 0;
  let provideVerificationUrl = true;
  let nextUrl = 'http://localhost:5173/auth/verify-email?token=fresh-token-1';

  const fetchMock = async (url, options = {}) => {
    const urlStr = url.toString();
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};

    if (urlStr.includes('/api/v1/agreements/current')) {
      return { ok: true, status: 200, json: async () => ({ id: 'agr-cand', version: '1.0', role: 'candidate' }) };
    }

    if (urlStr.includes('/api/v1/auth/register') && method === 'POST') {
      const payload = {
        access_token: 'access-v1',
        refresh_token: 'refresh-v1',
        user: { id: 'u-verify-1', email: body.email, user_type: body.user_type, is_verified: false }
      };
      if (provideVerificationUrl) {
        payload.verification_url = nextUrl;
      }
      return { ok: true, status: 201, json: async () => payload };
    }

    if ((urlStr.includes('/api/v1/auth/magic-link') || urlStr.includes('/api/v1/auth/resend-verification')) && method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => (provideVerificationUrl ? { message: 'Sent', verification_url: nextUrl } : { message: 'Sent' })
      };
    }

    if (urlStr.includes('/api/v1/auth/me') && method === 'GET') {
      meAttempts++;
      const auth = options.headers?.Authorization || '';
      if (meAttempts === 2 && auth === 'Bearer access-v1') {
        return { ok: false, status: 401, json: async () => ({ detail: 'Expired access token' }) };
      }
      if (auth === 'Bearer access-v2' || meAttempts !== 2) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'u-verify-1', email: 'v@example.com', user_type: 'candidate', is_verified: backendVerified })
        };
      }
      return { ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) };
    }

    if (urlStr.includes('/api/v1/auth/refresh') && method === 'POST') {
      assert.equal(body.refresh_token, 'refresh-v1');
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'access-v2', refresh_token: 'refresh-v2' })
      };
    }

    return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) };
  };

  const app = express();
  app.use(express.json());
  app.use('/api/hirepool/signup', createHirePoolSignupRouter({ fetchImpl: fetchMock, baseUrl: 'http://localhost:8000/' }));

  // Case 1: Backend returns valid verification_url
  const regWithUrl = await request(app)
    .post('/api/hirepool/signup/register')
    .set('Origin', 'http://localhost:3000')
    .send({
      email: 'v@example.com',
      password: 'Password123',
      confirmPassword: 'Password123',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: 'agr-cand'
    });
  assert.equal(regWithUrl.status, 201);
  assert.equal(regWithUrl.body.verificationUrl, 'http://localhost:5173/auth/verify-email?token=fresh-token-1');

  // Check status before verified -> false
  const checkPending = await request(app)
    .post('/api/hirepool/signup/check-verification')
    .set('Origin', 'http://localhost:3000')
    .send({
      signupToken: regWithUrl.body.signupToken
    });
  assert.equal(checkPending.status, 200);
  assert.equal(checkPending.body.isVerified, false);

  // Resend refreshes verification_url safely
  nextUrl = 'http://localhost:5173/auth/verify-email?token=resent-token-2';
  const resendRes = await request(app)
    .post('/api/hirepool/signup/resend-verification')
    .set('Origin', 'http://localhost:3000')
    .send({
      signupToken: regWithUrl.body.signupToken
    });
  assert.equal(resendRes.status, 200);
  assert.equal(resendRes.body.verificationUrl, 'http://localhost:5173/auth/verify-email?token=resent-token-2');

  // Backend verifies user and first /me returns 401 triggering refresh -> access-v2 -> verified!
  backendVerified = true;
  const checkVerified = await request(app)
    .post('/api/hirepool/signup/check-verification')
    .set('Origin', 'http://localhost:3000')
    .send({
      signupToken: regWithUrl.body.signupToken
    });
  assert.equal(checkVerified.status, 200);
  assert.equal(checkVerified.body.isVerified, true);
  assert.equal(checkVerified.body.stage, 'email_verified');

  // Case 2: Unsafe URL from upstream is dropped cleanly (never forged or forwarded)
  nextUrl = 'https://phishing.bad/auth/verify-email?token=steal';
  const regUnsafeUrl = await request(app)
    .post('/api/hirepool/signup/register')
    .set('Origin', 'http://localhost:3000')
    .send({
      email: 'v2@example.com',
      password: 'Password123',
      confirmPassword: 'Password123',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: 'agr-cand'
    });
  assert.equal(regUnsafeUrl.status, 201);
  assert.equal(regUnsafeUrl.body.verificationUrl, undefined);

  // Case 3: Unmodified HirePool backend omits verification_url -> SDK returns undefined cleanly (no fabrication)
  provideVerificationUrl = false;
  const regNoUrl = await request(app)
    .post('/api/hirepool/signup/register')
    .set('Origin', 'http://localhost:3000')
    .send({
      email: 'v3@example.com',
      password: 'Password123',
      confirmPassword: 'Password123',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: 'agr-cand'
    });
  assert.equal(regNoUrl.status, 201);
  assert.equal(regNoUrl.body.verificationUrl, undefined);

  // Case 4: Cancelled/expired signupToken returns 410 SESSION_EXPIRED on /check-verification
  await request(app)
    .post('/api/hirepool/signup/cancel')
    .set('Origin', 'http://localhost:3000')
    .send({ signupToken: regNoUrl.body.signupToken })
    .expect(200);

  const expiredCheck = await request(app)
    .post('/api/hirepool/signup/check-verification')
    .set('Origin', 'http://localhost:3000')
    .send({ signupToken: regNoUrl.body.signupToken });
  assert.equal(expiredCheck.status, 410);
  assert.equal(expiredCheck.body.error?.code, 'SESSION_EXPIRED');
});

test('Priority 2: renderVerificationCard & HirePoolSignupCoordinator handle button mode, fallback mode, and concurrent poll deduplication', async () => {
  const env = installBrowserGlobals();
  try {
    // 1. With verificationUrl: shows Verify Email button & exact prompt copy
    let verifyClicks = 0;
    const cardWithUrl = renderVerificationCard({
      email: 'user@example.com',
      verificationUrl: 'https://app.hirepool.ai/auth/verify-email?token=tok123',
      onVerifyClick: () => {
        verifyClicks++;
      },
      onCheckStatus: async () => ({ isVerified: false }),
      onResend: async () => {},
      onCancel: () => {}
    });
    assert.ok(cardWithUrl.querySelector('.ai-btn-verify-email'));
    assert.ok(cardWithUrl.innerHTML.includes('Verify Email'));
    assert.ok(cardWithUrl.innerHTML.includes('You can verify your email using the button below.'));
    await cardWithUrl.querySelector('.ai-btn-verify-email').click();
    assert.equal(verifyClicks, 1);

    // 2. Without verificationUrl: omits Verify Email button cleanly and falls back to email instructions
    const cardWithoutUrl = renderVerificationCard({
      email: 'user@example.com',
      verificationUrl: null,
      onCheckStatus: async () => ({ isVerified: false }),
      onResend: async () => {},
      onCancel: () => {}
    });
    assert.equal(cardWithoutUrl.querySelector('.ai-btn-verify-email'), null);
    assert.ok(cardWithoutUrl.innerHTML.includes('Check Verification Status'));

    // 3. Coordinator concurrent verification poll deduplication
    let networkCalls = 0;
    const states = [];
    const coordinator = new HirePoolSignupCoordinator({
      onStateChange: (state) => states.push(state),
      apiClient: {
        getSignupAgreement: async () => ({ id: 'agr-1', version: '1.0', role: 'candidate' }),
        signupRegister: async ({ email, userType }) => ({
          status: 'pending_verification',
          signupToken: 'tok-dedupe',
          email,
          userType,
          verificationUrl: 'https://app.hirepool.ai/auth/verify-email?token=tok-dedupe-1'
        }),
        checkSignupVerificationStatus: async () => {
          networkCalls++;
          await new Promise(resolve => setTimeout(resolve, 25));
          return { isVerified: true };
        }
      }
    });

    await coordinator.selectRole('candidate');
    await coordinator.submitSignup({
      email: 'dedupe@example.com',
      password: 'Password123',
      confirmPassword: 'Password123'
    });

    const [r1, r2, r3] = await Promise.all([
      coordinator.checkVerificationStatus({ silent: true }),
      coordinator.checkVerificationStatus({ silent: true }),
      coordinator.checkVerificationStatus()
    ]);

    assert.equal(networkCalls, 1, 'Concurrent verification checks must share one in-flight call');
    assert.equal(r1.isVerified, true);
    assert.equal(r2.isVerified, true);
    assert.equal(r3.isVerified, true);
    assert.equal(coordinator.state, HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION);
    assert.equal(
      states.filter(s => s === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED).length,
      1,
      'EMAIL_VERIFIED transition must happen exactly once'
    );
  } finally {
    env.cleanup();
  }
});

// ============================================================================
// PRIORITY 3 TESTS: Domain Classification, Visitor Routing & 13-Turn Conversation
// ============================================================================

const THIRTEEN_TURN_VISITOR_QUESTIONS = [
  'How does HirePool work?',
  'Do you support freshers?',
  'What types of jobs are available?',
  'Can I search for remote jobs?',
  'Can I find hybrid jobs?',
  'Can I find contract jobs?',
  'Do you have jobs for experienced professionals?',
  'How does AI job matching work?',
  'How do I complete my profile?',
  'Is HirePool free for candidates?',
  'Can I apply for multiple jobs?',
  'How do employers find candidates?',
  'How do consultancies use HirePool?'
];

test('Priority 3: domain classifier & visitor intent detectors accurately handle all 13 public HirePool questions + signup phrasings', () => {
  for (const question of THIRTEEN_TURN_VISITOR_QUESTIONS) {
    const cls = classifyHirePoolMessage(question, null);
    assert.equal(
      cls.category,
      HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
      `Expected HIREPOOL_IN_SCOPE for "${question}", got ${cls.category}`
    );
    assert.equal(isHirePoolAccountRequest(question), false, `Informational "${question}" must NOT look like private account access`);
    assert.equal(isHirePoolSignupRequest(question), false, `Informational "${question}" must NOT auto-trigger signup`);
  }

  // Questions without naming "HirePool"
  const genericInScope = [
    'Can freshers find entry-level jobs here?',
    'Are remote and hybrid roles supported?',
    'How do staffing agencies collaborate with employers?'
  ];
  for (const q of genericInScope) {
    const cls = classifyHirePoolMessage(q, null);
    assert.equal(
      cls.category,
      HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
      `Expected generic HirePool question in-scope: "${q}"`
    );
  }

  // Visitor exploration & signup intent detection
  assert.equal(isHirePoolVisitorExplorationRequest("I'm new to HirePool."), true);
  assert.equal(isHirePoolSignupRequest("I don't have an account yet. Can you help?"), true);
  assert.equal(isHirePoolAccountRequest("I don't have an account yet. Can you help?"), false);

  // Unrelated general-knowledge & competitor comparisons stay out of scope
  assert.equal(classifyHirePoolMessage('Who is the Prime Minister?', null).category, HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE);
  assert.equal(classifyHirePoolMessage("What's the national animal of India?", null).category, HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE);
  assert.equal(classifyHirePoolMessage('Rate Naukri', null).category, HIREPOOL_DOMAIN_CATEGORIES.PRODUCT_COMPARISON);
  assert.equal(classifyHirePoolMessage('Which is better, HirePool or Naukri?', null).category, HIREPOOL_DOMAIN_CATEGORIES.PRODUCT_COMPARISON);
});

test('Priority 3: full 13-turn guest conversation retains context, answers via grounded LLM without signup/login spam, and routes signup turn cleanly', async () => {
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.AI_PROVIDER = 'mock';
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';

  registerHirePoolLocalDevelopmentIntegration();
  sessionManager.sessions.clear();
  const app = createApp();

  const providerCalls = [];
  setAIProvider({
    name: 'phase1-1-visitor-test-provider',
    async chat({ messages = [], systemInstruction = '', tools = [] } = {}) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
      providerCalls.push({
        lastUser,
        historyCount: messages.length,
        historyTexts: messages.map(m => `${m.role}:${m.content}`),
        systemInstruction,
        toolNames: tools.map(t => t.name)
      });

      // Intentionally return a rogue signup action block in text to verify server suppresses
      // intrusive action cards during informational visitor questions
      return {
        text: `HirePool supports this clearly for your question (${lastUser}).\n\`\`\`action\n{"action":"hirepool_signup","params":{}}\n\`\`\``,
        toolCalls: [{ name: 'hirepool_signup', arguments: {} }]
      };
    },
    async *chatStream({ messages = [], systemInstruction = '', tools = [] } = {}) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
      providerCalls.push({
        lastUser,
        historyCount: messages.length,
        historyTexts: messages.map(m => `${m.role}:${m.content}`),
        systemInstruction,
        toolNames: tools.map(t => t.name)
      });
      yield { type: 'text', content: `Streamed HirePool answer for: ${lastUser}` };
      yield { type: 'done', finishReason: 'stop' };
    }
  });

  let conversationId = null;

  // Execute all 13 exact turns sequentially in one session
  for (let i = 0; i < THIRTEEN_TURN_VISITOR_QUESTIONS.length; i++) {
    const q = THIRTEEN_TURN_VISITOR_QUESTIONS[i];
    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'hirepool',
        ...(conversationId ? { conversationId } : {}),
        message: q,
        stream: false
      })
      .expect(200);

    if (!conversationId) {
      conversationId = res.body.conversationId;
    } else {
      assert.equal(res.body.conversationId, conversationId);
    }

    assert.equal(res.body.action ?? null, null, `Turn ${i + 1} ("${q}") must NOT emit intrusive signup/login card`);
    assert.equal(
      res.body.text.includes("I can't verify a HirePool login"),
      false,
      `Turn ${i + 1} must never return stale auth limitation message`
    );

    const call = providerCalls[providerCalls.length - 1];
    assert.equal(call.toolNames.includes('hirepool_signup'), false, `Turn ${i + 1} must not pass hirepool_signup tool to LLM`);
    assert.equal(call.toolNames.includes('hirepool_login'), false, `Turn ${i + 1} must not pass hirepool_login tool to LLM`);
    assert.match(call.systemInstruction, /\[VERIFIED HIREPOOL PLATFORM CAPABILITIES\]/);
    if (i > 0) {
      assert.ok(call.historyCount >= 3, `Turn ${i + 1} must carry prior conversation turns`);
    }
  }

  assert.equal(providerCalls.length, THIRTEEN_TURN_VISITOR_QUESTIONS.length);

  // Turn 14: Explicit signup prompt in SAME session triggers in-chat hirepool_signup cleanly (JSON)
  const signupTurnRes = await request(app)
    .post('/api/chat')
    .send({
      assistantId: 'hirepool',
      conversationId,
      message: "I don't have an account yet. Can you help?",
      stream: false
    })
    .expect(200);

  assert.equal(signupTurnRes.body.action?.action, 'hirepool_signup');
  assert.match(signupTurnRes.body.text, /right here in chat/i);
  assert.equal(/new tab/i.test(signupTurnRes.body.text), false);

  // Also verify SSE stream route emits hirepool_signup for same intent cleanly
  const streamSignupRes = await request(app)
    .post('/api/chat/stream')
    .send({
      assistantId: 'hirepool',
      message: "I don't have an account yet. Can you help?"
    })
    .expect(200);

  const sseEvents = parseSseEvents(streamSignupRes.text);
  const actionEvent = sseEvents.find(e => e.data?.type === 'action');
  assert.equal(actionEvent?.data?.action?.action, 'hirepool_signup');

  // Out-of-scope probe stays deterministically blocked and excluded from subsequent HirePool history
  const oosRes = await request(app)
    .post('/api/chat')
    .send({
      assistantId: 'hirepool',
      conversationId,
      message: 'Who is the Prime Minister?',
      stream: false
    })
    .expect(200);
  assert.equal(oosRes.body.action ?? null, null);
  assert.match(oosRes.body.text, /outside the HirePool platform/i);

  // Follow-up in-scope turn on stream route succeeds and excludes prior OOS message
  const streamInfoRes = await request(app)
    .post('/api/chat/stream')
    .send({
      assistantId: 'hirepool',
      conversationId,
      message: 'Can I search for remote jobs?'
    })
    .expect(200);

  const lastStreamCall = providerCalls[providerCalls.length - 1];
  assert.equal(lastStreamCall.toolNames.includes('hirepool_signup'), false);
  assert.equal(
    lastStreamCall.historyTexts.some(t => t.includes('Who is the Prime Minister')),
    false,
    'Filtered out-of-scope turn must remain excluded from provider history'
  );
  const streamInfoEvents = parseSseEvents(streamInfoRes.text);
  assert.ok(streamInfoEvents.some(e => e.data?.type === 'done'));

  // Private account access stays fail-closed for unauthenticated guests
  const privateRes = await request(app)
    .post('/api/chat')
    .send({
      assistantId: 'hirepool',
      conversationId,
      message: 'Show my applications',
      stream: false
    })
    .expect(200);
  assert.equal(privateRes.body.action?.action, 'hirepool_login');
});
