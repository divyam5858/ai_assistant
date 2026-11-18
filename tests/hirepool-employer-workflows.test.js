/**
 * Dedicated End-to-End Tests for HirePool Employer / Company Chatbot Workflows
 * Tests:
 * 1. Employer company & personal profile editing and retrieval (/clients/profile & /clients/me)
 * 2. Employer job creation (single-turn, multi-turn, add the job confirmation, cancellation)
 * 3. Employer job listing (GET /api/v1/jobs/my-jobs via get_my_jobs_api_v1_jobs_my_jobs_get)
 * 4. Employer application listing & management (GET /api/v1/applications/for-client)
 * 5. Employer dashboard statistics (GET /api/v1/clients/dashboard)
 * 6. Intent routing & preventing irrelevant Company Profile responses on non-profile queries
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

const app = createApp();
import {
  formatClientApplicationsList,
  formatClientDashboardStats,
  formatJobsList
} from '../backend/src/routes/chat.js';
import {
  extractJobFields,
  isHirePoolJobCreateIntent
} from '../integrations/hirepool/job-create.js';
import {
  isHirePoolOrgProfileEditRequest
} from '../integrations/hirepool/org-profile-edit.js';

const HIREPOOL_LOCAL_EXTENSION_ORIGIN = 'chrome-extension://local-hirepool-extension';

function setupClientSession(orgRole = 'admin') {
  const session = storeHirePoolSession('client-employer-token', {
    id: 'employer-user-1',
    email: 'employer@acme.test',
    userType: 'client',
    organizationRole: orgRole
  });
  return session;
}

test('Employer Workflow 1: formatJobsList formats active jobs and empty jobs correctly', () => {
  const empty = formatJobsList([]);
  assert.match(empty, /No jobs were found/i);

  const jobs = [
    {
      title: 'Senior Node.js Developer',
      company_name: 'Acme Corp',
      department: 'Engineering',
      locations: ['Bengaluru'],
      remote_type: 'hybrid',
      employment_type: 'permanent',
      salary_min: 2000000,
      salary_max: 3000000,
      salary_currency: 'INR',
      status: 'active',
      number_of_openings: 2
    }
  ];
  const formatted = formatJobsList(jobs);
  assert.match(formatted, /Senior Node\.js Developer/);
  assert.match(formatted, /Acme Corp/);
  assert.match(formatted, /Bengaluru/);
  assert.match(formatted, /hybrid/i);
  assert.match(formatted, /permanent/i);
  assert.match(formatted, /2,000,000/);
});

test('Employer Workflow 2: formatClientApplicationsList formats applicant details & review link', () => {
  const empty = formatClientApplicationsList([]);
  assert.match(empty, /No candidate applications have been received/i);
  assert.match(empty, /http:\/\/localhost:5173\/client\/applications/);

  const applications = [
    {
      candidate_name: 'Arjun Kumar',
      job_title: 'Full Stack Engineer',
      status: 'shortlisted',
      matching_score: 92.4,
      candidate_location: 'Bengaluru',
      candidate_skills: ['Node.js', 'React', 'PostgreSQL'],
      created_at: '2026-11-10T10:00:00.000Z'
    }
  ];
  const formatted = formatClientApplicationsList(applications);
  assert.match(formatted, /Arjun Kumar/);
  assert.match(formatted, /Full Stack Engineer/);
  assert.match(formatted, /Shortlisted/);
  assert.match(formatted, /92%/);
  assert.match(formatted, /Bengaluru/);
  assert.match(formatted, /Node\.js/);
  assert.match(formatted, /http:\/\/localhost:5173\/client\/applications/);
});

test('Employer Workflow 3: formatClientDashboardStats formats Overview, Awaiting Action & Hiring Pipeline', () => {
  const stats = {
    total_jobs: 5,
    active_jobs: 3,
    total_applications: 42,
    pending_review: 12,
    shortlisted: 6,
    hired: 2,
    pending_budget_requests: 1,
    recent_applications: [
      {
        candidate_name: 'Priya Sharma',
        job_title: 'Backend Engineer',
        status: 'applied',
        matching_score: 88
      }
    ]
  };
  const formatted = formatClientDashboardStats(stats);
  assert.match(formatted, /### Dashboard Overview/);
  assert.match(formatted, /- \*\*Active Jobs:\*\* 3/);
  assert.match(formatted, /- \*\*Total Applications:\*\* 42/);
  assert.match(formatted, /- \*\*Pending Review:\*\* 12/);
  assert.match(formatted, /### Awaiting Your Action/);
  assert.match(formatted, /- \*\*Shortlisted Candidates:\*\* 6/);
  assert.match(formatted, /\[Review Applications\]\(http:\/\/localhost:5173\/client\/applications\)/);
  assert.match(formatted, /### Hiring Pipeline/);
  assert.match(formatted, /- \*\*Applied:\*\* 42/);
  assert.match(formatted, /- \*\*In Review:\*\* 12/);
  assert.match(formatted, /- \*\*Shortlisted:\*\* 6/);
  assert.match(formatted, /- \*\*Hired:\*\* 2/);
  assert.match(formatted, /Priya Sharma/);
});

test('Employer Workflow 4: Intent routing gates profile edit and excludes jobs/apps/stats', () => {
  // Queries that must NOT trigger profile edit
  assert.equal(isHirePoolOrgProfileEditRequest('View my jobs'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('Show my jobs'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('My jobs'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('Create a job'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('Post a job'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('Add a job'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('List applications'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('View applications'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('Show applicants'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('Dashboard stats'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('View dashboard'), false);
  assert.equal(isHirePoolOrgProfileEditRequest('What is the hiring pipeline?'), false);

  // Queries that SHOULD trigger profile edit
  assert.equal(isHirePoolOrgProfileEditRequest('Edit my profile'), true);
  assert.equal(isHirePoolOrgProfileEditRequest('Update company profile'), true);
  assert.equal(isHirePoolOrgProfileEditRequest('Add phone number'), true);
  assert.equal(isHirePoolOrgProfileEditRequest('Update my phone number'), true);
  assert.equal(isHirePoolOrgProfileEditRequest('Change designation'), true);
  assert.equal(isHirePoolOrgProfileEditRequest('Update company size'), true);
  assert.equal(isHirePoolOrgProfileEditRequest('phone: 9876543210'), true);
});

test('Employer Workflow 5: Job creation intent detector & field extractor', () => {
  assert.equal(isHirePoolJobCreateIntent('Create a job'), true);
  assert.equal(isHirePoolJobCreateIntent('Post a job'), true);
  assert.equal(isHirePoolJobCreateIntent('I want to post a new job'), true);
  assert.equal(isHirePoolJobCreateIntent('Add a job'), true);
  assert.equal(isHirePoolJobCreateIntent('View my jobs'), false);
  assert.equal(isHirePoolJobCreateIntent('Show jobs'), false);

  const extracted = extractJobFields(`
    Title: Senior Python Engineer
    Description: We are looking for an experienced Python developer to build robust APIs and maintain database pipelines.
    Work type: Hybrid
    Location: Bengaluru
    Employment type: Permanent
    Experience: Senior
    Salary: 25-35 LPA
    Skills: Python, FastAPI, PostgreSQL
    Openings: 3
  `);
  assert.equal(extracted.title, 'Senior Python Engineer');
  assert.ok(extracted.description.length >= 30);
  assert.equal(extracted.remote_type, 'hybrid');
  assert.equal(extracted.employment_type, 'permanent');
  assert.equal(extracted.experience_level, 'senior');
  assert.equal(extracted.locations[0], 'Bengaluru');
  assert.equal(extracted.salary, '25-35 LPA');
  assert.ok(extracted.required_skills.includes('Python'));
  assert.equal(extracted.number_of_openings, 3);
});

test('Employer Workflow 6: Live API chat routing for client jobs, applications, dashboard, and profile', async () => {
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

  const session = setupClientSession('admin');
  const headers = {
    Authorization: `Bearer ${session.credential}`,
    Origin: HIREPOOL_LOCAL_EXTENSION_ORIGIN,
    'Content-Type': 'application/json'
  };

  const origFetch = globalThis.fetch;
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

            if (path === '/api/openapi.json') {
              responsePayload = openapiFixture;
            } else if (path.startsWith('/api/v1/jobs/my-jobs')) {
              responsePayload = {
                items: [
                  {
                    id: 'job-101',
                    title: 'Staff Backend Engineer',
                    company_name: 'Acme Corp',
                    department: 'Core Platform',
                    locations: ['Bengaluru'],
                    remote_type: 'hybrid',
                    employment_type: 'permanent',
                    salary_min: 3500000,
                    salary_max: 4500000,
                    salary_currency: 'INR',
                    status: 'active',
                    number_of_openings: 1
                  }
                ],
                total: 1,
                page: 1,
                page_size: 20
              };
            } else if (path.startsWith('/api/v1/applications/for-client')) {
              responsePayload = {
                items: [
                  {
                    id: 'app-501',
                    job_id: 'job-101',
                    candidate_name: 'Rohan Verma',
                    job_title: 'Staff Backend Engineer',
                    status: 'shortlisted',
                    matching_score: 95.0,
                    candidate_location: 'Bengaluru',
                    candidate_skills: ['Go', 'Kubernetes', 'PostgreSQL'],
                    created_at: '2026-11-12T08:00:00.000Z'
                  }
                ],
                total: 1,
                page: 1,
                page_size: 50
              };
            } else if (path === '/api/v1/clients/dashboard') {
              responsePayload = {
                total_jobs: 4,
                active_jobs: 2,
                total_applications: 18,
                pending_review: 5,
                shortlisted: 3,
                hired: 1,
                pending_budget_requests: 0,
                recent_applications: []
              };
            } else if (path === '/api/v1/clients/profile') {
              responsePayload = {
                id: 'client-1',
                company_name: 'Acme Corp',
                industry: 'Software',
                company_size: '51-200',
                headquarters_location: 'Bengaluru',
                company_website: 'https://acme.test',
                about_company: 'Building developer tools.',
                founding_year: 2020,
                is_active: true
              };
            } else if (path === '/api/v1/clients/me') {
              responsePayload = {
                id: 'user-member-1',
                user_id: 'employer-user-1',
                full_name: 'Vikram Mehta',
                email: 'employer@acme.test',
                designation: 'Director of Engineering',
                phone: '9876543210',
                role: 'admin',
                is_primary: true
              };
            } else if (path === '/api/v1/jobs' && parsedOptions.method === 'POST') {
              const body = bodyStr ? JSON.parse(bodyStr) : {};
              responsePayload = {
                id: 'new-job-999',
                title: body.title || 'Senior DevOps Engineer',
                status: 'active'
              };
            }

            const incoming = new EventEmitter();
            incoming.statusCode = statusCode;
            incoming.headers = { 'content-type': 'application/json' };
            incoming.destroy = () => incoming;
            incoming.resume = () => incoming;
            incoming.pause = () => incoming;
            cb?.(incoming);
            const buf = Buffer.from(JSON.stringify(responsePayload));
            incoming.emit('data', buf);
            incoming.emit('end');
          });
        };
        return req;
      }
      return originalHttpRequest.call(http, urlOrOptions, maybeOptions, maybeCallback);
    };

    globalThis.fetch = async (url, opts = {}) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      const pathname = typeof url === 'string' ? new URL(url).pathname : url.pathname;

      if (pathname === '/api/openapi.json') {
        return new Response(JSON.stringify(openapiFixture), { headers: { 'Content-Type': 'application/json' } });
      }

      if (pathname.startsWith('/api/v1/jobs/my-jobs')) {
        return new Response(JSON.stringify({
          items: [
            {
              id: 'job-101',
              title: 'Staff Backend Engineer',
              company_name: 'Acme Corp',
              department: 'Core Platform',
              locations: ['Bengaluru'],
              remote_type: 'hybrid',
              employment_type: 'permanent',
              salary_min: 3500000,
              salary_max: 4500000,
              salary_currency: 'INR',
              status: 'active',
              number_of_openings: 1
            }
          ],
          total: 1,
          page: 1,
          page_size: 20
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (pathname === '/api/v1/applications/for-client') {
        return new Response(JSON.stringify({
          items: [
            {
              id: 'app-501',
              job_id: 'job-101',
              candidate_name: 'Rohan Verma',
              job_title: 'Staff Backend Engineer',
              status: 'shortlisted',
              matching_score: 95.0,
              candidate_location: 'Bengaluru',
              candidate_skills: ['Go', 'Kubernetes', 'PostgreSQL'],
              created_at: '2026-11-12T08:00:00.000Z'
            }
          ],
          total: 1,
          page: 1,
          page_size: 50
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (pathname === '/api/v1/clients/dashboard') {
        return new Response(JSON.stringify({
          total_jobs: 4,
          active_jobs: 2,
          total_applications: 18,
          pending_review: 5,
          shortlisted: 3,
          hired: 1,
          pending_budget_requests: 0,
          recent_applications: []
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (pathname === '/api/v1/clients/profile') {
        return new Response(JSON.stringify({
          id: 'client-1',
          company_name: 'Acme Corp',
          industry: 'Software',
          company_size: '51-200',
          headquarters_location: 'Bengaluru',
          company_website: 'https://acme.test',
          about_company: 'Building developer tools.',
          founding_year: 2020,
          is_active: true
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      if (pathname === '/api/v1/clients/me') {
        return new Response(JSON.stringify({
          id: 'user-member-1',
          user_id: 'employer-user-1',
          full_name: 'Vikram Mehta',
          email: 'employer@acme.test',
          designation: 'Director of Engineering',
          phone: '9876543210',
          role: 'admin',
          is_primary: true
        }), { headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
    };

    // 1. "View my jobs" -> returns jobs list, NOT company profile
    const jobsRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-jobs-conv',
        message: 'View my jobs'
      });
    if (jobsRes.status !== 200) {
      console.log('JOBS RES ERROR:', jobsRes.status, jobsRes.body);
    }
    assert.equal(jobsRes.status, 200);
    assert.match(jobsRes.body.text, /Staff Backend Engineer/);
    assert.match(jobsRes.body.text, /Acme Corp/);
    assert.doesNotMatch(jobsRes.body.text, /## Company Profile Details/);

    // 2. "List applications" -> returns applications list, NOT company profile
    const appsRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-apps-conv',
        message: 'List applications'
      });
    assert.equal(appsRes.status, 200);
    assert.match(appsRes.body.text, /Rohan Verma/);
    assert.match(appsRes.body.text, /Staff Backend Engineer/);
    assert.match(appsRes.body.text, /http:\/\/localhost:5173\/client\/applications/);
    assert.doesNotMatch(appsRes.body.text, /## Company Profile Details/);

    // 3. "Dashboard stats" -> returns dashboard statistics, NOT company profile
    const dashRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-dash-conv',
        message: 'Dashboard stats'
      });
    assert.equal(dashRes.status, 200);
    assert.match(dashRes.body.text, /Employer Dashboard Statistics/);
    assert.match(dashRes.body.text, /Active Jobs/);
    assert.match(dashRes.body.text, /Total Applications/);
    assert.match(dashRes.body.text, /http:\/\/localhost:5173\/client\/applications/);
    assert.doesNotMatch(dashRes.body.text, /## Company Profile Details/);

    // 4. "Create a job" -> starts job creation workflow, NOT company profile
    const createJobRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-create-job-conv',
        message: 'Create a job'
      });
    assert.equal(createJobRes.status, 200);
    assert.match(createJobRes.body.text, /create and publish a new job on HirePool/i);
    assert.doesNotMatch(createJobRes.body.text, /## Company Profile Details/);

    // 5. Job creation multi-turn: provide title + description -> "Add the job" stages confirmation
    const turn2Res = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-create-job-conv',
        message: 'Title: Senior DevOps Engineer. Description: We need an engineer to maintain Kubernetes clusters and CI/CD pipelines across AWS infrastructure.'
      });
    assert.equal(turn2Res.status, 200);

    const turn3Res = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-create-job-conv',
        message: 'Add the job'
      });
    assert.equal(turn3Res.status, 200);
    assert.ok(turn3Res.body.action, 'Should include hostAction for confirmation');
    assert.equal(turn3Res.body.action.requiresConfirmation, true);
    assert.ok(turn3Res.body.action.confirmationToken);

    // 6. Profile Editing: "Add phone number 9876543210" -> stages update for /clients/me
    const phoneRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-phone-conv',
        message: 'Add phone number 9876543210'
      });
    assert.equal(phoneRes.status, 200);
    assert.ok(phoneRes.body.action, 'Should stage profile update confirmation');
    assert.match(phoneRes.body.action.action, /update_my_user/);
    assert.equal(phoneRes.body.action.parameters.body.phone, '9876543210');
  } finally {
    globalThis.fetch = origFetch;
    http.request = originalHttpRequest;
  }
});

test('Employer Workflow 7: Visitor onboarding for recruiters and Employer signup routing', async () => {
  const headers = {
    Origin: HIREPOOL_LOCAL_EXTENSION_ORIGIN,
    'Content-Type': 'application/json'
  };

  // 1. "I'm new here" -> friendly welcome, no lockout
  const welcomeRes = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-onboarding-conv',
      message: "I'm new here"
    });
  assert.equal(welcomeRes.status, 200);
  assert.doesNotMatch(welcomeRes.body.text, /can't verify a HirePool login/i);

  // 2. "I'm here for recruiting." -> explains verified hiring capabilities, distinguishes Employer vs Consultancy
  const recruitRes = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-onboarding-conv',
      message: "I'm here for recruiting."
    });
  assert.equal(recruitRes.status, 200);
  assert.match(recruitRes.body.text, /Employer \/ Company/i);
  assert.match(recruitRes.body.text, /Recruitment Consultancy/i);
  assert.doesNotMatch(recruitRes.body.text, /free trial|unlimited postings/i);

  // 3. "I'm hiring for my company." -> sets role to client, provides company hiring guidance
  const companyRes = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-onboarding-conv',
      message: "I'm hiring for my company."
    });
  assert.equal(companyRes.status, 200);
  assert.match(companyRes.body.text, /Employer \/ Company account/i);

  // 4. "I need to signup." -> offers hirepool_signup for client role
  const signupRes = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-onboarding-conv',
      message: 'I need to signup.'
    });
  assert.equal(signupRes.status, 200);
  assert.ok(signupRes.body.action, 'Should include signup action');
  assert.equal(signupRes.body.action.action, 'hirepool_signup');
  assert.equal(signupRes.body.action.parameters?.role, 'client');
  assert.match(signupRes.body.text, /client/i);

  // 5. Unverified login claim ("I'm logged in") does not produce a false success claim
  const claimRes = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-unverified-conv',
      message: "I'm logged in"
    });
  assert.equal(claimRes.status, 200);
  assert.match(claimRes.body.text, /verify your HirePool session/i);
  assert.doesNotMatch(claimRes.body.text, /login succeeded/i);
});

test('Employer Workflow 8: Hyphen field extraction, 5 openings, prompt only for missing fields, review & confirm', async () => {
  const session = setupClientSession('admin');
  const headers = {
    Authorization: `Bearer ${session.credential}`,
    Origin: HIREPOOL_LOCAL_EXTENSION_ORIGIN,
    'Content-Type': 'application/json'
  };

  // 1. Hyphen-separated input with 7 fields supplied
  const input1 = 'Job Title - Full Stack Developer. Work Type - Remote. Employment Type - Permanent. Location - Bengaluru. Experience Level - Entry. Salary Range - 15-25 LPA INR. Required Skills - JavaScript, React, Node.js.';
  const fields = extractJobFields(input1);
  assert.equal(fields.title, 'Full Stack Developer');
  assert.equal(fields.remote_type, 'remote');
  assert.equal(fields.employment_type, 'permanent');
  assert.equal(fields.locations[0], 'Bengaluru');
  assert.equal(fields.experience_level, 'entry');
  assert.equal(fields.salary, '15-25 LPA INR');
  assert.deepEqual(fields.required_skills, ['JavaScript', 'React', 'Node.js']);

  // 2. Chat turn with these 7 fields -> captures all 7 and prompts ONLY for missing required Description
  const turn1Res = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-hyphen-job-conv',
      message: input1
    });
  assert.equal(turn1Res.status, 200);
  assert.match(turn1Res.body.text, /Full Stack Developer/);
  assert.match(turn1Res.body.text, /Remote/);
  assert.match(turn1Res.body.text, /Permanent/);
  assert.match(turn1Res.body.text, /Bengaluru/);
  assert.match(turn1Res.body.text, /Entry/);
  assert.match(turn1Res.body.text, /15-25 LPA INR/);
  assert.match(turn1Res.body.text, /JavaScript, React, Node\.js/);
  assert.match(turn1Res.body.text, /Job Description/i);
  // Must NOT prompt again for fields already supplied
  assert.doesNotMatch(turn1Res.body.text, /You can also include:\s*- \*\*Work Type\*\*/i);

  // 3. User provides the missing description -> stages confirmation with all 9 fields in review
  const turn2Res = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-hyphen-job-conv',
      message: 'Job Description: We are looking for an experienced Full Stack Developer to build robust scalable web applications with React and Node.js.'
    });
  assert.equal(turn2Res.status, 200);
  assert.ok(turn2Res.body.action, 'Should include hostAction for confirmation');
  assert.equal(turn2Res.body.action.requiresConfirmation, true);
  assert.ok(turn2Res.body.action.confirmationToken);
  // Verify review details contain the 9 specified fields
  assert.match(turn2Res.body.text, /Job Title/);
  assert.match(turn2Res.body.text, /Job Description/);
  assert.match(turn2Res.body.text, /Number of Openings/);
  assert.match(turn2Res.body.text, /Work Mode/);
  assert.match(turn2Res.body.text, /Employment Type/);
  assert.match(turn2Res.body.text, /Location/);
  assert.match(turn2Res.body.text, /Experience Level/);
  assert.match(turn2Res.body.text, /Salary Range/);
  assert.match(turn2Res.body.text, /Required Skills/);
  assert.match(turn2Res.body.text, /Confirm & Execute/i);

  // 4. User cancels job creation -> cancels and clears pending job creation state
  const cancelRes = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-hyphen-job-conv',
      message: 'Cancel job creation'
    });
  assert.equal(cancelRes.status, 200);
  assert.match(cancelRes.body.text, /cancelled the job creation/i);

  // 5. Separate requirement: "I have a job requirement for 5 candidates for the role Software Engineer. I need to post a job."
  const openingsFields = extractJobFields('I have a job requirement for 5 candidates for the role Software Engineer. I need to post a job.');
  assert.equal(openingsFields.title, 'Software Engineer');
  assert.equal(openingsFields.number_of_openings, 5);

  const openingsRes = await request(app)
    .post('/api/chat')
    .set(headers)
    .send({
      assistantId: 'hirepool',
      stream: false,
      conversationId: 'employer-openings-conv',
      message: 'I have a job requirement for 5 candidates for the role Software Engineer. I need to post a job.'
    });
  assert.equal(openingsRes.status, 200);
  assert.match(openingsRes.body.text, /Software Engineer/);
  assert.match(openingsRes.body.text, /Openings:\*\* 5/);
});

