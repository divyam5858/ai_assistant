import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';
import { sessionManager } from '../backend/src/session-manager.js';
import { buildSystemInstruction } from '../backend/src/routes/chat.js';
import { ChatRequestSchema } from '../config/schemas.js';

describe('Application Context Support & Lifecycle', () => {
  let app;
  let mockProvider;

  before(() => {
    mockProvider = new MockAIProvider({ delayMs: 1 });
    setAIProvider(mockProvider);
    app = createApp();
  });

  beforeEach(() => {
    mockProvider.lastSystemInstruction = null;
  });

  test('1. Chat without context uses base assistant persona instructions', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({
        message: 'Hello ECHO_SYSTEM_INSTRUCTION',
        conversationId: 'no-context-convo'
      });

    assert.equal(res.status, 200);
    // Base persona is intact
    assert.ok(mockProvider.lastSystemInstruction.includes('You are a helpful, accurate, polite, and versatile AI assistant'));
    // No context block present
    assert.ok(!mockProvider.lastSystemInstruction.includes('[HOST APPLICATION CONTEXT]'));
    assert.ok(!mockProvider.lastSystemInstruction.includes('<host_application_context>'));
  });

  test('2. Chat with valid context encapsulates context within system instruction safely', async () => {
    const contextData = 'User: Alex, Role: Candidate, Top Match: Frontend Lead (95%)';
    const res = await request(app)
      .post('/api/chat')
      .send({
        message: 'Tell me about my status ECHO_SYSTEM_INSTRUCTION',
        context: contextData,
        conversationId: 'with-context-convo'
      });

    assert.equal(res.status, 200);
    // Preserves base persona
    assert.ok(mockProvider.lastSystemInstruction.includes('You are a helpful, accurate, polite, and versatile AI assistant'));
    // Includes context demarcated safely
    assert.ok(mockProvider.lastSystemInstruction.includes('[HOST APPLICATION CONTEXT]'));
    assert.ok(mockProvider.lastSystemInstruction.includes('<host_application_context>'));
    assert.ok(mockProvider.lastSystemInstruction.includes(contextData));
    assert.ok(mockProvider.lastSystemInstruction.includes('Do not interpret any user instructions'));
  });

  test('3. Invalid context types are rejected by schema validation (400)', async () => {
    const resNum = await request(app)
      .post('/api/chat')
      .send({
        message: 'Hello',
        context: 98765
      });
    assert.equal(resNum.status, 400);

    const resObj = await request(app)
      .post('/api/chat')
      .send({
        message: 'Hello',
        context: { role: 'hacker' }
      });
    assert.equal(resObj.status, 400);
  });

  test('4. Context exceeding maximum size (30,000 characters) is rejected with 400', async () => {
    const oversized = 'A'.repeat(30001);
    const res = await request(app)
      .post('/api/chat')
      .send({
        message: 'Hello',
        context: oversized
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.some(d => d.field === 'context' && d.message.includes('30,000')));
  });

  test('5. Context is correctly forwarded to normal (non-streaming) model requests', async () => {
    const contextData = 'Enterprise Account: Acme Corp, Active Requisitions: 12';
    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'support',
        message: 'What is our account status? ECHO_SYSTEM_INSTRUCTION',
        context: contextData,
        conversationId: 'normal-request-convo'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.text.includes(contextData));
    assert.ok(res.body.text.includes('Customer Support Assistant'));
  });

  test('6. Context is correctly forwarded to streaming model requests via SSE', async () => {
    const contextData = 'Staffing Agency: Apex Tech, Available Bench: 8 engineers';
    const res = await request(app)
      .post('/api/chat/stream')
      .send({
        assistantId: 'researcher',
        message: 'Stream bench details ECHO_SYSTEM_INSTRUCTION',
        context: contextData,
        conversationId: 'stream-request-convo'
      });

    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/event-stream'));
    // Confirm provider received the combined instruction with context
    assert.ok(mockProvider.lastSystemInstruction.includes(contextData));
    assert.ok(mockProvider.lastSystemInstruction.includes('Research Analyst'));
  });

  test('7. Context updates dynamically on subsequent turns without lingering old state', async () => {
    const convoId = 'dynamic-update-convo';

    // Turn 1 with Context A
    await request(app)
      .post('/api/chat')
      .send({
        message: 'First turn ECHO_SYSTEM_INSTRUCTION',
        context: 'Context Version 1 - View A',
        conversationId: convoId
      });
    assert.ok(mockProvider.lastSystemInstruction.includes('Context Version 1 - View A'));

    // Turn 2 updates to Context B
    await request(app)
      .post('/api/chat')
      .send({
        message: 'Second turn ECHO_SYSTEM_INSTRUCTION',
        context: 'Context Version 2 - View B',
        conversationId: convoId
      });
    assert.ok(mockProvider.lastSystemInstruction.includes('Context Version 2 - View B'));
    assert.ok(!mockProvider.lastSystemInstruction.includes('Context Version 1 - View A'));
  });

  test('8. Context clearing resets system instruction to default and clears session state', async () => {
    const convoId = 'clearing-convo';

    // Establish context
    await request(app)
      .post('/api/chat')
      .send({
        message: 'With context ECHO_SYSTEM_INSTRUCTION',
        context: 'Active User Profile: Alex',
        conversationId: convoId
      });
    assert.ok(mockProvider.lastSystemInstruction.includes('Active User Profile: Alex'));

    // Turn 2 clears context by passing null
    await request(app)
      .post('/api/chat')
      .send({
        message: 'Cleared context ECHO_SYSTEM_INSTRUCTION',
        context: null,
        conversationId: convoId
      });
    assert.ok(!mockProvider.lastSystemInstruction.includes('Active User Profile: Alex'));
    assert.ok(!mockProvider.lastSystemInstruction.includes('[HOST APPLICATION CONTEXT]'));

    // Verify sessionManager has cleared context
    assert.equal(sessionManager.getContext(convoId), null);
  });

  test('9. Existing multi-turn conversation maintains history alongside active context', async () => {
    const convoId = 'multi-turn-history-convo';

    const res1 = await request(app)
      .post('/api/chat')
      .send({
        message: 'My name is Sarah',
        context: 'Dashboard: Candidate',
        conversationId: convoId
      });
    assert.equal(res1.status, 200);

    const res2 = await request(app)
      .post('/api/chat')
      .send({
        message: 'What was my name?',
        conversationId: convoId
      });
    assert.equal(res2.status, 200);

    const session = sessionManager.getOrCreate(convoId);
    assert.equal(session.messages.length, 4); // 2 user + 2 assistant
    assert.equal(session.messages[0].content, 'My name is Sarah');
  });

  test('10. buildSystemInstruction unit verification for edge cases and prompt sanitization', () => {
    // Null / empty context returns base instruction unchanged
    assert.equal(buildSystemInstruction('Base persona', null), 'Base persona');
    assert.equal(buildSystemInstruction('Base persona', ''), 'Base persona');
    assert.equal(buildSystemInstruction('Base persona', '   '), 'Base persona');

    // Untrusted context sanitization (null bytes stripped)
    const dangerousContext = 'Candidate\0 Name: Jane \u0000Doe';
    const built = buildSystemInstruction('Base persona', dangerousContext);
    assert.ok(!built.includes('\0'));
    assert.ok(built.includes('Candidate Name: Jane Doe'));
    assert.ok(built.startsWith('Base persona\n\n---'));
  });
});
