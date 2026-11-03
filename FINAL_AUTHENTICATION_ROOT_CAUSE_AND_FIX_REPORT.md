# Final Authentication Root Cause and Production Fix Report

**Project:** AI Assistant SDK  
**Repository:** `D:\ai-assistant-plugin`  
**Production URL:** `https://aiassistant-mu-mauve.vercel.app/`  
**Production API:** `https://aiassistant-mu-mauve.vercel.app/api`  
**Date:** November 3, 2026  
**Status:** Fix Implemented, Built, Tested, and Verified Locally  

---

## A. Executive Summary

This investigation resolved the production authentication failure on the deployed Vercel instance where `GET /api/health` returned `200 OK`, but `POST /api/chat/stream` returned `401 Unauthorized` (`MISSING_CREDENTIALS: Authentication credentials are required`) and `POST /api/documents/upload` failed.

### What Was Broken
1. **Middleware Hardcoding in Production:** In `backend/src/middleware/auth.js:266`, the `authenticate()` middleware unconditionally evaluated `required = true` whenever `process.env.NODE_ENV === 'production'`.
2. **Missing Client Credentials in Public Demo Mode:** The public demo at `https://aiassistant-mu-mauve.vercel.app/demo` (and `index.html`) embeds the standalone widget (`<script src="/sdk/assistant.js">`) without an external host login adapter (`getAuthHeaders` is undefined). As a result, the widget's API client sent requests with zero authentication headers.
3. **The `JWT_SECRET` Progression:**
   - *Phase 1 (Before secret configuration):* Requests failed with `500 CONFIG_ERROR` because `authenticate()` checked `if (!jwtSecret && required) throw new AuthError('CONFIG_ERROR', 'Authentication is required but server JWT secret is not configured')`.
   - *Phase 2 (After user added `JWT_SECRET` to Vercel):* The secret configuration check passed, but the middleware immediately reached step 2: `if (!creds && required) throw new AuthError('MISSING_CREDENTIALS', 'Authentication credentials are required')`, returning `401 Unauthorized`.
   - *Contrast with `/api/health`:* `/api/health` does not mount `authenticate()`, which is why health checks succeeded while protected API routes failed closed.

### What Was Fixed
- **Architectural Solution (Model E + Model C):** Implemented a dual-mode authentication architecture that preserves strict backend authentication while providing seamless zero-configuration access for the public demo widget.
  1. **Backend Demo Token Issuance (`backend/src/routes/auth.js`):** Added `POST /api/auth/token` and `GET /api/auth/token` endpoints that issue short-lived (1-hour), cryptographically signed HS256 JWTs with scoped permissions (`role: 'demo'`, scopes: `['chat', 'summarize', 'document:upload', 'session:clear']`). Token issuance is strictly restricted to public assistant presets (`default`, `researcher`, `support`, `coder`, `integration-demo`); requests for protected enterprise assistants (such as `hirepool`) are rejected with `403 FORBIDDEN_ASSISTANT`.
  2. **Transparent Client Token Acquisition (`widget/src/api-client.js`):** In standalone/public demo mode (when `getAuthHeaders` is not provided), `AssistantApiClient` automatically fetches and caches a backend-issued demo token, attaching `Authorization: Bearer <token>` to requests.
  3. **Strict Host Integration Precedence:** When an external host application provides `getAuthHeaders`, host credentials take complete precedence. User identity, tenant isolation, and custom scopes are strictly enforced.
  4. **Config Precedence Fix (`backend/src/middleware/auth.js`):** Updated `authenticate()` so explicit `AUTH_REQUIRED` settings are respected over ambient environment defaults.

---

## B. Confirmed Root Cause

### 1. Code-Level Inspection & Evidence

#### Failure in `backend/src/middleware/auth.js`:
Lines 263–268:
```javascript
const isProd = process.env.NODE_ENV === 'production';
const mode = options.mode || process.env.AUTH_MODE ||
  (isProd || process.env.JWT_SECRET ? 'jwt' : 'none');
const required = options.required !== undefined
  ? options.required
  : (process.env.AUTH_REQUIRED === 'true' || isProd);
```
When deployed to Vercel, `NODE_ENV` is set to `'production'`, making `isProd === true`. Therefore, `required` evaluated to `true` on every route mounting `authenticate()`.

