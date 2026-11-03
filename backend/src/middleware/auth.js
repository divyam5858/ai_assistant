import crypto from 'node:crypto';

/**
 * Authentication error with 401 HTTP status code
 */
export class AuthenticationError extends Error {
  /**
   * @param {string} message
   * @param {string} [code='UNAUTHORIZED']
   */
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
    this.code = code;
  }
}

/**
 * Authorization error with 403 HTTP status code
 */
export class AuthorizationError extends Error {
  /**
   * @param {string} message
   * @param {string} [code='FORBIDDEN']
   */
  constructor(message = 'Access denied', code = 'FORBIDDEN') {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = 403;
    this.code = code;
  }
}

/**
 * Base64URL encode string or Buffer
 * @param {string|Buffer} input
 * @returns {string}
 */
export function base64UrlEncode(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buffer.toString('base64url');
}

/**
 * Base64URL decode to Buffer
 * @param {string} str
 * @returns {Buffer}
 */
export function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url');
}

/**
 * Cryptographically sign a standard HS256 JSON Web Token (JWT).
 * Built with Node.js built-in crypto module (RFC 7519 compliant).
 *
 * @param {object} payload Token claims
 * @param {string} secret HMAC signing key
 * @param {object} [options]
 * @param {number} [options.expiresIn=3600] Expiration time in seconds from now (null for no exp)
 * @param {string} [options.issuer] Expected iss claim
 * @param {string} [options.audience] Expected aud claim
 * @param {string} [options.algorithm='HS256']
 * @returns {string} Signed JWT
 */
export function signJwt(payload, secret, options = {}) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('JWT secret must be a non-empty string');
  }

  const algorithm = options.algorithm || 'HS256';
  if (algorithm !== 'HS256') {
    throw new Error(`Unsupported JWT algorithm: ${algorithm}. Only HS256 is supported.`);
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload };

  if (!('iat' in claims)) {
    claims.iat = now;
  }

  if (options.expiresIn !== undefined) {
    if (options.expiresIn !== null) {
      claims.exp = now + options.expiresIn;
    }
  } else if (!('exp' in claims)) {
    claims.exp = now + 3600; // default 1 hour expiration
  }

  if (options.issuer && !('iss' in claims)) {
    claims.iss = options.issuer;
  }

  if (options.audience && !('aud' in claims)) {
    claims.aud = options.audience;
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');

  return `${signatureInput}.${signature}`;
}

/**
 * Cryptographically verify an HS256 JSON Web Token.
 * Performs constant-time signature comparison to prevent timing attacks.
 *
 * @param {string} token Encoded JWT string
 * @param {string} secret HMAC verification secret
 * @param {object} [options]
 * @param {string} [options.issuer] Expected issuer claim (iss)
 * @param {string} [options.audience] Expected audience claim (aud)
 * @param {number} [options.clockTolerance=5] Clock skew tolerance in seconds
 * @returns {object} Decoded claims payload
 */
