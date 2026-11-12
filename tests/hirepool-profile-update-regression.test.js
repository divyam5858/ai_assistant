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
  HIREPOOL_PROFILE_SECTIONS,
  ensureRoleScopedProfileEditState,
  verifyCandidateProfileReadback,
  verifyClientCompanyProfileReadback,
  verifyConsultancyProfileReadback,
  verifyOrgUserProfileReadback
} from '../integrations/hirepool/profile-edit-shared.js';
import { AssistantApiClient } from '../widget/src/api-client.js';

let activeHttpRestore = null;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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

function setDeterministicProvider(label = 'profile-regression-test') {
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
        first_name: 'Asha',
        last_name: 'Verma',
        phone: '9876543210',
        current_location: 'Bengaluru',
        willing_to_relocate: true,
        headline: 'Backend Software Engineer',
        professional_summary: 'Backend engineer specializing in distributed services.',
        years_of_experience: 4,
        months_of_experience: 6,
        skills: ['JavaScript', 'SQL'],
        preferred_work_types: ['remote', 'hybrid'],
        preferred_job_types: ['full_time'],
        expected_salary_min: 1800000,
        expected_salary_max: 2400000,
        salary_currency: 'INR',
        notice_period_days: 30,
        is_open_to_work: true,
        linkedin_url: 'https://linkedin.com/in/asha-verma',
        github_url: 'https://github.com/ashaverma',
        portfolio_url: 'https://ashaverma.dev',
        personal_website: 'https://blog.ashaverma.dev',
        work_experience: [
          {
            title: 'Software Engineer',
            company: 'Razorpay',
            location: 'Bengaluru',
            start_date: '2022-01',
            end_date: '2024-06',
            is_current: false,
            description: 'Payment gateway APIs'
          }
        ],
        education: [
          {
            institution: 'IIT Madras',
            degree: 'B.Tech',
            field_of_study: 'Computer Science',
            start_date: '2016-07',
            end_date: '2020-05',
            grade: '8.9 CGPA'
          }
        ],
        certifications: [
          {
            name: 'AWS Solutions Architect',
            issuing_organization: 'Amazon Web Services',
            issue_date: '2023-03',
            expiry_date: '2026-03',
            credential_id: 'AWS-SA-123',
            credential_url: 'https://aws.amazon.com/verification/123'
          }
        ]
      }
    ),
    clientProfile: clone(
      options.clientProfile || {
        id: 'client-profile-1',
        company_name: 'Acme Cloud Labs',
        industry: 'Cloud Infrastructure',
        company_size: '51-200',
        headquarters_location: 'Bengaluru, India',
        company_website: 'https://acmecloud.io',
        about_company: 'Enterprise cloud reliability platform.',
        founding_year: 2019,
        gst_tax_id: '29AABCU9603R1ZM',
        social_media_links: {
          linkedin: 'https://linkedin.com/company/acmecloud'
        },
        verification_status: 'verified'
      }
    ),
    clientMe: clone(
      options.clientMe || {
        id: 'client-me-1',
        user_id: 'client-user-1',
        client_id: 'client-profile-1',
        email: 'rohan@acmecloud.io',
        full_name: 'Rohan Mehta',
        designation: 'VP Engineering',
        phone: '9820012345',
        role: 'admin',
        company_name: 'Acme Cloud Labs'
      }
    ),
    consultancyProfile: clone(
      options.consultancyProfile || {
        id: 'cons-profile-1',
        consultancy_name: 'Vertex Talent Partners',
        consultancy_type: 'recruitment',
        industry_specialization: ['Finance', 'Technology'],
        company_size: '11-50',
        headquarters_location: 'Mumbai, India',
        website: 'https://vertextalent.in',
        about_company: 'Specialized leadership & engineering hiring consultancy.',
        founding_year: 2017,
        social_media_links: {
          linkedin: 'https://linkedin.com/company/vertextalent'
        },
        commission_structure: '12% of annual CTC',
        verification_status: 'verified',
        candidate_pool_size: 420
      }
    ),
    consultancyMe: clone(
      options.consultancyMe || {
        id: 'cons-me-1',
        user_id: 'cons-user-1',
        consultancy_id: 'cons-profile-1',
        email: 'neha@vertextalent.in',
        full_name: 'Neha Kapoor',
        designation: 'Managing Partner',
        phone: '9811122233',
        role: 'admin',
        consultancy_name: 'Vertex Talent Partners'
      }
    ),
    putErrorByPath: clone(options.putErrorByPath || {}),
    dropFieldOnGetByPath: clone(options.dropFieldOnGetByPath || {}),
    requests: []
  };

  const applyPutAndGet = (targetKey, path, body, res) => {
    if (state.putErrorByPath[path]) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: state.putErrorByPath[path] }));
      return;
    }
    state[targetKey] = {
      ...state[targetKey],
      ...body
    };
    const responsePayload = clone(state[targetKey]);
    const droppedKey = state.dropFieldOnGetByPath[path];
    if (droppedKey) {
      delete responsePayload[droppedKey];
      delete state[targetKey][droppedKey];
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responsePayload));
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
        const snapshot = clone(state.candidateProfile);
        if (state.dropFieldOnGetByPath[url.pathname]) {
          delete snapshot[state.dropFieldOnGetByPath[url.pathname]];
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snapshot));
        return;
      }
      if (req.method === 'PUT') {
        applyPutAndGet('candidateProfile', url.pathname, body, res);
        return;
      }
    }

    if (url.pathname === '/api/v1/clients/profile') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clone(state.clientProfile)));
        return;
      }
      if (req.method === 'PUT') {
        applyPutAndGet('clientProfile', url.pathname, body, res);
        return;
      }
    }

    if (url.pathname === '/api/v1/clients/me') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clone(state.clientMe)));
        return;
      }
      if (req.method === 'PUT') {
        applyPutAndGet('clientMe', url.pathname, body, res);
        return;
      }
    }

    if (url.pathname === '/api/v1/consultancies/profile') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clone(state.consultancyProfile)));
        return;
      }
      if (req.method === 'PUT') {
        applyPutAndGet('consultancyProfile', url.pathname, body, res);
        return;
      }
    }

    if (url.pathname === '/api/v1/consultancies/me') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(clone(state.consultancyMe)));
        return;
      }
      if (req.method === 'PUT') {
        applyPutAndGet('consultancyMe', url.pathname, body, res);
        return;
      }
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
        end(payload = '') {
          payloadStr = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
        }
      };
      dispatchRequest(
        {
          method: String(init.method || 'GET').toUpperCase(),
          url: `${parsedUrl.pathname}${parsedUrl.search}`,
          headers: {}
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

function createRoleSession({ token, id, email, role, organizationRole = null }) {
  return storeHirePoolSession(token, {
    id,
    email,
    userType: role,
    organizationRole
  });
}

async function sendChat(app, credential, message, conversationId = undefined) {
  const payload = { assistantId: 'hirepool', message, stream: false };
  if (conversationId) payload.conversationId = conversationId;
  const res = await request(app)
    .post('/api/chat')
    .set('Authorization', `Bearer ${credential}`)
    .send(payload)
    .expect(200);
  return res.body;
}

async function confirmAction(app, credential, confirmationToken, expectedStatus = 200) {
  const res = await request(app)
    .post('/api/dynamic-api/confirm')
    .set('Authorization', `Bearer ${credential}`)
    .send({ confirmationToken })
    .expect(expectedStatus);
  return res.body;
}

afterEach(() => {
  setAIProvider(null);
  clearDynamicApiIntegrations();
  activeHttpRestore?.();
});

// ============================================================================
// 1-15. Candidate Profile Editing & Validation Regressions
// ============================================================================

test('Candidate 1: multi-turn "Add skills" with 13 comma-separated skills adds & persists all via PUT + GET readback', async () => {
  const backend = await startMockHirePoolBackend({ candidateProfile: { id: 'c1', first_name: 'Asha', last_name: 'Verma', skills: ['Git'] } });
  setDeterministicProvider('cand-13-skills');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-1', id: 'cand-1', email: 'asha1@test.dev', role: 'candidate' });

  const turn1 = await sendChat(app, session.credential, 'Add skills');
  assert.equal(turn1.action, undefined);
  assert.match(turn1.text, /skill/i);

  const thirteen = 'Python, Go, Rust, Docker, Kubernetes, TypeScript, GraphQL, Redis, PostgreSQL, Terraform, Kafka, Prometheus, FastAPI';
  const turn2 = await sendChat(app, session.credential, thirteen, turn1.conversationId);
  assert.ok(turn2.action?.confirmationToken, 'Expected confirmation token after 13 skills');
  const stagedSkills = turn2.action.parameters.body.skills;
  assert.equal(stagedSkills.length, 14);
  assert.ok(stagedSkills.includes('FastAPI'));
  assert.ok(stagedSkills.includes('Git'));

  const confirmed = await confirmAction(app, session.credential, turn2.action.confirmationToken);
  assert.equal(confirmed.status, 'success');
  assert.equal(confirmed.data.verificationStatus, 'verified');
  assert.equal(backend.state.candidateProfile.skills.length, 14);
});

test('Candidate 2: instruction phrases ("update the skills", "change my skills") NEVER enter skills list', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-instruction-phrase');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-2', id: 'cand-2', email: 'asha2@test.dev', role: 'candidate' });

  const turn1 = await sendChat(app, session.credential, 'update the skills');
  assert.equal(turn1.action, undefined);
  assert.match(turn1.text, /skill/i);

  const turn2 = await sendChat(app, session.credential, 'change my skills please', turn1.conversationId);
  assert.equal(turn2.action, undefined);
  assert.match(turn2.text, /skill|add|replace|remove/i);
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript', 'SQL']);
});

