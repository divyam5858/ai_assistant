import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { z } from 'zod';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';
import { ActionProposalSchema } from '../config/schemas.js';
import { extractActionProposal, buildSystemInstruction } from '../backend/src/routes/chat.js';
import { ActionRegistry, actionRegistry } from '../backend/src/actions/registry.js';
import { GroqProvider } from '../backend/src/providers/groq.js';
import { ResilientFallbackProvider } from '../backend/src/providers/factory.js';
import { BaseAIProvider } from '../backend/src/providers/base.js';
import { registryToOpenAITools } from '../backend/src/actions/tool-converter.js';
import { HIREPOOL_ACTIONS, registerLegacyHirePoolActions } from '../integrations/hirepool/legacy-actions.js';

function registerLegacyHirePoolDefaults() {
  actionRegistry.clear();
  registerLegacyHirePoolActions(actionRegistry);
}

describe('Structured Action Protocol & Groq Provider', () => {
  let app;

  before(() => {
    setAIProvider(new MockAIProvider());
    app = createApp();
  });

  beforeEach(() => {
    actionRegistry.clear();
  });

  afterEach(() => {
    actionRegistry.clear();
  });

  test('registered actions are filtered by trusted permissions and risk is explicit', () => {
    const registry = new ActionRegistry();
    registry.register({
      name: 'records:read',
      description: 'Read records',
      permissions: ['records.read'],
      risk: 'read'
    });
    registry.register({
      name: 'records:delete',
      description: 'Delete records',
      permissions: ['records.delete'],
      risk: 'destructive'
    });

    const anonymousTools = registryToOpenAITools(registry);
    assert.equal(anonymousTools.length, 0);

    const readTools = registryToOpenAITools(registry, ['records.read']);
    assert.deepEqual(readTools.map(tool => tool.function.name), ['records__read']);
    assert.ok(registry.formatPromptGuidelines(undefined, ['records.read']).includes('records:read'));
    assert.ok(!registry.formatPromptGuidelines(undefined, ['records.read']).includes('records:delete'));
    assert.equal(registry.get('records:delete').risk, 'destructive');
  });
  test('ActionProposalSchema validates candidate:apply_job proposal', () => {
    registerLegacyHirePoolDefaults();
    const valid = {
      id: 'act_101',
      action: 'candidate:apply_job',
      title: 'Apply for Senior Architect',
      explanation: 'Submitting application using candidate profile',
      parameters: {
        job_id: '9a7b3c21-1234-4567-89ab-cdef01234567',
        job_title: 'Senior Architect',
        company_name: 'TechCorp'
      }
    };
    const parsed = ActionProposalSchema.parse(valid);
    assert.equal(parsed.action, 'candidate:apply_job');
    assert.equal(parsed.parameters.job_id, '9a7b3c21-1234-4567-89ab-cdef01234567');
  });

  test('ActionProposalSchema validates consultancy:create_candidates_batch proposal', () => {
    registerLegacyHirePoolDefaults();
    const valid = {
      id: 'act_102',
      action: 'consultancy:create_candidates_batch',
      title: 'Batch Create Agency Candidates',
      explanation: 'Creating 2 reviewed candidates from uploaded document',
      parameters: {
        candidates: [
          { first_name: 'John', last_name: 'Doe', email: 'john@example.com' },
          { first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com' }
        ]
      }
    };
    const parsed = ActionProposalSchema.parse(valid);
    assert.equal(parsed.action, 'consultancy:create_candidates_batch');
    assert.equal(parsed.parameters.candidates.length, 2);
  });

  test('ActionProposalSchema rejects unauthorized or arbitrary action names', () => {
    const invalid = {
      id: 'act_bad',
      action: 'admin:delete_database',
      title: 'Dangerous Action',
      parameters: {}
    };
    assert.throws(() => ActionProposalSchema.parse(invalid));
  });

  test('extractActionProposal parses action:hirepool fenced block', () => {
    registerLegacyHirePoolDefaults();
    const text = `I found a great role for you!
\`\`\`action:hirepool
{
  "id": "act_test_1",
  "action": "candidate:apply_job",
  "title": "Apply for Frontend Lead",
  "explanation": "Applying to Frontend Lead at TechCorp",
  "parameters": {
    "job_id": "00000000-0000-0000-0000-000000000001"
  }
}
\`\`\`
Please confirm above.`;

    const res = extractActionProposal(text);
    assert.ok(res.action);
    assert.equal(res.action.action, 'candidate:apply_job');
    assert.equal(res.action.parameters.job_id, '00000000-0000-0000-0000-000000000001');
  });

  test('extractActionProposal safely ignores invalid or malformed action JSON', () => {
    const malformed = `Here is some text:
\`\`\`action:hirepool
{ bad_json: true,
\`\`\`
Ending.`;

    const res = extractActionProposal(malformed);
    assert.equal(res.action, null);
    assert.equal(res.text, malformed);
  });

  test('GroqProvider handles configuration and error sanitization', () => {
    const provider = new GroqProvider({
      apiKey: 'gsk_supersecretkey12345',
      model: 'llama-3.3-70b-versatile'
    });
    assert.equal(provider.name, 'groq');
    assert.equal(provider.model, 'llama-3.3-70b-versatile');

    const sanitized = provider._sanitizeError(new Error('Failed with gsk_supersecretkey12345 key'));
    assert.ok(!sanitized.message.includes('gsk_supersecretkey12345'));
    assert.ok(sanitized.message.includes('[REDACTED_KEY]'));
  });

  test('ResilientFallbackProvider seamlessly falls back when primary hits 429', async () => {
    class FailingPrimary extends BaseAIProvider {
      constructor() { super('failing'); }
      async chat() {
        const err = new Error('Rate limit exceeded (429)');
        err.statusCode = 429;
        throw err;
      }
    }

    class WorkingFallback extends BaseAIProvider {
      constructor() { super('fallback'); }
      async chat() {
        return { text: 'Hello from Groq Fallback!', model: 'groq-llama' };
      }
    }

    const fallbackProvider = new ResilientFallbackProvider(new FailingPrimary(), new WorkingFallback());
    const res = await fallbackProvider.chat({ messages: [{ role: 'user', content: 'Hi' }] });
    assert.equal(res.text, 'Hello from Groq Fallback!');
    assert.equal(res.model, 'groq-llama');
  });

  test('POST /api/chat includes action proposal when generated by assistant', async () => {
    registerLegacyHirePoolDefaults();
    const actionPayload = `I can help you add this candidate to your pool.
\`\`\`action:hirepool
{
  "id": "act_agency_1",
  "action": "consultancy:add_candidate",
  "title": "Add Candidate: Marcus Vance",
  "explanation": "Add Marcus Vance (DevOps) to agency pool",
  "parameters": {
    "first_name": "Marcus",
    "last_name": "Vance",
    "email": "marcus.v@example.com",
    "candidate_consent": true
  }
}
\`\`\``;

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'default',
        message: 'ECHO_RESPONSE:' + actionPayload
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.action);
    assert.equal(res.body.action.action, 'consultancy:add_candidate');
    assert.equal(res.body.action.parameters.first_name, 'Marcus');
  });

  test('POST /api/chat/stream streams action event when action is proposed', async () => {
    registerLegacyHirePoolDefaults();
    const actionPayload = `\`\`\`action:hirepool
{
  "id": "act_client_1",
  "action": "client:create_job",
  "title": "Create Draft Job: React Lead",
  "explanation": "Create draft job posting",
  "parameters": {
    "title": "React Lead",
    "description": "Looking for React Lead with minimum 5 years of experience...",
    "job_type": "full_time",
    "status": "draft"
  }
}
\`\`\``;

    const res = await request(app)
      .post('/api/chat/stream')
      .send({
        assistantId: 'default',
        message: 'ECHO_RESPONSE:' + actionPayload
      });

    assert.equal(res.status, 200);
    assert.ok(res.text.includes('"type":"action"'));
    assert.ok(res.text.includes('"action":"client:create_job"'));
    assert.ok(res.text.includes('"type":"done"'));
  });
});

