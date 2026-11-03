import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { z } from 'zod';
import { registry } from '../connectors/registry.js';
import { BaseConnector } from '../connectors/base.js';
import { MockConnector } from '../connectors/mock-connector.js';
import { ActionRegistry, actionRegistry } from '../backend/src/actions/registry.js';
import {
  bridgeConnectorToRegistry,
  syncConnectorsToRegistry,
  removeConnectorFromRegistry,
  dispatchActionProposal,
  getAssistantActionRegistry,
  setAssistantActionRegistry,
  clearAssistantRegistries
} from '../connectors/bridge.js';
import { buildSystemInstruction } from '../backend/src/routes/chat.js';
import { createApp } from '../backend/src/app.js';
import { setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';
import { registerLegacyHirePoolActions } from '../integrations/hirepool/legacy-actions.js';

describe('Connector Architecture', () => {
  test('registry contains mock-knowledge connector', () => {
    const connector = registry.get('mock-knowledge');
    assert.ok(connector);
    assert.equal(connector.id, 'mock-knowledge');
    assert.deepEqual(connector.actions, ['searchKnowledge', 'getCustomerProfile']);
  });

  test('production connector registry does not register the mock connector', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { registry: productionRegistry } = await import('../connectors/registry.js?production-test');
      assert.equal(productionRegistry.has('mock-knowledge'), false);
      assert.deepEqual(productionRegistry.list(), []);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  test('public action searchKnowledge works without auth token', async () => {
    const connector = registry.get('mock-knowledge');
    const auth = await connector.validateAuthorization(null, { action: 'searchKnowledge' });
    assert.equal(auth.authorized, true);

    const res = await connector.execute('searchKnowledge', { query: 'widget' });
    assert.ok(res.results.length > 0);
    assert.ok(res.results.some(r => r.title.includes('Widget')));
  });

  test('protected action getCustomerProfile rejects unauthorized request', async () => {
    const connector = registry.get('mock-knowledge');
    await assert.rejects(
      async () => {
        await connector.validateAuthorization(null, { action: 'getCustomerProfile' });
      },
      /Unauthorized/
    );

    await assert.rejects(
      async () => {
        await connector.validateAuthorization('wrong-token', { action: 'getCustomerProfile' });
      },
      /Unauthorized/
    );
  });

  test('protected action getCustomerProfile succeeds with valid auth token', async () => {
    const connector = registry.get('mock-knowledge');
    const auth = await connector.validateAuthorization('secret-demo-token-123', { action: 'getCustomerProfile' });
    assert.equal(auth.authorized, true);
    assert.equal(auth.user, 'admin_user');

    const result = await connector.execute('getCustomerProfile', { customerId: 'cust-001' }, auth);
    assert.equal(result.customer.name, 'Jane Doe');
    assert.equal(result.customer.plan, 'Enterprise');
  });
});

describe('Structured Connector Action Definitions', () => {
  test('MockConnector exposes valid structured action definitions compatible with ActionDefinitionSchema', () => {
    const connector = new MockConnector();
    const definitions = connector.getActionDefinitions();

    assert.ok(Array.isArray(definitions));
    assert.equal(definitions.length, 2);

    const searchDef = definitions.find(d => d.name === 'mock-knowledge:searchKnowledge');
    assert.ok(searchDef);
    assert.equal(searchDef.title, 'Search Knowledge Base');
    assert.equal(searchDef.promptable, true);
    assert.equal(searchDef.requiresConfirmation, false);
    assert.equal(searchDef.metadata.connectorId, 'mock-knowledge');
    assert.equal(searchDef.metadata.connectorAction, 'searchKnowledge');

    const profileDef = definitions.find(d => d.name === 'mock-knowledge:getCustomerProfile');
    assert.ok(profileDef);
    assert.equal(profileDef.title, 'Get Customer Profile');
    assert.equal(profileDef.promptable, true);
    assert.equal(profileDef.requiresConfirmation, false);
    assert.equal(profileDef.risk, 'read');
    assert.equal(profileDef.metadata.connectorId, 'mock-knowledge');
    assert.equal(profileDef.metadata.connectorAction, 'getCustomerProfile');
  });

  test('BaseConnector returns empty array by default to prevent exposing unvetted actions', () => {
    class LegacyConnector extends BaseConnector {
      constructor() {
        super('legacy-conn', 'Legacy System', 'Undocumented methods', ['undocumentedMethod']);
      }
    }
    const legacy = new LegacyConnector();
    assert.deepEqual(legacy.getActionDefinitions(), []);
  });

  test('Non-promptable actions are excluded from prompt discovery', () => {
    class ToolWithInternalAction extends BaseConnector {
      constructor() {
        super('tool-conn', 'Tool', 'Internal tool', ['internalSync']);
      }
      getActionDefinitions() {
        return [{
          name: 'tool-conn:internalSync',
          title: 'Internal Sync',
          description: 'Background synchronization',
          promptable: false,
          metadata: { connectorId: this.id, connectorAction: 'internalSync' }
        }];
      }
    }
    const tool = new ToolWithInternalAction();
    const targetRegistry = new ActionRegistry();
    bridgeConnectorToRegistry(tool, targetRegistry);

    assert.equal(targetRegistry.has('tool-conn:internalSync'), true);
    const guidelines = targetRegistry.formatPromptGuidelines();
    assert.ok(!guidelines.includes('tool-conn:internalSync'));
  });
});

describe('ConnectorRegistry to ActionRegistry Bridge', () => {
  let testRegistry;

  beforeEach(() => {
    testRegistry = new ActionRegistry();
  });

  test('bridgeConnectorToRegistry discovers and registers connector actions in ActionRegistry', () => {
    const connector = new MockConnector();
    const registered = bridgeConnectorToRegistry(connector, testRegistry);

    assert.equal(registered.length, 2);
    assert.ok(testRegistry.has('mock-knowledge:searchKnowledge'));
    assert.ok(testRegistry.has('mock-knowledge:getCustomerProfile'));
    assert.equal(testRegistry.list().length, 2);
  });

  test('Duplicate bridge registration is idempotent and does not create duplicate actions', () => {
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, testRegistry);
    bridgeConnectorToRegistry(connector, testRegistry);

    assert.equal(testRegistry.list().length, 2);
    assert.ok(testRegistry.has('mock-knowledge:searchKnowledge'));
  });

  test('Action-name collisions with existing actions throw clear error and fail closed', () => {
    // Register an action with the same name first
    testRegistry.register({
      name: 'mock-knowledge:searchKnowledge',
      description: 'Pre-existing conflicting action'
    });

    const connector = new MockConnector();
    assert.throws(
      () => bridgeConnectorToRegistry(connector, testRegistry),
      /Action collision detected: Action 'mock-knowledge:searchKnowledge' is already registered/
    );
  });

  test('removeConnectorFromRegistry cleanly unregisters connector actions without leaving stale definitions', () => {
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, testRegistry);
    assert.equal(testRegistry.list().length, 2);

    const removedCount = removeConnectorFromRegistry('mock-knowledge', testRegistry);
    assert.equal(removedCount, 2);
    assert.equal(testRegistry.list().length, 0);
    assert.equal(testRegistry.has('mock-knowledge:searchKnowledge'), false);
  });

  test('syncConnectorsToRegistry bridges all registered connectors', () => {
    const registered = syncConnectorsToRegistry(registry, testRegistry);
    assert.ok(registered.length >= 2);
    assert.ok(testRegistry.has('mock-knowledge:searchKnowledge'));
  });
});

