import { test, describe } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../api/index.js';

describe('Vercel Serverless Entry Point (api/index.js)', () => {
  test('exports valid Express application instance', () => {
    assert.ok(app, 'app must be defined');
    assert.strictEqual(typeof app, 'function', 'app must be a callable Express function');
    assert.ok(app.handle, 'app must have Express handle method');
  });

  test('GET /api/health returns 200 and healthy status', async () => {
    const res = await request(app)
      .get('/api/health')
      .expect(200);

    assert.strictEqual(res.body.status, 'ok');
    assert.ok(res.body.timestamp);
    assert.ok(res.body.provider);
    assert.strictEqual(res.body.provider.available, true);
  });

  test('GET /api/config/default returns public assistant configuration', async () => {
    const res = await request(app)
      .get('/api/config/default')
      .expect(200);

    assert.ok(res.body.assistant);
    assert.strictEqual(res.body.assistant.assistantId, 'default');
    assert.strictEqual(res.body.assistant.name, 'AI Assistant');
  });

  test('GET /sdk/assistant.js serves compiled SDK with cross-origin headers', async () => {
    const res = await request(app)
      .get('/sdk/assistant.js')
      .expect(200);

    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
    assert.match(res.headers['content-type'], /javascript/);
    assert.ok(res.text.includes('AssistantSDKBundle') || res.text.includes('AssistantSDK'));
  });

  test('GET / redirects to /demo', async () => {
    const res = await request(app)
      .get('/')
      .expect(302);

    assert.strictEqual(res.headers.location, '/demo');
  });

  test('POST /api/chat handles message request and returns response', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'default',
        message: 'Hello! Are you running via Vercel entry point?',
        stream: false
      })
      .expect(200);

    assert.ok(res.body.conversationId);
    assert.ok(res.body.text);
    assert.strictEqual(typeof res.body.text, 'string');
    assert.ok(res.body.text.length > 0);
  });
});