describe('Extensible Action Registry', () => {
  let app;
  let customRegistry;

  before(() => {
    setAIProvider(new MockAIProvider());
    app = createApp();
  });

  beforeEach(() => {
    customRegistry = new ActionRegistry();
  });

  afterEach(() => {
    actionRegistry.clear();
  });

  // --- Registry Contract & Validation Tests ---
  test('generic registries start without application-specific actions', () => {
    assert.deepEqual(new ActionRegistry().list(), []);
    assert.deepEqual(actionRegistry.list(), []);
    assert.throws(
      () => new ActionRegistry({ loadDefaults: true }),
      /pass action definitions via options\.actions/
    );
  });

  test('ActionRegistry registers a valid custom action definition', () => {
    const action = customRegistry.register({
      name: 'portfolio:contact_me',
      title: 'Send Contact Message',
      description: 'Sends a direct inquiry message to portfolio owner',
      parameters: { email: 'string', message: 'string' }
    });

    assert.equal(action.name, 'portfolio:contact_me');
    assert.equal(customRegistry.has('portfolio:contact_me'), true);
    assert.equal(customRegistry.get('portfolio:contact_me').title, 'Send Contact Message');
    assert.equal(customRegistry.list().length, 1);
  });

  test('ActionRegistry registers multiple actions with registerMany', () => {
    const actions = customRegistry.registerMany([
      { name: 'app:read_doc', description: 'Reads a doc' },
      { name: 'app:export_pdf', description: 'Exports doc to PDF' }
    ]);

    assert.equal(actions.length, 2);
    assert.equal(customRegistry.list().length, 2);
    assert.deepEqual(customRegistry.getAllowedActionNames(), ['app:read_doc', 'app:export_pdf']);
  });

  test('ActionRegistry registerMany is atomic on failure without partial mutation', () => {
    assert.equal(customRegistry.list().length, 0);

    // Attempt batch where 2nd element is invalid (empty name)
    assert.throws(
      () => customRegistry.registerMany([
        { name: 'app:valid_one', description: 'Valid first action' },
        { name: '', description: 'Invalid second action' }
      ]),
      /Action name cannot be empty/
    );

    // Neither action should have been added
    assert.equal(customRegistry.list().length, 0);
    assert.equal(customRegistry.has('app:valid_one'), false);
  });

  test('ActionRegistry get and list return shallow copies protecting internal state', () => {
    customRegistry.register({
      name: 'app:immutable_test',
      description: 'Original description'
    });

    const retrieved = customRegistry.get('app:immutable_test');
    retrieved.description = 'Mutated description';

    // Original state remains intact
    assert.equal(customRegistry.get('app:immutable_test').description, 'Original description');

    const listed = customRegistry.list();
    listed[0].description = 'Another mutation';
    assert.equal(customRegistry.get('app:immutable_test').description, 'Original description');
  });

  test('ActionRegistry rejects duplicate action names', () => {
    customRegistry.register({ name: 'app:action_one', description: 'First action' });
    assert.throws(
      () => customRegistry.register({ name: 'app:action_one', description: 'Duplicate action' }),
      /Duplicate action registration/
    );
  });

  test('ActionRegistry rejects invalid definitions (missing required metadata)', () => {
    // Missing description
    assert.throws(() => customRegistry.register({ name: 'app:no_desc' }));
    // Empty name
    assert.throws(() => customRegistry.register({ name: '', description: 'Desc' }));
    // Invalid characters in name
    assert.throws(() => customRegistry.register({ name: 'invalid action space', description: 'Desc' }));
  });

  test('ActionRegistry validates and rejects invalid parameter schemas', () => {
    // Non-schema object for parameterSchema
    assert.throws(
      () => customRegistry.register({
        name: 'app:bad_schema',
        description: 'Action with bad schema',
        parameterSchema: 'not-a-valid-schema'
      }),
      /parameterSchema must be a valid schema instance/
    );

    // Valid Zod schema for parameterSchema succeeds
    const validWithSchema = customRegistry.register({
      name: 'app:good_schema',
      description: 'Action with good Zod schema',
      parameterSchema: z.object({ count: z.number().min(1) })
    });
    assert.ok(validWithSchema);

    // Proposal validation using the parameter schema
    const validProposal = customRegistry.validateProposal({
      id: 'act_good',
      action: 'app:good_schema',
      title: 'Valid Count',
      parameters: { count: 5 }
    });
    assert.equal(validProposal.success, true);

    const invalidProposal = customRegistry.validateProposal({
      id: 'act_bad',
      action: 'app:good_schema',
      title: 'Invalid Count',
      parameters: { count: -1 } // fails min(1)
    });
    assert.equal(invalidProposal.success, false);
  });

  test('ActionRegistry handles an empty registry gracefully', () => {
    const empty = new ActionRegistry();
    assert.equal(empty.list().length, 0);
    assert.equal(empty.getAllowedActionNames().length, 0);
    assert.equal(empty.formatPromptGuidelines(), '');

    const proposal = empty.validateProposal({
      id: 'act_1',
      action: 'candidate:apply_job',
      title: 'Apply',
      parameters: {}
    });
    assert.equal(proposal.success, false);
  });

  // --- Backward Compatibility Tests ---
  test('HirePool legacy actions can be explicitly registered by their integration', () => {
    registerLegacyHirePoolDefaults();
    assert.ok(actionRegistry.has('candidate:apply_job'));
    assert.ok(actionRegistry.has('consultancy:add_candidate'));
    assert.ok(actionRegistry.has('consultancy:create_candidates_batch'));
    assert.ok(actionRegistry.has('client:create_job'));

    assert.deepEqual(
      actionRegistry.list().map(action => action.name).sort(),
      [...HIREPOOL_ACTIONS].sort()
    );
  });

  test('Explicitly enabled HirePool actions retain their legacy prompt format', () => {
    registerLegacyHirePoolDefaults();
    const prompt = actionRegistry.formatPromptGuidelines();
    assert.ok(prompt.includes('action:hirepool'));
    assert.ok(prompt.includes('candidate:apply_job'));
    assert.ok(prompt.includes('consultancy:add_candidate'));
    assert.ok(prompt.includes('client:create_job'));
    assert.ok(prompt.includes('CRITICAL: The job_id MUST be one of the exact Job IDs'));
  });

  test('extractActionProposal parses a generic action tag using registered actions', () => {
    actionRegistry.register({
      name: 'portfolio:apply',
      title: 'Apply',
      description: 'Submit an application'
    });
    const genericText = `I will execute this action for you:
\`\`\`action
{
  "id": "act_generic_1",
  "action": "portfolio:apply",
  "title": "Apply generic",
  "parameters": { "job_id": "00000000-0000-0000-0000-000000000002" }
}
\`\`\``;

    const res = extractActionProposal(genericText);
    assert.ok(res.action);
    assert.equal(res.action.action, 'portfolio:apply');
    assert.equal(res.action.id, 'act_generic_1');
  });

  // --- Chat Integration with Extensible Actions ---
  test('Chat route validates and outputs custom actions registered at runtime', async () => {
    actionRegistry.register({
      name: 'portfolio:send_inquiry',
      title: 'Send Portfolio Inquiry',
      description: 'Sends inquiry from visitor to portfolio developer',
      parameters: { inquiry: 'string' }
    });

    const customPayload = `\`\`\`action
{
  "id": "act_custom_99",
  "action": "portfolio:send_inquiry",
  "title": "Send Portfolio Inquiry",
  "explanation": "Submitting project inquiry",
  "parameters": { "inquiry": "Interested in AI consulting" }
}
\`\`\``;

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'default',
        message: 'ECHO_RESPONSE:' + customPayload
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.action);
    assert.equal(res.body.action.action, 'portfolio:send_inquiry');
    assert.equal(res.body.action.parameters.inquiry, 'Interested in AI consulting');
  });

  test('buildSystemInstruction adapts dynamically when actions are cleared or customized', () => {
    const isolatedRegistry = new ActionRegistry();
    const emptyGuidelinePrompt = buildSystemInstruction('Base persona', 'Some context', isolatedRegistry);
    assert.ok(!emptyGuidelinePrompt.includes('[STRUCTURED ACTION PROPOSALS]'));
    assert.ok(emptyGuidelinePrompt.includes('Some context'));

    isolatedRegistry.register({
      name: 'ecommerce:place_order',
      title: 'Place Order',
      description: 'Places order for cart items',
      parameters: { cart_id: '<UUID>' }
    });

    const customGuidelinePrompt = buildSystemInstruction('Base persona', 'Some context', isolatedRegistry);
    assert.ok(customGuidelinePrompt.includes('[STRUCTURED ACTION PROPOSALS]'));
    assert.ok(customGuidelinePrompt.includes('ecommerce:place_order'));
    assert.ok(!customGuidelinePrompt.includes('candidate:apply_job'));
  });
});