test('Employer Workflow 9: Company profile retrieval, multi-field editing & role distinction', async () => {
  const session = setupClientSession('admin');
  const headers = {
    Authorization: `Bearer ${session.credential}`,
    Origin: HIREPOOL_LOCAL_EXTENSION_ORIGIN,
    'Content-Type': 'application/json'
  };

  const origFetch = globalThis.fetch;
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
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          return true;
        };
        req.setTimeout = () => req;
        req.destroy = () => req;
        req.abort = () => req;
        req.end = () => {
          queueMicrotask(() => {
            let statusCode = 200;
            let responsePayload = {};
            const path = parsedOptions.path || '/';

            if (path === '/api/openapi.json') {
              responsePayload = openapiFixture;
            } else if (path === '/api/v1/clients/profile') {
              responsePayload = {
                id: 'client-1',
                company_name: 'Acme Corp',
                industry: 'Software',
                company_size: '51-200',
                headquarters_location: 'Bengaluru',
                company_website: 'https://acme.test',
                about_company: 'Building developer tools.',
                founding_year: 2020,
                is_active: true
              };
            } else if (path === '/api/v1/clients/me') {
              responsePayload = {
                id: 'user-member-1',
                user_id: 'employer-user-1',
                full_name: 'Vikram Mehta',
                email: 'employer@acme.test',
                designation: 'Director of Engineering',
                phone: '9876543210',
                role: 'admin',
                is_primary: true
              };
            }

            const incoming = new EventEmitter();
            incoming.statusCode = statusCode;
            incoming.headers = { 'content-type': 'application/json' };
            incoming.destroy = () => incoming;
            incoming.resume = () => incoming;
            incoming.pause = () => incoming;
            cb?.(incoming);
            incoming.emit('data', Buffer.from(JSON.stringify(responsePayload)));
            incoming.emit('end');
          });
        };
        return req;
      }
      return originalHttpRequest.call(http, urlOrOptions, maybeOptions, maybeCallback);
    };

    globalThis.fetch = async (url) => {
      const pathname = typeof url === 'string' ? new URL(url).pathname : url.pathname;
      if (pathname === '/api/openapi.json') {
        return new Response(JSON.stringify(openapiFixture), { headers: { 'Content-Type': 'application/json' } });
      }
      if (pathname === '/api/v1/clients/profile') {
        return new Response(JSON.stringify({
          id: 'client-1',
          company_name: 'Acme Corp',
          industry: 'Software',
          company_size: '51-200',
          headquarters_location: 'Bengaluru',
          company_website: 'https://acme.test',
          about_company: 'Building developer tools.',
          founding_year: 2020,
          is_active: true
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (pathname === '/api/v1/clients/me') {
        return new Response(JSON.stringify({
          id: 'user-member-1',
          user_id: 'employer-user-1',
          full_name: 'Vikram Mehta',
          email: 'employer@acme.test',
          designation: 'Director of Engineering',
          phone: '9876543210',
          role: 'admin',
          is_primary: true
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
    };

    // 1. "Update company details" -> retrieves existing profile and prompts with current overview
    const overviewRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-profile-edit-conv',
        message: 'Update company details'
      });
    assert.equal(overviewRes.status, 200);
    assert.match(overviewRes.body.text, /Acme Corp/);
    assert.match(overviewRes.body.text, /Software/);
    assert.match(overviewRes.body.text, /51-200/);
    assert.match(overviewRes.body.text, /Bengaluru/);
    assert.match(overviewRes.body.text, /Tell me what you would like to update/);

    // 2. "Change company name to Acme Innovations and update headquarters to Mumbai, India" -> stages update for /clients/profile
    const editRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-profile-edit-conv',
        message: 'Change company name to Acme Innovations and update headquarters to Mumbai, India'
      });
    assert.equal(editRes.status, 200);
    assert.ok(editRes.body.action, 'Should include confirmation action for company profile update');
    assert.match(editRes.body.action.action, /update_company/);
    assert.equal(editRes.body.action.parameters.body.company_name, 'Acme Innovations');
    assert.equal(editRes.body.action.parameters.body.headquarters_location, 'Mumbai, India');

    // 3. "Change company size to 201-500" -> stages company size update
    const sizeRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-profile-size-conv',
        message: 'Change company size to 201-500'
      });
    assert.equal(sizeRes.status, 200);
    assert.ok(sizeRes.body.action);
    assert.equal(sizeRes.body.action.parameters.body.company_size, '201-500');

    // 4. "Update my designation to VP of Talent" -> targets personal profile (/clients/me), NOT company profile
    const meRes = await request(app)
      .post('/api/chat')
      .set(headers)
      .send({
        assistantId: 'hirepool',
        stream: false,
        conversationId: 'employer-profile-me-conv',
        message: 'Update my designation to VP of Talent'
      });
    assert.equal(meRes.status, 200);
    assert.ok(meRes.body.action);
    assert.match(meRes.body.action.action, /update_my_user/);
    assert.equal(meRes.body.action.parameters.body.designation, 'VP of Talent');
  } finally {
    globalThis.fetch = origFetch;
    http.request = originalHttpRequest;
  }
});

