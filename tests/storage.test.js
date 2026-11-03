import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantStorage } from '../widget/src/storage.js';

describe('AssistantStorage', () => {
  test('saves, retrieves, and clears the active conversation ID', () => {
    const storage = new AssistantStorage('storage-test');

    storage.saveConversationId(' conversation-123 ');
    assert.equal(storage.getConversationId(), 'conversation-123');

    storage.clearConversationId();
    assert.equal(storage.getConversationId(), null);
  });

  test('clear removes the conversation ID and persisted widget state', () => {
    const storage = new AssistantStorage('storage-clear-test');
    storage.saveConversationId('conversation-123');
    storage.set('messages', [{ role: 'user', content: 'hello' }]);

    storage.clear();

    assert.equal(storage.getConversationId(), null);
    assert.deepEqual(storage.get('messages', []), []);
  });
});
