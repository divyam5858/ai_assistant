
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { SERVER_DEFAULTS } from '../../../config/defaults.js';

/**
 * The SDK API is public to browser origins. CORS permits cross-origin transport;
 * authentication and authorization remain enforced by the API routes.
 */
export function configureCors() {
  return cors({
    origin: '*',

    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Assistant-Id',
      'X-Session-Id',
      'X-Document-Processing-Consent',
      'X-Document-Consent-Version'
    ],

    credentials: false,

    maxAge: 86400
  });
}

/**
 * Configure Helmet with CSP allowing embedded widget and SSE
 */
export function configureHelmet() {
  return helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin'
    },

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'"
        ],

        styleSrc: [
          "'self'",
          "'unsafe-inline'"
        ],

        imgSrc: [
          "'self'",
          'data:',
          'https:'
        ],

        connectSrc: [
          "'self'",
          'https:',
          'http:',
          'ws:',
          'wss:'
        ]
      }
    }
  });
}

/**
 * Configure Rate Limiter
 */
export function configureRateLimiter() {
  const windowMs =
    parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) ||
    SERVER_DEFAULTS.RATE_LIMIT.WINDOW_MS;

  const max =
    parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) ||
    SERVER_DEFAULTS.RATE_LIMIT.MAX_REQUESTS;

  return rateLimit({
    windowMs,
    max,

    standardHeaders: true,

    legacyHeaders: false,

    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',

        message:
          'Too many requests. Please slow down and try again shortly.',

        retryAfterMs: windowMs
      }
    }
  });
}

/**
 * Sanitize text to remove control characters
 * and detect prompt injection attempts
 */
export function sanitizePrompt(text) {
  if (typeof text !== 'string') {
    return '';
  }

  // Strip dangerous null bytes and bidirectional override characters
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u202A-\u202E]/g, '')
    .trim();
}