#### Missing Token Header in `widget/src/api-client.js`:
Lines 71–74:
```javascript
async _headers(json = false) {
  const headers = this.getAuthHeaders ? await this.getAuthHeaders() : {};
  return json ? { ...headers, 'Content-Type': 'application/json' } : headers;
}
```
In the standalone widget embed (`demo/index.html`, `index.html`), the widget initializes via `<script src="/sdk/assistant.js" data-assistant-id="default">`. In this mode, no host adapter exists, `this.getAuthHeaders` is `undefined`, and `_headers()` returned only `{ 'Content-Type': 'application/json' }`.

#### Backend Execution Sequence:
1. `POST /api/chat/stream` enters `backend/src/routes/chat.js` which has `chatRouter.use(authenticate())`.
2. `authenticate()` extracts `creds = extractCredentials(req)`. None found (`Authorization` header missing).
3. With `JWT_SECRET` configured in Vercel, the secret validation check passes.
4. Step 2 in `authenticate()` executes:
   ```javascript
   if (!creds && required) {
     throw new AuthError('MISSING_CREDENTIALS', 'Authentication credentials are required', 401);
   }
   ```
5. `error-handler.js` catches the error and returns:
   ```json
   {
     "error": {
       "code": "MISSING_CREDENTIALS",
       "message": "Authentication credentials are required"
     }
   }
   ```
6. The widget client displays: *"Authentication credentials are required"*.

### 2. Why `/api/health` Worked
In `backend/src/app.js`:
```javascript
app.use('/api/health', healthRouter);
app.use('/api/chat', chatRouter);
```
`healthRouter` is defined in `backend/src/routes/health.js` and does not mount `authenticate()`. It performs an internal provider health ping and returns `200 OK`. `chatRouter` and `documentsRouter`, however, mount `authenticate()`, causing them to fail closed when credentials were absent.

---

## C. Authentication Architecture (Model E + Model C)

The system implements a dual-mode, defense-in-depth architecture:

```
+-----------------------------------------------------------------------------------+
|                                 CLIENT MODES                                      |
+-----------------------------------------+-----------------------------------------+
| A. Standalone / Public Demo Mode        | B. Protected Host Integration Mode      |
|    (<script src="/sdk/assistant.js">)   |    (AssistantSDK.init({ integration })) |
|    - No host auth adapter               |    - Host provides getAuthHeaders()     |
|    - Automatic demo token acquisition   |    - Host supplies signed JWT / API Key |
+-----------------------------------------+-----------------------------------------+
                    |                                           |
                    v                                           v
       POST /api/auth/token                        Direct Request with Host Header
     (Scoped Guest JWT issued)                     (Authorization: Bearer <host_jwt>)
                    |                                           |
                    +---------------------+---------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                        BACKEND: authenticate() MIDDLEWARE                         |
|  - HS256 JWT signature verification using server JWT_SECRET                       |
|  - Validates exp, nbf, iss, and aud claims                                        |
|  - Extracts claims -> populates req.user { id, role, tenantId, scopes }           |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                       ROUTE AUTHORIZATION & ENFORCEMENT                           |
|  1. Public Demo Token (role: 'demo'):                                             |
|     - Allowed on public assistants ('default', 'researcher', 'support', etc.)     |
|     - Forbidden on protected assistants ('hirepool' -> 403 FORBIDDEN_ASSISTANT)   |
|     - Tenant strictly isolated to 'public_demo'                                   |
|  2. Host Integration Token:                                                       |
|     - Enforces tenant isolation (sessionManager prevents cross-tenant access)     |
|     - Filters ActionRegistry by trusted JWT scopes (permissions)                  |
|     - Enforces document upload consent notice verification                        |
+-----------------------------------------------------------------------------------+
```

---

## D. Complete Request Flow

