# SDK Dynamic API Discovery and Tool Generation Audit

**Repository:** `D:\ai-assistant-plugin`  
**Audit type:** Read-only architecture and capability review  
**Scope:** Current repository implementation, with HirePool used as a host-application example  
**Conclusion:** **Dynamic host API discovery and API-derived tool generation are not implemented.**

## 1. Executive summary

### Findings

- **VERIFIED FROM CODE — Host identity is opt-in.** The version-1 host adapter accepts an explicit application ID/name, context provider, authentication-header provider, identity/permission getters, action metadata getter, and host executor. It does not infer a host application from the page.
- **PARTIALLY VERIFIED — Page context is host-supplied.** The SDK can serialize explicit context or call `contextProvider()` on messages/refresh. It does not automatically collect the current URL, title, route, environment, selected record, or application state.
- **NOT IMPLEMENTED — API discovery.** No OpenAPI/Swagger ingestion, API manifest, specification parser, endpoint enumerator, or operation/schema discovery was found in runtime source.
- **PARTIALLY IMPLEMENTED — Tool definitions.** `ActionRegistry` accepts manually coded action definitions at runtime and converts them to an OpenAI-style tool schema. This is registration of explicit definitions, not generation from an API specification.
- **PARTIALLY IMPLEMENTED — Tool execution.** Registered connector actions can execute through a server-side connector and authorization check. Host actions can be proposed to a browser-side executor after user interaction. There is no generic API-call executor that maps an arbitrary API operation to an HTTP request.
- **NOT IMPLEMENTED — HirePool's requested end-to-end dynamic flow.** HirePool actions currently define static names, parameters, and schemas. They do not discover HirePool's API, invoke a HirePool endpoint, or return host-executor results to the model for synthesis.

The existing adapter, action registry, schema validation, provider tool conversion, connector contract, JWT middleware, and session ownership logic are useful foundations. They do not collectively implement dynamic discovery or safe arbitrary API execution.

### Overall feasibility

The intended HirePool scenario is feasible as a future integration, but requires new host context and API-description ingestion, a reviewed operation approval model, operation-to-tool conversion, runtime registry lifecycle, and a secure executor that preserves HirePool's own authorization. A manually registered host adapter or connector is closest to the present architecture and should precede broad automatic API discovery.

## 2. Scope and method

This report is based on the current source, runtime configuration, and available tests. It does not treat the accompanying authentication report or documentation as proof that a feature is enforced. Source searches for `OpenAPI`, `Swagger`, `operationId`, API manifests, dynamic tool generation, HTTP executors, and API discovery found no matching implementation in `backend/src`, `widget/src`, `integrations`, `connectors`, or `config`.

The current test directory contains `tests/auth-lifecycle.test.js` and `tests/chat-stream.test.js`. Both were run together with Node's test runner: **26 passed, 0 failed**. These tests are mocked/local and do not test API-spec discovery, dynamic API tool creation, HirePool API calls, or live provider execution.

## 3. Current SDK architecture

### 3.1 External application to widget

1. **Entry and initialization — `widget/src/sdk.js`, `AssistantSDK.init()`**
   - Accepts options including `assistantId`, `apiUrl`, UI settings, optional `context`, `documentUpload`, and optional `integration`.
   - If `integration` exists, constructs `HostIntegrationAdapter`.
   - Creates `AssistantApiClient`, obtains server assistant configuration, merges client overrides, constructs `AssistantWidgetUI`, registers adapter event hooks, and mounts in a Shadow DOM.
   - The global `window.AssistantSDK` exposes initialization and controls.
2. **Script-tag initialization — `widget/src/sdk.js`, `autoInitFromScriptTag()`**
   - Scans `script[src*="assistant.js"]`, uses the last matching element, and reads attributes including `data-assistant-id`, `data-api-url`, UI options, `data-context`, and `data-app-id`.
   - `data-app-id` creates an adapter with `application.id` and `application.name` both set to that value; no auth, context provider, available actions, or executor is configured by this shorthand.
   - The SDK does not use `document.currentScript`.
3. **Widget and page context — `widget/src/widget.js`, `sendMessage()`**
   - Sends the explicit `options.context` or calls `integration.getContext()` for each message unless a context override is active.
   - The context crosses the API boundary as the chat request's `context` string. The backend treats it as untrusted prompt context.
   - User chat, conversation ID, and client-side message history are sent by the widget.

### 3.2 Host integration adapter

`widget/src/integration.js`, `HostIntegrationAdapter`:

- Requires contract `version: 1` and `application.id`/`application.name`.
- Supports `contextProvider`, `getAuthHeaders`, `canExecuteAction`, `executeAction`, `getIdentity`, `getPermissions`, `getAvailableActions`, event callbacks, and context subscriptions.
- `getContext()` combines the host's context object with the declared application ID/name and serializes it.
- `getAuthHeaders()` validates header names and string values. It supplies credentials to the SDK's own backend API client.
- `getIdentity()`, `getPermissions()`, and `getAvailableActions()` are callable adapter methods. The SDK exposes getters for these values but does not automatically add them to chat requests or the backend registry.
- `executeHostAction()` calls the browser host's `canExecuteAction` callback, then calls `executeAction`. This is a host integration point, not server-side authorization.

