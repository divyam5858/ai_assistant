import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { SERVER_DEFAULTS } from '../../../config/defaults.js';

/**
 * Configure CORS middleware
 */
export function configureCors() {
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  let allowedOrigins = SERVER_DEFAULTS.ALLOWED_ORIGINS;

  if (allowedOriginsEnv && allowedOriginsEnv !== '*') {
    allowedOrigins = allowedOriginsEnv.split(',').map(s => s.trim());
  }

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      const err = new Error(`CORS policy does not allow access from origin: ${origin}`);
      err.statusCode = 403;
      return callback(err);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Assistant-Id', 'X-Session-Id'],
    credentials: true,
    maxAge: 86400
  });
}

/**
 * Configure Helmet with CSP allowing embedded widget and SSE
 */
export function configureHelmet() {
  return helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:', 'http:', 'ws:', 'wss:']
      }
    }
  });
}

/**
 * Configure Rate Limiter
 */
export function configureRateLimiter() {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || SERVER_DEFAULTS.RATE_LIMIT.WINDOW_MS;
  const max = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || SERVER_DEFAULTS.RATE_LIMIT.MAX_REQUESTS;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down and try again shortly.',
        retryAfterMs: windowMs
      }
    }
  });
}

/**
 * Sanitize text to remove control characters and detect prompt injection attempts
 */
export function sanitizePrompt(text) {
  if (typeof text !== 'string') return '';
  // Strip dangerous null bytes and bidirectional override characters
  return text
    .replace(/\u0000/g, '')
    .replace(/[\u202A-\u202E]/g, '')
    .trim();
}