# AI Assistant SDK — Complete Readiness Audit

Audit date: 2026-11-03  
Repository: `D:\ai-assistant-plugin`  
Branch: `main`

## 1. Executive summary

**Overall status: NOT READY for a general multi-application production deployment.**

The repository contains a functioning embeddable widget, an Express API, multiple
provider adapters, server-registered action definitions, and opt-in Dynamic API
Discovery. The widget can be embedded in a host page and its version-1 host adapter
provides a useful client-side contract.

However, the current server does not bind the host application's identity to
authenticated requests, action registries, or session ownership. JWT assistant scopes
are not enforced by the chat route, and a token's `assistantId` claim is not compared
with the request's `assistantId`. These are blockers for relying on the current SDK as
a tenant-isolated integration boundary. The installed Zod 4 version also exposes a
confirmed native-tool schema conversion defect for ordinary registered actions.

Dynamic API Discovery has meaningful SSRF controls and remains opt-in, but no real
application integration is registered in the current startup code. Its configured
`applicationId` is not used to select or authorize an integration. It is not ready as a
general multi-application production capability.

The tests and read-only checks run during this audit passed. The build was **not run**:
the configured build script overwrites generated files under `widget/dist` and
`public/`, which would violate this audit's no-project-file-modification constraint.
No live provider, HirePool API, production environment, or deployment was accessed.

## 2. Repository state

### Initial state observed

- Repository root: `D:\ai-assistant-plugin`
- Branch: `main`
- The worktree was already dirty. Modified paths:
  - `.env.example`
  - `README.md`
  - `backend/.env.example`
  - `backend/src/actions/tool-converter.js`
  - `backend/src/routes/chat.js`
  - `docs/security.md`
  - `package-lock.json`
  - `package.json`
- Pre-existing untracked paths:
  - `DYNAMIC_API_DISCOVERY_IMPLEMENTATION_REPORT.md`
  - `DYNAMIC_API_DISCOVERY_REMEDIATION_REPORT.md`
  - `SDK_DYNAMIC_API_DISCOVERY_AND_TOOL_GENERATION_AUDIT.md`
  - `backend/src/dynamic-api/`
  - `docs/dynamic-api-discovery.md`
  - `tests/dynamic-api.test.js`
- `.env` and `.env.local` exist locally and are ignored by `.gitignore`; their contents
  were not read. No production environment values were accessed.
- This audit changed no implementation, test, package, or environment file. The
  requested `SDK_COMPLETE_READINESS_AUDIT.md` is the only file created for this audit.

### Main configuration and entry points

- `package.json` sets `main` to `backend/src/server.js`; `api/index.js` is the Vercel
  Express entry and `api/[...path].js` re-exports it.
- `backend/src/app.js` configures Express middleware, route mounting, and opt-in
  HirePool action registration.
- `widget/src/sdk.js` is the browser SDK initializer; `widget/src/integration.js`
  implements the version-1 host adapter.
- `backend/src/routes/chat.js` owns both standard and SSE chat workflows.
- `connectors/bridge.js` holds assistant action registries and dispatches connector
  actions.
- `backend/src/dynamic-api/` contains OpenAPI parsing, action generation, integration
  registration, and outbound HTTPS controls.
- `vercel.json` builds to `public`, rewrites `/api/:path*` to the catch-all, and
  excludes environment files from the function bundle.

### Evidence index

