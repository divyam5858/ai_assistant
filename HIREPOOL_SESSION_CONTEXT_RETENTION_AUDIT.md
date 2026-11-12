# HirePool AI Assistant — Session Persistence & Context Retention Workflow Audit

> **Audit Scope & Method**: Investigation-only, evidence-based technical audit across the AI Assistant SDK (`D:\ai-assistant-plugin`) and the read-only HirePool web/dashboard integration (`D:\talenthub-develop`). Zero source code, configuration files, or tests were modified during this audit. Every file path, symbol, line number, regex, constant, and test outcome below is derived directly from source inspection and verified test runs.

---

## Executive Summary

The reproduced failure—where the assistant greets a new visitor normally, answers turns 1–2 (`"I'm new to HirePool."`, `"I'm looking for job opportunities."`), and then abruptly responds on turn 3 (`"I'm new, I don't have an account."`) and every subsequent message with:

> *"I can’t verify a HirePool login from this assistant in the current setup, so I can’t retrieve account or application information here. Please use HirePool directly; this assistant has not accessed your account data."*

is **NOT caused by session TTL expiration, `conversationId` rotation, or `sessionStorage` wiping**.

Instead, the **confirmed direct root cause** is a stateful unauthenticated short-circuit and latch in [`getUnverifiedHirePoolResponse`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L99-L136) combined with post-LLM flagging in [`POST /api/chat`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2013-L2015) and [`POST /api/chat/stream`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2256-L2258):

1. When an unauthenticated visitor says *"I'm looking for job opportunities."*, the LLM (offered `hirepool_login` and `hirepool_signup` by [`addHirePoolGuestLoginAction`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L138-L179)) proposes the `hirepool_login` action card.
2. Post-response handling latches **`session.hirePoolLoginOffered = true`** on the server session.
3. On the next message (*"I'm new, I don't have an account."*), the HirePool domain policy allows the turn through (because `account` is a recruitment term), and `getUnverifiedHirePoolResponse()` checks:
   - `isHirePoolLoginClaim(message)` → `false`
   - `isHirePoolSignupRequest(message)` → **`false`** (regex only checks `sign up`, `signup`, `register`, `registration`, `create [an] account`, `new account` — not `"I'm new"` or `"don't have an account"`)
   - `isHirePoolLoginRequest(message)` → `false`
   - `isHirePoolAccountRequest(message)` → `false`
4. Execution enters [`chat.js#L106-L110`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L106-L110):
   ```js
   if (!signupRequested && !isHirePoolLoginRequest(message) && !isHirePoolAccountRequest(message)) {
     if (session.hirePoolLoginOffered) {
       return { text: HIREPOOL_AUTH_LIMITATION_MESSAGE };
     }
     return null;
   }
   ```
5. The backend **short-circuits before reading conversation history or calling the LLM**, returning `HIREPOOL_AUTH_LIMITATION_MESSAGE`. Because `session.hirePoolLoginOffered` is never cleared unless full HirePool authentication completes (`verifiedHirePoolUser` at [`chat.js#L1870-L1873`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L1870-L1873) / [`#L2063-L2066`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2063-L2066)), every non-login/non-signup follow-up (such as repeating *"I'm new to HirePool."* or *"I'm looking for a job."*) hits the exact same guard permanently.

