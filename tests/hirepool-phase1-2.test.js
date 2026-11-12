import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import vm from 'node:vm';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { sessionManager } from '../backend/src/session-manager.js';
import { clearDynamicApiIntegrations } from '../backend/src/dynamic-api/catalog.js';
import {
  storeHirePoolSession
} from '../backend/src/local-integrations/hirepool-session-store.js';
import { registerHirePoolLocalDevelopmentIntegration } from '../integrations/hirepool/local-development.js';
import {
  classifyHirePoolIntent,
  classifyHirePoolMessage,
  HIREPOOL_DOMAIN_CATEGORIES,
  HIREPOOL_INTENT_CATEGORIES,
  HIREPOOL_OUT_OF_SCOPE_RESPONSE
} from '../integrations/hirepool/domain-policy.js';
import {
  isHirePoolLoginRequest,
  isHirePoolAccountRequest,
  isHirePoolVisitorExplorationRequest
} from '../integrations/hirepool/visitor-state.js';
import { AssistantStorage } from '../widget/src/storage.js';
import { AssistantWidgetUI } from '../widget/src/widget.js';

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
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function matchSingleSelector(el, selector) {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  const tagMatch = trimmed.match(/^([a-zA-Z0-9-]+)/);
  if (tagMatch && el.tagName !== tagMatch[1].toLowerCase()) return false;
  for (const [, cls] of trimmed.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
    if (!el.classList.contains(cls)) return false;
  }
  for (const [, attr, expected] of trimmed.matchAll(/\[([a-zA-Z0-9_-]+)\s*=\s*"?([^"\]]+)"?\]/g)) {
    if ((el.attributes[attr] ?? el[attr]) !== expected) return false;
  }
  return true;
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName || 'div').toLowerCase();
    this.children = [];
    this.attributes = {};
    this.style = { setProperty() {} };
    this.listeners = {};
    this.parentElement = null;
    this.parentNode = null;
    this.className = '';
    this.classList = new ClassListShim(this);
    this._textContent = '';
    this._innerHTML = '';
    this._value = '';
    this.disabled = false;
    this.checked = false;
    this.dataset = {};
    this.shadowRoot = null;
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
  attachShadow() {
    this.shadowRoot = new FakeElement('shadow-root');
    return this.shadowRoot;
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
    if (name === 'id') this.id = String(val);
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
    const evt = { preventDefault() {}, stopPropagation() {}, target: this, ...eventObj };
    for (const cb of this.listeners[eventName] || []) {
      await cb(evt);
    }
  }
  click() {
    return this.trigger('click');
  }
  querySelectorAll(selector) {
    const results = [];
    const parts = selector.split(',');
    const walk = (node) => {
      for (const child of node.children) {
        if (parts.some(p => matchSingleSelector(child, p))) {
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
}

function buildDomTree(root, html) {
  const stack = [root];
  const tokenRegex = /<(\/?)([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tokenRegex.exec(html)) !== null) {
    const current = stack[stack.length - 1] || root;
    if (match[4] !== undefined) {
      if (match[4].trim()) {
        current._textContent = `${current._textContent || ''}${match[4]}`;
      }
      continue;
    }
    const isClose = match[1] === '/';
    const tag = match[2].toLowerCase();
    const rawAttr = match[3] || '';
    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].tagName === tag) stack.pop();
      continue;
    }
    const el = new FakeElement(tag);
    const attrs = parseAttributes(rawAttr);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (attrs.value !== undefined) el.value = attrs.value;
    current.appendChild(el);
    if (!VOID_TAGS.has(tag) && !rawAttr.trim().endsWith('/')) stack.push(el);
  }
}

function installBrowserGlobals() {
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const body = new FakeElement('body');

  globalThis.window = {
    location: { origin: 'http://localhost:3000', href: 'http://localhost:3000/' },
    localStorage,
    sessionStorage,
    addEventListener() {},
    removeEventListener() {},
    open() {
      return { closed: false };
    }
  };
  globalThis.document = {
    body,
    createElement: tag => new FakeElement(tag),
    getElementById: id => body.children.find(c => c.id === id) || null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };

  return {
    localStorage,
    sessionStorage,
    cleanup() {
      globalThis.window = prevWindow;
      globalThis.document = prevDocument;
    }
  };
}

