# Final Chat Stream Production Fix Report

## Root cause

**The production HTTP 500 is not confirmed.** The current production deployment could not be queried for runtime logs: the Vercel CLI reported that deployment `63uXCb8tCS1GjkkTrx759RhnkyvZ` was not found under the workspace's currently linked team. No production request was sent and no deployment was performed.

Two relevant findings were verified locally:

1. **Vercel catch-all normalization had a real routing defect.** Express had already parsed and cached the original URL/query before the path-normalization middleware rewrote `req.url`. A catch-all request such as `/api?path=normalizer-probe&trace=preserved` therefore did not reach the rewritten route with the rewritten query. The normalizer now refreshes Express's parsed URL and query state, preserves unrelated query parameters, and handles a catch-all `x-matched-path`.
2. **Missing production authentication configuration can produce the reported failure shape.** A local production-mode test confirmed `/api/health` can return 200 while a protected chat request fails immediately with a generic 500 if JWT auth is required but `JWT_SECRET` is absent. The provider is not called, and the server-side diagnostic identifies the missing secret. This is a plausible explanation for the reported short request/no provider call, **not proof that production has this configuration problem**. The production environment must be checked after diagnostic logging is deployed.

The client payload matches `ChatRequestSchema`; a mocked end-to-end stream reaches the provider and emits SSE events. The `path=chat%2Fstream` query is consistent with the Vercel catch-all rewrite and is not, by itself, the confirmed cause of the reported 500.

## Changes made

- `backend/src/app.js`: corrected catch-all path normalization and refreshed Express's parsed URL/query after rewriting.
- `backend/src/middleware/logger.js`: added structured exception logs with request ID, method, normalized path, error name/message/stack; redacts configured provider/JWT secrets and common credential patterns; does not log request headers or body.
- `backend/src/middleware/error-handler.js`: logs server errors while retaining the generic production HTTP response.
- `backend/src/routes/chat.js`: logs failures after SSE headers are sent, keeps production SSE error messages generic, and aborts provider work only when the response connection closes before completion.
- `tests/chat-stream.test.js`: adds focused tests for health, catch-all routing/query preservation, the widget payload, provider invocation, action registry resolution, invalid requests, production auth behavior, safe logging, generic failures, and PDF worker parsing.
- `package.json`: includes the new focused test file in the standard mock test command.

No PDF worker implementation, provider selection, authorization policy, or deployment configuration was changed.

## Tests and builds

| Check | Result |
|---|---|
| Focused regression tests: `node --test tests/chat-stream.test.js` | **PASS — 12 passed, 0 failed** |
| Widget build: `npm run build` | **PASS** |
| Local Vercel build: `vercel build` | **PASS**; Vercel generated a `nodejs26.x` function bundle |
| Synthetic PDF parsed through the lazy worker | **PASS**; one-page text extracted |
| Packaged PDF worker | **PASS**; `pdf-parse/dist/worker/pdf.worker.mjs` is present in the generated function |
| `npm test` | **PASS — 12 passed, 0 failed**; only the available focused test file ran |
| `npm run test` | **PASS — 12 passed, 0 failed**; only the available focused test file ran |
| `git diff --check` | **PASS**; Git only reports existing line-ending conversion warnings |
| Node.js 26 execution | **NOT VERIFIED**; local `nvm list` contains only Node.js 24.22.1 |
| Live Gemini / browser / production verification | **NOT RUN** |

The standard test command lists the existing suite files, but 18 tracked test files are deleted in the worktree (including the API, auth, Vercel-entry, and document-pipeline tests). Node.js ran the available `tests/chat-stream.test.js` and did not report the missing paths as failures, so the 12-pass result **does not represent the full prior suite**. Those deletions were preserved at the user's direction; they were not restored or modified. `vercel build` ran its normal `npm install` step and completed without tracked manifest/lockfile changes.

## Production and runtime limitations

- The local Vercel artifact targets Node.js 26 and contains the PDF worker, but it was built and exercised locally on Node.js 24.22.1. The artifact metadata is not evidence that the function has executed successfully on Node.js 26.
- Health checks the provider, not the protected chat route's authentication configuration. A healthy response therefore does not rule out a missing `JWT_SECRET`/`API_KEY` or another early middleware failure.
- The production request's original exception remains unknown. The structured log change must be deployed before that exception can be identified from runtime logs.
- No production fix is verified until a deployed endpoint is exercised. No deployment, commit, push, or environment-variable change was made.
- The full prior regression suite cannot be evaluated until the intentionally preserved test-file deletions are resolved.

## Exact next manual steps

1. Review the current worktree and resolve the deleted tracked test files according to your intended changes; do not run the package-level suite until those files are restored or the test command is deliberately updated.
2. In Vercel's project settings, verify that the production environment has the authentication mode configured for the frontend and that its required server secret is present (`JWT_SECRET` for JWT/hybrid, or `API_KEY` for API-key mode). Do not expose the values in logs or chat.
3. After approving these code changes, deploy a **Preview** build manually. Send one authenticated `POST /api/chat/stream` request using the existing request schema and record its `x-request-id`.
4. Inspect the matching runtime diagnostic. If it reports missing authentication configuration, correct that configuration through the normal owner-controlled process; otherwise use the logged exception and stack to address the actual failure.
5. Verify the Preview health endpoint, authenticated streaming response, and PDF upload. Only then decide whether to promote/deploy to Production and repeat the same checks there.
