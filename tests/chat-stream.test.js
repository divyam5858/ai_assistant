import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import request from 'supertest';
import { z } from 'zod';
import { AssistantApiClient } from '../widget/src/api-client.js';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { ActionRegistry } from '../backend/src/actions/registry.js';
import { clearAssistantRegistries, setAssistantActionRegistry } from '../connectors/bridge.js';
import { signJwt } from '../backend/src/middleware/auth.js';
import { logRequestError } from '../backend/src/middleware/logger.js';
import { parseDocument } from '../backend/src/services/document-parser.js';

const ENVIRONMENT_KEYS = [
  'NODE_ENV',
  'AUTH_MODE',
  'AUTH_REQUIRED',
  'JWT_SECRET',
  'API_KEY',
  'GEMINI_API_KEY',
  'ENABLE_INTEGRATION_DEMO',
  'ENABLE_HIREPOOL_INTEGRATION'
];
const originalEnvironment = Object.fromEntries(
  ENVIRONMENT_KEYS.map(key => [key, process.env[key]])
);

function configureUnauthenticatedTests() {
  process.env.NODE_ENV = 'test';
  process.env.AUTH_MODE = 'none';
  process.env.AUTH_REQUIRED = 'false';
  delete process.env.JWT_SECRET;
  delete process.env.API_KEY;
  delete process.env.ENABLE_HIREPOOL_INTEGRATION;
}

class RecordingProvider {
  constructor({ failure, toolCalls } = {}) {
    this.name = 'recording-test-provider';
    this.failure = failure;
    this.toolCalls = toolCalls || [];
    this.calls = [];
  }

  async checkHealth() {
    return { available: true, model: 'recording-model', message: 'Mock provider available' };
  }

  async chatStream(options) {
    this.calls.push(options);
    if (this.failure) throw this.failure;
    options.onChunk('Hello from the mock provider.');
    return {
      text: 'Hello from the mock provider.',
      model: 'recording-model',
      toolCalls: this.toolCalls
    };
  }
}

function parseSseEvents(body) {
  return body.trim().split(/\r?\n\r?\n/).map(frame => {
    const data = frame.split(/\r?\n/).find(line => line.startsWith('data:'));
    assert.ok(data, `Expected an SSE data frame, received: ${frame}`);
    return JSON.parse(data.slice(5).trim());
  });
}

function createSyntheticPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

beforeEach(() => {
  configureUnauthenticatedTests();
  clearAssistantRegistries();
  setAIProvider(null);
});

afterEach(() => {
  clearAssistantRegistries();
  setAIProvider(null);
});

after(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('health endpoint uses the configured provider health check', async () => {
  const provider = new RecordingProvider();
  setAIProvider(provider);

  const response = await request(createApp()).get('/api/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.provider.name, provider.name);
});

test('lazy PDF worker parses a synthetic PDF document', async () => {
  const parsed = await parseDocument(
    createSyntheticPdf('PDF worker regression text'),
    'worker-regression.pdf',
    'application/pdf'
  );

  assert.equal(parsed.format, 'pdf');
  assert.match(parsed.text, /PDF worker regression text/);
  assert.equal(parsed.pageCount, 1);
});

test('Vercel catch-all path normalization retains unrelated query parameters', async () => {
  const app = createApp();
  app.get('/api/normalizer-probe', (req, res) => res.json({ query: req.query }));

  const response = await request(app)
    .get('/api?path=normalizer-probe&trace=preserved')
    .set('x-matched-path', '/api/[...path]');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.query, { trace: 'preserved' });
});

test('chat stream accepts the Vercel rewritten path and invokes the provider', async () => {
  const provider = new RecordingProvider();
  setAIProvider(provider);

  const response = await request(createApp())
    .post('/api/chat/stream?path=chat%2Fstream&trace=preserved')
    .set('x-matched-path', '/api/[...path]')
    .send({
      assistantId: 'default',
      message: 'Say hello',
      stream: true,
      history: [{ role: 'user', content: 'Earlier question' }],
      context: 'Current page: dashboard'
    });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/event-stream/);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].messages.at(-1).content, 'Say hello');
  assert.equal(provider.calls[0].messages[0].content, 'Earlier question');
  assert.match(provider.calls[0].systemInstruction, /Current page: dashboard/);
  assert.equal(provider.calls[0].signal.aborted, false);

  const events = parseSseEvents(response.text);
  assert.deepEqual(events.map(event => event.type), ['start', 'chunk', 'done']);
  assert.equal(events[2].text, 'Hello from the mock provider.');
});