### 3.3 API client and backend

- `widget/src/api-client.js`, `AssistantApiClient`, calls the SDK backend for configuration, chat, streaming, summarization, document upload/list/delete, and session clear.
- When a `getAuthHeaders` callback is configured, its headers are used. Otherwise, the client tries to acquire a backend demo token and cache it in memory.
- The client does not call HirePool APIs or interpret API specifications.
- `api/index.js` exports the Express application for the serverless runtime; `api/[...path].js` re-exports it. `backend/src/app.js` configures middleware and mounts the health, config, auth, chat, summarize, sessions, connectors, and documents routes.
- The chat routes validate `ChatRequestSchema`, load a registry by `assistantId`, build messages/context, obtain the configured AI provider, and return JSON or SSE.

### 3.4 Providers

- `backend/src/providers/factory.js` chooses Gemini, Groq, OpenAI, or mock providers based on configuration.
- `backend/src/providers/openai.js` accepts `tools`, sends native function tools, parses returned function calls, and decodes names.
- `backend/src/providers/gemini.js` chat methods do not accept/use tool schemas; streaming calls Gemini's `streamGenerateContent` without tool definitions.
- `backend/src/providers/groq.js` currently sends chat-completion payloads without tool definitions and parses streamed text, not tool-call deltas.
- Therefore, registry-to-native-tool execution is **not provider-neutral**; the OpenAI provider path is the demonstrated native tool-calling implementation.

### 3.5 Tool/action path

- `backend/src/actions/registry.js`, `ActionRegistry`, validates manually supplied definitions using `ActionDefinitionSchema`, stores them in a `Map`, supports register/unregister/list/get, and validates proposals against a definition's optional Zod schema.
- `connectors/bridge.js`, `getAssistantActionRegistry()`, separates registries by assistant ID in a process-local map. `bridgeConnectorToRegistry()` converts a connector's explicit definitions into registry entries.
- `backend/src/actions/tool-converter.js`, `registryToOpenAITools()`, converts eligible registered actions into provider function-tool schemas. It does not read API descriptions.
- `backend/src/routes/chat.js`, `processActionOrToolCalls()`, checks action registration, trusted JWT scopes against action permissions, and parameter schema; connector-backed actions are dispatched to a registered connector. Non-connector actions are returned as host actions.
- `connectors/bridge.js`, `dispatchActionProposal()`, validates connector existence, supported action, argument schema, and connector authorization before calling `connector.execute()`.
- `widget/src/widget.js` renders returned action proposals and only invokes the host adapter after a person presses the confirmation button. The response from the host callback updates the action card/events; it is not returned to the model as a tool result.

### 3.6 Auth, sessions, and documents

- `backend/src/middleware/auth.js`, `authenticate()`, supports JWT/API-key modes and populates a trusted request principal from a valid credential. `requireTenant()` and `requireRole()` helpers exist.
- `backend/src/session-manager.js`, `SessionManager`, stores sessions in process memory and checks user ownership and tenant mismatch on session operations.
- `backend/src/routes/documents.js` requires authentication middleware, consent headers and matching consent version, explicit body consent, upload limits, and session ownership-aware attachment.
- These controls are reusable foundations, but do not discover APIs or delegate the host application's API authorization to the SDK.

## 4. Host application identification

| Information | Current status | Evidence / limitation |
|---|---|---|
| Application ID and name | **PARTIALLY IMPLEMENTED** | Explicit adapter fields are required; script `data-app-id` sets both ID and name to the same value. No identity discovery. |
| Application base URL | **NOT IMPLEMENTED** | `options.apiUrl` and `data-api-url` configure the SDK backend. `_detectApiUrl()` derives the origin of the SDK script URL, not the host application's API base URL. |
| Current page URL/route/title | **NOT IMPLEMENTED automatically** | No code captures `window.location.href/pathname` or `document.title` into context. Host `contextProvider` could supply them. |
| Application environment (prod/stage/dev) | **NOT IMPLEMENTED automatically** | No environment field or environment inference. Host can include arbitrary values in supplied context. |
| Application metadata | **PARTIALLY IMPLEMENTED** | Host supplies context; adapter always inserts declared `{id,name}`. There is no typed metadata contract or metadata consumer. |
| API base URL / specification URL | **NOT IMPLEMENTED** | Neither adapter config nor SDK init has a dedicated API-spec URL or API catalog field. A host could place text in context, but no code would retrieve or interpret it. |
| Authenticated user identity | **PARTIALLY IMPLEMENTED** | Adapter may expose `getIdentity()`. Backend identity comes from a signed credential. Adapter identity is not automatically sent as authority. |
| Host permissions | **PARTIALLY IMPLEMENTED** | Adapter may expose `getPermissions()`, but server action filtering uses scopes from the authenticated backend request, not this client-returned value. |
| Selected entity/current application state | **PARTIALLY IMPLEMENTED** | A host can provide it using `contextProvider`; no automatic selection or route-state integration exists. |

