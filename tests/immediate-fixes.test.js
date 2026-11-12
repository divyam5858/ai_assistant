import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJobCreation,
  validateCandidateCreation,
  normalizeSalary,
  normalizeDate,
  HIREPOOL_WORK_TYPES,
  HIREPOOL_EMPLOYMENT_TYPES,
  HIREPOOL_EXPERIENCE_LEVELS,
  HIREPOOL_PAY_PERIODS
} from '../backend/src/dynamic-api/schemas/hirepool-schemas.js';
import {
  buildProviderMessages,
  summarizeEarlierHistory,
  MAX_PROVIDER_HISTORY_ITEMS
} from '../backend/src/history-manager.js';
import {
  storeHirePoolSession,
  findHirePoolContextBySdkCredential,
  touchHirePoolSession,
  isTokenExpired,
  getHirePoolSessionTtlMs,
  updateHirePoolSessionTokens
} from '../backend/src/local-integrations/hirepool-session-store.js';
import {
  formatHirePoolReadResults,
  formatJobsList,
  formatCandidatesList,
  formatCompanyProfile,
  formatConsultancyProfile,
  formatDashboardStats,
  formatGeneralReadResults,
  finalizeHirePoolResponse
} from '../backend/src/routes/chat.js';
import { ChatRequestSchema } from '../config/schemas.js';

test('Schema-Driven Validation: Work Type vs Employment Type separation', () => {
  // Reject work type passed as employment type
  const invalidEmp = validateJobCreation({
    title: 'Full Stack Engineer',
    description: 'A comprehensive full stack engineering role with modern technologies.',
    employment_type: 'hybrid' // INVALID: hybrid is work type, not employment type!
  });
  assert.equal(invalidEmp.isValid, false);
  assert.ok(invalidEmp.fieldErrors.employment_type);
  assert.ok(invalidEmp.fieldErrors.employment_type.includes('Permanent or Contract'));
  assert.ok(invalidEmp.guidanceMessage.includes('Permanent'));

  // Accept valid employment type
  const validPerm = validateJobCreation({
    title: 'Full Stack Engineer',
    description: 'A comprehensive full stack engineering role with modern technologies.',
    employment_type: 'permanent',
    remote_type: 'hybrid'
  });
  assert.equal(validPerm.isValid, true);
  assert.equal(validPerm.normalized.employment_type, 'permanent');
  assert.equal(validPerm.normalized.remote_type, 'hybrid');

  const validContract = validateJobCreation({
    title: 'Full Stack Engineer',
    description: 'A comprehensive full stack engineering role with modern technologies.',
    employment_type: 'contract',
    remote_type: 'remote'
  });
  assert.equal(validContract.isValid, true);
  assert.equal(validContract.normalized.employment_type, 'contract');
  assert.equal(validContract.normalized.remote_type, 'remote');
});

test('Schema-Driven Validation: Pay Period & Salary Normalization', () => {
  // 3-5 LPA string normalization
  const lpa = normalizeSalary('3-5 LPA');
  assert.deepEqual(lpa, {
    salary_min: 300000,
    salary_max: 500000,
    salary_currency: 'INR',
    pay_period: 'year'
  });

  // Object normalization with alias
  const obj = normalizeSalary({
    salary_min: '300000',
    salary_max: '500000',
    pay_period: 'yearly'
  });
  assert.equal(obj.salary_min, 300000);
  assert.equal(obj.salary_max, 500000);
  assert.equal(obj.pay_period, 'year');

  // Job creation with LPA salary
  const jobWithLpa = validateJobCreation({
    title: 'Frontend Developer',
    description: 'Building high quality user interfaces with React and TypeScript.',
    salary: '6-8 LPA',
    remote_type: 'remote',
    employment_type: 'permanent'
  });
  assert.equal(jobWithLpa.isValid, true);
  assert.equal(jobWithLpa.normalized.salary_min, 600000);
  assert.equal(jobWithLpa.normalized.salary_max, 800000);
  assert.equal(jobWithLpa.normalized.pay_period, 'year');
});

test('Schema-Driven Validation: Date formatting & Candidate validation', () => {
  assert.equal(normalizeDate('2026-12-15'), '2026-12-15');
  assert.equal(normalizeDate('invalid-date'), null);

  // Missing required candidate fields
  const missingCand = validateCandidateCreation({
    first_name: 'Priya'
    // missing last_name, email, current_location, job_title
  });
  assert.equal(missingCand.isValid, false);
  assert.ok(missingCand.missingFields.includes('last_name'));
  assert.ok(missingCand.missingFields.includes('email'));
  assert.ok(missingCand.missingFields.includes('current_location'));
  assert.ok(missingCand.missingFields.includes('job_title'));

  // Valid candidate
  const validCand = validateCandidateCreation({
    first_name: 'Priya',
    last_name: 'Nair',
    email: 'priya.nair@example.com',
    current_location: 'Bengaluru, India',
    job_title: 'Lead Architect',
    experience_years: 10,
    skills: ['Python', 'FastAPI', 'Distributed Systems']
  });
  assert.equal(validCand.isValid, true);
  assert.equal(validCand.normalized.experience_years, 10);
  assert.equal(validCand.formattedReview.title, 'Review Candidate Details');
});