describe('Assistant Registry Isolation', () => {
  beforeEach(() => {
    clearAssistantRegistries();
    actionRegistry.clear();
  });

  afterEach(() => {
    clearAssistantRegistries();
    actionRegistry.clear();
  });

  test('getAssistantActionRegistry returns the generic empty registry for default assistant', () => {
    const defaultReg = getAssistantActionRegistry('default');
    assert.equal(defaultReg, actionRegistry);
    assert.equal(defaultReg.list().length, 0);
  });

  test('getAssistantActionRegistry isolates custom assistant registries', () => {
    const researcherReg = getAssistantActionRegistry('researcher');
    const defaultReg = getAssistantActionRegistry('default');
    assert.notEqual(researcherReg, defaultReg);
    assert.notEqual(researcherReg, defaultReg);
    assert.equal(researcherReg.list().length, 0);
  });

  test('Connector actions registered for one assistant do not leak to another assistant', () => {
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    assert.ok(supportReg.has('mock-knowledge:searchKnowledge'));

    // Check default assistant registry
    const defaultReg = getAssistantActionRegistry('default');
    assert.equal(defaultReg.has('mock-knowledge:searchKnowledge'), false);

    // Check researcher assistant registry
    const researcherReg = getAssistantActionRegistry('researcher');
    assert.equal(researcherReg.has('mock-knowledge:searchKnowledge'), false);
  });
});

