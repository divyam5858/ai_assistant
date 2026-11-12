import assert from 'node:assert/strict';
import express from 'express';
import { afterEach, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import {
  createHirePoolSignupRouter,
  clearAllOnboardingSessions,
  validatePasswordStrength,
  getMissingMandatoryFields
} from '../backend/src/routes/hirepool-signup.js';
import { findHirePoolContextBySdkCredential } from '../backend/src/local-integrations/hirepool-session-store.js';

describe('HirePool In-Chat Signup & Onboarding', () => {
  let mockBackendDatabase = {};
  let mockBackendServer = null;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    clearAllOnboardingSessions();

    mockBackendDatabase = {
      users: new Map(),
      agreements: {
        candidate: { id: '11111111-1111-1111-1111-111111111111', role: 'candidate', version: '1.0', effective_date: '2026-01-01', content: 'Candidate Agreement Terms' },
        client: { id: '22222222-2222-2222-2222-222222222222', role: 'client', version: '1.0', effective_date: '2026-01-01', content: 'Company Agreement Terms' },
        consultancy: { id: '33333333-3333-3333-3333-333333333333', role: 'consultancy', version: '1.0', effective_date: '2026-01-01', content: 'Agency Agreement Terms' }
      },
      candidateProfiles: new Map(),
      clientProfiles: new Map(),
      consultancyProfiles: new Map(),
      validTokens: new Set(['valid-magic-token-123', 'valid-magic-token-client', 'valid-magic-token-agency'])
    };
  });

  afterEach(() => {
    clearAllOnboardingSessions();
  });

  // Mock fetch simulating HirePool FastAPI backend
  const mockFetch = async (url, options = {}) => {
    const urlStr = url.toString();
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : {};
    const headers = options.headers || {};
    const authHeader = headers.Authorization || headers.authorization || '';

    // 1. GET /api/v1/agreements/current
    if (urlStr.includes('/api/v1/agreements/current')) {
      const parsed = new URL(urlStr);
      const role = parsed.searchParams.get('role');
      const agreement = mockBackendDatabase.agreements[role];
      if (!agreement) {
        return { ok: false, status: 404, json: async () => ({ detail: 'No active agreement for role' }) };
      }
      return { ok: true, status: 200, json: async () => agreement };
    }

    // 2. POST /api/v1/auth/register
    if (urlStr.includes('/api/v1/auth/register') && method === 'POST') {
      const email = body.email.toLowerCase();
      if (mockBackendDatabase.users.has(email)) {
        return { ok: false, status: 409, json: async () => ({ detail: 'Email already registered' }) };
      }

      const userId = `user-${Date.now()}`;
      const user = {
        id: userId,
        email,
        user_type: body.user_type,
        is_active: true,
        is_verified: false
      };
      mockBackendDatabase.users.set(email, user);

      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: `mock-access-${userId}`,
          refresh_token: `mock-refresh-${userId}`,
          user: {
            id: userId,
            email,
            user_type: body.user_type,
            is_active: true,
            is_verified: false,
            has_completed_onboarding: false
          }
        })
      };
    }

    // 3. POST /api/v1/auth/magic-link
    if (urlStr.includes('/api/v1/auth/magic-link') && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ message: 'Verification link sent' }) };
    }

    // 4. POST /api/v1/auth/verify-magic-link
    if (urlStr.includes('/api/v1/auth/verify-magic-link') && method === 'POST') {
      if (!mockBackendDatabase.validTokens.has(body.token)) {
        return { ok: false, status: 401, json: async () => ({ detail: 'Invalid or expired magic link' }) };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'mock-access-verified-token',
          refresh_token: 'mock-refresh-verified-token',
          user: {
            id: 'verified-user-1',
            email: 'verified@example.com',
            user_type: 'candidate',
            is_active: true,
            is_verified: true,
            has_completed_onboarding: false
          }
        })
      };
    }

    // 5. GET /api/v1/auth/me
    if (urlStr.includes('/api/v1/auth/me')) {
      if (!authHeader.startsWith('Bearer ')) {
        return { ok: false, status: 401, json: async () => ({ detail: 'Unauthorized' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'user-current',
          email: 'user@example.com',
          user_type: 'candidate',
          is_active: true,
          is_verified: true
        })
      };
    }

    // 6. POST /api/v1/candidates/profile
    if (urlStr.includes('/api/v1/candidates/profile') && method === 'POST') {
      mockBackendDatabase.candidateProfiles.set('user-current', body);
      return { ok: true, status: 200, json: async () => ({ id: 'cand-profile-1', ...body }) };
    }

    // 7. GET /api/v1/candidates/profile
    if (urlStr.includes('/api/v1/candidates/profile') && method === 'GET') {
      const p = mockBackendDatabase.candidateProfiles.get('user-current') || { first_name: 'Test', last_name: 'User' };
      return { ok: true, status: 200, json: async () => p };
    }

    // 8. POST /api/v1/clients/profile
    if (urlStr.includes('/api/v1/clients/profile') && method === 'POST') {
      mockBackendDatabase.clientProfiles.set('user-current', body);
      return { ok: true, status: 200, json: async () => ({ id: 'client-profile-1', ...body }) };
    }

    // 9. GET /api/v1/clients/profile
    if (urlStr.includes('/api/v1/clients/profile') && method === 'GET') {
      const p = mockBackendDatabase.clientProfiles.get('user-current') || { company_name: 'Test Corp' };
      return { ok: true, status: 200, json: async () => p };
    }

    // 10. POST /api/v1/consultancies/profile
    if (urlStr.includes('/api/v1/consultancies/profile') && method === 'POST') {
      mockBackendDatabase.consultancyProfiles.set('user-current', body);
      return { ok: true, status: 200, json: async () => ({ id: 'agency-profile-1', ...body }) };
    }

    // 11. GET /api/v1/consultancies/profile
    if (urlStr.includes('/api/v1/consultancies/profile') && method === 'GET') {
      const p = mockBackendDatabase.consultancyProfiles.get('user-current') || { consultancy_name: 'Test Agency' };
      return { ok: true, status: 200, json: async () => p };
    }

    return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) };
  };

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/hirepool/signup', createHirePoolSignupRouter({
      fetchImpl: mockFetch
    }));
    return app;
  }

  // ---------------------------------------------------------------------------
  // Unit Validation Tests
  // ---------------------------------------------------------------------------
  it('validates password policy accurately', () => {
    assert.strictEqual(validatePasswordStrength('short'), 'Password must be at least 8 characters');
    assert.strictEqual(validatePasswordStrength('alllowercase12'), 'Password must contain at least one uppercase letter');
    assert.strictEqual(validatePasswordStrength('ALLUPPERCASE12'), 'Password must contain at least one lowercase letter');
    assert.strictEqual(validatePasswordStrength('LettersOnlyPass'), 'Password must contain at least one number');
    assert.strictEqual(validatePasswordStrength('ValidP@ssword123'), null);
  });

  it('identifies missing mandatory fields for all three roles', () => {
    // Candidate
    assert.deepStrictEqual(
      getMissingMandatoryFields('candidate', {}),
      ['first_name', 'last_name', 'current_location', 'job_title']
    );
    assert.deepStrictEqual(
      getMissingMandatoryFields('candidate', {
        first_name: 'Priya',
        last_name: 'Nair',
        current_location: 'Bengaluru',
        job_title: 'Senior Developer'
      }),
      []
    );

    // Client
    assert.deepStrictEqual(
      getMissingMandatoryFields('client', {}),
      ['company_name', 'industry', 'company_size', 'headquarters_location', 'primary_contact.full_name']
    );
    assert.deepStrictEqual(
      getMissingMandatoryFields('client', {
        company_name: 'Acme',
        industry: 'Technology',
        company_size: '51-200',
        headquarters_location: 'Mumbai',
        primary_contact: { full_name: 'Rohit Sharma' }
      }),
      []
    );

    // Consultancy
    assert.deepStrictEqual(
      getMissingMandatoryFields('consultancy', {}),
      ['consultancy_name', 'consultancy_type', 'industry_specialization', 'headquarters_location', 'primary_contact.full_name']
    );
    assert.deepStrictEqual(
      getMissingMandatoryFields('consultancy', {
        consultancy_name: 'Apex Recruiting',
        consultancy_type: 'recruitment',
        industry_specialization: ['Technology'],
        headquarters_location: 'Bengaluru',
        primary_contact: { full_name: 'Ananya Roy' }
      }),
      []
    );
  });

  // ---------------------------------------------------------------------------
  // End-to-End API Flow Tests
  // ---------------------------------------------------------------------------
  it('fetches User Agreement for all three roles and rejects invalid roles', async () => {
    const app = createTestApp();

    for (const role of ['candidate', 'client', 'consultancy']) {
      const res = await request(app).get(`/api/hirepool/signup/agreement?role=${role}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.role, role);
      assert.strictEqual(res.body.version, '1.0');
      assert.ok(res.body.id);
      assert.ok(res.body.content);
    }

    const badRoleRes = await request(app).get('/api/hirepool/signup/agreement?role=admin');
    assert.strictEqual(badRoleRes.status, 400);
    assert.strictEqual(badRoleRes.body.error.code, 'INVALID_ROLE');
  });

  it('rejects registration with invalid inputs or missing agreement', async () => {
    const app = createTestApp();

    // Invalid email
    const res1 = await request(app).post('/api/hirepool/signup/register').send({
      email: 'notanemail',
      password: 'Password123',
      confirmPassword: 'Password123',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: '11111111-1111-1111-1111-111111111111'
    });
    assert.strictEqual(res1.status, 400);
    assert.strictEqual(res1.body.error.code, 'INVALID_EMAIL');

    // Password mismatch
    const res2 = await request(app).post('/api/hirepool/signup/register').send({
      email: 'cand@test.com',
      password: 'Password123',
      confirmPassword: 'DifferentPassword123',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: '11111111-1111-1111-1111-111111111111'
    });
    assert.strictEqual(res2.status, 400);
    assert.strictEqual(res2.body.error.code, 'PASSWORD_MISMATCH');

    // Weak password
    const res3 = await request(app).post('/api/hirepool/signup/register').send({
      email: 'cand@test.com',
      password: 'weak',
      confirmPassword: 'weak',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: '11111111-1111-1111-1111-111111111111'
    });
    assert.strictEqual(res3.status, 400);
    assert.strictEqual(res3.body.error.code, 'WEAK_PASSWORD');

    // Agreement not accepted
    const res4 = await request(app).post('/api/hirepool/signup/register').send({
      email: 'cand@test.com',
      password: 'Password123',
      confirmPassword: 'Password123',
      userType: 'candidate',
      acceptAgreement: false,
      agreementVersionId: '11111111-1111-1111-1111-111111111111'
    });
    assert.strictEqual(res4.status, 400);
    assert.strictEqual(res4.body.error.code, 'AGREEMENT_REQUIRED');
  });

  it('completes Candidate registration, email verification, profile submission and session transition', async () => {
    const app = createTestApp();

    // 1. Register candidate
    const regRes = await request(app).post('/api/hirepool/signup/register').send({
      email: 'priya.candidate@example.com',
      password: 'SecurePassword123',
      confirmPassword: 'SecurePassword123',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: '11111111-1111-1111-1111-111111111111'
    });
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regRes.body.stage, 'verification_pending');
    assert.ok(regRes.body.signupToken);
    const signupToken = regRes.body.signupToken;

    // Duplicate email rejected
    const dupRes = await request(app).post('/api/hirepool/signup/register').send({
      email: 'priya.candidate@example.com',
      password: 'SecurePassword123',
      confirmPassword: 'SecurePassword123',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: '11111111-1111-1111-1111-111111111111'
    });
    assert.strictEqual(dupRes.status, 409);
    assert.strictEqual(dupRes.body.error.code, 'EMAIL_ALREADY_REGISTERED');

    // 2. Resend verification
    const resendRes = await request(app).post('/api/hirepool/signup/resend-verification').send({ signupToken });
    assert.strictEqual(resendRes.status, 200);

    // 3. Profile update before verification is blocked
    const earlyProfileRes = await request(app).post('/api/hirepool/signup/profile-update').send({
      signupToken,
      fields: { first_name: 'Priya' }
    });
    assert.strictEqual(earlyProfileRes.status, 403);
    assert.strictEqual(earlyProfileRes.body.error.code, 'EMAIL_NOT_VERIFIED');

    // 4. Verify email using URL containing token
    const verifyRes = await request(app).post('/api/hirepool/signup/verify-email').send({
      signupToken,
      verificationToken: 'http://localhost:5173/auth/verify-email?token=valid-magic-token-123'
    });
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.body.isVerified, true);
    assert.strictEqual(verifyRes.body.stage, 'email_verified');

    // 5. Update profile fields incrementally
    const profUpdateRes = await request(app).post('/api/hirepool/signup/profile-update').send({
      signupToken,
      fields: {
        first_name: 'Priya',
        last_name: 'Nair',
        current_location: 'Bengaluru',
        job_title: 'Senior Frontend Engineer',
        skills: ['React', 'TypeScript', 'Node.js']
      }
    });
    assert.strictEqual(profUpdateRes.status, 200);
    assert.strictEqual(profUpdateRes.body.isComplete, true);
    assert.strictEqual(profUpdateRes.body.stage, 'profile_review');

    // 6. Complete profile and establish authenticated SDK session
    const completeRes = await request(app).post('/api/hirepool/signup/complete-profile').send({
      signupToken
    });
    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(completeRes.body.stage, 'completed');
    assert.ok(completeRes.body.credential);
    assert.strictEqual(completeRes.body.identity.userType, 'candidate');

    // Verify authenticated session is stored in session store
    const context = findHirePoolContextBySdkCredential(completeRes.body.credential);
    assert.ok(context);
    assert.strictEqual(context.identity.userType, 'candidate');
  });

  it('completes Company / Client registration, verification, profile submission and session transition', async () => {
    const app = createTestApp();

    const regRes = await request(app).post('/api/hirepool/signup/register').send({
      email: 'recruiter@techcorp.com',
      password: 'CompanyPassword123',
      confirmPassword: 'CompanyPassword123',
      userType: 'client',
      acceptAgreement: true,
      agreementVersionId: '22222222-2222-2222-2222-222222222222'
    });
    assert.strictEqual(regRes.status, 201);
    const signupToken = regRes.body.signupToken;

    // Verify with token directly
    const verifyRes = await request(app).post('/api/hirepool/signup/verify-email').send({
      signupToken,
      verificationToken: 'valid-magic-token-client'
    });
    assert.strictEqual(verifyRes.status, 200);

    // Profile update with missing mandatory fields
    const partialUpdate = await request(app).post('/api/hirepool/signup/profile-update').send({
      signupToken,
      fields: { company_name: 'TechCorp' }
    });
    assert.strictEqual(partialUpdate.body.isComplete, false);
    assert.ok(partialUpdate.body.missingFields.includes('industry'));

    // Complete all company fields
    const completeRes = await request(app).post('/api/hirepool/signup/complete-profile').send({
      signupToken,
      confirmedProfile: {
        company_name: 'TechCorp India',
        industry: 'Technology',
        company_size: '51-200',
        headquarters_location: 'Hyderabad',
        company_website: 'https://techcorp.example.com',
        primary_contact: {
          full_name: 'Arjun Mehta',
          designation: 'VP Engineering'
        }
      }
    });
    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(completeRes.body.identity.userType, 'client');
    assert.strictEqual(completeRes.body.identity.organizationRole, 'admin');

    const context = findHirePoolContextBySdkCredential(completeRes.body.credential);
    assert.ok(context);
    assert.strictEqual(context.identity.userType, 'client');
  });

  it('completes Consultancy / Agency registration, verification, profile submission and session transition', async () => {
    const app = createTestApp();

    const regRes = await request(app).post('/api/hirepool/signup/register').send({
      email: 'partner@talentagency.com',
      password: 'AgencyPassword123',
      confirmPassword: 'AgencyPassword123',
      userType: 'consultancy',
      acceptAgreement: true,
      agreementVersionId: '33333333-3333-3333-3333-333333333333'
    });
    assert.strictEqual(regRes.status, 201);
    const signupToken = regRes.body.signupToken;

    // Verify token
    await request(app).post('/api/hirepool/signup/verify-email').send({
      signupToken,
      verificationToken: 'valid-magic-token-agency'
    });

    // Complete agency fields
    const completeRes = await request(app).post('/api/hirepool/signup/complete-profile').send({
      signupToken,
      confirmedProfile: {
        consultancy_name: 'Global Talent Partners',
        consultancy_type: 'recruitment',
        industry_specialization: ['Technology', 'Finance'],
        headquarters_location: 'Bengaluru',
        primary_contact: {
          full_name: 'Siddharth Sen',
          designation: 'Managing Partner'
        }
      }
    });
    assert.strictEqual(completeRes.status, 200);
    assert.strictEqual(completeRes.body.identity.userType, 'consultancy');
    assert.strictEqual(completeRes.body.identity.organizationRole, 'admin');

    const context = findHirePoolContextBySdkCredential(completeRes.body.credential);
    assert.ok(context);
    assert.strictEqual(context.identity.userType, 'consultancy');
  });

  it('handles cancellation and removes active onboarding session', async () => {
    const app = createTestApp();

    const regRes = await request(app).post('/api/hirepool/signup/register').send({
      email: 'cancel@example.com',
      password: 'Password123',
      confirmPassword: 'Password123',
      userType: 'candidate',
      acceptAgreement: true,
      agreementVersionId: '11111111-1111-1111-1111-111111111111'
    });
    const signupToken = regRes.body.signupToken;

    const cancelRes = await request(app).post('/api/hirepool/signup/cancel').send({ signupToken });
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.status, 'cancelled');

    // Subsequent operation with cancelled token returns 410
    const verifyRes = await request(app).post('/api/hirepool/signup/verify-email').send({
      signupToken,
      verificationToken: 'valid-magic-token-123'
    });
    assert.strictEqual(verifyRes.status, 410);
    assert.strictEqual(verifyRes.body.error.code, 'SESSION_EXPIRED');
  });
});
