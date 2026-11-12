# HirePool SDK Integration — Complete Implementation Audit

**Audit scope:** Read-only source review of `D:\ai-assistant-plugin` and
`D:\talenthub-develop`, plus the SDK's mock test suite.  
**SDK branch:** `main`  
**HirePool repository note:** The supplied HirePool root has no Git metadata, so a
HirePool source diff could not be established.  
**Conclusion:** **Local-only integration code exists, but end-to-end integration is
not verified and the implementation does not meet the intended application-context
and dashboard/public-site behavior consistently. Production readiness is not
established.**

## 1. Executive conclusion

The SDK has a gated local HirePool bridge, a browser extension for guest login
continuation, and eight server-side, role-specific GET tools. The bridge validates
HirePool credentials against existing identity and membership APIs and then calls
HirePool business APIs using that same access token. It does not access the database
directly, and the model does not choose an API host or method.

The code is intentionally unavailable in production. The available tests use
fixtures, mocked provider calls, mocked identity responses, or injected HTTP
request functions. They do not prove a real HirePool login, business API execution,
or user-facing Gemini turn.

**Readiness:** suitable only for carefully controlled localhost testing of the
implemented read-only path. Not ready for a production rollout or for claims that
the requested full integration is complete.

## 2. Scope and evidence

This audit followed the current repository source, package scripts, existing tests,
environment examples, selected HirePool route implementations, and active widget
mounts. Existing reports and guides were treated as claims to verify, not as proof.
No source or test was edited. No HirePool business API, live AI provider, deployment,
or production environment was contacted.

## 3. Initial SDK repository state

The SDK repository root is `D:\ai-assistant-plugin`, branch `main`. The worktree was
already substantially dirty. These paths were present as modified or untracked before
this audit; they are existing user work and were preserved.

Modified:

- `.env.example`, `README.md`, `backend/.env.example`
- `backend/src/actions/tool-converter.js`, `backend/src/app.js`,
  `backend/src/middleware/auth.js`, `backend/src/middleware/security.js`,
  `backend/src/providers/gemini.js`, `backend/src/routes/chat.js`,
  `backend/src/routes/documents.js`, `backend/src/routes/sessions.js`,
  `backend/src/session-manager.js`
- `config/defaults.js`
- `docs/configuration.md`, `docs/deployment.md`, `docs/security.md`,
  `docs/setup.md`
- `package-lock.json`, `package.json`
- `public/sdk/assistant.js`, `public/sdk/assistant.js.map`,
  `public/sdk/assistant.min.js`
- `tests/auth-lifecycle.test.js`, `tests/chat-stream.test.js`
- `widget/src/api-client.js`, `widget/src/integration.js`, `widget/src/sdk.js`,
  `widget/src/widget.js`

Untracked:

- Reports: `DYNAMIC_API_DISCOVERY_IMPLEMENTATION_REPORT.md`,
  `DYNAMIC_API_DISCOVERY_REMEDIATION_REPORT.md`,
  `REVISED_HIREPOOL_ASSISTANT_REQUIREMENTS_GAP_ANALYSIS.md`,
  `SDK_COMPLETE_READINESS_AUDIT.md`,
  `SDK_DYNAMIC_API_DISCOVERY_AND_TOOL_GENERATION_AUDIT.md`,
  `SDK_HIREPOOL_FINAL_INTEGRATION_REPORT.md`,
  `SDK_HIREPOOL_LOCAL_E2E_INTEGRATION_REPORT.md`,
  `SDK_HIREPOOL_WEBSITE_ONLY_AUTH_IMPLEMENTATION_REPORT.md`
- `backend/src/dynamic-api/`, `backend/src/local-integrations/`,
  `backend/src/session-scope.js`
- `config/hirepool-site-policy.js`
- `docs/dynamic-api-discovery.md`, `docs/hirepool-openapi-inventory.json`,
  `docs/hirepool-sdk-integration.md`
- `extension/`
- `integrations/hirepool/dynamic-integration.example.json`,
  `integrations/hirepool/local-development.js`
- `scripts/`, `tests/dynamic-api.test.js`, `tests/fixtures/`,
  `tests/local-hirepool.test.js`

This report is the only file created by this audit.