test('Candidate 3: ambiguous "update my skills" + new values triggers add-vs-replace disambiguation; "add" merges safely', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-ambiguous-add');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-3', id: 'cand-3', email: 'asha3@test.dev', role: 'candidate' });

  const turn1 = await sendChat(app, session.credential, 'Update my skills');
  assert.equal(turn1.action, undefined);

  const turn2 = await sendChat(app, session.credential, 'Python, Go', turn1.conversationId);
  assert.equal(turn2.action, undefined);
  assert.match(turn2.text, /add/i);
  assert.match(turn2.text, /replace/i);

  const turn3 = await sendChat(app, session.credential, 'add', turn1.conversationId);
  assert.ok(turn3.action?.confirmationToken);
  assert.deepEqual(turn3.action.parameters.body.skills, ['JavaScript', 'SQL', 'Python', 'Go']);

  const confirmed = await confirmAction(app, session.credential, turn3.action.confirmationToken);
  assert.equal(confirmed.status, 'success');
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript', 'SQL', 'Python', 'Go']);
});

test('Candidate 4: "replace my skills with Go, Rust" replaces existing skills cleanly with profileMergeMode exact', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-replace-skills');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-4', id: 'cand-4', email: 'asha4@test.dev', role: 'candidate' });

  const turn1 = await sendChat(app, session.credential, 'replace my skills with Go, Rust');
  assert.ok(turn1.action?.confirmationToken);
  assert.deepEqual(turn1.action.parameters.body.skills, ['Go', 'Rust']);

  const confirmed = await confirmAction(app, session.credential, turn1.action.confirmationToken);
  assert.equal(confirmed.status, 'success');
  assert.deepEqual(backend.state.candidateProfile.skills, ['Go', 'Rust']);
});