function parseSseEvents(rawText) {
  const events = [];
  for (const block of String(rawText || '').split(/\r?\n\r?\n/)) {
    const dataLine = block.split(/\r?\n/).find(line => line.startsWith('data: '));
    if (dataLine) {
      events.push(JSON.parse(dataLine.slice(6)));
    }
  }
  return events;
}

const JOB_ID_1 = '11111111-1111-4111-8111-111111111111';
const JOB_ID_2 = '22222222-2222-4222-8222-222222222222';
const JOB_ID_UNIQUE = '33333333-3333-4333-8333-333333333333';

let activeHttpRestore = null;

async function startMockHirePoolBackend(handlers = {}) {
  const rawOpenapiFixture = await readFile(
    new URL('./fixtures/hirepool-openapi.json', import.meta.url),
    'utf8'
  );
  // Real FastAPI serves compact JSON (~612 KB); minify the pretty-printed fixture so it matches production size limits.
  const openapiFixture = JSON.stringify(JSON.parse(rawOpenapiFixture));
  const state = {
    profileCalls: 0,
    applications: [],
    submissions: []
  };

  const dispatchRequest = (req, res, bodyStr) => {
    const url = new URL(req.url, 'http://localhost:8000');
    const body = bodyStr ? JSON.parse(bodyStr) : null;

    if (url.pathname === '/api/openapi.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(openapiFixture);
      return;
    }

    if (url.pathname === '/api/v1/candidates/profile' && req.method === 'GET') {
      state.profileCalls += 1;
      if (handlers.onProfileGet) {
        return handlers.onProfileGet(req, res, state);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        first_name: 'Priya',
        last_name: 'Nair',
        job_title: 'Full Stack Engineer',
        current_location: 'Bengaluru',
        years_of_experience: 4,
        is_open_to_work: true,
        preferred_work_types: ['remote', 'hybrid'],
        preferred_job_types: ['full_time'],
        notice_period_days: 30,
        expected_salary_min: 1800000,
        expected_salary_max: 2400000,
        salary_currency: 'INR',
        skills: ['TypeScript', 'React', 'Node.js'],
        education: [{ degree: 'B.Tech', field_of_study: 'Computer Science', institution: 'IIIT' }],
        work_experience: [{ title: 'Software Engineer', company: 'TechNova' }],
        profile_completion_percentage: 90
      }));
      return;
    }

    if (url.pathname === '/api/v1/applications/my-applications' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        items: state.applications,
        total: state.applications.length,
        page: 1,
        page_size: 100,
        total_pages: state.applications.length > 0 ? 1 : 0
      }));
      return;
    }

    if (url.pathname === '/api/v1/jobs/search' && req.method === 'GET') {
      const list = handlers.searchJobs
        ? handlers.searchJobs(url, state)
        : [
          {
            id: JOB_ID_1,
            title: 'Software Engineer',
            company_name: 'Acme Labs',
            locations: ['Remote'],
            remote_type: 'remote',
            job_type: 'full_time',
            status: 'active',
            has_screening: false
          },
          {
            id: JOB_ID_2,
            title: 'Software Engineer',
            company_name: 'Beta Corp',
            locations: ['Bengaluru'],
            remote_type: 'hybrid',
            job_type: 'full_time',
            status: 'active',
            has_screening: false
          }
        ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: list, total: list.length }));
      return;
    }

    if (url.pathname.startsWith('/api/v1/jobs/') && url.pathname.endsWith('/screening-questions/for-candidate')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ questions: [] }));
      return;
    }

    if (url.pathname.startsWith('/api/v1/applications/screening-eligibility/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ eligible: true }));
      return;
    }

    if (url.pathname.startsWith('/api/v1/jobs/') && req.method === 'GET') {
      const jobId = url.pathname.split('/').pop();
      const jobsMap = handlers.jobsById || {
        [JOB_ID_1]: {
          id: JOB_ID_1,
          title: 'Software Engineer',
          company_name: 'Acme Labs',
          status: 'active',
          has_screening: false,
          locations: ['Remote'],
          job_type: 'full_time'
        },
        [JOB_ID_2]: {
          id: JOB_ID_2,
          title: 'Software Engineer',
          company_name: 'Beta Corp',
          status: 'active',
          has_screening: false,
          locations: ['Bengaluru'],
          job_type: 'full_time'
        },
        [JOB_ID_UNIQUE]: {
          id: JOB_ID_UNIQUE,
          title: 'Platform Engineer',
          company_name: 'CloudScale',
          status: 'active',
          has_screening: false,
          locations: ['Remote'],
          job_type: 'full_time'
        }
      };
      const job = jobsMap[jobId];
      if (!job) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(job));
      return;
    }

    if (url.pathname === '/api/v1/applications' && req.method === 'POST') {
      state.submissions.push(body);
      const created = {
        id: `app-${state.submissions.length}`,
        job_id: body.job_id,
        status: 'applied',
        job_title: 'Software Engineer',
        company_name: body.job_id === JOB_ID_2 ? 'Beta Corp' : 'Acme Labs',
        created_at: new Date().toISOString()
      };
      state.applications.push(created);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(created));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: `Unhandled ${req.method} ${url.pathname}` }));
  };

  const originalHttpRequest = http.request;
  http.request = function interceptedHttpRequest(urlOrOptions, maybeOptions, maybeCallback) {
    let options = urlOrOptions;
    let cb = maybeOptions;
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
      const parsed = new URL(String(urlOrOptions));
      options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || '80',
        path: `${parsed.pathname}${parsed.search}`,
        ...(typeof maybeOptions === 'object' && maybeOptions ? maybeOptions : {})
      };
      cb = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
    }

    const host = options?.hostname || options?.host?.split(':')[0];
    const port = Number(options?.port || (options?.host?.includes(':') ? options.host.split(':')[1] : 80));
    if ((host === '127.0.0.1' || host === 'localhost') && port === 8000) {
      const req = new EventEmitter();
      const chunks = [];
      req.write = chunk => {
        if (chunk !== undefined && chunk !== null) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        return true;
      };
      req.setTimeout = () => req;
      req.destroy = () => req;
      req.abort = () => req;
      req.end = chunk => {
        if (chunk !== undefined && chunk !== null) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        queueMicrotask(() => {
          let statusCode = 200;
          let responseHeaders = { 'content-type': 'application/json' };
          const res = {
            writeHead(code, headers = {}) {
              statusCode = code;
              responseHeaders = Object.fromEntries(
                Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v])
              );
            },
            end(payload = '') {
              const incoming = new EventEmitter();
              incoming.statusCode = statusCode;
              incoming.headers = responseHeaders;
              incoming.destroy = () => incoming;
              incoming.resume = () => incoming;
              incoming.pause = () => incoming;
              cb?.(incoming);
              const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
              if (buf.length > 0) {
                incoming.emit('data', buf);
              }
              incoming.emit('end');
            }
          };
          try {
            dispatchRequest(
              {
                method: String(options?.method || 'GET').toUpperCase(),
                url: options?.path || '/',
                headers: options?.headers || {}
              },
              res,
              bodyStr
            );
          } catch (err) {
            req.emit('error', err);
          }
        });
        return req;
      };
      return req;
    }

    return originalHttpRequest.call(this, urlOrOptions, maybeOptions, maybeCallback);
  };

  activeHttpRestore = () => {
    if (http.request !== originalHttpRequest) {
      http.request = originalHttpRequest;
    }
    activeHttpRestore = null;
  };

  try {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL_ENV;
    process.env.AUTH_MODE = 'none';
    process.env.AUTH_REQUIRED = 'false';
    process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
    process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
    process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
    process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
    process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';
    process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = 'http://localhost:3001,http://localhost:5173';
    process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:3001,http://localhost:5173';
    registerHirePoolLocalDevelopmentIntegration();
  } catch (err) {
    activeHttpRestore?.();
    throw err;
  }

  return {
    state,
    close: async () => {
      activeHttpRestore?.();
    }
  };
}

