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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

export function createApp() {
  const app = express();

  // Basic security & parsing
  app.use(configureHelmet());
  app.use(configureCors());
  app.use(express.json({ limit: process.env.MAX_REQUEST_BODY_SIZE || '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Structured logging
  app.use(requestLogger);

  // Rate limiting on API routes
  app.use('/api', configureRateLimiter());

  // Mount API endpoints
  app.use('/api/health', healthRouter);
  app.use('/api/config', configRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/summarize', summarizeRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/connectors', connectorsRouter);

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

  // Root redirect to demo
  app.get('/', (req, res) => {
    res.redirect('/demo');
  });

  // Central error handler
  app.use(errorHandler);

  return app;
}