test('Candidate 5: "remove SQL from my skills" deletes SQL & preserves remaining; removing last skill rejects with >= 1 skill guidance', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-remove-skills');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-5', id: 'cand-5', email: 'asha5@test.dev', role: 'candidate' });

  const turn1 = await sendChat(app, session.credential, 'remove SQL from my skills');
  assert.ok(turn1.action?.confirmationToken);
  assert.deepEqual(turn1.action.parameters.body.skills, ['JavaScript']);

  await confirmAction(app, session.credential, turn1.action.confirmationToken);
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript']);

  const turn2 = await sendChat(app, session.credential, 'remove JavaScript from my skills', turn1.conversationId);
  assert.equal(turn2.action, undefined);
  assert.match(turn2.text, /at least 1|one skill|cannot remove all/i);
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript']);
});

test('Candidate 6: typo and punctuation normalization ("Please add kuberetes, s3., Node.js. to my skills")', async () => {
  const backend = await startMockHirePoolBackend({ candidateProfile: { id: 'c6', first_name: 'Asha', last_name: 'Verma', skills: ['Python'] } });
  setDeterministicProvider('cand-typo-norm');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-6', id: 'cand-6', email: 'asha6@test.dev', role: 'candidate' });

  const turn1 = await sendChat(app, session.credential, 'Please add kuberetes, s3., Node.js. to my skills');
  assert.ok(turn1.action?.confirmationToken);
  assert.deepEqual(turn1.action.parameters.body.skills, ['Python', 'Kubernetes', 'S3', 'Node.js']);
});

test('Candidate 7: compound skill edit ("remove SQL and add PostgreSQL, Redis")', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-compound-skills');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-7', id: 'cand-7', email: 'asha7@test.dev', role: 'candidate' });

  const turn1 = await sendChat(app, session.credential, 'remove SQL and add PostgreSQL, Redis');
  assert.ok(turn1.action?.confirmationToken);
  assert.deepEqual(turn1.action.parameters.body.skills, ['JavaScript', 'PostgreSQL', 'Redis']);
});

test('Candidate 8: single-turn multi-field natural language update persists phone, location, notice_period_days, and skills', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-multi-field');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-8', id: 'cand-8', email: 'asha8@test.dev', role: 'candidate' });

  const turn1 = await sendChat(
    app,
    session.credential,
    'Update my phone to 9898989898, location to Hyderabad, notice period to 15 days, and add skills Python, FastAPI'
  );
  assert.ok(turn1.action?.confirmationToken);
  const body = turn1.action.parameters.body;
  assert.equal(body.phone, '9898989898');
  assert.equal(body.current_location, 'Hyderabad');
  assert.equal(body.notice_period_days, 15);
  assert.deepEqual(body.skills, ['JavaScript', 'SQL', 'Python', 'FastAPI']);

  const confirmed = await confirmAction(app, session.credential, turn1.action.confirmationToken);
  assert.equal(confirmed.status, 'success');
  assert.equal(backend.state.candidateProfile.phone, '9898989898');
  assert.equal(backend.state.candidateProfile.current_location, 'Hyderabad');
  assert.equal(backend.state.candidateProfile.notice_period_days, 15);
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript', 'SQL', 'Python', 'FastAPI']);
});

test('Candidate 9: certifications add succeeds and invalid credential URL or expiry date before issue date is rejected', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-certifications');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-9', id: 'cand-9', email: 'asha9@test.dev', role: 'candidate' });

  const badUrl = await sendChat(
    app,
    session.credential,
    'Add certification CKA from CNCF issued 2024-01 url ftp://bad-cert.example'
  );
  assert.equal(badUrl.action, undefined);
  assert.match(badUrl.text, /http|url/i);

  const badDates = await sendChat(
    app,
    session.credential,
    'Add certification CKA from CNCF issued 2024-06 expires 2023-01',
    badUrl.conversationId
  );
  assert.equal(badDates.action, undefined);
  assert.match(badDates.text, /expiry|earlier|before|date/i);

  const valid = await sendChat(
    app,
    session.credential,
    'Add certification CKA from CNCF issued 2024-06 expires 2027-06 credential id CKA-99 url https://cncf.io/cka-99',
    badUrl.conversationId
  );
  assert.ok(valid.action?.confirmationToken);
  assert.equal(valid.action.parameters.body.certifications.length, 2);
  assert.equal(valid.action.parameters.body.certifications[1].name, 'CKA');
  await confirmAction(app, session.credential, valid.action.confirmationToken);
  assert.equal(backend.state.candidateProfile.certifications.length, 2);
});

test('Candidate 10: preferences validate work types, job types (rejecting part_time), salary min/max, notice period, and open to work', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-preferences');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-10', id: 'cand-10', email: 'asha10@test.dev', role: 'candidate' });

  const badJobType = await sendChat(app, session.credential, 'Update my job type preference to part_time');
  assert.equal(badJobType.action, undefined);
  assert.match(badJobType.text, /part_time|full_time|contract|internship/i);

  const badSalaryOrder = await sendChat(
    app,
    session.credential,
    'Update expected salary min to 3000000 and expected salary max to 2000000 INR',
    badJobType.conversationId
  );
  assert.equal(badSalaryOrder.action, undefined);
  assert.match(badSalaryOrder.text, /minimum.*maximum|greater than|salary/i);

  const badNotice = await sendChat(app, session.credential, 'Set notice period to 240 days', badJobType.conversationId);
  assert.equal(badNotice.action, undefined);
  assert.match(badNotice.text, /180|notice period/i);

  const validPrefs = await sendChat(
    app,
    session.credential,
    'Update my preferred work types to remote, preferred job types to full_time, contract, expected salary 20 LPA to 30 LPA INR, notice period 45 days, and open to work yes',
    badJobType.conversationId
  );
  assert.ok(validPrefs.action?.confirmationToken);
  const body = validPrefs.action.parameters.body;
  assert.deepEqual(body.preferred_work_types, ['remote']);
  assert.deepEqual(body.preferred_job_types, ['full_time', 'contract']);
  assert.equal(body.expected_salary_min, 2000000);
  assert.equal(body.expected_salary_max, 3000000);
  assert.equal(body.salary_currency, 'INR');
  assert.equal(body.notice_period_days, 45);
  assert.equal(body.is_open_to_work, true);
  await confirmAction(app, session.credential, validPrefs.action.confirmationToken);
  assert.equal(backend.state.candidateProfile.notice_period_days, 45);
});

