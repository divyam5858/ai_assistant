# HirePool Local SDK Integration Report

**Date:** 2026-11-04  
**Outcome:** Local bridge, authenticated dashboard widget, and public-site guest widget implemented. The public-site mount and a candidate application lookup are verified; Gemini answer formatting is being retested after a follow-up fix.  
**Scope:** SDK changes are in `D:\ai-assistant-plugin`; the user later authorized a local-development-only mount in the active HirePool dashboard frontend. Production remains disabled. No commit or push was made.

## Implementation

- The SDK default/local server port is `3100`; the existing website production process uses `3000`, while the public Next.js development site requested for the widget runs on `3001`.
- Added a development-only bridge at `POST /api/hirepool/session` and `POST /api/hirepool/session/revoke`. The bridge validates the HirePool access token with `/api/v1/auth/me`; client and consultancy identities are additionally validated through their matching `/me` endpoint and account-type-specific team roles.
- The raw HirePool access token stays in short-lived server memory. The browser receives only an opaque SDK credential and storage scope. The refresh token is not read or forwarded.
- Registered eight statically allowlisted GET tools locally: three candidate, three client, and two consultancy tools. Responses are projected to small field allowlists. The bridge and HTTP transport require explicit local-development flags and fixed loopback/local origins; production remains disabled.
- Added `frontend/src/components/assistant/HirePoolAssistant.tsx` to mount the SDK directly in the authenticated shared dashboard layout on local Vite development origins. It reads the existing access token, obtains a server-validated opaque SDK credential, and destroys/revokes the session on logout or account changes. Production builds and the separate Admin app are excluded.
- Added `website/components/LocalAssistantWidget.tsx` to mount a guest-only SDK widget on `localhost` and `127.0.0.1`; it is rendered from the public website root layout. It receives no HirePool identity or role-specific tools. The local CORS/origin allowlist includes the existing Next.js dev origin on port `3001`.
- The user has confirmed dedicated candidate, client, and consultancy test accounts are available. No passwords or tokens were requested or received.

Implementation details and local test steps are in [docs/hirepool-sdk-integration.md](docs/hirepool-sdk-integration.md).

## Verification

| Check | Result |
|---|---|
| `npm test` | **PASS** — latest run: 59 tests, 0 failures |
| HirePool frontend `npm run build` | **PASS** — TypeScript and Vite production build; existing large-chunk warning remains |
| ESLint on `HirePoolAssistant.tsx` and `AppLayout.tsx` | **PASS** |
| Local development-only production guard | **PASS** — production bundle contains neither the local SDK URL nor local application ID |
| `npm run build:widget` | **PASS** — standard bundle 103.2 KB; minified bundle 70.2 KB |
| `node --check` on bridge and local integration tests | **PASS** |
| `git diff --check` in the SDK repository | **PASS** — only existing Windows line-ending warnings |
| Local OpenAPI inventory refresh | **PASS** — 432 operations inventoried: 194 GET, 192 supported GET parameter schemas, 2 rejected GET schemas, and 238 non-GET operations excluded |
| Role-specific tool generation against the saved OpenAPI fixture | **PASS (mock only)** — candidate/client/consultancy tool sets match the configured allowlists; response projection and wrong-role denial are tested |
| SDK health on `http://localhost:3100/api/health` | **PASS** — HTTP 200 |
| SDK script on `http://localhost:3100/sdk/assistant.js` | **PASS** — HTTP 200, 105,656 bytes |
| Website at `http://127.0.0.1:3000/` while SDK was on `3100` | **PASS** — HTTP 200; browser title `HirePool - AI-Powered Talent Acquisition` |
| Dashboard SPA route on `http://localhost:5173/candidate/jobs` | **PASS** — HTTP 200 |
| Bridge missing-token rejection | **PASS** — HTTP 401 `MISSING_CREDENTIALS` |
| Bridge untrusted-origin rejection | **PASS** — HTTP 401 `ORIGIN_NOT_ALLOWED` |
| Bridge fake-token rejection against the local HirePool API | **PASS** — HTTP 401 `INVALID_HOST_CREDENTIAL`; no real token was used |
| Public website TypeScript check | **PASS** — `npx tsc --noEmit --incremental false` |
| Public website ESLint | **PASS** — `LocalAssistantWidget.tsx` and `app/layout.tsx` |
| Gemini chat follow-up | **PASS (mock)** — raw model parts and thought signatures are retained for non-streaming and streaming function calls |
| Public guest widget on `http://localhost:3001/` | **PASS** — browser confirmed the SDK loaded and initialized; the guest chat panel rendered |
| Port `3001` SDK CORS preflight | **PASS** — allowed origin returned `http://localhost:3001` |
| Port `3001` bridge origin gate | **PASS** — request reached authentication and returned `MISSING_CREDENTIALS` without credentials |
| HirePool frontend source edits | **AUTHORIZED, LOCAL-ONLY** — direct dashboard mount; production build remains disabled |

The local API inventory is recorded in [docs/hirepool-openapi-inventory.json](docs/hirepool-openapi-inventory.json). The two unsupported GET schemas remain diagnostic-only; no non-GET operation is exposed.

## Real E2E status by role

| Role / scenario | Status | Reason |
|---|---|---|
| Public website guest widget | **PASS** | Browser confirmed SDK initialization and guest chat rendering on port `3001`; no user identity or role tools are supplied |
| Authenticated dashboard mount | **PASS (visibility)** | User confirmed the widget is visible on the dashboards |
| Candidate application lookup | **PARTIAL** | A real application result was returned, but Gemini failed to format it after a missing `thought_signature` error; the signature-preservation fix is implemented and needs live retest |
| Client: validate a real account and call profile, dashboard stats, and jobs | **PENDING** | The dashboard widget is visible, but successful client-specific result content has not been confirmed |
| Consultancy: validate a real account and call profile and placement stats | **PENDING** | An authenticated session/chat was exercised in the local server logs, but successful consultancy-specific result content was not confirmed |
| Dashboard navigation, account switching, and logout | **PENDING** | The direct mount was just added and has not yet been browser-tested |
| Gemini-backed conversation through the HirePool widget | **FIX APPLIED; RETEST PENDING** | Tool-call signature preservation is covered by regression tests; confirm the user-facing summary in a fresh local session |

The candidate application response confirms that a real read-only lookup returned data for the signed-in test account. The local mock tests do not establish authorization for other operations or roles. A Gemini key is configured locally; its value was not displayed in this report.

## Ports and cleanup

The local SDK and existing website processes use ports `3100`, `3000`, and `3001`; the Vite dashboard and Admin apps use `5173` and `5174`, and the API uses `8000`. Port `3001` belongs to the existing Next.js development server and must not be stopped as part of this integration.

If the SDK or public-site dev server is not already running, start it in a separate terminal:

```powershell
# SDK
Set-Location D:\ai-assistant-plugin
npm start

# Public Next.js website (in a separate terminal)
Set-Location D:\talenthub-develop\website
npm run dev -- --hostname localhost --port 3001
```

Visit `http://localhost:3001` for the public guest widget. Sign in to a dedicated local candidate, client, or consultancy account on the frontend at port `5173` for the authenticated widget. No Chrome extension is required. Do not send passwords, access tokens, or refresh tokens through chat. The HirePool repository root has no Git metadata, so a Git diff baseline was unavailable.