## 4. HirePool repository state

`D:\talenthub-develop` contains the website, dashboard frontend, and backend source
reviewed below. The repository root has no `.git` metadata, so no complete tracked
or untracked-file diff is available. The only observed dashboard/public-site source
mounts relevant to this integration are the paths named in Sections 6 and 7. No
HirePool file was changed.

## 5. SDK request and action architecture

The widget sends chat requests to the SDK's `/api/chat` or `/api/chat/stream` API.
The backend authenticates the SDK credential, resolves a session scoped by
assistant/application/user, builds an action registry, and invokes the configured
AI provider with registered tools.

For dynamic HirePool tools, the SDK fetches the configured local OpenAPI document,
creates request-local actions from server allowlists, and executes a selected GET
through the SDK backend. Returned data is projected through per-operation field
allowlists before it is returned to the model. This is a server-side API bridge,
not a client-side HirePool API-client invocation.

## 6. Public website mount

The Next.js root layout renders `website/components/LocalAssistantWidget.tsx`.
That component loads the SDK only on `localhost` and `127.0.0.1`; production
website domains do not load this local SDK. The SDK and extension further restrict
the HirePool assistant to approved local public-site paths:

`/`, `/features`, `/enterprise`, `/pricing`, `/partners`, `/women`, `/terms`,
`/privacy`, and `/contact`.

The public website widget initially runs as a guest. The Chrome extension injects
the page entry on the approved local website origins, attaches the host integration,
and handles a confirmed login continuation. No live browser verification was
performed in this audit.

## 7. Dashboard mount conflict

The HirePool dashboard's shared `frontend/src/components/layout/AppLayout.tsx`
renders `HirePoolAssistant` unconditionally. That component is otherwise gated to
local Vite development and localhost origins, but its SDK initialization uses
`assistantId: "hirepool"`.

The current SDK checks the exact public-site policy before obtaining a session
scope; `localhost:5173` is not an allowed public-site origin, so SDK initialization
fails before the dashboard component can complete its authenticated bridge flow.
The backend also rejects dashboard-origin requests to `/api/hirepool/*`. The
extension has no content-script match for port 5173.

Therefore the dashboard component is mounted in source but the current policy
prevents it from functioning. Documentation that says the authenticated dashboard
widget works is inconsistent with current source. If the intended product is
public-site-only, the remaining dashboard mount is also misleading dead integration
code and should be removed in a separately authorized change.

## 8. Host adapter contract and application context

The generic version-1 `HostIntegrationAdapter` supports context, authentication
headers, identity, permissions, permission callbacks, action execution, and session
scope. The HirePool extension currently supplies application ID/name, auth headers,
session scope, and an executor for the guest login action only. It does not supply
a `contextProvider`, selected entity, `getIdentity`, `getPermissions`,
`canExecuteAction`, or available-action provider.

The public website mount also initializes the SDK without an application context.
Consequently, current-page context and selected job/candidate/application context
are not made available to the assistant. The backend derives a trusted principal
from the opaque SDK credential, but this is not the same as the host adapter
providing user-facing identity or page context.

## 9. Authentication flow

For the local public-site flow, the extension only observes selected GET identity
or profile requests from the configured dashboard login origin while a login
continuation is pending. It extracts the existing bearer access token and sends it
to the local SDK bridge. It does not read the HirePool response body, password,
refresh token, or dashboard `localStorage`.

The SDK backend validates the access token using HirePool `/api/v1/auth/me`.
For client and consultancy identities it additionally calls
`/api/v1/clients/me` or `/api/v1/consultancies/me` to verify the account-type role.
The raw host access token is retained only in short-lived SDK backend memory; the
browser receives an opaque SDK credential and a random session-scope value. Business
API calls use the retained host access token in a server-side Authorization header.

The separate dashboard widget reads the existing access token via
`getStoredAccessToken()` from the frontend's existing token storage, but the
dashboard origin is currently rejected before its integration can finish.

## 10. Authorization, tenant, and ownership boundaries

The bridge accepts only candidate, client, and consultancy user types, requires an
active account, and applies explicit client/consultancy membership-role allowlists.
It does not accept a browser-supplied role as authoritative. The principal is bound
to the fixed local assistant/application IDs and an opaque server-side session.

