# Level 3 Host Integration Guide

Level 3 integration connects the assistant to live host-application context and application actions through a versioned adapter. The browser adapter is a bridge, not a trusted security boundary. Keep identity and business authorization in the host backend.

## 1. Load and initialize the SDK

Build the distribution with `npm run build`, serve `public/sdk/assistant.js` (or the configured SDK distribution path), then initialize after the script loads:

```html
<script src="https://assistant.example/sdk/assistant.js" data-autoload="false" defer></script>
<script>
  window.addEventListener('DOMContentLoaded', async () => {
    await window.AssistantSDK.init({
      assistantId: 'orders',
      apiUrl: 'https://assistant.example',
      integration: {
        version: 1,
        application: { id: 'storefront', name: 'Storefront' },
        contextProvider: () => ({
          page: { route: location.pathname, title: document.title },
          selectedEntity: window.storefrontSelection || null
        }),
        getAuthHeaders: async () => ({
          Authorization: `Bearer ${await getShortLivedAssistantToken()}`
        }),
        canExecuteAction: async (actionId, parameters) =>
          canCurrentUserPerform(actionId, parameters),
        executeAction: async ({ actionId, parameters }) =>
          callHostApplicationApi(actionId, parameters)
      }
    });
  });
</script>
```

The adapter contract requires `version: 1` and an application `id` and `name`. Optional callbacks:

- `contextProvider()` returns an object or `null`; it is serialized and limited to 30,000 characters.
- `getAuthHeaders()` returns header-name/string-value pairs. Header names and values are validated. Never return a long-lived secret. When `getAuthHeaders()` is provided, host credentials take full precedence over default demo tokens. In standalone or public demo mode (where `getAuthHeaders` is not supplied), the SDK API client automatically acquires a short-lived, scoped guest token from `/api/auth/token` so public demo presets operate seamlessly in production without manual token configuration.
- `canExecuteAction(actionId, parameters)` gates the client confirmation UX.
- `executeAction({ application, actionId, parameters })` calls a host-owned operation after confirmation.
- `credentials` may be `omit`, `same-origin` (default), or `include`.

Context and auth callbacks are refreshed when the widget sends requests. Calling `AssistantSDK.setContext(...)` sets an explicit context override. The host should avoid placing unnecessary personal, sensitive, or confidential data in context.

## 2. Register server-side action definitions

Register actions during backend initialization in the same process that serves chat requests. The default action registry is generic and empty:

```js
import { z } from 'zod';
import { getAssistantActionRegistry } from './connectors/bridge.js';

const orders = getAssistantActionRegistry('orders');
orders.register({
  name: 'orders:lookup',
  title: 'Look up an order',
  description: 'Read order status for an order the current user can access.',
  permissions: ['orders.read'],
  risk: 'read',
  requiresConfirmation: false,
  parameterSchema: z.object({
    orderId: z.string().trim().min(1).max(100)
  })
});
```

Use the authenticated JWT's trusted `scopes` to filter definitions and tools. Do not use page context, body fields, or browser-provided roles/scopes as authorization. Choose the narrowest permissions and enforce access again in the host/domain API.

The generic action registry starts empty. Legacy HirePool applications can explicitly register their legacy definitions with `registerLegacyHirePoolActions(registry)` from `integrations/hirepool/legacy-actions.js`. Do not register these definitions for unrelated products.

## 3. Action proposal and execution flow

1. The backend exposes only registered actions allowed by trusted server-side scopes.
2. The model may return a structured action proposal. The backend validates its registered name and parameter schema.
3. The widget renders an escaped summary and confirmation controls; destructive-risk actions require an additional acknowledgement.
4. After the user confirms, the SDK calls the host executor. The executor should call the host application's authenticated API.
5. The host API independently checks the current user, tenant, record-level authorization, input schema, and business rules before committing a change.
6. The SDK emits `action:success`, `action:error`, and `action:cancel` lifecycle events.

Action definitions with `permissions` require matching trusted scopes. `risk` supports `read`, `write`, and `destructive`. A `requiresConfirmation: false` definition can affect whether an eligible connector action is executed by the backend, but host actions still rely on the client confirmation/executor flow. Never treat model output or client confirmation alone as authorization.

## 4. Mock integration

Run the app in development and visit `/demo/integration.html`. The example in `demo/integration.js` integrates a mock notes application, provides route/user/selected-note context, and demonstrates permission checks and a confirmed note update. The mock does not call a real API or persist data. The demo action registry is enabled outside production by default; production can explicitly enable it using `ENABLE_INTEGRATION_DEMO=true` for a controlled demonstration only.

## 5. Production checklist

- Serve the SDK and APIs over HTTPS, and configure exact allowed origins.
- Configure server authentication and issue short-lived user credentials; protect signing keys.
- Ensure CORS permits only the auth headers and origins actually required by the host.
- Register actions at backend startup; validate parameters and enforce authorization server-side.
- Avoid returning secrets or unnecessary personal data in context.
- Add idempotency and audit records for writes; design cancellation/retry behavior carefully.
- Replace in-memory session state with a durable store before using multiple instances or serverless deployments.
- Test browser CSP, cookies/credentials, upload behavior, SSE, session ownership, and host API authorization in the actual deployment.

See [Integration Security Model](./SDK_INTEGRATION_SECURITY_MODEL.md) and [Architecture Audit](./SDK_COMPLETE_ARCHITECTURE_AND_INTEGRATION_AUDIT.md).
