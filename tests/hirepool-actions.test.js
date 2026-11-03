import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';
import { clearAssistantRegistries, getAssistantActionRegistry } from '../connectors/bridge.js';
import {
  HIREPOOL_ACTION_DEFINITIONS,
  HIREPOOL_ASSISTANT_ID,
  registerHirePoolActions
} from '../integrations/hirepool/actions.js';

describe('HirePool SDK action integration', () => {
  let app;

  before(() => {
    setAIProvider(new MockAIProvider({ delayMs: 0 }));
    app = createApp();
  });

  afterEach(() => {
    clearAssistantRegistries();
  });

  test('registers only the initial read-only HirePool actions', () => {
    const registry = registerHirePoolActions();

    assert.equal(HIREPOOL_ASSISTANT_ID, 'hirepool');
    assert.deepEqual(
      registry.getAllowedActionNames().sort(),
      ['applications:list', 'jobs:search', 'jobs:view', 'profile:view']
    );
    assert.ok(HIREPOOL_ACTION_DEFINITIONS.every(action =>
      action.risk === 'read' && action.requiresConfirmation === false
    ));
    assert.equal(registry.tag, 'action:hirepool');
  });

  test('loads HirePool actions through the explicit backend feature flag', () => {
    const previousValue = process.env.ENABLE_HIREPOOL_INTEGRATION;
    process.env.ENABLE_HIREPOOL_INTEGRATION = 'true';
    try {
      createApp();
      assert.equal(getAssistantActionRegistry(HIREPOOL_ASSISTANT_ID).has('jobs:search'), true);
    } finally {
      if (previousValue === undefined) {
        delete process.env.ENABLE_HIREPOOL_INTEGRATION;
      } else {
        process.env.ENABLE_HIREPOOL_INTEGRATION = previousValue;
      }
    }
  });

  test('action registration is idempotent and input schemas reject invalid values', () => {
    const registry = registerHirePoolActions();
    assert.equal(registerHirePoolActions(), registry);
    assert.equal(registry.validateProposal({
      id: 'invalid-job',
      action: 'jobs:view',
      title: 'View job',
      parameters: { job_id: 'not-a-uuid' }
    }).success, false);
    assert.equal(registry.validateProposal({
      id: 'valid-search',
      action: 'jobs:search',
      title: 'Search jobs',
      parameters: { query: 'engineer' }
    }).success, true);
  });

  test('HirePool chat exposes its registered action to the host confirmation flow', async () => {
    registerHirePoolActions();
    const proposal = `\`\`\`action:hirepool
{
  "id": "hirepool-search-1",
  "action": "jobs:search",
  "title": "Search engineering jobs",
  "parameters": { "query": "engineer" }
}
\`\`\``;
    const response = await request(app)
      .post('/api/chat')
      .send({ assistantId: HIREPOOL_ASSISTANT_ID, message: `ECHO_RESPONSE:${proposal}` });

    assert.equal(response.status, 200);
    assert.equal(response.body.action.action, 'jobs:search');
    assert.equal(response.body.action.risk, 'read');
  });

  test('HirePool registrations remain isolated from the generic default registry', () => {
    registerHirePoolActions();
    assert.equal(getAssistantActionRegistry('default').has('jobs:search'), false);
  });
});
