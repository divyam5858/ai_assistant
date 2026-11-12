# Dynamic API discovery

Dynamic API discovery is an opt-in server capability, not a browser feature. An integration must be registered by trusted server code with `enabled: true`, and discovery remains disabled unless `DYNAMIC_API_DISCOVERY_ENABLED=true`. It is also disabled when either `NODE_ENV=production` or `VERCEL_ENV=production`. Production deployments must leave the feature disabled; the runtime gate is an additional safeguard, not a replacement for safe deployment configuration. The parser supports explicitly allowlisted GET, POST, and PUT operations. Writes accept JSON request bodies only and require a server-side confirmation flow before execution.

## Configuration

Set these server-side environment variables:

```ini
DYNAMIC_API_DISCOVERY_ENABLED=false
API_DISCOVERY_ALLOWED_HOSTS=
API_DISCOVERY_TIMEOUT_MS=5000
API_DISCOVERY_MAX_SPEC_BYTES=1048576
CORS_ALLOWED_ORIGINS=https://app.example.test
```

| Variable | Default when unset | Accepted values and behavior |
|---|---:|---|
| `DYNAMIC_API_DISCOVERY_ENABLED` | `false` | Only the exact value `true` enables discovery. Missing, empty, or any other value leaves discovery disabled. |
| `API_DISCOVERY_ALLOWED_HOSTS` | empty | Comma-separated exact hostnames. An empty value allows no outbound host. Wildcards, HTTP URLs, custom ports, IP literals, and credentials in URLs are rejected. Every DNS address returned for an allowed hostname must be in an accepted public range. |
| `API_DISCOVERY_TIMEOUT_MS` | `5000` | Integer from `100` to `15000` milliseconds. The limit covers DNS resolution, connection, request, and response reading for each outbound request. |
| `API_DISCOVERY_MAX_SPEC_BYTES` | `1048576` | Integer from `1024` to `5242880` bytes. This caps the downloaded OpenAPI document. API responses have a separate 64 KiB cap. |
| `CORS_ALLOWED_ORIGINS` | empty | Exact browser origins, comma-separated. In production, origins outside this list receive no CORS permission. Set the actual website/dashboard origins; never use `*` for an authenticated integration. |

If a limit variable is absent, its default is used. If a limit is supplied but is empty, non-integer, or outside its allowed range, the request fails before its outbound fetch. A missing host allowlist fails closed because it produces an empty set. These checks occur when an authorized registered integration attempts discovery/execution; setting the feature flag alone does not register or contact any API.

## Registering an integration

Register integration configuration in trusted backend startup code. Do not construct it from browser context, query parameters, model output, or tenant IDs supplied by the browser.

```js
import { registerDynamicApiIntegration } from './backend/src/dynamic-api/catalog.js';

registerDynamicApiIntegration({
  id: 'my-service',
  assistantId: 'my-assistant',
  applicationId: 'my-application',
  openApiSpecUrl: 'https://api.example.test/openapi.json',
  apiBaseUrl: 'https://api.example.test/v1/',
  allowedHosts: ['api.example.test'],
  enabled: true,
  authenticationRequired: true,
  allowedOperationIds: ['listRecords'],
  roleOperationIds: {
    analyst: ['listRecords']
  },
  responseFields: {
    listRecords: ['items.id', 'items.status']
  },
  authorize: async user => user.scopes?.includes('records:read') === true,
  getAuthHeaders: async user => ({
    Authorization: `Bearer ${await getServerSideAccessToken(user)}`
  })
});
```

Replace the example callback with the host application's server-side authorization and credential delegation. `authorize` is required and runs before discovery and again immediately before execution. Authentication headers are never accepted from the chat request. The API token callback must return only the trusted API's `Authorization` and/or `X-*` headers. If the OpenAPI document itself requires authentication, configure a separate `getSpecAuthHeaders` callback; API credentials are not automatically sent to the spec host.

