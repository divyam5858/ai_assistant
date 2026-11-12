# Dynamic API Discovery and Tool Generation — Implementation Report

## Result

Implemented an opt-in, generic OpenAPI-to-read-tool path. Dynamic discovery is disabled by default and forcibly disabled when either `NODE_ENV` or `VERCEL_ENV` is `production`. No HirePool routes, credentials, or API behavior were invented or registered.

The feature is usable only after an application registers a trusted server-side integration. No integration is registered by default.

## Files changed

### Added

- `backend/src/dynamic-api/openapi.js` — Parses OpenAPI 3.0/3.1 JSON and YAML, resolves local references, and normalizes supported GET operations.
- `backend/src/dynamic-api/secure-http.js` — HTTPS-only requests, exact host validation, public-IP DNS checks and pinning, response limits, timeout, and redirect rejection.
- `backend/src/dynamic-api/catalog.js` — Server-owned integration registration, authorization, request-scoped action generation, parameter validation, API execution, and response projection.
- `tests/dynamic-api.test.js` — Mock-only discovery, execution, authorization, isolation, URL, parsing, and response-filtering tests.
- `docs/dynamic-api-discovery.md` — Server-side integration setup and limitations.
- `DYNAMIC_API_DISCOVERY_IMPLEMENTATION_REPORT.md` — This report.

### Modified

- `backend/src/routes/chat.js` — Uses a fresh action registry for each chat request, routes dynamic actions to the server executor, forwards cancellation, and includes action guidance when no context or document is present.
- `backend/src/actions/tool-converter.js` — Passes generated JSON Schemas through to the provider.
- `package.json`, `package-lock.json` — Adds the YAML parser and points the mock test command at the test files present in this checkout.
- `.env.example`, `backend/.env.example` — Documents the opt-in configuration.
- `README.md`, `docs/security.md` — Documents the feature and security boundary.

The pre-existing untracked `SDK_DYNAMIC_API_DISCOVERY_AND_TOOL_GENERATION_AUDIT.md` was preserved and not modified.

## Architecture and behavior

1. A backend application calls `registerDynamicApiIntegration()` with a fixed assistant/application identity, fixed OpenAPI URL and API base URL, explicit operation IDs, response-field projections, and a required authorization callback.
2. The chat route checks the opt-in flag and the authenticated backend user. It fetches and parses the server-configured spec, then creates a request-local `ActionRegistry`; it does not mutate or share the static registry.
3. Only explicitly allowlisted GET operations are generated. Path/query inputs are schema-validated. Existing action permissions are also checked.
4. Execution rechecks the integration authorization callback and uses only server-provided API auth headers. It does not forward browser bearer tokens, connector credentials, or model-supplied headers.
5. The executor uses the configured API base URL, HTTPS, an exact hostname allowlist, public DNS validation and address pinning, no redirects, response/time limits, and a per-operation response-field projection.
6. Results are returned to the user as filtered JSON. They are not fed back into a second model turn, avoiding a tool-output prompt-injection path.

Provider compatibility uses native tools where supported. Providers that use the existing fenced action protocol receive action guidance and parameter descriptions through the existing chat path.

## Supported scope and configuration

The following server environment variables are documented in both environment examples:

- `DYNAMIC_API_DISCOVERY_ENABLED=false`
- `API_DISCOVERY_ALLOWED_HOSTS=` — empty by default; exact hostnames only
- `API_DISCOVERY_TIMEOUT_MS=5000` — accepted range 100–15,000 ms
- `API_DISCOVERY_MAX_SPEC_BYTES=1048576` — accepted range 1 KiB–5 MiB

Supported specifications are OpenAPI 3.0/3.1 in JSON or YAML, with local references. Generated operations are read-only GETs, limited to 20 allowlisted operation IDs per integration and scalar path/query parameters or arrays of scalar values. External references, request bodies, writes, unsupported parameter serialization, and unconfigured operations are not generated.

The spec host and API host must each be present in `API_DISCOVERY_ALLOWED_HOSTS`. Spec authentication, if needed, uses a separate `getSpecAuthHeaders` callback; API credentials are not automatically sent to the spec host. `authorize` is mandatory and runs both before discovery and before execution.

## Security and application-specific limitations

- Production is intentionally gated off even if the feature flag is set.
- No dynamic API integration is registered in the SDK or HirePool. The HirePool API spec and verified endpoint/authentication behavior were not available, so no HirePool operation was added.
- The application must register integrations in trusted backend code and implement authorization/credential callbacks using its own authoritative backend rules. `applicationId` is server-side configuration; the browser cannot select it or use it as authorization.
- GET semantics are not proof that a particular host endpoint is side-effect-free. Integrators must review each operation before allowlisting it.
- The response projection intentionally excludes unselected fields and whole nested objects; integrators should select only the minimum fields needed, especially for personal data.
- Discovery is fetched per chat request and is not cached. This keeps definitions fresh and request-scoped but adds latency and requires the spec host to be available.
- Dynamic results are returned as filtered JSON rather than being summarized by a follow-up model call.
- No real host API, deployed endpoint, or AI provider was contacted during verification.

## Verification

- `node --test tests/dynamic-api.test.js` — **8 passed, 0 failed**.
- `npm test` — **34 passed, 0 failed**. The suite used mocks; no live provider tests ran.
- `npm run build` — **passed**; generated the widget bundles. There is no separate backend build script in this checkout.
- `git diff --check` — **passed**.
- `npm install yaml@^2.8.1` — completed and updated the manifest/lockfile. The install output reported zero vulnerabilities.

The tests cover JSON/YAML parsing, local references, GET-only generation, production/default-off gating, request-scoped registry isolation, authorization denial, parameter validation, auth-header propagation, field projection, host allowlisting, private DNS rejection, redirect rejection, size/content-type limits, address pinning, and action guidance. Network and API behavior are mocked; these results do not establish live service or deployment behavior.

## Manual next steps

1. For a non-production evaluation, add only the exact spec/API hostnames to `API_DISCOVERY_ALLOWED_HOSTS`; keep `NODE_ENV` and `VERCEL_ENV` non-production.
2. In the host application's backend startup code, register an integration using its actual OpenAPI document, reviewed GET operation IDs, minimal response fields, verified user/tenant authorization, and server-side delegated credentials.
3. Run the SDK tests and verify the host API with test credentials in a controlled environment. Do not put credentials in the browser or in the OpenAPI document.
4. Do not deploy this feature as enabled: production gating is deliberate. A separate security review and explicit policy change are required before production enablement.
