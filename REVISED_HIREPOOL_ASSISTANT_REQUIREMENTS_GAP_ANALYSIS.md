# Revised HirePool Assistant Requirements — Gap Analysis

**Status:** Audit complete; no implementation changes authorized or made.  
**Conclusion:** The revised requirements are not met. The current integration is a local-development prototype with a guest website widget and a separate authenticated dashboard widget. It has no production website deployment path, no login/return continuation, and only eight configured read-only tools.

## 1. Executive summary

The desired product is a single assistant on the main public HirePool website that can continue through login and safely support candidate, client, and consultancy workflows. The current implementation does not provide that architecture:

1. **Visibility is wrong in local development.** The guest widget is in the website root layout, but the authenticated assistant is also mounted in the shared dashboard `AppLayout`. The latter makes it visible on candidate, client, and consultancy dashboard routes. The Admin app has no corresponding mount.
2. **Neither public production nor authenticated production is wired.** Both UI loaders are development/local-host gated. The main website component loads only on `localhost`/`127.0.0.1`; it does not load on the production hostname. The SDK bridge and API discovery are also explicitly development-only.
3. **A source-free production mount is an unresolved blocker.** The SDK serves a script but cannot make an external website load it by itself. No approved tag-manager, edge/reverse-proxy injection, or other deployment-time insertion mechanism was verified. The previously removed Chrome extension is not an active solution and should not be assumed.
4. **There is no website-to-login-to-website continuation.** The website widget has no identity bridge. The authenticated dashboard widget can exchange a dashboard access token for an opaque SDK credential, but the website and dashboard are different origins and cannot share browser storage. The existing dashboard login completes by navigating to a role dashboard; it does not resume a saved external-site assistant action.
5. **Current API capabilities are deliberately read-only.** Eight role-scoped tools are statically configured. The dynamic API catalog rejects non-GET operations; it does not execute JSON request bodies or HirePool multipart uploads. Job application, job creation, agency candidate creation, and assessment submission are therefore not assistant capabilities today.
6. **The backend has relevant APIs, but writes require careful workflow design.** HirePool has role and ownership checks for important operations. Some GETs are not side-effect-free (job detail increments the view counter); public assessment endpoints use a secret token as a bearer capability; agency candidate creation accepts `candidate_consent=false` by default; and upload endpoints have significant size/data-handling concerns.

**Recommendation:** Do not broaden API tools until (a) the senior owner selects an allowed production injection mechanism under the no-HirePool-source-change constraint, and (b) an existing login callback/token-exchange mechanism is identified. Then implement a narrow, static server-side allowlist, explicit write previews/confirmation, and dedicated upload/assessment handoffs. Do not expose the full OpenAPI catalog to the model.

## 2. Scope, evidence, and limits

- Read the SDK integration, widget/runtime, dynamic API catalog/transport, session handling, and saved OpenAPI inventory/fixture.
- Read relevant HirePool route and schema implementations for candidate, client, consultancy, job, application, screening, and upload workflows.
- The saved OpenAPI document is OpenAPI 3.1.0, retrieved from `http://127.0.0.1:8000/api/openapi.json` (HTTP 200; approximately 613 KB). Schema statements below are from that specification; authorization and side-effect statements are checked against the route implementations because the OpenAPI Authorization header is often marked optional.
- Only safe GETs for SDK health/script and OpenAPI metadata were used during this audit. **No business API operation, real user data, document upload, database write, migration, or role-account test was run.**
- Prior local observations recorded in the project history: the public guest widget rendered at `http://localhost:3001`, and the user confirmed the dashboard widget was visible. The SDK previously passed 58 tests and the widget/frontend builds passed before the latest 3001 mount edits; this audit did not rerun them. A candidate application lookup was previously reported to return raw API data; a Gemini follow-up fix was made and regression-tested, but a successful live retest of conversational formatting remains unconfirmed.
- HirePool has no Git metadata at its workspace root. No HirePool files were modified in this audit.

## 3. Current architecture and visibility

### Runtime map

| Component | Current local address / loading path | Finding |
|---|---|---|
| SDK backend and widget script | `http://localhost:3100`; `/sdk/assistant.js` | Script is served by the SDK. `widget/src/sdk.js` exposes the `AssistantSDK` global. |
| HirePool API | `http://localhost:8000` | Used by the local bridge and dynamic API integration. |
| Marketing website | Ports 3000 and 3001 | The root layout mounts the public widget; its loader is guest-only and hostname-gated. |
| Authenticated frontend | Port 5173 | Shared `AppLayout` mounts the authenticated assistant in development. |
| Admin frontend | Port 5174 | No assistant mount found; it is not in the local allowed-origin set. |