test('chat request body produced by the widget API client matches the backend contract', async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: 'ok' })
    };
  };

  try {
    const client = new AssistantApiClient('/sdk-host');
    await client.sendMessage({
      assistantId: 'hirepool',
      message: 'Find recent applications',
      context: 'HirePool applications page',
      history: [{ role: 'user', content: 'Previous question' }],
      stream: false
    });

    assert.equal(capturedRequest.url, '/sdk-host/api/chat');
    assert.equal(capturedRequest.options.method, 'POST');
    assert.deepEqual(JSON.parse(capturedRequest.options.body), {
      assistantId: 'hirepool',
      message: 'Find recent applications',
      stream: false,
      history: [{ role: 'user', content: 'Previous question' }],
      context: 'HirePool applications page'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat stream resolves registered actions and emits the proposed action', async () => {
  const registry = new ActionRegistry();
  registry.register({
    name: 'jobs:search',
    description: 'Search jobs',
    risk: 'read',
    requiresConfirmation: false,
    parameterSchema: z.object({ query: z.string() })
  });
  setAssistantActionRegistry('chat-action-regression', registry);

  const provider = new RecordingProvider({
    toolCalls: [{
      id: 'tool-call-1',
      name: 'jobs:search',
      arguments: { query: 'remote' }
    }]
  });
  setAIProvider(provider);

  const response = await request(createApp())
    .post('/api/chat/stream')
    .send({
      assistantId: 'chat-action-regression',
      message: 'Find remote jobs',
      stream: true
    });

  assert.equal(response.status, 200);
  assert.deepEqual(provider.calls[0].tools.map(tool => tool.function.name), ['jobs__search']);
  const events = parseSseEvents(response.text);
  assert.equal(events.find(event => event.type === 'action')?.action.action, 'jobs:search');
});

test('invalid chat request returns 400 without invoking the provider', async () => {
  const provider = new RecordingProvider();
  setAIProvider(provider);

  const response = await request(createApp())
    .post('/api/chat/stream')
    .send({ assistantId: 'default', stream: true });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(provider.calls.length, 0);
});

test('production chat rejects missing credentials before invoking the provider', async () => {
  const provider = new RecordingProvider();
  setAIProvider(provider);
  process.env.NODE_ENV = 'production';
  process.env.AUTH_MODE = 'jwt';
  process.env.AUTH_REQUIRED = 'true';
  process.env.JWT_SECRET = 'test-only-jwt-secret';

  const response = await request(createApp())
    .post('/api/chat/stream')
    .send({ assistantId: 'default', message: 'Hello', stream: true });

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'MISSING_CREDENTIALS');
  assert.equal(provider.calls.length, 0);
});

test('health can pass while production chat fails closed on missing auth configuration', async () => {
  const provider = new RecordingProvider();
  setAIProvider(provider);
  process.env.NODE_ENV = 'production';
  process.env.AUTH_MODE = 'jwt';
  process.env.AUTH_REQUIRED = 'true';
  delete process.env.JWT_SECRET;
  const app = createApp();

  const healthResponse = await request(app).get('/api/health');
  assert.equal(healthResponse.status, 200);

  const originalConsoleError = console.error;
  const logLines = [];
  console.error = line => logLines.push(String(line));
  try {
    const chatResponse = await request(app)
      .post('/api/chat/stream')
      .send({ assistantId: 'default', message: 'Hello', stream: true });

    assert.equal(chatResponse.status, 500);
    assert.equal(chatResponse.body.error.message, 'An internal server error occurred. Please try again later.');
    assert.equal(provider.calls.length, 0);
    assert.ok(logLines[0].includes('server JWT secret is not configured'));
  } finally {
    console.error = originalConsoleError;
  }
});