**Conclusion:** The SDK can know which application it serves only when the host explicitly configures it. It cannot answer "which page is open?" or "what API belongs to this app?" from automatic inspection.

### Script-tag auth caveat

The `data-app-id` shorthand creates a truthy integration object but does not provide `getAuthHeaders`. `AssistantSDK.init()` nevertheless passes a `getAuthHeaders` callback to `AssistantApiClient` whenever an integration object exists. That callback returns `{}` when its provider is absent; the API client then treats host auth as configured and does not request the standalone demo token. Under production-required authentication, a script tag using only `data-app-id` can therefore send unauthenticated API requests. This is a **verified code-path limitation** and should be covered/fixed before recommending that shorthand for production authentication. It is not evidence that dynamic API discovery exists.

## 5. API discovery capability

| Capability | Status | Evidence |
|---|---|---|
| OpenAPI specification retrieval | **NOT IMPLEMENTED** | No URL configuration, fetcher, or runtime source reference. |
| Swagger specification retrieval/parsing | **NOT IMPLEMENTED** | No parser or runtime reference found. |
| API manifest ingestion | **NOT IMPLEMENTED** | No typed host manifest field or ingestion endpoint. |
| Endpoint enumeration / HTTP method discovery | **NOT IMPLEMENTED** | No operation model or endpoint enumerator. |
| Path/query/header parameter extraction | **NOT IMPLEMENTED** | No API-spec parameter normalization code. |
| Request-body/schema extraction | **NOT IMPLEMENTED** | `ActionDefinitionSchema` accepts a developer-provided schema; it does not extract one from an API. |
| API auth requirement discovery | **NOT IMPLEMENTED** | Auth mode is configured separately for SDK routes; there is no spec security-scheme parser. |
| Operation descriptions / response schema parsing | **NOT IMPLEMENTED** | No API-operation or response-schema parser. |
| Runtime endpoint inference from page/routes/network | **NOT IMPLEMENTED** | No page scraper, route analyzer, or browser network inspector exists. |
| Manually registered action definitions | **IMPLEMENTED** | `ActionRegistry.register/registerMany()` and explicit connector/HirePool definitions. |
| Connector-declared action definitions | **IMPLEMENTED** | `BaseConnector.getActionDefinitions()` and `bridgeConnectorToRegistry()`. |

Dependency manifests do not include an OpenAPI/Swagger parser. Dependency presence is not used as evidence for discovery.

## 6. Dynamic tool generation and existing action protocol

### Capability distinctions

1. **Existing registered actions — IMPLEMENTED.** Developers supply explicit action names, descriptions, parameter schemas, permission labels, risk, and confirmation metadata.
2. **Runtime registry mutation — PARTIALLY IMPLEMENTED.** In-process code can register/unregister definitions while running. This does not mean that remote host APIs are discovered, nor does the registry provide persistence, tenant scoping, approval, or a dynamic-execution handler.
3. **Provider-compatible schema conversion — PARTIALLY IMPLEMENTED.** Registered definitions can be converted to OpenAI function-tool shapes. The converter handles a subset of schema types and is not an OpenAPI parser.
4. **Dynamic API execution — NOT IMPLEMENTED.** The registry does not bind API methods/URLs to actions. Connector execution requires a manually implemented connector; host actions require a manually implemented browser executor.

### Tool generation steps

| Step | Status | Explanation |
|---|---|---|
| Read API operation definition | **NOT IMPLEMENTED** | No spec/manifest input. |
| Generate tool name/description | **NOT IMPLEMENTED from APIs** | Names/descriptions are manually authored. |
| Generate JSON Schema parameters | **PARTIALLY IMPLEMENTED** | A subset is converted from an already-defined Zod schema or parameter template. No operation parameter extraction. |
| Map HTTP method/path/query/body | **NOT IMPLEMENTED** | No HTTP operation model or request construction. |
| Register generated tool at runtime | **PARTIALLY IMPLEMENTED** | Registry mutation exists, but no generator feeds it API operations. |
| Present tool to provider | **PARTIALLY IMPLEMENTED** | Chat sends registry tools to the OpenAI provider; Gemini and Groq implementations do not demonstrate native tools. |
| Validate model arguments | **IMPLEMENTED for registered schema** | Chat checks `argumentsError`, permission, and `parameterSchema` before dispatch. |
| Execute generated API request | **NOT IMPLEMENTED** | No generic HTTP executor. |
| Return connector execution result to model | **IMPLEMENTED for connector path** | Connector results become tool messages and may be sent for one follow-up response. |
| Return host executor result to model | **NOT IMPLEMENTED** | Host action is a proposal; browser callback result updates UI/events only. |
| Remove/update API-derived tools | **NOT IMPLEMENTED as API lifecycle** | Registry supports manual unregister; no spec refresh/reconciliation. |

