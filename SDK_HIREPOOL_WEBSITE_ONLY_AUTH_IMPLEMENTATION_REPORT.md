# HirePool Website-Only Assistant Implementation Report

## Summary

Implemented a local-development-only assistant path that uses the SDK-owned Chrome extension on approved public HirePool website routes. The separate dashboard app is excluded from extension injection, and the SDK refuses to initialize the HirePool assistant on the dashboard origin or any unapproved route.

HirePool source files and its ignored local environment file were not modified. No HirePool business API writes, migrations, commits, or pushes were performed.

## Implementation

- A shared exact origin/path policy is defined in `extension/hirepool/site-policy.js` and re-exported for the SDK/backend. It permits the local public-site origins on ports 3000/3001 and the observed public paths `/`, `/features`, `/enterprise`, `/pricing`, `/partners`, `/women`, `/terms`, `/privacy`, and `/contact`.
- The SDK initialization and operation guards fail closed when `assistantId: "hirepool"` is used outside that policy. The extension has content-script matches only for those public-site origins, then checks the exact path before injecting the page entry.
- The extension attaches an authenticated integration to the existing public-site widget without changing HirePool source. The login action requires user confirmation and opens the existing login page in another tab; successful verification returns to the original public-site tab and resumes the request in its existing conversation without showing a duplicate user message.
- Guest chat creates a random, single-use continuation reference. The server stores only its digest alongside the conversation ID and pending request for up to ten minutes. On consume, the existing session manager binds the guest conversation to the verified user.
- The extension observes only `GET` requests to `/api/v1/auth/me`, `/api/v1/candidates/profile`, `/api/v1/clients/profile`, `/api/v1/clients/me`, `/api/v1/consultancies/profile`, and `/api/v1/consultancies/me`, initiated by `http://localhost:5173`, and only while a login continuation is pending. It does not read login response bodies, passwords, localStorage, or refresh tokens.
- The access token is forwarded transiently to the local SDK bridge. The bridge validates the identity and applicable client/consultancy membership role; raw access tokens remain only in the existing short-lived SDK backend memory store. The extension stores the opaque continuation reference and tab metadata in `chrome.storage.session`, never a raw token or SDK credential. The active SDK credential is held in page memory only.
- Local bridge origins now exclude the dashboard port; dashboard-origin bridge preflight and request traffic are rejected before CORS can send an Authorization-bearing request. Login handoff is restricted to the pinned extension origin. The public website can revoke a session on logout; the extension notices navigation to the existing `/login` route and clears assistant state across associated website tabs.
- The local bridge continues to expose only the existing eight role-specific read-only `GET` tools. No business mutations were added.

## Files changed or added

- `config/hirepool-site-policy.js`
- `extension/hirepool/manifest.json`
- `extension/hirepool/site-policy.js`
- `extension/hirepool/background.js`
- `extension/hirepool/content.js`
- `extension/hirepool/page-entry.js`
- `extension/hirepool/README.md`
- `backend/src/local-integrations/hirepool-auth.js`
- `backend/src/local-integrations/hirepool-continuation-store.js`
- `backend/src/app.js`
- `backend/src/middleware/security.js`
- `backend/src/routes/chat.js`
- `backend/.env.example`
- `widget/src/sdk.js`
- `widget/src/widget.js`
- `tests/local-hirepool.test.js`

The ignored `backend/.env` was deliberately not edited. When using an explicit CORS allowlist, configure the exact extension origin identified in `config/hirepool-site-policy.js` along with the approved public-site origins.

## Authentication boundaries and limitations

- The extension is a local-development mechanism, not a production injection/deployment solution.
- Safe handoff depends on an allowlisted identity/profile `GET` after login. If an incomplete-onboarding login performs no such request, the extension cannot safely obtain identity under this design. In that case it fails closed; finish the existing HirePool onboarding flow and start a new assistant request. It must not infer that login succeeded.
- The access token is transiently visible to the extension's filtered `webRequest` callback and is sent only to the local SDK bridge for validation. No refresh token is observed. No token is placed in a URL, browser storage, the model prompt, or application logs.
- SDK credentials and server sessions expire after five minutes. Continuation references expire after ten minutes and are single-use. Backend restart loses continuations, session credentials, and conversation state. A refresh during a pending login can use the extension-held reference; a refresh after login requires a new authentication continuation.
- The extension's logout notification is based on the existing dashboard navigating to `/login`. If the local bridge cannot be reached at logout, the opaque session expires on the server; the extension reports the revocation failure.
- No authenticated live browser/E2E login was run. The report therefore does not claim that the real HirePool login, Chrome permission prompt, or role-specific live API path has been manually verified.

## Automated validation

`npm run test:mock` covers the existing authentication lifecycle, streaming, dynamic API, and local HirePool tests (63 passed, 0 failed on the latest full run). The local HirePool tests now additionally verify:

- exact public-site origin/path decisions and rejection of dashboard routes;
- the pinned extension ID and public-only content-script host list;
- dashboard-origin bridge rejection;
- confirmed guest login-action generation;
- verified conversation ownership binding and single-use continuation consumption.

The built SDK was also executed against a simulated dashboard URL and refused initialization before a widget mount or network call. The local bundle was rebuilt without overwriting tracked public SDK assets.

Validation uses mock providers and mocked identity responses only; it performs no HirePool business operations.

## Manual browser validation plan

1. Enable the two explicit local bridge/discovery flags and configure the exact extension origin in the local SDK CORS allowlist. Load `extension/hirepool` as an unpacked MV3 extension in Chrome.
2. Open each approved public route on ports 3000 and 3001. Verify the widget appears once. Open an unlisted route and the dashboard on port 5173; verify no assistant is visible and no dashboard bridge session is issued.
3. As a guest, ask for a personal/account-specific action. Confirm the assistant proposes login, and verify the login tab opens only after selecting the confirmation button.
4. Complete login with a candidate, client, or consultancy account that triggers one of the allowlisted identity/profile `GET` requests. Verify the original public tab is focused, the request resumes in the same conversation, and the server applies the verified role-specific read-only tool list.
5. Try an unsupported/admin identity and an identity request failure. Verify no SDK session is established and the assistant displays a failure notice.
6. Log out from the dashboard and verify the public-site assistant clears its authenticated conversation and revokes the opaque SDK session. Test refresh during a pending login and backend restart to confirm the documented expiry behavior.
7. Inspect browser and server storage/logs. Confirm no raw access/refresh token appears in extension/session/widget storage, URLs, the model-visible action, or logs. The access token should only occur transiently in the filtered local bridge request header.