test('Candidate 11: links and basic_info validate URLs, 10-digit phone, years_of_experience (<=50), months_of_experience (<=11)', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-links-basic');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-11', id: 'cand-11', email: 'asha11@test.dev', role: 'candidate' });

  const badPhone = await sendChat(app, session.credential, 'Update my phone to 12345abc');
  assert.equal(badPhone.action, undefined);
  assert.match(badPhone.text, /10|digit|phone/i);

  const badLink = await sendChat(app, session.credential, 'Set github url to ftp://github.com/asha', badPhone.conversationId);
  assert.equal(badLink.action, undefined);
  assert.match(badLink.text, /http|url/i);

  const badMonths = await sendChat(app, session.credential, 'Update my experience to 5 years 14 months', badPhone.conversationId);
  assert.equal(badMonths.action, undefined);
  assert.match(badMonths.text, /month|0.*11/i);

  const valid = await sendChat(
    app,
    session.credential,
    'Update first name to Priya, last name to Nair, phone to 9123456789, github url to https://github.com/priyanair, experience to 5 years 3 months',
    badPhone.conversationId
  );
  assert.ok(valid.action?.confirmationToken);
  const b = valid.action.parameters.body;
  assert.equal(b.first_name, 'Priya');
  assert.equal(b.last_name, 'Nair');
  assert.equal(b.phone, '9123456789');
  assert.equal(b.github_url, 'https://github.com/priyanair');
  assert.equal(b.years_of_experience, 5);
  assert.equal(b.months_of_experience, 3);
  await confirmAction(app, session.credential, valid.action.confirmationToken);
  assert.equal(backend.state.candidateProfile.first_name, 'Priya');
});

test('Candidate 12: education and work_experience add & remove operations preserve valid remaining entries', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-edu-work');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-12', id: 'cand-12', email: 'asha12@test.dev', role: 'candidate' });

  const removeWork = await sendChat(app, session.credential, 'remove work experience at Razorpay');
  assert.ok(removeWork.action?.confirmationToken);
  assert.deepEqual(removeWork.action.parameters.body.work_experience, []);
  await confirmAction(app, session.credential, removeWork.action.confirmationToken);
  assert.deepEqual(backend.state.candidateProfile.work_experience, []);

  const addWork = await sendChat(
    app,
    session.credential,
    'Add work experience: Staff Engineer at Stripe from 2024-07 to present',
    removeWork.conversationId
  );
  assert.ok(addWork.action?.confirmationToken);
  assert.equal(addWork.action.parameters.body.work_experience.length, 1);
  assert.equal(addWork.action.parameters.body.work_experience[0].company, 'Stripe');
  assert.equal(addWork.action.parameters.body.work_experience[0].is_current, true);
  await confirmAction(app, session.credential, addWork.action.confirmationToken);
  assert.equal(backend.state.candidateProfile.work_experience[0].company, 'Stripe');

  const removeEdu = await sendChat(app, session.credential, 'remove education #1', removeWork.conversationId);
  assert.ok(removeEdu.action?.confirmationToken);
  assert.deepEqual(removeEdu.action.parameters.body.education, []);
  await confirmAction(app, session.credential, removeEdu.action.confirmationToken);
  assert.deepEqual(backend.state.candidateProfile.education, []);
});

test('Candidate 13: edit-before-confirm replaces staged values, revokes stale confirmationToken, and only confirms final version', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-edit-before-confirm');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-13', id: 'cand-13', email: 'asha13@test.dev', role: 'candidate' });

  const stage1 = await sendChat(app, session.credential, 'Add Python, Go to my skills');
  assert.ok(stage1.action?.confirmationToken);
  const staleToken = stage1.action.confirmationToken;

  const stage2 = await sendChat(app, session.credential, 'Actually also add Rust and GraphQL to my skills', stage1.conversationId);
  assert.ok(stage2.action?.confirmationToken);
  assert.notEqual(stage2.action.confirmationToken, staleToken);
  assert.deepEqual(stage2.action.parameters.body.skills, ['JavaScript', 'SQL', 'Python', 'Go', 'Rust', 'GraphQL']);

  // Stale token must be rejected without mutating backend
  await confirmAction(app, session.credential, staleToken, 410);
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript', 'SQL']);

  const ok = await confirmAction(app, session.credential, stage2.action.confirmationToken, 200);
  assert.equal(ok.status, 'success');
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript', 'SQL', 'Python', 'Go', 'Rust', 'GraphQL']);
});

test('Candidate 14: cancel via POST /api/dynamic-api/confirm/cancel and chat "cancel" leaves backend untouched and resets state', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-cancel');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-14', id: 'cand-14', email: 'asha14@test.dev', role: 'candidate' });

  const stage1 = await sendChat(app, session.credential, 'Replace my skills with Go');
  const token1 = stage1.action.confirmationToken;
  const cancelRes = await request(app)
    .post('/api/dynamic-api/confirm/cancel')
    .set('Authorization', `Bearer ${session.credential}`)
    .send({ confirmationToken: token1 })
    .expect(200);
  assert.equal(cancelRes.body.status, 'cancelled');

  await confirmAction(app, session.credential, token1, 410);
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript', 'SQL']);

  const stage2 = await sendChat(app, session.credential, 'Replace my skills with Rust', stage1.conversationId);
  const token2 = stage2.action.confirmationToken;
  const chatCancel = await sendChat(app, session.credential, 'cancel', stage1.conversationId);
  assert.equal(chatCancel.action, undefined);
  assert.match(chatCancel.text, /cancel/i);
  await confirmAction(app, session.credential, token2, 410);
  assert.deepEqual(backend.state.candidateProfile.skills, ['JavaScript', 'SQL']);
});