The current architecture can be extended without replacing `ActionRegistry`: an approved operation normalizer could generate validated action definitions and attach a trusted executor handler. However, the current host-action/connector distinction, provider differences, and registry isolation need an explicit design before generated operations are exposed.

## 7. HirePool end-to-end feasibility

The repository does not include HirePool's backend or its OpenAPI document. The following reflects only the SDK-side integration source.

| Intended step | Current status | Evidence |
|---|---|---|
| Identify HirePool | **PARTIALLY IMPLEMENTED** | `integrations/hirepool/actions.js` declares assistant ID `hirepool`; adapter can declare app ID/name. No automatic detection. |
| Discover authorized HirePool API spec | **NOT IMPLEMENTED** | No HirePool spec URL, fetcher, or API authorization handshake. |
| Identify job-listing endpoint | **NOT IMPLEMENTED** | No endpoint name/path or HTTP call in integration source. |
| Understand endpoint parameters | **PARTIALLY IMPLEMENTED** | Static `jobs:search` definition has manually authored `query`, `skills`, and `locations` schemas. |
| Generate tool from endpoint | **NOT IMPLEMENTED** | Definitions are hard-coded; no API operation conversion. |
| Register tool | **PARTIALLY IMPLEMENTED** | `registerHirePoolActions()` registers static actions into an assistant-specific registry when `ENABLE_HIREPOOL_INTEGRATION=true`. |
| Present tool to model | **PARTIALLY IMPLEMENTED** | Chat converts registered definitions and passes them to provider; actual native support is provider-specific. |
| Interpret request | **IMPLEMENTED generally** | The configured model receives the user request and available tool definitions. |
| Validate tool arguments | **IMPLEMENTED for static schemas** | Zod `.strict()` schemas are attached to current HirePool definitions and checked in chat action processing. |
| Execute HirePool API | **NOT IMPLEMENTED in this repository** | No HirePool connector or generic executor. Non-connector definitions become host action proposals. |
| Return API response to model | **NOT IMPLEMENTED for host executor path** | Host callback response is displayed/emitted by widget, not resubmitted as a model tool result. |

### Reusable components

- `HostIntegrationAdapter` for explicit application context, auth-header acquisition, permission UX, host action execution, and callbacks.
- `ActionRegistry` and `ActionDefinitionSchema` for vetted action metadata and schemas.
- `registryToOpenAITools()` for provider schema conversion.
- `processActionOrToolCalls()` for registration/permission/schema checks.
- `BaseConnector`/`dispatchActionProposal()` for server-side connector authorization and execution.
- JWT identity/scope extraction and `SessionManager` ownership/tenant checks.

### Missing integration pieces

- A HirePool-provided, authenticated API contract or hand-authored backend connector.
- A trusted operation allowlist and user/tenant authorization policy for each operation.
- A runtime API executor bound to fixed, approved origins and methods.
- A result path that feeds read-operation results back into model synthesis.
- End-to-end integration tests against mocked HirePool APIs and a separate manually authorized live test.

The current static HirePool definitions are read-only `jobs:search`, `jobs:view`, `profile:view`, and `applications:list`; they define schemas and prompt guidance only. The separate `legacy-actions.js` lists write-oriented legacy actions and does not register executors.

## 8. API discovery strategy comparison

### A. OpenAPI-based discovery

**Current status: NOT IMPLEMENTED.** No specification retrieval, parser, operation extraction, security-scheme mapping, or response schema handling is present.

**Recommendation:** Treat OpenAPI as an input to a review/normalization pipeline, not as permission to execute all declared operations. Pin a trusted spec source/version; validate size and schema; select operations using a server-side allowlist; map only supported parameter/body shapes; reject callbacks, external refs, and unsupported constructs; bind each approved operation to a fixed base URL. Require owner approval before activation.

### B. Host-provided API manifest

**Current status: NOT IMPLEMENTED as a manifest.** The adapter accepts generic context and action metadata but does not accept a validated API operation catalog.

**Recommendation:** A host manifest can fit the explicit adapter model better for an initial version, provided the backend verifies/owns the manifest. Browser-supplied manifests must be treated as untrusted suggestions, not authorization or executable definitions.

### C. Manually registered integrations

**Current status: IMPLEMENTED for static action definitions and connector classes.** Developers register Zod-validated action metadata; connectors implement authorization and execution manually. HirePool currently uses static action definitions without an executor.

**Recommendation:** This is the lowest-risk first path for HirePool. Map each approved action to an existing HirePool API client/backend function and keep HirePool authorization authoritative.

### D. Automatic endpoint inference

**Current status: NOT IMPLEMENTED.** The SDK does not infer API endpoints from website pages, routes, scripts, or browser traffic.