The widget is mounted by client-side React components that append the SDK `<script>` element. It is not an iframe or an active browser extension. The earlier Chrome extension files were removed. The public website root-layout mount has no route/path filter; it is consequently present on every route rendered by that website root layout when its hostname guard passes. The separate dashboard app has its own mount.

| Surface | Actual mount and condition | Revised requirement |
|---|---|---|
| Public website | [`LocalAssistantWidget.tsx`](../talenthub-develop/website/components/LocalAssistantWidget.tsx), rendered by [`layout.tsx`](../talenthub-develop/website/app/layout.tsx). Loads only when the hostname is `localhost` or `127.0.0.1`; initializes as a guest. | Local development works as observed. Production hostname is excluded. No authentication or dashboard-path awareness. |
| Candidate/client/consultancy dashboards | [`HirePoolAssistant.tsx`](../talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx), mounted in [`AppLayout.tsx`](../talenthub-develop/frontend/src/components/layout/AppLayout.tsx). Requires Vite development mode and a local hostname; obtains the stored access token. | **Violates the revised local visibility requirement.** The shared layout is used by all three role dashboards. |
| Admin dashboard | No corresponding mount found; port 5174 is excluded from the observed local origin allowlist. | Hidden in the inspected local setup. |
| Production website/dashboard | Both UI components are development/local-only; the local bridge additionally requires explicit development flags. | Neither surface is a production integration today. |

There is no path-based guard that guarantees “public marketing pages only.” The development host gate is not an adequate production placement policy. A reliable deployment must load the widget only from an explicitly approved main-site origin/path and must not load it from dashboard applications. If any site and dashboard share an origin, a positive route allowlist is preferable to a broad root-layout mount.

The SDK’s default browser storage is `sessionStorage`: conversation identifiers and client-side message state can survive a refresh in the same tab, but not closing the tab. The SDK backend keeps sessions in process memory (default two-hour TTL); the HirePool bridge keeps opaque sessions and access tokens in process memory for five minutes. This is not durable, cross-origin, multi-process conversation continuity.

## 4. Authentication, role verification, and continuation

### What exists

- The dashboard component reads the existing `talenthub_tokens` access token and sends it as a bearer credential to the SDK bridge. It does not send the refresh token.
- The bridge validates the HirePool access token with `GET /api/v1/auth/me`. It accepts candidate/client/consultancy identities; for client and consultancy users it also calls `GET /api/v1/clients/me` or `/api/v1/consultancies/me` and validates the team role.
- The bridge returns a random opaque SDK credential and session scope. The raw HirePool access token is retained server-side in the bridge’s in-memory session map and is supplied as the Authorization header for API calls; it is not intentionally included in tool arguments or LLM context. The SDK principal is bound to the verified user ID, role, assistant, application, and integration session. `tenantId` is null, so HirePool’s own membership/ownership checks remain the actual tenant boundary.
- The SDK validates its own request credential and the local bridge separately validates HirePool identity. Thus the local integration does more than verify an SDK JWT alone, but this is development-only.
- Identity validation is cached for 30 seconds; bridge sessions expire after five minutes. The dashboard loader polls token changes, destroys/revokes the SDK session on logout or account change, and can request a new bridge session while the access token remains valid.
- HirePool remains the authority for endpoint authorization. The bridge does not accept or forward a refresh token.

### Missing for the required website journey

- The public website component initializes as a guest and has no access to the dashboard app’s origin-scoped storage.
- There is no assistant login redirect, safe continuation nonce, persisted intended action, or return-to-website resume protocol.
- HirePool’s existing frontend `ProtectedRoute` can preserve an internal dashboard route in router state, but `AuthContext.completeLogin` navigates directly to the role dashboard/onboarding route. No external `return_url` or assistant continuation is consumed.
- The website and dashboard are separate origins; localStorage is not shared. The current dashboard bridge cannot authenticate the public-site assistant after login.
- No refresh-token exchange or assistant-side refresh flow exists. An expired token can fail API calls; the assistant integration does not use HirePool’s frontend Axios refresh interceptor. A 401 must be surfaced and the user reauthenticated; the chat does not presently resume an interrupted write.
- The public widget’s guest conversation and authenticated dashboard session are not automatically merged. Even when the same-tab session storage survives a navigation, origin separation and the missing verified identity handoff prevent a safe end-to-end continuation.

