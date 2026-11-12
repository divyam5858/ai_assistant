# HirePool AI Assistant — Authentication Handoff and Session Ownership Fix Report

**Date:** November 9, 2026  
**SDK Repository:** `D:\ai-assistant-plugin`  
**Reference Repository (Strictly Read-Only):** `D:\talenthub-develop`  
**Status:** FULLY REMEDIATED & VERIFIED (130/130 Passing Automated Tests + Live Port 3100 Verified)

---

## 1. Executive Summary

During real-browser integration testing of the HirePool Candidate, Company, and Consultancy registration and onboarding flow, user account creation completed on the backend, but the in-chat assistant failed at two critical transition junctures:

1. **HTTP 404 Smoke Test Error:**
   ```text
   Authentication smoke test failed: Session validation failed (HTTP 404)
   ```
2. **Permanent Cross-User Lockout:**
   ```text
   Access denied: session belongs to another user
   ```
3. **Missing Signup Confirmation:** The user was never presented with the role-tailored completion confirmation bubble or quick-action prompt pills.

A comprehensive root-cause analysis was conducted across `backend/src/app.js`, `backend/src/local-integrations/hirepool-auth.js`, `backend/src/routes/hirepool-signup.js`, `backend/src/session-manager.js`, `widget/src/widget.js`, `widget/src/api-client.js`, and `widget/src/storage.js`.

All identified issues have been remediated, verified with a dedicated 13-scenario integration test suite (`tests/hirepool-auth-handoff.test.js`), and validated against the live server running on `http://localhost:3100`.

---

## 2. Root-Cause Analysis

### 2.1 The HTTP 404 on `GET /api/hirepool/session/validate`
Three distinct factors contributed to the HTTP 404 failure:
1. **Server Process Disconnect:** The background server process on port 3100 (`node --env-file=backend/.env backend/src/server.js`) had been spawned before the route `GET /session/validate` was added to `hirePoolAuthRouter`. Express returned standard 404 HTML (`Cannot GET /api/hirepool/session/validate`).
2. **Origin Policy Filtering:** `backend/src/app.js` contained an origin policy middleware that blocked any request starting with `/api/hirepool/` originating from dashboard origins (`HIREPOOL_LOCAL_DASHBOARD_ORIGINS`, port 5173) with HTTP 403 `ORIGIN_NOT_ALLOWED`, allowing only `POST /api/hirepool/session`. When a newly verified user was redirected to or opened from the dashboard (`http://localhost:5173`), session validation was rejected. Furthermore, `getAllowedOrigins()` in `hirepool-auth.js` only checked `HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS` (ports 3000, 3001), ignoring port 5173.
3. **Route Redundancy Absence:** While `createHirePoolSignupRouter` was mounted at `/api/hirepool/signup` and accepted public site origins, it lacked a `/validate` endpoint. If `/session/validate` on `hirePoolAuthRouter` was unavailable or had strict origin limitations, the widget had no fallback route.

### 2.2 The Session Ownership Failure (`Access denied: session belongs to another user`)
1. **Conversation ID Re-use Across User Identities:** In `AssistantStorage` (`widget/src/storage.js`), `conversation_id`, `messages`, and `documents` were stored without user namespacing (under a single prefix `ai_assistant_${assistantId}_`).
2. **Cross-User Collision in Browser Session:** When Candidate A completed testing in a browser tab, a conversation ID was stored in browser storage and tracked in `SessionManager`'s memory bound to `session.userId = 'user-A'`. When the browser was reloaded or another account (Candidate B) was tested in the same tab, `this.activeConversationId` was reloaded from storage.
3. **Unforgiving SessionManager Ownership Check:** In `backend/src/session-manager.js`, `validateOwnership(session, options)` checked:
   ```javascript
   if (options.enforceOwnership !== false && session.userId && session.userId !== (options.userId || null)) {
     throw new SessionOwnershipError();
   }
   ```
   Because `session.userId` was `'user-A'` and the incoming message carried Candidate B's credentials (`userId: 'user-B'`), `SessionManager` correctly threw `SessionOwnershipError` (HTTP 403 `SESSION_ACCESS_DENIED`).
4. **Client-Side Lockout Without Retry:** In `widget/src/widget.js`, `sendMessage` did not catch `SESSION_ACCESS_DENIED` or "belongs to another user". Instead, it surfaced the error banner and preserved `this.activeConversationId`. Every subsequent message sent by Candidate B attempted to reuse Candidate A's conversation ID, permanently locking out the user until browser storage was cleared.

### 2.3 The Missing Confirmation Display
In `widget/src/widget.js`, the smoke test was executed inside a try/catch block where any smoke test failure threw an exception that bypassed Step 16 (`_displaySignupConfirmation`). The assistant never informed the user that their HirePool account had been successfully created on the server and left them with a fatal error banner.

---

## 3. Architecture & Code Remediations

