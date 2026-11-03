import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';
import { DOCUMENT_PROCESSING_CONSENT_VERSION } from '../config/document-upload.js';
import app from '../api/index.js';
import catchAllApp from '../api/[...path].js';
import { createApp } from '../backend/src/app.js';

describe('Vercel Serverless Entry Points (api/index.js & api/[...path].js)', () => {
  before(() => {
    setAIProvider(new MockAIProvider());
  });
  test('exports valid Express application instance from index.js and [...path].js', () => {
    assert.ok(app, 'app must be defined');
    assert.strictEqual(typeof app, 'function', 'app must be a callable Express function');
    assert.ok(app.handle, 'app must have Express handle method');
    assert.strictEqual(catchAllApp, app, '[...path].js must export the same Express application instance');
  });

  test("trusts Vercel's single forwarding proxy for client IP rate limiting", () => {
    const previousVercel = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      assert.equal(createApp().get('trust proxy'), 1);
    } finally {
      if (previousVercel === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = previousVercel;
      }
    }
  });

  test('GET /api redirects to /api/health', async () => {
    const res = await request(app)
      .get('/api')
      .expect(302);

    assert.strictEqual(res.headers.location, '/api/health');
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

  test('serves API responses with wildcard CORS for any origin', async () => {
    const configuredApp = createApp();
    const res = await request(configuredApp)
      .get('/api/config/default')
      .set('Origin', 'https://arbitrary-site.example')
      .expect(200);

    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  });

  test('serverless document preflight exposes consent headers without credentials', async () => {
    const res = await request(app)
      .options('/api/documents/conversation-1/document-1')
      .set('Origin', 'https://arbitrary-site.example')
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'authorization,x-document-processing-consent,x-document-consent-version')
      .expect(204);

    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.match(res.headers['access-control-allow-methods'], /DELETE/);
    const allowedHeaders = res.headers['access-control-allow-headers'].toLowerCase();
    assert.match(allowedHeaders, /x-document-processing-consent/);
    assert.match(allowedHeaders, /x-document-consent-version/);
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
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

  test('POST /api/documents/upload is registered through the serverless entry point', async () => {
    const res = await request(app)
      .post('/api/documents/upload')
      .set('X-Document-Processing-Consent', 'accepted')
      .set('X-Document-Consent-Version', DOCUMENT_PROCESSING_CONSENT_VERSION)
      .send({
        conversationId: 'vercel-upload-test',
        filename: 'notes.txt',
        mimetype: 'text/plain',
        base64Content: Buffer.from('A general business note.').toString('base64'),
        consentAccepted: true,
        consentVersion: DOCUMENT_PROCESSING_CONSENT_VERSION
      })
      .expect(200);

    assert.equal(res.body.conversationId, 'vercel-upload-test');
    assert.equal(res.body.document.fileType, 'txt');
  });

  test('generic host read and write actions produce permission-aware confirmed proposals', async () => {
    const readProposal = `\`\`\`action:generic
{
  "id": "read-1",
  "action": "notes:search",
  "title": "Search Notes",
  "parameters": { "query": "release" }
}
\`\`\``;
    const readResponse = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'integration-demo',
        message: `ECHO_RESPONSE:${readProposal}`
      })
      .expect(200);

    assert.equal(readResponse.body.action.action, 'notes:search');
    assert.equal(readResponse.body.action.risk, 'read');

    const writeProposal = `\`\`\`action:generic
{
  "id": "write-1",
  "action": "notes:update",
  "title": "Update Note",
  "parameters": { "noteId": "note-1", "text": "Updated note" }
}
\`\`\``;
    const writeResponse = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'integration-demo',
        message: `ECHO_RESPONSE:${writeProposal}`
      })
      .expect(200);

    assert.equal(writeResponse.body.action.action, 'notes:update');
    assert.equal(writeResponse.body.action.risk, 'write');
    assert.equal(writeResponse.body.action.requiresConfirmation, true);
  });
});
