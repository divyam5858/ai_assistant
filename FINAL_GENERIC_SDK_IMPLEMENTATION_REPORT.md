# Generic AI Assistant SDK Implementation Report

## Status

The generic SDK changes, the HirePool host adapter checks, and available local builds/tests pass. This does not establish a live HirePool-to-SDK integration: no deployed services, real credentials, or browser session were used.

## Implementation summary

- The generic version-1 host adapter supports application identity, refreshed context, short-lived request headers, permission UX, host action execution, lifecycle callbacks, and context subscriptions.
- Generic registries start empty. Application action definitions are registered explicitly. HirePool read actions and legacy HirePool actions remain in the `integrations/hirepool/` package, not in generic schema or registry defaults.
- The HirePool adapter uses the existing HirePool access-token flow and authenticated API client. It exposes minimal route/role/selected-entity context and executes only bounded read actions:
  - `jobs:search` → `GET /api/v1/jobs/search`
  - `jobs:view` → `GET /api/v1/jobs/{job_id}`
  - `profile:view` → `GET /api/v1/candidates/profile`
  - `applications:list` → `GET /api/v1/applications/my-applications`
- No write actions were added. Frontend role checks gate UX only; HirePool APIs remain authoritative for record-level authorization.
- Document uploads require a versioned processing notice and explicit consent assertion before extraction. Temporary document context can be included in later provider requests. The assertion is not proof of human consent.
- Session expiry, provider misconfiguration, authentication failures, and stream errors are surfaced instead of silently turning into success-shaped responses. Production requires authentication and disallows the mock provider.
- PDF parsing configures `pdf-parse` to use its embedded worker data, avoiding dependence on the separate worker file implicated in the reported serverless upload failure.

## Key files

- Generic adapter and widget: `widget/src/integration.js`, `widget/src/sdk.js`, `widget/src/widget.js`, `widget/src/api-client.js`, `widget/src/storage.js`, `widget/src/styles.css`
- Backend boundaries: `backend/src/middleware/auth.js`, `backend/src/session-manager.js`, `backend/src/routes/documents.js`, `backend/src/services/document-parser.js`, `backend/src/providers/factory.js`, `backend/src/actions/registry.js`
- Integrations: `integrations/hirepool/actions.js`, `integrations/hirepool/legacy-actions.js`, `demo/integration.js`
- Configuration and docs: `config/document-upload.js`, `config/schemas.js`, `vercel.json`, `README.md`, `docs/`, `SDK_LEVEL3_INTEGRATION_GUIDE.md`, `SDK_DOCUMENT_QA_AND_SESSION_FLOW.md`, `SDK_INTEGRATION_SECURITY_MODEL.md`
- Validation: `tests/api-client.test.js`, `tests/auth.test.js`, `tests/document-pipeline.test.js`, `tests/hirepool-actions.test.js`, `tests/integration.test.js`, `tests/provider-factory.test.js`, and related existing test files
- Generated SDK bundles: `public/sdk/assistant.js`, `public/sdk/assistant.min.js`, `public/sdk/assistant.js.map`

The worktree contained unrelated/pre-existing modifications at the start; they were preserved.

## Verification

| Check | Result |
|---|---|
| SDK mock suite (`npm run test:mock`) | PASS — 211 tests, 0 failures |
| SDK widget build (`npm run build`) | PASS — standalone and minified bundles generated |
| PDF/document pipeline (`node --test tests/document-pipeline.test.js`) | PASS — 28 tests, including extraction from a real PDF fixture |
| HirePool adapter tests (`npm run test:assistant`) | PASS — 6 tests; API behavior is mocked |
| HirePool frontend build (`npm run build`) | PASS — TypeScript and Vite; Vite reported a large-chunk warning |
| HirePool backend tests (`.venv\Scripts\python.exe -m pytest -q`) | PASS — 13 tests, 37 warnings; job-access tests use a fake database |
| Live AI provider / live HirePool API / browser E2E | NOT RUN — no live credentials or deployed services available |
| Write-action confirmation flow | NOT APPLICABLE — no write actions are registered |

`git diff --check` reported a trailing blank line in the already-modified `api/[...path].js` entry file, plus Windows line-ending notices. The entry file was not changed as part of this follow-up.

## Remaining limitations

- Server-side sessions and extracted document text remain process-local and are not durable across restarts or serverless instances.
- A host must configure the SDK backend to verify the existing HirePool JWT. The public SDK API uses wildcard CORS without cross-origin cookie credentials.
- The client consent assertion is a workflow guard only. Hosts must supply appropriate privacy language, retention, and deletion policies.
- PDF worker handling passed local fixture tests but has not been exercised on a deployed Vercel function.
- Live API authorization, token refresh, CORS, and browser behavior remain unverified against deployed services.

## Manual browser verification

1. Configure the SDK backend with `NODE_ENV=production`, `AUTH_MODE=jwt`, `AUTH_REQUIRED=true`, the matching server-side JWT verification secret, a real provider, and `ENABLE_HIREPOOL_INTEGRATION=true`. The SDK API uses public wildcard CORS; no per-host origin list is required. Cross-origin cookie credentials are not supported.
2. Set HirePool's `VITE_ASSISTANT_API_URL`, sign in as a candidate, and verify SDK requests forward only the short-lived access token.
3. Ask to search jobs, view a public active job, summarize the current profile, and list the current user's applications. Confirm the host API client is used and responses omit unnecessary personal data.
4. Verify candidate-only actions are unavailable in the UX for other roles, then confirm backend authorization still rejects unauthorized record access.
5. Upload a PDF after accepting the notice, ask a follow-up question, clear the session, and verify the document context is removed. Check logs and network requests for accidental token or document-text exposure.
6. Exercise token expiry and PDF upload on the deployed serverless function; verify refresh behavior, worker availability, and surfaced errors.
