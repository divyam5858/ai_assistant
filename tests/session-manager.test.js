import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager, SessionExpiredError } from '../backend/src/session-manager.js';

describe('SessionManager', () => {
  test('creates session with given or generated ID', () => {
    const sm = new SessionManager();
    const s1 = sm.getOrCreate('user-session-1', 'default');
    assert.equal(s1.id, 'user-session-1');
    assert.equal(s1.assistantId, 'default');
    assert.equal(s1.messages.length, 0);

    const s2 = sm.getOrCreate();
    assert.ok(s2.id);
    assert.notEqual(s2.id, 'user-session-1');
    sm.close();
  });

  test('adds messages and preserves context', () => {
    const sm = new SessionManager();
    const id = 'test-convo-1';
    sm.addMessage(id, 'user', 'What is Node.js?');
    sm.addMessage(id, 'assistant', 'Node.js is a JavaScript runtime.');

    const context = sm.getContextMessages(id);
    assert.equal(context.length, 2);
    assert.equal(context[0].role, 'user');
    assert.equal(context[0].content, 'What is Node.js?');
    assert.equal(context[1].role, 'assistant');
    assert.equal(context[1].content, 'Node.js is a JavaScript runtime.');
    sm.close();
  });

  test('truncates history when exceeding maxContextMessages', () => {
    const sm = new SessionManager({ maxContextMessages: 4 });
    const id = 'truncation-test';

    for (let i = 1; i <= 6; i++) {
      sm.addMessage(id, i % 2 === 1 ? 'user' : 'assistant', `Message ${i}`);
    }

    const messages = sm.getContextMessages(id);
    assert.equal(messages.length, 4);
    assert.equal(messages[0].content, 'Message 3');
    assert.equal(messages[3].content, 'Message 6');
    sm.close();
  });

  test('clears conversation messages while retaining session ID', () => {
    const sm = new SessionManager();
    const id = 'clear-test';
    sm.addMessage(id, 'user', 'Hello');
    sm.addMessage(id, 'assistant', 'Hi');

    assert.equal(sm.getContextMessages(id).length, 2);
    const cleared = sm.clear(id);
    assert.equal(cleared, true);
    assert.equal(sm.getContextMessages(id).length, 0);

    // Session still exists
    const session = sm.getOrCreate(id);
    assert.equal(session.id, id);
    sm.close();
  });

  test('expires sessions and rejects attempts to silently recreate document context', async () => {
    const sm = new SessionManager({ ttlMs: 50 });
    const id = 'expiry-test';
    sm.addDocument(id, { filename: 'temporary.txt', text: 'Temporary private content' });

    const session = sm.sessions.get(id);
    assert.equal(session.documents.length, 1);
    session.lastActiveAt = Date.now() - 51;

    assert.equal(sm.getDocuments(id).length, 0);
    assert.equal(sm.sessions.has(id), false);
    assert.throws(() => sm.getOrCreate(id), SessionExpiredError);
    sm.close();
  });

  test('isolates separate conversations', () => {
    const sm = new SessionManager();
    sm.addMessage('user-a', 'user', 'Hello from Alice');
    sm.addMessage('user-b', 'user', 'Hello from Bob');

    const aliceCtx = sm.getContextMessages('user-a');
    const bobCtx = sm.getContextMessages('user-b');

    assert.equal(aliceCtx.length, 1);
    assert.equal(aliceCtx[0].content, 'Hello from Alice');

    assert.equal(bobCtx.length, 1);
    assert.equal(bobCtx[0].content, 'Hello from Bob');
    sm.close();
  });

  test('rejects access to tenant-bound sessions when tenant identity is missing', () => {
    const sm = new SessionManager();
    sm.getOrCreate('tenant-bound', 'default', {
      userId: 'owner',
      tenantId: 'tenant-a'
    });

    assert.throws(
      () => sm.getDocuments('tenant-bound', { userId: 'owner', tenantId: null }),
      (err) => err.code === 'TENANT_MISMATCH'
    );

    sm.getOrCreate('tenant-only', 'default', { tenantId: 'tenant-a' });
    assert.throws(
      () => sm.getDocuments('tenant-only'),
      (err) => err.code === 'TENANT_MISMATCH'
    );
    sm.close();
  });

  test('rejects access to user-bound sessions when caller identity is omitted', () => {
    const sm = new SessionManager();
    sm.getOrCreate('user-bound', 'default', { userId: 'owner' });

    assert.throws(
      () => sm.getContextMessages('user-bound'),
      (err) => err.code === 'SESSION_ACCESS_DENIED'
    );
    sm.close();
  });
});
