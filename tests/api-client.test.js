import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantApiClient } from '../widget/src/api-client.js';
import { DOCUMENT_PROCESSING_CONSENT_VERSION } from '../config/document-upload.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function streamingResponse(events, chunkSize = 9) {
  const encoder = new TextEncoder();
  const content = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = encoder.encode(content);
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    }
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

test('chat streaming parses split SSE frames and returns the completed result', async () => {
  globalThis.fetch = async () => streamingResponse([
    { type: 'start', conversationId: 'conversation-1' },
    { type: 'chunk', delta: 'Hello ' },
    { type: 'chunk', delta: 'world' },
    { type: 'done', text: 'Hello world', model: 'test-model' }
  ]);
  const chunks = [];
  const result = await new AssistantApiClient().sendMessage({
    message: 'Hello',
    onChunk: chunk => chunks.push(chunk)
  });

  assert.deepEqual(chunks, ['Hello ', 'world']);
  assert.equal(result.text, 'Hello world');
  assert.equal(result.conversationId, 'conversation-1');
  assert.equal(result.model, 'test-model');
});

test('chat streaming propagates server errors with their original message', async () => {
  globalThis.fetch = async () => streamingResponse([
    { type: 'error', error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Provider unavailable for this request.' } }
  ]);
  let observedError;

  await assert.rejects(
    () => new AssistantApiClient().sendMessage({
      message: 'Hello',
      onError: error => { observedError = error; }
    }),
    error => error.message === 'Provider unavailable for this request.' &&
      error.code === 'UPSTREAM_UNAVAILABLE'
  );
  assert.equal(observedError.message, 'Provider unavailable for this request.');
});

test('chat streaming rejects malformed events and incomplete streams', async () => {
  globalThis.fetch = async () => new Response('data: not-json\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
  await assert.rejects(
    () => new AssistantApiClient().sendMessage({ message: 'Hello' }),
    /malformed streaming event/
  );

  globalThis.fetch = async () => streamingResponse([
    { type: 'start', conversationId: 'conversation-1' },
    { type: 'chunk', delta: 'Partial response' }
  ]);
  await assert.rejects(
    () => new AssistantApiClient().sendMessage({ message: 'Hello' }),
    /ended before the assistant completed/
  );
});

test('summarization streaming propagates provider errors', async () => {
  globalThis.fetch = async () => streamingResponse([
    { type: 'error', error: { message: 'Summarization provider rejected the request.' } }
  ]);
  await assert.rejects(
    () => new AssistantApiClient().summarize({ text: 'Source text', stream: true }),
    /Summarization provider rejected the request/
  );
});

test('document upload requires consent and sends the current consent assertion', async () => {
  let requestOptions;
  globalThis.fetch = async (_url, options) => {
    requestOptions = options;
    return new Response(JSON.stringify({
      status: 'success',
      conversationId: 'conversation-1',
      document: { id: 'document-1', filename: 'notes.txt' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const file = new Blob(['notes']);
  file.name = 'notes.txt';
  const client = new AssistantApiClient();

  await assert.rejects(
    () => client.uploadDocument(file, undefined),
    /Explicit document-processing consent/
  );
  assert.equal(requestOptions, undefined);

  await client.uploadDocument(file, 'conversation-1', { consentAccepted: true });
  assert.equal(requestOptions.headers['X-Document-Processing-Consent'], 'accepted');
  assert.equal(requestOptions.headers['X-Document-Consent-Version'], DOCUMENT_PROCESSING_CONSENT_VERSION);
  assert.equal(requestOptions.body.get('consentAccepted'), 'true');
  assert.equal(requestOptions.body.get('consentVersion'), DOCUMENT_PROCESSING_CONSENT_VERSION);
});
