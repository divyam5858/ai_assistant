import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { configureCors, configureHelmet, configureRateLimiter } from './middleware/security.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/error-handler.js';

import { healthRouter } from './routes/health.js';
import { configRouter } from './routes/config.js';
import { chatRouter } from './routes/chat.js';
import { summarizeRouter } from './routes/summarize.js';
import { sessionsRouter } from './routes/sessions.js';
import { connectorsRouter } from './routes/connectors.js';
import { documentsRouter } from './routes/documents.js';
import { registerIntegrationDemoActions } from './actions/integration-demo.js';
import { registerHirePoolActions } from '../../integrations/hirepool/actions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export function createApp() {
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_INTEGRATION_DEMO === 'true') {
    registerIntegrationDemoActions();
  }
  if (process.env.ENABLE_HIREPOOL_INTEGRATION === 'true') {
    registerHirePoolActions();
  }

  const app = express();
  if (process.env.VERCEL) {
    app.set('trust proxy', 1);
  }

  // Basic security & parsing
  app.use(configureHelmet());
  app.use(configureCors());
  app.use(express.json({ limit: process.env.MAX_REQUEST_BODY_SIZE || '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Structured logging
  app.use(requestLogger);

  // Rate limiting on API routes
  app.use('/api', configureRateLimiter());

  // Path normalizer for serverless environments (e.g. Vercel rewrites)
  app.use((req, res, next) => {
    const matched = req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'];
    const pathIsCatchAll = typeof matched === 'string' && /\[[^/]+\]/.test(matched);
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const queryPaths = parsedUrl.searchParams.getAll('path');
    const subpath = queryPaths.length > 1 ? queryPaths.join('/') : queryPaths[0];
    const rewriteRequestUrl = url => {
      req.url = url;
      req._parsedUrl = undefined;
      const rewrittenUrl = new URL(url, 'http://localhost');
      req.normalizedPath = rewrittenUrl.pathname;
      req.query = app.get('query parser fn')(rewrittenUrl.search.slice(1));
    };

    if (subpath && (!matched || pathIsCatchAll)) {
      parsedUrl.searchParams.delete('path');
      rewriteRequestUrl(`/api/${String(subpath).replace(/^\/+/, '')}${parsedUrl.search}`);
    } else if (matched && matched.startsWith('/api') && !pathIsCatchAll) {
      const matchedUrl = new URL(matched, 'http://localhost');
      if (!matchedUrl.search) {
        matchedUrl.search = parsedUrl.search;
      }
      rewriteRequestUrl(`${matchedUrl.pathname}${matchedUrl.search}`);
    }
    next();
  });

  // Mount API endpoints
  app.use('/api/health', healthRouter);
  app.use('/api/config', configRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/summarize', summarizeRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/connectors', connectorsRouter);
  app.use('/api/documents', documentsRouter);

  // Serve compiled SDK distribution bundle
  const widgetDistPath = path.resolve(rootDir, 'widget/dist');
  app.use('/sdk', express.static(widgetDistPath, {
    setHeaders: (res, filePath) => {
      // Allow cross-origin script loading
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
      }
    }
  }));

  // Serve demo application
  const demoPath = path.resolve(rootDir, 'demo');
  app.use('/demo', express.static(demoPath));

  // Root API redirect to health
  app.get('/api', (req, res) => {
    res.redirect('/api/health');
  });

  // Root redirect to demo
  app.get('/', (req, res) => {
    res.redirect('/demo');
  });

  // Central error handler
  app.use(errorHandler);

  return app;
}
