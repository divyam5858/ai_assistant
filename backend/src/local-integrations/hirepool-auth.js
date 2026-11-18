import { Router } from 'express';
import { extractCredentials, AuthenticationError } from '../middleware/auth.js';
import { invalidateHirePoolResumeUploads } from '../routes/hirepool-resume.js';
import {
  createHirePoolPrincipal,
  findHirePoolContextBySdkCredential,
  getHirePoolSessionByAccessToken,
  getHirePoolSessionTtlMs,
  refreshHirePoolSessionTokens,
  revokeHirePoolSessionBySdkCredential,
  revokeHirePoolSessionWithBackend,
  storeHirePoolSession
} from './hirepool-session-store.js';
import {
  consumeHirePoolContinuation,
  getHirePoolContinuation
} from './hirepool-continuation-store.js';
import { sessionManager } from '../session-manager.js';
import { createSessionOptions } from '../session-scope.js';
import {
  HIREPOOL_LOCAL_DASHBOARD_ORIGINS,
  HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS
} from '../../../config/hirepool-site-policy.js';
import { HIREPOOL_LOCAL_EXTENSION_ORIGIN } from '../../../extension/hirepool/site-policy.js';

const ALLOWED_USER_TYPES = new Set(['candidate', 'client', 'consultancy']);
const ALLOWED_CLIENT_ROLES = new Set(['admin', 'hiring_manager', 'recruiter']);
const ALLOWED_CONSULTANCY_ROLES = new Set(['admin', 'recruiter', 'member']);
const MAX_IDENTITY_RESPONSE_BYTES = 32 * 1024;
const IDENTITY_CACHE_MS = 30 * 1000;
const warnedOrigins = new Set();

export function isHirePoolLocalBridgeEnabled(env = process.env) {
  return (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') &&
    env.VERCEL_ENV !== 'production' &&
    env.ENABLE_HIREPOOL_LOCAL_BRIDGE === 'true' &&
    env.DYNAMIC_API_DISCOVERY_ENABLED === 'true';
}

function getLocalApiBaseUrl(env = process.env) {
  const value = env.HIREPOOL_LOCAL_API_BASE_URL || 'http://localhost:8000/';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('HIREPOOL_LOCAL_API_BASE_URL must be the configured local HirePool API origin');
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== 'localhost' ||
    url.port !== '8000' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('HIREPOOL_LOCAL_API_BASE_URL must be http://localhost:8000/');
  }
  return url;
}

function getAllowedOrigins(env = process.env) {
  const origins = String(env.HIREPOOL_LOCAL_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set();
  for (const origin of origins) {
    if (origin === HIREPOOL_LOCAL_EXTENSION_ORIGIN && isHirePoolLocalBridgeEnabled(env)) {
      allowedOrigins.add(origin);
      continue;
    }

    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('HIREPOOL_LOCAL_ALLOWED_ORIGINS must contain exact local HTTP origins');
    }
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !['3000', '3001', '5173'].includes(url.port) ||
      origin !== url.origin
    ) {
      throw new Error('HIREPOOL_LOCAL_ALLOWED_ORIGINS must contain exact local website or pinned extension origins');
    }
    if (
      HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS.includes(origin) ||
      HIREPOOL_LOCAL_DASHBOARD_ORIGINS.includes(origin)
    ) {
      allowedOrigins.add(origin);
    } else if (!warnedOrigins.has(origin)) {
      warnedOrigins.add(origin);
      console.warn(`[HirePool] Ignoring non-public local bridge origin: ${origin}`);
    }
  }
  if (isHirePoolLocalBridgeEnabled(env) && allowedOrigins.size === 0) {
    throw new Error('HIREPOOL_LOCAL_ALLOWED_ORIGINS must be configured for the local bridge');
  }
  return allowedOrigins;
}