**Recommendation:** Do not build endpoint inference from page scraping or network observation as a substitute for an API contract. Such inference is incomplete, fragile, susceptible to prompt/spec poisoning, likely to expose undocumented or privileged endpoints, and does not establish user authorization. Prefer reviewed OpenAPI or a host-owned manifest, then a constrained executor.

## 9. Security assessment

### Existing controls that can be reused

- JWT signatures are verified server-side; stable principal identity is required; optional issuer/audience checks are available.
- API-key validation uses timing-safe comparison.
- Production auth defaults to required unless explicitly configured otherwise.
- Session operations check ownership and tenant mismatch.
- Chat action execution checks registered action and signed-token scopes, then validates Zod parameters.
- Server-side connectors implement `validateAuthorization()` before execution.
- Document uploads validate authentication, consent headers/version, body consent, upload size, and session ownership.
- Host action UX presents a confirmation button and destructive-action acknowledgement; host can also run `canExecuteAction`.
- Provider API credentials are server-side, not supplied through the widget configuration.

### Important boundaries and gaps

1. **Discovery is not approval.** A visible spec or host-provided operation is not permission to call it. Approval must be a server-side policy tied to tenant, user, method, path, and data sensitivity.
2. **Scopes are not a universal route guard.** The chat route uses JWT scopes to filter action definitions; route authentication itself verifies credentials but does not enforce each demo token scope against every endpoint.
3. **Demo token assistant binding is not enforced at consumption.** `/api/auth/token` restricts token issuance to the public assistant set and includes `assistantId` in claims. `authenticate()` does not compare that claim with the request's `assistantId`; chat selects a registry from the body value and no assistant-level authorization check is visible. The prior authentication report's statement that demo tokens are rejected for protected assistants is therefore only enforced at token issuance, not demonstrated on subsequent protected-assistant requests. This is a **verified authorization gap** that should be resolved before treating assistant IDs as security boundaries.
4. **Client-provided identity/permissions are not authority.** `getIdentity()` and `getPermissions()` are browser callbacks; backend authorization must rely on the verified JWT and/or host API authorization. `getAvailableActions()` does not grant execution rights.
5. **Host permission UX is not backend authorization.** The browser's `canExecuteAction` and confirmation button can be bypassed by a custom client. The host's own API must reauthorize every operation.
6. **Host action result is not a tool result.** A host callback can execute an action but its returned value is not reintroduced into the provider conversation. It cannot currently power a model-grounded read/query loop.
7. **Connector credentials are not a credential broker.** Connector execution receives `connectorAuth` from the chat request body; connector code must validate it. Do not treat arbitrary browser-supplied auth material as server-held credentials. `MockConnector` uses demonstration data and a hard-coded demo token.
8. **No fixed API-host boundary exists because no generic executor exists.** Any future executor must bind operations to server-approved origins and reject arbitrary URL/base-URL input to prevent SSRF, DNS rebinding, redirect escape, metadata-service access, and cross-tenant destination changes.
9. **OpenAPI content is untrusted input.** Descriptions, parameter names, examples, external `$ref`s, schemas, and server URLs may be malicious or oversized. They need validation, size/depth limits, reference restrictions, prompt-safe descriptions, and human approval.
10. **Writes/destructive actions need more than a UI button.** Require backend policy and idempotency/replay controls; confirmation must be bound to the exact operation, normalized arguments, principal, and expiry.
11. **Sensitive response handling is unspecified for future APIs.** Minimize and redact returned data, constrain model context size, avoid logging data, and define field-level policies before passing responses to a provider.
12. **In-memory registry/session lifecycle is process-local.** `ActionRegistry` maps and `SessionManager` are not persistent/distributed. Dynamically mutating them in serverless instances would be inconsistent and could leak definitions across tenants if keyed only by assistant ID.

### Risk interpretation

The existing system is suitable for explicitly registered actions whose execution and authorization are implemented by a trusted host/connector. It is **not currently suitable for executing arbitrary discovered APIs**. The assistant ID/demo-token binding issue and the `data-app-id` auth fallback behavior should be reviewed independently of API discovery work.

## 10. Current capability matrix

