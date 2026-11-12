# HirePool local website assistant extension

This unpacked Chrome Manifest V3 extension is for local development only. It attaches the SDK to the HirePool public website on approved local origins and paths; it does not inject a widget into the dashboard app.

## Local setup

1. Run the SDK backend on `http://localhost:3100`, HirePool API on `http://localhost:8000`, the public website on port `3000` or `3001`, and the existing login app on `http://localhost:5173`.
2. Enable `ENABLE_HIREPOOL_LOCAL_BRIDGE=true` and `DYNAMIC_API_DISCOVERY_ENABLED=true`. Configure `HIREPOOL_LOCAL_ALLOWED_ORIGINS` and `CORS_ALLOWED_ORIGINS` with the public-site origins and the exact `chrome-extension://` origin shown in `config/hirepool-site-policy.js`. The SDK's `backend/.env.example` contains a local example.
3. Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose this directory.
4. Open an approved public website URL. After changing extension files, reload the extension on `chrome://extensions`.

The extension ID is pinned by the public manifest key and must match the bridge/CORS origin. No HirePool source or environment file needs to be changed.

## Visibility policy

The content script is declared only for the public website development origins. Before injecting the page entry, the service worker checks the exact origin and approved paths in `site-policy.js`. The SDK independently applies the same policy during initialization and subsequent SDK operations. The dashboard origin (`localhost:5173`) is not a content-script match and is rejected by the SDK and the local identity bridge.

## Login continuation and credential handling

- Login opens the existing HirePool login page in a separate tab; the original public-site tab remains open and is focused after successful verification.
- The service worker observes only `GET` requests to the explicit `/api/v1/auth/me` and role-profile identity paths, initiated by `http://localhost:5173`. It reads the `Authorization` header only while a login continuation is pending.
- The access token is forwarded transiently to the local SDK bridge for `/api/v1/auth/me` and membership-role validation. The extension does not inspect response bodies, passwords, localStorage, or refresh tokens; it does not store or log the access token.
- The extension's session storage retains only the opaque single-use continuation reference, tab IDs, and an expiry. The server stores the pending message and conversation binding in memory. An opaque SDK credential is held in page memory for the active tab and is not put in extension or widget storage.
- Only candidate, client, and consultancy identities with eligible membership roles are accepted. Authentication errors fail closed. Logout routing to `/login` revokes the active SDK session and clears the local conversation when reachable.

## Limitations

- This is not a production deployment/injection mechanism. It requires a locally loaded Chrome extension and local HTTP services.
- Token handoff requires the dashboard to issue one of the allowlisted identity/profile `GET` requests after login. An incomplete-onboarding flow that makes no such request cannot be bridged safely by this observer; the assistant will not guess or claim authentication succeeded.
- Access-token/SDK sessions, continuation state, and backend conversations are in-memory. Backend restart invalidates pending continuations and active SDK credentials; active credentials expire after five minutes. A page refresh during the pending login can resume using the extension's opaque reference, but a refresh after login requires a new authentication continuation.
- This extension adds no business-operation tools. The existing HirePool integration exposes only the configured role-scoped read-only `GET` operations.

See `SDK_HIREPOOL_WEBSITE_ONLY_AUTH_IMPLEMENTATION_REPORT.md` at the SDK repository root for implementation details, test results, and the manual browser validation plan.