describe('Safe Connector Execution Dispatch & Authorization', () => {
  let bridgeRegistry;

  beforeEach(() => {
    bridgeRegistry = new ActionRegistry();
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, bridgeRegistry);
  });

  test('dispatchActionProposal executes valid public connector action without auth token', async () => {
    const proposal = {
      id: 'prop_01',
      action: 'mock-knowledge:searchKnowledge',
      title: 'Search Knowledge',
      parameters: { query: 'widget' }
    };

    const res = await dispatchActionProposal(proposal, {
      actionRegistry: bridgeRegistry,
      connectorRegistry: registry
    });

    assert.equal(res.isConnectorAction, true);
    assert.ok(res.connectorResult);
    assert.equal(res.connectorResult.success, true);
    assert.equal(res.connectorResult.action, 'searchKnowledge');
    assert.ok(res.connectorResult.data.results.length > 0);
  });

  test('dispatchActionProposal rejects protected connector action when auth token is missing (fails closed)', async () => {
    const proposal = {
      id: 'prop_02',
      action: 'mock-knowledge:getCustomerProfile',
      title: 'Get Profile',
      parameters: { customerId: 'cust-001' }
    };

    const res = await dispatchActionProposal(proposal, {
      actionRegistry: bridgeRegistry,
      connectorRegistry: registry,
      connectorAuth: {} // No token provided
    });

    assert.equal(res.isConnectorAction, true);
    assert.ok(res.connectorResult);
    assert.equal(res.connectorResult.success, false);
    assert.equal(res.connectorResult.error.code, 'UNAUTHORIZED');
  });

  test('dispatchActionProposal rejects protected connector action when auth token is invalid (fails closed)', async () => {
    const proposal = {
      id: 'prop_03',
      action: 'mock-knowledge:getCustomerProfile',
      title: 'Get Profile',
      parameters: { customerId: 'cust-001' }
    };

    const res = await dispatchActionProposal(proposal, {
      actionRegistry: bridgeRegistry,
      connectorRegistry: registry,
      connectorAuth: { 'mock-knowledge': 'invalid-token' }
    });

    assert.equal(res.isConnectorAction, true);
    assert.ok(res.connectorResult);
    assert.equal(res.connectorResult.success, false);
    assert.equal(res.connectorResult.error.code, 'UNAUTHORIZED');
  });

  test('dispatchActionProposal succeeds for protected action when valid server token is provided', async () => {
    const proposal = {
      id: 'prop_04',
      action: 'mock-knowledge:getCustomerProfile',
      title: 'Get Profile',
      parameters: { customerId: 'cust-001' }
    };

    const res = await dispatchActionProposal(proposal, {
      actionRegistry: bridgeRegistry,
      connectorRegistry: registry,
      connectorAuth: { 'mock-knowledge': 'secret-demo-token-123' }
    });

    assert.equal(res.isConnectorAction, true);
    assert.ok(res.connectorResult);
    assert.equal(res.connectorResult.success, true);
    assert.equal(res.connectorResult.data.customer.name, 'Jane Doe');
    assert.equal(res.connectorResult.data.customer.plan, 'Enterprise');
  });

  test('dispatchActionProposal rejects invalid parameters against schema with INVALID_PARAMETERS', async () => {
    const proposal = {
      id: 'prop_05',
      action: 'mock-knowledge:getCustomerProfile',
      title: 'Get Profile',
      parameters: { customerId: '' } // fails min(1)
    };

    const res = await dispatchActionProposal(proposal, {
      actionRegistry: bridgeRegistry,
      connectorRegistry: registry,
      connectorAuth: { 'mock-knowledge': 'secret-demo-token-123' }
    });

    assert.equal(res.isConnectorAction, true);
    assert.ok(res.connectorResult);
    assert.equal(res.connectorResult.success, false);
    assert.equal(res.connectorResult.error.code, 'INVALID_PARAMETERS');
  });

  test('dispatchActionProposal passes HirePool host actions untouched without backend execution', async () => {
    const hostRegistry = new ActionRegistry();
    registerLegacyHirePoolActions(hostRegistry);
    const hirepoolProposal = {
      id: 'act_hp_1',
      action: 'candidate:apply_job',
      title: 'Apply for Job',
      parameters: { job_id: '00000000-0000-0000-0000-000000000001' }
    };

    const res = await dispatchActionProposal(hirepoolProposal, {
      actionRegistry: hostRegistry,
      connectorRegistry: registry
    });

    assert.equal(res.isConnectorAction, false);
    assert.equal(res.connectorResult, null);
    assert.deepEqual(res.hostAction, hirepoolProposal);
  });
});