Every operation ID must be explicitly allowlisted and have a non-empty `responseFields` projection. `allowedHosts` is an exact per-integration HTTPS hostname list and must be a subset of server-wide `API_DISCOVERY_ALLOWED_HOSTS`; wildcards and IP literals are rejected. `roleOperationIds` maps verified server-side roles to subsets of the operation allowlist; unlisted roles receive no tools. The application ID is matched against the authenticated server principal, and super-admin roles are rejected from role allowlists. Keep `authenticationRequired` true for protected APIs even when OpenAPI omits `security`.

The chat request schema does not accept integration configuration. Replace the example callbacks with host-specific server-side authorization and credential delegation. `authorize` runs before discovery and again immediately before execution. Authentication headers are never accepted from chat-request fields. API credentials are not automatically sent to the spec host. Never return a refresh token or place caller credentials in tool arguments, model prompts, URLs, or logs.

The parser supports OpenAPI 3.0/3.1 nullable schemas, local `$ref`s, enums, nested objects, scalar arrays, supported path/query serialization (`simple`, `form`, and query `deepObject`), and JSON request bodies for POST/PUT. Each operation is validated independently; unsupported operations produce a diagnostic containing path, method, operation ID, and reason while valid operations remain usable. Invalid roots, unsafe paths, broken path-item references, and duplicate operation IDs fail closed. GETs with request bodies, DELETE/PATCH operations, multipart uploads, external `$ref`s, and unsupported parameter serialization are not executable. OpenAPI `servers` values are ignored; execution uses only the configured `apiBaseUrl`.

Non-GET actions are never executed inline as model tools. The chat route validates the model-proposed arguments, performs any registered host-specific preflight, stores the normalized operation and arguments server-side, and returns a separate confirmation action to the widget. The two-minute, one-use confirmation is bound to the authenticated principal and integration session; the confirmation endpoint accepts only that opaque confirmation token. The executor rechecks authorization and supplies API credentials server-side. Repeated confirmations of the same operation and arguments are deduplicated during the in-memory outcome window; ambiguous upstream failures require checking the upstream record before retrying.

The complete read-only HirePool snapshot is [hirepool-openapi-inventory.json](./hirepool-openapi-inventory.json). Regenerate it only from the local `http://127.0.0.1:8000/api/openapi.json` endpoint or its checked-in fixture with `node scripts/generate-hirepool-openapi-inventory.js`. The reusable HirePool registration example is [dynamic-integration.example.json](../integrations/hirepool/dynamic-integration.example.json); it is deliberately disabled and its placeholder hosts and response projections require owner review.

With discovery enabled, the chat route creates a fresh `ActionRegistry` for each request, copies the static action definitions, and preserves the existing registry tag; it does not mutate or share the static assistant registry. With discovery disabled, the original assistant registry is used directly to retain existing behavior. Existing authentication, permission checks, rate limits, and session ownership remain in place. If no server-side integration is registered, no dynamic tools are exposed.

## Network and data protections

- Both spec and API URLs must use HTTPS and an exact host in the server allowlist.
- DNS results are checked against the implementation's explicit non-public IPv4 and global-unicast IPv6 range policy and pinned to a selected public address for the HTTPS request; redirects are rejected. This is a conservative range policy, not a promise that every future IANA special-purpose allocation is automatically recognized.
- Discovery and API responses have size limits, content-type checks, and timeouts.
- GET operations are read-only; POST/PUT operations are individually allowlisted and require explicit confirmation.
- Responses are projected to configured fields and limited before being returned to chat.
- The model and browser cannot register integrations, choose target hosts, supply credentials, or change authorization decisions.

The feature is intended for development and controlled evaluation. It does not configure any production integration and must not be enabled in production. The HirePool local-development integration is a separate, explicitly gated exception: its SDK bridge verifies the HirePool identity against `/auth/me`, retains the host token only in server memory, and forwards it only to the fixed local HirePool API. A browser `getAuthHeaders` callback by itself is not a working authenticated bridge.