The selected HirePool routes apply their own existing dependencies and data scopes:

- Candidate profile and `/applications/my-applications` require candidate identity;
  profile lookup is by authenticated user ID, and applications are filtered to that
  candidate's profile.
- `/jobs/search` is public and filters to active jobs and active client accounts.
- Client `/me`, dashboard, and `/jobs/my-jobs` require client identity; the jobs
  route scopes results through the current user's client-team membership.
- Consultancy `/me` and `/placements/stats` require consultancy identity and
  calculate counts against the current consultancy membership.

The SDK repeats server-side integration authorization and role-operation checks
before discovery and execution. HirePool backend authorization remains authoritative
when the forwarded bearer token reaches each business endpoint.

## 11. Registered HirePool operations

`integrations/hirepool/local-development.js` registers eight explicitly named GET
operations, subject to local development flags:

| HirePool role | Registered operations |
|---|---|
| Candidate | `GET /api/v1/candidates/profile`, `GET /api/v1/jobs/search`, `GET /api/v1/applications/my-applications` |
| Client | `GET /api/v1/clients/me`, `GET /api/v1/clients/dashboard`, `GET /api/v1/jobs/my-jobs` |
| Consultancy | `GET /api/v1/consultancies/me`, `GET /api/v1/consultancies/placements/stats` |

This set is role-filtered and contains no write operations. It does **not** include
authorized job details by ID, even though a job-details read was part of the desired
initial action set. Client and consultancy users also do not receive the public job
search action.

## 12. Data minimization and projections

The local integration selects response fields per operation and enforces a response
byte limit and projected-result byte limit. Candidate profile projection includes
job title, location, skills, years of experience, and open-to-work status; it
excludes phone, email, resume URL, and names. Job search returns a small selection
of listing fields. Application listing includes status, job title, company name,
and creation time, not candidate ID or resume details. Client/consultancy profiles
are projected to full name and role; client dashboard and consultancy placements
are reduced to counts.

Candidate results are nevertheless personal data, and the selected fields are sent
to the configured AI provider during tool-result follow-up. No HirePool-specific
privacy notice or data-sharing consent flow was verified. Application-level privacy
approval is needed before any non-local use.

## 13. Unsupported HirePool workflows

The current action allowlist does not expose:

- job-detail retrieval by identifier;
- candidate search or third-party applicant profiles;
- detailed application records for clients/consultancies;
- assessments or screening start/submit actions;
- consultancy candidate creation, bulk upload, or resume parsing;
- candidate or consultancy resume upload/download;
- interview scheduling or AI interview workflows;
- any write or destructive operation.

Relevant backend routes do exist, including candidate resume upload, consultancy
candidate creation and resume parsing, screening, and interview APIs. Their existence
does not make them supported SDK actions. They were not registered and were not
called. Upload/parse paths involve candidate personal information and require
separate schema, consent, authorization, confirmation, and data-retention review.

## 14. Legacy static action definitions

`integrations/hirepool/actions.js` defines four static action proposals (job search,
job view, candidate profile, and candidate applications) and registers them only
when `ENABLE_HIREPOOL_INTEGRATION=true`. The environment example defaults this flag
to false.

These definitions are not proof of working API execution: they have no dynamic API
metadata or HirePool backend executor in that file. The current extension executor
handles only `hirepool_begin_login`; other host-executed actions are rejected.
Do not enable the legacy flag for real HirePool use until its dispatch path is
verified.

## 15. Confirmation and action execution

Guest login continuation is represented as a `hirepool_begin_login` action and is
marked as requiring confirmation. The extension opens the existing login page only
after the user confirms the action. The continuation is random, single-use, expires
after ten minutes, and resumes the original prompt in the same conversation after
the bridge validates the identity.

Registered business GET actions have read risk and do not require user confirmation;
they execute server-side when selected by the model. No write operation is
registered, so a write-confirmation flow is not covered by this integration's
tests. The version-1 host permission callback is not wired for these dynamic
server-side reads.

## 16. Session and continuation lifecycle

