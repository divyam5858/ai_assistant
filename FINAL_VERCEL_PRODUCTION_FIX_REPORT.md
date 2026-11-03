# Final Vercel Production Readiness Audit

## Executive status

**Local Node.js 26 and packaged-function verification: PASS. Production deployment readiness: NOT VERIFIED.** No Vercel deployment, production environment change, live provider test, commit, or push was performed.

The original PDF failure was caused by the serverless package's missing CommonJS-relative PDF worker file. A separate packaging check also found that the local Vercel build's default static output included repository files, including local environment-file paths and the ignored candidate fixture. The static output is now restricted to `public/`; the build copies only the demo and SDK assets there. The final generated output contains no `.env` or candidate-fixture paths.

## Root cause and changes

- [backend/src/services/document-parser.js](./backend/src/services/document-parser.js) lazily loads `pdf-parse@2.4.5` and its `pdf-parse/worker` ESM helper only when a PDF is uploaded. Initialization or missing-worker failures return `503 PDF_PROCESSOR_UNAVAILABLE`; unrelated API routes do not need the PDF runtime.
- The final function bundle includes `node_modules/pdf-parse/dist/worker/esm/index.js` and `node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`. A generated PDF parsed successfully from the bundle under Node.js 26.13.0.
- [vercel.json](./vercel.json) now uses `outputDirectory: "public"` and no longer rewrites `/sdk` to `/public/sdk`.
- [widget/build.js](./widget/build.js) copies the demo into `public/demo` so the restricted static output retains the existing demo and SDK assets. [`.gitignore`](./.gitignore) ignores that generated directory.
- [package.json](./package.json) makes `npm test` mock-only and provides `npm run test:live` as an explicit live-provider opt-in. The live test remains available and was not run.
- The audit finding was fixed by upgrading direct production dependency Zod from 3.25.76 to 4.6.7. [backend/src/actions/registry.js](./backend/src/actions/registry.js) now uses explicit string-keyed records; [backend/src/middleware/error-handler.js](./backend/src/middleware/error-handler.js) reads Zod's `issues`.
- [tests/session-manager.test.js](./tests/session-manager.test.js) now simulates expiration by setting an old activity timestamp rather than relying on a 50 ms timer, eliminating a Node 26 scheduling flake. Regression coverage was added for Zod validation response formatting in [tests/security.test.js](./tests/security.test.js).
- [tests/document-pipeline.test.js](./tests/document-pipeline.test.js) uses a generated generic PDF rather than a candidate-profile fixture. [tests/vercel-entry.test.js](./tests/vercel-entry.test.js) checks the safe static output configuration and missing-worker handling.

No authentication, ownership, consent, provider-secret handling, rate limits, upload limits, or document persistence behavior was weakened. No Vercel environment variables were changed.

## Files changed

- `.gitignore`, `.vercelignore`, and `vercel.json`
- `widget/build.js`
- `backend/src/services/document-parser.js`
- `backend/src/actions/registry.js`
- `backend/src/middleware/error-handler.js`
- `package.json` and `package-lock.json`
- `tests/document-pipeline.test.js`
- `tests/security.test.js`
- `tests/session-manager.test.js`
- `tests/vercel-entry.test.js`
- `FINAL_VERCEL_PRODUCTION_FIX_REPORT.md`

## Node.js 26 compatibility

| Check | Result |
|---|---|
| Local Node.js 26 availability | PASS — Node.js `v26.13.0` |
| Full mock suite on Node.js 26 | PASS — 224/224 |
| SDK build on Node.js 26 | PASS |
| Local Vercel build function metadata | PASS — both API functions target `nodejs26.x` |
| Generated Vercel function executed directly under Node.js 26 | PASS — see packaged smoke tests below |
| Actual managed Vercel Node.js 26 runtime | NOT VERIFIED — no deployment was performed |

## Audit finding

`npm audit` identified direct production dependency **Zod 3.25.76**, affected by **GHSA-mrhx-c7xc-m3w5** (high severity, CVSS 7.5): memory exhaustion while validating oversized constrained collections. The advisory affects versions below 4.6.6; npm offered only the breaking-major update to 4.6.7, with no patched Zod 3 release reported. Zod validates production action definitions and proposals in the action registry, so this affected runtime behavior.

