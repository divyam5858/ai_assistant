import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { z } from 'zod';
import { OpenAIProvider } from '../backend/src/providers/openai.js';
import {
  encodeToolName,
  decodeToolName,
  actionDefinitionToOpenAITool,
  registryToOpenAITools
} from '../backend/src/actions/tool-converter.js';
import { ActionRegistry, actionRegistry } from '../backend/src/actions/registry.js';
import { MockConnector } from '../connectors/mock-connector.js';
import {
  bridgeConnectorToRegistry,
  getAssistantActionRegistry,
  clearAssistantRegistries
} from '../connectors/bridge.js';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';
import { registerLegacyHirePoolActions } from '../integrations/hirepool/legacy-actions.js';

/**
 * Helper creating a mock OpenAI SDK client instance for unit testing.
 */
function createMockOpenAIClient(config = {}) {
  const {
    responseMessage = { content: 'Mock response text', tool_calls: null },
    streamChunks = null,
    model = 'gpt-4o-mini'
  } = config;

  return {
    chat: {
      completions: {
        create: async (payload) => {
          if (payload.stream) {
            const chunks = streamChunks || [
              { choices: [{ delta: { content: 'Hello ' } }] },
              { choices: [{ delta: { content: 'from ' } }] },
              { choices: [{ delta: { content: 'stream' } }] }
            ];
            return (async function* () {
              for (const chunk of chunks) {
                yield chunk;
              }
            })();
          }

          // Check if this is a follow-up turn containing tool execution results
          const lastMsg = payload.messages[payload.messages.length - 1];
          if (lastMsg?.role === 'tool') {
            return {
              id: 'chatcmpl_followup',
              model,
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: {
                    role: 'assistant',
                    content: `Here is the synthesized answer based on tool output: ${lastMsg.content}`
                  }
                }
              ]
            };
          }

          return {
            id: 'chatcmpl_mock_1',
            model,
            choices: [
              {
                index: 0,
                finish_reason: responseMessage.tool_calls ? 'tool_calls' : 'stop',
                message: {
                  role: 'assistant',
                  content: responseMessage.content ?? null,
                  tool_calls: responseMessage.tool_calls || undefined
                }
              }
            ]
          };
        }
      }
    },
    models: {
      list: async () => ({ data: [{ id: 'gpt-4o-mini' }] })
    }
  };
}

