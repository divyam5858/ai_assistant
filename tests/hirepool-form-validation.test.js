import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  validatePhoneNumber,
  sanitizePhoneNumber,
  validateEmail,
  validatePassword,
  validateWebsiteUrl,
  validateGstin,
  validateEducationItem,
  validateWorkExperienceItem,
  validateCandidateProfile,
  validateClientProfile,
  validateConsultancyProfile,
  getMissingMandatoryFields,
  LIMITS,
  CLIENT_INDUSTRIES,
  COMPANY_SIZES,
  CONSULTANCY_TYPES
} from '../backend/src/local-integrations/hirepool-validation.js';
import { createHirePoolSignupRouter } from '../backend/src/routes/hirepool-signup.js';

describe('HirePool Form Validation Parity Suite', () => {

  // =========================================================================
  // 1. Phone Number Validation (Authoritative contract: exactly 10 digits)
  // =========================================================================
  describe('Phone Number Validation', () => {
    it('accepts valid 10-digit numeric phone numbers', () => {
      const res1 = validatePhoneNumber('9876543210');
      assert.strictEqual(res1.isValid, true);
      assert.strictEqual(res1.digits, '9876543210');

      const res2 = validatePhoneNumber('1234567890');
      assert.strictEqual(res2.isValid, true);
      assert.strictEqual(res2.digits, '1234567890');
    });

    it('accepts valid 10-digit numbers with punctuation/spaces and extracts digits', () => {
      const res = validatePhoneNumber('+91 98765 43210');
      // If +91 is stripped or treated as country prefix, exactly 10 digits is verified
      // When 10 digits are present:
      const resLocal = validatePhoneNumber('98765-43210');
      assert.strictEqual(resLocal.isValid, true);
      assert.strictEqual(resLocal.digits, '9876543210');
    });

    it('rejects phone numbers with fewer than 10 digits', () => {
      const res = validatePhoneNumber('987654321');
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.error, 'Phone number must contain exactly 10 digits');
    });

    it('rejects phone numbers with more than 10 digits', () => {
      const res = validatePhoneNumber('98765432101');
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.error, 'Phone number must contain exactly 10 digits');
    });

    it('rejects phone numbers containing alphabetic characters', () => {
      const res1 = validatePhoneNumber('98765abc10');
      assert.strictEqual(res1.isValid, false);
      assert.strictEqual(res1.error, 'Phone number must contain exactly 10 digits');

      const res2 = validatePhoneNumber('abcdefghij');
      assert.strictEqual(res2.isValid, false);
      assert.strictEqual(res2.error, 'Phone number must contain exactly 10 digits');
    });

    it('allows empty phone number when optional', () => {
      const res1 = validatePhoneNumber('', { required: false });
      assert.strictEqual(res1.isValid, true);
      assert.strictEqual(res1.digits, '');

      const res2 = validatePhoneNumber(null, { required: false });
      assert.strictEqual(res2.isValid, true);
    });

    it('rejects empty phone number when required', () => {
      const res = validatePhoneNumber('', { required: true });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.error, 'Phone number is required');
    });

    it('sanitizePhoneNumber strips unwanted characters', () => {
      assert.strictEqual(sanitizePhoneNumber('(987) 654-3210'), '9876543210');
      assert.strictEqual(sanitizePhoneNumber('+91 98765-43210'), '+919876543210');
    });
  });

  // =========================================================================
  // 2. Email Validation
  // =========================================================================
  describe('Email Validation', () => {
    it('accepts valid email formats', () => {
      const res1 = validateEmail('candidate@example.com');
      assert.strictEqual(res1.isValid, true);
      assert.strictEqual(res1.sanitized, 'candidate@example.com');

      const res2 = validateEmail('Jane.Doe+test@domain.co.in');
      assert.strictEqual(res2.isValid, true);
      assert.strictEqual(res2.sanitized, 'jane.doe+test@domain.co.in');
    });

    it('rejects invalid email formats', () => {
      assert.strictEqual(validateEmail('not-an-email').isValid, false);
      assert.strictEqual(validateEmail('missing-domain@').isValid, false);
      assert.strictEqual(validateEmail('@domain.com').isValid, false);
      assert.strictEqual(validateEmail('spaces in@domain.com').isValid, false);
      assert.strictEqual(validateEmail('missing-tld@domain').isValid, false);
    });

    it('enforces required email rule', () => {
      const res = validateEmail('', { required: true });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.error, 'Email is required');
    });
  });

  // =========================================================================
  // 3. Password Validation & Strength
  // =========================================================================
  describe('Password Complexity & Agreement Validation', () => {
    it('accepts strong password meeting all criteria', () => {
      const res = validatePassword('SecurePass123');
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.errors.length, 0);
    });

    it('rejects password shorter than 8 characters', () => {
      const res = validatePassword('Pass1');
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.includes('Password must be at least 8 characters'));
    });

    it('rejects password missing uppercase letter', () => {
      const res = validatePassword('password123');
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.includes('Password must contain at least one uppercase letter'));
    });

    it('rejects password missing lowercase letter', () => {
      const res = validatePassword('PASSWORD123');
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.includes('Password must contain at least one lowercase letter'));
    });

    it('rejects password missing a number', () => {
      const res = validatePassword('PasswordOnly');
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.includes('Password must contain at least one number'));
    });

    it('enforces confirm password matching', () => {
      const res = validatePassword('SecurePass123', { confirmPassword: 'DifferentPass123' });
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.includes('Passwords do not match'));
    });

    it('enforces user agreement acceptance when required', () => {
      const res = validatePassword('SecurePass123', {
        confirmPassword: 'SecurePass123',
        requireAgreement: true,
        acceptAgreement: false
      });
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.includes('You must agree to the User Agreement to create an account'));
    });
  });

  // =========================================================================
  // 4. Website and URL Validation
  // =========================================================================
  describe('Website URL Validation', () => {
    it('accepts valid http and https URLs', () => {
      assert.strictEqual(validateWebsiteUrl('https://hirepool.dev').isValid, true);
      assert.strictEqual(validateWebsiteUrl('http://mycompany.co.uk').isValid, true);
      assert.strictEqual(validateWebsiteUrl('https://sub.domain.org/path?q=1').isValid, true);
    });

    it('rejects URLs missing http:// or https:// protocol', () => {
      const res = validateWebsiteUrl('hirepool.dev');
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.error, 'Website must start with http:// or https://');
    });

    it('rejects invalid URLs', () => {
      assert.strictEqual(validateWebsiteUrl('not-a-valid-domain').isValid, false);
      assert.strictEqual(validateWebsiteUrl('ftp://unsupported.com').isValid, false);
      assert.strictEqual(validateWebsiteUrl('http://').isValid, false);
    });
  });

  // =========================================================================
  // 5. Candidate Profile Validation
  // =========================================================================
  describe('Candidate Profile Validation', () => {
    const validCandidate = {
      first_name: 'Aditi',
      last_name: 'Sharma',
      current_location: 'Bengaluru',
      job_title: 'Full Stack Engineer',
      phone: '9876543210',
      years_of_experience: 5,
      notice_period_days: 30,
      expected_salary_min: 1500000,
      expected_salary_max: 2500000,
      skills: ['React', 'Node.js', 'PostgreSQL'],
      portfolio_url: 'https://aditi.dev'
    };

    it('accepts fully valid candidate profile', () => {
      const res = validateCandidateProfile(validCandidate);
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.sanitizedData.first_name, 'Aditi');
      assert.strictEqual(res.sanitizedData.phone, '9876543210');
      assert.strictEqual(res.sanitizedData.years_of_experience, 5);
      assert.deepStrictEqual(res.sanitizedData.skills, ['React', 'Node.js', 'PostgreSQL']);
    });

    it('rejects candidate missing mandatory first_name', () => {
      const res = validateCandidateProfile({ ...validCandidate, first_name: '' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.first_name, 'First name is required');
    });

    it('rejects candidate missing mandatory last_name', () => {
      const res = validateCandidateProfile({ ...validCandidate, last_name: '  ' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.last_name, 'Last name is required');
    });

    it('rejects candidate missing mandatory location', () => {
      const res = validateCandidateProfile({ ...validCandidate, current_location: '' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.current_location, 'Location is required');
    });

    it('rejects candidate missing mandatory job_title', () => {
      const res = validateCandidateProfile({ ...validCandidate, job_title: '' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.job_title, 'Job title is required');
    });

    it('rejects candidate with invalid phone number', () => {
      const res1 = validateCandidateProfile({ ...validCandidate, phone: '987654321' });
      assert.strictEqual(res1.isValid, false);
      assert.strictEqual(res1.errors.phone, 'Phone number must contain exactly 10 digits');

      const res2 = validateCandidateProfile({ ...validCandidate, phone: '98765abc10' });
      assert.strictEqual(res2.isValid, false);
      assert.strictEqual(res2.errors.phone, 'Phone number must contain exactly 10 digits');
    });

    it('enforces years_of_experience bounds (0 to 50)', () => {
      const resNeg = validateCandidateProfile({ ...validCandidate, years_of_experience: -2 });
      assert.strictEqual(resNeg.isValid, false);
      assert.strictEqual(resNeg.errors.years_of_experience, 'Years of experience must be at least 0');

      const resMax = validateCandidateProfile({ ...validCandidate, years_of_experience: 55 });
      assert.strictEqual(resMax.isValid, false);
      assert.strictEqual(resMax.errors.years_of_experience, 'Years of experience cannot be more than 50');
    });

    it('enforces notice_period_days bounds (0 to 180)', () => {
      const resNeg = validateCandidateProfile({ ...validCandidate, notice_period_days: -10 });
      assert.strictEqual(resNeg.isValid, false);
      assert.strictEqual(resNeg.errors.notice_period_days, 'Notice period must be at least 0 days');

      const resHigh = validateCandidateProfile({ ...validCandidate, notice_period_days: 200 });
      assert.strictEqual(resHigh.isValid, false);
      assert.strictEqual(resHigh.errors.notice_period_days, 'Notice period cannot be more than 180 days');
    });

    it('enforces expected salary bounds and min <= max rule', () => {
      const resReversed = validateCandidateProfile({
        ...validCandidate,
        expected_salary_min: 3000000,
        expected_salary_max: 2000000
      });
      assert.strictEqual(resReversed.isValid, false);
      assert.strictEqual(resReversed.errors.expected_salary_min, 'The minimum expected salary cannot be more than the maximum');

      const resOverLimit = validateCandidateProfile({
        ...validCandidate,
        expected_salary_max: 60000000
      });
      assert.strictEqual(resOverLimit.isValid, false);
      assert.strictEqual(resOverLimit.errors.expected_salary_max, 'Maximum expected salary cannot be more than 5,00,00,000');
    });

    it('validates nested education and work experience items', () => {
      const resInvalidEdu = validateCandidateProfile({
        ...validCandidate,
        education: [{ institution: '', degree: 'B.Tech' }]
      });
      assert.strictEqual(resInvalidEdu.isValid, false);
      assert.strictEqual(resInvalidEdu.errors['education.0'], 'Institution is required');

      const resInvalidExp = validateCandidateProfile({
        ...validCandidate,
        work_experience: [{ company: 'Acme', title: '' }]
      });
      assert.strictEqual(resInvalidExp.isValid, false);
      assert.strictEqual(resInvalidExp.errors['work_experience.0'], 'Job title is required');
    });
  });

  // =========================================================================
  // 6. Client / Employer Profile Validation
  // =========================================================================
  describe('Client / Employer Profile Validation', () => {
    const validClient = {
      company_name: 'Apex Innovations',
      industry: 'Technology',
      company_size: '51-200',
      headquarters_location: 'Mumbai, India',
      primary_contact: {
        full_name: 'Rajesh Varma',
        designation: 'VP Engineering',
        phone: '9876543210'
      },
      company_website: 'https://apexinno.com',
      founding_year: 2018
    };

    it('accepts fully valid client profile', () => {
      const res = validateClientProfile(validClient);
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.sanitizedData.company_name, 'Apex Innovations');
      assert.strictEqual(res.sanitizedData.primary_contact.phone, '9876543210');
      assert.strictEqual(res.sanitizedData.founding_year, 2018);
    });

    it('rejects client missing mandatory company_name', () => {
      const res = validateClientProfile({ ...validClient, company_name: '' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.company_name, 'Company name is required');
    });

    it('rejects client with invalid company_size', () => {
      const res = validateClientProfile({ ...validClient, company_size: 'invalid-size' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.company_size, 'Please select a valid company size');
    });

    it('rejects client missing contact name', () => {
      const res = validateClientProfile({
        ...validClient,
        primary_contact: { ...validClient.primary_contact, full_name: '' }
      });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors['primary_contact.full_name'], 'Your name is required');
    });

    it('rejects client with invalid contact phone number', () => {
      const res = validateClientProfile({
        ...validClient,
        primary_contact: { ...validClient.primary_contact, phone: '98765abc10' }
      });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors['primary_contact.phone'], 'Phone number must contain exactly 10 digits');
    });

    it('rejects client with invalid company website', () => {
      const res = validateClientProfile({ ...validClient, company_website: 'not a url' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.company_website, 'Website must start with http:// or https://');
    });

    it('enforces founding_year range (1800 to 2100)', () => {
      const resLow = validateClientProfile({ ...validClient, founding_year: 1750 });
      assert.strictEqual(resLow.isValid, false);
      assert.strictEqual(resLow.errors.founding_year, 'Founding year must be between 1800 and 2100');

      const resHigh = validateClientProfile({ ...validClient, founding_year: 2150 });
      assert.strictEqual(resHigh.isValid, false);
      assert.strictEqual(resHigh.errors.founding_year, 'Founding year must be between 1800 and 2100');
    });

    it('validates GSTIN format when provided', () => {
      // Valid GSTIN: 29ABCDE1234F1Z5
      const resValid = validateGstin('29ABCDE1234F1Z5');
      assert.strictEqual(resValid.isValid, true);

      // Invalid GSTIN length
      const resShort = validateGstin('29ABCDE');
      assert.strictEqual(resShort.isValid, false);
      assert.strictEqual(resShort.error, 'GSTIN must be exactly 15 characters');

      // Invalid GSTIN state code
      const resBadState = validateGstin('00ABCDE1234F1Z5');
      assert.strictEqual(resBadState.isValid, false);
      assert.strictEqual(resBadState.error, 'Invalid state code in GSTIN');
    });
  });

  // =========================================================================
  // 7. Consultancy / Agency Profile Validation
  // =========================================================================
  describe('Consultancy / Agency Profile Validation', () => {
    const validConsultancy = {
      consultancy_name: 'Prime Recruiters',
      consultancy_type: 'recruitment',
      headquarters_location: 'Bengaluru',
      industry_specialization: ['Technology', 'Finance'],
      company_size: '11-50',
      primary_contact: {
        full_name: 'Karan Mehra',
        designation: 'Managing Partner',
        phone: '9876543210'
      },
      website: 'https://primerecruiters.com',
      founding_year: 2015
    };

    it('accepts fully valid consultancy profile', () => {
      const res = validateConsultancyProfile(validConsultancy);
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.sanitizedData.consultancy_name, 'Prime Recruiters');
      assert.strictEqual(res.sanitizedData.consultancy_type, 'recruitment');
      assert.deepStrictEqual(res.sanitizedData.industry_specialization, ['Technology', 'Finance']);
    });

    it('accepts staffing agency consultancy_type', () => {
      const res = validateConsultancyProfile({ ...validConsultancy, consultancy_type: 'staffing' });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.sanitizedData.consultancy_type, 'staffing');
    });

    it('rejects unsupported consultancy_type', () => {
      const res = validateConsultancyProfile({ ...validConsultancy, consultancy_type: 'unsupported' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.consultancy_type, 'Please select your agency type');
    });

    it('rejects consultancy missing industry_specialization', () => {
      const res = validateConsultancyProfile({ ...validConsultancy, industry_specialization: [] });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.industry_specialization, 'Select at least one industry');
    });

    it('rejects consultancy with invalid contact phone number', () => {
      const res = validateConsultancyProfile({
        ...validConsultancy,
        primary_contact: { ...validConsultancy.primary_contact, phone: '12345' }
      });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors['primary_contact.phone'], 'Phone number must contain exactly 10 digits');
    });

    it('rejects consultancy with letters in contact phone number', () => {
      const res = validateConsultancyProfile({
        ...validConsultancy,
        primary_contact: { ...validConsultancy.primary_contact, phone: 'abcdefghij' }
      });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors['primary_contact.phone'], 'Phone number must contain exactly 10 digits');
    });

    it('rejects consultancy with invalid website', () => {
      const res = validateConsultancyProfile({ ...validConsultancy, website: 'htp://broken' });
      assert.strictEqual(res.isValid, false);
      assert.strictEqual(res.errors.website, 'Website must start with http:// or https://');
    });
  });

  // =========================================================================
  // 8. Missing Mandatory Fields Utility
  // =========================================================================
  describe('getMissingMandatoryFields Utility', () => {
    it('identifies missing mandatory candidate fields', () => {
      const missing = getMissingMandatoryFields('candidate', {});
      assert.deepStrictEqual(missing, ['first_name', 'last_name', 'current_location', 'job_title']);
    });

    it('identifies missing mandatory client fields', () => {
      const missing = getMissingMandatoryFields('client', { company_name: 'Acme' });
      assert.ok(missing.includes('industry'));
      assert.ok(missing.includes('company_size'));
      assert.ok(missing.includes('headquarters_location'));
      assert.ok(missing.includes('primary_contact.full_name'));
      assert.ok(!missing.includes('company_name'));
    });

    it('identifies missing mandatory consultancy fields', () => {
      const missing = getMissingMandatoryFields('consultancy', { consultancy_name: 'Apex' });
      assert.ok(missing.includes('consultancy_type'));
      assert.ok(missing.includes('industry_specialization'));
      assert.ok(missing.includes('headquarters_location'));
      assert.ok(missing.includes('primary_contact.full_name'));
      assert.ok(!missing.includes('consultancy_name'));
    });
  });

  // =========================================================================
  // 9. Backend API Endpoint Validation (Level 3 Server-Side Enforcement)
  // =========================================================================
  describe('Backend API Route Validation', () => {
    let app;
    let server;
    let port;
    let baseUrl;

    let lastSubmittedProfile = {};
    const mockFetch = async (url, opts = {}) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/agreements/active')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'agr_123', version: '1.0', content: 'Terms...' })
        };
      }
      if (urlStr.includes('/api/v1/auth/register')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            access_token: 'fake_access_tok',
            refresh_token: 'fake_refresh_tok',
            user: { id: 'usr_123', email: 'test@example.com', role: 'candidate' }
          })
        };
      }
      if (urlStr.includes('/api/v1/auth/login')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'fake_tok', refresh_token: 'fake_ref' })
        };
      }
      if (urlStr.includes('/api/v1/auth/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'usr_123', email: 'test@example.com', role: 'candidate', is_verified: true })
        };
      }
      if (urlStr.includes('/profile') && opts.method === 'POST') {
        lastSubmittedProfile = JSON.parse(opts.body || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'prof_123', ...lastSubmittedProfile })
        };
      }
      if (urlStr.includes('/profile')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'prof_123', ...lastSubmittedProfile })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    it('setup mock server', async () => {
      app = express();
      app.use(express.json());
      const router = createHirePoolSignupRouter({
        fetchImpl: mockFetch,
        hirepoolBackendUrl: 'http://localhost:8000',
        allowedOrigins: ['http://localhost:3000']
      });
      app.use('/api/hirepool/signup', router);

      await new Promise(resolve => {
        server = app.listen(0, () => {
          port = server.address().port;
          baseUrl = `http://localhost:${port}/api/hirepool/signup`;
          resolve();
        });
      });
    });

    it('POST /register rejects invalid email address', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          email: 'invalid-email-address',
          password: 'Password123',
          confirmPassword: 'Password123',
          userType: 'candidate',
          acceptAgreement: true
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error.code, 'INVALID_EMAIL');
      assert.strictEqual(data.error.message, 'Invalid email address');
    });

    it('POST /register rejects weak password lacking numbers or uppercase', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'weakpassword',
          confirmPassword: 'weakpassword',
          userType: 'candidate',
          acceptAgreement: true
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.error.code, 'WEAK_PASSWORD');
    });

    it('POST /complete-profile rejects invalid phone numbers (Level 3 enforcement)', async () => {
      // First register and simulate verified email
      const regRes = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          email: 'candidate@example.com',
          password: 'Password123',
          confirmPassword: 'Password123',
          userType: 'candidate',
          acceptAgreement: true,
          agreementVersionId: 'agr_123'
        })
      });
      const regData = await regRes.json();
      const signupToken = regData.signupToken;

      // Check status to mark email verified
      await fetch(`${baseUrl}/check-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ signupToken })
      });

      // Attempt to complete profile with invalid 7-digit phone number
      const compRes = await fetch(`${baseUrl}/complete-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          signupToken,
          confirmedProfile: {
            first_name: 'Aditi',
            last_name: 'Sharma',
            current_location: 'Bengaluru',
            job_title: 'Software Engineer',
            phone: '9876543' // Invalid! 7 digits instead of 10
          }
        })
      });

      assert.strictEqual(compRes.status, 400);
      const compData = await compRes.json();
      assert.strictEqual(compData.error.code, 'VALIDATION_FAILED');
      assert.strictEqual(compData.error.message, 'Phone number must contain exactly 10 digits');
      assert.strictEqual(compData.error.details.phone, 'Phone number must contain exactly 10 digits');
    });

    it('POST /complete-profile rejects alphabetic characters in phone number', async () => {
      // Register client
      const regRes = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          email: 'client@example.com',
          password: 'Password123',
          confirmPassword: 'Password123',
          userType: 'client',
          acceptAgreement: true,
          agreementVersionId: 'agr_123'
        })
      });
      const regData = await regRes.json();
      const signupToken = regData.signupToken;

      await fetch(`${baseUrl}/check-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ signupToken })
      });

      const compRes = await fetch(`${baseUrl}/complete-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          signupToken,
          confirmedProfile: {
            company_name: 'Acme Corp',
            industry: 'Technology',
            company_size: '51-200',
            headquarters_location: 'Mumbai',
            primary_contact: {
              full_name: 'Contact Person',
              phone: '98765abc10' // Invalid phone with letters
            }
          }
        })
      });

      assert.strictEqual(compRes.status, 400);
      const compData = await compRes.json();
      assert.strictEqual(compData.error.code, 'VALIDATION_FAILED');
      assert.strictEqual(compData.error.details['primary_contact.phone'], 'Phone number must contain exactly 10 digits');
    });

    it('POST /complete-profile succeeds with 10-digit phone and valid data', async () => {
      // Register consultancy
      const regRes = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          email: 'consultancy@example.com',
          password: 'Password123',
          confirmPassword: 'Password123',
          userType: 'consultancy',
          acceptAgreement: true,
          agreementVersionId: 'agr_123'
        })
      });
      const regData = await regRes.json();
      const signupToken = regData.signupToken;

      await fetch(`${baseUrl}/check-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ signupToken })
      });

      const compRes = await fetch(`${baseUrl}/complete-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({
          signupToken,
          confirmedProfile: {
            consultancy_name: 'Apex Staffing',
            consultancy_type: 'staffing',
            headquarters_location: 'Bengaluru',
            industry_specialization: ['Technology'],
            primary_contact: {
              full_name: 'Agency Lead',
              phone: '9876543210' // Exactly 10 digits
            }
          }
        })
      });

      assert.strictEqual(compRes.status, 200);
      const compData = await compRes.json();
      assert.strictEqual(compData.status, 'success');
      assert.strictEqual(compData.profile.consultancy_name, 'Apex Staffing');
      assert.strictEqual(compData.profile.primary_contact.phone, '9876543210');
    });

    it('teardown mock server', async () => {
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });
  });
});
