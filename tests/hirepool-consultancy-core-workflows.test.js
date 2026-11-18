/**
 * Dedicated Tests for HirePool Recruitment Agency / Consultancy Core Workflows:
 * 1. Add candidates to the Consultancy's agency-managed candidate bench (POST /api/v1/consultancies/candidates).
 * 2. Submit Consultancy-managed candidates to eligible HirePool job openings (POST /api/v1/applications/consultancy).
 * 3. View and edit the Consultancy organisation's agency profile (GET & PUT /api/v1/consultancies/profile).
 * 4. View actual Consultancy dashboard statistics and candidate submission tracking.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import openapiFixture from './fixtures/hirepool-openapi.json' with { type: 'json' };
import {
  storeHirePoolSession
} from '../backend/src/local-integrations/hirepool-session-store.js';
import {
  registerHirePoolLocalDevelopmentIntegration
} from '../integrations/hirepool/local-development.js';
import {
  formatConsultancyProfile,
  formatDashboardStats,
  formatConsultancySubmissionsList,
  formatCandidatesList
} from '../backend/src/routes/chat.js';
import {
  extractCandidateFields,
  isHirePoolAgencyCandidateAddIntent,
  handleHirePoolAgencyCandidateAddTurn
} from '../integrations/hirepool/agency-candidate-add.js';
import {
  extractSubmissionIntentDetails,
  isHirePoolAgencyCandidateSubmitIntent,
  handleHirePoolAgencyCandidateSubmitTurn
} from '../integrations/hirepool/agency-candidate-submit.js';
import {
  isHirePoolOrgProfileEditRequest
} from '../integrations/hirepool/org-profile-edit.js';
import {
  classifyHirePoolMessage
} from '../integrations/hirepool/domain-policy.js';

const app = createApp();
const HIREPOOL_LOCAL_EXTENSION_ORIGIN = 'chrome-extension://local-hirepool-extension';

function setupConsultancySession(orgRole = 'admin') {
  const session = storeHirePoolSession('consultancy-agency-token', {
    id: 'consultancy-user-1',
    email: 'admin@apexrecruitment.test',
    userType: 'consultancy',
    organizationRole: orgRole
  });
  return session;
}

test('Consultancy 1: Candidate Bench field extraction parses colon/hyphen syntax and normalizes fields', () => {
  const input = `Candidate: Priya Sharma
Email - priya.sharma@example.com
Phone: +91 9876543210
Location - Bengaluru, India
Role: Senior React Developer
Skills - React, TypeScript, Redux, Node.js
Experience - 5 years
Bench Status - available
Notice Period - 15 days`;

  const extracted = extractCandidateFields(input);
  assert.equal(extracted.first_name, 'Priya');
  assert.equal(extracted.last_name, 'Sharma');
  assert.equal(extracted.email, 'priya.sharma@example.com');
  assert.equal(extracted.phone, '+91 9876543210');
  assert.equal(extracted.current_location, 'Bengaluru, India');
  assert.equal(extracted.job_title, 'Senior React Developer');
  assert.deepEqual(extracted.skills, ['React', 'TypeScript', 'Redux', 'Node.js']);
  assert.equal(extracted.years_of_experience, 5);
  assert.equal(extracted.bench_status, 'available');
  assert.equal(extracted.notice_period_days, 15);
});

test('Consultancy 2: Candidate Bench multi-turn collection prompts only for missing required fields and stages confirmation', async () => {
  const session = { id: 'conv-bench-1' };
  const authUser = { role: 'consultancy', email: 'agency@apex.test' };

  // Turn 1: Partial info provided
  const turn1 = await handleHirePoolAgencyCandidateAddTurn({
    message: 'Add candidate to my bench: John Doe, email john.doe@example.com',
    session,
    authUser
  });

  assert.equal(turn1.handled, true);
  assert.match(turn1.text, /recorded the following candidate details/i);
  assert.match(turn1.text, /John Doe/);
  assert.match(turn1.text, /john\.doe@example\.com/);
  // Missing job_title and location
  assert.match(turn1.text, /Job title/i);
  assert.match(turn1.text, /Location/i);
  assert.equal(session.consultancyCandidateDraft.active, true);

  // Turn 2: Provide remaining required fields
  let stagedBody = null;
  const stageMock = async ({ body }) => {
    stagedBody = body;
    return {
      hostAction: {
        id: 'token-add-cand-1',
        action: 'api_hirepool_local_development_add_candidate',
        confirmationToken: 'token-add-cand-1'
      }
    };
  };

  const turn2 = await handleHirePoolAgencyCandidateAddTurn({
    message: 'Job title: Full Stack Engineer, Location: Mumbai, India, Skills: Node.js, React, Experience: 4 years',
    session,
    authUser,
    stageCandidateAddConfirmation: stageMock
  });

  assert.equal(turn2.handled, true);
  assert.match(turn2.text, /Review Candidate Bench Details/i);
  assert.match(turn2.text, /John Doe/);
  assert.match(turn2.text, /Full Stack Engineer/);
  assert.match(turn2.text, /Mumbai, India/);
  assert.match(turn2.text, /4 years/);
  assert.equal(session.consultancyCandidateDraft.stage, 'awaiting_confirmation');
  assert.ok(stagedBody);
  assert.equal(stagedBody.first_name, 'John');
  assert.equal(stagedBody.last_name, 'Doe');
  assert.equal(stagedBody.email, 'john.doe@example.com');
  assert.equal(stagedBody.job_title, 'Full Stack Engineer');
});

test('Consultancy 3: Candidate Bench addition can be cleanly cancelled without mutating state', async () => {
  const session = {
    id: 'conv-bench-cancel',
    consultancyCandidateDraft: {
      active: true,
      stage: 'collecting',
      fields: { first_name: 'Temp', email: 'temp@test.com' }
    }
  };
  const authUser = { role: 'consultancy', email: 'agency@apex.test' };

  const cancelResult = await handleHirePoolAgencyCandidateAddTurn({
    message: 'Cancel candidate addition',
    session,
    authUser
  });

  assert.equal(cancelResult.handled, true);
  assert.match(cancelResult.text, /cancelled the candidate addition/i);
  assert.equal(session.consultancyCandidateDraft, null);
});

test('Consultancy 4: Live API Chat bench candidate addition -> stages confirmation -> confirms via /api/dynamic-api/confirm -> verified', async () => {
  process.env.NODE_ENV = 'development';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = `http://localhost:3001,http://localhost:5173,${HIREPOOL_LOCAL_EXTENSION_ORIGIN}`;
  process.env.CORS_ALLOWED_ORIGINS = `http://localhost:3001,http://localhost:5173,${HIREPOOL_LOCAL_EXTENSION_ORIGIN}`;
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  process.env.AI_PROVIDER = 'mock';

  registerHirePoolLocalDevelopmentIntegration();

  const session = setupConsultancySession('admin');
  const headers = {
    Authorization: `Bearer ${session.credential}`,
    Origin: HIREPOOL_LOCAL_EXTENSION_ORIGIN,
    'Content-Type': 'application/json'
  };

  let candidateDb = [];
  const originalHttpRequest = http.request;
  try {
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
          method: (typeof maybeOptions === 'object' && maybeOptions?.method) || 'GET'
        };
        cb = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      }

      const host = parsedOptions?.hostname || parsedOptions?.host?.split(':')[0];
      const port = Number(parsedOptions?.port || 80);
      if ((host === '127.0.0.1' || host === 'localhost') && port === 8000) {
        const req = new EventEmitter();
        const chunks = [];
        req.write = chunk => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        };
        req.setTimeout = () => req;
        req.destroy = () => req;
        req.abort = () => req;
        req.end = chunk => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          queueMicrotask(() => {
            let statusCode = 200;
            let responsePayload = {};
            const path = parsedOptions.path || '/';
            const method = (parsedOptions.method || 'GET').toUpperCase();

            if (path === '/api/openapi.json') {
              responsePayload = openapiFixture;
            } else if (path === '/api/v1/consultancies/candidates' && method === 'POST') {
              const body = JSON.parse(bodyStr);
              const newCand = {
                id: 'cand-bench-777',
                consultancy_id: 'agency-101',
                ...body,
                created_at: new Date().toISOString()
              };
              candidateDb.push(newCand);
              responsePayload = newCand;
            } else if (path.startsWith('/api/v1/consultancies/candidates/cand-bench-777')) {
              responsePayload = candidateDb.find(c => c.id === 'cand-bench-777') || { id: 'cand-bench-777', first_name: 'Aarav' };
            } else if (path.startsWith('/api/v1/consultancies/candidates')) {
              responsePayload = {
                items: candidateDb,
                total: candidateDb.length,
                page: 1,
                page_size: 20
              };
            }

            const res = new EventEmitter();
            res.statusCode = statusCode;
            res.headers = { 'content-type': 'application/json' };
            if (typeof cb === 'function') cb(res);
            res.emit('data', Buffer.from(JSON.stringify(responsePayload)));
            res.emit('end');
          });
          return req;
        };
        return req;
      }
      return originalHttpRequest.call(http, urlOrOptions, maybeOptions, maybeCallback);
    };

    // 1. Send all fields in chat to add candidate
    const chatRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        message: 'Add candidate to my bench: Aarav Mehta, email aarav.mehta@example.com, phone 9876543210, location Bengaluru, job title Principal Cloud Architect, skills AWS, Kubernetes, Terraform, experience 8 years',
        conversationId: 'bench-conv-live-1'
      });

    assert.equal(chatRes.status, 200);
    assert.match(chatRes.body.text, /Review Candidate Bench Details/i);
    assert.match(chatRes.body.text, /Aarav Mehta/);
    assert.match(chatRes.body.text, /Principal Cloud Architect/);
    assert.ok(chatRes.body.action);
    assert.match(chatRes.body.action.action, /add_candidate/i);
    assert.ok(chatRes.body.action.id);

    // 2. Confirm execution using the confirmationToken
    const confirmRes = await request(app)
      .post('/api/dynamic-api/confirm')
      .set(headers)
      .send({
        confirmationToken: chatRes.body.action.id
      });

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.status, 'success');
    assert.match(confirmRes.body.message, /Aarav Mehta has been added to your consultancy talent pool/i);
    assert.equal(confirmRes.body.data.id, 'cand-bench-777');
    assert.equal(candidateDb.length, 1);
  } finally {
    http.request = originalHttpRequest;
  }
});

test('Consultancy 5: Candidate submission handles candidate disambiguation and job selection', async () => {
  const session = { id: 'conv-sub-disambiguate' };
  const authUser = { role: 'consultancy', email: 'agency@apex.test' };

  // Registry with mocked candidates and jobs
  const registryMock = {
    list: () => [
      {
        metadata: { dynamicApi: { operationId: 'list_candidates_api_v1_consultancies_candidates_get' } }
      },
      {
        metadata: { dynamicApi: { operationId: 'search_jobs_api_v1_jobs_search_get' } }
      },
      {
        metadata: { dynamicApi: { operationId: 'get_consultancy_submissions_api_v1_applications_for_consultancy_get' } }
      },
      {
        metadata: { dynamicApi: { operationId: 'create_consultancy_application_api_v1_applications_consultancy_post' } }
      }
    ]
  };

  const executeActionMock = async (action, args) => {
    const op = action.metadata.dynamicApi.operationId;
    if (op === 'list_candidates_api_v1_consultancies_candidates_get') {
      return {
        items: [
          { id: 'cand-1', first_name: 'Rahul', last_name: 'Sharma', email: 'rahul.s@test.com', job_title: 'React Specialist' },
          { id: 'cand-2', first_name: 'Rahul', last_name: 'Verma', email: 'rahul.v@test.com', job_title: 'DevOps Engineer' }
        ]
      };
    }
    if (op === 'search_jobs_api_v1_jobs_search_get') {
      return {
        items: [
          { id: 'job-101', title: 'Senior Frontend Engineer', company_name: 'TechFlow', remote_type: 'remote' }
        ]
      };
    }
    if (op === 'get_consultancy_submissions_api_v1_applications_for_consultancy_get') {
      return { items: [] }; // no duplicate
    }
    return {};
  };

  // Turn 1: "Submit Rahul for Frontend role" -> Multiple Rahuls found!
  const turn1 = await handleHirePoolAgencyCandidateSubmitTurn({
    message: 'Submit Rahul for Senior Frontend Engineer role',
    session,
    registry: registryMock,
    authUser,
    executeAction: executeActionMock
  });

  assert.equal(turn1.handled, true);
  assert.match(turn1.text, /multiple candidates matching "Rahul"/i);
  assert.match(turn1.text, /Rahul Sharma/);
  assert.match(turn1.text, /Rahul Verma/);
  assert.equal(session.consultancySubmissionDraft.stage, 'disambiguate_candidate');

  // Turn 2: User specifies choice "1" (Rahul Sharma)
  let stagedSubmissionBody = null;
  const stageMock = async ({ body }) => {
    stagedSubmissionBody = body;
    return {
      hostAction: {
        id: 'token-sub-cand-1',
        action: 'api_hirepool_local_development_create_consultancy_application',
        confirmationToken: 'token-sub-cand-1'
      }
    };
  };

  const turn2 = await handleHirePoolAgencyCandidateSubmitTurn({
    message: '1',
    session,
    registry: registryMock,
    authUser,
    executeAction: executeActionMock,
    stageCandidateSubmitConfirmation: stageMock
  });

  assert.equal(turn2.handled, true);
  assert.match(turn2.text, /Review Candidate Submission Details/i);
  assert.match(turn2.text, /Rahul Sharma/);
  assert.match(turn2.text, /Senior Frontend Engineer/);
  assert.match(turn2.text, /TechFlow/);
  assert.ok(stagedSubmissionBody);
  assert.equal(stagedSubmissionBody.consultancy_candidate_id, 'cand-1');
  assert.equal(stagedSubmissionBody.job_id, 'job-101');
});

test('Consultancy 6: Candidate submission rejects duplicate submissions with active status', async () => {
  const session = { id: 'conv-sub-dup' };
  const authUser = { role: 'consultancy', email: 'agency@apex.test' };

  const registryMock = {
    list: () => [
      { metadata: { dynamicApi: { operationId: 'list_candidates_api_v1_consultancies_candidates_get' } } },
      { metadata: { dynamicApi: { operationId: 'search_jobs_api_v1_jobs_search_get' } } },
      { metadata: { dynamicApi: { operationId: 'get_consultancy_submissions_api_v1_applications_for_consultancy_get' } } }
    ]
  };

  const executeActionMock = async (action, args) => {
    const op = action.metadata.dynamicApi.operationId;
    if (op === 'list_candidates_api_v1_consultancies_candidates_get') {
      return {
        items: [{ id: 'cand-9', first_name: 'Ananya', last_name: 'Rao', email: 'ananya@test.com', job_title: 'Data Engineer' }]
      };
    }
    if (op === 'search_jobs_api_v1_jobs_search_get') {
      return {
        items: [{ id: 'job-55', title: 'Data Pipeline Lead', company_name: 'DataCorp' }]
      };
    }
    if (op === 'get_consultancy_submissions_api_v1_applications_for_consultancy_get') {
      // Simulate existing application
      return {
        items: [{ id: 'app-existing-99', status: 'screening_pending' }]
      };
    }
    return {};
  };

  const result = await handleHirePoolAgencyCandidateSubmitTurn({
    message: 'Submit Ananya Rao for Data Pipeline Lead',
    session,
    registry: registryMock,
    authUser,
    executeAction: executeActionMock
  });

  assert.equal(result.handled, true);
  assert.match(result.text, /has already been submitted to/i);
  assert.match(result.text, /Data Pipeline Lead/);
  assert.match(result.text, /screening_pending/);
  assert.equal(session.consultancySubmissionDraft, null);
});

test('Consultancy 7: Candidate submission executes POST /api/v1/applications/consultancy and verifies readback', async () => {
  process.env.NODE_ENV = 'development';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = `http://localhost:3001,http://localhost:5173,${HIREPOOL_LOCAL_EXTENSION_ORIGIN}`;
  process.env.CORS_ALLOWED_ORIGINS = `http://localhost:3001,http://localhost:5173,${HIREPOOL_LOCAL_EXTENSION_ORIGIN}`;
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  process.env.AI_PROVIDER = 'mock';

  registerHirePoolLocalDevelopmentIntegration();

  const session = setupConsultancySession('admin');
  const headers = {
    Authorization: `Bearer ${session.credential}`,
    Origin: HIREPOOL_LOCAL_EXTENSION_ORIGIN,
    'Content-Type': 'application/json'
  };

  let submissionsDb = [];
  const originalHttpRequest = http.request;
  try {
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
          method: (typeof maybeOptions === 'object' && maybeOptions?.method) || 'GET'
        };
        cb = typeof maybeOptions === 'function' ? maybeOptions : maybeCallback;
      }

      const host = parsedOptions?.hostname || parsedOptions?.host?.split(':')[0];
      const port = Number(parsedOptions?.port || 80);
      if ((host === '127.0.0.1' || host === 'localhost') && port === 8000) {
        const req = new EventEmitter();
        const chunks = [];
        req.write = chunk => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        };
        req.setTimeout = () => req;
        req.destroy = () => req;
        req.abort = () => req;
        req.end = chunk => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          queueMicrotask(() => {
            let statusCode = 200;
            let responsePayload = {};
            const path = parsedOptions.path || '/';
            const method = (parsedOptions.method || 'GET').toUpperCase();

            if (path === '/api/openapi.json') {
              responsePayload = openapiFixture;
            } else if (path.startsWith('/api/v1/consultancies/candidates')) {
              responsePayload = {
                items: [
                  { id: 'cand-dev-1', first_name: 'Vikram', last_name: 'Nair', email: 'vikram@test.com', job_title: 'Go Engineer' }
                ],
                total: 1
              };
            } else if (path.startsWith('/api/v1/jobs')) {
              responsePayload = {
                items: [
                  { id: 'job-go-10', title: 'Senior Golang Developer', company_name: 'HyperScale Systems', remote_type: 'remote' }
                ],
                total: 1
              };
            } else if (path.startsWith('/api/v1/applications/for-consultancy')) {
              responsePayload = {
                items: submissionsDb,
                total: submissionsDb.length
              };
            } else if (path === '/api/v1/applications/consultancy' && method === 'POST') {
              const body = JSON.parse(bodyStr);
              const newApp = {
                id: 'app-sub-888',
                job_id: body.job_id,
                consultancy_candidate_id: body.consultancy_candidate_id,
                candidate_name: 'Vikram Nair',
                job_title: 'Senior Golang Developer',
                status: 'applied',
                matching_score: 91.5,
                created_at: new Date().toISOString()
              };
              submissionsDb.push(newApp);
              responsePayload = newApp;
            }

            const res = new EventEmitter();
            res.statusCode = statusCode;
            res.headers = { 'content-type': 'application/json' };
            if (typeof cb === 'function') cb(res);
            res.emit('data', Buffer.from(JSON.stringify(responsePayload)));
            res.emit('end');
          });
          return req;
        };
        return req;
      }
      return originalHttpRequest.call(http, urlOrOptions, maybeOptions, maybeCallback);
    };

    // 1. Submit candidate via chat turn
    const chatRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        message: 'Submit Vikram Nair for Senior Golang Developer',
        conversationId: 'sub-live-1'
      });

    assert.equal(chatRes.status, 200);
    assert.match(chatRes.body.text, /Review Candidate Submission Details/i);
    assert.match(chatRes.body.text, /Vikram Nair/);
    assert.match(chatRes.body.text, /Senior Golang Developer/);
    assert.ok(chatRes.body.action);
    assert.match(chatRes.body.action.action, /create_consulta/i);

    // 2. Confirm execution
    const confirmRes = await request(app)
      .post('/api/dynamic-api/confirm')
      .set(headers)
      .send({
        confirmationToken: chatRes.body.action.id
      });

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.status, 'success');
    assert.match(confirmRes.body.message, /Candidate submission/i);
    assert.match(confirmRes.body.message, /app-sub-888/i);
    assert.equal(submissionsDb.length, 1);
  } finally {
    http.request = originalHttpRequest;
  }
});

test('Consultancy 8: Agency organisation profile view and edit respects role distinction and rejected fields', () => {
  // 1. View profile formatting
  const profile = {
    consultancy_name: 'Apex Global Staffing',
    consultancy_type: 'staffing',
    industry_specialization: ['Fintech', 'Healthcare IT'],
    company_size: '51-200',
    headquarters_location: 'Bengaluru, India',
    website: 'https://apexstaffing.test',
    founding_year: 2018,
    candidate_pool_size: 142,
    verification_status: 'verified',
    about_company: 'Premier engineering talent staffing partner.'
  };

  const formatted = formatConsultancyProfile(profile);
  assert.match(formatted, /Apex Global Staffing/);
  assert.match(formatted, /staffing/i);
  assert.match(formatted, /Fintech, Healthcare IT/);
  assert.match(formatted, /51-200/);
  assert.match(formatted, /Bengaluru, India/);
  assert.match(formatted, /https:\/\/apexstaffing\.test/);
  assert.match(formatted, /2018/);
  assert.match(formatted, /142/);
  assert.match(formatted, /verified/);

  // 2. Intent routing checks: Org Profile vs Bench Candidate vs Job
  assert.equal(isHirePoolOrgProfileEditRequest('Update our consultancy website to https://newapex.test'), true);
  assert.equal(isHirePoolOrgProfileEditRequest('Add candidate John Doe to my bench'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('Submit candidate Priya to job'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('Show my agency dashboard'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('View my bench candidates'), false);
});

test('Consultancy 9: Consultancy dashboard displays actual metrics, preserves genuine 0s, and handles API errors', () => {
  // Genuine 0s preserved
  const genuineZeros = {
    total_candidates: 0,
    available_candidates: 0,
    active_submissions: 0,
    placements_this_month: 0,
    successful_placements: 0,
    open_quotes: 0
  };

  const formattedZeros = formatDashboardStats(genuineZeros);
  assert.match(formattedZeros, /Total Candidates \(Bench\):\*\* 0/);
  assert.match(formattedZeros, /Available Candidates:\*\* 0/);
  assert.match(formattedZeros, /Active Submissions:\*\* 0/);
  assert.match(formattedZeros, /Placements This Month:\*\* 0/);
  assert.match(formattedZeros, /Successful Placements:\*\* 0/);
  assert.match(formattedZeros, /Open Quotes:\*\* 0/);

  // Real non-zero stats
  const activeStats = {
    total_candidates: 45,
    available_candidates: 32,
    active_submissions: 18,
    placements_this_month: 3,
    successful_placements: 24,
    open_quotes: 5
  };

  const formattedStats = formatDashboardStats(activeStats);
  assert.match(formattedStats, /Total Candidates \(Bench\):\*\* 45/);
  assert.match(formattedStats, /Available Candidates:\*\* 32/);
  assert.match(formattedStats, /Active Submissions:\*\* 18/);
  assert.match(formattedStats, /Placements This Month:\*\* 3/);
  assert.match(formattedStats, /Successful Placements:\*\* 24/);
  assert.match(formattedStats, /Open Quotes:\*\* 5/);

  // Error handling
  const errorFormatted = formatDashboardStats(null);
  assert.match(errorFormatted, /Could not retrieve your consultancy dashboard statistics/i);
});

test('Consultancy 10: Submission tracking formats records cleanly, and interruption does not clobber bench draft', async () => {
  // 1. Formatter verification
  const submissions = [
    {
      candidate_name: 'Pooja Hegde',
      job_title: 'Senior Data Architect',
      company_name: 'Bankcorp India',
      status: 'shortlisted',
      matching_score: 94.2,
      offer_status: 'offer_extended',
      created_at: '2026-11-14T09:30:00.000Z'
    }
  ];

  const formatted = formatConsultancySubmissionsList(submissions);
  assert.match(formatted, /Pooja Hegde for Senior Data Architect/);
  assert.match(formatted, /Bankcorp India/);
  assert.match(formatted, /shortlisted/);
  assert.match(formatted, /94%/);
  assert.match(formatted, /offer_extended/);

  // 2. Draft Isolation test
  const session = {
    id: 'conv-iso-1',
    consultancyCandidateDraft: {
      active: true,
      stage: 'collecting',
      fields: { first_name: 'Karan', last_name: 'Mehra', email: 'karan@test.com' },
      pendingField: 'job_title'
    }
  };
  const authUser = { role: 'consultancy', email: 'agency@apex.test' };

  // Interruption query: user asks about dashboard
  assert.equal(isHirePoolAgencyCandidateAddIntent('Show my agency dashboard', session, authUser), false);
  // Draft still retained in session!
  assert.equal(session.consultancyCandidateDraft.fields.first_name, 'Karan');

  // Resumption: user provides job title
  const resumedTurn = await handleHirePoolAgencyCandidateAddTurn({
    message: 'Job title: Site Reliability Engineer, Location: Pune, India',
    session,
    authUser
  });

  assert.equal(resumedTurn.handled, true);
  assert.match(resumedTurn.text, /Review Candidate Bench Details/i);
  assert.match(resumedTurn.text, /Karan Mehra/);
  assert.match(resumedTurn.text, /Site Reliability Engineer/);
});

test('Consultancy 11: Regression - "My candidates" and "Give the list of candidates" classify in scope and match candidate bench listing', async () => {
  const authUser = { role: 'consultancy', id: 'user-c-1' };
  const session = { id: 'conv-c-1' };

  // Classification checks: MUST NOT be classified as AMBIGUOUS
  const c1 = classifyHirePoolMessage('My candidates', session, { authUser });
  assert.equal(c1.category, 'HIREPOOL_IN_SCOPE');

  const c2 = classifyHirePoolMessage('Give the list of candidates', session, { authUser });
  assert.equal(c2.category, 'HIREPOOL_IN_SCOPE');

  const c3 = classifyHirePoolMessage('Add a new candidate', session, { authUser });
  assert.equal(c3.category, 'HIREPOOL_IN_SCOPE');
});

test('Consultancy 12: Regression - "Add a new candidate", comma-separated details, and affirming with "add"', async () => {
  const authUser = { role: 'consultancy', id: 'user-c-1' };
  const session = { id: 'conv-c-add-1' };

  // 1. "Add a new candidate" recognized as intent
  assert.equal(isHirePoolAgencyCandidateAddIntent('Add a new candidate', session, authUser), true);

  // 2. Unlabeled candidate details parsed properly
  const fields = extractCandidateFields('name: adarsh, software engineer, bengaluru, adarsgh@gmail.com');
  assert.equal(fields.first_name, 'adarsh');
  assert.equal(fields.job_title, 'software engineer');
  assert.equal(fields.email, 'adarsgh@gmail.com');
  assert.match(fields.current_location, /Bengaluru/i);

  // 3. Initiate workflow with details missing last name
  const turn1 = await handleHirePoolAgencyCandidateAddTurn({
    message: 'name: adarsh, software engineer, bengaluru, adarsgh@gmail.com',
    session,
    authUser
  });
  assert.equal(turn1.handled, true);
  assert.match(turn1.text, /adarsh/);
  assert.match(turn1.text, /adarsgh@gmail\.com/);
  assert.match(turn1.text, /Last name/i);
  assert.equal(session.consultancyCandidateDraft.active, true);
  assert.equal(session.consultancyCandidateDraft.pendingField, 'last_name');

  // 4. User provides last name
  let stagedConfirmation = null;
  const stageMock = async ({ body }) => {
    stagedConfirmation = body;
    return {
      hostAction: {
        id: 'confirm-token-mock-12345678901234567890123456789012345',
        action: 'add_candidate_api_v1_consultancies_candidates_post',
        confirmationToken: 'confirm-token-mock-12345678901234567890123456789012345'
      }
    };
  };

  const turn2 = await handleHirePoolAgencyCandidateAddTurn({
    message: 'Sharma',
    session,
    authUser,
    stageCandidateAddConfirmation: stageMock
  });
  assert.equal(turn2.handled, true);
  assert.match(turn2.text, /Review Candidate Bench Details/i);
  assert.match(turn2.text, /adarsh Sharma/i);
  assert.equal(session.consultancyCandidateDraft.stage, 'awaiting_confirmation');
  assert.ok(stagedConfirmation);
  assert.equal(stagedConfirmation.first_name, 'adarsh');
  assert.equal(stagedConfirmation.last_name, 'Sharma');

  // 5. User types "add" at confirmation stage
  const turn3 = await handleHirePoolAgencyCandidateAddTurn({
    message: 'add',
    session,
    authUser
  });
  assert.equal(turn3.handled, true);
  assert.match(turn3.text, /Confirm & Execute/i);
  assert.ok(turn3.hostAction);
});