function assertAllowedOrigin(req) {
  const origin = req.get('Origin');
  if (process.env.NODE_ENV === 'test' && !origin) {
    return;
  }
  if (!origin || !getAllowedOrigins().has(origin)) {
    throw new AuthenticationError('Local HirePool bridge origin is not allowed', 'ORIGIN_NOT_ALLOWED');
  }
}

function assertSessionValidateOrigin(req) {
  const origin = req.get('Origin');
  if (process.env.NODE_ENV === 'test' && !origin) {
    return;
  }
  if (!origin) {
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return;
    }
    throw new AuthenticationError('Origin header is required', 'ORIGIN_NOT_ALLOWED');
  }
  const isAllowedPublic = HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS.includes(origin);
  const isAllowedDashboard = HIREPOOL_LOCAL_DASHBOARD_ORIGINS.includes(origin);
  const isAllowedExtension = origin === HIREPOOL_LOCAL_EXTENSION_ORIGIN;
  if (!isAllowedPublic && !isAllowedDashboard && !isAllowedExtension) {
    throw new AuthenticationError('Local HirePool bridge origin is not allowed', 'ORIGIN_NOT_ALLOWED');
  }
}

function assertExtensionOrigin(req) {
  if (req.get('Origin') !== HIREPOOL_LOCAL_EXTENSION_ORIGIN) {
    throw new AuthenticationError('The local HirePool extension origin is required', 'ORIGIN_NOT_ALLOWED');
  }
}

function assertSessionOrigin(req) {
  const origin = req.get('Origin');
  if (
    origin !== HIREPOOL_LOCAL_EXTENSION_ORIGIN &&
    !HIREPOOL_LOCAL_DASHBOARD_ORIGINS.includes(origin)
  ) {
    throw new AuthenticationError('A trusted local HirePool account origin is required', 'ORIGIN_NOT_ALLOWED');
  }
}

async function requestHirePoolJson(url, accessToken) {
  const requestUrl = new URL(url);
  requestUrl.hostname = '127.0.0.1';
  let response;
  try {
    response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Host: 'localhost:8000',
        Authorization: `Bearer ${accessToken}`
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new AuthenticationError('Local HirePool identity validation is unavailable', 'IDENTITY_UNAVAILABLE');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AuthenticationError('HirePool rejected the supplied access token', 'INVALID_HOST_CREDENTIAL');
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    await response.body?.cancel();
    throw new AuthenticationError('HirePool returned an unsupported identity response', 'INVALID_HOST_RESPONSE');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new AuthenticationError('HirePool returned an unreadable identity response', 'INVALID_HOST_RESPONSE');
  }
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_IDENTITY_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AuthenticationError('HirePool identity response exceeded the size limit', 'INVALID_HOST_RESPONSE');
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (length > MAX_IDENTITY_RESPONSE_BYTES) {
    throw new AuthenticationError('HirePool identity response exceeded the size limit', 'INVALID_HOST_RESPONSE');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthenticationError('HirePool returned an invalid identity response', 'INVALID_HOST_RESPONSE');
  }
}

async function validateHirePoolIdentity(accessToken) {
  const baseUrl = getLocalApiBaseUrl();
  const identity = await requestHirePoolJson(new URL('api/v1/auth/me', baseUrl), accessToken);
  if (
    typeof identity?.id !== 'string' ||
    !identity.id ||
    typeof identity.email !== 'string' ||
    !identity.email ||
    identity.email.length > 320 ||
    !ALLOWED_USER_TYPES.has(identity.user_type) ||
    identity.is_active !== true ||
    identity.is_verified !== true
  ) {
    throw new AuthenticationError('HirePool identity is not eligible for this local integration', 'INELIGIBLE_HOST_IDENTITY');
  }

  let organizationRole = null;
  if (identity.user_type === 'client' || identity.user_type === 'consultancy') {
    const allowedRoles = identity.user_type === 'client'
      ? ALLOWED_CLIENT_ROLES
      : ALLOWED_CONSULTANCY_ROLES;
    const membershipEndpoint = identity.user_type === 'client'
      ? 'api/v1/clients/me'
      : 'api/v1/consultancies/me';
    const membership = await requestHirePoolJson(new URL(membershipEndpoint, baseUrl), accessToken);
    if (!allowedRoles.has(membership?.role)) {
      throw new AuthenticationError('HirePool team role is not eligible for this local integration', 'INELIGIBLE_HOST_ROLE');
    }
    organizationRole = membership.role;
  }

  return {
    id: identity.id,
    email: identity.email,
    userType: identity.user_type,
    organizationRole
  };
}

