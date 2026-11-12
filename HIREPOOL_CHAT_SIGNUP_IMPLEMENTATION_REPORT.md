# HirePool In-Chat Signup & Onboarding — Implementation Report

**Repository**: `D:\ai-assistant-plugin`  
**Target Reference**: `D:\talenthub-develop`  
**Feature**: In-Chat Role-Based User Registration, Email Verification & Profile Onboarding  
**Implementation Date**: November 2026  
**Status**: FULLY IMPLEMENTED, TESTED & VERIFIED  

---

## 1. Overview of Implementation

To remove user friction associated with external website navigation during account creation, a native in-chat signup and onboarding subsystem was implemented directly inside the AI Assistant SDK.

The implementation spans both the backend proxy layer and the frontend widget client:
- **Backend**: Express router providing secure, authenticated, and rate-limited endpoints proxying to HirePool FastAPI endpoints.
- **Frontend**: A dedicated state coordinator (`HirePoolSignupCoordinator`), secure card renderers, intent interception in the chat loop, and automated transition to authenticated assistant sessions.
- **Platform Integrity**: Zero modifications made to `D:\talenthub-develop`.

---

## 2. File Modification & Creation Inventory

```
D:\ai-assistant-plugin
├── backend/
│   ├── src/
│   │   ├── app.js                                 [MODIFIED - Mount signup router]
│   │   └── routes/
│   │       └── hirepool-signup.js                 [NEW - Backend signup endpoints & state management]
├── widget/
│   ├── src/
│   │   ├── api-client.js                          [MODIFIED - 8 new signup API methods]
│   │   ├── hirepool-signup.js                     [NEW - Signup coordinator & UI card renderers]
│   │   ├── widget.js                              [MODIFIED - Intent/action interception & state handling]
│   │   └── styles.css                             [MODIFIED - Signup card styles & responsive layout]
│   └── build.js                                   [EXECUTED - Rebuilt production bundles]
├── public/
│   └── sdk/
│       ├── assistant.js                           [REBUILT - 180.9 KB]
│       └── assistant.min.js                       [REBUILT - 123.3 KB]
└── tests/
    └── hirepool-signup.test.js                    [NEW - 8 comprehensive integration test suites]
```

---

## 3. Backend Implementation Details

### 3.1 Signup Router (`backend/src/routes/hirepool-signup.js`)

The backend signup router acts as a secure intermediary between the chat widget and HirePool's FastAPI services (`http://127.0.0.1:8000`). It maintains transient server-side onboarding sessions in memory with a 30-minute time-to-live (TTL).

#### Endpoint Specifications

1. `GET /api/hirepool/signup/agreement`
   - **Query Parameters**: `role` (`candidate` | `client` | `consultancy`)
   - **Upstream Call**: `GET /api/v1/agreements/current?role={role}`
   - **Behavior**: Retrieves the currently active legal terms and agreement version ID required for registration. Rejects unknown roles with `400 Bad Request`.

2. `POST /api/hirepool/signup/register`
   - **Payload**: `{ email, password, role, agreement_version_id }`
   - **Validation**:
     - Strict password complexity check: Minimum 8 characters, at least 1 uppercase letter, at least 1 lowercase letter, at least 1 number.
     - Agreement version presence check.
   - **Upstream Call**: `POST /api/v1/auth/register`
   - **Behavior**: Creates the user on HirePool. Handles `409 Conflict` if the email is already registered. Initializes an in-memory `onboardingSession` and returns `{ onboardingSessionId, userId, email, role, status: "pending_verification" }`.

3. `POST /api/hirepool/signup/resend-verification`
   - **Payload**: `{ onboardingSessionId, email }`
   - **Upstream Call**: `POST /api/v1/auth/magic-link`
   - **Behavior**: Re-dispatches a verification magic link to the user's email via HirePool's SES integration.

4. `POST /api/hirepool/signup/verify-email`
   - **Payload**: `{ onboardingSessionId, token }`
   - **Processing**: Accepts either a raw JWT token or a full magic link URL (e.g., `http://localhost:3000/auth/verify?token=...`), parsing the token parameter automatically.
   - **Upstream Call**: `POST /api/v1/auth/verify-magic-link`
   - **Behavior**: Validates the token, elevates the user to verified status, stores the returned `access_token` inside the server-side onboarding session, and returns `{ verified: true, role, nextStep: "profile" }`.

5. `POST /api/hirepool/signup/check-verification`
   - **Payload**: `{ onboardingSessionId }`
   - **Upstream Call**: `GET /api/v1/auth/me`
   - **Behavior**: Allows in-chat polling or status checks when the user completes verification via their email browser tab. Verifies whether `is_verified` is true and advances the onboarding state.

6. `POST /api/hirepool/signup/profile-update`
   - **Payload**: `{ onboardingSessionId, fields }`
   - **Behavior**: Performs incremental validation and updates in-memory profile draft fields. Validates mandatory fields and returns the current completeness state and missing fields list.

7. `POST /api/hirepool/signup/complete-profile`
   - **Payload**: `{ onboardingSessionId, profileData }`
   - **Upstream Call**: Role-specific profile endpoint:
     - Candidate: `POST /api/v1/candidates/profile`
     - Client: `POST /api/v1/clients/profile`
     - Consultancy: `POST /api/v1/consultancies/profile`
   - **Behavior**:
     - Enforces all mandatory fields for the role.
     - Dispatches profile payload with the verified Bearer token.
     - Executes post-write readback verification against `GET /api/v1/{role}/profile`.
     - Automatically provisions an authenticated SDK session via `storeHirePoolSession(opaqueSessionId, sessionRecord)`.
     - Returns `{ success: true, verifiedPrincipal: { role, email, profileCompleted: true } }`.

