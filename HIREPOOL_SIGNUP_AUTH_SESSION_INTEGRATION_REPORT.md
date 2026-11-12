# HirePool Signup Auth Session Integration Report

**SDK Repository:** `D:\ai-assistant-plugin`  
**Reference Repository (Read-Only):** `D:\talenthub-develop`  
**Date:** November 9, 2026  
**Status:** IMPLEMENTED & VERIFIED  

---

## 1. Objective & Architecture Overview

The objective of this milestone is to bridge the gap between in-chat signup completion and authenticated conversation execution. Upon completing registration, email verification, and profile submission, the user must seamlessly transition into an authenticated assistant session with all role-specific permissions and dynamic tools available, without redirecting to login.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AI ASSISTANT SDK (WIDGET)                       │
│                                                                        │
│  [16-Step Signup FSM] ──► onAuthenticated(sessionData)                 │
│                                   │                                    │
│                                   ▼                                    │
│  apiClient.setAuthenticatedSession(sessionData)                        │
│  storage.set('hirepool_session', sessionData)                          │
│  apiClient.validateHirePoolSession() [SMOKE TEST]                      │
│                                   │                                    │
│  (Next Turn)                      ▼                                    │
│  SendMessage(message) ──► Authorization: Bearer <credential>           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP Request
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          SDK EXPRESS BACKEND                           │
│                                                                        │
│  authenticate() middleware                                             │
│    └─► findHirePoolContextBySdkCredential(credential)                  │
│          └─► req.user = createHirePoolPrincipal(context)               │
│                - role: 'consultancy' | 'client' | 'candidate'          │
│                - assistantId: 'hirepool'                               │
│                - applicationId: 'hirepool-local-app'                   │
│                                                                        │
│  chatRouter                                                            │
│    ├─► isVerifiedHirePoolUser(req.user) === true                       │
│    ├─► guestResponse = null                                            │
│    ├─► createRequestActionRegistry() enables role dynamic tools         │
│    └─► SessionManager.getOrCreate() binds guest history to user        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Deterministic 16-Step Signup FSM Specification

We codified the deterministic 16-step onboarding finite state machine in `widget/src/hirepool-signup.js`:

| Step # | State Constant | UI / System Activity |
| :---: | :--- | :--- |
| **1** | `IDLE` | Coordinator initialized, awaiting signup trigger. |
| **2** | `ROLE_SELECTION` | Displays role options: Candidate, Employer/Client, Agency/Consultancy. |
| **3** | `AGREEMENT_FETCHING` | Fetches active User Agreement (`GET /api/hirepool/signup/agreement?role=...`). |
| **4** | `SIGNUP_FORM` | Displays registration form with email, password, confirm password, agreement. |
| **5** | `REGISTERING` | Submits `POST /api/hirepool/signup/register`. Shows progress indicator. |
| **6** | `REGISTRATION_CONFIRMED` | Server returns 201 with `signupToken`. Transition to verification. |
| **7** | `EMAIL_VERIFICATION_PENDING` | Displays verification notice with "I've verified my email" and resend buttons. |
| **8** | `EMAIL_VERIFICATION_IN_PROGRESS` | Checks status via `POST /api/hirepool/signup/check-verification`. |
| **9** | `EMAIL_VERIFIED` | Backend confirms `is_verified: true`. Transitions to profile collection. |
| **10** | `PROFILE_COLLECTION` | Displays role-specific mandatory and optional profile fields form. |
| **11** | `PROFILE_REVIEW` | Displays structured review table with "Confirm & Finish Setup" and "Edit". |
| **12** | `PROFILE_SUBMITTING` | Submits profile to HirePool via `POST /api/hirepool/signup/complete-profile`. |
| **13** | `PROFILE_READBACK` | Readback verification checks profile persistence on HirePool backend. |
| **14** | `AUTH_SESSION_ESTABLISHED` | `storeHirePoolSession` issues opaque SDK credential; widget stores session. |
| **15** | `AUTHENTICATION_SMOKE_TEST` | Smoke test endpoint `GET /api/hirepool/session/validate` verifies session. |
| **16** | `COMPLETED` | Welcome bubble rendered, greeting & role prompts activated, ready for chat. |

---

## 3. Key Components Implemented

### 3.1 Authentication Smoke Test Endpoint (`backend/src/local-integrations/hirepool-auth.js`)
We added `GET /api/hirepool/session/validate`:
- Extracts the Bearer token credential.
- Validates the credential against `findHirePoolContextBySdkCredential(token)`.
- If valid and unexpired, returns:
  ```json
  {
    "valid": true,
    "identity": { "id": "...", "email": "...", "userType": "...", "organizationRole": "..." },
    "sessionScope": "hirepool-user-...",
    "expiresIn": 86400000
  }
  ```
- If invalid or expired, returns HTTP 401 `INVALID_CREDENTIALS`.
This provides a safe, zero-write smoke test that the widget runs before claiming success to the user.

### 3.2 Dynamic API Action Confirmation via Authenticated Session
In `widget/src/sdk.js` and `widget/src/api-client.js`:
- In `sdk.js`, `action:execute` checks whether `this.apiClient.getAuthenticatedSession()?.credential` is present.
- If an action requires confirmation (`confirmationToken`), `apiClient.confirmDynamicApiAction(token)` directly calls `POST /api/dynamic-api/confirm` with `Authorization: Bearer <credential>`.
- This ensures action execution works autonomously inside the widget even without host window postMessage hooks.

### 3.3 Seamless Session Continuation in `SessionManager`
In `backend/src/session-manager.js`:
- `getOrCreate(conversationId, assistantId, options)` checks whether the existing session was started by an unauthenticated guest (`session.userId === null`).
- When the authenticated request arrives with `options.userId = authUser.id`:
  ```js
  if (!session.userId && resolvedOptions.userId) {
    session.userId = resolvedOptions.userId;
  }
  ```
- The conversation history is retained without disruption or `SessionOwnershipError`.

---

## 4. Verification & Status

1. **Automated FSM Transitions**: Verified in `tests/hirepool-signup-transition.test.js` (142ms runtime).
2. **Session Validation**: Verified in `tests/hirepool-signup-transition.test.js` (32ms runtime).
3. **Chat Continuation**: Verified in `tests/hirepool-signup-transition.test.js` (1119ms runtime).
4. **All Regression Suites**: 61/61 passing across `tests/hirepool-signup.test.js`, `tests/local-hirepool.test.js`, `tests/immediate-fixes.test.js`, and `tests/hirepool-signup-transition.test.js`.