export function verifyJwt(token, secret, options = {}) {
  if (!token || typeof token !== 'string') {
    throw new AuthenticationError('Authentication token is required', 'MISSING_CREDENTIALS');
  }
  if (!secret || typeof secret !== 'string') {
    throw new Error('JWT secret is required for verification');
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new AuthenticationError('Malformed authentication token: expected 3 segments', 'INVALID_TOKEN');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Verify header
  let header;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
  } catch {
    throw new AuthenticationError('Invalid token header format', 'INVALID_TOKEN');
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new AuthenticationError(`Unsupported token algorithm or type: ${header.alg}`, 'INVALID_TOKEN');
  }

  // 2. Cryptographic signature verification using constant-time comparison
  const signatureInput = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');

  const sigBuffer = Buffer.from(signatureB64);
  const expectedSigBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedSigBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedSigBuffer)) {
    throw new AuthenticationError('Invalid token signature', 'INVALID_TOKEN');
  }

  // 3. Decode payload
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new AuthenticationError('Invalid token payload format', 'INVALID_TOKEN');
  }

  const now = Math.floor(Date.now() / 1000);
  const clockTolerance = options.clockTolerance || 5;

  // 4. Verify expiration (exp)
  if (payload.exp !== undefined) {
    if (typeof payload.exp !== 'number') {
      throw new AuthenticationError('Invalid token expiration claim', 'INVALID_TOKEN');
    }
    if (now > payload.exp + clockTolerance) {
      throw new AuthenticationError('Authentication token has expired', 'EXPIRED_TOKEN');
    }
  }

  // 5. Verify not before (nbf)
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number') {
      throw new AuthenticationError('Invalid token not-before claim', 'INVALID_TOKEN');
    }
    if (now < payload.nbf - clockTolerance) {
      throw new AuthenticationError('Authentication token is not active yet', 'INVALID_TOKEN');
    }
  }

  // 6. Verify issuer (iss)
  const expectedIssuer = options.issuer || process.env.JWT_ISSUER;
  if (expectedIssuer && payload.iss !== expectedIssuer) {
    throw new AuthenticationError(`Token issuer mismatch: expected '${expectedIssuer}'`, 'INVALID_TOKEN');
  }

  // 7. Verify audience (aud)
  const expectedAudience = options.audience || process.env.JWT_AUDIENCE;
  if (expectedAudience) {
    const audMatch = Array.isArray(payload.aud)
      ? payload.aud.includes(expectedAudience)
      : payload.aud === expectedAudience;
    if (!audMatch) {
      throw new AuthenticationError(`Token audience mismatch: expected '${expectedAudience}'`, 'INVALID_TOKEN');
    }
  }

  return payload;
}

/**
 * Extract credentials from HTTP request headers.
 * Looks for Bearer token in Authorization header or API Key in X-API-Key header.
 *
 * @param {import('express').Request} req
 * @returns {{ type: 'bearer'|'api-key', token: string } | null}
 */
export function extractCredentials(req) {
  if (!req || !req.headers) return null;

  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return { type: 'bearer', token: match[1].trim() };
    }
  }

  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader && typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
    return { type: 'api-key', token: apiKeyHeader.trim() };
  }

  return null;
}

/**
 * Configurable Express authentication middleware.
 * Supports JWT verification, API Key validation, and development/production modes.
 *
 * @param {object} [options]
 * @param {boolean} [options.required] Force authentication requirement
 * @param {'none'|'jwt'|'api-key'|'hybrid'} [options.mode] Authentication mode
 * @param {string} [options.jwtSecret] JWT secret override
 * @param {string} [options.apiKey] API key override
 * @param {string} [options.issuer] Expected JWT issuer
 * @param {string} [options.audience] Expected JWT audience
 * @param {number} [options.clockTolerance=5] Clock skew tolerance
 * @returns {import('express').RequestHandler}
 */