**Security boundary:** Never put access/refresh tokens in query strings, assistant prompts, tool parameters, logs, or model-visible chat history. A production design needs an existing HirePool OAuth/SSO callback or an approved server-side single-use code/nonce exchange. If HirePool auth cannot return to the public site without source changes, this remains a hard product/deployment blocker; do not collect passwords in chat.

## 5. Role workflow audit

The “configured” column refers to the eight static tools in [`local-development.js`](integrations/hirepool/local-development.js), not to API availability. The dynamic catalog permits only GET tools. The API shapes below are based on the saved OpenAPI fixture; authorization and ownership are based on HirePool route code.

### A. Candidate

| Workflow/API | Method, request and response shape | Auth, ownership, side effects | Current SDK status |
|---|---|---|---|
| Own profile — `get_my_profile_api_v1_candidates_profile_get`, `/api/v1/candidates/profile` | GET, no business parameters; candidate profile response includes work, skills, education, links, resume metadata, and completion fields. | `require_candidate`; profile is selected by authenticated user ID. | Configured. The response projection exposes only job title, location, skills, years of experience, and open-to-work status. |
| Search — `search_jobs_api_v1_jobs_search_get`, `/api/v1/jobs/search` | GET filters include query, skills, locations, remote/job type, experience, salary, pagination, and new-job options; paginated job items. | Candidate-accessible search; HirePool applies its visibility, pay masking, and listing rules. | Configured. Projection is limited to ID, title, company, job/experience type, and required skills. |
| Profile-based recommendations — `get_matching_jobs_api_v1_matching_jobs_get`, `/api/v1/matching/jobs` | GET query: `min_score`, `limit`, `new_only`, `new_since`; returns matched job items. | `require_candidate`; requires the current candidate profile, selects active jobs, computes match scores, and filters completed applications. | Exists and is the closest fit for verified-profile recommendations, but is not configured. |
| Job detail — `get_job_api_v1_jobs__job_id__get`, `/api/v1/jobs/{job_id}` | GET path `job_id`; full job response including description, pay fields, and company fields (with viewer-specific masking). | Optional user identity and route visibility checks. **Increments `views_count`**, so this GET is not strictly read-only. | Exists but is not configured. Must be reviewed as a side effect before any read-tool allowlist. |
| Applications — `get_my_applications_api_v1_applications_my_applications_get`, `/api/v1/applications/my-applications` | GET query `status`, `page`, `page_size`; paginated application items. | `require_candidate`; selected by the authenticated candidate profile. Incomplete screening attempts are intentionally excluded. | Configured. Projection includes application status, job title, company name, and creation time. |
| Eligibility — `check_screening_eligibility_api_v1_applications_screening_eligibility__job_id__get`, `/api/v1/applications/screening-eligibility/{job_id}` | GET path `job_id`; returns `eligible`, reason, and possibly application ID. | `require_candidate`; checks candidate profile and existing application/screening state. It is not a complete guarantee that a job is still active; the write route checks that separately. | Exists but not configured. |
| Start screening — `start_screening_session_api_v1_applications_start_screening__job_id__post`, `/api/v1/applications/start-screening/{job_id}` | POST path `job_id`, no body; returns application ID and started flag. | `require_candidate`; creates a pending application or resets an incomplete one, calculates match, and increments application count for a new record. | Not configured; state-changing operation. Do not treat as a harmless link lookup. |
| Apply — `create_application_api_v1_applications_post`, `/api/v1/applications` | POST JSON: `job_id`, optional `cover_letter`, `screening_responses`, `auto_submitted`; returns application data. | `require_candidate`; requires a candidate profile and active job/client, checks duplicates, calculates match, writes application/screening state, and may notify the client. | Not configured; unsupported by the current dynamic tool executor. Requires a reviewed preview and explicit confirmation. |
| Existing resume — `upload_resume_api_v1_candidates_profile_resume_post`, `/api/v1/candidates/profile/resume` | POST multipart `file`; returns resume-upload result. | Candidate’s own profile; HirePool API handles storage. | Not configured. SDK document upload is not this endpoint. |
| Public assessment — `get_screening_status_api_v1_screening_public__token__status_get`, `get_public_screening_api_v1_screening_public__token__get`, `submit_public_screening_api_v1_screening_public__token__submit_post` under `/api/v1/screening/public/{token}` | GET status returns validity/expiry/completion; GET questions returns job/candidate labels, questions, time, and passing score; POST JSON `answers` plus `total_time_seconds` returns score/results. | Public endpoints have no logged-in-user dependency; the secret token is a bearer capability. Submission updates application score/status and marks the token used. Questions omit correct-answer markers. | Not configured. Keep assessment in the existing UI; never ask the model to take/submit it. The candidate must return through a secure continuation and the assistant can then refresh authorized application status. |