export const hirePoolAuthRouter = Router();

hirePoolAuthRouter.post('/session', async (req, res, next) => {
  try {
    if (!isHirePoolLocalBridgeEnabled()) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    assertSessionOrigin(req);
    const credentials = extractCredentials(req);
    if (credentials?.type !== 'bearer' || credentials.token.length > 8192) {
      throw new AuthenticationError('A HirePool access token is required', 'MISSING_CREDENTIALS');
    }

    const refreshToken = req.body?.refreshToken || req.headers['x-refresh-token'] || null;
    const cached = getHirePoolSessionByAccessToken(credentials.token);
    if (cached && Date.now() - cached.validatedAt < IDENTITY_CACHE_MS) {
      const session = storeHirePoolSession(credentials.token, cached.identity, Date.now(), cached.validatedAt, refreshToken);
      return res.status(200).json(session);
    }
    const identity = await validateHirePoolIdentity(credentials.token);
    return res.status(200).json(storeHirePoolSession(credentials.token, identity, Date.now(), Date.now(), refreshToken));
  } catch (error) {
    next(error);
  }
});

hirePoolAuthRouter.get('/session/validate', (req, res, next) => {
  try {
    if (!isHirePoolLocalBridgeEnabled()) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    assertSessionValidateOrigin(req);
    const credentials = extractCredentials(req);
    if (credentials?.type !== 'bearer' || !credentials.token) {
      throw new AuthenticationError('An SDK session credential is required', 'MISSING_CREDENTIALS');
    }
    const context = findHirePoolContextBySdkCredential(credentials.token);
    if (!context) {
      throw new AuthenticationError('The SDK session is no longer valid', 'INVALID_CREDENTIALS');
    }
    res.status(200).json({
      valid: true,
      identity: context.identity,
      sessionScope: context.sessionScope,
      expiresIn: Math.max(0, Math.floor((context.expiresAt - Date.now()) / 1000))
    });
  } catch (error) {
    next(error);
  }
});