| Capability | Current status | Evidence | Limitation |
|---|---|---|---|
| Host application identification | **PARTIAL** | `HostIntegrationAdapter.application`; script `data-app-id` | Must be declared; no verification or automatic detection. |
| Page context | **PARTIAL** | `contextProvider`, `options.context`, `setContext()` | No URL/title/route/entity capture unless host supplies it. |
| API discovery | **NOT IMPLEMENTED** | Runtime source search found no discovery path | No runtime catalog of host APIs. |
| OpenAPI ingestion | **NOT IMPLEMENTED** | No parser/fetch integration | No spec-based operation inventory. |
| API parsing | **NOT IMPLEMENTED** | No API operation/schema parser | Zod validation is for hand-authored action definitions only. |
| Tool generation | **PARTIAL** | `registryToOpenAITools()` | Converts registered definitions; does not create definitions from APIs. |
| Runtime tool registration | **PARTIAL** | `register()/registerMany()/unregister()` | Programmatic in-process mutation only; no generated-tool lifecycle or tenant isolation. |
| Dynamic execution | **NOT IMPLEMENTED** | Connector `execute()` is manually implemented; host callback is app-owned | No generic HTTP method/path executor. |
| Authentication propagation | **PARTIAL** | Adapter `getAuthHeaders()` -> SDK backend API client | Does not automatically delegate those credentials to a discovered host API. |
| Authorization | **PARTIAL** | JWT identity/scopes, connector validation, session ownership | No per-discovered-operation authorization or assistant-claim binding at chat use. |
| Tool validation | **PARTIAL** | `parameterSchema.safeParse()` | Only for static registered tools; generated API schemas absent. |
| API response handling | **PARTIAL** | Connector result may be a provider tool message | Host executor result stays in UI; no generic API response sanitization policy. |
| Error handling | **PARTIAL** | Provider/route/connector error structures | No generic HTTP executor errors or retry/timeout policy for host APIs. |
| Multi-application support | **PARTIAL** | Adapter application ID; storage namespaced by app ID + assistant ID | Backend action registry keyed by assistant ID, not application/tenant catalog. |
| Multi-tenant support | **PARTIAL** | JWT tenant claims and session tenant checks | No tenant-scoped API catalog/registry/executor or durable session backend. |

## 11. Missing components

1. Typed, versioned host application/API manifest.
2. Trusted specification retrieval and provenance/ownership checks.
3. OpenAPI version and feature support policy, parser, validation, and safe `$ref` handling.
4. Operation approval, tenant binding, allowed origin/path/method, and risk classification.
5. Generator from normalized operations to bounded tool names/descriptions/JSON Schema.
6. Runtime registration with tenant/application isolation, versioning, refresh, and revocation.
7. Secure executor with fixed origin, per-request delegated credentials, timeout/body limits, redirect policy, retries, and audit-safe errors.
8. Result filtering/minimization and provider-context size controls.
9. Model tool-result loop for host-executed reads and clear distinction between proposal and completed execution.
10. Backend enforcement for confirmation, principal scopes, and assistant/demo-token binding.
11. Integration tests exercising HirePool API authorization and denied cases.
12. Observability, rate limits, operation quotas, and lifecycle cleanup for dynamically exposed tools.

## 12. Recommended future architecture

**RECOMMENDATION — Proposed flow (not implemented):**

`Host Integration → Trusted API Catalog → Specification Parser/Normalizer → Approved Operation Set → Tool Generator → Tenant-scoped Tool Registry → Secure API Executor → Provider Tool Result`

| Component | Purpose, inputs, and outputs | Existing reuse | Missing/security controls |
|---|---|---|---|
| Host identity/context | Supply verified app ID, selected entity/page context, and tenant/user identity. Output a bounded request context. | `HostIntegrationAdapter`, `serializeContext()` | Verify identity server-side; do not authorize from context or browser values. |
| API catalog ingress | Receive host-owned manifest or trusted spec reference and version. | Adapter contract is an extension point only. | New schema and backend ingress; authenticate catalog owner; provenance/signature and tenant isolation. |
| Specification parser | Parse supported OpenAPI document into normalized operations. | Zod is available for validation; no parser currently exists. | New parser/integration; bounded input, refs policy, safe URL handling, schema complexity caps. |
| Operation approval | Reduce spec to allowlisted operations with policy, data sensitivity, risk, and confirmation. | `ActionDefinitionSchema` has permissions/risk/confirmation fields. | Server-side policy/admin review; no auto-execution based only on discovery. |
| Tool generator | Convert approved operation metadata and input schema to provider tool. | `ActionRegistry`, `parametersToJsonSchema()`, `registryToOpenAITools()` | Correct full schema mapping, provider-specific compatibility, stable collision-safe names. |
| Tool registry | Hold vetted tools and executor bindings isolated by app/tenant/version. | Assistant registry and `ActionRegistry` provide a basic map. | Avoid shared process-global mutable state; support scoped lifecycle/version/revocation. |
| Secure executor | Bind a registered operation ID to fixed origin/method/path and authenticated API invocation. | `BaseConnector.execute()` and `dispatchActionProposal()` pattern | New implementation; SSRF/redirect controls, delegated auth, allowlisted headers, timeout/size limits, idempotency, audit. |
| Authorization/confirmation | Evaluate current user/tenant and action policy for each call; require confirmation for writes. | JWT scopes, `hasActionPermissions()`, widget confirmation | Backend authority and signed/short-lived confirmation binding; never trust model output. |
| Result/error adapter | Minimize and validate API response; pass safe tool result to model/UI. | Connector result tool-message path | Host execution feedback loop, data redaction, response schemas and error normalization. |
| Provider adapter | Expose tools and tool results consistently across providers. | OpenAI tool support | Implement/test equivalent tool calling or explicitly gate unsupported providers. |