- Authentication defaults and verified principal construction:
  [auth middleware](./backend/src/middleware/auth.js#L263);
  demo-token assistant claim:
  [auth route](./backend/src/routes/auth.js#L32).
- Chat assistant selection and action-registry construction:
  [chat route](./backend/src/routes/chat.js#L448);
  request schema:
  [schemas](./config/schemas.js#L45).
- Session ownership and lookup:
  [session manager](./backend/src/session-manager.js#L89).
- Application adapter and browser storage scoping:
  [host adapter](./widget/src/integration.js);
  [SDK initialization](./widget/src/sdk.js#L87).
- Dynamic registration and request selection:
  [dynamic catalog](./backend/src/dynamic-api/catalog.js#L31);
  [OpenAPI parser](./backend/src/dynamic-api/openapi.js);
  [secure HTTP client](./backend/src/dynamic-api/secure-http.js).
- Action schema conversion and provider integration:
  [tool converter](./backend/src/actions/tool-converter.js);
  [Gemini provider](./backend/src/providers/gemini.js);
  [OpenAI provider](./backend/src/providers/openai.js).
- HirePool definitions and startup gate:
  [HirePool actions](./integrations/hirepool/actions.js);
  [app startup](./backend/src/app.js#L23).
- Build/test behavior:
  [package scripts](./package.json#L2);
  [widget build script](./widget/build.js);
  [chat and PDF regression tests](./tests/chat-stream.test.js);
  [dynamic API tests](./tests/dynamic-api.test.js).

## 3. SDK architecture — VERIFIED WITH LIMITATIONS

### End-to-end workflow

1. The script-tag bundle exposes `window.AssistantSDK`; programmatic initialization
   accepts an API URL, assistant ID, UI customization, optional context, and optional
   host integration.
2. The adapter may provide application metadata, context, headers, permission UX,
   host action execution, identity/permission getters, and lifecycle callbacks.
3. The browser API client obtains host headers from the adapter or requests a
   short-lived demo JWT if no host header provider is configured.
4. The client sends a chat request to the SDK backend. The backend authenticates the
   request, validates its JSON, loads session context, builds the prompt and action
   catalog, and invokes the selected provider.
5. Native provider tool calls or legacy fenced action proposals are resolved against
   the active registry. Permissions and parameter schemas are checked before
   dispatch. Host actions return to the browser for optional confirmation and host
   execution; connector actions execute in the backend; dynamic API GET actions use
   the registered integration executor.
6. SSE responses contain start, chunk, action/result, done, or error events.

### What a host must provide

- A deployed/reachable SDK backend and its URL.
- A host script integration or built SDK bundle.
- Application ID and display name, an optional context provider, and an auth-header
  provider for protected use.
- Host-side `canExecuteAction` and `executeAction` callbacks for client-executed
  actions. These callbacks are UX/integration hooks, not backend authorization.
- Backend action registration and authorization that checks current identity,
  tenant, record ownership, and business rules at execution time.
- Production authentication, persistent session storage, and operational controls.

The host adapter's `getIdentity`, `getPermissions`, and `getAvailableActions`
callbacks are exposed through browser SDK methods. They are not sent as trusted
authorization data to the backend. The browser context carries application metadata
as ordinary untrusted context.

### Application-specific versus shared configuration

- Shared: widget UI, API client, routes, provider abstraction, action registry,
  session code, and Dynamic API Discovery implementation.
- Application-specific: assistant ID/preset, host callback configuration, backend
  action definitions, dynamic API registration, API credentials, authorization
  callback, response-field projection, and host API behavior.
- Backend request routing and registry selection use `assistantId`; the SDK does not
  establish a server-verified host application identity from the adapter's
  `application.id`.

The design is therefore reusable as a codebase and embeddable widget, but it does not
currently provide a complete multi-application identity and isolation contract.

## 4. Application mounting and integration model — VERIFIED WITH LIMITATIONS

- A framework-independent script bundle can mount the Shadow DOM widget in a host
  page. The programmatic SDK supports the version-1 adapter.
- The version-1 adapter validates the version, basic application ID/name presence and
  length, callback types, and header syntax.
- Authentication is separate: host-supplied headers go to the SDK backend, and the
  backend trusts only verified JWT claims or configured API keys.
- Client permission callbacks can gate the UI but do not authorize a server API
  request. The host executor/API must re-authorize.
- The adapter's `applicationId` scopes browser storage, but the backend does not
  compare it to a verified token claim or use it to choose actions, credentials, or
  sessions.
- Unknown assistant IDs can fall back to the default public configuration. Chat
  request validation does not apply the stricter assistant-ID regex from
  `AssistantConfigSchema`.

Conclusion: a host can embed the UI, but must write/register application-specific
backend and host API code. Universal plug-and-play compatibility is not verified.

## 5. API discovery architecture — VERIFIED WITH LIMITATIONS

- Discovery is server-side and requires an explicit call to
  `registerDynamicApiIntegration(...)`; the repository's startup code currently does
  not register one.
- A server-side registration provides integration ID, assistant ID, application ID,
  specification URL, API base URL, operation ID allowlist, response field
  projections, authorization callback, and optional server-side credential
  callbacks.
- The specification is fetched on authorized chat requests. No specification cache
  was found.
- JSON and YAML OpenAPI 3.0/3.1 parsing supports local references and scalar
  path/query parameters. External references, request bodies, unsupported
  serialization, and non-GET operations are not generated.
- Every operation must be explicitly allowlisted and have a non-empty response-field
  projection. Tool parameters are validated again by the execution layer.
- OpenAPI `servers` are ignored; execution uses only the configured API base URL.
- Dynamic tools are composed with a request-local clone of the assistant's static
  registry when enabled. Disabled discovery returns the original registry.
- At most one integration authorized for a given assistant can be active in a
  request. The matching rule is assistant ID only; `applicationId` is stored and
  returned from registration but not used to match the request.
- GET-only is not equivalent to side-effect-free. Each selected GET operation still
  needs application-level review and authorization.

## 6. Security findings

### BLOCKER — no server-verified application binding

The adapter adds its application metadata to browser context, but context is
client-supplied and is not an authorization source. Dynamic registrations require an
`applicationId`, yet candidate integrations are filtered only by `assistantId`.
Static registries are also keyed only by assistant ID. The backend has no generic
binding from a verified request principal to the registered application identity.

An application-specific `authorize(user)` callback can add a custom check, but the SDK
does not enforce that the callback's application ID matches a trusted request claim.
This is insufficient as the default multi-application isolation contract.

### BLOCKER — assistant token scope is not enforced by chat routing

The demo token issuer restricts which assistant IDs it will mint a token for and puts
the selected assistant ID in the JWT. Authentication extracts user/scopes/raw claims,
but the chat route does not compare the request assistant ID to the token claim. The
chat request uses the body assistant ID to select configuration, session namespace,
and registry. Consequently, the public-token issuance restriction does not itself
prevent a valid demo token from being presented to another assistant route.

The `chat`, `summarize`, `document:upload`, and `session:clear` scopes are present in
demo JWTs. Source inspection found action-level scope filtering in chat, but no
route-level enforcement of those scopes for chat, summarize, document, or session
operations. Do not treat JWT scopes or assistant ID as enforced until the routes bind
and check them.

`AUTH_REQUIRED=false` explicitly overrides the production default because required
authentication is selected from that environment variable when it is present.
Therefore an incorrect production setting can make protected routes accept
unauthenticated requests. The authentication code's production detection uses
`NODE_ENV`; it does not use `VERCEL_ENV`.

### HIGH — sessions are not bound to assistant or application

`SessionManager` keys sessions by conversation ID and checks user/tenant ownership,
but an existing session is not rejected when requested under a different assistant
ID. Application identity is not part of session ownership. A same-user/same-tenant
session can therefore be reused across assistants or applications if its ID is
available. Session history, context, and documents are process-local maps and are not
durable across serverless instances.

### HIGH — Zod 4 native-tool schema generation is incorrect

`package.json` installs Zod `4.6.7`. `parametersToJsonSchema()` inspects Zod 3
internal `_def.typeName` values to infer types and optionality. A local, read-only
probe against the installed Zod 4.6.7 produced `string` for a number, boolean, and
enum; it also marked an optional boolean as required. This makes native tool schemas
for ordinary Zod-backed static actions inaccurate even though server-side `safeParse`
still validates the eventual parameters.

The dynamic API action path avoids this specific inference by supplying explicit JSON
Schema metadata. Static/manual actions do not generally do so. The currently
registered HirePool `page_size` action is affected by the same converter path.

### MEDIUM — provider tool-name encoding is not collision-safe

`encodeToolName()` maps `:` to `__`, while `decodeToolName()` maps every `__` back to
`:`. Thus valid distinct action names such as `foo:bar` and `foo__bar` encode to the
same provider function name. Action names allow both character sequences. The
registry does not reject this collision, so native provider calls can resolve to the
wrong action or an ambiguous schema.

### MEDIUM — connector credentials are accepted from the request body

`ChatRequestSchema.connectorAuth` and `ConnectorActionSchema.authToken` are
client-supplied strings. The chat bridge forwards `connectorAuth[connectorId]` to the
connector's server-side `validateAuthorization()` callback; the direct connector
execute route also accepts `authToken` in the body. A connector must still validate
the credential, but the SDK does not bind it to the authenticated user or application.
Do not pass service credentials this way; prefer server-held credentials or a
short-lived user credential whose ownership and scope are verified by the connector.

### VERIFIED CONTROLS

- JWT HS256 signature, expiry, optional issuer/audience checks, timing-safe signature
  comparison, and API-key comparison are implemented.
- Chat action definitions are filtered by verified JWT scopes when permissions are
  configured; parameter schemas are validated before dispatch.
- Host context and model output are treated as untrusted; host-side execution is
  explicitly not a backend security boundary.
- CORS is wildcard without credentialed cross-origin cookies. This is a broad
  transport policy, not authorization.
- Provider keys are referenced from server environment in provider implementations;
  no provider secret is part of the browser source contract.
- Error responses are sanitized for production when `NODE_ENV=production`; the
  generic request logger does not log request bodies or authorization headers.
- The local `.env` files were not read. This audit does not certify their contents or
  any deployed secret configuration.

## 7. Authentication and authorization — VERIFIED WITH LIMITATIONS

- `authenticate()` supports JWT, API key, hybrid, optional, and required modes.
- Production defaults to required authentication only when `NODE_ENV=production` and
  `AUTH_REQUIRED` is unset. `AUTH_REQUIRED=false` overrides that default.
- Verified JWT scopes are available to chat action permission checks. Route-level
  route scopes are not consistently enforced.
- JWT issuer and audience checks are optional unless configured.
- The demo token endpoint signs short-lived tokens only for the public preset list,
  but the consuming chat route does not enforce the token's assistant claim.
- `requireTenant()` exists, but routes generally derive session user/tenant values
  from optional `req.user`; the reusable SDK does not enforce a host-specific
  application tenant policy.
- Final authorization of host actions belongs to the host API and must be repeated
  there. UI confirmation, role fields in context, and the adapter permission
  callback do not provide authorization.

## 8. Multi-tenant isolation — NOT VERIFIED / BLOCKER

| Boundary | Finding |
|---|---|
| Application identity | Adapter application ID is not a trusted backend request field or integration selector. |
| User identity | Derived from a verified JWT principal or API-key service principal. |
| Tenant identity | Derived from signed JWT claims, but host-specific tenant validity is not independently checked by the SDK. |
| Static action catalog | Global in-process map keyed by assistant ID, not application or tenant ID. |
| Dynamic action catalog | Request-local registry clone; dynamic integration selection is keyed by assistant ID and authorization callback. |
| Integration credentials | Stored in server registration callbacks, but application identity does not select the callback. |
| Session state | In-memory and keyed by conversation ID; user/tenant ownership is checked, but assistant/application binding is absent. |
| Specification cache | No cache found; specification is fetched for each authorized discovery path. |
| Response data | Dynamic responses are projected and size-limited, then can be added to the conversation's final text/session history. |

Request-local dynamic registry cloning prevents dynamic definitions from mutating a
shared registry, but it does not solve application or session boundary issues.

## 9. ActionRegistry compatibility — VERIFIED WITH LIMITATIONS

- Existing static definitions and tags are copied into enabled request-local dynamic
  registries; disabled discovery returns the base registry object.
- Static registries are process-global per assistant ID. Manually registered actions
  remain available to that assistant.
- Permissions and parameter validation are checked before tool dispatch.
- OpenAI-compatible providers use native tool calls. The Gemini adapter does not send
  provider-native tool schemas and returns text only; it relies on the legacy fenced
  action proposal path.
- The Zod 4 conversion defect and non-injective tool-name encoding described above
  affect native tool compatibility.
- Existing tests cover basic registered-action resolution, discovery disabled
  behavior, request-local dynamic isolation, tags, and fenced action guidance. They do
  not cover the Zod 4 converter output or provider-name collision cases.
- Host action confirmation/execution remains browser-side; the host API must
  independently authorize all operations.

## 10. Dynamic API security — VERIFIED WITH LIMITATIONS

### Verified protections

- Discovery is off unless `DYNAMIC_API_DISCOVERY_ENABLED` is exactly `true`.
- Discovery is blocked when `NODE_ENV` or `VERCEL_ENV` is exactly `production`.
- Integration registration is server-side; target URLs do not come from model output
  or chat request fields.
- Exact hostname allowlisting, HTTPS-only URLs, DNS resolution, public address
  checks, and DNS result pinning are implemented.
- Redirects are rejected; request/response sizes and content types are bounded.
- The request timeout begins before DNS and covers connection/request/response body.
  Node's DNS promise itself cannot be forcibly cancelled; timeout/abort rejects the
  operation and prevents a late DNS result from starting HTTPS execution.
- OpenAPI operations are GET-only, explicitly allowlisted, parameter-validated, and
  response-projected.
- API credentials are supplied by server registration callbacks and header names are
  allowlisted.

### Limitations

- The IPv4/IPv6 policy is explicit and conservative, not a fully maintained
  implementation of every IANA special-purpose allocation.
- GET operations can still cause application-side effects and need review.
- Discovery refetches the specification for each authorized chat request; there is no
  cache or production performance test.
- `applicationId` is not used to select an integration or validate the request.
- No application-specific integration is registered by the current startup code.
- The production environment itself was not inspected; only the code gate and checked-in
  examples were reviewed.

The exact discovery variables in both environment examples and the guide are:

| Variable | Implemented default |
|---|---:|
| `DYNAMIC_API_DISCOVERY_ENABLED` | `false` |
| `API_DISCOVERY_ALLOWED_HOSTS` | empty |
| `API_DISCOVERY_TIMEOUT_MS` | `5000` ms |
| `API_DISCOVERY_MAX_SPEC_BYTES` | `1048576` bytes |

The spelling is consistent; `API_DISCOVERY_MAX_SPEC_SIZE` is not used by the current
implementation.

## 11. SDK packaging and deployment — NOT VERIFIED AS AN INDEPENDENT PACKAGE

- `package.json` has no `exports` map and sets `main` to `backend/src/server.js`, which
  loads dotenv, starts a listener, and performs a provider health check. This is not a
  stable importable SDK API for a host application.
- The browser deliverable is an esbuild IIFE bundle that exposes a global SDK. The
  build script writes `widget/dist`, `public/sdk`, and `public/demo`.
- The Vercel configuration combines the static output and serverless API. The
  production host must deploy/configure the SDK backend, provider credentials,
  authentication, and application-specific backend registrations.
- The package version is `1.0.0`, but no package `engines` declaration or
  independently consumable backend integration exports were found.
- The documented Docker example uses a single process and in-memory sessions; it
  does not supply durable multi-instance session storage.
- No `npm pack`, clean-install, or consumer-package integration test was run.

A separate application can embed the generated script, but there is no verified
standalone package install/import contract. Treat this as a source-integrated
widget/backend deployment requiring application-specific code, not as an independently
distributable backend SDK.

## 12. Tests and build verification

### Tests executed

Command: `npm test`  
Configured expansion: `npm run test:mock`  
Files executed:

- `tests/auth-lifecycle.test.js`
- `tests/chat-stream.test.js`
- `tests/dynamic-api.test.js`

Result: **43 passed, 0 failed, 0 skipped**.

The tests use Supertest/in-process Express apps, mock provider implementations,
stubbed `fetch`, synthetic PDF input, and mocked HTTP/DNS request functions. No live
provider or application API was contacted during the test run.

Also executed: `git diff --check` — exit code 0. Git printed only line-ending
normalization warnings for existing modified files.

### Tests not executed / coverage gaps

- `npm run build` was not run because `widget/build.js` overwrites generated files in
  the repository. No build result is claimed.
- `npm run test:live` was not run. The script points to `tests/gemini-live.test.js`,
  which is absent from the current `tests/` directory, and live provider tests are
  outside this audit's allowed network scope.
- Only the three files named by the current mock script exist under `tests/`.
  `docs/setup.md` and README still list multiple test files that are absent from this
  checkout.
- Current tests do not establish application identity isolation, assistant-claim
  binding, route-scope enforcement, cross-assistant session rejection, package
  installation, or successful production bundling.
- The dynamic API tests mock HTTP and DNS behavior; they do not contact real hosts.

## 13. Build and Node compatibility — NOT VERIFIED

The build command is `node widget/build.js`; it emits ES2020-targeted IIFEs and copies
them into the Vercel public directory. It was not executed under the read-only rule.
`package.json` does not declare a Node engine range. Documentation mentions different
runtime baselines (README badge Node >=18, deployment Docker example Node 24).
Compatibility against a specific production Node runtime therefore remains
unverified by this audit.

## 14. Documentation completeness — VERIFIED WITH LIMITATIONS

- The Dynamic API guide documents opt-in behavior, defaults, ranges, allowlisting,
  authorization callbacks, credential callbacks, response projection, and production
  gates.
- The Level 3 guide documents the host adapter and host-side authorization boundary.
- Security/deployment docs appropriately call out wildcard CORS, host authorization,
  and in-memory session limitations.
- README and setup test inventories refer to test files absent from the current
  checkout. README also links to architecture/audit report files not present in the
  current root listing.
- The docs do not currently make the application-ID binding limitation or the
  Zod 4 tool-schema issue clear.

## 15. Confirmed defects

1. **BLOCKER:** Request authentication does not bind a verified JWT assistant claim to
   the body `assistantId`, and route scopes are not consistently enforced.
2. **BLOCKER:** Host application identity is not server-verified or used to select
   dynamic integrations; sessions are not bound to application or assistant.
3. **HIGH:** Zod 4.6.7 action schemas are converted using Zod 3 internals, yielding
   wrong types and required fields in native tool JSON schemas (verified with a local
   runtime probe).
4. **MEDIUM:** Native tool-name encoding is collision-prone for valid action names.
5. **MEDIUM:** Client-supplied connector credentials are forwarded to connector
   authorization callbacks without SDK-level binding to authenticated identity.
6. **MEDIUM:** Sessions are process-local and unsuitable for reliable multi-instance
   serverless conversation continuity.
7. **LOW:** Documentation and current test inventory are out of sync; `test:live`
   points to an absent test file.

## 16. Potential risks and unsupported capabilities

- Safe behavior depends on an operator not setting `AUTH_REQUIRED=false` in
  production, and on host callbacks independently enforcing authorization.
- Same-user application separation is not guaranteed by the SDK.
- No durable session backend, data-retention control, or multi-instance coordination
  is implemented.
- Gemini native function calling is unsupported by its adapter; action use relies on
  fenced text proposals.
- Dynamic discovery does not write, execute arbitrary methods, follow external
  references, support arbitrary OpenAPI serialization, or configure application auth
  automatically.
- No general application registry resolves browser application IDs to trusted server
  integration configuration.
- No production environment, deployed function, real provider, or real application
  endpoint was verified.

## 17. HirePool integration readiness — BLOCKER

- `ENABLE_HIREPOOL_INTEGRATION=true` registers four read-action definitions under
  assistant ID `hirepool`.
- Those definitions describe job search/details, current profile summary, and
  application listing, but this repository contains no verified HirePool API route,
  authenticated API client, OpenAPI specification, server-side executor, or
  tenant/ownership authorization callback for them.
- `backend/src/app.js` only registers the action definitions; it does not connect
  those definitions to HirePool APIs.
- The legacy HirePool action file includes write-oriented candidate/job definitions
  and is not registered by current startup. It has no verified live endpoint wiring
  here; it must not be enabled blindly.
- No HirePool API was contacted and no endpoint is claimed as verified.

Before implementation, HirePool must provide:

1. An authoritative OpenAPI specification or reviewed endpoint/method/schema
   documentation.
2. The existing authenticated API client/token propagation contract and token
   lifetime/refresh behavior.
3. Trusted application, user, tenant, role/scope claims and record-level
   authorization rules.
4. Approved initial read operations and field-level response allowlists, especially
   for candidate and application personal data.
5. A server-side integration registration and authorization/credential callback
   design, with application identity bound to a verified request.
6. A non-production test service or mocked contract for integration testing.

## 18. Prioritized remediation actions

1. **P0 — Identity and authorization binding:** Bind each request to a server-verified
   application/audience and assistant; enforce route scopes and production auth
   configuration. Reject unknown or mismatched assistant/application identities.
2. **P0 — Session isolation:** Include application and assistant identity in session
   ownership/lookup and use durable storage before multi-instance production use.
3. **P1 — Repair native tool schema generation:** Support the installed Zod 4 API or
   use an explicit schema conversion contract; add output tests for optional,
   numeric, boolean, enum, array, and object parameters.
4. **P1 — Make provider tool names injective:** Encode names with reversible escaping
   or reject collisions before sending tools to providers; test both.
5. **P1 — Credential provenance:** Remove or tightly define request-body connector
   credentials; bind user tokens to authenticated identity and use server-held
   credentials for service access.
6. **P1 — HirePool prerequisites:** Verify API spec/auth/ownership details and only
   then implement an application-specific backend adapter with minimal field
   projection.
7. **P2 — Package/build contract:** Define supported Node versions and public entry
   points; add a clean packaging/consumer test and a build validation that does not
   overwrite untracked developer artifacts.
8. **P2 — Test/documentation maintenance:** Restore/update test inventory, fix the
   missing live-test target or remove it, and add cross-app/session/auth coverage.
9. **P2 — Controlled Dynamic API evaluation:** Keep production disabled; use a
   non-production service with reviewed GET operations, explicit host allowlist,
   application-level authorization, and test credentials.

## 19. Final readiness decision

| Area | Assessment |
|---|---|
| SDK core | **NOT VERIFIED** for release: offline tests pass, but build was not run and auth/session isolation gaps remain. |
| Dynamic API Discovery | **VERIFIED WITH LIMITATIONS** as an opt-in implementation; not ready for general production multi-application use. No real integration is registered. |
| Multi-application integration | **BLOCKER** until authenticated application identity, action selection, and session separation are enforced. |
| HirePool integration | **BLOCKER** until API specification, auth contract, endpoints, ownership rules, and approved data projections are supplied and verified. |
| Deployment | **C — Not ready for deployment for the stated reusable multi-application production purpose until the P0 blockers are fixed.** |

This is a source and offline-test audit, not a production verification. It does not
claim that a live deployment is currently fixed, safe, or compatible.

## 20. Audit safety checks

- Source, test, package, environment, production, and deployment files were not edited.
- Only the requested audit report was created.
- Existing modified and untracked worktree content was preserved.
- Local `.env` files were not read; no secret values are included in this report.
- `npm test` executed only the configured mock suite; no live provider or application
  API was contacted.
- The build was not run because its script writes generated project files.
- No deployment, commit, push, production configuration change, or Dynamic API
  Discovery enablement occurred.
