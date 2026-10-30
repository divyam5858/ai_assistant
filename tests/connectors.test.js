import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../connectors/registry.js';
import { MockConnector } from '../connectors/mock-connector.js';

describe('Connector Architecture', () => {
  test('registry contains mock-knowledge connector', () => {
    const connector = registry.get('mock-knowledge');
    assert.ok(connector);
    assert.equal(connector.id, 'mock-knowledge');
    assert.deepEqual(connector.actions, ['searchKnowledge', 'getCustomerProfile']);
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

