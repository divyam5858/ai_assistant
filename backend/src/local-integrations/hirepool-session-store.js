import { createHash, randomBytes, randomUUID } from 'node:crypto';

const contextsByCredential = new Map();
const credentialsByAccessToken = new Map();
// Default to 24 hours (matching HirePool's access token expiration) unless explicitly configured
const SESSION_TTL_MS = process.env.HIREPOOL_SESSION_TTL_MS
  ? Number.parseInt(process.env.HIREPOOL_SESSION_TTL_MS, 10)
  : 24 * 60 * 60 * 1000;

// Mutex to prevent simultaneous refresh requests from racing
const inFlightRefreshes = new Map();

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function removeContext(context) {
  contextsByCredential.delete(context.credentialDigest);
  if (credentialsByAccessToken.get(context.accessTokenDigest) === context.credentialDigest) {
    credentialsByAccessToken.delete(context.accessTokenDigest);
  }
  context.accessToken = '';
  context.refreshToken = '';
}

function cleanupExpired(now = Date.now()) {
  for (const context of contextsByCredential.values()) {
    if (context.expiresAt <= now) removeContext(context);
  }
}

const cleanupTimer = setInterval(cleanupExpired, 30_000);
cleanupTimer.unref?.();

/**
 * Checks if a JWT token has expired or is nearing expiry.
 */