test('Candidate 15: unsupported field updates (email, resume, profile picture, gstin) are refused honestly without staging a write', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('cand-unsupported');
  const app = createApp();
  const session = createRoleSession({ token: 'tok-cand-15', id: 'cand-15', email: 'asha15@test.dev', role: 'candidate' });

  for (const prompt of [
    'Change my email to newemail@example.com',
    'Upload my resume',
    'Update my profile photo',
    'Set my GSTIN to 29AABCU9603R1ZM'
  ]) {
    const turn = await sendChat(app, session.credential, prompt);
    assert.equal(turn.action, undefined, `No action should be staged for: ${prompt}`);
    assert.match(turn.text, /dashboard|cannot|not supported|apply only|\*\*Candidate\*\* profiles|authentication settings/i);
  }
  assert.equal(backend.state.requests.filter(r => r.method === 'PUT').length, 0);
});

// ============================================================================
// 16-21. Employer / Client Profile Regressions
// ============================================================================

test('Client 16: admin updates /clients/profile multi-field (GSTIN normalized, website, founding_year, social links) -> GET verified', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('client-company-update');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-client-16',
    id: 'client-user-1',
    email: 'rohan@acmecloud.io',
    role: 'client',
    organizationRole: 'admin'
  });

  const turn = await sendChat(
    app,
    session.credential,
    'Update company name to Acme Cloud Systems, company size to 201-500, website to https://acme.dev, founding year to 2020, gstin to 27aaacu9603r1zm, and linkedin to https://linkedin.com/company/acmesys'
  );
  assert.ok(turn.action?.confirmationToken);
  assert.equal(turn.action.formattedReview?.type, 'client_company_update');
  const b = turn.action.parameters.body;
  assert.equal(b.company_name, 'Acme Cloud Systems');
  assert.equal(b.company_size, '201-500');
  assert.equal(b.company_website, 'https://acme.dev');
  assert.equal(b.founding_year, 2020);
  assert.equal(b.gst_tax_id, '27AAACU9603R1ZM');
  assert.equal(b.social_media_links.linkedin, 'https://linkedin.com/company/acmesys');

  const ok = await confirmAction(app, session.credential, turn.action.confirmationToken);
  assert.equal(ok.status, 'success');
  assert.equal(ok.data.verificationStatus, 'verified');
  assert.equal(backend.state.clientProfile.company_name, 'Acme Cloud Systems');
  assert.equal(backend.state.clientProfile.gst_tax_id, '27AAACU9603R1ZM');
});

test('Client 17: invalid GSTIN, founding_year, company_size, and website URL are rejected before staging', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('client-invalid');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-client-17',
    id: 'client-user-17',
    email: 'rohan17@acmecloud.io',
    role: 'client',
    organizationRole: 'admin'
  });

  const badGstin = await sendChat(app, session.credential, 'Update gstin to BADGSTIN123');
  assert.equal(badGstin.action, undefined);
  assert.match(badGstin.text, /gst|format|15/i);

  const badYear = await sendChat(app, session.credential, 'Set founding year to 1750', badGstin.conversationId);
  assert.equal(badYear.action, undefined);
  assert.match(badYear.text, /1800|year/i);

  const badSize = await sendChat(app, session.credential, 'Set company size to giant', badGstin.conversationId);
  assert.equal(badSize.action, undefined);
  assert.match(badSize.text, /1-10|company size/i);

  const badUrl = await sendChat(app, session.credential, 'Set company website to ftp://acme.dev', badGstin.conversationId);
  assert.equal(badUrl.action, undefined);
  assert.match(badUrl.text, /http|url/i);
  assert.equal(backend.state.requests.filter(r => r.method === 'PUT').length, 0);
});

test('Client 18: /clients/me personal profile update (full_name, designation, phone) -> PUT + GET readback verified', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('client-me-update');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-client-18',
    id: 'client-user-18',
    email: 'rohan@acmecloud.io',
    role: 'client',
    organizationRole: 'admin'
  });

  const turn = await sendChat(
    app,
    session.credential,
    'Update my personal profile full name to Rohan V Mehta, designation to CTO, and phone to 9820099999'
  );
  assert.ok(turn.action?.confirmationToken);
  assert.equal(turn.action.formattedReview?.type, 'client_me_update');
  assert.match(turn.action.action, /update_my_user/i);
  const b = turn.action.parameters.body;
  assert.equal(b.full_name, 'Rohan V Mehta');
  assert.equal(b.designation, 'CTO');
  assert.equal(b.phone, '9820099999');

  const ok = await confirmAction(app, session.credential, turn.action.confirmationToken);
  assert.equal(ok.status, 'success');
  assert.equal(ok.data.verificationStatus, 'verified');
  assert.equal(backend.state.clientMe.full_name, 'Rohan V Mehta');
  assert.equal(backend.state.clientMe.designation, 'CTO');
});

test('Client 19: recruiter/member org role is blocked from /clients/profile but permitted to update /clients/me', async () => {
  const backend = await startMockHirePoolBackend({
    clientMe: {
      id: 'client-me-recruiter',
      user_id: 'client-recruiter-1',
      email: 'recruiter@acmecloud.io',
      full_name: 'Kiran Rao',
      designation: 'Technical Recruiter',
      phone: '9800001111',
      role: 'recruiter'
    }
  });
  setDeterministicProvider('client-role-rbac');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-client-19',
    id: 'client-recruiter-1',
    email: 'recruiter@acmecloud.io',
    role: 'client',
    organizationRole: 'recruiter'
  });

  const denied = await sendChat(app, session.credential, 'Update company name to Unauthorized Name');
  assert.equal(denied.action, undefined);
  assert.match(denied.text, /recruiter|admin|hiring_manager|\/clients\/me/i);

  const allowed = await sendChat(
    app,
    session.credential,
    'Update my designation to Lead Technical Recruiter',
    denied.conversationId
  );
  assert.ok(allowed.action?.confirmationToken);
  assert.equal(allowed.action.formattedReview?.type, 'client_me_update');
  assert.match(allowed.action.action, /update_my_user/i);
  await confirmAction(app, session.credential, allowed.action.confirmationToken);
  assert.equal(backend.state.clientMe.designation, 'Lead Technical Recruiter');
});