afterEach(() => {
  setAIProvider(null);
  clearDynamicApiIntegrations();
  activeHttpRestore?.();
});

// ============================================================================
// Area 2: Intent Classification, Grounded Knowledge & False-Refusal Recovery
// ============================================================================

test('Phase 1.2 Area 2: classifies freshers, remote, experienced, pricing, privacy, terms, onboarding & out-of-scope', () => {
  const cases = [
    ['What is HirePool?', HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.PLATFORM_INFO],
    ['Do you support freshers?', HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.JOB_DISCOVERY],
    ['Can I search for remote jobs?', HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.JOB_DISCOVERY],
    ['Do you have jobs for experienced professionals?', HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.JOB_DISCOVERY],
    ['Explain pricing in HirePool.', HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.PRICING_SUBSCRIPTIONS],
    ['What is the free trial for employers?', HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.PRICING_SUBSCRIPTIONS],
    ["What's the privacy policy of HirePool?", HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.PRIVACY_LEGAL],
    ['What\u2019s the privacy policy?', HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.PRIVACY_LEGAL],
    ['Terms of Service.', HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.PRIVACY_LEGAL],
    ["I don't have an account yet. Can you help?", HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE, HIREPOOL_INTENT_CATEGORIES.CANDIDATE_ONBOARDING],
    ['Who is the Prime Minister?', HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE, HIREPOOL_INTENT_CATEGORIES.OUT_OF_SCOPE],
    ["What's the national animal of India?", HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE, HIREPOOL_INTENT_CATEGORIES.OUT_OF_SCOPE]
  ];

  for (const [msg, expectedCategory, expectedIntent] of cases) {
    const res = classifyHirePoolIntent(msg);
    assert.equal(res.category, expectedCategory, `Category mismatch for "${msg}"`);
    assert.equal(res.intent, expectedIntent, `Intent mismatch for "${msg}"`);
  }

  for (const noAccountMsg of [
    "I don't have an account yet. Can you help?",
    'I\u2019m new here and don\u2019t have an account yet.'
  ]) {
    assert.equal(isHirePoolLoginRequest(noAccountMsg), false, `Must not treat "${noAccountMsg}" as login request`);
    assert.equal(isHirePoolAccountRequest(noAccountMsg), false, `Must not treat "${noAccountMsg}" as private account op`);
  }
  assert.equal(isHirePoolVisitorExplorationRequest("I'm new to HirePool"), true);
  assert.equal(isHirePoolVisitorExplorationRequest('Explain pricing in HirePool.'), true);
  assert.equal(isHirePoolVisitorExplorationRequest('I\u2019m new here and don\u2019t have an account yet.'), true);
});