export function authenticate(options = {}) {
  return (req, res, next) => {
    const isProd = process.env.NODE_ENV === 'production';
    const mode = options.mode || process.env.AUTH_MODE ||
      (isProd || process.env.JWT_SECRET ? 'jwt' : 'none');
    const authRequiredEnv = process.env.AUTH_REQUIRED;
    const required = options.required !== undefined
      ? options.required
      : (authRequiredEnv !== undefined ? authRequiredEnv === 'true' : isProd);

    const jwtSecret = options.jwtSecret || process.env.JWT_SECRET;
    const apiKey = options.apiKey || process.env.API_KEY;

    const creds = extractCredentials(req);

    // 1. Fail safely if authentication is required but server configuration is incomplete
    if (required) {
      if (mode === 'none') {
        const err = new Error('Authentication is required but AUTH_MODE is configured as none');
        err.statusCode = 500;
        err.code = 'CONFIG_ERROR';
        return next(err);
      }
      if ((mode === 'jwt' || mode === 'hybrid') && !jwtSecret) {
        const err = new Error('Authentication is required but server JWT secret is not configured');
        err.statusCode = 500;
        err.code = 'CONFIG_ERROR';
        return next(err);
      }
      if (mode === 'api-key' && !apiKey) {
        const err = new Error('Authentication is required but server API key is not configured');
        err.statusCode = 500;
        err.code = 'CONFIG_ERROR';
        return next(err);
      }
    }

    // 2. If no credentials provided
    if (!creds) {
      if (required) {
        return next(new AuthenticationError('Authentication credentials are required', 'MISSING_CREDENTIALS'));
      }
      // Auth is not required and no credentials provided: proceed as unauthenticated guest
      req.user = null;
      return next();
    }

    // 3. Credentials were provided: validate them
    try {
      // API Key validation
      if (creds.type === 'api-key' || (mode === 'api-key' && creds.type === 'bearer')) {
        if (!apiKey) {
          throw new AuthenticationError('API Key authentication is not configured on this server', 'INVALID_CREDENTIALS');
        }
        const credBuffer = Buffer.from(creds.token);
        const expectedBuffer = Buffer.from(apiKey);
        if (credBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(credBuffer, expectedBuffer)) {
          throw new AuthenticationError('Invalid API Key', 'INVALID_CREDENTIALS');
        }

        // Construct service principal
        req.user = {
          id: 'service_principal',
          tenantId: null,
          role: 'service',
          isService: true
        };
        return next();
      }

      // JWT Bearer validation
      if (creds.type === 'bearer') {
        if (!jwtSecret) {
          throw new AuthenticationError('JWT verification is not configured on this server', 'INVALID_CREDENTIALS');
        }

        const payload = verifyJwt(creds.token, jwtSecret, {
          issuer: options.issuer,
          audience: options.audience,
          clockTolerance: options.clockTolerance
        });
        const principalId = payload.sub || payload.userId || payload.id;
        if (typeof principalId !== 'string' || !principalId.trim()) {
          throw new AuthenticationError('Authentication token must contain a stable user identity', 'INVALID_TOKEN');
        }

        // Construct trusted authenticated principal - NEVER trust arbitrary client-supplied body fields!
        req.user = {
          id: principalId.trim(),
          tenantId: payload.tenant_id || payload.tenantId || payload.tid || null,
          role: payload.role || payload.user_type || 'user',
          scopes: Array.isArray(payload.scopes) ? payload.scopes : (payload.scope ? payload.scope.split(' ') : []),
          rawClaims: payload
        };

        return next();
      }

      throw new AuthenticationError('Unsupported credential type', 'INVALID_CREDENTIALS');
    } catch (err) {
      // Never silently bypass authentication when verification fails
      return next(err);
    }
  };
}

/**
 * Strict route-level guard requiring valid authentication credentials.
 * @param {object} [options]
 * @returns {import('express').RequestHandler}
 */
export function requireAuth(options = {}) {
  return authenticate({ ...options, required: true });
}

/**
 * Route-level guard requiring a validated tenant context.
 * Prevents requests that lack a trusted tenant association.
 * @param {object} [options]
 * @returns {import('express').RequestHandler}
 */
export function requireTenant(options = {}) {
  return (req, res, next) => {
    if (!req.user || !req.user.tenantId) {
      return next(new AuthorizationError('A valid tenant association is required to access this resource', 'TENANT_REQUIRED'));
    }
    next();
  };
}

/**
 * Route-level guard requiring a specific role claim.
 * @param {string|Array<string>} roles
 * @returns {import('express').RequestHandler}
 */
export function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication credentials are required', 'MISSING_CREDENTIALS'));
    }
    if (!allowed.includes(req.user.role)) {
      return next(new AuthorizationError(`Access denied: required role is one of [${allowed.join(', ')}]`, 'INSUFFICIENT_PERMISSIONS'));
    }
    next();
  };
}