Beyond this primary defect, the audit identified **six confirmed secondary bugs and architectural context-loss vectors**:
1. **Context-blind domain policy misclassifications** ([`domain-policy.js`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js#L187-L277)) that drop *"What can you do?"* (`OUT_OF_SCOPE`), *"Tell me more"* (`AMBIGUOUS`), and *"Continue." / "Yes." / "Show me."* (`AMBIGUOUS`/`OUT_OF_SCOPE` for unauthenticated visitors).
2. **Dead conversation summarization due to conflicting truncation limits**: [`SessionManager.addMessage`](file:///d:/ai-assistant-plugin/backend/src/session-manager.js#L201-L205) truncates `session.messages` to **20 items** ([`config/defaults.js#L11`](file:///d:/ai-assistant-plugin/config/defaults.js#L9-L12)), making the **28-item threshold** in [`history-manager.js`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L8) (`MAX_PROVIDER_HISTORY_ITEMS = 28`) unreachable on active server sessions; [`summarizeEarlierHistory()`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L137-L160) is dead code in production.
3. **Widget auth/expiry recovery gaps** in [`widget.js`](file:///d:/ai-assistant-plugin/widget/src/widget.js): unhandled `410 SESSION_EXPIRED`, double `handleError` / double-retry invocation with [`api-client.js#L336`](file:///d:/ai-assistant-plugin/widget/src/api-client.js#L336), guest fallback keeping an authenticated `conversationId` ([`widget.js#L418-L425`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L418-L425)), and fragile `isGuest` detection ([`widget.js#L1566`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1566)).
4. **Host `expiresIn` mismatch & 5-minute revocation timer**: [`hirepool-session-store.js`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-session-store.js#L6-L8) defaults `SESSION_TTL_MS` to 24 hours (`86400000 ms`), whereas read-only HirePool hosts ([`LocalAssistantWidget.tsx#L299-L300`](file:///d:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L299-L300), [`AuthContext.tsx#L128`](file:///d:/talenthub-develop/frontend/src/contexts/AuthContext.tsx#L128)) reject `expiresIn > 300000 ms` (5 minutes), and `LocalAssistantWidget.tsx#L356` hard-revokes the token when the timeout elapses.
5. **Ephemeral in-memory host & signup state across page reloads**: tab-login credentials in [`LocalAssistantWidget.tsx`](file:///d:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L229-L341) live only in React `useRef`s, and in-chat signup step state in [`HirePoolSignupCoordinator`](file:///d:/ai-assistant-plugin/widget/src/hirepool-signup.js#L84-L97) lives only in JS heap memory.
6. **Process-local in-memory backend `Map`s on serverless infrastructure** ([`vercel.json`](file:///d:/ai-assistant-plugin/vercel.json)): all conversation, session, onboarding, continuation, and dynamic-API confirmation maps reside solely in Node process memory without a shared store.

---

## 1. Current Session Architecture

The HirePool AI Assistant splits conversation state, identity state, workflow flags, and browser persistence across four distinct layers:

### 1.1 Browser / Widget Layer (`widget/src/`)
| Component | Storage Mechanism | Scope & Keys | Data Held | Source |
| :--- | :--- | :--- | :--- | :--- |
| `AssistantStorage` | `window.sessionStorage` (fallback: in-memory `MemoryStore`) | Unscoped: `ai_assistant_${assistantId}_hirepool_session`, `_is_open` | Persisted in-chat signup HirePool SDK credential & UI open flag | [`storage.js`](file:///d:/ai-assistant-plugin/widget/src/storage.js) |
| `AssistantStorage` (scoped) | `window.sessionStorage` | User-scoped (`guest_` or `usr_<id>_`): `conversation_id`, `messages`, `documents` | Active `conversationId`, rendered chat transcript, uploaded doc metadata | [`storage.js`](file:///d:/ai-assistant-plugin/widget/src/storage.js), [`sdk.js`](file:///d:/ai-assistant-plugin/widget/src/sdk.js) |
| `AssistantWidgetUI` | JS instance fields | In-memory for widget lifecycle | `activeConversationId`, `messages`, `hostIdentity` | [`widget.js`](file:///d:/ai-assistant-plugin/widget/src/widget.js) |
| `HirePoolSignupCoordinator` | JS instance fields | In-memory (`HIREPOOL_SIGNUP_STATES`, 20 FSM states) | `selectedRole`, `agreement`, `session`, `profileData` (NOT written to `sessionStorage`) | [`hirepool-signup.js#L84-L97`](file:///d:/ai-assistant-plugin/widget/src/hirepool-signup.js#L84-L97) |
| `hirepool-login.js` | Module variable | In-memory (`activeAccountWindow`) | Popup/tab handle for HirePool login/signup | [`hirepool-login.js`](file:///d:/ai-assistant-plugin/widget/src/hirepool-login.js) |

### 1.2 Host Application Layer (Read-Only `D:\talenthub-develop`)
| Host App | Component | Credential Storage | Expiry / Lifecycle Handling | Source |
| :--- | :--- | :--- | :--- | :--- |
| Public Next.js Site | `LocalAssistantWidget` | React `useRef`s (`sdkCredential`, `authState`) — cleared on full page reload | Accepts `expiresIn` only in `[1000, 300000]` ms (`#L299-L300`); sets `window.setTimeout(..., data.expiresIn)` (`#L356`) to revoke SDK credential and reset ref to `null` | [`LocalAssistantWidget.tsx#L229-L356`](file:///d:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L229-L356) |
| Authenticated Dashboard | `AuthContext` + `HirePoolAssistant` | React context / wrapper passing host auth headers | Validates `expiresIn >= 1000 && expiresIn <= 300000` (`AuthContext.tsx#L128`) | [`AuthContext.tsx#L128`](file:///d:/talenthub-develop/frontend/src/contexts/AuthContext.tsx#L128), [`HirePoolAssistant.tsx`](file:///d:/talenthub-develop/frontend/src/components/assistant/HirePoolAssistant.tsx) |

### 1.3 Backend Middleware, Auth & Routing Layer (`backend/src/`)
- **App initialization & origin gate** ([`app.js#L29-L78`](file:///d:/ai-assistant-plugin/backend/src/app.js#L29-L78)): Mounts `hirePoolAuthRouter`, `createHirePoolResumeRouter()`, and `createHirePoolSignupRouter()` when `isHirePoolLocalBridgeEnabled()` is true (`#L127-L131`). Blocks `/api/hirepool/*` calls from `HIREPOOL_LOCAL_DASHBOARD_ORIGINS` except `POST /api/hirepool/session` and `GET /api/hirepool/session/validate` (plus preflight `OPTIONS`).
- **Authentication middleware** ([`auth.js#L312-L318`](file:///d:/ai-assistant-plugin/backend/src/middleware/auth.js#L312-L318)): `authenticate` resolves credentials via `extractCredentials(req)` and checks `findHirePoolContextBySdkCredential(creds.token)` *before* HS256 JWT or API-key authentication, creating a verified principal via `createHirePoolPrincipal(...)`. When no credentials are supplied and auth is optional, `req.user` is set to `null`.
- **Guest demo token exclusion** ([`auth.js` route](file:///d:/ai-assistant-plugin/backend/src/routes/auth.js)): `PUBLIC_ASSISTANT_IDS` lists `default`, `researcher`, `support`, `coder`, `integration-demo`. `'hirepool'` is explicitly excluded (`403 FORBIDDEN_ASSISTANT`), so anonymous HirePool visitors run with `req.user = null` rather than a demo JWT.
- **Session scoping helper** ([`session-scope.js`](file:///d:/ai-assistant-plugin/backend/src/session-scope.js)): `createSessionOptions(user, assistantId)` derives session ownership, tenant, and metadata scoping from `req.user` and `assistantId`.

### 1.4 Backend In-Memory State Stores & Serverless Topology
Every stateful backend structure resides inside process-local JavaScript `Map` instances:
- `SessionManager` ([`session-manager.js`](file:///d:/ai-assistant-plugin/backend/src/session-manager.js)): `sessions` `Map`, `expiredSessions` `Map`, 5-minute cleanup interval.
- HirePool session store ([`hirepool-session-store.js`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-session-store.js)): `contextsByCredential` `Map`, `credentialsByAccessToken` `Map`, `inFlightRefreshes`, 30-second cleanup timer.
- HirePool continuation store ([`hirepool-continuation-store.js`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-continuation-store.js)): `continuationsByReferenceDigest` `Map` (`MAX_CONTINUATIONS = 1000`), 30-second cleanup timer.
- In-chat signup onboarding store ([`routes/hirepool-signup.js`](file:///d:/ai-assistant-plugin/backend/src/routes/hirepool-signup.js)): `onboardingSessions` `Map`, 60-second cleanup timer.
- Resume upload & dynamic API confirmation stores ([`hirepool-resume.js`](file:///d:/ai-assistant-plugin/backend/src/routes/hirepool-resume.js), [`dynamic-api/catalog.js`](file:///d:/ai-assistant-plugin/backend/src/dynamic-api/catalog.js)): `pendingResumeUploads`, `pendingConfirmations`, `confirmationOutcomes`.
- Deployment routing ([`vercel.json#L5-L44`](file:///d:/ai-assistant-plugin/vercel.json#L5-L44)): Rewrites `/api/:path*` to serverless catch-all `/api/[...path]` with `maxDuration: 60`. No external database, Redis, or KV store backs session or auth state.

---

## 2. Complete Frontend-to-Backend Session Lifecycle

### 2.1 Initial Widget Load & Guest Boot
1. Host embeds SDK (`AssistantSDK.init()`) with optional `HostIntegrationAdapter` ([`sdk.js`](file:///d:/ai-assistant-plugin/widget/src/sdk.js), [`integration.js`](file:///d:/ai-assistant-plugin/widget/src/integration.js)).
2. [`AssistantWidgetUI._restoreState()`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L374-L399) checks unscoped `ai_assistant_hirepool_hirepool_session` in `sessionStorage`.
   - **If absent (anonymous visitor)**: `storage` remains scoped to `guest_`, loading any saved `guest_conversation_id` and `guest_messages`.
   - **If present (prior in-chat signup in the same browser tab)**: `_restoreState()` optimistically calls `storage.setUser(savedSession.identity?.id)`, patches `this.options.integration.getAuthHeaders`, and fires an **unawaited** `void this.apiClient.validateHirePoolSession(...)`.

### 2.2 Standard Chat Turn (`POST /api/chat` and `POST /api/chat/stream`)
1. [`AssistantWidgetUI.sendMessage()`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1556-L1690) immediately appends the user message to `this.messages` and persists locally (`#L1556`).
2. It evaluates `isGuest` via `!this.options.context?.authentication?.identity` (`#L1566`) and builds a fallback `history` array sliced to the last 25 turns (`#L1629`).
3. [`AssistantApiClient.sendMessage()`](file:///d:/ai-assistant-plugin/widget/src/api-client.js) attaches `getAuthHeaders()` (empty for unauthenticated guests, `Authorization: Bearer <sdkToken>` for authenticated users) and posts `{ conversationId, message, history, context, assistantId: 'hirepool' }`.
4. Backend `authenticate` resolves `req.user` (`null` for guests, HirePool principal for valid SDK tokens).
5. Chat route calls `sessionManager.getOrCreate(conversationId, createSessionOptions(req.user, assistantId))`:
   - Checks `_getActiveSession(conversationId)` ([`session-manager.js#L142-L144`](file:///d:/ai-assistant-plugin/backend/src/session-manager.js#L142-L144)): throws `SessionExpiredError` (`410 SESSION_EXPIRED`) if present in `expiredSessions` or past `ttlMs`.
   - Checks `validateOwnership`: throws `SessionOwnershipError` (`403 SESSION_ACCESS_DENIED`) if `session.userId` mismatches `req.user.id` (note: an anonymous session with `userId: null` can upgrade atomically when `userId` is first supplied).
6. For `assistantId === 'hirepool'`:
   - `verifiedHirePoolUser` is evaluated; if true, `session.hirePoolLoginOffered = false` and `session.hirePoolAccountActionOffered = null` ([`chat.js#L1870-L1873`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L1870-L1873), [`#L2063-L2066`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2063-L2066)). If `authUser.role === 'candidate'`, `session.hirePoolWorkflow` is initialized (`#L1874`).
   - Runs [`classifyHirePoolMessage(message, session, options)`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js#L187-L277). If `OUT_OF_SCOPE`, returns static refusal and tags turn `isOutOfScope: true, scope: 'OUT_OF_SCOPE'` ([`chat.js#L1906-L1907`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L1906-L1907), [`#L2112-L2113`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2112-L2113)).
   - If `!verifiedHirePoolUser`, calls [`getUnverifiedHirePoolResponse(message, session, registry)`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L99-L136) **before** history assembly or LLM invocation.
   - Otherwise calls provider with history built by [`history-manager.js`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js), executes any action/tool calls via `processActionOrToolCalls`, records messages via `sessionManager.addMessage()`, and latches `session.hirePoolLoginOffered = true` if the response included `hostAction?.action === 'hirepool_login'` ([`chat.js#L2013-L2015`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2013-L2015), [`#L2256-L2258`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2256-L2258)).

### 2.3 Error & Recovery Path Inside the Widget
- When `sendMessage()` fails in `api-client.js`, [`api-client.js#L336`](file:///d:/ai-assistant-plugin/widget/src/api-client.js#L336) invokes `if (onError) onError(err)` **and** `throw err`.
- In [`widget.js#L1683-L1689`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1683-L1689), both `onError` and `catch (err)` invoke `handleError(err)`, causing **double error handling** (and double retry on `403`).
- Inside `handleError` ([`widget.js#L1598-L1612`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1598-L1612)):
  - `403` / `SESSION_ACCESS_DENIED` resets `activeConversationId = null` and replays `sendAttempt(true)` using local `history`.
  - **`410` / `SESSION_EXPIRED` is NOT handled**, leaving the user stuck receiving HTTP 410 errors until they manually click New Chat (`newConversation()`).

### 2.4 Authentication Transitions (Tab Login vs. In-Chat Signup) & Session Clear
- **In-chat signup**: Stateful backend `onboardingSessions` (`30m` TTL across `/agreement`, `/register`, `/verify-email`, `/complete-profile`) transitions on completion via [`_handleHirePoolSignupSuccess`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1103-L1163), saving `hirepool_session` into `sessionStorage`, setting `userScope = usr_<id>_`, and validating the session via `GET /api/hirepool/session/validate`.
- **Tab login / Dashboard integration**: Host exchanges HirePool auth for an SDK token via `POST /api/hirepool/session` and triggers `refreshSessionScope()` (`sdk.js`) / `setHostIdentity()` (`widget.js`).
- **Explicit clear / New Conversation**: `newConversation()` (`widget.js`) calls `DELETE /api/sessions/:conversationId` / `POST /api/sessions/clear` ([`routes/sessions.js`](file:///d:/ai-assistant-plugin/backend/src/routes/sessions.js)) and clears scoped `sessionStorage` keys.
- **Background validation failure fallback**: If `_restoreState()`'s unawaited `validateHirePoolSession()` fails, [`_clearSessionAndFallbackToGuest()`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L418-L425) deletes `hirepool_session` and calls `storage.setUser(null)` **without resetting `this.activeConversationId` or `this.messages`**.

---

## 3. How Conversation History Is Stored and Retrieved

Conversation history exists in two places with misaligned truncation rules:

1. **Client-Side History (`sessionStorage` + Payload Fallback)**
   - Stored under `ai_assistant_${assistantId}_${userScope}_messages` in `window.sessionStorage` ([`storage.js`](file:///d:/ai-assistant-plugin/widget/src/storage.js)).
   - Survives same-tab `F5` refreshes (within `guest_` scope or when `hirepool_session` is preserved), wiped when the browser tab closes.
   - Sent with each chat request as `history`, capped at the last **25 messages** (`messages.slice(-25)` at [`widget.js#L1629`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1629)).

2. **Server-Side History (`SessionManager.addMessage`)**
   - Stored per `session` object in `SessionManager.sessions` (`Map`).
   - Enforces a hard limit of `MAX_MESSAGES_IN_CONTEXT = 20` ([`config/defaults.js#L9-L12`](file:///d:/ai-assistant-plugin/config/defaults.js#L9-L12)):
     ```js
     // backend/src/session-manager.js:201-205
     if (session.messages.length > this.maxContextMessages) {
       session.messages = session.messages.slice(-this.maxContextMessages);
     }
     ```
   - Anything older than the most recent 20 messages (roughly 10 user/assistant exchanges) is permanently evicted from server memory.

3. **History Assembly, Filtering, and Dead Summarization ([`history-manager.js`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L8-L160))**
   - [`buildProviderMessages`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L94-L132) prefers `session.messages` whenever `session.messages.length > 0`, falling back to `clientHistory` only when `session.messages` is empty (e.g., after a process restart or serverless cold start).
   - [`filterOutOfScopeMessages`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L58-L80) strips any previous messages tagged `isOutOfScope: true` or `scope: 'OUT_OF_SCOPE'` so rejected turns do not pollute context.
   - **Dead Summarization Bug**: `MAX_PROVIDER_HISTORY_ITEMS = 28` ([`history-manager.js#L8`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L8)). Because `SessionManager` already sliced `session.messages` to `<= 20` items (`#L201-L205`), `rawMessages.length > 28` is **mathematically impossible** on any active server session (`20 <= 28`). Consequently, [`summarizeEarlierHistory()`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L137-L160) never executes in production, and earlier turns (>20 messages) are silently dropped without summarization.

4. **SSE Disconnect History Asymmetry**
   - In [`POST /api/chat/stream`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2293), if the client disconnects/aborts (`req.on('close')`), `abortController.abort()` skips `sessionManager.addMessage()` on the server, while [`widget.js#L1556`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1556) had already written the user's message into local `messages` and `sessionStorage`.

---

## 4. How Authentication State Interacts with Session State

Authentication state directly governs storage isolation, backend session ownership, and backend short-circuit logic:

1. **Storage Scoping & Cross-User Isolation**
   - `AssistantStorage` isolates `conversation_id`, `messages`, and `documents` behind `guest_` vs. `usr_<id>_`.
   - `SessionManager.validateOwnership` checks `session.userId === req.user.id` and tenant parity; mismatches trigger `403 SESSION_ACCESS_DENIED` (`SessionOwnershipError`). An anonymous session (`userId: null`) can upgrade once to the newly logged-in user's ID.

2. **Verified Flag Gate & Workflow Initialization ([`routes/chat.js`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js))**
   - Only when `verifiedHirePoolUser` is truthy does the backend reset `session.hirePoolLoginOffered = false` and `session.hirePoolAccountActionOffered = null` ([`#L1870-L1873`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L1870-L1873), [`#L2063-L2066`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2063-L2066)).
   - Structured workflow tracking (`session.hirePoolWorkflow`) is only initialized for authenticated candidates (`authUser.role === 'candidate'` at `#L1874`). **Unauthenticated visitors have no structured visitor/onboarding state** other than the two boolean/string lockout flags (`hirePoolLoginOffered`, `hirePoolAccountActionOffered`).

3. **Widget `isGuest` Detection Fragility ([`widget.js#L1566`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1566))**
   - `sendMessage()` computes `const isGuest = !this.options.context?.authentication?.identity;` rather than checking `this.hostIdentity` or `apiClient` session state. When `options.context` is null or serialized as a JSON string ([`widget.js#L1621-L1627`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1621-L1627)), `options.context?.authentication` evaluates to `undefined`, making authenticated users appear as `isGuest = true` in client-side phrase checks (`#L1568-L1571`).

4. **Optimistic Reload & Guest Fallback Scope Collision ([`widget.js#L374-L425`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L374-L425))**
   - On page refresh after in-chat signup, `_restoreState()` switches `storage` to `usr_<id>_` before `validateHirePoolSession()` resolves. If the backend restarted or the credential expired, `_clearSessionAndFallbackToGuest()` reverts `storage` to `guest_` **without clearing `this.activeConversationId`**, causing subsequent guest messages carrying that authenticated `conversationId` to fail with `403 SESSION_ACCESS_DENIED` (forcing a double-retried new conversation).

5. **Host `expiresIn` Mismatch & Hard 5-Minute Revocation**
   - [`hirepool-session-store.js#L6-L8`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-session-store.js#L6-L8) defaults `SESSION_TTL_MS` to `24 * 60 * 60 * 1000` (24 hours) when `HIREPOOL_SESSION_TTL_MS` is unset, and `toPublicSession` ([`#L105`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-session-store.js#L105)) returns `expiresIn: SESSION_TTL_MS`.
   - Both read-only HirePool hosts ([`LocalAssistantWidget.tsx#L299-L300`](file:///d:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L299-L300) and [`AuthContext.tsx#L128`](file:///d:/talenthub-develop/frontend/src/contexts/AuthContext.tsx#L128)) enforce `expiresIn >= 1000 && expiresIn <= 300000` (5 minutes max). If `HIREPOOL_SESSION_TTL_MS` is left at its 24h default, tab-login handoff fails host validation; if overridden to `<= 300000`, `LocalAssistantWidget.tsx#L356` runs a hard timer that revokes the SDK session after at most 5 minutes.
   - Meanwhile, on the public website (`LocalAssistantWidget.tsx#L229-L341`), tab-login credentials exist solely in React `useRef`s, so any full page refresh resets the widget back to `anonymous`.

---

## 5. Root Cause Analysis

### 5.1 Confirmed Direct Root Cause of the Reproduced Conversation Lockout

**Exact Mechanism (`backend/src/routes/chat.js:37-136`, `2013-2015`, `2256-2258`)**:

Trace of the exact conversation reported by the user:

1. **Welcome**: Assistant displays welcome prompt with `"Log in to HirePool"` and `"Sign up for HirePool"`.
2. **User: `"I'm new to HirePool."`**
   - Domain policy: matches `/\bhirepool\b/i` ([`domain-policy.js#L109`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js#L109)) → `IN_SCOPE`.
   - `getUnverifiedHirePoolResponse`: `session.hirePoolLoginOffered` is still `false`/falsy, and no login/signup/account regex matches → returns `null`.
   - Turn proceeds to LLM; assistant explains HirePool and offers registration. `session.hirePoolLoginOffered` remains falsy because no `hirepool_login` `hostAction` was emitted.
3. **User: `"I'm looking for job opportunities."`**
   - Domain policy: `job` matches `recruitmentTerms` ([`domain-policy.js#L244`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js#L244)) → `IN_SCOPE`.
   - `getUnverifiedHirePoolResponse`: still returns `null`.
   - Turn proceeds to LLM with `hirepool_login` and `hirepool_signup` injected via [`addHirePoolGuestLoginAction`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L138-L179).
   - LLM explains login/registration is needed and attaches `hostAction: { action: 'hirepool_login', ... }`.
   - Post-LLM handler ([`chat.js#L2013-L2015`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2013-L2015) / [`#L2256-L2258`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2256-L2258)) executes:
     ```js
     if (assistantId === 'hirepool' && !verifiedHirePoolUser && hostAction?.action === 'hirepool_login') {
       session.hirePoolLoginOffered = true;
     }
     ```
     **State is now latched: `session.hirePoolLoginOffered = true`.**
4. **User: `"I'm new, I don't have an account."`**
   - Domain policy: `account` matches `recruitmentTerms` ([`domain-policy.js#L244`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js#L244)) → `IN_SCOPE`.
   - `getUnverifiedHirePoolResponse` checks regexes ([`chat.js#L83-L97`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L83-L97)):
     - `isHirePoolLoginClaim` → `false`
     - `isHirePoolSignupRequest` (`/\b(?:sign\s*up|signup|register|registration|create (?:an? )?account|new account)\b/i`) → **`false`** (does not match `"I'm new"` or `"don't have an account"`)
     - `isHirePoolLoginRequest` → `false`
     - `isHirePoolAccountRequest` → `false`
   - Lines `106-110` trigger:
     `if (session.hirePoolLoginOffered) return { text: HIREPOOL_AUTH_LIMITATION_MESSAGE };`
   - **Result**: Without calling the LLM or reading any prior turn, the assistant replies:
     `"I can’t verify a HirePool login from this assistant in the current setup, so I can’t retrieve account or application information here. Please use HirePool directly; this assistant has not accessed your account data."`
5. **User repeats `"I'm new to HirePool."` or `"I'm looking for a job."`**
   - Neither matches login/signup/account regexes. Both hit `if (session.hirePoolLoginOffered)` and receive the identical hardcoded `HIREPOOL_AUTH_LIMITATION_MESSAGE` forever.

*(Note: Even if the LLM had not emitted `hirepool_login` on turn 3, any turn matching `isHirePoolAccountRequest` or `isHirePoolLoginRequest` or `isHirePoolSignupRequest` sets BOTH `session.hirePoolLoginOffered = true` and `session.hirePoolAccountActionOffered = actionName` at [`chat.js#L117-L118`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L112-L118), reproducing the exact same permanent trap plus blocking any second request for signup/login via `session.hirePoolAccountActionOffered === actionName`.)*

---

### 5.2 Exact Trace Across Additional Unauthenticated Follow-Up Phrases

Even before or independent of `hirePoolLoginOffered`, [`integrations/hirepool/domain-policy.js`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js#L187-L277) strips conversational continuity for unauthenticated visitors:

| User Follow-Up Message | State Precondition | Actual Code Behavior | User-Visible Outcome |
| :--- | :--- | :--- | :--- |
| `"I'm new, I don't have an account."` / `"I don't have an account"` | `hirePoolLoginOffered === true` | Passes `domain-policy` (`account`); fails `isHirePoolSignupRequest` (`chat.js#L91-L93`); hits `chat.js#L107-L109` | Returns `HIREPOOL_AUTH_LIMITATION_MESSAGE` (LLM & history bypassed) |
| `"I'm new."` | Any guest state | No term in `recruitmentTerms`; word count `<= 2` hits `domain-policy.js#L264-L270` | Classified `AMBIGUOUS`; intercepted before LLM/history |
| `"Tell me more"` / `"Can you help?"` | Any state | Matches `AMBIGUOUS_PATTERNS` (`domain-policy.js#L122`) | Classified `AMBIGUOUS`; intercepted before LLM/history |
| `"What can you do?"` | Any state | Matches `generalQuestionPattern` (`domain-policy.js#L254`) with no keyword in `recruitmentTerms` (`#L244`) | **Falsely classified `OUT_OF_SCOPE`** (`#L273`), returns refusal, stripped from future history by `filterOutOfScopeMessages` |
| `"Continue."` / `"Yes."` / `"Show me."` | Unauthenticated guest (`hasShortlistOrJob` is false) | `WORKFLOW_CONTINUATION_PATTERNS` (`domain-policy.js#L212-L221`) skipped when `hirePoolWorkflow` lacks `selectedJob`/`shortlist` (`#L191-L194`, `#L206-L210`); falls through to `<= 2` words `AMBIGUOUS` (`#L264-L270`) or `OUT_OF_SCOPE` (`#L273`, e.g., `"Show me please."`) | Assistant refuses or acts unaware of the preceding turn |
| `"How do I sign up?"` / `"Register me"` | First time (`hirePoolAccountActionOffered !== 'hirepool_signup'`) | Matches `isHirePoolSignupRequest` (`chat.js#L91-L93`), offers `hirepool_signup` once, sets `hirePoolAccountActionOffered = 'hirepool_signup'` and `hirePoolLoginOffered = true` | Works once; asking again hits `#L114-L116` → `HIREPOOL_AUTH_LIMITATION_MESSAGE`; asking anything else hits `#L107-L109` → `HIREPOOL_AUTH_LIMITATION_MESSAGE` |
| `"What jobs match me?"` | `hirePoolLoginOffered === true` | `jobs` passes `domain-policy`; does not match `my\s+jobs?` in `isHirePoolAccountRequest` (`chat.js#L95-L97`); hits `#L107-L109` | Returns `HIREPOOL_AUTH_LIMITATION_MESSAGE` |

---

### 5.3 Verdict on All Potential Causes (Hypotheses Evaluated)

| Potential Cause / Hypothesis | Verdict | Evidence & Scope |
| :--- | :--- | :--- |
| **Unauthenticated auth/offer latch (`hirePoolLoginOffered` / `hirePoolAccountActionOffered`) + narrow signup regex** | **Confirmed Direct Root Cause** | [`chat.js#L91-L136`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L91-L136), [`#L2013-L2015`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2013-L2015), [`#L2256-L2258`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2256-L2258) short-circuit turns 4+ before history/LLM are touched. |
| **Lack of unauthenticated/onboarding visitor state in `classifyHirePoolMessage`** | **Confirmed Secondary Cause** | [`domain-policy.js#L122, #L191-L277`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js#L187-L277) drops `"What can you do?"`, `"Tell me more"`, `"Continue."`, `"Yes."`, `"I'm new."` without consulting history. |
| **History truncation (`20`) making summarization (`28`) dead code** | **Confirmed Secondary Bug (Long Sessions)** | `SessionManager.addMessage` slices at 20 ([`session-manager.js#L201-L205`](file:///d:/ai-assistant-plugin/backend/src/session-manager.js#L201-L205)), never reaching `MAX_PROVIDER_HISTORY_ITEMS = 28` ([`history-manager.js#L8, #L137-L160`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L137-L160)). Does not cause the turn-4 failure, but drops context >20 messages. |
| **Frontend `expiresIn` cap (5m) & host hard-revocation timer** | **Confirmed Secondary Bug (Auth Lifecycle)** | [`hirepool-session-store.js#L6-L8, #L105`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-session-store.js#L6-L8) defaults to 24h vs. 5m (`300000 ms`) ceiling/timer in [`LocalAssistantWidget.tsx#L299-L300, #L356`](file:///d:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L299-L300) and [`AuthContext.tsx#L128`](file:///d:/talenthub-develop/frontend/src/contexts/AuthContext.tsx#L128). |
| **Widget missing `410 SESSION_EXPIRED` handler & double `handleError` retry** | **Confirmed Secondary Bug (Recovery)** | [`api-client.js#L336`](file:///d:/ai-assistant-plugin/widget/src/api-client.js#L336) + [`widget.js#L1683-L1689`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1683-L1689) double-run `handleError`; [`widget.js#L1598-L1612`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1598-L1612) retries `403` twice but leaves `410` unrecovered. |
| **Reload guest fallback leaving `activeConversationId` + unpersisted tab/signup state** | **Confirmed Secondary Bug (Reloads)** | [`widget.js#L374-L425`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L374-L425), [`HirePoolSignupCoordinator`](file:///d:/ai-assistant-plugin/widget/src/hirepool-signup.js#L84-L97), and `LocalAssistantWidget.tsx` `useRef`s lose auth or leak `conversationId` across reloads. |
| **`isGuest` misdetection via `options.context?.authentication`** | **Confirmed Secondary Bug (Context)** | [`widget.js#L1566`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1566) misses serialized/missing `context` objects ([`#L1621-L1627`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1621-L1627)). |
| **In-memory `Map` loss across Serverless cold starts / multiple instances** | **Confirmed Infrastructure Risk** | [`vercel.json`](file:///d:/ai-assistant-plugin/vercel.json) runs `/api/[...path]`; cold starts wipe server `Map`s, though `clientHistory` (`.slice(-25)`) masks context loss unless `410`/`401` occurs. |
| **SSE disconnect skipping `sessionManager.addMessage`** | **Confirmed Edge-Case Sync Bug** | [`chat.js#L2293`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2293) leaves client `sessionStorage` ahead of server `session.messages` after aborted streams. |
| **Session TTL expiration (`2h`), `conversationId` rotation, or `sessionStorage` wipe** | **Refuted for Reproduced Turn-4 Loop** | On a single running server during a 4-turn conversation, `conversationId` remains unchanged, `ttlMs` (`2h`) has not elapsed, and `session.messages` is intact—it is simply bypassed by `getUnverifiedHirePoolResponse`. |

---

## 6. Why the Assistant Produces the Incorrect Unauthenticated Fallback

The fallback text `HIREPOOL_AUTH_LIMITATION_MESSAGE` ([`chat.js#L43-L44`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L43-L44)) was designed to stop the assistant from hallucinating login verification or repeatedly emitting login prompts when an unauthenticated user claims `"ok loggedin"` or insists `"Show me my applications"` without completing HirePool verification (explicitly tested in [`tests/local-hirepool.test.js#L1870-L1930`](file:///d:/ai-assistant-plugin/tests/local-hirepool.test.js#L1870-L1930)).

Three implementation defects turned this narrow guard into a global dead end:

1. **Asymmetric Latch Scope**: Setting `session.hirePoolLoginOffered = true` occurs not only when `getUnverifiedHirePoolResponse` handles an account request, but also *silently in the background* whenever the LLM proactively includes a `hirepool_login` suggestion card alongside a general answer like *"I'm looking for job opportunities."* ([`chat.js#L2013-L2015`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2013-L2015), [`#L2256-L2258`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2256-L2258)).
2. **Negation Assumption in Guard Clause**: [`chat.js#L106-L110`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L106-L110) treats *every* message that does not match `isHirePoolSignupRequest`, `isHirePoolLoginRequest`, or `isHirePoolAccountRequest` as an implicit repeat attempt to claim authentication—returning `"I can’t verify a HirePool login from this assistant in the current setup..."` even when the user is clarifying *"I'm new, I don't have an account."* or asking general HirePool questions.
3. **Zero Non-Auth Reset Path**: Once latched (`hirePoolLoginOffered = true`, `hirePoolAccountActionOffered = actionName`), both flags remain locked until `verifiedHirePoolUser` becomes true. Asking the same action again (`hirePoolAccountActionOffered === actionName` at `#L114-L116`) or shifting topics guarantees `HIREPOOL_AUTH_LIMITATION_MESSAGE` on every subsequent turn.

---

## 7. Files and Functions Responsible

| Layer | File | Key Functions / Symbols | Lines | Responsibility / Bug |
| :--- | :--- | :--- | :--- | :--- |
| Backend Chat | [`backend/src/routes/chat.js`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js) | `HIREPOOL_AUTH_LIMITATION_MESSAGE`, `isHirePoolLoginClaim`, `isHirePoolLoginRequest`, `isHirePoolSignupRequest`, `isHirePoolAccountRequest`, `getUnverifiedHirePoolResponse` | `37-44`, `83-136` | **Primary root cause**: intercepts non-matching guest turns when `hirePoolLoginOffered` is true; blocks repeated action offers; misses `"I don't have an account"`. |
| Backend Chat | [`backend/src/routes/chat.js`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js) | `addHirePoolGuestLoginAction`, `verifiedHirePoolUser` reset, post-LLM latch, `req.on('close')` | `138-179`, `1870-1874`, `2013-2015`, `2063-2066`, `2256-2258`, `2293` | Latches `hirePoolLoginOffered = true` when LLM suggests `hirepool_login`; only initializes `hirePoolWorkflow` for authenticated candidates; SSE abort skips `addMessage`. |
| Domain Policy | [`integrations/hirepool/domain-policy.js`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js) | `AMBIGUOUS_PATTERNS`, `WORKFLOW_CONTINUATION_PATTERNS`, `recruitmentTerms`, `generalQuestionPattern`, `classifyHirePoolMessage` | `109`, `122`, `187-277` | Misclassifies `"What can you do?"` (`OUT_OF_SCOPE`), `"Tell me more"` / `"I'm new."` (`AMBIGUOUS`), and skips continuations (`"Yes."`, `"Continue."`) when unauthenticated. |
| Session Store | [`backend/src/session-manager.js`](file:///d:/ai-assistant-plugin/backend/src/session-manager.js) | `SessionExpiredError`, `SessionOwnershipError`, `SessionManager` (`_getActiveSession`, `validateOwnership`, `addMessage`, `cleanupExpired`) | `34-41`, `142-144`, `201-205` | Enforces ownership (`403`) & expiration (`410`); slices `session.messages` to `20`, killing summarization. |
| History Manager | [`backend/src/history-manager.js`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js) | `MAX_PROVIDER_HISTORY_ITEMS`, `filterOutOfScopeMessages`, `buildProviderMessages`, `summarizeEarlierHistory` | `8`, `58-80`, `94-160` | Drops OOS turns; `28`-item summarization threshold unreachable when `SessionManager` caps at `20`. |
| Config | [`config/defaults.js`](file:///d:/ai-assistant-plugin/config/defaults.js) | `SERVER_DEFAULTS.SESSION` (`TTL_MS`, `MAX_MESSAGES_IN_CONTEXT`) | `9-12` | Sets `2h` TTL and `20`-message server context limit. |
| HirePool Auth | [`backend/src/local-integrations/hirepool-session-store.js`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-session-store.js) | `SESSION_TTL_MS`, `toPublicSession`, `storeHirePoolSession`, `findHirePoolContextBySdkCredential`, `refreshHirePoolSessionTokens` | `6-8`, `105` | Defaults `SESSION_TTL_MS` to `24h` (`86400000 ms`), incompatible with host `300000 ms` (`5m`) cap. |
| HirePool Bridge | [`backend/src/local-integrations/hirepool-auth.js`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-auth.js) | `IDENTITY_CACHE_MS`, `/session`, `/session/validate`, `/session/refresh`, `/session/revoke`, `/continuation/consume` | `1-381` | Manages opaque SDK tokens; origin-restricted by [`app.js#L47-L78`](file:///d:/ai-assistant-plugin/backend/src/app.js#L47-L78). |
| Middleware | [`backend/src/middleware/auth.js`](file:///d:/ai-assistant-plugin/backend/src/middleware/auth.js) | `authenticate`, `verifyJwt`, `extractCredentials` | `312-318` | Maps SDK token via `findHirePoolContextBySdkCredential` before JWT/API key; sets `req.user = null` when anonymous. |
| Guest Token Route | [`backend/src/routes/auth.js`](file:///d:/ai-assistant-plugin/backend/src/routes/auth.js) | `PUBLIC_ASSISTANT_IDS` | `1-76` | Excludes `'hirepool'` (`403 FORBIDDEN_ASSISTANT`), keeping guests unauthenticated. |
| Widget UI | [`widget/src/widget.js`](file:///d:/ai-assistant-plugin/widget/src/widget.js) | `AssistantWidgetUI` (`_restoreState`, `_clearSessionAndFallbackToGuest`, `_handleHirePoolSignupSuccess`, `sendMessage`, `handleError`) | `374-425`, `1103-1163`, `1556-1690` | Unawaited startup validation; guest fallback keeps `activeConversationId`; `isGuest` reads unparsed `options.context?.authentication`; double `handleError`; ignores `410`. |
| Widget API & Storage | [`widget/src/api-client.js`](file:///d:/ai-assistant-plugin/widget/src/api-client.js), [`widget/src/storage.js`](file:///d:/ai-assistant-plugin/widget/src/storage.js) | `AssistantApiClient.sendMessage`, `AssistantStorage` | `api-client.js#L336` | `sendMessage` invokes `onError` and rethrows; `AssistantStorage` uses `sessionStorage` with `guest_`/`usr_<id>_` scoping. |
| Signup Widget / API | [`widget/src/hirepool-signup.js`](file:///d:/ai-assistant-plugin/widget/src/hirepool-signup.js), [`backend/src/routes/hirepool-signup.js`](file:///d:/ai-assistant-plugin/backend/src/routes/hirepool-signup.js) | `HirePoolSignupCoordinator`, `onboardingSessions` | `hirepool-signup.js#L84-L97` (widget), `#L33-L36` (backend) | Frontend signup FSM state not persisted across reload; backend holds `30m` `onboardingSessions` Map. |
| Host Apps *(Read-Only)* | [`LocalAssistantWidget.tsx`](file:///d:/talenthub-develop/website/components/LocalAssistantWidget.tsx), [`AuthContext.tsx`](file:///d:/talenthub-develop/frontend/src/contexts/AuthContext.tsx) | `LocalAssistantWidget`, `AuthContext` | `229-356` (website), `128` (dashboard) | Enforce `1000..300000 ms` `expiresIn`; website stores credentials in `useRef`s and revokes via `setTimeout`. |

---

## 8. Session Timeout and Cleanup Behavior

### 8.1 Inventory of Active Timeouts, Caps, and Cleanup Intervals

| Store / Mechanism | Constant / Default | Cleanup Interval / Enforcement | Location |
| :--- | :--- | :--- | :--- |
| Conversation Session TTL | `TTL_MS = 2 * 60 * 60 * 1000` (2 hours) | 5-minute `cleanupInterval`; expired IDs recorded in `expiredSessions` → HTTP `410 SESSION_EXPIRED` | [`config/defaults.js#L10`](file:///d:/ai-assistant-plugin/config/defaults.js#L9-L12), [`session-manager.js#L142-L144`](file:///d:/ai-assistant-plugin/backend/src/session-manager.js#L142-L144) |
| Server Session Message Cap | `MAX_MESSAGES_IN_CONTEXT = 20` | Immediate slice on `addMessage()` (`session.messages.slice(-20)`) | [`config/defaults.js#L11`](file:///d:/ai-assistant-plugin/config/defaults.js#L9-L12), [`session-manager.js#L201-L205`](file:///d:/ai-assistant-plugin/backend/src/session-manager.js#L201-L205) |
| Provider History Threshold | `MAX_PROVIDER_HISTORY_ITEMS = 28` | Summarization trigger in `buildProviderMessages` (unreachable because of 20-message cap) | [`history-manager.js#L8`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L8) |
| Client History Payload Cap | `25` messages (`messages.slice(-25)`) | Sent per request as `clientHistory` fallback | [`widget.js#L1629`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1629) |
| SDK Session Store TTL | `SESSION_TTL_MS = 24 * 60 * 60 * 1000` (24h default) | 30-second `cleanupTimer` | [`hirepool-session-store.js#L6-L8`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-session-store.js#L6-L8) |
| Host Session Validation & Revocation | `expiresIn` in `[1000, 300000]` ms (**5 min max**) | Website runs `window.setTimeout(..., data.expiresIn)` calling revoke and clearing `sdkCredential` ref | [`LocalAssistantWidget.tsx#L299-L300, #L356`](file:///d:/talenthub-develop/website/components/LocalAssistantWidget.tsx#L299-L300), [`AuthContext.tsx#L128`](file:///d:/talenthub-develop/frontend/src/contexts/AuthContext.tsx#L128) |
| Identity Cache TTL | `IDENTITY_CACHE_MS = 30 * 1000` (30s) | Cached upstream profile verification in `hirepool-auth.js` | [`hirepool-auth.js`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-auth.js) |
| Signup Onboarding TTL | `ONBOARDING_SESSION_TTL_MS = 30 * 60 * 1000` (30m) | 60-second cleanup timer on `onboardingSessions` | [`routes/hirepool-signup.js#L33-L36`](file:///d:/ai-assistant-plugin/backend/src/routes/hirepool-signup.js#L33-L36) |
| Auth Continuation TTL | `CONTINUATION_TTL_MS = 10 * 60 * 1000` (10m) | `MAX_CONTINUATIONS = 1000`; 30-second cleanup timer | [`hirepool-continuation-store.js`](file:///d:/ai-assistant-plugin/backend/src/local-integrations/hirepool-continuation-store.js) |
| Confirmation & Resume Upload TTLs | `CONFIRMATION_TTL_MS = 2 * 60 * 1000` (2m) | 30-second cleanup timer (`hirepool-resume.js`); lookup check (`dynamic-api/catalog.js`) | [`hirepool-resume.js`](file:///d:/ai-assistant-plugin/backend/src/routes/hirepool-resume.js), [`catalog.js`](file:///d:/ai-assistant-plugin/backend/src/dynamic-api/catalog.js) |
| Vercel Serverless Execution Limit | `maxDuration: 60` seconds | Ephemeral container memory wiped on cold start / scale-down | [`vercel.json#L9`](file:///d:/ai-assistant-plugin/vercel.json#L9) |

### 8.2 Timeout & Lifecycle Scenarios
1. **Short idle (2 minutes)** while unauthenticated after a login prompt: No timer expires, yet `session.hirePoolLoginOffered = true` remains set—immediate lockout on casual follow-up. Dynamic-API / resume write confirmations (`2m` TTL) expire cleanly.
2. **Moderate idle (> 5 minutes)** after tab-login on the public website (assuming `HIREPOOL_SESSION_TTL_MS <= 300000` so host accepted the session): `LocalAssistantWidget.tsx#L356` revokes the SDK credential at 5 minutes even though `SessionManager` (`2h`) and `SessionStorage` are still active. Next message drops `Authorization` → `req.user = null` → `SessionManager` throws `403 SESSION_ACCESS_DENIED` → widget clears `activeConversationId` and starts a new anonymous conversation twice (double `handleError`).
3. **Extended idle (> 2 hours)** on a persistent server: `SessionManager` moves `conversationId` into `expiredSessions` and throws `410 SESSION_EXPIRED`. Because `widget.js#L1598-L1612` only handles `403`, **the chat widget remains broken on 410** until the user manually clicks New Chat.
4. **Full Page Refresh (`F5`)**:
   - *Guest*: `sessionStorage` retains `guest_conversation_id` and `guest_messages` (unless tab is closed).
   - *Mid in-chat signup*: Backend retains `onboardingSessions` (30m), but browser loses `HirePoolSignupCoordinator` in-memory `selectedRole`/`session`/`profileData`.
   - *Tab-login user on public website*: `LocalAssistantWidget` loses `sdkCredential` `useRef` and reverts to `anonymous`.
   - *In-chat signup user*: `_restoreState()` restores `hirepool_session`; if backend restarted/lost `contextsByCredential`, `_clearSessionAndFallbackToGuest()` wipes auth and drops back to `guest_` with the orphaned `activeConversationId`.

---

## 9. Existing Test Coverage and Missing Tests

### 9.1 Verified Baseline Test Execution (Observed Read-Only Runs)
1. **`node --test tests/hirepool-auth-handoff.test.js tests/hirepool-domain-restriction.test.js tests/hirepool-signup.test.js tests/hirepool-signup-transition.test.js tests/hirepool-form-validation.test.js tests/immediate-fixes.test.js`**
   - Result: **96 tests across 11 suites — 96 pass, 0 fail, 0 skipped**.
2. **`npm run test:mock`** (`auth-lifecycle.test.js`, `chat-stream.test.js`, `dynamic-api.test.js`, `local-hirepool.test.js`, `hirepool-resume.test.js`, `widget-hirepool-resume.test.js`)
   - Result: **116 tests across 6 suites — 116 pass, 0 fail, 0 skipped**.
   - Note: `test:mock` covers these 6 baseline suites separately and omits the 6 newer `hirepool-*` and `immediate-fixes` test files listed in item 1 above.

### 9.2 Why Existing Tests Missed These Bugs
1. **Circular confirmation of the broken guard**: [`tests/local-hirepool.test.js#L1870-L1930`](file:///d:/ai-assistant-plugin/tests/local-hirepool.test.js#L1870-L1930) only sent account queries (`"Show me the jobs I have applied for..."` → `"ok loggedin"` → `"Show me my applications..."`) and explicitly asserted `/can’t verify a HirePool login/`. It never tested a non-account / clarifying guest turn such as `"I'm new, I don't have an account."` or `"What can you do?"` after a login offer.
2. **Test bypassing `SessionManager`**: [`tests/immediate-fixes.test.js#L136-L164`](file:///d:/ai-assistant-plugin/tests/immediate-fixes.test.js#L136-L164) pushed 40 synthetic items onto a plain `{ messages: [] }` object literal directly passed to `buildProviderMessages()`, masking the fact that `SessionManager.addMessage()` slices at 20 items (`config/defaults.js#L11`) so `MAX_PROVIDER_HISTORY_ITEMS = 28` is never reached in real execution.
3. **Disconnected test scripts**: The 6 newer HirePool / fix suites are not included in `npm run test:mock`.

### 9.3 Critical Coverage Gaps
- No multi-turn unauthenticated integration test mixing welcome → job query → `"I'm new, I don't have an account."` → `"What can you do?"` → `"Tell me more"` → `"Continue."` → `"How do I sign up?"`.
- No end-to-end test chaining real `SessionManager.addMessage()` into `buildProviderMessages()` across >20 and >28 turns to verify summarization execution.
- No widget unit/integration tests for:
  - `410 SESSION_EXPIRED` auto-recovery
  - Single-execution `handleError` retry verification (`api-client.js#L336` + `widget.js#L1683-L1689`)
  - `_clearSessionAndFallbackToGuest()` clearing `activeConversationId`
  - Serialized `options.context` handling inside `isGuest` detection (`widget.js#L1566`)
  - Mid-signup page reload persistence (`HirePoolSignupCoordinator`)
- No automated check validating `expiresIn` compatibility (`1000..300000 ms`) with `LocalAssistantWidget.tsx` / `AuthContext.tsx`.

---

## 10. Recommended Fixes, Prioritized by Severity

### P0 — Critical (Resolves Reproduced Turn-4 Lockout Immediately)
1. **Fix [`getUnverifiedHirePoolResponse`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L99-L136) and post-LLM latching ([`chat.js#L2013-L2015, #L2256-L2258`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2013-L2015))**:
   - **Remove lines `107-109`** (`if (session.hirePoolLoginOffered) return { text: HIREPOOL_AUTH_LIMITATION_MESSAGE };`) completely: once a guest has seen a login offer, normal non-account HirePool conversation (questions, onboarding guidance, clarifying `"I don't have an account"`) MUST continue to reach history and the LLM.
   - Only return `HIREPOOL_AUTH_LIMITATION_MESSAGE` (or a helpful re-prompt with `hirepool_signup` when appropriate) when the user repeatedly claims login without verification (`isHirePoolLoginClaim`) or repeatedly insists on private account data (`isHirePoolAccountRequest`) while still unauthenticated.
   - **Expand `isHirePoolSignupRequest` ([`chat.js#L91-L93`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L91-L93))** to recognize natural first-time visitor phrases such as `"I'm new"`, `"I don't have an account"`, `"no account yet"`, `"help me get started"`.
   - Separate UI card deduplication (`hirePoolAccountActionOffered`) from conversational blocking so users who later explicitly ask `"How do I sign up?"` or `"Show me login"` can always re-receive guidance or start onboarding instead of hitting `HIREPOOL_AUTH_LIMITATION_MESSAGE`.

### P1 — High (Fixes Follow-Up Drops, Summarization, Auth Lifetime, & Widget Error Recovery)
2. **Add visitor/conversation context to [`domain-policy.js`](file:///d:/ai-assistant-plugin/integrations/hirepool/domain-policy.js#L187-L277)**:
   - Track unauthenticated visitor/onboarding state on `session` (e.g., recent in-scope HirePool turns or guest onboarding phase) alongside `hirePoolWorkflow`.
   - Ensure HirePool assistant capability questions (`"What can you do?"`, `"How can you help?"`) classify as `IN_SCOPE` rather than failing `generalQuestionPattern` (`#L254`).
   - Allow short contextual follow-ups (`"Tell me more"`, `"Continue."`, `"Yes."`, `"Show me."`, `"I'm new."`) through to history + LLM when the session has active in-scope HirePool conversation history.
3. **Unify `SessionManager` cap & `history-manager.js` summarization**:
   - Increase `SERVER_DEFAULTS.SESSION.MAX_MESSAGES_IN_CONTEXT` ([`defaults.js#L11`](file:///d:/ai-assistant-plugin/config/defaults.js#L9-L12)) above `MAX_PROVIDER_HISTORY_ITEMS` (`28`), or invoke [`summarizeEarlierHistory()`](file:///d:/ai-assistant-plugin/backend/src/history-manager.js#L137-L160) inside `SessionManager` before trimming `session.messages`, ensuring turns beyond 20–28 are condensed into a summary rather than discarded.
4. **Fix `widget.js` & `api-client.js` error handling, `410` recovery, fallback, & `isGuest`**:
   - Eliminate duplicate `handleError` invocation between [`api-client.js#L336`](file:///d:/ai-assistant-plugin/widget/src/api-client.js#L336) and [`widget.js#L1683-L1689`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1683-L1689).
   - Handle `410 SESSION_EXPIRED` in [`widget.js#L1598-L1612`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1598-L1612) using a clean `activeConversationId = null` reset + single replay with `clientHistory`.
   - Clear `this.activeConversationId` (and transition transcript cleanly) inside [`_clearSessionAndFallbackToGuest()`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L418-L425).
   - Fix `isGuest` detection at [`widget.js#L1566`](file:///d:/ai-assistant-plugin/widget/src/widget.js#L1566) by checking verified SDK identity / `hostIdentity` state instead of `this.options.context?.authentication?.identity`.
5. **Reconcile SDK session `expiresIn` & refresh lifecycle with read-only HirePool hosts**:
   - Since `D:\talenthub-develop` cannot be edited, configure/return a compliant `expiresIn <= 300000` (or separate short-lived handoff `expiresIn` from longer-lived refresh/continuation policy if supported) and handle refresh/re-exchange proactively in the SDK widget before host timer revocation invalidates active authenticated chat.

### P2 — Medium (Page-Reload Continuity & Serverless Durability)
6. **Persist `HirePoolSignupCoordinator` progress in user-scoped `sessionStorage`**: Serialize non-secret signup state (current FSM step, role, agreement state, draft fields) into `sessionStorage` so refreshing mid-registration resumes cleanly.
7. **Preserve valid user turns on aborted SSE streams**: Adjust [`chat.js#L2293`](file:///d:/ai-assistant-plugin/backend/src/routes/chat.js#L2293) so an aborted response still persists the user's submitted prompt (or safely reconciles client/server transcripts).
8. **Introduce an externalizable store interface for backend session & auth maps**: Extract `SessionManager`, `hirepool-session-store`, and `onboardingSessions` behind an async store adapter (in-memory default for local dev, Redis/KV-backed for serverless deployments under [`vercel.json`](file:///d:/ai-assistant-plugin/vercel.json)) so cold starts or scaled instances retain auth tokens and active sessions.

### P3 — Low (Test Hygiene)
9. **Consolidate `package.json` test scripts & eliminate mocked `SessionManager` bypasses**.

---

## 11. Proposed Implementation Plan

*(Strictly scoped to `D:\ai-assistant-plugin`; `D:\talenthub-develop` remains untouched.)*

| Phase | Target Files | Changes | Verification Goal |
| :--- | :--- | :--- | :--- |
| **Phase 1 (P0 Hotfix)** | `backend/src/routes/chat.js` | Remove `hirePoolLoginOffered` blanket catch-all at `#L107-L109`; expand `isHirePoolSignupRequest`; separate card dedup from conversation blocking; update `tests/local-hirepool.test.js` if overly broad assertion relied on bug while keeping anti-hallucination test intact | Reproduced 6+ turn guest conversation answers `"I'm new, I don't have an account."` helpfully with full history intact |
| **Phase 2 (P1 Logic & Widget)** | `integrations/hirepool/domain-policy.js`, `config/defaults.js`, `backend/src/session-manager.js`, `backend/src/history-manager.js`, `widget/src/api-client.js`, `widget/src/widget.js`, `backend/src/local-integrations/hirepool-session-store.js` | Context-aware guest follow-ups & capability questions; activate real >20-turn summarization; deduplicate `handleError`; add `410` recovery; clear `activeConversationId` on fallback; fix `isGuest`; align `expiresIn` <= `300000 ms` with refresh handling | `"What can you do?"`, `"Continue."`, `"Tell me more"`, 30-turn recall, `410` expiry recovery, and `403` single-retry all pass automated tests |
| **Phase 3 (P2 Persistence)** | `widget/src/hirepool-signup.js`, `backend/src/routes/chat.js`, store adapters (`session-manager.js`, `hirepool-session-store.js`, `routes/hirepool-signup.js`) | Persist signup FSM snapshot in `sessionStorage`; reconcile SSE abort persistence; add optional Redis/KV store backend | Refresh mid-signup and restart recovery work seamlessly |
| **Phase 4 (Test Hardening)** | `package.json`, `tests/immediate-fixes.test.js`, new `tests/session-context-retention.test.js` | Test real `SessionManager` + `buildProviderMessages`; test full widget error/expiry/reload paths; unify test commands | All suites green with zero bypassed core classes |

---

## 12. Manual Verification & Regression Testing Plan

1. **Reproduced Guest Onboarding Loop (Unauthenticated Browser Test)**
   - Open the HirePool assistant on the public website in a clean session.
   - Send in order:
     1. `"I'm new to HirePool."` → Expect HirePool overview.
     2. `"I'm looking for job opportunities."` → Expect login/registration explanation (and optional action card).
     3. `"I'm new, I don't have an account."` → **Verify assistant does NOT emit `HIREPOOL_AUTH_LIMITATION_MESSAGE`**; instead guides signup / invokes `hirepool_signup`.
     4. `"What can you do?"` → Verify capability summary (not `OUT_OF_SCOPE` refusal).
     5. `"Tell me more"` → Verify contextual continuation referring back to turn 1–4.
     6. `"Continue."` / `"How do I sign up?"` → Verify clean signup progression.
2. **Long-Conversation Summarization Verification (25–30 Turns)**
   - Introduce a distinct candidate constraint on turn 1 (e.g., *"I'm targeting remote Senior Go roles in Pune"*).
   - Exchange 25+ follow-up turns within the same session.
   - Ask *"What role, stack, and location did I say I was targeting at the start?"* → Verify earlier context is preserved via `summarizeEarlierHistory` and recalled accurately.
3. **Host `expiresIn` & Authenticated Session Longevity (> 5 Minutes)**
   - Log in via tab login and via in-chat signup.
   - Verify `POST /api/hirepool/session` succeeds without `LocalAssistantWidget.tsx` or `AuthContext.tsx` rejecting `expiresIn`.
   - Wait past 5 minutes and send an authenticated query (e.g., *"Show me my applications"*) → Verify session refreshes or recovers transparently without stranding the user in `403` or duplicate error banners.
4. **Refresh & Expiry Resilience (`F5` & `410 SESSION_EXPIRED`)**
   - Refresh page (`F5`) mid-conversation as guest, mid-signup (`HIREPOOL_SIGNUP_STATES`), and authenticated → Verify `conversation_id`, messages, and active step restore cleanly without scope leak.
   - Force backend `SESSION_EXPIRED` (`410`) or restart backend server cleanly → Send a follow-up message → Verify widget auto-resets `conversationId`, replays once with `clientHistory`, and preserves conversational context on the very first attempt.
5. **Stream Disconnect Recovery**
   - Trigger a streaming response and abort/reload mid-stream → Re-open chat and send *"Continue"* → Verify server/client turn ordering remains synchronized.
