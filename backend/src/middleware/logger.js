import { randomUUID } from 'crypto';

/**
 * Structured request logger
 */
export function requestLogger(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.id,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.headers['user-agent'] || 'unknown',
      ip: req.ip || req.socket.remoteAddress
    };

    // Print single-line structured log (only in non-test mode or when DEBUG is set)
    if (process.env.NODE_ENV !== 'test' || process.env.DEBUG) {
      const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
      console.log(`[${logEntry.timestamp}] [${level}] [${logEntry.requestId}] ${logEntry.method} ${logEntry.path} ${logEntry.statusCode} - ${logEntry.durationMs}ms`);
    }
  });

  next();
}