### Public Demo Request Flow
1. **Initialization:** The browser loads `/demo` or `/`. The standalone script `public/sdk/assistant.js` runs.
2. **User Interaction:** The visitor types a message into the chat widget.
3. **Token Acquisition:**
   - `AssistantApiClient._headers()` checks for existing valid demo token.
   - If missing or expiring within 60 seconds, it sends `POST /api/auth/token` with `{ assistantId: 'default' }`.
   - Backend `authRouter` verifies `assistantId` is in `PUBLIC_ASSISTANT_IDS`, mints a signed 1-hour HS256 JWT with `sub: 'guest_<uuid>'`, `role: 'demo'`, `scopes: ['chat', 'summarize', 'document:upload', 'session:clear']`, and returns it.
   - `AssistantApiClient` caches the token in memory.
4. **API Invocation:** `AssistantApiClient.streamChat()` dispatches `POST /api/chat/stream` with `Authorization: Bearer <token>`.
5. **Backend Authentication:**
   - `authenticate()` verifies token signature against `JWT_SECRET`.
   - `req.user` is established.
6. **Chat Processing:**
   - `chatRouter` validates payload schema with Zod.
   - `sessionManager.getOrCreate()` allocates or retrieves the session for `req.user.id`.
   - Dispatches to AI provider (`GeminiProvider` / `OpenAIProvider`) with streaming SSE output.
7. **Frontend Streaming:** The widget receives chunks and renders markdown in real time.

### Protected Host Integration Request Flow
1. Host application invokes `AssistantSDK.init({ integration: { getAuthHeaders: async () => ({ Authorization: 'Bearer ' + hostUserJwt }) } })`.
2. Widget API client invokes `this.getAuthHeaders()`. Host token takes full precedence; demo token endpoint is never contacted.
3. Backend verifies the host token. If the host specifies `tenantId: 'tenant_acme'`, `sessionManager` strictly locks session access to `tenant_acme`. Any cross-tenant access attempt raises `TENANT_MISMATCH (403)`.
4. Host-scoped permissions gate available backend actions.

---

## E. JWT Configuration

The JWT configuration uses environment variables without exposing secret values:

| Variable | Type | Production Required | Description |
|---|---|---|---|
| `JWT_SECRET` | Secret | **Yes** | 256-bit+ cryptographic key used to sign and verify HS256 JWTs. Must be configured in Vercel Project Settings under Environment Variables. Never exposed to browser or client code. |
| `AUTH_MODE` | String | Optional (defaults to `jwt` in production) | Specifies authentication mode (`jwt`, `api-key`, `hybrid`, `none`). |
| `AUTH_REQUIRED` | Boolean | Optional (defaults to `true` in production) | When set to `false`, allows optional guest fallbacks if secrets are absent. |
| `JWT_ISSUER` | String | Optional (default: `ai-assistant-plugin`) | Verified against `iss` claim if present. |
| `JWT_AUDIENCE` | String | Optional | Verified against `aud` claim if present. |

---

## F. Files Changed

| File Path | Status | Reason for Modification |
|---|---|---|
| `backend/src/routes/auth.js` | **Created** | Implements `POST /api/auth/token` and `GET /api/auth/token` to issue short-lived, scoped guest JWTs for public assistants while strictly rejecting protected assistants. |
| `backend/src/app.js` | **Modified** | Mounts `authRouter` at `/api/auth`. |
| `backend/src/middleware/auth.js` | **Modified** | Fixes configuration precedence in `authenticate()` so explicit `AUTH_REQUIRED` env var is respected over implicit defaults. |
| `widget/src/api-client.js` | **Modified** | Implements `_getOrFetchDemoToken()` to transparently acquire and attach demo credentials in standalone mode, while preserving complete precedence for host `getAuthHeaders`. |
| `widget/src/sdk.js` | **Modified** | Passes configured `assistantId` into `AssistantApiClient` constructor. |
| `widget/dist/assistant.js` | **Rebuilt** | Rebuilt standalone widget bundle (100.9 KB). |
| `widget/dist/assistant.min.js` | **Rebuilt** | Rebuilt minified widget bundle (68.6 KB). |
| `public/sdk/assistant.js` | **Rebuilt** | Synced standalone distribution for public CDN serving. |
| `public/sdk/assistant.min.js` | **Rebuilt** | Synced minified distribution for public CDN serving. |
| `tests/auth-lifecycle.test.js` | **Created** | Comprehensive 14-test regression suite covering demo token issuance, public demo end-to-end chat, 401 rejection on invalid/expired tokens, host precedence, tenant isolation, and document consent. |
| `SDK_LEVEL3_INTEGRATION_GUIDE.md` | **Modified** | Updated integration documentation detailing demo token behavior versus host `getAuthHeaders` credentials. |