`create_candidate_profile_api_v1_candidates_profile_post` and `update_my_profile_api_v1_candidates_profile_put` also exist (POST/PUT JSON; candidate role; own profile). They are not configured. Profile completeness is an application prerequisite, so the assistant needs to identify that blocker and direct the candidate to an existing profile flow unless a separately reviewed profile-edit workflow is implemented.

### B. Company / Client

| Workflow/API | Method, request and response shape | Auth, ownership, side effects | Current SDK status |
|---|---|---|---|
| User identity — `get_my_user_profile_api_v1_clients_me_get`, `/api/v1/clients/me` | GET; returns current team-member identity/role. | `require_client`; membership is the authenticated user’s client team. | Configured, projection limited to full name and role. |
| Company profile — `get_my_company_profile_api_v1_clients_profile_get`, `/api/v1/clients/profile` | GET; company name, size, industry, location, website, about, and registration/tax fields. | Client role/team membership; company comes from membership. | Exists but not configured. Do not expose tax/registration fields without a specific need. |
| Dashboard — `get_dashboard_stats_api_v1_clients_dashboard_get`, `/api/v1/clients/dashboard` | GET; totals, application counters, and recent application data. | `require_client`; scoped to the current company. | Configured; projection is only total and active jobs. |
| Job list — `get_my_jobs_api_v1_jobs_my_jobs_get`, `/api/v1/jobs/my-jobs` | GET query `status`, `page`, `page_size`; paginated job items. | Client role; scoped to team/company membership. | Configured; projection is ID, title, and status. |
| Create job — `create_job_api_v1_jobs_post`, `/api/v1/jobs` | POST `JobCreate` JSON (required title and description; optional locations, type, skills, compensation, deadline, screening/interview settings, status, and other fields); returns created job. | `require_client`; `client_id` is derived from the caller’s membership. Default is draft; an active job triggers publishing/notifications and pricing synchronization. | Not configured; body execution unsupported. Require collection, validation, final summary, and explicit confirmation. |
| Update/status/delete | `update_job_api_v1_jobs__job_id__put` PUT JSON; `update_job_status_api_v1_jobs__job_id__status_patch` PATCH JSON `{status}`; `delete_job_api_v1_jobs__job_id__delete` DELETE. | Client role and job/company ownership checks; status changes may publish; deletion is destructive. | Not configured. Mutations need separate policy and confirmation; deletion should not be model-autonomous. |
| Application review | `get_client_applications_api_v1_applications_for_client_get` or `get_job_applications_api_v1_applications_job__job_id__get` GET paginated/filterable applicant results; `update_application_status_api_v1_applications__application_id__status_patch` PATCH `{status, recruiter_notes, internal_notes}`. | Client role; verifies application’s job belongs to client. Status changes can send candidate notifications/email. Applicant records contain personal data and internal notes. | Not configured. Requires strict field minimization and explicit confirmation for decisions/status changes. |

The current three client tools are identity, a two-field dashboard summary, and a narrow job list. They do not retrieve the company profile, create/edit jobs, retrieve applicants, or change statuses.

### C. Agency / Consultancy

