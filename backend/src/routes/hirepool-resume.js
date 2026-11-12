import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { getDynamicApiIntegration } from '../dynamic-api/catalog.js';
import { getDynamicApiLimits, getAllowedApiHosts, requestJson } from '../dynamic-api/secure-http.js';
import { authenticate } from '../middleware/auth.js';
import { createSessionOptions } from '../session-scope.js';
import { sessionManager } from '../session-manager.js';
import { HIREPOOL_LOCAL_INTEGRATION_ID } from '../../../integrations/hirepool/local-development.js';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const PROFILE_READ_OPERATION = 'get_my_profile_api_v1_candidates_profile_get';
const RESUME_UPLOAD_PATH = '/api/v1/candidates/profile/resume';
const pendingResumeUploads = new Map();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RESUME_BYTES }
});

export function cleanupExpiredHirePoolResumeUploads(now = Date.now()) {
  for (const [token, item] of pendingResumeUploads) {
    if (item.state === 'pending' && item.expiresAt <= now) {
      pendingResumeUploads.delete(token);
      item.buffer.fill(0);
    }
  }
}

export function invalidateHirePoolResumeUploads(integrationSessionId) {
  for (const [token, item] of pendingResumeUploads) {
    if (item.integrationSessionId !== integrationSessionId) continue;
    if (item.state === 'pending') {
      item.state = 'cancelled';
      item.buffer.fill(0);
      pendingResumeUploads.delete(token);
    } else if (item.state === 'executing') {
      item.state = 'revoked';
    }
  }
}

function replacePendingUploadForSession(integrationSessionId) {
  for (const [token, item] of pendingResumeUploads) {
    if (item.integrationSessionId === integrationSessionId && item.state === 'pending') {
      item.state = 'cancelled';
      item.buffer.fill(0);
      pendingResumeUploads.delete(token);
    }
  }
}

const cleanupTimer = setInterval(() => cleanupExpiredHirePoolResumeUploads(), 30_000);
cleanupTimer.unref?.();

function assertCandidatePrincipal(user) {
  if (user?.assistantId !== 'hirepool' ||
      user?.applicationId !== 'hirepool-local-app' ||
      user?.role !== 'candidate' ||
      typeof user?.integrationSessionId !== 'string') {
    const error = new Error('A verified HirePool candidate session is required.');
    error.statusCode = 403;
    throw error;
  }
}

async function getIntegration(user) {
  assertCandidatePrincipal(user);
  const integration = getDynamicApiIntegration(HIREPOOL_LOCAL_INTEGRATION_ID);
  if (!integration ||
      !integration.enabled ||
      !integration.roleOperationIds?.candidate?.includes(PROFILE_READ_OPERATION) ||
      !await integration.authorize(user)) {
    const error = new Error('The verified HirePool candidate integration is unavailable.');
    error.statusCode = 403;
    throw error;
  }
  return integration;
}

