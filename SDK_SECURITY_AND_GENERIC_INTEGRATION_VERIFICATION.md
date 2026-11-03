# SDK Security and Generic Integration Verification

## 1. Executive summary

This is a focused source-code review of document consent, route authentication and session ownership, connector/action authorization, document lifecycle, and integration reusability. The review did not use live services or credentials.

Five confirmed issues were fixed during verification:

1. Request-controlled host context was inserted into a system instruction without escaping XML-like delimiters. Context is now escaped, with a regression test.
2. Cross-origin SDK document uploads and deletion could fail CORS preflight because the consent headers and `DELETE` method were not allowed. The middleware and a preflight regression test now include them.

A third confirmed identity-isolation weakness was fixed: JWTs without a stable user identity were assigned the same synthetic user ID. Authentication now rejects those tokens, with a regression test.

Two additional confirmed issues were fixed during follow-up: the broad preview-origin exception and production wildcard configuration were removed, and the mock connector was excluded from production. The later universal integration policy supersedes the exact-origin CORS restriction: API CORS is now `*` without credential support, while backend authentication remains independent.

Escaping prevents delimiter breakout; it does not eliminate semantic prompt injection in untrusted context. Model output remains untrusted and action/API authorization must remain independent.

The generic action registry starts empty and HirePool's new actions are opt-in. Production auth is required by default in source. Remaining caveats include guest sessions being capability-ID based, API-key mode sharing one service identity, optional tenant claims, and HirePool-specific startup wiring in the SDK app. None of the source verification constitutes live deployment or browser verification.

## 2. Consent workflow

| Check | Status | Source and verification |
|---|---|---|
| Consent is unchecked initially and disclosed before processing | **PASS** | `widget/src/widget.js` renders the checkbox without `checked`, with Continue disabled, before calling the upload handler. The disclosure distinguishes SDK-backend processing from host-handler processing. |
| Accepting is explicit; declining prevents processing | **PASS** | Continue is enabled only on a checked state and re-checks `checkbox.checked` before `_processFileUpload`. Cancel replaces the notice with a not-sent message and emits rejection. |
| Consent is requested for each file | **PASS** | The consent panel is created for each selected upload; acceptance is not persisted as a blanket opt-in. |
| SDK upload requires acceptance and sends versioned assertions | **PASS** | `widget/src/api-client.js` rejects unless `options.consentAccepted === true`, and sends accepted/version fields in multipart data and headers. |
| Backend validates consent before upload parsing | **PASS, assertion only** | `backend/src/routes/documents.js` checks exact header values before Multer, then checks matching multipart/body values before base64 decoding and `parseDocument`. The current version is `1` in `config/document-upload.js`. |
| Consent is scoped to the uploaded document/session | **PASS, limited** | On attachment, each document stores consent version and server timestamp in its session metadata. No reusable consent grant is stored. The timestamp is when the server accepted the assertion, not proof of a user's action. |
| Extracted content is withheld from upload response | **PASS** | The response includes document metadata, not extracted text. Text is stored server-side in the session. |
| Consent is independently proven by the backend | **NOT IMPLEMENTED / NOT POSSIBLE WITH THIS ASSERTION** | A direct caller can send the same headers and body fields. They enforce the SDK workflow and notice version but cannot prove a human saw or accepted it. Do not treat them as cryptographic evidence or authorization. |

**Consent vs. proof:** the checkbox records a user-interface decision, and the request assertions let the backend reject requests that do not follow the expected current-version protocol. Because the client controls those values, the backend cannot independently verify that a person clicked the checkbox. Hosts must provide appropriate privacy notices and policy enforcement separately.

The cross-origin behavior issue was fixed in `backend/src/middleware/security.js`: CORS now allows `X-Document-Processing-Consent`, `X-Document-Consent-Version`, and `DELETE`. This preserves browser upload, individual document removal, and session deletion from permitted origins.

## 3. Authentication matrix

Production behavior below is based on source defaults and route wiring, not deployed environment inspection. `authenticate()` requires credentials when `NODE_ENV=production` regardless of `AUTH_REQUIRED=false`; explicitly selecting `AUTH_MODE=none` while auth is required returns a configuration error. JWT signatures and API keys are validated server-side.