test('Phase 1.2 Area 2 & 5: recovers grounded FAQ answers and suppresses repetitive signup cards across guest chat & SSE', async () => {
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';

  const capturedInputs = [];
  setAIProvider({
    name: 'phase1-2-guest-test-provider',
    async chat(input) {
      capturedInputs.push(input);
      // Simulate an LLM mistakenly refusing public HirePool topics or emitting a rogue signup card
      const last = [...input.messages].reverse().find(m => m.role === 'user')?.content || '';
      if (/new to hirepool/i.test(last)) {
        return {
          text: 'Welcome to HirePool! I can explain roles, matching, or jobs anytime.\n```action\n{"action":"hirepool_signup","title":"Sign up"}\n```',
          model: 'mock'
        };
      }
      return { text: HIREPOOL_OUT_OF_SCOPE_RESPONSE, model: 'mock' };
    },
    async chatStream(input) {
      capturedInputs.push(input);
      input.onChunk?.(HIREPOOL_OUT_OF_SCOPE_RESPONSE);
      return { text: HIREPOOL_OUT_OF_SCOPE_RESPONSE, toolCalls: [], model: 'mock' };
    }
  });

  const app = createApp();
  const expectations = [
    ['Do you support freshers?', /freshers|entry[\s-]*level|0\+ years/i],
    ['Can I search for remote jobs?', /remote|hybrid|onsite/i],
    ['Do you have jobs for experienced professionals?', /experienced professionals|mid.*senior.*lead/i],
    ['Explain pricing in HirePool.', /free forever|14-day free trial|https:\/\/hirepool\.ai\/pricing/i],
    ["What's the privacy policy of HirePool?", /https:\/\/hirepool\.ai\/privacy|2 years|encryption/i],
    ['Terms of Service.', /https:\/\/hirepool\.ai\/terms|Singapore|human recruiters/i],
    ["I'm new to HirePool and want to see how it works.", /Welcome to HirePool/i]
  ];

  let conversationId;
  for (const [message, regex] of expectations) {
    const res = await request(app)
      .post('/api/chat')
      .send({ assistantId: 'hirepool', message, conversationId, stream: false })
      .expect(200);
    conversationId = res.body.conversationId;
    assert.match(res.body.text, regex, `Expected grounded answer for "${message}", got "${res.body.text}"`);
    assert.equal(res.body.action, undefined, `No signup/login card should be emitted for "${message}"`);
    assert.doesNotMatch(res.body.text, /```action/i);
  }

  // "I don't have an account yet. Can you help?" routes to signup — never hirepool_login
  const noAccountTurn = await request(app)
    .post('/api/chat')
    .send({ assistantId: 'hirepool', message: "I don't have an account yet. Can you help?", conversationId, stream: false })
    .expect(200);
  assert.equal(noAccountTurn.body.action?.action, 'hirepool_signup');
  assert.notEqual(noAccountTurn.body.action?.action, 'hirepool_login');

  // Verify [STRUCTURED ACTION PROPOSALS] was omitted on guest informational turns
  for (const input of capturedInputs) {
    assert.doesNotMatch(input.systemInstruction, /\[STRUCTURED ACTION PROPOSALS\]/);
  }

  // Verify SSE /api/chat/stream recovers grounded FAQ answer too
  const sseRes = await request(app)
    .post('/api/chat/stream')
    .send({ assistantId: 'hirepool', message: 'Explain pricing in HirePool.', stream: true })
    .expect(200);
  const doneEvt = parseSseEvents(sseRes.text).find(e => e.type === 'done');
  assert.ok(doneEvt);
  assert.match(doneEvt.text, /Free forever|14-day free trial/i);
  assert.equal(doneEvt.action, undefined);

  // Explicit signup STILL emits the signup card cleanly with role parameter
  const explicitSignup = await request(app)
    .post('/api/chat')
    .send({ assistantId: 'hirepool', message: 'Sign me up as a candidate', conversationId, stream: false })
    .expect(200);
  assert.equal(explicitSignup.body.action?.action, 'hirepool_signup');
  assert.equal(explicitSignup.body.action?.parameters?.role, 'candidate');
});

// ============================================================================
// Area 1 & 4: "View my profile" Read Execution & Widget Card Guards / State Sync
// ============================================================================

test('Phase 1.2 Area 1 & 4: View my profile executes verified GET read, retries transient 503 once, fails closed without broken cards', async () => {
  let failOnce = true;
  let persistentFail = false;
  const backend = await startMockHirePoolBackend({
    onProfileGet(_req, res, state) {
      if (persistentFail || (failOnce && state.profileCalls === 1)) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Temporary upstream error' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        first_name: 'Priya',
        last_name: 'Nair',
        job_title: 'Full Stack Engineer',
        current_location: 'Bengaluru',
        years_of_experience: 4,
        is_open_to_work: true,
        preferred_work_types: ['remote', 'hybrid'],
        preferred_job_types: ['full_time'],
        notice_period_days: 30,
        skills: ['TypeScript', 'React'],
        profile_completion_percentage: 90
      }));
    }
  });

  try {
    const sdkSession = storeHirePoolSession('candidate-profile-token', {
      id: 'cand-profile-1',
      email: 'priya@example.test',
      userType: 'candidate'
    });

    // Even if LLM were called and emitted a hallucinated ```action view_my_profile``` fence, it must not leak
    setAIProvider({
      name: 'phase1-2-profile-provider',
      async chat() {
        return {
          text: '```action\n{"action":"view_my_profile","title":"View My Profile"}\n```',
          model: 'mock'
        };
      }
    });

    const app = createApp();
    // 1. Transient 503 on first GET retries once and succeeds deterministically
    const viewProfile = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'View my profile', stream: false })
      .expect(200);

    assert.equal(backend.state.profileCalls, 2, 'Transient 503 GET should retry once and succeed');
    assert.equal(viewProfile.body.action, undefined, 'Profile read must never emit an action card');
    assert.match(viewProfile.body.text, /Priya Nair/);
    assert.match(viewProfile.body.text, /TypeScript/);
    assert.match(viewProfile.body.text, /Notice period.*30 days/);
    assert.doesNotMatch(viewProfile.body.text, /Application Action|Operation: Write|no valid server confirmation/i);

    // 2. Streaming "View my profile" emits verified profile cleanly
    const sseProfile = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'View my profile', stream: true })
      .expect(200);
    const doneProfile = parseSseEvents(sseProfile.text).find(e => e.type === 'done');
    assert.match(doneProfile.text, /Priya Nair/);
    assert.equal(doneProfile.action, undefined);

    // 3. LLM hallucinated view_my_profile fence recovery -> maps to real GET & strips raw fence
    const customPhrase = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'Summarize everything currently saved on my candidate record please', stream: false })
      .expect(200);
    assert.match(customPhrase.body.text, /Priya Nair/);
    assert.equal(customPhrase.body.action, undefined);
    assert.doesNotMatch(customPhrase.body.text, /```action/);

    // 4. Persistent failure returns truthful failure without fabrication or broken action card
    persistentFail = true;
    const failedRead = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'View my profile', stream: false })
      .expect(200);
    assert.equal(failedRead.body.action, undefined);
    assert.match(failedRead.body.text, /could not verify|No result or status has been assumed/i);
    assert.doesNotMatch(failedRead.body.text, /Priya Nair/);
  } finally {
    await backend.close();
  }
});

