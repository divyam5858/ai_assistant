import { randomUUID } from 'crypto';

const SECRET_ENVIRONMENT_VARIABLES = [
  'API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'JWT_SECRET'
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactSensitiveText(value) {
  let text = String(value ?? '');

  for (const name of SECRET_ENVIRONMENT_VARIABLES) {
    const secret = process.env[name];
    if (secret && secret.length >= 6) {
      text = text.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
    }
  }

  return text
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/\b(?:sk|gsk)-[0-9A-Za-z_-]{12,}\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token)\s*([:=])\s*["']?[^"' \t\r\n,;]+/gi, '$1$2[REDACTED]');
}

function safeRequestId(requestId) {
  const value = typeof requestId === 'string' ? requestId : '';
  return value.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 128) || randomUUID();
}

function getRequestPath(req) {
  const queryPath = req.query?.path;
  const subpath = Array.isArray(queryPath) ? queryPath.join('/') : queryPath;
  if (typeof subpath === 'string' && subpath.trim()) {
    return `/api/${subpath.replace(/^\/+/, '').split('?')[0].split('#')[0]}`;
  }

  const requestUrl = req.normalizedPath || req.originalUrl || req.url || req.path || '/';
  return String(requestUrl).split('?')[0];
}

/**
 * Structured request logger
 */
export function requestLogger(req, res, next) {
  req.id = safeRequestId(req.headers['x-request-id']);
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.id,
      method: req.method,
      path: getRequestPath(req),
      statusCode: res.statusCode,
      durationMs,
      userAgent: String(req.headers['user-agent'] || 'unknown').slice(0, 200),
      ip: req.ip || req.socket.remoteAddress
    };

    if (process.env.NODE_ENV !== 'test' || process.env.DEBUG) {
      const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
      console.log(`[${logEntry.timestamp}] [${level}] [${logEntry.requestId}] ${logEntry.method} ${logEntry.path} ${logEntry.statusCode} - ${logEntry.durationMs}ms`);
    }
  });

  next();
}

export function sanitizeErrorMessage(error) {
  const message = redactSensitiveText(error?.message || String(error || 'Unknown error'));
  return message.slice(0, 2000);
}

export function logRequestError(error, req) {
  const errorName = redactSensitiveText(error?.name || 'Error').slice(0, 200);
  const message = sanitizeErrorMessage(error);
  const stack = redactSensitiveText(error?.stack || `${errorName}: ${message}`).slice(0, 8000);
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: 'request_error',
    requestId: safeRequestId(req?.id),
    method: String(req?.method || 'UNKNOWN').slice(0, 16),
    path: getRequestPath(req || {}),
    error: {
      name: errorName,
      message,
      stack
    }
  };

  console.error(JSON.stringify(logEntry));
}