hirePoolAuthRouter.post('/session/revoke', async (req, res, next) => {
  try {
    if (!isHirePoolLocalBridgeEnabled()) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    assertAllowedOrigin(req);
    const credentials = extractCredentials(req);
    if (credentials?.type !== 'bearer') {
      throw new AuthenticationError('An SDK session credential is required', 'MISSING_CREDENTIALS');
    }
    const context = findHirePoolContextBySdkCredential(credentials.token);
    if (context) {
      invalidateHirePoolResumeUploads(context.sessionId);
      if (context.identity?.id) {
        sessionManager.destroyByUser(context.identity.id, 'hirepool');
      }
    }
    const baseUrl = getLocalApiBaseUrl();
    await revokeHirePoolSessionWithBackend(credentials.token, {
      apiBaseUrl: baseUrl.origin
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

hirePoolAuthRouter.post('/session/logout', async (req, res, next) => {
  try {
    if (!isHirePoolLocalBridgeEnabled()) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    assertSessionValidateOrigin(req);
    const credentials = extractCredentials(req);
    const conversationId = typeof req.body?.conversationId === 'string' && req.body.conversationId.trim()
      ? req.body.conversationId.trim()
      : null;

    if (credentials?.type !== 'bearer' || !credentials.token) {
      if (conversationId) {
        try {
          sessionManager.destroy(conversationId, { assistantId: 'hirepool', userId: null });
        } catch {}
      }
      return res.status(200).json({
        loggedOut: true,
        sdkSessionRevoked: false,
        backendRevoked: false,
        reason: 'No active SDK session credential was present.'
      });
    }

    const context = findHirePoolContextBySdkCredential(credentials.token);
    const principal = context ? createHirePoolPrincipal(context) : null;
    if (context) {
      invalidateHirePoolResumeUploads(context.sessionId);
    }
    if (conversationId && principal) {
      try {
        sessionManager.destroy(conversationId, createSessionOptions(principal, 'hirepool'));
      } catch {}
    }
    if (context?.identity?.id) {
      sessionManager.destroyByUser(context.identity.id, 'hirepool');
    }

    const baseUrl = getLocalApiBaseUrl();
    const revocation = await revokeHirePoolSessionWithBackend(credentials.token, {
      apiBaseUrl: baseUrl.origin
    });

    return res.status(200).json({
      loggedOut: true,
      sdkSessionRevoked: revocation.hadSdkSession,
      backendRevoked: revocation.backendRevoked,
      reason: revocation.reason || null
    });
  } catch (error) {
    next(error);
  }
});

hirePoolAuthRouter.post('/session/refresh', async (req, res, next) => {
  try {
    if (!isHirePoolLocalBridgeEnabled()) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    assertAllowedOrigin(req);
    const credentials = extractCredentials(req);
    if (credentials?.type !== 'bearer') {
      throw new AuthenticationError('An SDK session credential is required', 'MISSING_CREDENTIALS');
    }
    const context = findHirePoolContextBySdkCredential(credentials.token);
    if (!context) {
      throw new AuthenticationError('The SDK session is no longer valid', 'INVALID_CREDENTIALS');
    }
    if (!context.refreshToken) {
      return res.status(400).json({
        error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token available for this session' }
      });
    }
    const baseUrl = getLocalApiBaseUrl();
    const newAccessToken = await refreshHirePoolSessionTokens(context.sessionId, baseUrl.origin);
    if (!newAccessToken) {
      throw new AuthenticationError('HirePool refresh token expired or revoked', 'REFRESH_FAILED');
    }
    res.status(200).json({
      success: true,
      credential: context.credential,
      expiresIn: getHirePoolSessionTtlMs()
    });
  } catch (error) {
    next(error);
  }
});

hirePoolAuthRouter.post('/continuation/consume', (req, res, next) => {
  try {
    if (!isHirePoolLocalBridgeEnabled()) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    assertExtensionOrigin(req);
    const credentials = extractCredentials(req);
    if (credentials?.type !== 'bearer') {
      throw new AuthenticationError('An SDK session credential is required', 'MISSING_CREDENTIALS');
    }
    const principal = authenticateHirePoolLocalCredential(credentials.token);
    if (!principal) {
      throw new AuthenticationError('The SDK session is no longer valid', 'INVALID_CREDENTIALS');
    }

    const reference = req.body?.continuationReference;
    const pending = getHirePoolContinuation(reference);
    if (!pending) {
      return res.status(410).json({
        error: { code: 'CONTINUATION_EXPIRED', message: 'This login continuation has expired or was already used' }
      });
    }

    const sessionOptions = createSessionOptions(principal, 'hirepool');
    sessionManager.getOrCreate(pending.conversationId, 'hirepool', sessionOptions);
    const consumed = consumeHirePoolContinuation(reference);
    if (!consumed) {
      return res.status(410).json({
        error: { code: 'CONTINUATION_EXPIRED', message: 'This login continuation has expired or was already used' }
      });
    }

    res.status(200).json(consumed);
  } catch (error) {
    next(error);
  }
});

export function authenticateHirePoolLocalCredential(token) {
  const context = findHirePoolContextBySdkCredential(token);
  return context ? createHirePoolPrincipal(context) : null;
}