test('Phase 1.2 Area 1: Widget/SDK blocks unconfirmed HirePool cards and persists cancel/error/complete states across reload', async () => {
  const browser = installBrowserGlobals();
  try {
    const bundleCode = await readFile(new URL('../widget/dist/assistant.js', import.meta.url), 'utf8');
    const context = {
      window: globalThis.window,
      document: globalThis.document,
      localStorage: browser.localStorage,
      sessionStorage: browser.sessionStorage,
      console,
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      fetch: globalThis.fetch
    };
    vm.runInNewContext(bundleCode, context);
    const sdk = globalThis.window.AssistantSDK;
    assert.ok(sdk, 'Built bundle must expose window.AssistantSDK');
    sdk.config = { assistantId: 'hirepool', applicationId: 'hirepool-local-app' };
    sdk.integration = { actionExecutor: async () => ({ message: 'Executed' }) };

    // Un-tokenized non-account action must be rejected by _hasActionHandler
    assert.equal(sdk._hasActionHandler({ action: 'view_my_profile', title: 'View My Profile' }), false);
    assert.equal(sdk._hasActionHandler({ action: 'hirepool_signup', title: 'Sign up' }), true);
    const validToken = 'A'.repeat(43);
    assert.equal(
      sdk._hasActionHandler({ action: 'apply_job', title: 'Apply', confirmationToken: validToken }),
      true
    );

    const events = { handlers: {}, on() {}, off() {}, emit(name, payload) { (this.handlers[name] || []).forEach(fn => fn(payload)); } };
    const storage1 = new AssistantStorage('hirepool-phase1-2-widget-cancel');
    const makeWidget = (store = storage1, assistantId = 'hirepool') => {
      const w = new AssistantWidgetUI(
        {
          name: 'HirePool Assistant',
          greeting: 'Welcome to HirePool',
          suggestedPrompts: ['Find matching jobs', 'View my profile', 'My applications'],
          assistantId,
          applicationId: 'hirepool-local-app',
          hasActionHandler: act => {
            const prevAssistantId = sdk.config.assistantId;
            sdk.config = { ...sdk.config, assistantId };
            try {
              return sdk._hasActionHandler(act);
            } finally {
              sdk.config = { ...sdk.config, assistantId: prevAssistantId };
            }
          }
        },
        {},
        store,
        events
      );
      w.shadowRoot = new FakeElement('shadow-root');
      w._buildDOM();
      w._restoreState();
      return w;
    };

    const widget = makeWidget(storage1);
    // _extractAction ignores unvalidated fenced blocks on hirepool
    const hallucinated = 'Here you go:\n```action\n{"action":"view_my_profile","title":"View My Profile"}\n```';
    assert.equal(widget._extractAction(hallucinated), null);
    assert.equal(widget._stripActionBlocks(hallucinated), 'Here you go:');

    // Skips requiresConfirmation: false card on hirepool
    const readBubble = new FakeElement('div');
    widget._renderActionCard(readBubble, {
      action: 'read_something',
      title: 'Read',
      requiresConfirmation: false,
      confirmationToken: validToken
    });
    assert.equal(readBubble.children.length, 0);

    // 1. Cancelled card persists across reload
    const cancelAction = {
      id: 'act-cancel-1',
      action: 'create_application',
      title: 'Submit Application',
      explanation: 'Confirm submission',
      risk: 'write',
      requiresConfirmation: true,
      confirmationToken: validToken
    };
    widget.messages.push({ role: 'assistant', content: 'Review application:', action: cancelAction });
    const cancelBubble = new FakeElement('div');
    widget._renderActionCard(cancelBubble, cancelAction);
    await cancelBubble.querySelector('.ai-btn-action-cancel').click();
    assert.equal(cancelAction._status, 'cancelled');

    const restoredAfterCancel = makeWidget(storage1);
    const cancelledCardStatus = restoredAfterCancel.messagesList.querySelector('.ai-action-status-msg');
    assert.ok(cancelledCardStatus);
    assert.match(cancelledCardStatus.textContent, /Action cancelled/);
    assert.equal(restoredAfterCancel.messagesList.querySelector('.ai-action-controls').style.display, 'none');

    // 2. Terminal error on token-bound write disables controls & persists across reload
    const storage2 = new AssistantStorage('hirepool-phase1-2-widget-error');
    const w2 = makeWidget(storage2);
    const errAction = {
      id: 'act-err-1',
      action: 'create_application',
      title: 'Submit Application',
      explanation: 'Confirm submission',
      risk: 'write',
      requiresConfirmation: true,
      confirmationToken: validToken
    };
    w2.messages.push({ role: 'assistant', content: 'Review:', action: errAction });
    const errBubble = new FakeElement('div');
    w2._renderActionCard(errBubble, errAction);
    let rejectFn;
    events.handlers['action:execute'] = [payload => { rejectFn = payload.reject; }];
    await errBubble.querySelector('.ai-btn-action-confirm').click();
    rejectFn(Object.assign(new Error('Confirmation expired'), { status: 404 }));
    assert.equal(errAction._status, 'error');
    assert.equal(errBubble.querySelector('.ai-action-controls').style.display, 'none');

    const restoredAfterError = makeWidget(storage2);
    assert.equal(restoredAfterError.messagesList.querySelector('.ai-action-controls').style.display, 'none');
    assert.match(restoredAfterError.messagesList.querySelector('.ai-action-status-msg').textContent, /Confirmation expired/);

    // 3. Completed card persists across reload
    const storage3 = new AssistantStorage('hirepool-phase1-2-widget-done');
    const w3 = makeWidget(storage3);
    const doneAction = {
      id: 'act-done-1',
      action: 'create_application',
      title: 'Submit Application',
      explanation: 'Confirm submission',
      risk: 'write',
      requiresConfirmation: true,
      confirmationToken: validToken
    };
    w3.messages.push({ role: 'assistant', content: 'Confirm application:', action: doneAction });
    const doneBubble = new FakeElement('div');
    w3._renderActionCard(doneBubble, doneAction);
    let resolveFn;
    events.handlers['action:execute'] = [payload => { resolveFn = payload.resolve; }];
    await doneBubble.querySelector('.ai-btn-action-confirm').click();
    resolveFn({ message: 'Application submitted successfully.' });
    assert.equal(doneAction._status, 'completed');
    assert.equal(doneBubble.querySelector('.ai-action-controls').style.display, 'none');

    const restoredAfterDone = makeWidget(storage3);
    assert.equal(restoredAfterDone.messagesList.querySelector('.ai-action-controls').style.display, 'none');
    assert.match(restoredAfterDone.messagesList.querySelector('.ai-action-status-msg').textContent, /Application submitted successfully/);

    // 4. Unconfirmed custom_host_action is suppressed on HirePool; transient failure offers Retry on non-HirePool assistant
    const blockedBubble = new FakeElement('div');
    widget._renderActionCard(blockedBubble, {
      id: 'act-blocked-1',
      action: 'custom_host_action',
      title: 'Blocked On HirePool',
      explanation: 'No server token',
      risk: 'write',
      requiresConfirmation: true
    });
    assert.equal(blockedBubble.children.length, 0);

    const storage4 = new AssistantStorage('hirepool-phase1-2-widget-retry');
    const w4 = makeWidget(storage4, 'generic-app');
    const retryAction = {
      id: 'act-retry-1',
      action: 'custom_host_action',
      title: 'Custom Host Task',
      explanation: 'Run task',
      risk: 'write',
      requiresConfirmation: true
    };
    w4.messages.push({ role: 'assistant', content: 'Run task:', action: retryAction });
    const retryBubble = new FakeElement('div');
    w4._renderActionCard(retryBubble, retryAction);
    let retryRejectFn;
    events.handlers['action:execute'] = [payload => { retryRejectFn = payload.reject; }];
    await retryBubble.querySelector('.ai-btn-action-confirm').click();
    retryRejectFn(new Error('Temporary network timeout'));
    assert.equal(retryBubble.querySelector('.ai-btn-action-confirm').textContent, 'Retry');
    assert.equal(retryBubble.querySelector('.ai-btn-action-confirm').disabled, false);
  } finally {
    browser.cleanup();
  }
});