function getResumeReference(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

function assertProfileResponse(profile) {
  if (!profile || typeof profile !== 'object' ||
      typeof profile.id !== 'string' ||
      !(profile.resume_url === null || typeof profile.resume_url === 'string')) {
    const error = new Error('HirePool returned an unexpected candidate profile response.');
    error.code = 'PROFILE_SCHEMA_INVALID';
    throw error;
  }
  return profile;
}

async function getCandidateProfile(user, integration, request = requestJson, signal) {
  const endpoint = new URL('api/v1/candidates/profile', integration.apiBaseUrl).toString();
  const allowedHosts = new Set(
    integration.allowedHosts.filter(host => getAllowedApiHosts().has(host))
  );
  const limits = getDynamicApiLimits({
    API_DISCOVERY_TIMEOUT_MS: String(integration.limits.timeoutMs)
  });
  const profile = await request(endpoint, {
    allowedHosts,
    allowLocalDevelopment: integration.allowLocalDevelopment,
    allowedPorts: integration.allowLocalDevelopment ? [8000] : [],
    headers: await integration.getAuthHeaders(user),
    method: 'GET',
    timeoutMs: limits.timeoutMs,
    maxBytes: integration.limits.maxResponseBytes,
    signal
  });
  return assertProfileResponse(profile);
}

function createMultipartBody(buffer, filename) {
  const boundary = `hirepool-${randomBytes(18).toString('hex')}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
    'utf8'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([header, buffer, footer]),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function sendResumeToHirePool(buffer, user, integration, request = requestJson, onRequestStarted) {
  const endpoint = new URL(RESUME_UPLOAD_PATH.slice(1), integration.apiBaseUrl).toString();
  const headers = await integration.getAuthHeaders(user);
  const hosts = new Set(
    integration.allowedHosts.filter(host => getAllowedApiHosts().has(host))
  );
  const limits = getDynamicApiLimits({
    API_DISCOVERY_TIMEOUT_MS: String(integration.limits.timeoutMs)
  });
  const multipart = createMultipartBody(buffer, `${randomUUID()}.pdf`);
  onRequestStarted?.();
  const result = await request(endpoint, {
    allowedHosts: hosts,
    allowLocalDevelopment: integration.allowLocalDevelopment,
    allowedPorts: integration.allowLocalDevelopment ? [8000] : [],
    headers,
    method: 'POST',
    body: multipart.body,
    rawBody: true,
    maxRequestBytes: MAX_RESUME_BYTES + 1024,
    contentType: multipart.contentType,
    timeoutMs: limits.timeoutMs,
    maxBytes: 16 * 1024
  });
  if (!result || typeof result !== 'object' ||
      typeof result.message !== 'string' ||
      typeof result.resume_url !== 'string' || !result.resume_url) {
    const error = new Error('HirePool returned an unexpected resume upload response.');
    error.code = 'UPLOAD_ACCEPTED_UNVERIFIED';
    throw error;
  }
  return { message: result.message };
}

function uploadErrorResponse(error, { uploadStarted = false } = {}) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : null;
  if (error?.code === 'UPLOAD_ACCEPTED_UNVERIFIED' ||
      (uploadStarted && (statusCode === null || statusCode >= 500))) {
    return {
      status: 502,
      body: {
        status: 'uploaded_unverified',
        error: {
          code: error?.code || 'UPLOAD_OUTCOME_UNVERIFIED',
          message: 'HirePool may have accepted the resume, but its outcome could not be verified. Do not retry yet; check your HirePool profile before preparing another upload.'
        }
      }
    };
  }
  const status = statusCode || 502;
  const message = status === 401
    ? 'Your HirePool session expired. Sign in again before uploading the resume.'
    : status === 403
      ? 'HirePool denied this candidate resume operation.'
      : status === 404
        ? 'Create your candidate profile before uploading a resume.'
        : status === 400 || status === 413
          ? error.message
          : 'HirePool could not complete the resume upload. Your current resume was not intentionally removed.';
  return { status, body: { error: { code: error?.code || 'RESUME_UPLOAD_FAILED', message } } };
}

export function createHirePoolResumeRouter({ request = requestJson, now = Date.now } = {}) {
  const router = Router();
  router.use(authenticate());

  router.post('/prepare', (req, res, next) => {
    upload.single('file')(req, res, async error => {
      if (error) {
        return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
          error: {
            code: error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
            message: error.code === 'LIMIT_FILE_SIZE'
              ? 'Resume PDF must be 5 MB or smaller.'
              : 'Resume upload could not be read.'
          }
        });
      }

      try {
        const user = req.user;
        const integration = await getIntegration(user);
        const file = req.file;
        if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
          return res.status(400).json({
            error: { code: 'MISSING_FILE', message: 'Select a PDF resume to upload.' }
          });
        }
        if (!file.originalname.toLowerCase().endsWith('.pdf') ||
            !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          return res.status(400).json({
            error: { code: 'INVALID_PDF', message: 'Only a valid PDF resume is supported.' }
          });
        }

        const sessionOptions = createSessionOptions(user, 'hirepool');
        const conversationId = typeof req.body?.conversationId === 'string'
          ? req.body.conversationId
          : undefined;
        const session = sessionManager.getOrCreate(conversationId, 'hirepool', sessionOptions);
        const profile = await getCandidateProfile(user, integration, request);
        if (typeof profile?.id !== 'string') {
          return res.status(502).json({
            error: { code: 'PROFILE_SCHEMA_INVALID', message: 'HirePool returned an unexpected profile response.' }
          });
        }

        const token = randomBytes(32).toString('base64url');
        const safeFilename = file.originalname
          .replace(/[\r\n\x00-\x1f\x7f]/g, '')
          .slice(0, 160) || 'resume.pdf';
        replacePendingUploadForSession(user.integrationSessionId);
        pendingResumeUploads.set(token, {
          buffer: Buffer.from(file.buffer),
          filename: safeFilename,
          userId: user.id,
          integrationSessionId: user.integrationSessionId,
          conversationId: session.id,
          priorResumeReference: getResumeReference(profile.resume_url),
          expiresAt: now() + CONFIRMATION_TTL_MS,
          state: 'pending'
        });

        return res.json({
          status: 'requires_confirmation',
          conversationId: session.id,
          filename: safeFilename,
          fileSize: file.size,
          replacingExisting: Boolean(profile.resume_url),
          confirmationToken: token
        });
      } catch (caught) {
        const response = uploadErrorResponse(caught);
        return res.status(response.status).json(response.body);
      } finally {
        req.file?.buffer?.fill(0);
      }
    });
  });

  router.post('/confirm', async (req, res) => {
    try {
      const user = req.user;
      assertCandidatePrincipal(user);
      const body = req.body;
      if (!body || Object.keys(body).some(key => !['confirmationToken', 'conversationId'].includes(key)) ||
          typeof body.confirmationToken !== 'string' ||
          typeof body.conversationId !== 'string') {
        return res.status(400).json({
          error: { code: 'INVALID_CONFIRMATION', message: 'A valid resume-upload confirmation is required.' }
        });
      }
      const staged = pendingResumeUploads.get(body.confirmationToken);
      if (!staged) {
        return res.status(410).json({
          error: { code: 'CONFIRMATION_EXPIRED', message: 'This resume confirmation expired. Select the PDF again to prepare a fresh upload.' }
        });
      }
      if (staged.state === 'executing' || staged.state === 'revoked') {
        return res.status(409).json({
          error: { code: 'CONFIRMATION_CONSUMED', message: 'This resume confirmation has already been used or invalidated. Prepare a fresh upload after checking your profile.' }
        });
      }
      if (staged.expiresAt <= now()) {
        pendingResumeUploads.delete(body.confirmationToken);
        staged.state = 'expired';
        staged.buffer.fill(0);
        return res.status(410).json({
          error: { code: 'CONFIRMATION_EXPIRED', message: 'This resume confirmation expired. Select the PDF again to prepare a fresh upload.' }
        });
      }
      if (staged.userId !== user.id ||
          staged.integrationSessionId !== user.integrationSessionId ||
          staged.conversationId !== body.conversationId) {
        staged.state = 'cancelled';
        staged.buffer.fill(0);
        pendingResumeUploads.delete(body.confirmationToken);
        return res.status(403).json({
          error: { code: 'CONFIRMATION_OWNER_MISMATCH', message: 'This confirmation belongs to a different candidate session.' }
        });
      }

      const sessionOptions = createSessionOptions(user, 'hirepool');
      sessionManager.getOrCreate(staged.conversationId, 'hirepool', sessionOptions);
      staged.state = 'executing';
      let uploadStarted = false;
      try {
        let integration = await getIntegration(user);
        const currentProfile = await getCandidateProfile(user, integration, request);
        if (getResumeReference(currentProfile.resume_url) !== staged.priorResumeReference) {
          return res.status(409).json({
            error: { code: 'PROFILE_CHANGED', message: 'Your saved resume changed after this preview. Select the PDF again to prepare a fresh confirmation.' }
          });
        }
        if (staged.state !== 'executing') {
          return res.status(401).json({
            error: { code: 'SESSION_REVOKED', message: 'Your HirePool session ended before the upload began. Sign in again and prepare a fresh upload.' }
          });
        }
        integration = await getIntegration(user);
        const uploadResult = await sendResumeToHirePool(
          staged.buffer,
          user,
          integration,
          request,
          () => { uploadStarted = true; }
        );
        let verifiedProfile;
        try {
          verifiedProfile = await getCandidateProfile(user, integration, request);
        } catch {
          return res.status(502).json({
            status: 'uploaded_unverified',
            error: { code: 'RESUME_READBACK_FAILED', message: 'HirePool accepted the upload, but the fresh profile read could not verify it. Check your HirePool profile before preparing another upload.' }
          });
        }
        if (!verifiedProfile.resume_url ||
            getResumeReference(verifiedProfile.resume_url) === staged.priorResumeReference) {
          return res.status(502).json({
            status: 'uploaded_unverified',
            error: { code: 'RESUME_READBACK_FAILED', message: 'HirePool accepted the upload, but the fresh profile read did not verify a changed saved resume. Check your HirePool profile before preparing another upload.' }
          });
        }
        return res.json({
          status: 'success',
          filename: staged.filename,
          verified: true,
          message: uploadResult.message
        });
      } catch (error) {
        const response = uploadErrorResponse(error, { uploadStarted });
        return res.status(response.status).json(response.body);
      } finally {
        staged.buffer.fill(0);
        pendingResumeUploads.delete(body.confirmationToken);
      }
    } catch (error) {
      const response = uploadErrorResponse(error);
      return res.status(response.status).json(response.body);
    }
  });

  router.post('/cancel', (req, res) => {
    const user = req.user;
    const body = req.body;
    try {
      assertCandidatePrincipal(user);
    } catch (error) {
      return res.status(error.statusCode || 403).json({
        error: { code: 'FORBIDDEN', message: error.message }
      });
    }
    if (!body || Object.keys(body).some(key =>
      !['confirmationToken', 'conversationId'].includes(key)
    ) || typeof body.confirmationToken !== 'string' ||
        typeof body.conversationId !== 'string') {
      return res.status(400).json({
        error: { code: 'INVALID_CONFIRMATION', message: 'A valid resume-upload cancellation is required.' }
      });
    }
    const staged = pendingResumeUploads.get(body.confirmationToken);
    if (!staged ||
        staged.userId !== user.id ||
        staged.integrationSessionId !== user.integrationSessionId ||
        staged.conversationId !== body.conversationId ||
        staged.state !== 'pending') {
      return res.status(404).json({
        error: { code: 'CONFIRMATION_NOT_FOUND', message: 'The pending resume upload was not found.' }
      });
    }
    staged.state = 'cancelled';
    staged.buffer.fill(0);
    pendingResumeUploads.delete(body.confirmationToken);
    return res.json({ status: 'cancelled' });
  });

  return router;
}