The SDK holds opaque-credential mappings and raw HirePool access tokens in
in-memory maps with a five-minute TTL. Continuation references are stored by digest,
are single-use, expire after ten minutes, and have a bounded store size. Conversation
sessions are scoped by assistant, application, user, and tenant values; an
authenticated user may bind a guest conversation during continuation consume.

This design is process-local: backend restart loses the in-memory token association,
opaque session, continuation, and SDK conversation. Multi-process deployments would
not share these maps. The implementation is therefore unsuitable as a production
session bridge without an explicitly designed shared storage and revocation model.

## 17. Network and production gates

Dynamic discovery requires `DYNAMIC_API_DISCOVERY_ENABLED=true` and is disabled
when `NODE_ENV` or `VERCEL_ENV` is production. The HirePool bridge additionally
requires `NODE_ENV=development`, `ENABLE_HIREPOOL_LOCAL_BRIDGE=true`, and the
discovery flag. Its configured API/spec origins are constrained to
`http://localhost:8000/`; the SDK pins local requests to loopback and does not
follow redirects. The model cannot select the API base URL or HTTP method.

The local integration requires the exact extension or approved local public-site
origins and rejects dashboard bridge origins. Response size, timeout, DNS/address
validation, and operation allowlisting are enforced by the dynamic API layer.
Production enablement was not tested against a deployed service; source gates and
default-off examples are not equivalent to a deployment audit.

## 18. Test and build evidence

Executed `npm test`, which runs `npm run test:mock`:

- `tests/auth-lifecycle.test.js`
- `tests/chat-stream.test.js`
- `tests/dynamic-api.test.js`
- `tests/local-hirepool.test.js`

**Result:** 63 tests passed, 0 failed, 0 skipped. The HirePool tests cover local
feature gates, URL/host restrictions, extension/public-site policy, mocked identity
and membership validation, role-specific tool generation, response projection,
wrong-role rejection, origin rejection, confirmed guest login, and single-use
continuation/session binding. API execution is injected/mocked. No real HirePool
business API or Gemini call was made.

`git diff --check` passed with existing Windows line-ending warnings. SDK,
HirePool frontend, and website builds were not run. The SDK build script rewrites
generated public SDK assets that were already dirty; the HirePool frontend and
website build outputs would also change files outside the one-report-only audit
scope. The HirePool package scripts expose build/lint but no test script; the
website package scripts likewise expose build/lint but no test script.

## 19. Documentation and historical-report discrepancies

The current `docs/hirepool-sdk-integration.md` describes an authenticated dashboard
widget, but that flow is blocked by the current SDK public-site origin check and
backend dashboard-origin rejection. Existing reports also conflict: one reports a
dashboard mount and candidate lookup as verified, while a later website-only report
says dashboard access is excluded and no authenticated live E2E was run. Current
source and this audit's tests do not establish dashboard operation or a real
business API flow.

The saved OpenAPI inventory and prior counts describe an inventory and parser/test
review, not live API support. The current code supports only the eight operations
in Section 11. Claims in older reports about live result content or production
readiness should not be carried forward without fresh browser and API evidence.

## 20. Final readiness and safety checklist

- **SDK implementation present:** Yes, local-only bridge and eight read tools.
- **Host application context / selected entity context:** Not wired.
- **Existing HirePool authentication used:** Yes; token is verified and forwarded
  server-side, but the separate dashboard mount cannot currently complete.
- **Backend authorization bypassed:** No bypass was found; selected APIs receive
  the verified user's existing bearer token.
- **Job detail action:** Missing.
- **Writes:** None registered.
- **Production status:** Disabled by source gates; production configuration was not
  inspected or changed.
- **Live HirePool / Gemini verification:** Not performed.
- **Controlled testing:** Appropriate only for isolated localhost testing with
  dedicated test accounts and read-only registered actions, after choosing the
  intended public-site versus dashboard surface. Do not treat mock tests as E2E
  proof or enable this in production.
- **Audit modifications:** This report only; no source, test, configuration, or
  HirePool files changed.
- **Deployment / commit / push:** None.

**Overall:** The implementation is a promising local prototype, not a complete,
verified HirePool integration. Resolve the product-surface contradiction, wire the
required host context and missing desired read action, update the integration guide,
and perform controlled live browser/API verification before considering broader
testing or deployment.