test('Client 20: cross-role candidate/consultancy requests and unsupported client fields are rejected cleanly', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('client-cross-role');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-client-20',
    id: 'client-user-20',
    email: 'rohan20@acmecloud.io',
    role: 'client',
    organizationRole: 'admin'
  });

  for (const prompt of [
    'Add education IIT Bombay',
    'Set consultancy type to rpo',
    'Update my work email to cto@acme.io',
    'Upload company logo'
  ]) {
    const turn = await sendChat(app, session.credential, prompt);
    assert.equal(turn.action, undefined, `No action expected for client prompt: ${prompt}`);
  }
  assert.equal(backend.state.requests.filter(r => r.method === 'PUT').length, 0);
});

test('Client 21: edit-before-confirm and cancel work on /clients/profile without premature backend writes', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('client-edit-cancel');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-client-21',
    id: 'client-user-21',
    email: 'rohan21@acmecloud.io',
    role: 'client',
    organizationRole: 'admin'
  });

  const stage1 = await sendChat(app, session.credential, 'Update headquarters location to Pune, India');
  const tok1 = stage1.action.confirmationToken;

  const stage2 = await sendChat(app, session.credential, 'Actually change headquarters location to Hyderabad, India', stage1.conversationId);
  assert.notEqual(stage2.action.confirmationToken, tok1);
  assert.equal(stage2.action.parameters.body.headquarters_location, 'Hyderabad, India');

  await confirmAction(app, session.credential, tok1, 410);
  await request(app)
    .post('/api/dynamic-api/confirm/cancel')
    .set('Authorization', `Bearer ${session.credential}`)
    .send({ confirmationToken: stage2.action.confirmationToken })
    .expect(200);
  assert.equal(backend.state.clientProfile.headquarters_location, 'Bengaluru, India');
});

// ============================================================================
// 22-26. Agency / Consultancy Profile Regressions
// ============================================================================

test('Consultancy 22: admin updates /consultancies/profile (consultancy_type, industry_specialization add/replace/remove, commission_structure) -> verified', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('consultancy-org-update');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-cons-22',
    id: 'cons-user-22',
    email: 'neha@vertextalent.in',
    role: 'consultancy',
    organizationRole: 'admin'
  });

  const addSpec = await sendChat(app, session.credential, 'Add Engineering, Healthcare to industry specializations');
  assert.ok(addSpec.action?.confirmationToken);
  assert.equal(addSpec.action.formattedReview?.type, 'consultancy_org_update');
  assert.deepEqual(addSpec.action.parameters.body.industry_specialization, ['Finance', 'Technology', 'Engineering', 'Healthcare']);
  const ok1 = await confirmAction(app, session.credential, addSpec.action.confirmationToken);
  assert.equal(ok1.data.verificationStatus, 'verified');

  const removeSpec = await sendChat(app, session.credential, 'Remove Finance from industry specializations', addSpec.conversationId);
  assert.deepEqual(removeSpec.action.parameters.body.industry_specialization, ['Technology', 'Engineering', 'Healthcare']);
  await confirmAction(app, session.credential, removeSpec.action.confirmationToken);

  const multiUpdate = await sendChat(
    app,
    session.credential,
    'Update consultancy type to staffing, company size to 51-200, website to https://vertexpartners.in, commission structure to retainer: 10%, placement: 15%',
    addSpec.conversationId
  );
  assert.ok(multiUpdate.action?.confirmationToken);
  const b = multiUpdate.action.parameters.body;
  assert.equal(b.consultancy_type, 'staffing');
  assert.equal(b.company_size, '51-200');
  assert.equal(b.website, 'https://vertexpartners.in');
  assert.deepEqual(b.commission_structure, { retainer: '10%', placement: '15%' });
  const ok3 = await confirmAction(app, session.credential, multiUpdate.action.confirmationToken);
  assert.equal(ok3.status, 'success');
  assert.equal(ok3.data.verificationStatus, 'verified');
  assert.equal(backend.state.consultancyProfile.consultancy_type, 'staffing');
});

test('Consultancy 23: invalid consultancy_type, unsupported specialization, or invalid commission structure is rejected cleanly', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('consultancy-invalid');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-cons-23',
    id: 'cons-user-23',
    email: 'neha23@vertextalent.in',
    role: 'consultancy',
    organizationRole: 'admin'
  });

  const badType = await sendChat(app, session.credential, 'Set consultancy type to freelancer');
  assert.equal(badType.action, undefined);
  assert.match(badType.text, /recruitment|staffing/i);

  const badSpec = await sendChat(app, session.credential, 'Add CryptoBlockchain to industry specializations', badType.conversationId);
  assert.equal(badSpec.action, undefined);
  assert.match(badSpec.text, /Unsupported specialization|Allowed options/i);

  const badComm = await sendChat(app, session.credential, 'Set commission structure to 15% flat fee', badType.conversationId);
  assert.equal(badComm.action, undefined);
  assert.match(badComm.text, /commission structure|key-value|object/i);
  assert.equal(backend.state.requests.filter(r => r.method === 'PUT').length, 0);
});

test('Consultancy 24: /consultancies/me personal profile update -> PUT + GET readback verified', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('consultancy-me');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-cons-24',
    id: 'cons-user-24',
    email: 'neha@vertextalent.in',
    role: 'consultancy',
    organizationRole: 'admin'
  });

  const turn = await sendChat(
    app,
    session.credential,
    'Update my personal profile full name to Neha Sharma, designation to Senior Partner, phone to 9811155566'
  );
  assert.ok(turn.action?.confirmationToken);
  assert.equal(turn.action.formattedReview?.type, 'consultancy_me_update');
  assert.match(turn.action.action, /update_my_user/i);
  const ok = await confirmAction(app, session.credential, turn.action.confirmationToken);
  assert.equal(ok.status, 'success');
  assert.equal(ok.data.verificationStatus, 'verified');
  assert.equal(backend.state.consultancyMe.full_name, 'Neha Sharma');
  assert.equal(backend.state.consultancyMe.designation, 'Senior Partner');
});