| Workflow/API | Method, request and response shape | Auth, ownership, side effects | Current SDK status |
|---|---|---|---|
| User/profile/dashboard | `get_my_user_profile_api_v1_consultancies_me_get` GET; `get_my_consultancy_profile_api_v1_consultancies_profile_get` GET; `get_dashboard_stats_api_v1_consultancies_dashboard_get` GET. | `require_consultancy`; team membership determines the consultancy. Profile includes commercial fields such as commission structure; dashboard is scoped to the agency. | Only user identity is configured (name/role). Agency profile and dashboard are not configured. |
| Placement stats — `get_placement_stats_api_v1_consultancies_placements_stats_get`, `/api/v1/consultancies/placements/stats` | GET; placement counts. | `require_consultancy`; route scopes to caller’s consultancy. | Configured; projection limited to total, month, and year counts. |
| Candidate list — `list_candidates_api_v1_consultancies_candidates_get`, `/api/v1/consultancies/candidates` | GET query `query`, `skills`, `bench_status`, `page`, `page_size`; paginated candidates. | `require_consultancy`; query is constrained by `consultancy_id`. Results include personal/contact and profile data. | Exists but not configured. Sensitive data needs a deliberate minimal response projection. |
| Add candidate — `add_candidate_api_v1_consultancies_candidates_post`, `/api/v1/consultancies/candidates` | POST JSON; required `first_name`, `last_name`, `email`; optional phone, profile, skills, education, work history, consent/exclusivity, salary, and agency-specific fee/rate/employee fields; response is a broad candidate record. | `require_consultancy`; server derives the consultancy from membership and checks duplicate email/phone. This is a write. `candidate_consent` defaults to false and the route does not enforce that it is true. | Not configured; body execution unsupported. Consent, exposed fields, review, and confirmation need explicit safeguards. |
| Resume parse — `parse_resume_api_v1_consultancies_candidates_parse_resume_post`, `/api/v1/consultancies/candidates/parse-resume` | POST multipart `file`; returns `parsed_data`. | `require_consultancy`. Accepts PDF/Word MIME types, reads the entire file, and calls the backend AI service (OpenRouter) with a fallback parser. No endpoint-level size cap was found. | Not configured; SDK upload does not call this API. Resume transmission to an external AI provider and upload limits require privacy/security review. |
| Bulk upload — `bulk_upload_resumes_api_v1_consultancies_candidates_bulk_upload_post`, `/api/v1/consultancies/candidates/bulk-upload` | POST multipart ZIP; returns `{job_id, status, message}`. `get_bulk_upload_status_api_v1_consultancies_candidates_bulk_upload__job_id__get` GET accepts `job_id` and `include_results`; returns progress/counts/results. | `require_consultancy`; status lookup verifies the job belongs to the caller’s consultancy. Upload is state-changing and starts a background thread. The 500 MB limit is checked only after `file.read()` loads the complete file into memory. | Neither operation is configured. Current SDK cannot send multipart requests. Status results may include personal information. |
| Candidate resume upload — `upload_candidate_resume_api_v1_consultancies_candidates__candidate_id__resume_post`, `/api/v1/consultancies/candidates/{candidate_id}/resume` | POST multipart `file`; returns resume URL/message. | `require_consultancy`; verifies the candidate belongs to the caller’s consultancy, then reads the entire upload and stores it through the configured storage service. PDF/Word MIME types; no endpoint-level size cap found in the inspected function. | Not configured and not supported by the current dynamic tool executor. |

The API also has consultancy application/submission and placement operations, including `create_consultancy_application_api_v1_applications_consultancy_post` and `bulk_submit_consultancy_candidates_api_v1_applications_consultancy_submit_post`. These are write workflows and are not current tools; they need distinct consent, candidate/job eligibility, compensation, and confirmation rules before consideration.

## 6. Complete OpenAPI and SDK capability inventory

The SDK inventory contains **432 operations across 380 paths**:

| Inventory category | Count |
|---|---:|
| GET / POST / PUT / PATCH / DELETE | 194 / 178 / 32 / 9 / 19 |
| GET parameter schemas accepted / rejected by discovery | 192 / 2 |
| Non-GET operations not generated by current discovery | 238 |
| Administrative operations | 115 |
| File/multipart review required | 39 |
| Sensitive authentication operations | 46 |
| Sensitive/restricted operations | 39 |
| State-changing operations not approved | 113 |
| Supported schema requiring owner approval | 80 |
| Eligible for generation / registered in generated inventory | 0 / 0 |
| Owner-review candidates / mock-tested / live-tested | 9 / 9 / 0 |

The category counts are generator classifications, not permission to register those operations. `registered: 0` in the generated inventory describes its generator/production inventory record, not the current local integration: the development integration statically registers eight read-only operations. The inventory’s `liveTested: 0` is consistent with the audit restriction against business operations.

**Configured local operations (8 total):**

- Candidate (3): own profile, job search, own applications.
- Client (3): own user profile, dashboard stats, own jobs.
- Consultancy (2): own user profile, placement stats.

`/api/v1/auth/me` and the organization `/me` endpoints are used for bridge verification where applicable; they are not extra model tools.

**SDK execution limits and controls:**

