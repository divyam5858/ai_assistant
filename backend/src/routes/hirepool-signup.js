import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { storeHirePoolSession, findHirePoolContextBySdkCredential } from '../local-integrations/hirepool-session-store.js';
import { isHirePoolLocalBridgeEnabled } from '../local-integrations/hirepool-auth.js';
import { extractCredentials, AuthenticationError } from '../middleware/auth.js';
import {
  HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS,
  HIREPOOL_LOCAL_DASHBOARD_ORIGINS
} from '../../../config/hirepool-site-policy.js';
import {
  validatePhoneNumber,
  validateEmail,
  validatePassword,
  validatePasswordStrength,
  validateWebsiteUrl,
  validateCandidateProfile,
  validateClientProfile,
  validateConsultancyProfile,
  getMissingMandatoryFields,
  LIMITS
} from '../local-integrations/hirepool-validation.js';

export {
  validatePhoneNumber,
  validateEmail,
  validatePassword,
  validatePasswordStrength,
  validateWebsiteUrl,
  validateCandidateProfile,
  validateClientProfile,
  validateConsultancyProfile,
  getMissingMandatoryFields,
  LIMITS
};

const ONBOARDING_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ALLOWED_USER_TYPES = Object.freeze(['candidate', 'client', 'consultancy']);

const onboardingSessions = new Map();

export function cleanupExpiredOnboardingSessions(now = Date.now()) {
  for (const [token, session] of onboardingSessions) {
    if (session.expiresAt <= now) {
      onboardingSessions.delete(token);
    }
  }
}

const cleanupTimer = setInterval(() => cleanupExpiredOnboardingSessions(), 60_000);
cleanupTimer.unref?.();

export function clearAllOnboardingSessions() {
  onboardingSessions.clear();
}

function getHirePoolBaseUrl(env = process.env) {
  const value = env.HIREPOOL_LOCAL_API_BASE_URL || 'http://localhost:8000/';
  const url = new URL(value);
  url.hostname = '127.0.0.1';
  return url;
}

function getApprovedVerificationOrigins(env = process.env) {
  const origins = new Set([
    ...HIREPOOL_LOCAL_DASHBOARD_ORIGINS,
    'https://app.hirepool.ai',
    'https://hirepool.ai'
  ]);
  const configuredFrontendUrl = env.HIREPOOL_FRONTEND_URL || env.HIREPOOL_PUBLIC_FRONTEND_URL;
  if (configuredFrontendUrl) {
    try {
      origins.add(new URL(configuredFrontendUrl).origin);
    } catch {}
  }
  return origins;
}

export function extractSafeVerificationUrl(rawUrl, env = process.env) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;

  const approvedOrigins = getApprovedVerificationOrigins(env);
  if (!approvedOrigins.has(parsed.origin)) return null;

  if (!parsed.pathname.startsWith('/auth/verify')) return null;
  if (!parsed.searchParams.get('token')) return null;

  return parsed.toString();
}

function assertPublicOrigin(req) {
  const origin = req.get('Origin');
  if (process.env.NODE_ENV === 'test' && !origin) {
    return; // Allow test requests without origin
  }
  if (!origin || !HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS.includes(origin)) {
    const error = new Error('Local HirePool bridge origin is not allowed');
    error.statusCode = 403;
    error.code = 'ORIGIN_NOT_ALLOWED';
    throw error;
  }
}

