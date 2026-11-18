import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { sessionManager } from '../backend/src/session-manager.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { storeHirePoolSession } from '../backend/src/local-integrations/hirepool-session-store.js';
import { clearDynamicApiIntegrations } from '../backend/src/dynamic-api/catalog.js';
import { registerHirePoolLocalDevelopmentIntegration } from '../integrations/hirepool/local-development.js';
import {
  classifyHirePoolMessage,
  HIREPOOL_DOMAIN_CATEGORIES,
  HIREPOOL_INTENT_CATEGORIES
} from '../integrations/hirepool/domain-policy.js';
import {
  parseWorkExperienceFromMessage,
  parseEducationFromMessage
} from '../integrations/hirepool/candidate-profile-edit.js';

let activeHttpRestore = null;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function setDeterministicProvider(label = 'visitor-candidate-test') {
  setAIProvider({
    name: label,
    async chat() {
      throw new Error(`Provider should not be invoked for structured deterministic turn (${label}).`);
    }
  });
}

async function startMockHirePoolBackend(options = {}) {
  const rawOpenapiFixture = await readFile(
    new URL('./fixtures/hirepool-openapi.json', import.meta.url),
    'utf8'
  );
  const openapiFixture = JSON.stringify(JSON.parse(rawOpenapiFixture));

  const state = {
    candidateProfile: clone(
      options.candidateProfile || {
        id: 'cand-profile-1',
        user_id: 'cand-user-1',
        first_name: 'Priya',
        last_name: 'Sharma',
        phone: '9876543210',
        current_location: 'Mumbai',
        headline: 'AI Engineer',
        years_of_experience: 2,
        months_of_experience: 0,
        skills: ['Python', 'TensorFlow'],
        work_experience: [],
        education: []
      }
    ),
    matchingJobs: [
      {
        id: 'job-1',
        title: 'Senior AI Engineer',
        company_name: 'NeuralCorp',
        company: 'NeuralCorp',
        location: 'Bengaluru',
        locations: ['Bengaluru'],
        work_type: 'hybrid',
        job_type: 'full_time',
        match_score: 92,
        hirepool_match_percentage: 92,
        required_skills: ['Python', 'PyTorch']
      },
      {
        id: 'job-2',
        title: 'Lead AI Engineer',
        company_name: 'CognitiveLabs',
        company: 'CognitiveLabs',
        location: 'Bengaluru',
        locations: ['Bengaluru'],
        work_type: 'hybrid',
        job_type: 'full_time',
        match_score: 95,
        hirepool_match_percentage: 95,
        required_skills: ['Python', 'PyTorch']
      }
    ],
    applications: [
      {
        id: 'app-1',
        job_id: 'job-1',
        job_title: 'Senior AI Engineer',
        company_name: 'NeuralCorp',
        status: 'applied',
        created_at: '2026-03-01T10:00:00Z'
      }
    ],
    requests: []
  };

  const dispatchRequest = (req, res, bodyText = '') => {
    const url = new URL(req.url, 'http://localhost:8000');
    const body = bodyText ? JSON.parse(bodyText) : {};
    state.requests.push({ method: req.method, path: url.pathname, body });

    if (url.pathname === '/api/openapi.json' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(openapiFixture);
      return;
    }

    if (url.pathname === '/api/v1/candidates/profile') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clone(state.candidateProfile)));
        return;
      }
      if (req.method === 'PUT') {
        state.candidateProfile = { ...state.candidateProfile, ...body };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clone(state.candidateProfile)));
        return;
      }
    }

    if ((url.pathname === '/api/v1/matching/jobs' || url.pathname === '/api/v1/matching-jobs') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state.matchingJobs));
      return;
    }

    if (url.pathname === '/api/v1/applications/my-applications' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        items: state.applications,
        total: state.applications.length,
        page: 1,
        page_size: 10,
        total_pages: 1,
        fetched_pages: 1,
        complete: true
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not found' }));
  };

  const originalHttpRequest = http.request;
  http.request = function (urlOrOptions, maybeOptions, maybeCallback) {
    const parsedOptions =
      typeof urlOrOptions === 'string'
        ? new URL(urlOrOptions)
        : (urlOrOptions?.href ? new URL(urlOrOptions.href) : { ...urlOrOptions, ...maybeOptions });
    const cb = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
    const hostname = parsedOptions?.hostname || parsedOptions?.host;
    const port = Number(parsedOptions?.port || 80);

    if ((hostname === '127.0.0.1' || hostname === 'localhost') && port === 8000) {
      const chunks = [];
      const req = new EventEmitter();
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
              if (buf.length > 0) incoming.emit('data', buf);
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
        end(chunk = '') {
          payloadStr = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        }
      };
      dispatchRequest(
        {
          method: String(init.method || 'GET').toUpperCase(),
          url: parsedUrl.pathname + parsedUrl.search,
          headers: init.headers || {}
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
    if (http.request !== originalHttpRequest) http.request = originalHttpRequest;
    if (globalThis.fetch !== originalFetch) globalThis.fetch = originalFetch;
    activeHttpRestore = null;
  };

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

  return {
    state,
    close: async () => {
      activeHttpRestore?.();
    }
  };
}

function createCandidateSession({ token = 'tok-cand-intent-1', id = 'cand-user-1', email = 'priya@test.dev' }) {
  return storeHirePoolSession(token, {
    id,
    email,
    userType: 'candidate',
    organizationRole: null
  });
}

async function sendChat(app, credential, message, conversationId = undefined) {
  const payload = { assistantId: 'hirepool', message, stream: false };
  if (conversationId) payload.conversationId = conversationId;
  const req = request(app).post('/api/chat');
  if (credential) {
    req.set('Authorization', `Bearer ${credential}`);
  }
  const res = await req.send(payload).expect(200);
  return res.body;
}

afterEach(() => {
  setAIProvider(null);
  clearDynamicApiIntegrations();
  activeHttpRestore?.();
});

// ============================================================================
// 1. Workflow Interruption, Suspension & Resumption
// ============================================================================

test('Workflow 1: Asking "My offers?" while in active profile edit suspends workflow and returns portal notice without asking for company/title', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('offers-interruption');
  const app = createApp();
  const session = createCandidateSession({});

  // Step 1: Start profile edit for work experience
  const turn1 = await sendChat(app, session.credential, 'Add work experience');
  assert.equal(turn1.action, undefined);
  assert.match(turn1.text, /work\s*experience/i);

  // Verify profile edit workflow is active
  const sdkSession = sessionManager.sessions.get(turn1.conversationId);
  assert.equal(sdkSession.hirePoolProfileEdit?.active, true);
  assert.equal(sdkSession.hirePoolProfileEdit?.selectedSection, 'work_experience');

  // Step 2: User asks "My offers?"
  const turn2 = await sendChat(app, session.credential, 'My offers?', turn1.conversationId);
  // Must NOT ask for company name or job title!
  assert.doesNotMatch(turn2.text, /company\s+name|job\s+title\s+\/\s+role/i);
  // Must explain that offers are viewed in candidate portal
  assert.match(turn2.text, /offers.*portal|candidate\s+portal/i);
  // Must note that profile edit is paused
  assert.match(turn2.text, /paused|resume/i);

  // Verify workflow state was suspended without being destroyed
  assert.equal(sdkSession.hirePoolProfileEdit?.active, false);
  assert.equal(sdkSession.hirePoolProfileEdit?.suspended, true);
  assert.equal(sdkSession.hirePoolProfileEdit?.selectedSection, 'work_experience');
});