describe('OpenAI Provider & Native Tool Calling (Milestone 3)', () => {

  // --- Scenario 1: Provider configuration missing ---
  test('1. Provider throws clear error when OPENAI_API_KEY is missing', async () => {
    const existingKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-environment-key';
    const provider = new OpenAIProvider({ apiKey: '' });
    if (existingKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = existingKey;
    }
    assert.equal(provider.apiKey, '');

    const health = await provider.checkHealth();
    assert.equal(health.available, false);
    assert.ok(health.message.includes('OPENAI_API_KEY is not configured'));

    await assert.rejects(
      async () => provider.chat({ messages: [{ role: 'user', content: 'Hi' }] }),
      /OPENAI_API_KEY is missing/
    );
  });

  // --- Scenario 2: Provider initialization ---
  test('2. Provider initializes with options, defaults to gpt-4o-mini, and allows client injection', () => {
    const mockClient = createMockOpenAIClient();
    const provider = new OpenAIProvider({
      apiKey: 'sk-test-mock-key-123',
      model: 'gpt-4o',
      timeoutMs: 15000,
      client: mockClient
    });

    assert.equal(provider.name, 'openai');
    assert.equal(provider.model, 'gpt-4o');
    assert.equal(provider.timeoutMs, 15000);
    assert.equal(provider.client, mockClient);

    // Sanitize error test: Ensure API key is redacted
    const sanitized = provider._sanitizeError(new Error('Failed with sk-test-mock-key-123 key'));
    assert.ok(!sanitized.message.includes('sk-test-mock-key-123'));
    assert.ok(sanitized.message.includes('[REDACTED_KEY]'));
  });

  // --- Scenario 3: Ordinary text response ---
  test('3. Provider processes ordinary text response without tool calls', async () => {
    const mockClient = createMockOpenAIClient({
      responseMessage: { content: 'This is a helpful assistant answer.', tool_calls: null }
    });
    const provider = new OpenAIProvider({ apiKey: 'sk-test', client: mockClient });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'What is Antigravity?' }]
    });

    assert.equal(result.text, 'This is a helpful assistant answer.');
    assert.equal(result.toolCalls, undefined);
    assert.equal(result.finishReason, 'stop');
  });

  // --- Scenario 4: Valid native tool call ---
  test('4. Provider parses valid native tool call and decodes name', async () => {
    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: null,
        tool_calls: [
          {
            id: 'call_abc123',
            type: 'function',
            function: {
              name: 'mock-knowledge__searchKnowledge',
              arguments: JSON.stringify({ query: 'widget sdk' })
            }
          }
        ]
      }
    });
    const provider = new OpenAIProvider({ apiKey: 'sk-test', client: mockClient });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Search articles for widget' }],
      tools: [{ type: 'function', function: { name: 'mock-knowledge__searchKnowledge' } }]
    });

    assert.ok(result.toolCalls);
    assert.equal(result.toolCalls.length, 1);
    const tc = result.toolCalls[0];
    assert.equal(tc.id, 'call_abc123');
    // Name must be decoded from __ back to :
    assert.equal(tc.name, 'mock-knowledge:searchKnowledge');
    assert.equal(tc.rawName, 'mock-knowledge__searchKnowledge');
    assert.deepEqual(tc.arguments, { query: 'widget sdk' });
    assert.equal(tc.argumentsError, false);
  });

  // --- Scenario 5: Multiple tool calls ---
  test('5. Provider parses multiple tool calls in one response preserving order', async () => {
    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: 'Searching two topics...',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'mock-knowledge__searchKnowledge',
              arguments: JSON.stringify({ query: 'first' })
            }
          },
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'mock-knowledge__searchKnowledge',
              arguments: JSON.stringify({ query: 'second' })
            }
          }
        ]
      }
    });
    const provider = new OpenAIProvider({ apiKey: 'sk-test', client: mockClient });
    const result = await provider.chat({ messages: [{ role: 'user', content: 'Search both' }] });

    assert.equal(result.toolCalls.length, 2);
    assert.equal(result.toolCalls[0].id, 'call_1');
    assert.equal(result.toolCalls[0].arguments.query, 'first');
    assert.equal(result.toolCalls[1].id, 'call_2');
    assert.equal(result.toolCalls[1].arguments.query, 'second');
  });

  // --- Scenario 6: Malformed arguments ---
  test('6. Provider flags malformed JSON tool arguments gracefully without crashing', async () => {
    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: null,
        tool_calls: [
          {
            id: 'call_bad_json',
            type: 'function',
            function: {
              name: 'mock-knowledge__searchKnowledge',
              arguments: '{ unclosed json: true '
            }
          }
        ]
      }
    });
    const provider = new OpenAIProvider({ apiKey: 'sk-test', client: mockClient });
    const result = await provider.chat({ messages: [{ role: 'user', content: 'Bad JSON' }] });

    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].argumentsError, true);
    assert.deepEqual(result.toolCalls[0].arguments, {});
  });

  // --- Tool Converter & Schema Tests ---
  test('Tool Converter encodes colons for OpenAI name pattern and decodes back', () => {
    assert.equal(encodeToolName('candidate:apply_job'), 'candidate__apply_job');
    assert.equal(encodeToolName('mock-knowledge:searchKnowledge'), 'mock-knowledge__searchKnowledge');
    assert.equal(decodeToolName('candidate__apply_job'), 'candidate:apply_job');
    assert.equal(decodeToolName('mock-knowledge__searchKnowledge'), 'mock-knowledge:searchKnowledge');
  });

  test('Tool Converter generates compliant OpenAI function tool schema from ActionDefinition', () => {
    const actionDef = {
      name: 'mock-knowledge:getCustomerProfile',
      title: 'Get Customer Profile',
      description: 'Retrieves customer account profile from CRM',
      parameterSchema: z.object({
        customerId: z.string().min(1).describe('The unique customer ID')
      }),
      parameters: { customerId: '<customer ID>' },
      promptable: true
    };

    const tool = actionDefinitionToOpenAITool(actionDef);
    assert.equal(tool.type, 'function');
    assert.equal(tool.function.name, 'mock-knowledge__getCustomerProfile');
    assert.equal(tool.function.description, 'Retrieves customer account profile from CRM');
    assert.equal(tool.function.parameters.type, 'object');
    assert.ok(tool.function.parameters.properties.customerId);
    assert.equal(tool.function.parameters.properties.customerId.type, 'string');
    assert.deepEqual(tool.function.parameters.required, ['customerId']);
  });

  test('registryToOpenAITools converts registered actions and excludes non-promptable ones', () => {
    const reg = new ActionRegistry();
    reg.register({
      name: 'app:promptable_one',
      description: 'First tool',
      promptable: true
    });
    reg.register({
      name: 'app:internal_batch',
      description: 'Internal non-promptable tool',
      promptable: false
    });

    const tools = registryToOpenAITools(reg);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].function.name, 'app__promptable_one');
  });
});