## 13. Implementation roadmap

The following is a proposal; no phases below are implemented by this audit.

| Phase | Objective and likely files | Tasks and dependencies | Security considerations | Tests and acceptance |
|---|---|---|---|---|
| 1. Host context | `widget/src/integration.js`, `widget/src/sdk.js`, `widget/src/widget.js` | Define typed context for app/page/selected entity; document explicit versus automatic fields. Depends on host integration contract. | Bound size; treat as untrusted prompt context; omit secrets/PII by default. | Unit tests for serialization, refresh, page changes, malformed/oversize context. |
| 2. Catalog contract | New config/schema and backend API route; adapter docs | Define manifest version, source, app/tenant binding, spec URL or inline manifest. | Authenticated ownership, allowlisted source, no browser-chosen executor origin. | Valid/invalid catalog tests and cross-tenant rejection. |
| 3. Spec ingestion/parser | New backend service (plus package only if needed) | Support a bounded OpenAPI subset; normalize paths, methods, parameters, request bodies, security metadata, responses. | `$ref` restrictions, input limits, SSRF-safe retrieval, reject unsupported/security-ambiguous specs. | Parser fixtures for supported OpenAPI versions, invalid refs, oversized/deep schemas, unsafe server URLs. |
| 4. Operation approval | New policy layer/config | Allowlist operations and data fields; classify read/write/destructive; map required scopes and confirmation policy. | Discovery is not authorization; require explicit owner approval. | Denied-by-default and scope/risk policy tests. |
| 5. Tool generation | Extend `backend/src/actions/tool-converter.js` or add API operation generator | Create stable names, descriptions, parameter schemas, and response metadata from normalized approved operations. | Sanitize descriptions; cap tool count/description/schema size; avoid prompt injection. | Golden schema tests, name collision and unsupported-type tests. |
| 6. Registry lifecycle | `connectors/bridge.js`, `backend/src/actions/registry.js`, chat route | Register operation definitions and executor binding by app/tenant/spec version; refresh/revoke atomically. | No shared cross-tenant registry; prevent stale and client-mutated registrations. | Isolation, update, rollback, revocation, and concurrent request tests. |
| 7. Secure executor | New executor/connector module; chat tool dispatch | Execute only normalized operation IDs; fill path/query/body from validated values; attach delegated auth; normalize output. | Fixed origin, redirect/SSRF defenses, no secret logging, request/response caps, timeouts, idempotency, audit. | Mock HTTP server tests for path escaping, auth propagation, redirects, timeouts, malformed responses, auth denial. |
| 8. Confirmation and model loop | `backend/src/routes/chat.js`, `widget/src/widget.js`, integration contract | For reads, return sanitized results to model. For writes, bind user confirmation to exact action+arguments and reauthorize on execution. | Confirmation cannot be model asserted; avoid TOCTOU and replay. | Read tool follow-up test; unconfirmed write denial; tampered args and replay denial. |
| 9. HirePool integration | `integrations/hirepool/actions.js` plus a HirePool connector or host API bridge | Use HirePool-owned API/client, current user credentials, and actual endpoint/schema evidence. | HirePool backend authorization remains authoritative; tenant and record ownership checked server-side; minimize candidate data. | Mocked positive/negative authorization, query filters, PII minimization, write confirmation if applicable. |
| 10. Provider parity | `backend/src/providers/*` | Add or explicitly gate provider-native tools and tool-result format. | Provider API secrets remain server-side; handle tool call limits and malformed calls. | Provider contract tests with mocks for supported provider families. |
| 11. Generic integration tests/docs | `tests/*`, SDK integration guide | Test multiple host apps, custom API manifests, lifecycle, errors, revocation, and extension compatibility. | Ensure no mock integration leaks into production. | Full mock suite, packaging/build, security regression suite, manual browser and preview verification. |

## 14. Testing strategy

### Existing tests found

- `tests/auth-lifecycle.test.js`: demo token issuance/allowlist, token-client flow, auth rejection, host auth-header precedence, session tenant isolation, and document consent/auth.
- `tests/chat-stream.test.js`: health, catch-all routing, client payload, provider invocation, static action/tool resolution, invalid request, auth behavior, safe logging, SSE errors, and synthetic PDF parsing.

### Coverage status

