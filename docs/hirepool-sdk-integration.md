# HirePool SDK Integration Status

## Status: local authenticated candidate actions implemented; live account verification pending

The public-site guest chat exposes separate `hirepool_signup` and `hirepool_login` actions. They open the existing HirePool `/register` and `/login` routes and pass only the allowlisted public-site origin in a query parameter. The public page retains its popup reference and accepts messages only from that exact popup and the local authenticated-app origins.

After login or completed signup/onboarding, the HirePool frontend revalidates the account with `/api/v1/auth/me` and exchanges its bearer token directly with the existing local SDK `/api/hirepool/session` bridge. The SDK validates the token against HirePool `/auth/me`, requires an active and email-verified account, checks client/consultancy membership where applicable, keeps the host token server-side, and returns a short-lived opaque SDK credential. Only the opaque credential and server-verified identity metadata are sent to the public-site popup. Raw access/refresh tokens are not sent through `postMessage`, chat context, model prompts, or tool arguments.

The active public-site tab keeps the same SDK instance, conversation ID, and message history while its authenticated scope changes. Its next assistant request uses the opaque SDK credential. The backend derives the principal and role from its server-side session store; verified account identity is supplied to the model from that principal, not from `sdk.setContext()` or browser role metadata. The existing email verification and role-specific onboarding steps remain in the HirePool application. The authenticated-app assistant mount was removed so the assistant is mounted only by the public-site layout.

This authenticated bridge remains local-development-only. The SDK backend must have `ENABLE_HIREPOOL_LOCAL_BRIDGE=true`, `DYNAMIC_API_DISCOVERY_ENABLED=true`, and exact dashboard/public-site origins in CORS configuration. Production bridge use is not enabled. The production SDK URL and production CORS/delegation architecture are not configured or verified.

## Verified discovery inventory

The checked-in OpenAPI snapshot contains 432 operations:

| Measure | Count |
|---|---:|
| Operations inventoried | 432 |
| GET operations | 194 |
| GET parameter schemas supported | 192 |
| GET parameter schemas rejected | 2 |
| Non-GET operations in the static inventory snapshot | 238 |
| Candidate role review proposals | 9 |
| Local-only configured operations | 15 |
| Production-registered HirePool operations | 0 |
| Local candidate GET operations | 7 |
| Local candidate write operations (JSON POST/PUT) | 3 |
| Live HirePool business operations tested | 0 |

The nine role-grouped entries in `integrations/hirepool/dynamic-integration.example.json` are proposals, not production-enabled tools. The separate local-only registration exposes 15 role-filtered operations (10 candidate, three client, two consultancy) with response-field projections. Candidate tools include seven GET operations and three confirmation-gated JSON writes: profile update, application submission, and application withdrawal. Candidate matching uses the existing `/api/v1/matching/jobs` endpoint and HirePool's returned `matching_score`; the SDK additionally checks own application history and screening eligibility before presenting an unapplied shortlist. The screening-eligibility GET is candidate-scoped and is used with the candidate-safe questions response and own-application history to avoid mistaking pending or completed screening for an absent requirement. `/auth/me` is used only by the bridge to validate identity and is never exposed as a model tool. The dynamic parser still excludes multipart uploads.

Regenerate the inventory only from the local OpenAPI endpoint or the saved fixture:

```powershell
node scripts/generate-hirepool-openapi-inventory.js
```

The generated [HirePool OpenAPI inventory](./hirepool-openapi-inventory.json) records parser diagnostics and distinguishes discovered, supported, proposed, registered, mock-tested, and live-tested operations. A mock test does not establish that a live HirePool request is authenticated or authorized.

## Local bridge behavior and remaining blockers

1. The existing `/api/hirepool/session` bridge accepts a session-exchange request only from the pinned local extension origin or an exact local dashboard origin. The dashboard path is limited to `POST /api/hirepool/session`; other dashboard-origin requests under `/api/hirepool/` remain blocked.
2. The SDK backend validates `/api/v1/auth/me` and client/consultancy membership before issuing a short-lived opaque credential. Raw HirePool access tokens stay in the SDK backend's in-memory session store and are forwarded only to HirePool API calls.
3. Login/logout messages use exact origins, a retained expected popup source, versioned payload validation, and no wildcard target. Local authenticated credentials expire after five minutes and are revoked when logout is delivered to the original public-site tab.
4. The local bridge and role-scoped GET transport remain behind explicit development flags and fixed loopback API configuration. They are not enabled in production.
5. The public site and dashboard were reachable during implementation, but no test-account credentials were provided. Real candidate/client/consultancy profile API responses, email verification, browser handoff, logout, account switching, and candidate business-operation results remain unverified. SDK unit tests use mocked identities and API responses.