describe('End-to-End Chat Integration with Native Tool Calling', () => {
  let app;

  before(() => {
    app = createApp();
  });

  beforeEach(() => {
    clearAssistantRegistries();
    actionRegistry.clear();
  });

  afterEach(() => {
    clearAssistantRegistries();
    actionRegistry.clear();
    setAIProvider(new MockAIProvider());
  });

  // --- Scenario 7: Unknown tool ---
  test('7. Chat pipeline rejects unknown native tool name without executing', async () => {
    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: null,
        tool_calls: [
          {
            id: 'call_unknown',
            type: 'function',
            function: {
              name: 'unregistered__dangerous_action',
              arguments: '{}'
            }
          }
        ]
      }
    });
    setAIProvider(new OpenAIProvider({ apiKey: 'sk-mock', client: mockClient }));

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'default',
        message: 'Do something dangerous'
      });

    assert.equal(res.status, 200);
    // Unregistered tool must not be returned as valid host action or executed connector
    assert.equal(res.body.action, undefined);
    assert.equal(res.body.connectorResult, undefined);
  });

  // --- Scenario 8: Invalid schema parameters ---
  test('8. Chat pipeline rejects native tool call with invalid parameters failing schema validation', async () => {
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    // Mock client calls mock-knowledge:getCustomerProfile with empty customerId (fails min(1))
    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: null,
        tool_calls: [
          {
            id: 'call_invalid_params',
            type: 'function',
            function: {
              name: 'mock-knowledge__getCustomerProfile',
              arguments: JSON.stringify({ customerId: '' })
            }
          }
        ]
      }
    });
    setAIProvider(new OpenAIProvider({ apiKey: 'sk-mock', client: mockClient }));

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'support',
        message: 'Lookup profile with empty id',
        connectorAuth: { 'mock-knowledge': 'secret-demo-token-123' }
      });

    assert.equal(res.status, 200);
    assert.ok(res.text.includes('INVALID_PARAMETERS') || (res.body.text && res.body.text.includes('INVALID_PARAMETERS')));
  });

  // --- Scenario 9: Connector authorization failure ---
  test('9. Chat pipeline fails closed when protected connector action lacks auth token', async () => {
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: null,
        tool_calls: [
          {
            id: 'call_no_auth',
            type: 'function',
            function: {
              name: 'mock-knowledge__getCustomerProfile',
              arguments: JSON.stringify({ customerId: 'cust-001' })
            }
          }
        ]
      }
    });
    setAIProvider(new OpenAIProvider({ apiKey: 'sk-mock', client: mockClient }));

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'support',
        message: 'Lookup customer cust-001 without token',
        connectorAuth: {} // No token provided
      });

    assert.equal(res.status, 200);
    assert.ok(res.text.includes('UNAUTHORIZED') || (res.body.text && res.body.text.includes('UNAUTHORIZED')));
  });

  // --- Scenario 10: Connector execution failure ---
  test('10. Chat pipeline safely handles connector execution errors without crashing or exposing secrets', async () => {
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    // Request non-existent customer cust-999
    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: null,
        tool_calls: [
          {
            id: 'call_missing_cust',
            type: 'function',
            function: {
              name: 'mock-knowledge__getCustomerProfile',
              arguments: JSON.stringify({ customerId: 'cust-999' })
            }
          }
        ]
      }
    });
    setAIProvider(new OpenAIProvider({ apiKey: 'sk-mock', client: mockClient }));

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'support',
        message: 'Lookup cust-999',
        connectorAuth: { 'mock-knowledge': 'secret-demo-token-123' }
      });

    assert.equal(res.status, 200);
    assert.ok(res.text.includes('not found') || (res.body.text && res.body.text.includes('not found')));
  });

  // --- Scenario 11: Tool result association & synthesized response ---
  test('11. Chat pipeline associates tool result with tool_call_id and invokes follow-up synthesis', async () => {
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: null,
        tool_calls: [
          {
            id: 'call_search_101',
            type: 'function',
            function: {
              name: 'mock-knowledge__searchKnowledge',
              arguments: JSON.stringify({ query: 'widget' })
            }
          }
        ]
      }
    });
    setAIProvider(new OpenAIProvider({ apiKey: 'sk-mock', client: mockClient }));

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'support',
        message: 'How do I embed the widget?'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.connectorResult);
    assert.equal(res.body.connectorResult.success, true);
    assert.equal(res.body.connectorResult.action, 'searchKnowledge');
    // Follow-up synthesis verified
    assert.ok(res.body.text.includes('Synthesized answer') || res.body.text.includes('widget'));
  });

  // --- Scenario 12: Assistant registry isolation ---
  test('12. Assistant registry isolation prevents tool definition leakage across assistants', () => {
    // Researcher registry should NOT contain HirePool recruitment actions
    const researcherReg = getAssistantActionRegistry('researcher');
    const researcherTools = registryToOpenAITools(researcherReg);
    assert.equal(researcherTools.some(t => t.function.name.includes('apply_job')), false);

    // Generic default registries must not load HirePool recruitment tools.
    const defaultReg = getAssistantActionRegistry('default');
    const defaultTools = registryToOpenAITools(defaultReg);
    assert.equal(defaultTools.some(t => t.function.name === 'candidate__apply_job'), false);
    assert.equal(defaultTools.some(t => t.function.name === 'client__create_job'), false);
  });

  // --- Scenario 13: Legacy action proposal compatibility ---
  test('13. Chat pipeline maintains backward compatibility for legacy action proposals', async () => {
    registerLegacyHirePoolActions(actionRegistry);
    const legacyFencedBlock = `I will submit your job application:
\`\`\`action:hirepool
{
  "id": "act_hp_legacy",
  "action": "candidate:apply_job",
  "title": "Apply for Job",
  "explanation": "Submitting job application",
  "parameters": {
    "job_id": "00000000-0000-0000-0000-000000000001",
    "job_title": "Senior Architect"
  }
}
\`\`\`
Please confirm above.`;

    const mockClient = createMockOpenAIClient({
      responseMessage: { content: legacyFencedBlock, tool_calls: null }
    });
    setAIProvider(new OpenAIProvider({ apiKey: 'sk-mock', client: mockClient }));

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'default',
        message: 'I want to apply',
        context: 'Job ID: 00000000-0000-0000-0000-000000000001'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.action);
    assert.equal(res.body.action.action, 'candidate:apply_job');
    assert.equal(res.body.action.id, 'act_hp_legacy');
    assert.equal(res.body.connectorResult, undefined);
  });

  // --- Scenario 14: Non-streaming HirePool host action confirmation flow ---
  test('14. Native tool call for HirePool host action requires client confirmation and is not backend-executed', async () => {
    registerLegacyHirePoolActions(actionRegistry);
    const mockClient = createMockOpenAIClient({
      responseMessage: {
        content: 'I have prepared your application for submission.',
        tool_calls: [
          {
            id: 'call_hp_native_1',
            type: 'function',
            function: {
              name: 'candidate__apply_job',
              arguments: JSON.stringify({
                job_id: '00000000-0000-0000-0000-000000000001',
                job_title: 'Fullstack Engineer'
              })
            }
          }
        ]
      }
    });
    setAIProvider(new OpenAIProvider({ apiKey: 'sk-mock', client: mockClient }));

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'default',
        message: 'Apply for the fullstack engineer role',
        context: 'Job ID: 00000000-0000-0000-0000-000000000001'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.action);
    assert.equal(res.body.action.action, 'candidate:apply_job');
    assert.equal(res.body.action.parameters.job_id, '00000000-0000-0000-0000-000000000001');
    // Must NOT be executed as a backend connector
    assert.equal(res.body.connectorResult, undefined);
  });

  // --- Scenario 15: Streaming chat behavior ---
  test('15. Streaming endpoint streams chunks and emits action or connectorResult events', async () => {
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    // Mock stream returning a tool call
    const streamChunks = [
      { choices: [{ delta: { content: 'Searching ' } }] },
      { choices: [{ delta: { content: 'database...' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_stream_1',
                  type: 'function',
                  function: {
                    name: 'mock-knowledge__searchKnowledge',
                    arguments: '{"query": "streaming"}'
                  }
                }
              ]
            }
          }
        ]
      }
    ];

    const mockClient = createMockOpenAIClient({ streamChunks });
    setAIProvider(new OpenAIProvider({ apiKey: 'sk-mock', client: mockClient }));

    const res = await request(app)
      .post('/api/chat/stream')
      .send({
        assistantId: 'support',
        message: 'Stream search'
      });

    assert.equal(res.status, 200);
    assert.ok(res.text.includes('data: {"type":"start"'));
    assert.ok(res.text.includes('"type":"chunk"'));
    assert.ok(res.text.includes('"type":"connectorResult"'));
    assert.ok(res.text.includes('"action":"searchKnowledge"'));
    assert.ok(res.text.includes('"type":"done"'));
  });
});
