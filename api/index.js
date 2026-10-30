import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createApp } from '../backend/src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables for local testing or dev server if file exists
const rootEnv = path.resolve(rootDir, '.env');
const backendEnv = path.resolve(rootDir, 'backend/.env');

if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
} else if (fs.existsSync(backendEnv)) {
  dotenv.config({ path: backendEnv });
}

// Initialize the Express app
const app = createApp();

// Export the Express app for Vercel Serverless Function runtime
export default app;