| Route | Authentication status | Ownership/authorization |
|---|---|---|
| `GET /api/health` | **Public by design** | Returns provider health and session-count telemetry. |
| `GET /api/config/:assistantId` | **Public by design** | Public configuration omits server-only system instructions. |
| `POST /api/chat`, `POST /api/chat/stream` | **Required in production; optional in development** | Session user and tenant are derived from `req.user`; `getOrCreate`, context, documents, and message operations use those options. |
| `POST /api/summarize` | **Required in production; optional in development** | Does not access conversation sessions. |
| `POST /api/sessions/clear` | **Required in production; optional in development** | Authenticated user/tenant passed to session manager; bound sessions reject mismatches. |
| `DELETE /api/sessions/:conversationId` | **Required in production; optional in development** | Authenticated user/tenant passed to `destroy`; bound sessions reject mismatches. |
| `GET /api/connectors` | **Required in production; optional in development** | Lists connector metadata; no user-specific record authorization. |
| `POST /api/connectors/execute` | **Required in production; optional in development** | Checks connector/action registration and calls connector-owned server-side authorization. Supplied `authToken` is only an input to that validation; it is not generically trusted as authorization. |
| `POST /api/documents/upload` | **Required in production; optional in development** | Existing session ownership checked before attachment; new sessions bind to authenticated principal where present. |
| `GET /api/documents/:conversationId` | **Required in production; optional in development** | Ownership and tenant options passed to manager. |
| `DELETE /api/documents/:conversationId/:documentId` | **Required in production; optional in development** | Ownership and tenant options passed to manager. |
| `DELETE /api/documents/:conversationId` | **Required in production; optional in development** | Ownership and tenant options passed to manager. |

Source references: `backend/src/middleware/auth.js`, `backend/src/app.js`, `backend/src/routes/{chat,summarize,sessions,connectors,documents,health,config}.js`.

### Identity and tenant caveats

- **Stable JWT identity — fixed.** Previously, a valid JWT lacking `sub`, `userId`, and `id` mapped to the shared `authenticated_user` principal, allowing unrelated such tokens to collide for session ownership. It now fails with `401 INVALID_TOKEN`; `tests/auth.test.js` covers it.
- **Tenant is optional.** Session manager rejects a mismatch and rejects access to a tenant-bound session without the matching tenant claim. It does not require every authenticated principal to have a tenant. Applications requiring tenant-scoped sessions must enforce that claim at the API boundary.
- **API-key mode is a shared service identity.** Requests using the configured API key map to `service_principal`; this authenticates a service, not an individual end user. It cannot provide per-user session isolation without an additional trusted identity mechanism.
- **Guest sessions are capability-ID based.** An unowned session can be accessed by anyone who knows its conversation ID and can be bound to the first authenticated user who accesses it. This is acceptable only for anonymous use where IDs are treated as bearer capabilities; do not expose/share them unintentionally.
- The review verified the `NODE_ENV=production` code path, not whether a deployment actually sets production mode, the correct JWT secret, issuer/audience, or expected claims.

## 4. Session ownership and isolation

| Check | Status | Explanation |
|---|---|---|
| Cross-user access to a user-bound session | **PASS** | `SessionManager.validateOwnership` compares authenticated user ID and throws `403 SESSION_ACCESS_DENIED` on mismatch. |
| Cross-tenant access to a tenant-bound session | **PASS where a tenant is bound** | Mismatched or missing tenant claims are rejected for tenant-bound sessions. Tenant claims are not universally required. |
| Chat and streaming chat use ownership checks | **PASS** | Both endpoints derive identity from verified credentials and pass it to session creation/context/document operations. |
| Upload into an existing other-user session | **PASS** | Upload passes authenticated identity to `getOrCreate` and `addDocument`; ownership is checked before attachment. |
| Clear or delete another user's session | **PASS** | Clear/destroy use manager ownership validation. |
| Clear/remove another user's document | **PASS** | Document list/remove/clear operations pass the authenticated identity to the manager. |
| Unowned guest session protected from ID disclosure | **PARTIAL** | There is no owner until first authenticated use. Possession of the ID grants access. |

## 5. Connector authorization

- **Generic `ActionRegistry`: PASS.** The singleton and newly created assistant registries start empty. `ActionRegistry` accepts explicit action definitions and rejects the removed automatic-default option.
- **HirePool action registration: PASS.** The new read-only HirePool definitions are registered on the isolated `hirepool` registry only when `ENABLE_HIREPOOL_INTEGRATION=true`. Legacy HirePool write definitions are in `integrations/hirepool/legacy-actions.js` and are not loaded by this new registration path.
- **Unregistered model actions: PASS.** Proposals are validated against the active registry; native tools are generated from registered definitions; unknown names are not dispatched as connector calls.
- **Client identity: PASS.** Backend identity, tenant, role, and scopes come from verified credentials, not request-body identity fields. Browser host context and role callbacks remain UX/context only.
- **Connector endpoint: PARTIAL.** `/api/connectors/execute` validates connector existence and supported action, then delegates authorization to that connector. The direct endpoint does not itself enforce the chat ActionRegistry's `permissions` or parameter schema; connector implementations must do their own server-side validation and authorization.
- **Client `authToken`: PARTIAL / connector-specific.** The route accepts an `authToken` from the client but passes it to `validateAuthorization`; it does not treat the mere presence of that token as proof. `MockConnector` contains a public demo token and returns mock data only. Do not use it as a production connector or real-data authorization model.
- **Host application authorization: PASS by source inspection.** HirePool adapter executes through HirePool's existing authenticated API client. HirePool APIs enforce active-job visibility, client-team access for non-active job details, candidate-only profile access, and current-candidate application filtering. Adapter role checks are UX only.
- **Write actions: PASS for this HirePool integration.** The new HirePool registry contains only read actions. Legacy write definitions remain explicit opt-in compatibility code; no write actions were added or enabled by the new integration.
- **Residual generic-core coupling: PARTIAL.** `backend/src/app.js` imports HirePool action registration directly and uses a HirePool-specific feature flag. The adapter package is application-specific as intended, but the SDK app startup is not fully application-neutral.