test('Employer Workflow 10: Dashboard stats zero values vs API errors & job listing distinction', () => {
  // 1. Genuine zero values in stats
  const genuineZeroStats = {
    total_jobs: 0,
    active_jobs: 0,
    total_applications: 0,
    pending_review: 0,
    shortlisted: 0,
    hired: 0
  };
  const zeroFormatted = formatClientDashboardStats(genuineZeroStats);
  assert.match(zeroFormatted, /- \*\*Active Jobs:\*\* 0/);
  assert.match(zeroFormatted, /- \*\*Total Applications:\*\* 0/);
  assert.match(zeroFormatted, /- \*\*Pending Review:\*\* 0/);
  assert.match(zeroFormatted, /- \*\*Total Jobs Posted:\*\* 0/);
  assert.match(zeroFormatted, /- \*\*Shortlisted Candidates:\*\* 0/);
  assert.match(zeroFormatted, /- \*\*Hired:\*\* 0/);

  // 2. API error in stats produces error notice, NOT fake zeroes
  const errorStats = { error: true };
  const errFormatted = formatClientDashboardStats(errorStats);
  assert.match(errFormatted, /Could not retrieve Employer dashboard statistics/i);
  assert.doesNotMatch(errFormatted, /- \*\*Active Jobs:\*\* 0/);

  // 3. Null / invalid stats produces clear error
  assert.match(formatClientDashboardStats(null), /Could not retrieve Employer dashboard statistics/i);

  // 4. Empty jobs list [] produces clean empty message
  const emptyJobs = formatJobsList([]);
  assert.match(emptyJobs, /No jobs were found in HirePool for your account/i);

  // 5. Error in jobs produces clear retrieval error, NOT "No jobs found"
  const errJobs = formatJobsList({ error: true });
  assert.match(errJobs, /Could not retrieve your jobs/i);
  assert.doesNotMatch(errJobs, /No jobs were found in HirePool for your account/i);
});
