import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HostIntegrationAdapter, serializeContext } from '../widget/src/integration.js';

describe('Versioned host integration adapter', () => {
  test('refreshes structured context and host authentication headers on demand', async () => {
    let route = '/notes';
    const adapter = new HostIntegrationAdapter({
      version: 1,
      application: { id: 'notes-app', name: 'Notes App' },
      contextProvider: () => ({
        page: { route, title: 'Notes' },
        selectedEntity: { type: 'note', id: 'note-1' }
      }),
      getAuthHeaders: async () => ({ Authorization: 'Bearer host-session-token' })
    });

    const first = JSON.parse(await adapter.getContext());
    assert.equal(first.application.id, 'notes-app');
    assert.equal(first.page.route, '/notes');
    assert.equal((await adapter.getAuthHeaders()).Authorization, 'Bearer host-session-token');

    route = '/notes/note-1';
    assert.equal(JSON.parse(await adapter.getContext()).page.route, '/notes/note-1');
  });

  test('checks host-side permissions before executing a confirmed action', async () => {
    const calls = [];
    const adapter = new HostIntegrationAdapter({
      version: 1,
      application: { id: 'notes-app', name: 'Notes App' },
      canExecuteAction: async (actionId) => actionId === 'notes:update',
      executeAction: async (request) => {
        calls.push(request);
        return { message: 'Updated' };
      }
    });

    test('exposes untrusted host identity, permissions, actions, callbacks, and context subscription', async () => {
      let contextListener;
      const observed = [];
      const adapter = new HostIntegrationAdapter({
        version: 1,
        application: { id: 'support-desk', name: 'Support Desk' },
        contextProvider: () => ({ page: { route: '/tickets' } }),
        getIdentity: () => ({ subject: 'agent-12', role: 'support_agent' }),
        getPermissions: () => ['tickets.read'],
        getAvailableActions: () => [{ id: 'tickets:search' }],
        onActionProposed: action => observed.push(['proposal', action.id]),
        onActionResult: result => observed.push(['result', result.status]),
        subscribeContext: callback => {
          contextListener = callback;
          return () => { contextListener = null; };
        }
      });

      assert.deepEqual(await adapter.getIdentity(), { subject: 'agent-12', role: 'support_agent' });
      assert.deepEqual(await adapter.getPermissions(), ['tickets.read']);
      assert.deepEqual(await adapter.getAvailableActions(), [{ id: 'tickets:search' }]);
      assert.equal(JSON.parse(await adapter.getContext()).application.id, 'support-desk');

      const changed = [];
      const unsubscribe = adapter.subscribeToContextChanges(() => changed.push(true));
      contextListener();
      assert.deepEqual(changed, [true]);
      adapter.notifyActionProposed({ id: 'proposal-1' });
      adapter.notifyActionResult({ status: 'success' });
      assert.deepEqual(observed, [['proposal', 'proposal-1'], ['result', 'success']]);
      unsubscribe();
      assert.equal(contextListener, null);
    });

    const result = await adapter.executeHostAction('notes:update', { noteId: 'n1' });
    assert.equal(result.message, 'Updated');
    assert.equal(calls.length, 1);
    await assert.rejects(
      () => adapter.executeHostAction('notes:delete', {}),
      /denied permission/
    );
    assert.equal(calls.length, 1);
  });

  test('validates contract version, context type, size, and authentication headers', async () => {
    assert.throws(() => new HostIntegrationAdapter({
      version: 2,
      application: { id: 'notes-app', name: 'Notes App' }
    }), /version 1/);

    assert.throws(() => serializeContext(42), /string or a plain object/);
    assert.throws(() => serializeContext({ value: 'x'.repeat(30001) }), /cannot exceed/);

    const adapter = new HostIntegrationAdapter({
      version: 1,
      application: { id: 'notes-app', name: 'Notes App' },
      getAuthHeaders: () => ({ Authorization: 'Bearer invalid\r\nheader' })
    });
    await assert.rejects(() => adapter.getAuthHeaders(), /Invalid host authentication header/);
  });
});