---

## G. Security Review

1. **Authentication Integrity:**
   - No authentication bypass was introduced. All protected endpoints (`/api/chat/stream`, `/api/chat`, `/api/documents/upload`, `/api/sessions/*`) strictly require valid authentication when `JWT_SECRET` is configured.
   - Missing, expired, malformed, or forged tokens are rejected with `401 Unauthorized`.
2. **Authorization & Privilege Escalation Prevention:**
   - Demo tokens are hardcoded with `role: 'demo'` and restricted scopes (`chat`, `summarize`, `document:upload`, `session:clear`).
   - Demo tokens cannot be minted for protected enterprise assistants (e.g., `hirepool`); attempts return `403 FORBIDDEN_ASSISTANT`.
   - Host integration actions requiring elevated permissions (e.g. `orders.write`) fail if the token lacks the requisite scopes.
3. **Session & Tenant Isolation:**
   - Each demo token is issued a distinct `guest_<uuid>` identifier.
   - `sessionManager` strictly validates `userId` and `tenantId` on all document uploads and conversation queries.
4. **Secret Handling:**
   - `JWT_SECRET` remains exclusively on the server.
   - No secrets are bundled into client JavaScript or logged to the console.
5. **Document Upload Safety:**
   - Uploads strictly require explicit consent headers (`X-Document-Processing-Consent: accepted`) and body flags (`consentAccepted: true`, matching consent version) before parsing proceeds.

---

## H. Tests Executed and Results

### Test Execution Command
```bash
node --test tests/chat-stream.test.js tests/auth-lifecycle.test.js
```

### Results Summary
- **Total Tests:** 26
- **Passed:** 26
- **Failed:** 0
- **Suites:** 6
- **Execution Duration:** ~10 seconds

### Detailed Breakdown

#### 1. `tests/auth-lifecycle.test.js` (14/14 Passed)
- `POST /api/auth/token` issues valid signed JWT when `JWT_SECRET` is configured: **PASS**
- `GET /api/auth/token` works for script-tag initialization: **PASS**
- `POST /api/auth/token` rejects protected assistants with 403 `FORBIDDEN_ASSISTANT`: **PASS**
- `POST /api/auth/token` returns null token when `JWT_SECRET` is not configured: **PASS**
- `AssistantApiClient` automatically acquires demo token and succeeds in production mode: **PASS**
- `POST /api/chat/stream` rejects missing credentials with 401 in production mode: **PASS**
- `POST /api/chat/stream` rejects invalid JWT signature with 401: **PASS**
- `POST /api/chat/stream` rejects expired JWT token with 401 `EXPIRED_TOKEN`: **PASS**
- `POST /api/chat/stream` succeeds with valid Bearer token: **PASS**
- Host integration `getAuthHeaders` takes precedence over demo token: **PASS**
- `SessionManager` enforces tenant isolation for authenticated host users: **PASS**
- `POST /api/documents/upload` succeeds with valid demo token and consent: **PASS**
- `POST /api/documents/upload` rejects missing consent even with valid token: **PASS**
- `POST /api/documents/upload` rejects missing credentials when required: **PASS**

#### 2. `tests/chat-stream.test.js` (12/12 Passed)
- Health endpoint uses configured provider health check: **PASS**
- Lazy PDF worker parses synthetic PDF document: **PASS**
- Vercel catch-all path normalization retains query parameters: **PASS**
- Chat stream accepts Vercel rewritten path and invokes provider: **PASS**
- Chat request body produced by widget API client matches backend contract: **PASS**
- Chat stream resolves registered actions and emits proposed action: **PASS**
- Invalid chat request returns 400 without invoking provider: **PASS**
- Production chat rejects missing credentials before invoking provider: **PASS**
- Health passes while production chat fails closed on missing auth: **PASS**
- Pre-stream production failures log exception and retain generic response: **PASS**
- Production SSE provider failures are logged safely: **PASS**
- Server error logger redacts credentials and excludes request body: **PASS**