- `backend/src/dynamic-api/openapi.js` parses OpenAPI 3.0/3.1 and normalizes supported path/query parameter schemas.
- `backend/src/dynamic-api/catalog.js` requires allowlisted operations to be GET and constructs read-only actions. Request bodies and non-GET operations are rejected. Multipart form-data is not executed.
- The local integration uses exact operation allowlists by role, response-field projections, API-host restrictions, timeouts, and response/result size bounds. HirePool still performs the final per-request authorization.
- The dynamic HTTP layer validates hosts, constrains local HTTP to explicitly enabled development use, bounds response sizes/timeouts, and does not provide an arbitrary URL tool. The current integration is gated on `NODE_ENV=development`, explicit local bridge/discovery flags, and `localhost`.
- Generic SDK host-action confirmation hooks exist, but no HirePool write operation is registered. Current dynamic GET tools are marked as read actions with no confirmation. Generic confirmation UI is not evidence that a HirePool create/update/upload is implemented safely.
- The SDK’s own document upload endpoint is separate from HirePool uploads. It supports PDF/DOCX and text-like extensions, max 10 MB, explicit versioned consent, in-memory parsing/temporary conversation attachment, and may send extracted text to the configured AI provider. It does not create a HirePool candidate or upload a HirePool resume.

## 7. Security, privacy, and operational gaps

1. **Placement/production blocker — high.** Local hostname gates prevent production loading; dashboard widget is mounted in development. No production insertion point was verified under the source freeze. Loading a script from the SDK is insufficient unless the main-site deployment inserts it.
2. **Authentication continuity — high.** A verified local bridge exists only for authenticated dashboard pages. Cross-origin public website login, intent preservation, and safe return/resume do not exist. The production login callback/token exchange is unknown.
3. **Writes are unsupported — high.** The SDK cannot issue JSON mutations or multipart HirePool requests. Never work around this by passing raw API requests or credentials through model-controlled tools.
4. **Role/tenant boundary — positive control with a design constraint.** The bridge validates user type and client/agency membership; static tools are role-scoped; the API derives ownership from the authenticated user. SDK `tenantId` is null, so a future implementation must preserve the API membership checks and must not widen to global candidate or cross-organization reads.
5. **Token lifecycle — medium/high.** Raw HirePool access tokens are held in process memory, sessions are volatile, and no refresh-token exchange exists. Multi-worker deployment/restarts would lose state; a production design needs a secure server-side session store, bounded TTL, revocation, rotation, and no token logging. Do not persist bearer tokens in browser SDK storage.
6. **OpenAPI is not an authorization contract.** The spec may mark Authorization optional even where FastAPI dependencies require it. Confirm route dependency and ownership in source for every allowlisted operation.
7. **Side effects hidden behind reads.** `GET /api/v1/jobs/{job_id}` increments the view counter. Audit side effects, billing, notifications, and data disclosures before classifying any GET as “read-only.”
8. **Agency consent and data minimization.** Consultancy candidate creation accepts `candidate_consent=false` by default and does not enforce consent. The request/response includes contact, salary, rates, fee, employee, and internal-rating fields. Collect and verify appropriate consent, only request necessary fields, review parsed data, and require confirmation before creating a record.
9. **Resume data handling and resource limits.** Consultancy resume parsing sends extracted resume content through the backend AI service and has no visible endpoint size cap; candidate/agency resume upload functions read complete files into memory; the ZIP endpoint checks 500 MB only after reading it. Require streaming limits, content/signature validation, malware scanning, retention/deletion policy, upload authorization, and provider/data-processing review before enabling.
10. **Assessment token is a secret.** Public screening GET/POST endpoints use an unguessable token in the URL as the capability. Keep it out of prompts/logs/referrers and route completion through the existing assessment UI; the assistant should query status only through a separately authorized application read after return.
11. **Error/resumption behavior is incomplete.** Auth/API failures do not have a full website login-return flow or resumable pending action. Writes should fail closed and report clear validation/auth errors, not claim success or retry non-idempotent operations.
12. **No live end-to-end proof.** No real candidate/client/agency session, application, job, upload, or assessment was exercised in this audit. Mock tests and prior local UI observations do not establish production authorization or write correctness.

## 8. Target architecture proposal (not implemented)

