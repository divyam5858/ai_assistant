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
  storeHirePoolSession,
  findHirePoolContextBySdkCredential
} from '../backend/src/local-integrations/hirepool-session-store.js';
import { registerHirePoolLocalDevelopmentIntegration } from '../integrations/hirepool/local-development.js';
import {
  classifyHirePoolIntent,
  classifyHirePoolMessage,
  isHirePoolLogoutRequest,
  HIREPOOL_DOMAIN_CATEGORIES,
  HIREPOOL_INTENT_CATEGORIES
} from '../integrations/hirepool/domain-policy.js';
import {
  isHirePoolHowToProfileQuestion,
  isHirePoolProfileEditRequest,
  parseHirePoolMonthDate,
  parseEducationFromMessage,
  parseWorkExperienceFromMessage,
  validateCandidateProfileUpdatePayload,
  mergeCandidateProfileUpdate
} from '../integrations/hirepool/candidate-profile-edit.js';
import {
  isHirePoolAccountRequest,
  isHirePoolVisitorExplorationRequest
} from '../integrations/hirepool/visitor-state.js';
import { formatHirePoolReadResults, formatGeneralReadResults } from '../backend/src/routes/chat.js';
import { AssistantStorage } from '../widget/src/storage.js';
import { AssistantApiClient } from '../widget/src/api-client.js';
import { AssistantWidgetUI } from '../widget/src/widget.js';