The project now pins **Zod 4.6.7** in `package.json` and `package-lock.json`. The full mock suites, action tests, and explicit Zod error-format regression passed. Final `npm audit`: **0 vulnerabilities**.

## Test isolation and dependency installation

- `npm test`: PASS — 224/224, no skips.
- `npm run test`: PASS — 224/224, no skips.
- Node.js 26 `npm run test:mock`: PASS — 224/224, no skips.
- The default test commands do not load `backend/.env` and exclude `tests/gemini-live.test.js`; provider tests use mocks or injected clients.
- `npm run test:live` explicitly loads `backend/.env` if present and runs the Gemini live smoke tests. It was **not run**, so no live provider behavior is claimed.
- An isolated clean `npm ci --offline` using copies of `package.json` and `package-lock.json` succeeded: 131 packages installed, 132 audited, zero vulnerabilities; installed versions were Zod 4.6.7 and pdf-parse 2.4.5. npm warned that the esbuild postinstall script is not covered by its `allowScripts` configuration; the SDK build and Vercel build both succeeded.

## PDF and deployment packaging verification

| Check | Result |
|---|---|
| `npm run build` on Node.js 24.22.1 | PASS |
| `npm run build` on Node.js 26.13.0 | PASS |
| Local `vercel build --yes --output <temp>` | PASS |
| Function runtime metadata | PASS — `nodejs26.x` |
| ESM worker helper and PDF worker source in generated function | PASS |
| Final static output | PASS — 8 intended demo/SDK files only |
| `.env` files and candidate fixture in static/function output | PASS — none present |
| Packaged `/api/health` and `/api/config/default` | PASS — HTTP 200 |
| Packaged upload without authentication | PASS — HTTP 401 |
| Packaged upload without consent | PASS — HTTP 400 |
| Packaged synthetic PDF upload | PASS — HTTP 200, one page; extracted text not returned |
| Packaged synthetic DOCX upload | PASS — HTTP 200; extracted text not returned |
| Packaged corrupt PDF upload | PASS — HTTP 422 `CORRUPT_DOCUMENT` |
| Missing-worker failure path | PASS — unit test returns controlled 503 |

The packaged-function checks ran against the generated local Vercel function directory using Node.js 26.13.0, a temporary local JWT signing secret, and `MockAIProvider`. No provider credentials or real AI services were used. This does not verify Vercel's managed runtime, deployed routing, Vercel environment variables, or browser behavior.

## Security review

- `git ls-files` shows no actual `.env`, `.env.local`, `backend/.env`, or candidate PDF fixture tracked; only example environment templates are tracked. Secret-file contents were not inspected.
- The final local Vercel output contains no environment files or candidate fixture. The ignored candidate fixture remains excluded and was not used.
- Production authentication remains required by the existing middleware. The packaged Node 26 check rejected unauthenticated upload; a locally signed test JWT was used only to verify authorized flow.
- Document consent assertion and current version are still required; an omitted assertion/version remains rejected. Multipart upload size limits and parser validation remain in place.
- The public configuration response did not contain API-key identifiers or the temporary test secret. No provider credentials were included in the static output or returned by the tested endpoint.
- No security tests were removed; one Zod error-format test was added, and the timing-sensitive session test was made deterministic.

## Remaining risks and exact next steps

1. **Do not treat this as a verified production deployment.** After approval, manually create a Vercel Preview deployment from the reviewed changes and confirm the managed runtime, environment configuration, `/api/health`, `/api/config/default`, `/sdk/assistant.js`, and `/` demo route.
2. In that Preview only, verify unauthenticated protected requests fail, then upload synthetic consented PDF and DOCX files; confirm missing/stale consent and corrupt uploads fail, and verify `/backend/.env` and `/tests/fixtures/...` are not served.
3. Configure required production authentication, provider selection, and provider credentials only through the approved Vercel environment-variable workflow. No Vercel settings were changed here.
4. Proceed to production only after the Preview checks and browser verification pass.

No deployment, commit, or push was made.
