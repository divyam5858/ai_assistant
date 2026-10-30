import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';

describe('Backend API Integration', () => {
  let app;

  before(() => {
    // Use Mock Provider during integration tests for consistent, fast execution
    setAIProvider(new MockAIProvider());
    app = createApp();
  });

  test('GET /api/health returns 200 with service and provider status', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.provider.name, 'mock');
    assert.equal(res.body.provider.available, true);
    assert.ok(typeof res.body.uptimeSeconds === 'number');
  });

  test('GET /api/config/default returns public configuration without server secrets', async () => {
    const res = await request(app).get('/api/config/default');
    assert.equal(res.status, 200);
    assert.ok(res.body.assistant);
    assert.equal(res.body.assistant.assistantId, 'default');
    assert.ok(res.body.assistant.name);
    assert.ok(res.body.assistant.features);
    // Crucial: systemInstruction must not be exposed to frontend
    assert.equal(res.body.assistant.systemInstruction, undefined);
  });

  test('POST /api/chat generates non-streaming response and maintains session', async () => {
    const res1 = await request(app)
      .post('/api/chat')
      .send({
        message: 'Hello Assistant',
        conversationId: 'test-session-integration'
      });

    assert.equal(res1.status, 200);
    assert.ok(res1.body.text.includes('Hello Assistant'));
    assert.equal(res1.body.conversationId, 'test-session-integration');

    // Multi-turn follow-up
    const res2 = await request(app)
      .post('/api/chat')
      .send({
        message: 'Can you summarize that?',
        conversationId: 'test-session-integration'
      });

    assert.equal(res2.status, 200);
    assert.ok(res2.body.text.includes('Can you summarize that?'));
  });

  test('POST /api/chat/stream returns Server-Sent Events', async () => {
    const res = await request(app)
      .post('/api/chat/stream')
      .send({
        message: 'Stream me a response',
        conversationId: 'test-stream-session'
      });

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));
    assert.ok(res.text.includes('data: {"type":"start"'));
    assert.ok(res.text.includes('data: {"type":"chunk"'));
    assert.ok(res.text.includes('data: {"type":"done"'));
  });

  test('POST /api/summarize handles styles and structured JSON', async () => {
    const sampleText = 'Antigravity is an AI pair programming framework designed for rapid software development.';

    // Concise style
    const resConcise = await request(app)
      .post('/api/summarize')
      .send({ text: sampleText, style: 'concise' });
    assert.equal(resConcise.status, 200);
    assert.ok(resConcise.body.summary);
    assert.equal(resConcise.body.style, 'concise');

    // Structured JSON style
    const resJson = await request(app)
      .post('/api/summarize')
      .send({ text: sampleText, style: 'structured_json' });
    assert.equal(resJson.status, 200);
    assert.ok(resJson.body.structured);
    assert.ok(Array.isArray(resJson.body.structured.keyPoints));
  });

  test('POST /api/sessions/clear resets conversation messages', async () => {
    const convoId = 'session-to-clear';

    // Send a message first
    await request(app).post('/api/chat').send({
      message: 'Initial message',
      conversationId: convoId
    });

    // Clear session
    const clearRes = await request(app)
      .post('/api/sessions/clear')
      .send({ conversationId: convoId });

    assert.equal(clearRes.status, 200);
    assert.equal(clearRes.body.success, true);
    assert.equal(clearRes.body.cleared, true);
  });

  test('POST /api/connectors/execute enforces authorization', async () => {
    // Public action succeeds
    const pubRes = await request(app)
      .post('/api/connectors/execute')
      .send({
        connectorId: 'mock-knowledge',
        action: 'searchKnowledge',
        parameters: { query: 'widget' }
      });
    assert.equal(pubRes.status, 200);
    assert.equal(pubRes.body.success, true);

    // Protected action without token fails
    const failRes = await request(app)
      .post('/api/connectors/execute')
      .send({
        connectorId: 'mock-knowledge',
        action: 'getCustomerProfile',
        parameters: { customerId: 'cust-001' }
      });
    assert.equal(failRes.status, 401);

    // Protected action with valid token succeeds
    const succRes = await request(app)
      .post('/api/connectors/execute')
      .send({
        connectorId: 'mock-knowledge',
        action: 'getCustomerProfile',
        parameters: { customerId: 'cust-001' },
        authToken: 'secret-demo-token-123'
      });
    assert.equal(succRes.status, 200);
    assert.equal(succRes.body.data.customer.name, 'Jane Doe');
  });

  test('rejects malformed requests with 400', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: '' }); // empty message

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  test('serves compiled SDK script at /sdk/assistant.js', async () => {
    const res = await request(app).get('/sdk/assistant.js');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('application/javascript'));
    assert.ok(res.text.includes('AssistantSDK'));
  });

  test('serves demo application at /demo and redirects root', async () => {
    const rootRes = await request(app).get('/');
    assert.equal(rootRes.status, 302);
    assert.equal(rootRes.headers.location, '/demo');

    const demoRes = await request(app).get('/demo/index.html');
    assert.equal(demoRes.status, 200);
    assert.ok(demoRes.text.includes('AI Assistant Plugin'));
  });
});