test('Workflow 2: Typo variant "MY OFFRES" suspends active profile edit cleanly', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('offers-typo-interruption');
  const app = createApp();
  const session = createCandidateSession({});

  const turn1 = await sendChat(app, session.credential, 'Add work experience');
  const turn2 = await sendChat(app, session.credential, 'MY OFFRES', turn1.conversationId);

  assert.doesNotMatch(turn2.text, /company\s+name/i);
  assert.match(turn2.text, /candidate\s+portal|offers/i);

  const sdkSession = sessionManager.sessions.get(turn1.conversationId);
  assert.equal(sdkSession.hirePoolProfileEdit?.active, false);
  assert.equal(sdkSession.hirePoolProfileEdit?.suspended, true);
});

test('Workflow 3: "Resume profile edit" reactivates suspended workflow and shows captured draft', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('resume-workflow');
  const app = createApp();
  const session = createCandidateSession({});

  // Start work experience edit
  const turn1 = await sendChat(app, session.credential, 'Add work experience');

  // Suspend with offers query
  const turn2 = await sendChat(app, session.credential, 'My offers?', turn1.conversationId);

  // Resume workflow
  const turn3 = await sendChat(app, session.credential, 'Resume profile edit', turn1.conversationId);
  assert.match(turn3.text, /resuming.*work\s*experience/i);

  const sdkSession = sessionManager.sessions.get(turn1.conversationId);
  assert.equal(sdkSession.hirePoolProfileEdit?.active, true);
  assert.equal(sdkSession.hirePoolProfileEdit?.suspended, false);
});