1. **Resolve the deployment insertion point first.** Under the current prohibition on HirePool source changes, obtain owner confirmation of an existing first-party tag manager, CDN/edge injection, reverse-proxy template, or other deployment-owned mechanism that can load the SDK on the public main-site origin only. Verify it does not inject into dashboard/Admin origins. If none exists, the requirement is blocked until the deployment constraint changes; do not silently substitute a browser extension.
2. **Use an explicit origin/path allowlist.** Mount only on approved public pages and fail closed everywhere else. Keep dashboard frontend, consultancy/client/candidate dashboard, and Admin origins out of the loader, SDK CORS, and bridge origin allowlist.
3. **Specify a supported login handoff.** Prefer an existing HirePool OAuth/SSO authorization-code flow with exact redirect URI, PKCE/state, single-use short-lived continuation nonce, and server-side binding of conversation/action. Never place tokens or PII in query parameters. If the existing login cannot return to the website, stop and request an approved auth integration rather than scraping localStorage across origins.
4. **Keep the server as tool-policy boundary.** Maintain static role-specific operation allowlists; validate the user/organization on the server; preserve HirePool ownership checks; project the minimum response fields; redact credentials and sensitive fields; use idempotency keys and audit records for writes.
5. **Implement workflows in stages.**
   - Candidate: read profile/search/matching/job details/status; review eligibility; present application and obtain confirmation; only then submit. Route assessments to the existing UI and resume by re-reading status.
   - Client: collect/validate job fields, show a preview, confirm, create a draft, then report the returned ID/status. Treat publish, delete, applicant decisions, and internal notes as higher-risk separately confirmed actions.
   - Consultancy: use an upload staging workflow with server-side limits/scanning and clear consent; parse to a draft; show fields and missing information; obtain candidate-consent attestation and explicit agency confirmation; create the candidate; report job ID/status and validation failures.
6. **Treat session continuity as a server feature.** Store only opaque session IDs in browser storage; bind server sessions to verified user, organization, assistant, and a single-use continuation; support logout/account switching, expiry, revocation, and deployment across workers. Keep access credentials out of LLM prompts/tools and do not accept refresh tokens from the browser assistant.

## 9. Phased roadmap and acceptance tests

| Phase | Deliverable | Minimum acceptance tests |
|---|---|---|
| 0 — Decisions/blockers | Confirm source-free public-site insertion and existing login callback contract; document production domains and data-processing policy. | Prove loader appears only on approved public pages and never on any role/Admin dashboard; no token in URL/log/model; confirm login can return to the public origin. |
| 1 — Identity/session | Production-grade server-side identity exchange and continuation with no password collection. | Candidate/client/consultancy identity and membership positive/negative tests; expired/revoked token, logout, account switch, replayed nonce, forged origin, multi-worker/restart behavior; verify session ownership. |
| 2 — Read-only workflows | Add only reviewed profile/company/dashboard, search/matching/job-detail/application/status and consultancy reads. | Field-level response projection, cross-user/cross-company/cross-agency denial, GET side-effect review, pagination bounds, PII redaction, clear 401/403/429 handling. |
| 3 — Confirmed mutations | Add candidate application, client draft job, agency candidate creation as separate actions. | Missing fields, duplicates, inactive job, ownership, consent false, user rejects preview, retry/idempotency, confirmation freshness, downstream failure, and success-status verification. |
| 4 — Assessment/uploads | Connect existing assessment UI; add dedicated staged upload/parse/create workflow only after privacy and limits are approved. | Token expiry/replay/completion, no correct-answer leakage, assessment is never auto-submitted by chat; MIME/signature mismatch, oversized/chunked files, ZIP expansion limits, malware, parser failure, provider disclosure, deletion/retention, upload results scoped to owner. |
| 5 — Release | Controlled canary, monitoring, rollback, incident/privacy review. | CSP/CORS/origin allowlist, production bundle contains no local endpoints, telemetry excludes credentials/resume text, role-specific E2E tests, alerting and rollback exercise. |

## 10. Blockers and decisions required

- **Main-site-only mounting without source edits:** identify an existing approved deployment injection mechanism. None was verified. The SDK script alone cannot insert itself into a site that does not load it.
- **Login return and identity:** confirm whether HirePool already supports a public-site redirect/callback or an approved server-side token exchange. Current login routes to role dashboards and the website cannot read their storage.
- **Scope of first release:** select which read-only and write operations are in scope. “All interactions through chat” does not make destructive/team/admin operations suitable for an assistant.
- **Data governance:** approve resume/PII processing, third-party AI provider use, consent language, retention, file limits/scanning, and agency candidate-consent enforcement before uploads or candidate creation.
- **Assessment handoff:** confirm the public-screening URL/token lifecycle and how a completed assessment returns to the main-site assistant without exposing the bearer token.

## 11. Repository state and files

### SDK repository