// ============================================================================
// Lightweight DOM / Browser & HTTP Mock Harness
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
  replaceChildren(...nodes) {
    this.children = [];
    this._textContent = '';
    for (const node of nodes) {
      if (node) this.appendChild(node);
    }
  }
  insertAdjacentElement(position, element) {
    if (!element || !this.parentNode) return element;
    const idx = this.parentNode.children.indexOf(this);
    if (idx === -1) return this.parentNode.appendChild(element);
    element.parentElement = this.parentNode;
    element.parentNode = this.parentNode;
    const insertIdx = position === 'afterend' ? idx + 1 : idx;
    this.parentNode.children.splice(insertIdx, 0, element);
    return element;
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
  const prevFetch = globalThis.fetch;
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
      globalThis.fetch = prevFetch;
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

const JOB_ID_SCREENING = 'aaaa1111-1111-4111-8111-111111111111';
const JOB_ID_APPLIED = 'bbbb2222-2222-4222-8222-222222222222';
const JOB_ID_ELIGIBLE = 'cccc3333-3333-4333-8333-333333333333';

let activeHttpRestore = null;

async function startMockHirePoolBackend(options = {}) {
  const rawOpenapiFixture = await readFile(
    new URL('./fixtures/hirepool-openapi.json', import.meta.url),
    'utf8'
  );
  const openapiFixture = JSON.stringify(JSON.parse(rawOpenapiFixture));
  const state = {
    profile: structuredClone(options.initialProfile || {
      first_name: 'Priya',
      last_name: 'Nair',
      phone: '9876543210',
      job_title: 'Full Stack Engineer',
      current_location: 'Bengaluru',
      years_of_experience: 4,
      is_open_to_work: true,
      preferred_work_types: ['remote', 'hybrid'],
      preferred_job_types: ['full_time'],
      notice_period_days: 30,
      skills: ['TypeScript', 'React', 'Node.js'],
      professional_summary: '',
      education: [
        {
          institution: 'IIIT Bangalore',
          degree: 'B.Tech',
          field_of_study: 'Computer Science',
          start_date: '2018-07',
          end_date: '2022-05',
          grade: '8.7 CGPA'
        }
      ],
      work_experience: [
        {
          title: 'Software Engineer',
          company: 'TechNova',
          location: 'Bengaluru',
          start_date: '2022-06',
          is_current: true,
          end_date: null
        }
      ],
      profile_completion_percentage: 78
    }),
    profileGets: 0,
    profilePuts: [],
    logoutCalls: [],
    applications: structuredClone(options.initialApplications || [
      {
        id: 'app-existing-2',
        job_id: JOB_ID_APPLIED,
        job_title: 'Senior Backend Engineer',
        company_name: 'AppliedTech',
        status: 'applied',
        created_at: '2026-10-01T10:00:00Z'
      }
    ]),
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

    if (url.pathname === '/api/v1/auth/logout' && req.method === 'POST') {
      state.logoutCalls.push({
        authorization: req.headers.authorization || req.headers.Authorization || null,
        body
      });
      if (options.onLogout) {
        return options.onLogout(req, res, state, body);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Successfully logged out' }));
      return;
    }

    if (url.pathname === '/api/v1/candidates/profile' && req.method === 'GET') {
      state.profileGets += 1;
      if (options.onProfileGet) {
        return options.onProfileGet(req, res, state);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state.profile));
      return;
    }

    if (url.pathname === '/api/v1/candidates/profile' && req.method === 'PUT') {
      state.profilePuts.push(structuredClone(body));
      if (options.onProfilePut) {
        return options.onProfilePut(req, res, state, body);
      }
      state.profile = {
        ...state.profile,
        ...body
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state.profile));
      return;
    }

    if (url.pathname === '/api/v1/matching/jobs' && req.method === 'GET') {
      const items = options.matchingJobs || [
        {
          id: JOB_ID_SCREENING,
          title: 'ML Platform Engineer',
          company_name: 'DeepCore AI',
          locations: ['Bengaluru'],
          remote_type: 'hybrid',
          job_type: 'full_time',
          matching_score: 91,
          required_skills: ['Python', 'PyTorch', 'Kubernetes'],
          has_screening: false
        },
        {
          id: JOB_ID_APPLIED,
          title: 'Senior Backend Engineer',
          company_name: 'AppliedTech',
          locations: ['Remote'],
          remote_type: 'remote',
          job_type: 'full_time',
          matching_score: 87,
          required_skills: ['Node.js', 'PostgreSQL'],
          has_screening: false
        },
        {
          id: JOB_ID_ELIGIBLE,
          title: 'Full Stack Developer',
          company_name: 'Orbit Systems',
          locations: ['Remote'],
          remote_type: 'remote',
          job_type: 'full_time',
          matching_score: 84,
          required_skills: ['TypeScript', 'React'],
          has_screening: false
        }
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(items));
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

    if (url.pathname.startsWith('/api/v1/jobs/') && url.pathname.endsWith('/screening-questions/for-candidate')) {
      const parts = url.pathname.split('/');
      const jobId = parts[parts.length - 3];
      const questions = jobId === JOB_ID_SCREENING
        ? [{ id: 'q-1', question_text: 'Describe your Kubernetes production experience.' }]
        : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ questions }));
      return;
    }

    if (url.pathname.startsWith('/api/v1/applications/screening-eligibility/')) {
      const jobId = url.pathname.split('/').pop();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(
        jobId === JOB_ID_SCREENING
          ? { eligible: false, screening_required: true, screening_completed: false }
          : { eligible: true, screening_required: false }
      ));
      return;
    }

    if (url.pathname.startsWith('/api/v1/jobs/') && req.method === 'GET') {
      const jobId = url.pathname.split('/').pop();
      const jobsMap = {
        [JOB_ID_SCREENING]: {
          id: JOB_ID_SCREENING,
          title: 'ML Platform Engineer',
          company_name: 'DeepCore AI',
          status: 'active',
          has_screening: true,
          locations: ['Bengaluru'],
          remote_type: 'hybrid',
          job_type: 'full_time',
          required_skills: ['Python', 'PyTorch', 'Kubernetes']
        },
        [JOB_ID_APPLIED]: {
          id: JOB_ID_APPLIED,
          title: 'Senior Backend Engineer',
          company_name: 'AppliedTech',
          status: 'active',
          has_screening: false,
          locations: ['Remote'],
          remote_type: 'remote',
          job_type: 'full_time',
          required_skills: ['Node.js', 'PostgreSQL']
        },
        [JOB_ID_ELIGIBLE]: {
          id: JOB_ID_ELIGIBLE,
          title: 'Full Stack Developer',
          company_name: 'Orbit Systems',
          status: 'active',
          has_screening: false,
          locations: ['Remote'],
          remote_type: 'remote',
          job_type: 'full_time',
          required_skills: ['TypeScript', 'React']
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
        id: `app-${state.submissions.length + 10}`,
        job_id: body.job_id,
        status: 'applied',
        job_title: 'Full Stack Developer',
        company_name: 'Orbit Systems',
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
    let parsedOptions = urlOrOptions;
    let cb = maybeOptions;
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
      const parsed = new URL(String(urlOrOptions));
      parsedOptions = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || '80',
        path: `${parsed.pathname}${parsed.search}`,
        ...(typeof maybeOptions === 'object' && maybeOptions ? maybeOptions : {})
      };
      cb = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
    }

    const host = parsedOptions?.hostname || parsedOptions?.host?.split(':')[0];
    const port = Number(parsedOptions?.port || (parsedOptions?.host?.includes(':') ? parsedOptions.host.split(':')[1] : 80));
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
                method: String(parsedOptions?.method || 'GET').toUpperCase(),
                url: parsedOptions?.path || '/',
                headers: parsedOptions?.headers || {}
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

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : (input?.url || String(input));
    let parsedUrl = null;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {}
    if (parsedUrl && (parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost') && Number(parsedUrl.port || 80) === 8000) {
      let statusCode = 200;
      let responseHeaders = { 'content-type': 'application/json' };
      let payloadStr = '';
      const res = {
        writeHead(code, headers = {}) {
          statusCode = code;
          responseHeaders = Object.fromEntries(
            Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), v])
          );
        },
        end(payload = '') {
          payloadStr = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
        }
      };
      const reqHeaders = {};
      if (init.headers) {
        const entries = init.headers instanceof Headers ? Array.from(init.headers.entries()) : Object.entries(init.headers);
        for (const [k, v] of entries) reqHeaders[String(k).toLowerCase()] = v;
      }
      dispatchRequest(
        {
          method: String(init.method || 'GET').toUpperCase(),
          url: `${parsedUrl.pathname}${parsedUrl.search}`,
          headers: reqHeaders
        },
        res,
        typeof init.body === 'string' ? init.body : ''
      );
      return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        headers: { get: name => responseHeaders[String(name).toLowerCase()] || null },
        json: async () => (payloadStr ? JSON.parse(payloadStr) : {}),
        text: async () => payloadStr
      };
    }
    return originalFetch.call(globalThis, input, init);
  };

  activeHttpRestore = () => {
    if (http.request !== originalHttpRequest) {
      http.request = originalHttpRequest;
    }
    if (globalThis.fetch !== originalFetch) {
      globalThis.fetch = originalFetch;
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
// A. Job Matching & Shortlist Response Cleanup
// ============================================================================

test('Phase 1.2.1 A: matching response formatters omit Application status & Screening and strip internal flags', () => {
  const formatted = formatHirePoolReadResults([
    {
      operationId: 'get_matching_jobs_api_v1_matching_jobs_get',
      data: [
        {
          title: 'ML Platform Engineer',
          company_name: 'DeepCore AI',
          locations: ['Bengaluru'],
          remote_type: 'hybrid',
          job_type: 'full_time',
          overall_score: 0.91,
          required_skills: ['Python', 'PyTorch'],
          existingApplicationStatus: 'none',
          screeningRequired: true
        }
      ],
      notes: ['Internal check complete.']
    }
  ]);

  assert.match(formatted, /ML Platform Engineer/);
  assert.match(formatted, /DeepCore AI/);
  assert.match(formatted, /Location:\*\* Bengaluru/);
  assert.match(formatted, /Work type:\*\* hybrid|Work type:\*\* Hybrid/i);
  assert.match(formatted, /Job type:\*\* full_time|Job type:\*\* Full Time/i);
  assert.match(formatted, /HirePool match:\*\* 91%/);
  assert.match(formatted, /Required skills:\*\* Python, PyTorch/);
  assert.doesNotMatch(formatted, /Application status|Screening:|No existing application|Requires checking/i);

  const searchFormatted = formatGeneralReadResults([
    {
      operationId: 'custom_job_read',
      data: [
        {
          title: 'ML Platform Engineer',
          company_name: 'DeepCore AI',
          has_screening: true,
          screening_required: true,
          application_status: 'not_applied',
          existing_application: false,
          eligibility_status: 'pending'
        }
      ]
    }
  ]);
  assert.match(searchFormatted, /ML Platform Engineer/);
  assert.match(searchFormatted, /DeepCore AI/);
  assert.doesNotMatch(searchFormatted, /has_screening|screening_required|application_status|existing_application|eligibility_status|has screening|screening required|application status|existing application|eligibility status/i);

  const profileFormatted = formatHirePoolReadResults([
    {
      operationId: 'get_my_profile_api_v1_candidates_profile_get',
      data: {
        first_name: 'Priya',
        last_name: 'Nair',
        professional_summary: 'PRIVATE FULL SUMMARY NEVER LEAK',
        education: [{ degree: 'B.Tech', field_of_study: 'Computer Science', institution: 'IIIT Bangalore', start_date: '2018-07', end_date: '2022-05', grade: '8.7 CGPA' }],
        work_experience: [{ title: 'Software Engineer', company: 'TechNova', location: 'Bengaluru', start_date: '2022-06', is_current: true }]
      }
    }
  ]);
  assert.match(profileFormatted, /2018-07\s*[-–]\s*2022-05/);
  assert.match(profileFormatted, /8\.7 CGPA/);
  assert.match(profileFormatted, /2022-06\s*[-–]\s*Present/);
  assert.doesNotMatch(profileFormatted, /PRIVATE FULL SUMMARY NEVER LEAK/);
});

test('Phase 1.2.1 A: JSON & SSE Find matching jobs omit internal screening/status lines while keeping internal screening & duplicate safeguards', async () => {
  const backend = await startMockHirePoolBackend();
  try {
    const sdkSession = storeHirePoolSession('cand-match-clean-token', {
      id: 'cand-match-clean-1',
      email: 'priya@example.test',
      userType: 'candidate'
    });
    setAIProvider({
      name: 'phase1-2-1-matching-provider',
      async chat() {
        throw new Error('Matching & shortlist follow-ups must stay deterministic.');
      }
    });

    const app = createApp();
    // 1. JSON /api/chat
    const jsonRes = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'Find matching jobs', stream: false })
      .expect(200);
    assert.match(jsonRes.body.text, /ML Platform Engineer/);
    assert.match(jsonRes.body.text, /HirePool match:/);
    assert.match(jsonRes.body.text, /Required skills:/);
    assert.doesNotMatch(jsonRes.body.text, /Application status|Screening:|No existing application found|Requires checking job details/i);

    // 2. SSE /api/chat/stream
    const sseRes = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'Find matching jobs', stream: true })
      .expect(200);
    const sseEvents = parseSseEvents(sseRes.text);
    const doneEvent = sseEvents.find(e => e.type === 'done');
    assert.ok(doneEvent);
    assert.match(doneEvent.text, /Orbit Systems/);
    assert.doesNotMatch(doneEvent.text, /Application status|Screening:|No existing application found|Requires checking job details/i);

    const conversationId = jsonRes.body.conversationId;

    // 3. Selecting #1 (ML Platform Engineer with screening questions) MUST still enforce screening prerequisite!
    const pick1 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: '1', stream: false })
      .expect(200);
    assert.equal(pick1.body.action, undefined);
    assert.match(pick1.body.text, /screening/i);

    // 4. Selecting #2 (Orbit Systems eligible) stages confirmation & succeeds, and repeat prevents duplicate!
    const pick2 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'apply 2', stream: false })
      .expect(200);
    assert.ok(pick2.body.action?.confirmationToken);
    assert.equal(pick2.body.action?.parameters?.body?.job_id, JOB_ID_ELIGIBLE);

    await request(app)
      .post('/api/dynamic-api/confirm')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ confirmationToken: pick2.body.action.confirmationToken })
      .expect(200);

    const dupOrbit = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'apply this', stream: false })
      .expect(200);
    assert.equal(dupOrbit.body.action, undefined);
    assert.match(dupOrbit.body.text, /already been submitted/i);
  } finally {
    await backend.close();
  }
});