Never pass refresh tokens, JWT signing secrets, or raw host tokens into model arguments, prompts, URLs, or logs. Do not infer roles from browser-supplied values. No candidate application or other HirePool business operation has been live-verified; production business tools are disabled.

## Local public-site and authenticated-session flow

For local testing, run the SDK backend on port `3100`, HirePool frontend on `5173`, public Next.js site on `3001`, and HirePool API on `8000`. The website loads `http://localhost:3100/sdk/assistant.js`. CORS must include `http://localhost:5173` and the public-site origin; the HirePool bridge must retain its explicit development flags.

The browser handoff returns only the short-lived SDK credential and verified identity from the SDK bridge. The public widget uses role-specific dynamic tools: candidate profile/search/job details/screening questions/application history reads plus profile update/application submission/withdrawal writes; client team profile/dashboard/jobs; consultancy team profile/placement stats. `/auth/me` is used for identity verification, not exposed as a model tool. Multipart resume upload is not integrated.

The existing extension source remains unchanged and is not required by the direct local dashboard-to-SDK session exchange. The existing continuation-consume route is also not used by this live-tab flow: the public-site tab stays open, and the same SDK conversation continues on the user's next message without creating another continuation endpoint. Without the production SDK URL configuration, `https://hirepool.ai` does not load an SDK script.

Gemini function-call follow-ups retain the original model response parts, including thought signatures, so the model can synthesize tool results into a user-facing answer. The chat-stream tests cover this for both regular and streaming function calls.

## Security behavior currently implemented in the SDK

- Dynamic API discovery is disabled by default and forcibly unavailable in production.
- Production integrations require explicit enablement, exact per-integration HTTPS hosts, and a server-side authorization callback.
- The HirePool exception is confined to local development: exact local origins, fixed localhost port 8000 pinned to loopback, explicit flags, short-lived in-memory sessions, and no production enablement.
- Only explicitly allowlisted GET/JSON POST/PUT operations are generated; role/application authorization is rechecked before execution.
- Candidate writes are staged server-side with operation-specific preflight and require explicit widget confirmation. Confirmation is short-lived, bound to the authenticated user/session and the normalized operation arguments, and cannot be changed by the confirmation request. Cancelling a card revokes its pending confirmation; expired or invalid confirmations require fresh readiness checks.
- Candidate shortlist and selected-job context are retained in the existing conversation session. Unambiguous apply/details/prerequisite-return follow-ups resolve to existing operations without asking the model to repeat matching. Application writes always repeat job, profile, screening, eligibility, and own-history checks.
- Application submission derives candidate identity from the verified backend session; no candidate ID is accepted in the submission body. The job and candidate profile are re-read before staging. Screening responses are matched against current HirePool questions/options; missing answers are requested rather than invented.
- The candidate's own application-history endpoint supplies application status. Withdrawal is offered only for an application found in that history. The direct application-detail endpoint is intentionally not allowlisted.
- Credentials come from a server-side callback, not chat request fields or model-generated parameters.
- Spec and API responses have bounds and timeouts; redirects are rejected; DNS results are checked and pinned. Safe GETs may retry once after a timeout; identical reads within a chat turn share one in-flight request. Writes are never automatically retried after ambiguous outcomes.
- Response fields are projected and result sizes are limited.
- Production API CORS allows only exact origins in `CORS_ALLOWED_ORIGINS`; cross-origin cookies are not enabled. The static SDK script remains independently loadable cross-origin.

## Current validation scope

The automated suite parses the saved 432-operation fixture, checks role-specific operation generation and response projections, and mock-tests application preflight, screening-answer validation, confirmation binding and cancellation, deduplication, follow-up intent resolution, bounded safe-read retry, bridge rejection cases, and session/application/assistant isolation. It does not authenticate a real HirePool user or call HirePool business endpoints. No real application submission or application-history verification has occurred.