test('History Management: Enforces provider limits while preserving full session', () => {
  const session = {
    messages: []
  };

  // Add 40 messages to session
  for (let i = 1; i <= 40; i++) {
    session.messages.push({
      role: i % 2 === 1 ? 'user' : 'assistant',
      content: `Message ${i} in conversation discussing job requirements.`
    });
  }

  // Full session retains all 40 messages
  assert.equal(session.messages.length, 40);

  // Build provider messages
  const providerMsgs = buildProviderMessages({
    session,
    incomingMessage: 'What is the current status?'
  });

  // Strict constraint: Provider messages MUST NOT exceed 30 items
  assert.ok(providerMsgs.length <= 30, `Expected <= 30 messages, got ${providerMsgs.length}`);
  // Check that summary of earlier turns is included
  assert.ok(providerMsgs[0].content.includes('Context from earlier conversation turns'));
  // Check that incoming message is last
  assert.equal(providerMsgs[providerMsgs.length - 1].content, 'What is the current status?');

  // Verify Zod ChatRequestSchema accepts 40 messages without throwing
  const validated = ChatRequestSchema.safeParse({
    assistantId: 'hirepool',
    message: 'Hello',
    history: session.messages
  });
  assert.equal(validated.success, true);
});

test('Session Persistence & Token Lifecycle: 24h TTL, sliding expiration and refresh update', () => {
  const now = Date.now();
  const identity = {
    id: 'user_persistent_1',
    email: 'test@hirepool.test',
    userType: 'client',
    organizationRole: 'admin'
  };

  const session = storeHirePoolSession(
    'mock_access_token_1',
    identity,
    now,
    now,
    'mock_refresh_token_1'
  );

  // TTL is 24 hours
  assert.ok(getHirePoolSessionTtlMs() >= 24 * 60 * 60 * 1000);

  // Sliding expiration extends active session
  const activeNow = now + 10 * 60 * 1000; // 10 minutes later
  const touched = touchHirePoolSession(session.credential, activeNow);
  assert.equal(touched, true);

  const context = findHirePoolContextBySdkCredential(session.credential, activeNow);
  assert.ok(context);
  assert.equal(context.lastActiveAt, activeNow);
  assert.ok(context.expiresAt > activeNow + 20 * 60 * 60 * 1000);

  // Token update on refresh
  const updated = updateHirePoolSessionTokens(context.sessionId, 'new_access_token_2', 'new_refresh_token_2');
  assert.equal(updated, true);
  assert.equal(context.accessToken, 'new_access_token_2');
  assert.equal(context.refreshToken, 'new_refresh_token_2');
});

test('Response Formatting: Eliminates raw JSON and formats structured cards', () => {
  // 1. Company jobs list formatting
  const jobsData = [
    {
      id: 'job_101',
      title: 'Full Stack Developer',
      department: 'Engineering',
      company_name: 'Tech Corp',
      locations: ['Bengaluru'],
      remote_type: 'Hybrid',
      employment_type: 'Permanent',
      salary_min: 300000,
      salary_max: 500000,
      salary_currency: 'INR',
      status: 'Active',
      number_of_openings: 3
    }
  ];
  const formattedJobs = formatJobsList(jobsData);
  assert.ok(formattedJobs.includes('Full Stack Developer'));
  assert.ok(formattedJobs.includes('Bengaluru'));
  assert.ok(formattedJobs.includes('Engineering'));
  assert.ok(!formattedJobs.includes('"id": "job_101"')); // No raw JSON!

  // 2. Consultancy candidates formatting
  const candidatesData = [
    {
      first_name: 'Amit',
      last_name: 'Sharma',
      job_title: 'Senior DevOps Specialist',
      current_location: 'Mumbai, India',
      experience_years: 7,
      skills: ['Kubernetes', 'Terraform', 'AWS']
    }
  ];
  const formattedCandidates = formatCandidatesList(candidatesData);
  assert.ok(formattedCandidates.includes('Amit Sharma'));
  assert.ok(formattedCandidates.includes('Senior DevOps Specialist'));
  assert.ok(formattedCandidates.includes('7 years'));
  assert.ok(!formattedCandidates.includes('{"first_name":')); // No raw JSON!

  // 3. Dashboard stats formatting
  const stats = {
    total_candidates: 42,
    active_jobs: 12,
    pending_submissions: 5,
    placements: 8
  };
  const formattedStats = formatDashboardStats(stats);
  assert.ok(formattedStats.includes('Total Candidates') && formattedStats.includes('42'));
  assert.ok(formattedStats.includes('Active Jobs') && formattedStats.includes('12'));

  // 4. finalizeHirePoolResponse strips internal operation IDs
  const rawTextWithOpId = 'Confirmed write API operation create_job_api_v1_jobs_post successfully.';
  const finalized = finalizeHirePoolResponse(rawTextWithOpId);
  assert.ok(!finalized.includes('create_job_api_v1_jobs_post'));
});