test('Consultancy 25: non-admin consultancy team member (recruiter) is blocked from /consultancies/profile but can update /consultancies/me', async () => {
  const backend = await startMockHirePoolBackend({
    consultancyMe: {
      id: 'cons-me-member',
      user_id: 'cons-recruiter-1',
      email: 'arjun@vertextalent.in',
      full_name: 'Arjun Nair',
      designation: 'Account Coordinator',
      phone: '9833344455',
      role: 'account_manager'
    }
  });
  setDeterministicProvider('consultancy-rbac');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-cons-25',
    id: 'cons-recruiter-1',
    email: 'arjun@vertextalent.in',
    role: 'consultancy',
    organizationRole: 'account_manager'
  });

  const denied = await sendChat(app, session.credential, 'Update consultancy website to https://hack.example');
  assert.equal(denied.action, undefined);
  assert.match(denied.text, /account_manager|admin|\/consultancies\/me/i);

  const allowed = await sendChat(
    app,
    session.credential,
    'Update my phone to 9833399999',
    denied.conversationId
  );
  assert.ok(allowed.action?.confirmationToken);
  assert.equal(allowed.action.formattedReview?.type, 'consultancy_me_update');
  assert.match(allowed.action.action, /update_my_user/i);
  await confirmAction(app, session.credential, allowed.action.confirmationToken);
  assert.equal(backend.state.consultancyMe.phone, '9833399999');
});

test('Consultancy 26: unsupported fields (gst_tax_id, verification_status, candidate_pool_size, logo) & candidate sections are rejected cleanly', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('consultancy-unsupported');
  const app = createApp();
  const session = createRoleSession({
    token: 'tok-cons-26',
    id: 'cons-user-26',
    email: 'neha26@vertextalent.in',
    role: 'consultancy',
    organizationRole: 'admin'
  });

  for (const prompt of [
    'Set gstin to 29AABCU9603R1ZM',
    'Set verification status to verified',
    'Update candidate pool size to 900',
    'Upload agency logo',
    'Add my skills Go, Rust'
  ]) {
    const turn = await sendChat(app, session.credential, prompt);
    assert.equal(turn.action, undefined, `No action expected for consultancy prompt: ${prompt}`);
  }
  assert.equal(backend.state.requests.filter(r => r.method === 'PUT').length, 0);
});

// ============================================================================
// 27-32. Domain Policy, Cross-User/Role Isolation, Readback, SSE & Widget API
// ============================================================================

test('Policy 27: classifyHirePoolMessage preserves multi-turn profile follow-ups with/without history while blocking trivia & competitors', () => {
  const activeSession = {
    hirePoolProfileEdit: {
      active: true,
      stage: 'collecting',
      selectedSection: HIREPOOL_PROFILE_SECTIONS.SKILLS
    }
  };
  const historyCtx = [
    { role: 'user', content: 'Add skills' },
    { role: 'assistant', content: 'Which skills would you like to add to your HirePool profile?' }
  ];

  for (const followUp of [
    'Python, Go, Rust, Docker, Kubernetes, GraphQL',
    'https://github.com/ashaverma',
    '30',
    'add',
    'replace'
  ]) {
    const withState = classifyHirePoolMessage(followUp, activeSession, {
      authUser: { role: 'candidate' }
    });
    assert.equal(withState.category, HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE);
    assert.equal(withState.intent, HIREPOOL_INTENT_CATEGORIES.PROFILE_EDIT);

    const withHistory = classifyHirePoolMessage(followUp, null, {
      history: historyCtx
    });
    assert.equal(withHistory.category, HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE);
  }

  for (const blocked of ['What is the national animal of India?', 'Rate Naukri vs Indeed', 'Compare HirePool vs LinkedIn']) {
    const res = classifyHirePoolMessage(blocked, activeSession, { authUser: { role: 'candidate' } });
    assert.notEqual(res.category, HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE);
  }
});

test('Security 28: ensureRoleScopedProfileEditState resets stale session state on userId or role change', () => {
  const makeSession = () => ({
    hirePoolProfileEdit: {
      active: true,
      stage: 'collecting',
      role: 'candidate',
      userId: 'cand-1',
      selectedSection: HIREPOOL_PROFILE_SECTIONS.SKILLS,
      draftData: { skills: ['Rust'] }
    }
  });

  const s1 = makeSession();
  const sameUser = ensureRoleScopedProfileEditState(s1, { role: 'candidate', id: 'cand-1' });
  assert.equal(sameUser.active, true);
  assert.deepEqual(sameUser.draftData, { skills: ['Rust'] });

  const s2 = makeSession();
  const diffRole = ensureRoleScopedProfileEditState(s2, { role: 'client', id: 'cand-1' });
  assert.equal(diffRole, null);
  assert.equal(s2.hirePoolProfileEdit, null);

  const s3 = makeSession();
  const diffUser = ensureRoleScopedProfileEditState(s3, { role: 'candidate', id: 'cand-2' });
  assert.equal(diffUser, null);
  assert.equal(s3.hirePoolProfileEdit, null);
});