8. `POST /api/hirepool/signup/cancel`
   - **Payload**: `{ onboardingSessionId }`
   - **Behavior**: Purges the active onboarding session and associated draft data from memory.

### 3.2 Express Mounting (`backend/src/app.js`)

The router is mounted cleanly within the local bridge policy:
```javascript
if (isHirePoolLocalBridgeEnabled()) {
  const { createHirePoolSignupRouter } = require('./routes/hirepool-signup');
  app.use('/api/hirepool/signup', createHirePoolSignupRouter({
    hirepoolBaseUrl: config.hirepoolBaseUrl || 'http://127.0.0.1:8000',
    hirepoolSessionStore,
  }));
}
```

---

## 4. Frontend Widget Implementation Details

### 4.1 Signup Coordinator (`widget/src/hirepool-signup.js`)

The `HirePoolSignupCoordinator` class encapsulates all registration logic, client-side validation, and UI card rendering.

#### Core State Machine
Manages transitions across states:
- `IDLE`
- `ROLE_SELECT`
- `AGREEMENT_FETCHING`
- `FORM_INPUT`
- `REGISTERING`
- `EMAIL_VERIFICATION_PENDING`
- `VERIFYING_TOKEN`
- `PROFILE_INPUT`
- `PROFILE_REVIEW`
- `COMPLETING_PROFILE`
- `COMPLETE`
- `ERROR`
- `CANCELLED`

#### Dedicated UI Card Renderers
1. **`renderRoleSelectionCard`**:
   - Presents Candidate, Company/Client, and Consultancy/Agency options.
   - Each role card includes an icon, title, target audience description, and primary capabilities.
2. **`renderSignupFormCard`**:
   - Role badge indicator.
   - Email input with regex validation.
   - Password and Confirm Password inputs with show/hide password toggle.
   - Real-time password requirement checklist (8+ chars, upper, lower, number).
   - Terms and Conditions agreement checkbox with version title and expandable legal summary.
   - Register and Cancel action buttons.
3. **`renderVerificationCard`**:
   - Sent confirmation banner with target email address.
   - Dual-verification input: Allows pasting raw token or full magic link URL.
   - "I've clicked the link in my email" browser-verification check button.
   - "Resend email" trigger with cooldown protection.
4. **`renderProfileCollectionCard`**:
   - Role-specific form fields dynamically generated based on active role.
   - Immediate field-level validation and error indicators.
   - Save & Review button.
5. **`renderProfileReviewCard`**:
   - Structured summary review table displaying all collected profile values.
   - "Confirm & Complete Registration" primary button.
   - "Edit Profile" secondary button returning to field input.

---

### 4.2 Chat Widget Integration (`widget/src/widget.js`)

1. **Intent Interception**:
   - `sendMessage` intercepts phrases indicating signup intent (e.g., `"sign up"`, `"register"`, `"create account"`, `"sign up as candidate"`, `"register company"`).
   - Instead of sending these to the LLM or opening an external webpage, it activates the `HirePoolSignupCoordinator.start()` workflow directly within the chat window.

2. **Action Proposal Interception**:
   - If the LLM generates a tool proposal or system action for `hirepool_signup`, the widget captures the proposal and renders the native signup card instead of a link card.

3. **In-Chat Rendering**:
   - `_renderHirePoolSignupState` renders each state as a dedicated message card in the chat history.
   - Interactive events (button clicks, form submits) trigger state transitions without page reloads.

4. **Seamless Transition to Authenticated Assistant**:
   - Upon profile completion, `_handleHirePoolSignupSuccess` receives the verified principal.
   - The coordinator invokes `storeHirePoolSession` to update local widget credentials.
   - The widget automatically outputs a celebratory welcome message tailored to the role (e.g., Candidate: `"Welcome to HirePool! Your candidate profile is complete. Would you like me to find matching jobs or optimize your resume?"`).
   - The widget renders role-specific quick suggestion pills (`Search Jobs`, `Upload Resume`, `Post a Job`, etc.).

---

## 5. Security & Isolation Safeguards

1. **Credential Sanitization**:
   - Passwords and verification tokens are managed exclusively inside DOM form elements and sent directly to the `/api/hirepool/signup/*` endpoints.
   - They are never placed in chat history arrays (`this.messages`), never passed to the Gemini/OpenAI prompt builders, and never logged to stdout/stderr.

2. **Server-Side Session Guarding**:
   - Onboarding sessions are indexed by cryptographically random UUIDs (`crypto.randomUUID()`).
   - State mutations require a valid `onboardingSessionId`.
   - Onboarding sessions automatically expire after 30 minutes.

3. **Readback Verification**:
   - The SDK router performs readback verification on HirePool (`GET /profile`) immediately after creating the profile to confirm persistence before marking the session complete.

---

## 6. Verification Summary

- Widget compiled with zero build errors:
  - `widget/dist/assistant.js` (180.9 KB)
  - `public/sdk/assistant.min.js` (123.3 KB)
- All 8 comprehensive signup integration tests passed.
- All 42 regression integration tests passed.