export function createHirePoolSignupRouter({
  fetchImpl = globalThis.fetch,
  getBaseUrl = getHirePoolBaseUrl
} = {}) {
  const router = Router();

  // 1. Fetch active User Agreement for a role
  router.get('/agreement', async (req, res) => {
    try {
      assertPublicOrigin(req);
      let role = String(req.query.role || '').toLowerCase();
      if (role === 'staffing') role = 'consultancy';
      if (!ALLOWED_USER_TYPES.includes(role)) {
        return res.status(400).json({
          error: { code: 'INVALID_ROLE', message: 'Role must be candidate, client, or consultancy' }
        });
      }

      const baseUrl = getBaseUrl();
      const targetUrl = new URL(`api/v1/agreements/current?role=${encodeURIComponent(role)}`, baseUrl);
      const response = await fetchImpl(targetUrl, {
        headers: { Accept: 'application/json', Host: 'localhost:8000' }
      });

      if (!response.ok) {
        return res.status(response.status).json({
          error: { code: 'AGREEMENT_UNAVAILABLE', message: 'User Agreement is currently unavailable' }
        });
      }

      const agreement = await response.json();
      return res.status(200).json({
        id: agreement.id,
        role: agreement.role,
        version: agreement.version,
        effectiveDate: agreement.effective_date,
        content: agreement.content
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Server error' }
      });
    }
  });

  // 2. Register account (Initiates email verification)
  router.post('/register', async (req, res) => {
    try {
      assertPublicOrigin(req);
      const body = req.body || {};
      const { email, password, confirmPassword, userType, acceptAgreement, agreementVersionId } = body;

      let resolvedUserType = userType;
      let initialConsultancyType = null;
      if (userType === 'staffing') {
        resolvedUserType = 'consultancy';
        initialConsultancyType = 'staffing';
      }

      if (!resolvedUserType || !ALLOWED_USER_TYPES.includes(resolvedUserType)) {
        return res.status(400).json({
          error: { code: 'INVALID_ROLE', message: 'Account type must be candidate, client, or consultancy' }
        });
      }

      const emailValidation = validateEmail(email, { required: true });
      if (!emailValidation.isValid) {
        return res.status(400).json({
          error: { code: 'INVALID_EMAIL', message: emailValidation.error || 'A valid email address is required' }
        });
      }

      const passwordValidation = validatePassword(password, {
        confirmPassword,
        acceptAgreement,
        requireAgreement: true
      });

      if (!passwordValidation.isValid) {
        const firstErr = passwordValidation.firstError;
        let code = 'WEAK_PASSWORD';
        if (firstErr.includes('match')) {
          code = 'PASSWORD_MISMATCH';
        } else if (firstErr.includes('Agreement') || firstErr.includes('agree')) {
          code = 'AGREEMENT_REQUIRED';
        }
        return res.status(400).json({
          error: { code, message: firstErr }
        });
      }

      if (!agreementVersionId) {
        return res.status(400).json({
          error: { code: 'AGREEMENT_VERSION_REQUIRED', message: 'Agreement version ID is required' }
        });
      }

      // Call HirePool backend to register
      const baseUrl = getBaseUrl();
      const targetUrl = new URL('api/v1/auth/register', baseUrl);
      const response = await fetchImpl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Host: 'localhost:8000'
        },
        body: JSON.stringify({
          email: String(email).trim().toLowerCase(),
          password,
          user_type: resolvedUserType,
          accept_agreement: true,
          agreement_version_id: agreementVersionId
        })
      });

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 409) {
          return res.status(409).json({
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'This email address is already registered. Please log in or use password reset.'
            }
          });
        }
        return res.status(response.status).json({
          error: {
            code: 'REGISTRATION_FAILED',
            message: responseData?.detail || responseData?.message || 'HirePool could not process registration.'
          }
        });
      }

      // Create OnboardingSession in SDK
      const signupToken = randomBytes(32).toString('base64url');
      const now = Date.now();
      const session = {
        signupToken,
        userId: responseData?.user?.id || randomUUID(),
        email: String(email).trim().toLowerCase(),
        userType: resolvedUserType,
        stage: 'verification_pending',
        isVerified: false,
        accessToken: responseData?.access_token || null,
        refreshToken: responseData?.refresh_token || null,
        agreementVersionId,
        profileData: initialConsultancyType ? { consultancy_type: initialConsultancyType } : {},
        createdAt: now,
        updatedAt: now,
        expiresAt: now + ONBOARDING_SESSION_TTL_MS
      };

      onboardingSessions.set(signupToken, session);

      const verificationUrl = extractSafeVerificationUrl(
        responseData?.verification_url || responseData?.verificationUrl
      );

      return res.status(201).json({
        status: 'success',
        stage: 'verification_pending',
        signupToken,
        email: session.email,
        userType: session.userType,
        ...(verificationUrl ? { verificationUrl } : {}),
        message: verificationUrl
          ? 'Your verification email has been sent. You can verify your email using the button below.'
          : `Your registration request has been submitted successfully. We've sent an email verification link to ${session.email}.`
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Server error' }
      });
    }
  });

  // 3. Resend verification email
  router.post('/resend-verification', async (req, res) => {
    try {
      assertPublicOrigin(req);
      const { signupToken, email } = req.body || {};
      let targetEmail = email;

      if (signupToken) {
        const session = onboardingSessions.get(signupToken);
        if (session) targetEmail = session.email;
      }

      if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(targetEmail).trim())) {
        return res.status(400).json({
          error: { code: 'INVALID_EMAIL', message: 'Valid email address or signup token required' }
        });
      }

      const baseUrl = getBaseUrl();
      const targetUrl = new URL('api/v1/auth/magic-link', baseUrl);
      const resendRes = await fetchImpl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Host: 'localhost:8000'
        },
        body: JSON.stringify({ email: targetEmail.toLowerCase() })
      });

      const resendData = resendRes?.ok ? await resendRes.json().catch(() => null) : null;
      const verificationUrl = extractSafeVerificationUrl(
        resendData?.verification_url || resendData?.verificationUrl
      );

      return res.status(200).json({
        status: 'success',
        ...(verificationUrl ? { verificationUrl } : {}),
        message: verificationUrl
          ? 'A fresh verification email has been sent. You can verify your email using the button below.'
          : 'A fresh verification email has been requested.'
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Server error' }
      });
    }
  });

  // 4. In-chat verification (accepts verification code/token or pasted link)
  router.post('/verify-email', async (req, res) => {
    try {
      assertPublicOrigin(req);
      const { signupToken, verificationToken } = req.body || {};
      if (!signupToken) {
        return res.status(400).json({
          error: { code: 'SIGNUP_TOKEN_REQUIRED', message: 'Active signup token is required' }
        });
      }

      const session = onboardingSessions.get(signupToken);
      if (!session) {
        return res.status(410).json({
          error: { code: 'SESSION_EXPIRED', message: 'Onboarding session expired. Please restart signup.' }
        });
      }

      if (!verificationToken || typeof verificationToken !== 'string') {
        return res.status(400).json({
          error: { code: 'TOKEN_REQUIRED', message: 'Verification link or token is required' }
        });
      }

      // Extract token if user pasted full URL (e.g., http://localhost:5173/auth/verify-email?token=xyz)
      let rawToken = verificationToken.trim();
      if (rawToken.includes('token=')) {
        try {
          const parsed = new URL(rawToken);
          rawToken = parsed.searchParams.get('token') || rawToken;
        } catch {
          const match = rawToken.match(/[?&]token=([^&]+)/);
          if (match) rawToken = decodeURIComponent(match[1]);
        }
      }

      // Verify token with HirePool backend
      const baseUrl = getBaseUrl();
      const targetUrl = new URL('api/v1/auth/verify-magic-link', baseUrl);
      const response = await fetchImpl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Host: 'localhost:8000'
        },
        body: JSON.stringify({ token: rawToken })
      });

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        return res.status(response.status).json({
          error: {
            code: 'VERIFICATION_FAILED',
            message: responseData?.detail || 'The verification link is invalid or has expired.'
          }
        });
      }

      // Update session with verified state and new access token
      session.isVerified = true;
      session.stage = 'email_verified';
      if (responseData?.access_token) {
        session.accessToken = responseData.access_token;
      }
      if (responseData?.refresh_token) {
        session.refreshToken = responseData.refresh_token;
      }
      session.updatedAt = Date.now();

      return res.status(200).json({
        status: 'success',
        stage: 'email_verified',
        isVerified: true,
        message: 'Your email has been successfully verified! Let\'s complete your HirePool profile.'
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Server error' }
      });
    }
  });

  // 5. Verification status polling / check
  router.post('/check-verification', async (req, res) => {
    try {
      assertPublicOrigin(req);
      const { signupToken } = req.body || {};
      if (!signupToken) {
        return res.status(400).json({
          error: { code: 'SIGNUP_TOKEN_REQUIRED', message: 'Active signup token is required' }
        });
      }

      const session = onboardingSessions.get(signupToken);
      if (!session || session.expiresAt <= Date.now()) {
        if (session) onboardingSessions.delete(signupToken);
        return res.status(410).json({
          error: { code: 'SESSION_EXPIRED', message: 'Onboarding session expired. Please restart signup.' }
        });
      }

      if (session.isVerified) {
        return res.status(200).json({
          status: 'success',
          stage: session.stage,
          isVerified: true
        });
      }

      // Revalidate with HirePool backend if we have access token
      if (session.accessToken) {
        const baseUrl = getBaseUrl();
        const meUrl = new URL('api/v1/auth/me', baseUrl);
        let meRes = await fetchImpl(meUrl, {
          headers: {
            Accept: 'application/json',
            Host: 'localhost:8000',
            Authorization: `Bearer ${session.accessToken}`
          }
        });

        if (meRes.status === 401 && session.refreshToken) {
          const refreshUrl = new URL('api/v1/auth/refresh', baseUrl);
          const refreshRes = await fetchImpl(refreshUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Host: 'localhost:8000'
            },
            body: JSON.stringify({ refresh_token: session.refreshToken })
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json().catch(() => null);
            if (refreshData?.access_token) {
              session.accessToken = refreshData.access_token;
              if (refreshData.refresh_token) {
                session.refreshToken = refreshData.refresh_token;
              }
              meRes = await fetchImpl(meUrl, {
                headers: {
                  Accept: 'application/json',
                  Host: 'localhost:8000',
                  Authorization: `Bearer ${session.accessToken}`
                }
              });
            }
          }
        }

        if (meRes.ok) {
          const meData = await meRes.json().catch(() => null);
          if (meData?.is_verified === true) {
            session.isVerified = true;
            session.stage = 'email_verified';
            session.updatedAt = Date.now();
            return res.status(200).json({
              status: 'success',
              stage: 'email_verified',
              isVerified: true,
              message: 'Your email has been verified! Let\'s complete your profile.'
            });
          }
        }
      }

      return res.status(200).json({
        status: 'success',
        stage: 'verification_pending',
        isVerified: false
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Server error' }
      });
    }
  });

  // 6. Conversational / inline profile field updates
  router.post('/profile-update', async (req, res) => {
    try {
      assertPublicOrigin(req);
      const { signupToken, fields } = req.body || {};
      if (!signupToken) {
        return res.status(400).json({
          error: { code: 'SIGNUP_TOKEN_REQUIRED', message: 'Active signup token is required' }
        });
      }

      const session = onboardingSessions.get(signupToken);
      if (!session) {
        return res.status(410).json({
          error: { code: 'SESSION_EXPIRED', message: 'Onboarding session expired. Please restart signup.' }
        });
      }

      if (!session.isVerified) {
        return res.status(403).json({
          error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before entering profile details.' }
        });
      }

      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        session.profileData = {
          ...session.profileData,
          ...fields
        };
        session.updatedAt = Date.now();
      }

      let validationResult = { isValid: true, errors: {}, sanitizedData: session.profileData };
      if (session.userType === 'candidate') {
        validationResult = validateCandidateProfile(session.profileData, { mode: 'onboarding' });
      } else if (session.userType === 'client') {
        validationResult = validateClientProfile(session.profileData, { mode: 'onboarding' });
      } else if (session.userType === 'consultancy') {
        validationResult = validateConsultancyProfile(session.profileData, { mode: 'onboarding' });
      }

      const missing = getMissingMandatoryFields(session.userType, session.profileData);
      session.stage = (missing.length === 0 && validationResult.isValid) ? 'profile_review' : 'profile_collection';

      return res.status(200).json({
        status: 'success',
        stage: session.stage,
        userType: session.userType,
        profileData: session.profileData,
        missingFields: missing,
        validationErrors: validationResult.errors,
        isComplete: missing.length === 0 && validationResult.isValid
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Server error' }
      });
    }
  });

  // 7. Complete profile submission and transition to authenticated assistant
  router.post('/complete-profile', async (req, res) => {
    try {
      assertPublicOrigin(req);
      const { signupToken, confirmedProfile } = req.body || {};
      if (!signupToken) {
        return res.status(400).json({
          error: { code: 'SIGNUP_TOKEN_REQUIRED', message: 'Active signup token is required' }
        });
      }

      const session = onboardingSessions.get(signupToken);
      if (!session) {
        return res.status(410).json({
          error: { code: 'SESSION_EXPIRED', message: 'Onboarding session expired. Please restart signup.' }
        });
      }

      if (!session.isVerified) {
        return res.status(403).json({
          error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before completing onboarding.' }
        });
      }

      const profilePayload = {
        ...session.profileData,
        ...(confirmedProfile && typeof confirmedProfile === 'object' ? confirmedProfile : {})
      };

      // Perform authoritative schema validation across all roles
      let validationResult;
      if (session.userType === 'candidate') {
        validationResult = validateCandidateProfile(profilePayload, { mode: 'onboarding' });
      } else if (session.userType === 'client') {
        validationResult = validateClientProfile(profilePayload, { mode: 'onboarding' });
      } else if (session.userType === 'consultancy') {
        validationResult = validateConsultancyProfile(profilePayload, { mode: 'onboarding' });
      } else {
        return res.status(400).json({
          error: { code: 'UNSUPPORTED_ROLE', message: `Unsupported role: ${session.userType}` }
        });
      }

      if (!validationResult.isValid) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_FAILED',
            message: validationResult.firstError,
            details: validationResult.errors,
            missingFields: Object.keys(validationResult.errors)
          }
        });
      }

      const sanitized = validationResult.sanitizedData;

      // Format payload according to role
      const baseUrl = getBaseUrl();
      let targetPath = '';
      let readbackPath = '';
      let formattedBody = {};

      if (session.userType === 'candidate') {
        targetPath = 'api/v1/candidates/profile';
        readbackPath = 'api/v1/candidates/profile';
        formattedBody = {
          first_name: sanitized.first_name,
          last_name: sanitized.last_name,
          phone: sanitized.phone || null,
          current_location: sanitized.current_location,
          job_title: sanitized.job_title,
          professional_summary: sanitized.professional_summary || null,
          years_of_experience: sanitized.years_of_experience,
          months_of_experience: sanitized.months_of_experience,
          skills: sanitized.skills,
          preferred_work_types: sanitized.preferred_work_types || [],
          preferred_job_types: sanitized.preferred_job_types || [],
          expected_salary_min: sanitized.expected_salary_min,
          expected_salary_max: sanitized.expected_salary_max,
          salary_currency: sanitized.salary_currency || 'INR',
          notice_period_days: sanitized.notice_period_days,
          linkedin_url: sanitized.linkedin_url,
          github_url: sanitized.github_url,
          portfolio_url: sanitized.portfolio_url
        };
      } else if (session.userType === 'client') {
        targetPath = 'api/v1/clients/profile';
        readbackPath = 'api/v1/clients/profile';
        formattedBody = {
          company_name: sanitized.company_name,
          industry: sanitized.industry,
          company_size: sanitized.company_size,
          headquarters_location: sanitized.headquarters_location,
          company_website: sanitized.company_website,
          about_company: sanitized.about_company || null,
          founding_year: sanitized.founding_year,
          primary_contact: {
            full_name: sanitized.primary_contact.full_name,
            designation: sanitized.primary_contact.designation || null,
            phone: sanitized.primary_contact.phone || null
          }
        };
      } else if (session.userType === 'consultancy') {
        targetPath = 'api/v1/consultancies/profile';
        readbackPath = 'api/v1/consultancies/profile';
        formattedBody = {
          consultancy_name: sanitized.consultancy_name,
          consultancy_type: sanitized.consultancy_type,
          industry_specialization: sanitized.industry_specialization,
          company_size: sanitized.company_size || null,
          headquarters_location: sanitized.headquarters_location,
          website: sanitized.website,
          about_company: sanitized.about_company || null,
          founding_year: sanitized.founding_year,
          primary_contact: {
            full_name: sanitized.primary_contact.full_name,
            designation: sanitized.primary_contact.designation || null,
            phone: sanitized.primary_contact.phone || null
          }
        };
      }

      // Submit profile to HirePool
      const submitUrl = new URL(targetPath, baseUrl);
      const submitRes = await fetchImpl(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Host: 'localhost:8000',
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify(formattedBody)
      });

      const submitData = await submitRes.json().catch(() => null);

      if (!submitRes.ok) {
        return res.status(submitRes.status).json({
          error: {
            code: 'PROFILE_SUBMISSION_FAILED',
            message: submitData?.detail || 'HirePool rejected profile creation.'
          }
        });
      }

      // Readback verification
      const readbackUrl = new URL(readbackPath, baseUrl);
      const readbackRes = await fetchImpl(readbackUrl, {
        headers: {
          Accept: 'application/json',
          Host: 'localhost:8000',
          Authorization: `Bearer ${session.accessToken}`
        }
      });

      if (!readbackRes.ok) {
        return res.status(502).json({
          error: {
            code: 'READBACK_VERIFICATION_FAILED',
            message: 'Profile creation was accepted by HirePool, but readback verification could not confirm the record.'
          }
        });
      }

      const verifiedProfile = await readbackRes.json();

      // Establish verified SDK session
      const sdkSession = storeHirePoolSession(
        session.accessToken,
        {
          id: session.userId,
          email: session.email,
          userType: session.userType,
          organizationRole: session.userType === 'candidate' ? null : 'admin'
        },
        Date.now(),
        Date.now(),
        session.refreshToken || null
      );

      // Mark session as complete
      session.stage = 'completed';
      session.profileData = verifiedProfile;
      session.updatedAt = Date.now();

      return res.status(200).json({
        status: 'success',
        stage: 'completed',
        credential: sdkSession.credential,
        sessionScope: sdkSession.sessionScope,
        expiresIn: sdkSession.expiresIn,
        identity: sdkSession.identity,
        profile: verifiedProfile,
        message: 'Your HirePool account has been successfully created and your profile is complete. You can now use the assistant to access your account and perform supported actions.'
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Server error' }
      });
    }
  });

  // 8. Cancel onboarding session
  router.post('/cancel', (req, res) => {
    try {
      assertPublicOrigin(req);
      const { signupToken } = req.body || {};
      if (signupToken) {
        onboardingSessions.delete(signupToken);
      }
      return res.status(200).json({ status: 'cancelled' });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Server error' }
      });
    }
  });

  // 9. Session validate endpoint for signup handoff
  router.get('/validate', (req, res, next) => {
    try {
      assertPublicOrigin(req);
      const credentials = extractCredentials(req);
      if (credentials?.type !== 'bearer' || !credentials.token) {
        throw new AuthenticationError('An SDK session credential is required', 'MISSING_CREDENTIALS');
      }
      const context = findHirePoolContextBySdkCredential(credentials.token);
      if (!context) {
        throw new AuthenticationError('The SDK session is no longer valid', 'INVALID_CREDENTIALS');
      }
      return res.status(200).json({
        valid: true,
        identity: context.identity,
        sessionScope: context.sessionScope,
        expiresIn: Math.max(0, Math.floor((context.expiresAt - Date.now()) / 1000))
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