describe('End-to-End Chat Pipeline with Connector Integration', () => {
  let app;

  before(() => {
    setAIProvider(new MockAIProvider());
    app = createApp();
  });

  beforeEach(() => {
    clearAssistantRegistries();
    actionRegistry.clear();
  });

  afterEach(() => {
    clearAssistantRegistries();
    actionRegistry.clear();
  });

  test('POST /api/chat executes backend connector action and returns connectorResult', async () => {
    // Setup support assistant with mock-knowledge connector
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    const actionText = `I found helpful articles in the knowledge base:
\`\`\`action
{
  "id": "act_kb_1",
  "action": "mock-knowledge:searchKnowledge",
  "title": "Search Knowledge Base",
  "explanation": "Searching for widget embed guides",
  "parameters": { "query": "widget" }
}
\`\`\`
Here are the guides.`;

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'support',
        message: 'ECHO_RESPONSE:' + actionText,
        context: 'User browsing help documentation'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.connectorResult);
    assert.equal(res.body.connectorResult.success, true);
    assert.equal(res.body.connectorResult.action, 'searchKnowledge');
    assert.ok(res.body.connectorResult.data.results.length > 0);
    // Since it was executed on backend, host action is not forwarded to widget
    assert.equal(res.body.action, undefined);
  });

  test('POST /api/chat preserves HirePool host action as client proposal without backend execution', async () => {
    registerLegacyHirePoolActions(actionRegistry);
    const hirepoolText = `I will submit your job application:
\`\`\`action:hirepool
{
  "id": "act_hp_app",
  "action": "candidate:apply_job",
  "title": "Apply for Job",
  "explanation": "Submitting job application",
  "parameters": {
    "job_id": "00000000-0000-0000-0000-000000000001",
    "job_title": "Senior Architect"
  }
}
\`\`\`
Please confirm.`;

    const res = await request(app)
      .post('/api/chat')
      .send({
        assistantId: 'default',
        message: 'ECHO_RESPONSE:' + hirepoolText,
        context: 'Role: Candidate, Job ID: 00000000-0000-0000-0000-000000000001'
      });

    assert.equal(res.status, 200);
    assert.ok(res.body.action);
    assert.equal(res.body.action.action, 'candidate:apply_job');
    // Not executed on backend
    assert.equal(res.body.connectorResult, undefined);
  });

  test('POST /api/chat/stream streams connectorResult event for backend connector action', async () => {
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    const actionText = `Searching documentation:
\`\`\`action
{
  "id": "act_stream_1",
  "action": "mock-knowledge:searchKnowledge",
  "title": "Search Knowledge Base",
  "parameters": { "query": "streaming" }
}
\`\`\``;

    const res = await request(app)
      .post('/api/chat/stream')
      .send({
        assistantId: 'support',
        message: 'ECHO_RESPONSE:' + actionText,
        context: 'Streaming query'
      });

    assert.equal(res.status, 200);
    assert.ok(res.text.includes('"type":"connectorResult"'));
    assert.ok(res.text.includes('"action":"searchKnowledge"'));
    assert.ok(res.text.includes('"type":"done"'));
  });

  test('System instruction discovery includes promptable connector actions without secrets', () => {
    const supportReg = getAssistantActionRegistry('support');
    const connector = new MockConnector();
    bridgeConnectorToRegistry(connector, supportReg);

    const instruction = buildSystemInstruction('Support Persona', 'Host Context', supportReg);
    assert.ok(instruction.includes('mock-knowledge:searchKnowledge'));
    assert.ok(instruction.includes('mock-knowledge:getCustomerProfile'));
    assert.ok(!instruction.includes('secret-demo-token-123'));
    assert.ok(!instruction.includes('authToken'));
  });
});