Pre-audit branch recorded as `main`; the SDK worktree was already substantially dirty. Existing changes were preserved. Current pre-report status snapshot:

**Tracked modified files:** `.env.example`, `README.md`, `backend/.env.example`, `backend/src/actions/tool-converter.js`, `backend/src/app.js`, `backend/src/middleware/auth.js`, `backend/src/middleware/security.js`, `backend/src/providers/gemini.js`, `backend/src/routes/chat.js`, `backend/src/routes/documents.js`, `backend/src/routes/sessions.js`, `backend/src/session-manager.js`, `config/defaults.js`, `docs/configuration.md`, `docs/deployment.md`, `docs/security.md`, `docs/setup.md`, `package-lock.json`, `package.json`, `public/sdk/assistant.js`, `public/sdk/assistant.js.map`, `public/sdk/assistant.min.js`, `tests/auth-lifecycle.test.js`, `tests/chat-stream.test.js`, `widget/src/api-client.js`, `widget/src/integration.js`, `widget/src/sdk.js`, `widget/src/widget.js`.

**Pre-existing untracked files:** `DYNAMIC_API_DISCOVERY_IMPLEMENTATION_REPORT.md`, `DYNAMIC_API_DISCOVERY_REMEDIATION_REPORT.md`, `SDK_COMPLETE_READINESS_AUDIT.md`, `SDK_DYNAMIC_API_DISCOVERY_AND_TOOL_GENERATION_AUDIT.md`, `SDK_HIREPOOL_FINAL_INTEGRATION_REPORT.md`, `SDK_HIREPOOL_LOCAL_E2E_INTEGRATION_REPORT.md`, `backend/src/dynamic-api/catalog.js`, `backend/src/dynamic-api/openapi.js`, `backend/src/dynamic-api/secure-http.js`, `backend/src/local-integrations/hirepool-auth.js`, `backend/src/local-integrations/hirepool-session-store.js`, `backend/src/session-scope.js`, `docs/dynamic-api-discovery.md`, `docs/hirepool-openapi-inventory.json`, `docs/hirepool-sdk-integration.md`, `integrations/hirepool/dynamic-integration.example.json`, `integrations/hirepool/local-development.js`, `scripts/generate-hirepool-openapi-inventory.js`, `tests/dynamic-api.test.js`, `tests/fixtures/hirepool-openapi.json`, `tests/local-hirepool.test.js`.

The sole file created for this audit is `REVISED_HIREPOOL_ASSISTANT_REQUIREMENTS_GAP_ANALYSIS.md`. No implementation files were edited; no commit or push was made.

### HirePool repository

`D:\talenthub-develop` has no Git metadata at its root. It was inspected read-only; no HirePool file, environment file, package manifest, database, or generated bundle was changed.

### Primary evidence files

- SDK widget mount and session: [`LocalAssistantWidget.tsx`](../talenthub-develop/website/components/LocalAssistantWidget.tsx), [`layout.tsx`](../talenthub-develop/website/app/layout.tsx), [`HirePoolAssistant.tsx`](../talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx), [`AppLayout.tsx`](../talenthub-develop/frontend/src/components/layout/AppLayout.tsx).
- SDK bridge and local tool policy: [`hirepool-auth.js`](backend/src/local-integrations/hirepool-auth.js), [`hirepool-session-store.js`](backend/src/local-integrations/hirepool-session-store.js), [`local-development.js`](integrations/hirepool/local-development.js).
- API engine and transport: [`openapi.js`](backend/src/dynamic-api/openapi.js), [`catalog.js`](backend/src/dynamic-api/catalog.js), [`secure-http.js`](backend/src/dynamic-api/secure-http.js).
- Inventory: [`hirepool-openapi-inventory.json`](docs/hirepool-openapi-inventory.json), [`hirepool-openapi.json`](tests/fixtures/hirepool-openapi.json).
- HirePool workflows: [`applications.py`](../talenthub-develop/backend/app/api/v1/applications.py), [`jobs.py`](../talenthub-develop/backend/app/api/v1/jobs.py), [`consultancies.py`](../talenthub-develop/backend/app/api/v1/consultancies.py), [`screening.py`](../talenthub-develop/backend/app/api/v1/screening.py), [`consultancy.py`](../talenthub-develop/backend/app/schemas/consultancy.py), [`AuthContext.tsx`](../talenthub-develop/frontend/src/contexts/AuthContext.tsx), [`ProtectedRoute.tsx`](../talenthub-develop/frontend/src/routes/ProtectedRoute.tsx).