test('Workflow 4: "Cancel" completely cancels profile edit workflow and discards draft', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('cancel-workflow');
  const app = createApp();
  const session = createCandidateSession({});

  const turn1 = await sendChat(app, session.credential, 'Add work experience');
  const turn2 = await sendChat(app, session.credential, 'cancel profile edit', turn1.conversationId);

  assert.match(turn2.text, /cancelled/i);
  const sdkSession = sessionManager.sessions.get(turn1.conversationId);
  assert.equal(sdkSession.hirePoolProfileEdit?.active, false);
  assert.equal(sdkSession.hirePoolProfileEdit?.suspended, false);
  assert.equal(sdkSession.hirePoolProfileEdit?.stage, 'cancelled');
});

// ============================================================================
// 2. Work Experience Multi-Line Hyphen Extraction Bug
// ============================================================================

test('Work Experience Extraction: Hyphen-formatted block extracts all fields without setting current_location', () => {
  const block = `Company - HCL
Job Title - AI ENGINEER
Location - BENGALURU
DECEMBER 2025 - JANUARY 2026`;

  const { draft, errors } = parseWorkExperienceFromMessage(block, {});
  assert.equal(errors.length, 0);
  assert.equal(draft.company, 'HCL');
  assert.equal(draft.title, 'AI ENGINEER');
  assert.equal(draft.location, 'BENGALURU');
  assert.equal(draft.start_date, '2025-12');
  assert.equal(draft.end_date, '2026-01');
  assert.equal(draft.is_current, false);
});

test('Work Experience Turn: Multi-line hyphen input prepares confirmation without overwriting candidate current_location', async () => {
  const backend = await startMockHirePoolBackend({
    candidateProfile: {
      id: 'c-loc-1',
      first_name: 'Priya',
      last_name: 'Sharma',
      current_location: 'Mumbai',
      work_experience: []
    }
  });
  setDeterministicProvider('work-exp-hyphen-turn');
  const app = createApp();
  const session = createCandidateSession({});

  const turn1 = await sendChat(app, session.credential, 'Add work experience');
  assert.match(turn1.text, /work\s*experience/i);

  const block = `Company - HCL
Job Title - AI ENGINEER
Location - BENGALURU
DECEMBER 2025 - JANUARY 2026`;

  const turn2 = await sendChat(app, session.credential, block, turn1.conversationId);
  assert.ok(turn2.action?.confirmationToken, 'Expected confirmation action for work experience');

  // Verify parameters do NOT overwrite current_location
  const stagedBody = turn2.action.parameters?.body;
  assert.ok(stagedBody.work_experience, 'Expected work_experience in staged body');
  assert.equal(stagedBody.current_location, undefined, 'current_location must NOT be in update body');

  // Verify work experience entry details
  const entry = stagedBody.work_experience[0];
  assert.equal(entry.company, 'HCL');
  assert.equal(entry.title, 'AI ENGINEER');
  assert.equal(entry.location, 'BENGALURU');
  assert.equal(entry.start_date, '2025-12');
  assert.equal(entry.end_date, '2026-01');

  // Verify original profile location remains Mumbai
  assert.equal(backend.state.candidateProfile.current_location, 'Mumbai');
});

// ============================================================================
// 3. Intent Switching During Active Profile Edit
// ============================================================================

test('Switching: "view my applications" during active profile edit suspends edit and returns applications', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('switch-applications');
  const app = createApp();
  const session = createCandidateSession({});

  const turn1 = await sendChat(app, session.credential, 'Add work experience');
  assert.match(turn1.text, /work\s*experience/i);

  const turn2 = await sendChat(app, session.credential, 'view my applications', turn1.conversationId);
  assert.match(turn2.text, /NeuralCorp|Senior AI Engineer|applied/i);
  assert.doesNotMatch(turn2.text, /company\s+name|job\s+title\s+\/\s+role/i);

  const sdkSession = sessionManager.sessions.get(turn1.conversationId);
  assert.equal(sdkSession.hirePoolProfileEdit?.active, false);
  assert.equal(sdkSession.hirePoolProfileEdit?.suspended, true);
});

test('Switching: "find matching jobs" during active profile edit suspends edit and returns matching jobs', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('switch-jobs');
  const app = createApp();
  const session = createCandidateSession({});

  const turn1 = await sendChat(app, session.credential, 'Add work experience');
  const turn2 = await sendChat(app, session.credential, 'find matching jobs', turn1.conversationId);

  assert.match(turn2.text, /CognitiveLabs|Lead AI Engineer|95%/i);
  assert.doesNotMatch(turn2.text, /company\s+name/i);

  const sdkSession = sessionManager.sessions.get(turn1.conversationId);
  assert.equal(sdkSession.hirePoolProfileEdit?.active, false);
  assert.equal(sdkSession.hirePoolProfileEdit?.suspended, true);
});