// ============================================================================
// B. Real Logout Workflow (Intent, Upstream Revocation, Isolation & Widget)
// ============================================================================

test('Phase 1.2.1 B: logout classification separates action phrases from how-to questions', () => {
  for (const phrase of [
    'logout',
    'log out',
    'sign out',
    'I want to log out of HirePool',
    'sign me out',
    'exit my account'
  ]) {
    assert.equal(isHirePoolLogoutRequest(phrase), true, `Expected logout detection for: ${phrase}`);
    const classified = classifyHirePoolMessage(phrase, { isAuthenticated: true });
    assert.equal(classified.category, HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE);
    assert.equal(classified.intent, HIREPOOL_INTENT_CATEGORIES.ACCOUNT_LOGOUT);
  }

  for (const faq of [
    'How do I log out?',
    'How can I sign out of HirePool?',
    'Where is the logout button?'
  ]) {
    assert.equal(isHirePoolLogoutRequest(faq), false, `FAQ must not trigger logout: ${faq}`);
    assert.notEqual(classifyHirePoolIntent(faq), HIREPOOL_INTENT_CATEGORIES.ACCOUNT_LOGOUT);
  }
});

test('Phase 1.2.1 B: authenticated logout calls upstream POST /api/v1/auth/logout, destroys sessions, revokes SDK credential, and blocks stale access', async () => {
  const backend = await startMockHirePoolBackend();
  try {
    const sdkSession = storeHirePoolSession(
      'hp-real-access-123',
      { id: 'cand-logout-1', email: 'priya@example.test', userType: 'candidate' },
      Date.now(),
      Date.now(),
      'hp-real-refresh-456'
    );
    setAIProvider({
      name: 'phase1-2-1-logout-provider',
      async chat() {
        throw new Error('Logout and post-logout private blocks must not call generic LLM.');
      }
    });

    const app = createApp();
    // Create an authenticated conversation with active state first
    const profileRes = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'Find matching jobs', stream: false })
      .expect(200);
    const activeConvoId = profileRes.body.conversationId;
    assert.ok(activeConvoId);

    // Trigger natural-language logout via JSON /api/chat
    const logoutRes = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId: activeConvoId, message: 'I want to log out of HirePool', stream: false })
      .expect(200);
    assert.equal(logoutRes.body.conversationId, null);
    assert.equal(logoutRes.body.logout?.loggedOut, true);
    assert.equal(logoutRes.body.logout?.sdkSessionRevoked, true);
    assert.equal(logoutRes.body.logout?.backendRevoked, true);
    assert.match(logoutRes.body.text, /logged out of HirePool/i);

    // Upstream POST /api/v1/auth/logout received real HirePool Bearer token + refresh_token
    assert.equal(backend.state.logoutCalls.length, 1);
    assert.equal(backend.state.logoutCalls[0].authorization, 'Bearer hp-real-access-123');
    assert.deepEqual(backend.state.logoutCalls[0].body, { refresh_token: 'hp-real-refresh-456' });

    // Server session destroyed and SDK credential revoked
    assert.equal(sessionManager.sessions.has(activeConvoId), false);
    assert.equal(findHirePoolContextBySdkCredential(sdkSession.credential), null);

    // Stale SDK credential is now rejected (401)
    await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'View my profile', stream: false })
      .expect(401);

    // Unauthenticated follow-up using stale conversationId CANNOT access private operations
    for (const privateMsg of ['View my profile', 'My applications', 'Find matching jobs', 'Edit my profile']) {
      const blocked = await request(app)
        .post('/api/chat')
        .send({ assistantId: 'hirepool', conversationId: activeConvoId, message: privateMsg, stream: false })
        .expect(200);
      assert.equal(blocked.body.action?.action, 'hirepool_login', `Expected login gate after logout for: ${privateMsg}`);
    }

    // Re-authenticating with a fresh user works cleanly with zero leaked state
    const freshUser = storeHirePoolSession(
      'hp-new-access-999',
      { id: 'cand-logout-2', email: 'other@example.test', userType: 'candidate' }
    );
    const afterReauth = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${freshUser.credential}`)
      .send({ assistantId: 'hirepool', message: 'What information is missing from my profile?', stream: false })
      .expect(200);
    assert.ok(afterReauth.body.conversationId);
    assert.notEqual(afterReauth.body.conversationId, activeConvoId);
  } finally {
    await backend.close();
  }
});

test('Phase 1.2.1 B: upstream logout HTTP 500 reports backend revocation failure honestly and never claims full backend signout while still revoking SDK session', async () => {
  const backend = await startMockHirePoolBackend({
    onLogout(req, res) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Auth revocation service down' }));
    }
  });
  try {
    const sdkSession = storeHirePoolSession(
      'hp-fail-logout-token',
      { id: 'cand-fail-logout', email: 'priya@example.test', userType: 'candidate' },
      Date.now(),
      Date.now(),
      'hp-fail-refresh'
    );
    const app = createApp();

    const sseLogout = await request(app)
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'sign me out', stream: true })
      .expect(200);
    const done = parseSseEvents(sseLogout.text).find(e => e.type === 'done');
    assert.ok(done);
    assert.equal(done.conversationId, null);
    assert.equal(done.logout?.loggedOut, true);
    assert.equal(done.logout?.sdkSessionRevoked, true);
    assert.equal(done.logout?.backendRevoked, false);
    assert.match(done.text, /could not confirm upstream/i);
    assert.doesNotMatch(done.text, /successfully logged out of HirePool on all servers/i);

    assert.equal(findHirePoolContextBySdkCredential(sdkSession.credential), null);

    // Direct /api/hirepool/session/logout also returns honest failure flags
    const sdkSession2 = storeHirePoolSession(
      'hp-fail-logout-token-2',
      { id: 'cand-fail-logout-2', email: 'p2@example.test', userType: 'candidate' }
    );
    const directRes = await request(app)
      .post('/api/hirepool/session/logout')
      .set('Origin', 'http://localhost:3001')
      .set('Authorization', `Bearer ${sdkSession2.credential}`)
      .send({})
      .expect(200);
    assert.equal(directRes.body.loggedOut, true);
    assert.equal(directRes.body.sdkSessionRevoked, true);
    assert.equal(directRes.body.backendRevoked, false);
  } finally {
    await backend.close();
  }
});

test('Phase 1.2.1 B: widget & SDK logout clears credentials, SDK storage, integration hooks, conversationId, messages, restores guest UI, and preserves unrelated storage', async () => {
  const browser = installBrowserGlobals();
  try {
    browser.sessionStorage.setItem('unrelated_app_key', 'keep-session');
    browser.localStorage.setItem('unrelated_local_key', 'keep-local');

    let hostLogoutHookCalls = 0;
    const integration = {
      async getContext() { return null; },
      async getAuthHeaders() { return { Authorization: 'Bearer stale-sdk-token' }; },
      async getSessionScope() { return 'cand-widget-1'; },
      async getIdentity() { return { id: 'cand-widget-1', userType: 'candidate' }; },
      async onLogout() { hostLogoutHookCalls += 1; }
    };

    const storage = new AssistantStorage('hirepool');
    storage.setUser('cand-widget-1');
    const apiClient = new AssistantApiClient('http://localhost:3000', {
      assistantId: 'hirepool',
      getAuthHeaders: () => integration.getAuthHeaders()
    });
    apiClient.setAuthenticatedSession({
      credential: 'stale-sdk-token',
      sessionScope: 'cand-widget-1',
      identity: { id: 'cand-widget-1', userType: 'candidate' },
      role: 'candidate'
    });

    const events = {
      handlers: {},
      on(ev, cb) {
        this.handlers[ev] = this.handlers[ev] || [];
        this.handlers[ev].push(cb);
        return () => {};
      },
      emit(ev, payload) {
        for (const cb of this.handlers[ev] || []) cb(payload);
      }
    };

    const container = new FakeElement('div');
    const guestGreeting = 'Welcome to HirePool! Sign in or create an account to begin.';
    const guestPrompts = ['What is HirePool?', 'Sign in to HirePool'];
    const widget = new AssistantWidgetUI({
      assistantId: 'hirepool',
      applicationId: 'hirepool-local-app',
      greeting: guestGreeting,
      suggestedPrompts: guestPrompts,
      integration,
      context: { application: { id: 'hirepool-local-app' }, authentication: { identity: { id: 'cand-widget-1' } } },
      hasActionHandler: () => true
    }, apiClient, storage, events);
    widget.container = container;
    widget.panel = new FakeElement('div');
    const welcomeBox = new FakeElement('div');
    welcomeBox.className = 'ai-welcome-box';
    const greetingEl = new FakeElement('div');
    greetingEl.className = 'ai-welcome-greeting';
    greetingEl.textContent = 'Signed-in greeting';
    welcomeBox.appendChild(greetingEl);
    widget.panel.appendChild(welcomeBox);
    widget.body = new FakeElement('div');
    widget.body.scrollHeight = 100;
    widget.body.scrollTop = 0;
    widget.messagesContainer = widget.body;
    widget.messagesList = new FakeElement('div');
    widget.body.appendChild(widget.messagesList);
    widget.streamingIndicator = new FakeElement('div');
    widget.statusDot = new FakeElement('span');
    widget.statusText = new FakeElement('span');
    widget.textarea = { value: '', focus() {}, style: {} };
    widget.sendBtn = { disabled: false, style: {} };
    widget.stopBtn = { disabled: false, style: {} };
    widget.attachBtn = { disabled: false, title: '', setAttribute() {} };

    widget.setGreeting('Signed-in personalized greeting', ['Find matching jobs']);
    widget.activeConversationId = 'convo-before-logout';
    widget.messages = [
      { role: 'user', content: 'View my profile' },
      { role: 'assistant', content: 'Priya Nair profile details' }
    ];
    widget.setHostIdentity({ id: 'cand-widget-1', userType: 'candidate' }, 'cand-widget-1');
    storage.set('hirepool_session', { credential: 'stale-sdk-token', identity: { id: 'cand-widget-1' } });
    widget._persistState();

    // Mock SSE /api/chat/stream returning logout event on done, and /api/hirepool/session/logout
    let logoutEventsEmitted = 0;
    const sdkFetchCalls = [];
    events.on('auth:logout', () => { logoutEventsEmitted += 1; });
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/api/hirepool/session/logout')) {
        sdkFetchCalls.push({ url: String(url), method: init?.method || 'GET', headers: init?.headers || {}, body: init?.body || null });
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ loggedOut: true, sdkSessionRevoked: true, backendRevoked: true })
        };
      }
      if (String(url).endsWith('/api/chat/stream')) {
        const sse = [
          'data: ' + JSON.stringify({ type: 'start', conversationId: 'convo-before-logout' }),
          'data: ' + JSON.stringify({
            type: 'done',
            conversationId: null,
            text: 'You have been logged out of HirePool.',
            logout: { loggedOut: true, sdkSessionRevoked: true, backendRevoked: true }
          })
        ].join('\n\n') + '\n\n';
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'text/event-stream' },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sse));
              controller.close();
            }
          })
        };
      }
      throw new Error(`Unexpected fetch ${url} ${JSON.stringify(init)}`);
    };

    await widget.sendMessage('log out', { stream: true });
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(hostLogoutHookCalls, 1);
    assert.equal(logoutEventsEmitted, 1);
    assert.equal(apiClient.getAuthenticatedSession(), null);
    assert.deepEqual(await integration.getAuthHeaders(), {});
    assert.equal(await integration.getSessionScope(), 'guest');
    assert.equal(await integration.getIdentity(), null);
    assert.equal(widget.activeConversationId, null);
    assert.equal(widget.hostIdentity, null);
    assert.deepEqual(widget.messages, []);
    assert.equal(storage.get('hirepool_session', null), null);
    assert.equal(storage.getUserScope(), 'guest_');
    assert.equal(storage.getConversationId(), null);
    assert.equal(greetingEl.textContent, guestGreeting);
    assert.equal(widget.options.context.authentication, undefined);
    assert.equal(widget.attachBtn.disabled, true);
    assert.match(widget.messagesList.textContent, /You have been logged out of HirePool/i);
    assert.doesNotMatch(widget.messagesList.textContent, /Priya Nair profile details/);
    assert.equal(browser.sessionStorage.getItem('unrelated_app_key'), 'keep-session');
    assert.equal(browser.localStorage.getItem('unrelated_local_key'), 'keep-local');

    // Verify compiled bundle AssistantSDK _hasActionHandler and sdk.logout() behavior
    const bundleCode = await readFile(new URL('../widget/dist/assistant.js', import.meta.url), 'utf8');
    const sdkContext = {
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
    vm.runInNewContext(bundleCode, sdkContext);
    const sdk = globalThis.window.AssistantSDK;
    assert.ok(sdk, 'Built bundle must expose window.AssistantSDK');
    sdk.initialized = true;
    sdk.config = { assistantId: 'hirepool' };
    sdk.apiClient = new AssistantApiClient('http://localhost:3000', { assistantId: 'hirepool' });
    sdk.apiClient.setAuthenticatedSession({ credential: 'fresh-cred-xyz' });
    sdk.integration = null;
    assert.equal(sdk._hasActionHandler({
      action: 'update_my_profile_api_v1_candidates_profile_put',
      confirmationToken: 'A'.repeat(43)
    }), true);
    sdk.widgetUI = widget;
    const sdkLogoutRes = await sdk.logout();
    assert.equal(sdkLogoutRes.loggedOut, true);
    assert.equal(sdkLogoutRes.backendRevoked, true);
    assert.equal(sdk.apiClient.getAuthenticatedSession(), null);
    assert.ok(sdkFetchCalls.some(c => c.url.endsWith('/api/hirepool/session/logout') && c.method === 'POST'));
    assert.equal(hostLogoutHookCalls, 2);
  } finally {
    browser.cleanup();
  }
});

// ============================================================================
// C. Profile Editing Intent, Multi-Section Queue, UI Validation & Readback
// ============================================================================

test('Phase 1.2.1 C: profile intent separation blocks guest edits, allows public how-to FAQ, enforces candidate role boundary, and keeps View my profile read-only', async () => {
  const backend = await startMockHirePoolBackend();
  try {
    setAIProvider({
      name: 'phase1-2-1-intent-provider',
      async chat({ messages = [], tools = [] } = {}) {
        const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
        if (/how do i complete my profile/i.test(lastUser)) {
          return {
            text: 'You can complete your HirePool profile in My Profile by adding skills, education, work experience, and a professional summary.',
            toolNames: tools.map(t => t.name)
          };
        }
        return { text: 'Generic response', usage: {} };
      }
    });
    const app = createApp();

    // 1. Public how-to question (guest) -> FAQ guidance, not login or interactive edit
    assert.equal(isHirePoolHowToProfileQuestion('How do I complete my profile?'), true);
    assert.equal(isHirePoolProfileEditRequest('How do I complete my profile?'), false);
    assert.equal(isHirePoolAccountRequest('How do I complete my profile?'), false);
    assert.equal(isHirePoolVisitorExplorationRequest('How do I complete my profile?'), true);

    const howToGuest = await request(app)
      .post('/api/chat')
      .send({ assistantId: 'hirepool', message: 'How do I complete my profile?', stream: false })
      .expect(200);
    assert.equal(howToGuest.body.action, undefined);
    assert.match(howToGuest.body.text, /profile|education|skills/i);

    // 2. Guest edit request -> login gate, never edits
    const guestEdit = await request(app)
      .post('/api/chat')
      .send({ assistantId: 'hirepool', message: 'Add my education', stream: false })
      .expect(200);
    assert.equal(guestEdit.body.action?.action, 'hirepool_login');

    // 3. Client (non-candidate) asking candidate-only profile edit -> blocked cleanly
    const clientSession = storeHirePoolSession('client-role-block-token', {
      id: 'client-user-1',
      email: 'client@example.test',
      userType: 'client'
    });
    const clientEdit = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${clientSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'Add Education and Professional Summary', stream: false })
      .expect(200);
    assert.equal(clientEdit.body.action, undefined);
    assert.match(clientEdit.body.text, /Candidate.*profiles|Client/i);

    // 4. Candidate asking "How do I complete my profile?" while logged in -> still FAQ, not edit card
    const candSession = storeHirePoolSession('cand-intent-token', {
      id: 'cand-intent-1',
      email: 'priya@example.test',
      userType: 'candidate'
    });
    const howToAuthed = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${candSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'How do I complete my profile?', stream: false })
      .expect(200);
    assert.equal(howToAuthed.body.action, undefined);
    assert.match(howToAuthed.body.text, /My Profile|Skills|Education/i);
  } finally {
    await backend.close();
  }
});

test('Phase 1.2.1 C: multi-section flow "Add Education and Professional Summary" -> "Add Education" -> partial NL extract -> ask missing institution -> PES University -> confirm + readback -> "Continue" -> "Help me write a professional summary" -> "Use that" -> verified persistence', async () => {
  const backend = await startMockHirePoolBackend();
  try {
    const sdkSession = storeHirePoolSession('cand-multi-edit-token', {
      id: 'cand-multi-edit-1',
      email: 'priya@example.test',
      userType: 'candidate'
    });
    setAIProvider({
      name: 'phase1-2-1-profile-edit-provider',
      async chat() {
        throw new Error('Candidate profile editing & missing-field workflow should run deterministically without hallucination.');
      }
    });

    const app = createApp();

    // Missing fields check against live API
    const missingRes = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', message: 'What information is missing from my profile?', stream: false })
      .expect(200);
    const conversationId = missingRes.body.conversationId;
    assert.match(missingRes.body.text, /Professional Summary/i);
    assert.doesNotMatch(missingRes.body.text, /Skills are missing/i);

    // 1. Multi-section command queues both sections
    const s1 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'Add Education and Professional Summary', stream: false })
      .expect(200);
    assert.match(s1.body.text, /Education/);
    assert.match(s1.body.text, /Professional Summary/);
    assert.equal(s1.body.action, undefined);

    // 2. Select first section
    const s2 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'Add Education', stream: false })
      .expect(200);
    assert.match(s2.body.text, /institution|degree/i);
    assert.equal(s2.body.action, undefined);

    // 3. Partial NL input without institution -> extracts dates & degree/field and asks for institution without inventing!
    const s3 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({
        assistantId: 'hirepool',
        conversationId,
        message: 'Add B.E. in Artificial Intelligence and Machine Learning, December 2022 to June 2026.',
        stream: false
      })
      .expect(200);
    assert.equal(s3.body.action, undefined);
    assert.match(s3.body.text, /B\.E\./);
    assert.match(s3.body.text, /Artificial Intelligence and Machine Learning/);
    assert.match(s3.body.text, /2022-12/);
    assert.match(s3.body.text, /2026-06/);
    assert.match(s3.body.text, /institution/i);
    assert.doesNotMatch(s3.body.text, /Not Provided/i);

    // 4. Supply missing institution "PES University" -> stages MERGED confirmation card preserving existing IIIT Bangalore degree!
    const s4 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'PES University', stream: false })
      .expect(200);
    assert.ok(s4.body.action?.confirmationToken);
    assert.equal(s4.body.action?.parameters?.body?.education?.length, 2);
    assert.equal(s4.body.action?.parameters?.body?.education?.[0]?.institution, 'IIIT Bangalore');
    assert.equal(s4.body.action?.parameters?.body?.education?.[1]?.institution, 'PES University');
    assert.equal(s4.body.action?.parameters?.body?.education?.[1]?.start_date, '2022-12');
    assert.equal(s4.body.action?.parameters?.body?.education?.[1]?.end_date, '2026-06');

    // Cross-user isolation check on confirmation token
    const intruder = storeHirePoolSession('intruder-token', { id: 'cand-other-99', email: 'other@test.com', userType: 'candidate' });
    const intruderRes = await request(app)
      .post('/api/dynamic-api/confirm')
      .set('Authorization', `Bearer ${intruder.credential}`)
      .send({ confirmationToken: s4.body.action.confirmationToken })
      .expect(400);
    assert.match(intruderRes.body.error.message, /does not belong|expired|invalid/i);

    // 5. Candidate confirms -> PUT + readback GET + next queued section message
    const confirmEdu = await request(app)
      .post('/api/dynamic-api/confirm')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ confirmationToken: s4.body.action.confirmationToken })
      .expect(200);
    assert.equal(confirmEdu.body.status, 'success');
    assert.equal(confirmEdu.body.data.verificationStatus, 'verified');
    assert.equal(confirmEdu.body.data.nextSection, 'professional_summary');
    assert.match(confirmEdu.body.message, /Continue/i);
    assert.match(confirmEdu.body.message, /Professional Summary/i);
    assert.equal(backend.state.profilePuts.length, 1);
    assert.equal(backend.state.profile.education.length, 2);

    // 6. Reply "Continue" -> moves cleanly to Professional Summary
    const s6 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'Continue', stream: false })
      .expect(200);
    assert.match(s6.body.text, /Professional Summary/i);
    assert.equal(s6.body.action, undefined);

    // 7. Ask assistant to draft grounded summary -> does NOT auto-save!
    const s7 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'Help me write a professional summary', stream: false })
      .expect(200);
    assert.equal(s7.body.action, undefined);
    assert.match(s7.body.text, /Full Stack Engineer/);
    assert.match(s7.body.text, /Use that/i);
    assert.equal(backend.state.profilePuts.length, 1);

    // 8. Accept draft "Use that" -> stages summary confirmation card -> confirm & verify
    const s8 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'Use that', stream: false })
      .expect(200);
    assert.ok(s8.body.action?.confirmationToken);
    assert.ok(typeof s8.body.action?.parameters?.body?.professional_summary === 'string');

    const confirmSummary = await request(app)
      .post('/api/dynamic-api/confirm')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ confirmationToken: s8.body.action.confirmationToken })
      .expect(200);
    assert.equal(confirmSummary.body.status, 'success');
    assert.equal(confirmSummary.body.data.verificationStatus, 'verified');
    assert.equal(confirmSummary.body.data.nextSection, undefined);
    assert.match(backend.state.profile.professional_summary, /Full Stack Engineer/);
    assert.equal(backend.state.profile.education.length, 2);
  } finally {
    await backend.close();
  }
});

test('Phase 1.2.1 C: UI validation parity (dates, inverted range, phone, URLs, Present work experience), job-discovery pivot, and write/readback failure honesty', async () => {
  // Pure validation unit parity checks matching D:\talenthub-develop
  assert.equal(parseHirePoolMonthDate('December 2022').value, '2022-12');
  assert.equal(parseHirePoolMonthDate('Present', { allowPresent: true }).isPresent, true);
  assert.equal(parseHirePoolMonthDate('InvalidMonth 2022').valid, false);

  const eduParsed = parseEducationFromMessage('B.E. in AI and ML at PES University, Dec 2022 - Jun 2026');
  assert.equal(eduParsed.draft.degree, 'B.E.');
  assert.equal(eduParsed.draft.institution, 'PES University');
  assert.equal(eduParsed.draft.start_date, '2022-12');
  assert.equal(eduParsed.draft.end_date, '2026-06');

  const workParsed = parseWorkExperienceFromMessage('Backend Intern at Razorpay in Bengaluru from May 2024 to Present');
  assert.equal(workParsed.draft.title, 'Backend Intern');
  assert.equal(workParsed.draft.company, 'Razorpay');
  assert.equal(workParsed.draft.location, 'Bengaluru');
  assert.equal(workParsed.draft.start_date, '2024-05');
  assert.equal(workParsed.draft.is_current, true);
  assert.equal(workParsed.draft.end_date, null);

  assert.equal(
    validateCandidateProfileUpdatePayload({
      education: [{ institution: 'PES University', degree: 'B.E.', start_date: '2026-06', end_date: '2022-12' }]
    }).isValid,
    false
  );
  assert.equal(validateCandidateProfileUpdatePayload({ phone: '12345abc' }).isValid, false);
  assert.equal(validateCandidateProfileUpdatePayload({ linkedin_url: 'ftp://linkedin.com/in/me' }).isValid, false);
  assert.equal(validateCandidateProfileUpdatePayload({ github_url: 'not-a-url' }).isValid, false);
  assert.equal(validateCandidateProfileUpdatePayload({ years_of_experience: 90 }).isValid, false);
  assert.equal(validateCandidateProfileUpdatePayload({ notice_period_days: 500 }).isValid, false);

  const mergedRetry = mergeCandidateProfileUpdate(
    {
      education: [{ institution: 'PES University', degree: 'B.E.', field_of_study: 'AI & ML', start_date: '2022-12', end_date: '2026-06' }]
    },
    {
      education: [{ institution: 'PES University', degree: 'B.E.', field_of_study: 'AI & ML', start_date: '2022-12', end_date: '2026-06' }]
    },
    { operation: 'add' }
  );
  assert.equal(mergedRetry.education.length, 1, 'Retrying same education add must deduplicate instead of creating duplicates');

  // End-to-end backend failure honesty (HTTP 500 PUT, mismatch GET, and job pivot mid-edit)
  let putMode = 'normal';
  const backend = await startMockHirePoolBackend({
    onProfilePut(req, res, state, body) {
      if (putMode === 'fail_500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Database temporarily unavailable' }));
        return;
      }
      if (putMode === 'drop_on_persist') {
        // Simulate API returning 200 without persisting education to GET
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state.profile));
        return;
      }
      state.profile = { ...state.profile, ...body };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state.profile));
    }
  });

  try {
    const sdkSession = storeHirePoolSession('cand-val-token', {
      id: 'cand-val-1',
      email: 'priya@example.test',
      userType: 'candidate'
    });
    setAIProvider({
      name: 'phase1-2-1-validation-provider',
      async chat() {
        throw new Error('Validation & job pivot should not call fallback LLM.');
      }
    });
    const app = createApp();

    // 1. Inverted date rejected gracefully in chat without staging write
    const badDate = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({
        assistantId: 'hirepool',
        message: 'Add education B.E. in CS at PES University June 2026 to December 2022',
        stream: false
      })
      .expect(200);
    const conversationId = badDate.body.conversationId;
    assert.equal(badDate.body.action, undefined);
    assert.match(badDate.body.text, /end date|start date|earlier/i);

    // 2. Pivoting mid-edit to "Find matching jobs" yields cleanly out of education collection!
    const pivot = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ assistantId: 'hirepool', conversationId, message: 'Find matching jobs', stream: false })
      .expect(200);
    assert.match(pivot.body.text, /Orbit Systems|DeepCore AI/);

    // 3. Work experience add with Present -> staged cleanly
    const addExp = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({
        assistantId: 'hirepool',
        conversationId,
        message: 'Add work experience: Backend Intern at Razorpay in Bengaluru from May 2024 to Present',
        stream: false
      })
      .expect(200);
    assert.ok(addExp.body.action?.confirmationToken);
    assert.equal(addExp.body.action.parameters.body.work_experience.length, 2);
    assert.equal(addExp.body.action.parameters.body.work_experience[1].is_current, true);
    assert.equal(addExp.body.action.parameters.body.work_experience[1].end_date, null);

    // Backend 500 failure on confirm -> fails honestly without retry duplication
    putMode = 'fail_500';
    const failConfirm = await request(app)
      .post('/api/dynamic-api/confirm')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ confirmationToken: addExp.body.action.confirmationToken })
      .expect(502);
    assert.match(failConfirm.body.error.message, /500|could not confirm/i);
    assert.equal(backend.state.profilePuts.length, 1);

    // Readback mismatch check -> returns status 'unverified' instead of false 'success'
    const addExp2 = await request(app)
      .post('/api/chat')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({
        assistantId: 'hirepool',
        conversationId,
        message: 'Add work experience: Staff Engineer at ScaleIO from Jan 2025 to Present',
        stream: false
      })
      .expect(200);
    putMode = 'drop_on_persist';
    const mismatchConfirm = await request(app)
      .post('/api/dynamic-api/confirm')
      .set('Authorization', `Bearer ${sdkSession.credential}`)
      .send({ confirmationToken: addExp2.body.action.confirmationToken })
      .expect(200);
    assert.equal(mismatchConfirm.body.status, 'unverified');
    assert.equal(mismatchConfirm.body.data.verificationStatus, 'mismatch');
    assert.match(mismatchConfirm.body.message, /could not verify/i);
  } finally {
    await backend.close();
  }
});

test('Phase 1.2.1 D: rebuilt widget bundles include logout workflow methods and match public SDK copy', async () => {
  const distCode = await readFile(new URL('../widget/dist/assistant.js', import.meta.url), 'utf8');
  const publicCode = await readFile(new URL('../public/sdk/assistant.js', import.meta.url), 'utf8');
  assert.equal(distCode, publicCode);
  assert.match(distCode, /logoutHirePoolSession/);
  assert.match(distCode, /_handleHirePoolLogout/);
});