test('pre-stream production failures log the exception and retain a generic HTTP response', async () => {
  const actionName = 'a'.repeat(65);
  const registry = new ActionRegistry();
  registry.register({
    name: actionName,
    description: 'Regression action for provider tool limits',
    risk: 'read',
    requiresConfirmation: false
  });
  setAssistantActionRegistry('chat-prestream-regression', registry);

  const provider = new RecordingProvider();
  setAIProvider(provider);
  process.env.NODE_ENV = 'production';
  process.env.AUTH_MODE = 'jwt';
  process.env.AUTH_REQUIRED = 'true';
  process.env.JWT_SECRET = 'test-only-jwt-secret';
  const token = signJwt({ sub: 'chat-test-user' }, process.env.JWT_SECRET);
  const originalConsoleError = console.error;
  const logLines = [];
  console.error = line => logLines.push(String(line));

  try {
    const response = await request(createApp())
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${token}`)
      .send({
        assistantId: 'chat-prestream-regression',
        message: 'Hello',
        stream: true
      });

    assert.equal(response.status, 500);
    assert.equal(response.body.error.message, 'An internal server error occurred. Please try again later.');
    assert.equal(provider.calls.length, 0);
    assert.equal(logLines.length, 1);
    assert.ok(logLines[0].includes('exceeds OpenAI maximum allowed length'));
    assert.ok(logLines[0].includes('/api/chat/stream'));
  } finally {
    console.error = originalConsoleError;
  }
});

test('production SSE provider failures are logged safely and return a generic error', async () => {
  const apiKey = 'gsk-regression-secret-123456789';
  const provider = new RecordingProvider({ failure: new Error(`Provider rejected key ${apiKey}`) });
  setAIProvider(provider);
  process.env.NODE_ENV = 'production';
  process.env.AUTH_MODE = 'jwt';
  process.env.AUTH_REQUIRED = 'true';
  process.env.JWT_SECRET = 'test-only-jwt-secret';
  process.env.GEMINI_API_KEY = apiKey;
  const token = signJwt({ sub: 'chat-test-user' }, process.env.JWT_SECRET);
  const originalConsoleError = console.error;
  const logLines = [];
  console.error = line => logLines.push(String(line));

  try {
    const response = await request(createApp())
      .post('/api/chat/stream')
      .set('Authorization', `Bearer ${token}`)
      .set('x-request-id', 'chat-failure-test-id')
      .send({ assistantId: 'default', message: 'Hello', stream: true });

    assert.equal(response.status, 200);
    const errorEvent = parseSseEvents(response.text).find(event => event.type === 'error');
    assert.equal(errorEvent.error.message, 'An internal server error occurred. Please try again later.');
    assert.equal(logLines.length, 1);
    assert.ok(logLines[0].includes('"requestId":"chat-failure-test-id"'));
    assert.ok(logLines[0].includes('"method":"POST"'));
    assert.ok(logLines[0].includes('/api/chat/stream'));
    assert.ok(!logLines[0].includes(apiKey));
  } finally {
    console.error = originalConsoleError;
  }
});

test('server error logger redacts key-value credentials and does not include request body', () => {
  const originalConsoleError = console.error;
  const logLines = [];
  console.error = line => logLines.push(String(line));

  try {
    logRequestError(
      new Error('Failure while using api_key: plainly-visible-secret'),
      {
        id: 'redaction-test-id',
        method: 'POST',
        originalUrl: '/api/chat/stream?token=query-secret',
        body: { message: 'candidate personal information' }
      }
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(logLines.length, 1);
  assert.ok(logLines[0].includes('[REDACTED]'));
  assert.ok(!logLines[0].includes('plainly-visible-secret'));
  assert.ok(!logLines[0].includes('query-secret'));
  assert.ok(!logLines[0].includes('candidate personal information'));
});