### 3.1 Backend Route & Origin Allowlisting
- **File:** `backend/src/app.js`
  - Updated origin gatekeeper middleware to permit `GET /api/hirepool/session/validate` and `OPTIONS /api/hirepool/session/validate` from `HIREPOOL_LOCAL_DASHBOARD_ORIGINS` (`http://localhost:5173`, `http://127.0.0.1:5173`) in addition to existing session exchange.
- **File:** `backend/src/local-integrations/hirepool-auth.js`
  - Added `assertSessionValidateOrigin(req)` permitting:
    - `HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS` (`http://localhost:3000`, `3001`)
    - `HIREPOOL_LOCAL_DASHBOARD_ORIGINS` (`http://localhost:5173`)
    - `HIREPOOL_LOCAL_EXTENSION_ORIGIN`
    - Omitting `Origin` header during test/development environments.
  - Normalized `expiresIn` calculation to return seconds remaining:
    ```javascript
    expiresIn: Math.max(0, Math.floor((context.expiresAt - Date.now()) / 1000))
    ```
- **File:** `backend/src/routes/hirepool-signup.js`
  - Added `router.get('/validate', ...)` to `createHirePoolSignupRouter` so that `/api/hirepool/signup/validate` is available as a parallel validation path for the widget.

### 3.2 Widget Storage Namespacing
- **File:** `widget/src/storage.js`
  - Added `setUser(userId)` and `userScope` to `AssistantStorage`.
  - Global properties (`hirepool_session`, `is_open`) remain scoped to the assistant instance.
  - Conversational properties (`conversation_id`, `messages`, `documents`) are isolated per user namespace (`usr_${userId}_` or `guest_`).
  - Seamless fallback to un-scoped keys ensures backward compatibility with legacy guest conversations.

### 3.3 Resilient Widget Authentication Handoff
- **File:** `widget/src/api-client.js`
  - In `sendMessage`: Attached `error.status = response.status` and `error.code = errData?.error?.code`.
  - In `validateHirePoolSession`: Added automatic fallback to `/api/hirepool/signup/validate` if `/api/hirepool/session/validate` returns 404.
- **File:** `widget/src/widget.js`
  - **Scoped Initialization:** `_handleHirePoolSignupSuccess` updates storage scope via `this.storage.setUser(newUserId)`. If a prior session belonged to a different user, it clears stale conversation state and message history before establishing the new account.
  - **Recoverable Smoke Test:** If `apiClient.validateHirePoolSession` fails, the widget does NOT claim signup failed. It displays a recoverable warning banner:
    `Account created successfully! However, assistant session verification timed out. [Retry Connection]`
    Clicking `[Retry Connection]` re-executes verification.
  - **Background Session Validation:** In `_restoreState()`, cached sessions are verified in the background. If invalid or expired, the widget silently falls back to guest mode without breaking the UI.

### 3.4 Automatic Recovery from `SESSION_ACCESS_DENIED`
- **File:** `widget/src/widget.js`
  - Updated `sendMessage(text)` with an internal retry wrapper `sendAttempt(isRetry)`.
  - If the server responds with HTTP 403 `SESSION_ACCESS_DENIED` or message contains `"belongs to another user"`:
    1. Detects cross-user session conflict on the initial attempt (`!isRetry`).
    2. Logs a diagnostic warning: `[AI Assistant] Conversation ownership conflict detected; resetting conversation ID and retrying...`.
    3. Resets `this.activeConversationId = null` and calls `this.storage.clearConversationId()`.
    4. Removes any partial assistant bubble and retries delivery once with `isRetry = true`.
    5. The backend automatically creates a fresh conversation bound to the active authenticated user, and the message succeeds without user interruption.

### 3.5 Guaranteed Role-Tailored Signup Confirmation
- **File:** `widget/src/widget.js`
  - Extracted confirmation logic into `_displaySignupConfirmation(sessionData)`.
  - Generates tailored welcome greetings, markdown confirmation bubbles, and quick-action prompt chips for all three roles:
    - **Candidate:** "Find matching jobs", "View my profile", "My applications"
    - **Client / Company:** "View my jobs", "View company profile", "Dashboard stats"
    - **Consultancy / Agency:** "View candidate pool", "Add a candidate", "Placement stats", "View agency profile"
  - Appends confirmation to `this.messages` and calls `this._persistState()` so the greeting persists across tab reloads.

---

## 4. Verification & Evidence Matrix

### 4.1 Phase 5 Automated Test Suite (`tests/hirepool-auth-handoff.test.js`)
All 13 specific scenarios were implemented and executed:

