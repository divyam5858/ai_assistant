import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createApp } from './app.js';
import { SERVER_DEFAULTS } from '../../config/defaults.js';
import { getAIProvider } from './providers/factory.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// Load environment variables if not already loaded
const backendEnvPath = path.resolve(__dirname, '../.env');
const rootEnvPath = path.resolve(rootDir, '.env');

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

const PORT = parseInt(process.env.PORT, 10) || SERVER_DEFAULTS.PORT;
const HOST = process.env.HOST || SERVER_DEFAULTS.HOST;

const app = createApp();

const server = app.listen(PORT, HOST, async () => {
  console.log(`=======================================================`);
  console.log(` AI Assistant Backend & SDK Server running!`);
  console.log(` Server URL:      http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(` Health Check:    http://localhost:${PORT}/api/health`);
  console.log(` Demo App:        http://localhost:${PORT}/demo`);
  console.log(` Embeddable SDK:  http://localhost:${PORT}/sdk/assistant.js`);
  console.log(` Environment:     ${process.env.NODE_ENV || 'development'}`);

  // Test provider status quietly
  try {
    const provider = getAIProvider();
    const health = await provider.checkHealth();
    console.log(` AI Provider:     ${provider.name} (model: ${health.model}) - ${health.available ? 'READY' : 'DEGRADED: ' + health.message}`);
  } catch (err) {
    console.warn(` AI Provider initialization warning:`, err.message);
  }
  console.log(`=======================================================`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

export { server, app };