test('Security 29: POST /api/dynamic-api/confirm/cancel enforces session ownership (another user cannot cancel)', async () => {
  await startMockHirePoolBackend();
  setDeterministicProvider('cancel-ownership');
  const app = createApp();
  const userA = createRoleSession({ token: 'tok-owner-a', id: 'cand-a', email: 'a@test.dev', role: 'candidate' });
  const userB = createRoleSession({ token: 'tok-owner-b', id: 'cand-b', email: 'b@test.dev', role: 'candidate' });

  const stageA = await sendChat(app, userA.credential, 'Replace my skills with Go');
  const resB = await request(app)
    .post('/api/dynamic-api/confirm/cancel')
    .set('Authorization', `Bearer ${userB.credential}`)
    .send({ confirmationToken: stageA.action.confirmationToken });
  assert.ok([401, 403, 409].includes(resB.status), `Expected 401/403/409 for cross-user cancel, got ${resB.status}`);

  // Token remains valid for owner A to cancel cleanly
  await request(app)
    .post('/api/dynamic-api/confirm/cancel')
    .set('Authorization', `Bearer ${userA.credential}`)
    .send({ confirmationToken: stageA.action.confirmationToken })
    .expect(200);
});

test('Integrity 30: PUT HTTP 500 surfaces failure honestly AND GET-after-PUT readback mismatch returns false across roles', async () => {
  // Part A: PUT HTTP 500 returns 5xx/4xx error and never reports verified success
  const failBackend = await startMockHirePoolBackend({
    putErrorByPath: { '/api/v1/candidates/profile': 'Database unavailable' }
  });
  setDeterministicProvider('put-500-honest');
  const app = createApp();
  const candSession = createRoleSession({ token: 'tok-fail-1', id: 'cand-fail', email: 'f@test.dev', role: 'candidate' });
  const turn = await sendChat(app, candSession.credential, 'Replace my skills with Go');
  const failRes = await request(app)
    .post('/api/dynamic-api/confirm')
    .set('Authorization', `Bearer ${candSession.credential}`)
    .send({ confirmationToken: turn.action.confirmationToken });
  assert.ok(failRes.status >= 400);
  await failBackend.close();

  // Part B: Direct readback verifier unit checks for mismatch vs match across candidate, client, client/me, consultancy, consultancy/me
  assert.equal(verifyCandidateProfileReadback({ skills: ['Go'] }, { first_name: 'Wrong', skills: ['Old'] }), false);
  assert.equal(verifyCandidateProfileReadback({ skills: ['Go'] }, { first_name: 'Asha', skills: ['Go'] }), true);

  assert.equal(verifyClientCompanyProfileReadback({ company_name: 'New Name' }, { company_name: 'Old Name' }), false);
  assert.equal(
    verifyClientCompanyProfileReadback(
      { company_name: 'New Name', gst_tax_id: '29AABCU9603R1ZM' },
      { company_name: 'New Name', gst_tax_id: '29AABCU9603R1ZM' }
    ),
    true
  );

  assert.equal(
    verifyConsultancyProfileReadback(
      { consultancy_type: 'staffing', industry_specialization: ['Healthcare'] },
      { consultancy_type: 'recruitment', industry_specialization: ['Finance'] }
    ),
    false
  );
  assert.equal(
    verifyConsultancyProfileReadback(
      { consultancy_type: 'staffing', industry_specialization: ['Healthcare'] },
      { consultancy_type: 'staffing', industry_specialization: ['Healthcare'] }
    ),
    true
  );

  assert.equal(verifyOrgUserProfileReadback({ designation: 'VP Engineering' }, { designation: 'Engineer' }), false);
  assert.equal(verifyOrgUserProfileReadback({ designation: 'VP Engineering' }, { designation: 'VP Engineering' }), true);
});

test('Streaming 31: POST /api/chat/stream delivers chunk, action, and done events for multi-role profile edits', async () => {
  const backend = await startMockHirePoolBackend();
  setDeterministicProvider('sse-profile-stream');
  const app = createApp();
  const consSession = createRoleSession({
    token: 'tok-sse-1',
    id: 'cons-sse-1',
    email: 'neha@vertextalent.in',
    role: 'consultancy',
    organizationRole: 'admin'
  });

  const sseRes = await request(app)
    .post('/api/chat/stream')
    .set('Authorization', `Bearer ${consSession.credential}`)
    .send({
      assistantId: 'hirepool',
      message: 'Update consultancy company size to 201-500 and commission structure to retainer: 12%, placement: 15%',
      stream: true
    })
    .expect(200);

  const events = parseSseEvents(sseRes.text);
  const actionEvent = events.find(e => e.type === 'action');
  const doneEvent = events.find(e => e.type === 'done');
  assert.ok(events.some(e => e.type === 'chunk' && typeof e.delta === 'string'), 'Expected chunk SSE event');
  assert.ok(actionEvent?.action?.confirmationToken, 'Expected confirmationToken in action SSE event');
  assert.equal(doneEvent?.action?.formattedReview?.type, 'consultancy_org_update');

  const ok = await confirmAction(app, consSession.credential, actionEvent.action.confirmationToken);
  assert.equal(ok.status, 'success');
  assert.equal(backend.state.consultancyProfile.company_size, '201-500');
  assert.deepEqual(backend.state.consultancyProfile.commission_structure, { retainer: '12%', placement: '15%' });
});

test('Widget API 32: AssistantApiClient.cancelDynamicApiAction calls POST /api/dynamic-api/confirm/cancel with token and SDK hooks wire action:cancel', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'cancelled' }),
      text: async () => JSON.stringify({ status: 'cancelled' })
    };
  };

  try {
    const client = new AssistantApiClient('http://localhost:4000', {
      assistantId: 'hirepool',
      getAuthHeaders: async () => ({ Authorization: 'Bearer test-cred' })
    });
    const res = await client.cancelDynamicApiAction('confirm-tok-xyz');
    assert.equal(res.status, 'cancelled');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://localhost:4000/api/dynamic-api/confirm/cancel');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].body, { confirmationToken: 'confirm-tok-xyz' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const sdkSource = await readFile(new URL('../widget/src/sdk.js', import.meta.url), 'utf8');
  assert.match(sdkSource, /events\.on\('action:cancel'/);
  assert.match(sdkSource, /cancelDynamicApiAction/);
  assert.match(sdkSource, /integrationCancelUnsubscribe\?\.\(\)/);
});
