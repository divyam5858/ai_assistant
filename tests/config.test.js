import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AssistantConfigSchema,
  ChatRequestSchema,
  SummarizeRequestSchema,
  ConnectorActionSchema
} from '../config/schemas.js';
import { getAssistantConfig, ASSISTANT_PRESETS } from '../config/assistant-presets.js';

describe('Config & Validation Schemas', () => {
  test('AssistantConfigSchema validates correct configuration', () => {
    const valid = {
      assistantId: 'my_assistant-01',
      name: 'Custom Assistant',
      theme: 'dark',
      primaryColor: '#6366f1',
      position: 'bottom-right'
    };
    const parsed = AssistantConfigSchema.parse(valid);
    assert.equal(parsed.assistantId, 'my_assistant-01');
    assert.equal(parsed.theme, 'dark');
    assert.equal(parsed.primaryColor, '#6366f1');
    assert.equal(parsed.features.streaming, true);
  });

  test('AssistantConfigSchema rejects invalid hex color and invalid assistant ID', () => {
    assert.throws(() => {
      AssistantConfigSchema.parse({
        assistantId: 'bad id with spaces!',
        primaryColor: '#invalidcolor'
      });
    });
  });

  test('ChatRequestSchema validates valid chat payload and trims message', () => {
    const parsed = ChatRequestSchema.parse({
      message: '   Hello world   ',
      conversationId: 'convo-123'
    });
    assert.equal(parsed.message, 'Hello world');
    assert.equal(parsed.conversationId, 'convo-123');
    assert.equal(parsed.stream, false);
  });

  test('ChatRequestSchema rejects empty message', () => {
    assert.throws(() => {
      ChatRequestSchema.parse({ message: '   ' });
    });
  });

  test('ChatRequestSchema rejects messages exceeding 10,000 characters', () => {
    const oversized = 'a'.repeat(10001);
    assert.throws(() => {
      ChatRequestSchema.parse({ message: oversized });
    });
  });

  test('ChatRequestSchema validates optional context and trims whitespace', () => {
    const parsed = ChatRequestSchema.parse({
      message: 'Hello',
      context: '   Active user is Alex   '
    });
    assert.equal(parsed.context, 'Active user is Alex');

    // Context can be omitted or null
    const noContext = ChatRequestSchema.parse({ message: 'Hello' });
    assert.equal(noContext.context, undefined);

    const nullContext = ChatRequestSchema.parse({ message: 'Hello', context: null });
    assert.equal(nullContext.context, null);
  });

  test('ChatRequestSchema rejects context exceeding 30,000 characters', () => {
    const oversizedContext = 'x'.repeat(30001);
    assert.throws(() => {
      ChatRequestSchema.parse({
        message: 'Hello',
        context: oversizedContext
      });
    });
  });

  test('ChatRequestSchema rejects invalid non-string context types', () => {
    assert.throws(() => {
      ChatRequestSchema.parse({
        message: 'Hello',
        context: 12345
      });
    });
    assert.throws(() => {
      ChatRequestSchema.parse({
        message: 'Hello',
        context: { role: 'admin' }
      });
    });
  });

  test('SummarizeRequestSchema validates supported styles', () => {
    const styles = ['concise', 'detailed', 'bullet_points', 'key_takeaways', 'action_items', 'structured_json'];
    for (const style of styles) {
      const parsed = SummarizeRequestSchema.parse({
        text: 'Some test text to summarize.',
        style
      });
      assert.equal(parsed.style, style);
    }
  });

  test('SummarizeRequestSchema rejects unsupported style', () => {
    assert.throws(() => {
      SummarizeRequestSchema.parse({
        text: 'Some test text.',
        style: 'invalid_style'
      });
    });
  });

  test('ConnectorActionSchema validates action execution payload', () => {
    const parsed = ConnectorActionSchema.parse({
      connectorId: 'mock-knowledge',
      action: 'searchKnowledge',
      parameters: { query: 'test' }
    });
    assert.equal(parsed.connectorId, 'mock-knowledge');
    assert.equal(parsed.action, 'searchKnowledge');
    assert.equal(parsed.parameters.query, 'test');
  });

  test('getAssistantConfig returns requested preset or fallback to default', () => {
    const researcher = getAssistantConfig('researcher');
    assert.equal(researcher.name, ASSISTANT_PRESETS.researcher.name);

    const unknown = getAssistantConfig('unknown-id-xyz');
    assert.equal(unknown.assistantId, 'unknown-id-xyz');
    assert.equal(unknown.name, ASSISTANT_PRESETS.default.name);
  });
});