## 6. Document lifecycle

| Lifecycle step | Status | Source verification |
|---|---|---|
| Upload buffering and size | **PASS** | Multer uses memory storage and enforces a 10 MiB limit. JSON requests also have the Express body limit. No disk temporary files are created by this pipeline. |
| Type validation and parsing | **PASS with limitation** | Parser detects supported extensions/MIME/magic bytes, rejects unsupported formats, and maps corrupt/empty documents to errors. Extension/MIME detection is not a malware scan or OCR system. |
| Temporary attachment | **PASS** | Extracted text and metadata are placed in a process-local session `Map`; response returns metadata only. |
| Session expiration | **PASS in process memory** | TTL access checks and periodic cleanup remove the session and its document references. Expired IDs are temporarily tombstoned to avoid silent restoration. |
| Individual document deletion | **PASS in process memory** | Document is removed from the session's documents array; client metadata is removed after successful request. |
| Clear session | **PASS** | Clears messages, documents, and context while retaining the ID. |
| Destroy session | **PASS** | Removes the complete in-memory session. |
| Persistence/retention guarantees | **NOT PROVIDED** | State is process-local; restart, serverless instance changes, and horizontal scaling can lose session data. Array removal is not a secure-memory-erasure or persistent-store deletion guarantee. |
| Provider data flow | **PASS as documented** | Attached document text is included in bounded system context for chat and therefore sent to the configured provider on subsequent questions. Document text is framed as untrusted and bounded; no embeddings or permanent store are used. |

The upload path checks for a disconnected request before attaching a parsed document. Cancellation after server attachment removes the returned document when possible, but a network loss after attachment and before response can leave the temporary document until session cleanup.

## 7. Generic integration readiness

| Capability | Status | Notes |
|---|---|---|
| Script-tag initialization | **PASS** | SDK bundle supports autoload/data attributes and can infer backend origin from its script URL. |
| Programmatic initialization | **PASS** | `AssistantSDK.init()` accepts public UI configuration, an API URL, document options, context, and optional version-1 host adapter. |
| Public widget configuration | **PASS** | Theme, position, greeting, name, prompts, and features merge server public config with runtime overrides. |
| Host identity/context | **PASS with trust boundary** | Adapter returns current structured context and optional identity/permissions/action metadata. These browser values are not backend authorization. |
| Backend auth contract | **PASS with deployment dependency** | Host supplies validated request headers (e.g. short-lived bearer token); backend verifies token claims. Live secret/issuer/audience alignment was not tested. |
| Session lifecycle | **PASS with deployment limitation** | SDK supports clear/new session; server offers clear, destroy, and temporary TTL. Storage is in-memory server-side. |
| Provider configuration | **PASS by source** | Explicit provider selection and credential-driven providers; no implicit mock fallback; mock disabled in production. Provider connectivity not tested live. |
| Action proposal interface | **PASS** | Registered definitions, validated proposals, risk/confirmation UX, and connector dispatch are distinct. |
| Host-controlled execution | **PASS** | Confirmed host actions route to adapter executor; backend does not execute host actions. Host API remains authoritative. |
| Cleanup/destroy | **PASS with UX note** | `destroy()` unmounts widget, clears SDK event hooks and references, and resets initialization. Host integrations should call it on unmount. |
| HirePool-specific assumptions in core | **PARTIAL** | App startup directly imports HirePool registration; HirePool legacy actions remain in integration package. Generic registry itself is domain-neutral. |

`AssistantSDK.init()` currently catches public-config fetch errors and uses fallback widget defaults. This does not bypass backend auth for protected operations, but can hide a configuration/network failure from integrators; initialization readiness should not be mistaken for backend availability.

## 8. Verified findings

1. The source requires the current versioned consent assertion before extraction and does not return extracted text to the browser.
2. Production route authentication defaults to required and validates JWT/API-key credentials on the server.
3. Bound session user and tenant ownership checks are applied across chat, upload, document, clear, and destroy operations.
4. Generic action definitions are explicit; the new HirePool action set contains only reads.
5. Document/session state is temporary process memory, with TTL cleanup and clear/delete operations.
6. Document text is passed to the configured AI provider on later chat turns; its use is not limited to local parsing.
7. Host adapter role/permission checks are not backend authorization; HirePool API endpoints provide the authoritative record-level boundary.
8. No live provider, backend service, or browser interaction was performed as part of this verification.