| Scenario # | Description | Target Component | Status | Duration |
|:---:|:---|:---|:---:|:---:|
| 1 | `GET /session/validate` returns 401 `MISSING_CREDENTIALS` without token | `hirepool-auth.js` | **PASS** | 71.6 ms |
| 2 | `GET /session/validate` returns 401 `INVALID_CREDENTIALS` with invalid token | `hirepool-auth.js` | **PASS** | 13.7 ms |
| 3 | `GET /session/validate` returns 200 with valid session data with valid SDK token | `hirepool-auth.js` | **PASS** | 10.1 ms |
| 4 | Origin allowlist check: allows port 3000, 5173; rejects `http://untrusted-site.com` | `app.js` & `hirepool-auth.js` | **PASS** | 20.6 ms |
| 5 | `SessionManager`: anonymous session (`userId: null`) atomically upgrades when `userId` is supplied | `session-manager.js` | **PASS** | 0.8 ms |
| 6 | `SessionManager`: rejects access when `session.userId !== requested userId` (403 `SESSION_ACCESS_DENIED`) | `session-manager.js` | **PASS** | 1.6 ms |
| 7 | `SessionManager`: allows access when `session.userId === requested userId` | `session-manager.js` | **PASS** | 0.3 ms |
| 8 | `AssistantApiClient.validateHirePoolSession()` parses 200 and throws on 401 | `api-client.js` | **PASS** | 1.6 ms |
| 9 | `_handleHirePoolSignupSuccess` completes handoff for Candidate, Client, Consultancy | `widget.js` | **PASS** | 1.0 ms |
| 10 | `_handleHirePoolSignupSuccess` renders recoverable warning with retry on smoke test failure | `widget.js` | **PASS** | 0.5 ms |
| 11 | Widget recovers from `SESSION_ACCESS_DENIED` by resetting conversation ID and retrying | `widget.js` | **PASS** | 0.5 ms |
| 12 | Widget storage namespacing prevents cross-user conversation contamination | `storage.js` | **PASS** | 2.4 ms |
| 13 | Complete signup-to-authenticated-chat pipeline executes without 404 or ownership errors | Full Stack Integration | **PASS** | 1070.2 ms |

### 4.2 Comprehensive Test Suite Results
- `tests/hirepool-auth-handoff.test.js`: **14 / 14 passing**
- `tests/hirepool-signup-transition.test.js`: **4 / 4 passing**
- `tests/hirepool-signup.test.js`: **8 / 8 passing**
- `tests/immediate-fixes.test.js`: **7 / 7 passing**
- `npm run test:mock`: **116 / 116 passing**
- **Total passing tests:** **130 / 130** (0 failing, 0 skipped)

### 4.3 Live Server Verification (Port 3100)
A clean backend server was restarted with `--env-file=backend/.env` on port 3100 and tested via direct HTTP requests:

```bash
# Test 1: Unauthenticated validation request from website origin (http://localhost:3000)
curl.exe -i -H "Origin: http://localhost:3000" http://localhost:3100/api/hirepool/session/validate
HTTP/1.1 401 Unauthorized
{"error":{"code":"MISSING_CREDENTIALS","message":"An SDK session credential is required"}}

# Test 2: Unauthenticated validation request from dashboard origin (http://localhost:5173)
curl.exe -i -H "Origin: http://localhost:5173" http://localhost:3100/api/hirepool/session/validate
HTTP/1.1 401 Unauthorized
Access-Control-Allow-Origin: http://localhost:5173
{"error":{"code":"MISSING_CREDENTIALS","message":"An SDK session credential is required"}}

# Test 3: Invalid token verification from website origin
curl.exe -i -H "Origin: http://localhost:3000" -H "Authorization: Bearer invalid-token-123" http://localhost:3100/api/hirepool/session/validate
HTTP/1.1 401 Unauthorized
{"error":{"code":"INVALID_CREDENTIALS","message":"The SDK session is no longer valid"}}

# Test 4: Preflight OPTIONS request from dashboard origin (http://localhost:5173)
curl.exe -i -X OPTIONS -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: GET" http://localhost:3100/api/hirepool/session/validate
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
```

### 4.4 Widget Distribution Bundle
Rebuilt via `node widget/build.js`:
- `widget/dist/assistant.js` & `public/sdk/assistant.js`: **199.2 KB**
- `widget/dist/assistant.min.js` & `public/sdk/assistant.min.js`: **135.7 KB**

---

## 5. Operating Procedures & Boundary Guarantees

1. **Strict Repository Boundary:** All changes were made exclusively inside `D:\ai-assistant-plugin`. The HirePool reference repository (`D:\talenthub-develop`) was inspected strictly in read-only mode and zero files were modified there.
2. **Security & Session Integrity:** Session ownership checks in `SessionManager` and `chatRouter` were strictly maintained without weakening. Cross-tenant and cross-user boundaries remain enforced with HTTP 403 `SESSION_ACCESS_DENIED`.
3. **Graceful Client Recovery:** Rather than bypassing backend security, the client SDK now recognizes session ownership mismatches, namespaces its local storage by user ID, resets stale conversation references, and retries message delivery atomically.
4. **Resilient UX:** The in-chat signup workflow guarantees that once account creation succeeds, the user is never told their signup failed due to a validation timeout; instead, a recoverable retry option is provided while preserving user account data.