// ============================================================================
// Area 3: Job Selection & Application Workflow Continuity
// ============================================================================

test('Phase 1.2 Area 3: "apply Software Engineer" searches, disambiguates duplicates, confirms #1, prevents duplicate, and switches to #2', async () => {
  const backend = await startMockHirePoolBackend();
  try {
    const sdkSession = storeHirePoolSession('candidate-apply-token', {
      id: 'cand-apply-1',
      email: 'priya@example.test',
      userType: 'candidate'
    });
    setAIProvider({
      name: 'phase1-2-apply-provider',
      async chat() {
        throw new Error('Deterministic apply & follow-up continuity should resolve without arbitrary model guesses');
      }
    });

    const app = createApp();
    // 1. "apply Software Engineer" finds 2 companies and asks disambiguation
    const step1 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'apply Software Engineer', stream: false })
      .expect(200);
    const conversationId = step1.body.conversationId;
    assert.match(step1.body.text, /Acme Labs/);
    assert.match(step1.body.text, /Beta Corp/);
    assert.equal(step1.body.action, undefined);

    // 2. Reply "1" selects Acme Labs cleanly without repeating "apply"
    const step2 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: '1', stream: false })
      .expect(200);
    assert.ok(step2.body.action?.confirmationToken);
    assert.equal(step2.body.action?.parameters?.body?.job_id, JOB_ID_1);

    // 3. Execute real confirmation for Acme Labs
    const confirm1 = await request(app)
      .post('/api/dynamic-api/confirm')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ confirmationToken: step2.body.action.confirmationToken })
      .expect(200);
    assert.ok(confirm1.body.status);
    assert.equal(backend.state.submissions.length, 1);

    // 4. Subsequent "apply this" prevents duplicate and lists alternatives
    const dupCheck = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'apply this', stream: false })
      .expect(200);
    assert.equal(dupCheck.body.action, undefined);
    assert.match(dupCheck.body.text, /already been submitted/i);
    assert.match(dupCheck.body.text, /Beta Corp/);

    // 5. "Apply for the other Software Engineer job" switches cleanly to Beta Corp
    const switchJob = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'Apply for the other Software Engineer job', stream: false })
      .expect(200);
    assert.ok(switchJob.body.action?.confirmationToken);
    assert.equal(switchJob.body.action?.parameters?.body?.job_id, JOB_ID_2);
  } finally {
    await backend.close();
  }
});

test('Phase 1.2 Area 3: single-match "apply Platform Engineer" auto-prepares confirmation without extra round trip', async () => {
  const backend = await startMockHirePoolBackend({
    searchJobs() {
      return [{
        id: JOB_ID_UNIQUE,
        title: 'Platform Engineer',
        company_name: 'CloudScale',
        locations: ['Remote'],
        remote_type: 'remote',
        job_type: 'full_time',
        status: 'active',
        has_screening: false
      }];
    }
  });

  try {
    const sdkSession = storeHirePoolSession('candidate-unique-apply-token', {
      id: 'cand-apply-unique',
      email: 'priya@example.test',
      userType: 'candidate'
    });
    setAIProvider({
      name: 'phase1-2-unique-provider',
      async chat() {
        throw new Error('Should not be reached for unique direct apply');
      }
    });

    const res = await request(createApp())
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'apply Platform Engineer', stream: false })
      .expect(200);
    assert.ok(res.body.action?.confirmationToken);
    assert.equal(res.body.action?.parameters?.body?.job_id, JOB_ID_UNIQUE);
    assert.match(res.body.text, /Platform Engineer/);
    assert.match(res.body.text, /CloudScale/);
  } finally {
    await backend.close();
  }
});