test('Switching: "view my profile" during active profile edit suspends edit and returns profile overview', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('switch-profile-view');
  const app = createApp();
  const session = createCandidateSession({});

  const turn1 = await sendChat(app, session.credential, 'Add work experience');
  const turn2 = await sendChat(app, session.credential, 'view my profile', turn1.conversationId);

  assert.match(turn2.text, /Priya\s+Sharma|Mumbai|AI Engineer/i);
  assert.doesNotMatch(turn2.text, /Please provide the missing required detail/i);

  const sdkSession = sessionManager.sessions.get(turn1.conversationId);
  assert.equal(sdkSession.hirePoolProfileEdit?.active, false);
  assert.equal(sdkSession.hirePoolProfileEdit?.suspended, true);
});

// ============================================================================
// 4. Visitor Intent Recognition & Role Neutrality
// ============================================================================

test('Visitor 1: "I have 2 years of experience and I\'m actively looking." classifies in-scope and explains HirePool opportunities', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('visitor-experience');
  const app = createApp();

  // Test classifier
  const classification = classifyHirePoolMessage("I have 2 years of experience and I'm actively looking.");
  assert.notEqual(classification.category, HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE);

  // Test guest response
  const turn = await sendChat(app, undefined, "I have 2 years of experience and I'm actively looking.");
  assert.match(turn.text, /Free Forever for Candidates|AI Skill Matching|Direct Applications/i);
});

test('Visitor 2: "I have a list of candidates." does NOT assume role and clarifies Employer vs Consultancy', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('visitor-candidate-list');
  const app = createApp();

  const turn = await sendChat(app, undefined, 'I have a list of candidates.');
  assert.match(turn.text, /Employers.*Companies.*Consultancies.*Staffing/is);
  assert.match(turn.text, /hiring pipeline.*bench candidate|hire candidates for your own company.*place candidates as a staffing consultancy/is);

  // Verify role was NOT assigned
  const sdkSession = sessionManager.sessions.get(turn.conversationId);
  assert.equal(sdkSession.hirePoolVisitor?.selectedRole, null);
});

test('Visitor 3: "I don\'t have an account." explains roles and does not repeat identical message across consecutive turns', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('visitor-signup-loop');
  const app = createApp();

  const turn1 = await sendChat(app, undefined, "I don't have an account.");
  assert.ok(turn1.action?.action === 'hirepool_signup');
  assert.match(turn1.text, /Candidate.*Employer.*Consultancy/is);

  // Consecutive turn
  const turn2 = await sendChat(app, undefined, "I don't have an account.", turn1.conversationId);
  assert.ok(turn2.action?.action === 'hirepool_signup');
  // Turn 2 text should be the guided second-offer message, not the identical Turn 1 text
  assert.notEqual(turn1.text, turn2.text);
  assert.match(turn2.text, /Candidate.*Employer.*Consultancy/is);
});

test('Visitor 4: "Hi" / "Hello" returns natural greeting without ambiguity clarification', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('greeting-test');
  const app = createApp();

  const classification = classifyHirePoolMessage('Hi');
  assert.equal(classification.category, HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE);
  assert.equal(classification.intent, HIREPOOL_INTENT_CATEGORIES.PLATFORM_INFO);

  const turn = await sendChat(app, undefined, 'Hi');
  assert.match(turn.text, /Hello! I'm your HirePool assistant/i);
  assert.doesNotMatch(turn.text, /Could you please clarify/i);
});

test('Visitor 5: "Can you compare HirePool and Naukri?" provides grounded comparison from knowledge-base without blanket refusal', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('comparison-test');
  const app = createApp();

  const classification = classifyHirePoolMessage('Can you compare HirePool and Naukri?');
  assert.equal(classification.category, HIREPOOL_DOMAIN_CATEGORIES.PRODUCT_COMPARISON);

  const turn = await sendChat(app, undefined, 'Can you compare HirePool and Naukri?');
  assert.match(turn.text, /While I cannot provide ratings or reviews for external job platforms like Naukri/i);
  assert.match(turn.text, /AI-Powered Matching.*Dedicated workspaces for \*\*Candidates\*\*.*Transparent Application Tracking/is);
  assert.doesNotMatch(turn.text, /We don't provide subjective comparisons/i);
});

// ============================================================================
// 5. Candidate Education & Phone Regressions
// ============================================================================

test('Candidate Education: Hyphen formatting parses degree, institution, and dates', () => {
  const block = `Degree - M.Tech
Institution - BITS Pilani
Grade - 9.2 CGPA
Start Date: 2021-08
End Date: 2023-05`;

  const { draft, errors } = parseEducationFromMessage(block, {});
  assert.equal(errors.length, 0);
  assert.equal(draft.degree, 'M.Tech');
  assert.equal(draft.institution, 'BITS Pilani');
  assert.equal(draft.grade, '9.2 CGPA');
  assert.equal(draft.start_date, '2021-08');
  assert.equal(draft.end_date, '2023-05');
});