## 9. Confirmed issues and dispositions

| Finding | Status | Source | Impact | Action |
|---|---|---|---|---|
| Host context prompt-boundary injection | **FIXED** | `backend/src/routes/chat.js`; regression in `tests/context.test.js` | Raw `</host_application_context>` could escape the labeled untrusted context block and influence model instructions/action selection. | Escaped XML metacharacters using the existing prompt-escaping helper. |
| CORS omitted document consent headers and `DELETE` | **FIXED** | `backend/src/middleware/security.js`; regression in `tests/security.test.js` | Cross-origin SDK uploads/deletion could fail preflight for permitted origins. | Added exact SDK consent headers and `DELETE`; tested preflight. |
| JWTs without stable subject shared a synthetic principal | **FIXED** | `backend/src/middleware/auth.js`; regression in `tests/auth.test.js` | Separate valid tokens without recognized identity claims could share session ownership and access one another's bound sessions. | Rejects tokens without non-empty `sub`, `userId`, or `id`. |
| Guest sessions have bearer-ID semantics | **PARTIAL / ACCEPTED LIMITATION** | `backend/src/session-manager.js` | Anyone knowing an unowned session ID can access/claim it. | Do not expose IDs; disable anonymous access for sensitive deployments or add an explicit guest-session policy. |
| API-key mode has one shared service identity | **PARTIAL / MODE LIMITATION** | `backend/src/middleware/auth.js` | It cannot isolate sessions per end user. | Use JWT user identities for user-facing sessions; keep API keys for service-to-service use. |
| CORS origin policy was restrictive/implicitly permissive | **SUPERSEDED BY UNIVERSAL CORS POLICY** | `backend/src/middleware/security.js`, `vercel.json`; regression in `tests/security.test.js` | The SDK is intended to be embeddable from arbitrary sites. | The API now returns wildcard CORS without credential support; authentication and authorization remain independent. Vercel has no overlapping API CORS headers. |
| Mock connector is registered in production | **FIXED** | `connectors/registry.js`; regression in `tests/connectors.test.js` | Mock actions and their demo authorization behavior were exposed through connector APIs in production. | The connector registry no longer registers the mock connector when `NODE_ENV=production`. |
| SDK app startup imports HirePool directly | **PARTIAL / ARCHITECTURAL COUPLING** | `backend/src/app.js` | Generic app entrypoint has an app-specific registration import and flag. | Keep behavior opt-in; consider moving integration bootstrapping to host-owned initialization before supporting more products. |

No HirePool write action was added.

## 10. Tests run

Executed in this verification:

```text
node --test tests/context.test.js tests/security.test.js tests/auth.test.js tests/document-pipeline.test.js
80 passed, 0 failed

node --test tests/action-protocol.test.js tests/connectors.test.js tests/hirepool-actions.test.js tests/integration.test.js
58 passed, 0 failed
```

This is local automated test evidence: 138 test cases passed across the two focused runs. The context/CORS/JWT regression tests exercise the modified source; document-pipeline tests exercise parser/session behavior using local fixtures and mocks.

Previously reported checks (not rerun as part of this focused verification) include 211 SDK mock tests, SDK build, HirePool adapter tests (mock API), HirePool frontend build, and 13 backend tests using a fake database for job-detail access.

After the follow-up CORS and mock-connector changes, the focused rerun
`node --test tests/security.test.js tests/connectors.test.js tests/vercel-entry.test.js`
passed **42 tests, 0 failed**.

## 11. Unverified behavior

- Live HirePool JWT signature/claim and SDK backend secret alignment.
- Live HirePool API authorization or provider behavior.
- Actual browser CORS, upload, token-refresh, and document deletion flow after the middleware fix.
- PDF worker availability in the deployed serverless runtime.
- Production environment values, issuer/audience, origin policy, and whether the deployment sets `NODE_ENV=production`.
- Real-world consent UX comprehension and legal sufficiency.
- Cross-process durability/cleanup; no persistent session store exists.

## 12. Recommended next steps

1. Configure each deployment with production mode, required JWT auth, matching server-side verification settings, and exact allowed origins.
2. Use bearer/API-key headers for cross-origin authentication; wildcard CORS does not permit cross-origin cookies.
3. Use stable user IDs and required tenant claims for every authenticated host that uses tenant-isolated sessions.
4. Run browser verification against deployed HirePool and SDK services, including CORS preflight, refresh, ownership denial, upload consent, deletion, and PDF extraction.
5. Establish host-approved retention/deletion policy before sending sensitive documents to an external provider.