export function isTokenExpired(token, thresholdSeconds = 60) {
  if (typeof token !== 'string' || !token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false; // not a standard JWT, let server validate
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.exp) return false;
    return (payload.exp - thresholdSeconds) * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export function getHirePoolSessionByAccessToken(accessToken) {
  cleanupExpired();
  const credentialDigest = credentialsByAccessToken.get(digest(accessToken));
  const context = credentialDigest ? contextsByCredential.get(credentialDigest) : null;
  return context || null;
}

export function storeHirePoolSession(
  accessToken,
  identity,
  now = Date.now(),
  validatedAt = now,
  refreshToken = null
) {
  cleanupExpired(now);
  const accessTokenDigest = digest(accessToken);
  const existingCredentialDigest = credentialsByAccessToken.get(accessTokenDigest);
  const existing = existingCredentialDigest
    ? contextsByCredential.get(existingCredentialDigest)
    : null;

  if (existing) {
    existing.identity = identity;
    existing.validatedAt = validatedAt;
    existing.lastActiveAt = now;
    existing.expiresAt = now + SESSION_TTL_MS;
    if (refreshToken) existing.refreshToken = refreshToken;
    return toPublicSession(existing);
  }

  const credential = randomBytes(32).toString('base64url');
  const credentialDigest = digest(credential);
  const context = {
    credential,
    credentialDigest,
    accessToken,
    accessTokenDigest,
    refreshToken: refreshToken || null,
    sessionId: randomUUID(),
    sessionScope: randomBytes(24).toString('base64url'),
    identity,
    validatedAt: now,
    lastActiveAt: now,
    expiresAt: now + SESSION_TTL_MS
  };
  contextsByCredential.set(credentialDigest, context);
  credentialsByAccessToken.set(accessTokenDigest, credentialDigest);
  return toPublicSession(context);
}

function toPublicSession(context, now = Date.now()) {
  const remainingMs = Math.max(0, (context.expiresAt || now) - now);
  // Cap at 300000 ms (5 minutes) to satisfy HirePool host session handoff validation:
  // LocalAssistantWidget.tsx & AuthContext.tsx strictly require 1000 <= expiresIn <= 300000.
  const hostExpiresIn = Math.min(Math.max(remainingMs, 1000), 300000);
  return {
    credential: context.credential,
    sessionScope: context.sessionScope,
    expiresIn: hostExpiresIn,
    identity: {
      id: context.identity.id,
      email: context.identity.email,
      userType: context.identity.userType,
      organizationRole: context.identity.organizationRole || null
    }
  };
}

export function findHirePoolContextBySdkCredential(credential, now = Date.now()) {
  cleanupExpired(now);
  if (typeof credential !== 'string' || !credential) return null;
  return contextsByCredential.get(digest(credential)) || null;
}

export function getHirePoolContextBySessionId(sessionId, now = Date.now()) {
  cleanupExpired(now);
  if (typeof sessionId !== 'string' || !sessionId) return null;
  for (const context of contextsByCredential.values()) {
    if (context.sessionId === sessionId) return context;
  }
  return null;
}

export function touchHirePoolSession(credential, now = Date.now()) {
  const context = findHirePoolContextBySdkCredential(credential, now);
  if (context && context.expiresAt > now) {
    context.lastActiveAt = now;
    context.expiresAt = now + SESSION_TTL_MS;
    return true;
  }
  return false;
}

export function updateHirePoolSessionTokens(sessionId, newAccessToken, newRefreshToken = null) {
  const context = getHirePoolContextBySessionId(sessionId);
  if (!context) return false;

  // Remove old token digest mapping
  credentialsByAccessToken.delete(context.accessTokenDigest);

  // Set new tokens
  context.accessToken = newAccessToken;
  context.accessTokenDigest = digest(newAccessToken);
  if (newRefreshToken) {
    context.refreshToken = newRefreshToken;
  }
  context.validatedAt = Date.now();
  context.lastActiveAt = Date.now();
  context.expiresAt = Date.now() + SESSION_TTL_MS;

  // Map new access token digest to credential
  credentialsByAccessToken.set(context.accessTokenDigest, context.credentialDigest);
  return true;
}

/**
 * Refreshes tokens for an active session using HirePool's POST /api/v1/auth/refresh.
 * Mutex-protected against concurrent refreshes.
 */
export async function refreshHirePoolSessionTokens(sessionId, baseUrl = 'http://127.0.0.1:8000') {
  const context = getHirePoolContextBySessionId(sessionId);
  if (!context || !context.refreshToken) {
    return null;
  }

  // If a refresh is already in-flight for this session, await that instead of duplicate calls
  if (inFlightRefreshes.has(sessionId)) {
    return inFlightRefreshes.get(sessionId);
  }

  const refreshPromise = (async () => {
    try {
      const refreshUrl = new URL('api/v1/auth/refresh', baseUrl);
      refreshUrl.hostname = '127.0.0.1';
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Host: 'localhost:8000'
        },
        body: JSON.stringify({ refresh_token: context.refreshToken }),
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        console.warn(`[HirePool Auth] Token refresh returned HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      if (!data?.access_token) {
        return null;
      }

      updateHirePoolSessionTokens(
        sessionId,
        data.access_token,
        data.refresh_token || null
      );
      return data.access_token;
    } catch (err) {
      console.warn('[HirePool Auth] Token refresh failed:', err.message);
      return null;
    }
  })().finally(() => {
    inFlightRefreshes.delete(sessionId);
  });

  inFlightRefreshes.set(sessionId, refreshPromise);
  return refreshPromise;
}

export function revokeHirePoolSessionBySdkCredential(credential) {
  const context = findHirePoolContextBySdkCredential(credential);
  if (!context) return false;
  removeContext(context);
  return true;
}

/**
 * Revoke the SDK session credential immediately and call HirePool's upstream
 * POST /api/v1/auth/logout endpoint when an upstream token is present.
 * Never reports upstream revocation unless the HirePool backend confirms success.
 *
 * @param {string} credential
 * @param {object} [options]
 * @param {string} [options.apiBaseUrl='http://127.0.0.1:8000']
 * @param {typeof fetch} [options.fetchImpl=fetch]
 * @param {number} [options.timeoutMs=4000]
 * @returns {Promise<{ hadSdkSession: boolean, backendRevoked: boolean, status: number|null, reason: string|null, sessionId: string|null, userId: string|null }>}
 */
export async function revokeHirePoolSessionWithBackend(
  credential,
  {
    apiBaseUrl = 'http://127.0.0.1:8000',
    fetchImpl = fetch,
    timeoutMs = 4000
  } = {}
) {
  const context = findHirePoolContextBySdkCredential(credential);
  if (!context) {
    return {
      hadSdkSession: false,
      backendRevoked: false,
      status: null,
      reason: 'No active SDK session credential was present.',
      sessionId: null,
      userId: null
    };
  }

  const sessionId = context.sessionId || null;
  const userId = context.identity?.id || null;
  const accessToken = context.accessToken || '';
  const refreshToken = context.refreshToken || '';

  // Revoke local SDK credential immediately before awaiting upstream network I/O
  removeContext(context);

  if (!accessToken) {
    return {
      hadSdkSession: true,
      backendRevoked: false,
      status: null,
      reason: 'No upstream HirePool access token was stored for this session.',
      sessionId,
      userId
    };
  }

  try {
    const logoutUrl = new URL('api/v1/auth/logout', apiBaseUrl);
    logoutUrl.hostname = '127.0.0.1';
    const response = await fetchImpl(logoutUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Host: 'localhost:8000'
      },
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (response.ok) {
      return {
        hadSdkSession: true,
        backendRevoked: true,
        status: response.status,
        reason: null,
        sessionId,
        userId
      };
    }

    return {
      hadSdkSession: true,
      backendRevoked: false,
      status: response.status,
      reason: `HirePool logout endpoint returned HTTP ${response.status}.`,
      sessionId,
      userId
    };
  } catch (error) {
    return {
      hadSdkSession: true,
      backendRevoked: false,
      status: null,
      reason: error?.message || 'HirePool logout request failed.',
      sessionId,
      userId
    };
  }
}

export function createHirePoolPrincipal(context) {
  return {
    id: context.identity.id,
    email: context.identity.email || null,
    role: context.identity.userType,
    tenantId: null,
    assistantId: 'hirepool',
    applicationId: 'hirepool-local-app',
    scopes: [],
    integrationSessionId: context.sessionId,
    credential: context.credential,
    organizationRole: context.identity.organizationRole || null
  };
}

export function getHirePoolApiAccessToken(user) {
  const context = getHirePoolContextBySessionId(user?.integrationSessionId);
  return context?.accessToken || null;
}

export function getHirePoolApiTokens(user) {
  const context = getHirePoolContextBySessionId(user?.integrationSessionId);
  if (!context) return null;
  return {
    accessToken: context.accessToken,
    refreshToken: context.refreshToken || null
  };
}

/**
 * Returns a guaranteed valid access token for API operations,
 * automatically refreshing via HirePool's token lifecycle if needed.
 */
export async function getHirePoolValidAccessToken(user, baseUrl = 'http://127.0.0.1:8000') {
  const context = getHirePoolContextBySessionId(user?.integrationSessionId);
  if (!context) return null;

  // If token is expired or within 60s of expiring, and refresh token is available, refresh silently
  if (isTokenExpired(context.accessToken, 60) && context.refreshToken) {
    const refreshed = await refreshHirePoolSessionTokens(context.sessionId, baseUrl);
    if (refreshed) return refreshed;
  }

  return context.accessToken || null;
}

export function getHirePoolSessionTtlMs() {
  return SESSION_TTL_MS;
}