### Status of Pre-existing Tests
- In commit `d934041` (prior to this task), 18 legacy test files were removed from the working tree.
- Existing tests were preserved without deletions, and complete coverage of the authentication and chat lifecycle was re-established in `tests/auth-lifecycle.test.js` and `tests/chat-stream.test.js`.

---

## I. Build Verification

Widget build was executed via `npm run build:widget`:
```text
> ai-assistant-plugin@1.0.0 build:widget
> node widget/build.js

[Build] Building Standalone AI Assistant SDK...
[Build] Bundle generated: widget/dist/assistant.js & public/sdk/assistant.js (100.9 KB)
[Build] Minified bundle: widget/dist/assistant.min.js & public/sdk/assistant.min.js (68.6 KB)
[Build] Build completed successfully.
```
Both unminified and minified bundles were compiled with esbuild and copied to `public/sdk/` for Vercel static serving.

---

## J. Production Verification

- **Production Verification Status:** Local testing has verified the complete workflow under production conditions (`NODE_ENV=production`, `AUTH_MODE=jwt`, `JWT_SECRET` configured).
- **Live Vercel Deployment:** In strict accordance with working rule 14 (*"Do not deploy, commit, or push"*), no Git push or automatic deployment was executed against the live Vercel environment.
- The manual deployment procedure below is ready for execution by repository administrators.

---

## K. Manual Vercel Deployment Steps

After reviewing this report and the git diff:

1. **Verify Git Status and Staged Changes:**
   ```bash
   git status
   ```
   Ensure the following modified/untracked files are present:
   - `backend/src/app.js`
   - `backend/src/middleware/auth.js`
   - `backend/src/routes/auth.js`
   - `widget/src/api-client.js`
   - `widget/src/sdk.js`
   - `widget/dist/*` and `public/sdk/*`
   - `tests/auth-lifecycle.test.js`
   - `SDK_LEVEL3_INTEGRATION_GUIDE.md`

2. **Stage and Commit:**
   ```bash
   git add backend/src/app.js backend/src/middleware/auth.js backend/src/routes/auth.js
   git add widget/src/api-client.js widget/src/sdk.js
   git add widget/dist/ public/sdk/
   git add tests/auth-lifecycle.test.js SDK_LEVEL3_INTEGRATION_GUIDE.md FINAL_AUTHENTICATION_ROOT_CAUSE_AND_FIX_REPORT.md
   git commit -m "fix(auth): implement demo token acquisition for standalone widget and enforce protected auth"
   ```

3. **Push to Remote:**
   ```bash
   git push origin main
   ```

4. **Verify Vercel Environment Variables:**
   In the Vercel Dashboard for `aiassistant-mu-mauve`:
   - Navigate to **Settings > Environment Variables**.
   - Verify `JWT_SECRET` is configured for **Production** and **Preview**.
   - Verify `GEMINI_API_KEY` (or `OPENAI_API_KEY`) is active.

5. **Verify Live Deployment:**
   - Open `https://aiassistant-mu-mauve.vercel.app/demo`.
   - Open DevTools Network tab.
   - Send a message in the widget.
   - Observe:
     1. `POST /api/auth/token` returns `200 OK` with `{ token: "..." }`.
     2. `POST /api/chat/stream` returns `200 OK` (SSE streaming) with header `Authorization: Bearer <token>`.
     3. Assistant responds with streaming text without any 401 error.

---

## L. Remaining Production Considerations

1. **In-Memory Session Store in Serverless Runtime:**
   - In Vercel's serverless environment, separate function invocations may hit different Lambda instances.
   - The current `SessionManager` uses in-memory storage (`backend/src/session-manager.js`). While single-turn chat streams and immediate document queries succeed, long-lived multi-turn sessions across multiple serverless instances will benefit from Redis/Upstash session backing in a future milestone.
2. **AI Provider Rate Limits:**
   - Ensure the upstream provider account (Gemini or OpenAI) has sufficient quota and is not being rate-limited.