| Test subject | Existing coverage |
|---|---|
| SDK init / script-tag options | **PARTIAL**; client/API lifecycle is tested, but not a broad DOM script-tag context matrix. |
| Host context contract | **NOT FOUND** in current test files. |
| API spec parsing / OpenAPI ingestion | **NOT FOUND**. |
| Dynamic tool generation from API operations | **NOT FOUND**; static tool conversion/action resolution is covered. |
| Runtime generated registry lifecycle | **NOT FOUND**; static action resolution is covered. |
| Generic API execution | **NOT FOUND**. |
| Host auth header precedence | **COVERED** by auth lifecycle test. |
| Per-operation authorization | **NOT FOUND** for API-generated operations. |
| Invalid API specifications | **NOT FOUND**. |
| Invalid registered-tool arguments | **PARTIAL**; code validates schemas, but current focused tests do not comprehensively exercise every failure path. |
| API errors/retries/redirects | **NOT FOUND** for a generic API executor. |
| Tenant/session isolation | **PARTIAL**; session tenant isolation is tested, not a dynamic registry/catalog. |
| Destructive confirmation | **NOT FOUND** as an end-to-end generated API operation test. |
| HirePool API execution | **NOT FOUND**; static action definitions are not an API executor. |

### Proposed test scenarios

1. Host identity is not inferred from page hostname; explicit adapter identity is propagated to bounded context.
2. Script-tag `data-app-id` behavior with and without auth headers, including production-required auth.
3. Context-provider changes update subsequent requests and do not leak across widget instances.
4. Valid/invalid/oversized OpenAPI documents, unsupported versions, external refs, and hostile descriptions.
5. Operation allowlist excludes unapproved methods/paths and disallowed API hosts.
6. Tool generation preserves required/optional query, path, and JSON body parameters; rejects unsupported schema constructs and collisions.
7. Registry scopes isolate applications/tenants, reload atomically, and revoke prior definitions.
8. Model arguments are validated and authorization is checked immediately before execution.
9. Executor enforces fixed origin, no redirect escape, timeout/body limits, and safe error mapping.
10. Host API authorization denial is returned as a safe tool result; no unauthorized data is sent to the model.
11. Read action result enters the model tool-result loop; write action fails without a matching user confirmation.
12. HirePool tests assert current-user scoping and candidate-data minimization.
13. Provider contract tests verify tools only on explicitly supported providers.
14. Test that demo credentials cannot be reused against an assistant outside their permitted scope.

## 15. Risks and limitations

- The HirePool backend, actual API routes, and authoritative HirePool OpenAPI definition are outside this repository and were not inspected.
- Static action descriptions do not prove that a corresponding endpoint exists or that the current user is authorized for it.
- The assistant ID is a client request field used to select config/registry; it must not be treated as a security boundary without server-side claim binding and authorization.
- Existing process-local registry/session state is unsuitable for durable, multi-instance dynamic catalogs without a persistence and isolation design.
- Provider tool calling is not implemented consistently across Gemini, Groq, and OpenAI.
- A host-browser executor may use authenticated browser state, but it does not make that state safe to reveal to the model or replace backend authorization.
- The audit was read-only; no code fixes were made for the noted limitations or security observations.

## 16. Final feasibility conclusion

**Does the current SDK support dynamic API discovery? — NO.** It does not retrieve or parse host API specifications, manifests, or website endpoints.

**Does it support dynamic tool generation from APIs? — NO.** It supports manually registered action definitions and conversion of those definitions to provider tool schemas. That is not API-derived generation.

**What is required for the HirePool scenario? —** First establish the actual HirePool API contract and owner-approved operation list. Then implement a secure host/API catalog path, parser/normalizer, generated schema and registry binding, provider-compatible tool calls, and executor that uses HirePool's existing authenticated API/backend authorization. Feed sanitized read results back to the model and require server-enforced confirmation for writes. Test tenant isolation and candidate-data minimization end to end.

### Most important existing files to inspect

- `widget/src/sdk.js` — initialization, script-tag loading, app/backend URL handling, context and adapter wiring.
- `widget/src/integration.js` — HostIntegrationAdapter contract.
- `widget/src/api-client.js` — SDK backend requests and auth-header/demo-token behavior.
- `widget/src/widget.js` — context transmission and host-action confirmation/execution UI.
- `backend/src/routes/chat.js` — tool availability, permission/schema checks, connector dispatch, and host-action result flow.
- `backend/src/actions/registry.js` and `backend/src/actions/tool-converter.js` — action registration and provider schema conversion.
- `connectors/base.js` and `connectors/bridge.js` — manual connector contract and server-side execution.
- `integrations/hirepool/actions.js` — current static HirePool action definitions.
- `backend/src/middleware/auth.js`, `backend/src/session-manager.js`, and `backend/src/routes/auth.js` — principal verification, session isolation, and demo token issuance.
- `tests/auth-lifecycle.test.js` and `tests/chat-stream.test.js` — existing focused mock coverage.

### Major missing components

- API specification/manifest ingestion and parser.
- Operation approval and tenant-scoped catalog.
- API-derived tool generator.
- Per-operation policy and secure generic executor.
- Host execution result-to-model loop.
- Provider parity for tool calling.
- Dynamic API discovery and HirePool endpoint integration tests.

## Audit-only change record

**No source files were modified.** The only repository change permitted and made for this task is this report: `SDK_DYNAMIC_API_DISCOVERY_AND_TOOL_GENERATION_AUDIT.md`.
