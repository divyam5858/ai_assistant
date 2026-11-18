import { ZodError } from 'zod';
import { logRequestError } from './logger.js';

/**
 * Global error handler middleware
 * Enforces safe error responses without leaking internal stack traces or secrets
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || (err instanceof ZodError ? 400 : 500);

  if (statusCode >= 500) {
    logRequestError(err, req);
  }

  // Zod validation error formatting
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request parameters',
        details: err.issues.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }
    });
  }

  // Rate limit error
  if (err.status === 429 || statusCode === 429) {
    return res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: err.message || 'Too many requests. Please slow down and try again shortly.'
      }
    });
  }

  // JSON parse error (malformed request body)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: {
        code: 'MALFORMED_JSON',
        message: 'Request body must be valid JSON'
      }
    });
  }

  // Dynamic API / Upstream service timeout
  if (err.code === 'DYNAMIC_API_TIMEOUT' || err.code === 'HIREPOOL_API_TIMEOUT' || (statusCode === 504 && /dynamic\s*api|hirepool/i.test(err.message))) {
    return res.status(504).json({
      error: {
        code: 'HIREPOOL_API_TIMEOUT',
        message: 'HirePool took too long to respond. The operation timed out; please try again.'
      }
    });
  }

  // Request timeout
  if (statusCode === 504 || err.code === 'ETIMEDOUT') {
    return res.status(504).json({
      error: {
        code: 'REQUEST_TIMEOUT',
        message: 'The AI provider request timed out. Please try again.'
      }
    });
  }

  // Client abort / disconnect
  if (statusCode === 499 || err.name === 'AbortError' || err.code === 'REQUEST_ABORTED') {
    return res.status(499).json({
      error: {
        code: 'CLIENT_CLOSED_REQUEST',
        message: 'The request was canceled by the client.'
      }
    });
  }

  // General server / provider error (safe message)
  const isProd = process.env.NODE_ENV === 'production';
  const safeMessage = (statusCode < 500 || !isProd)
    ? err.message || 'An unexpected error occurred'
    : 'An internal server error occurred. Please try again later.';

  res.status(statusCode).json({
    error: {
      code: err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'),
      message: safeMessage
    }
  });
}
