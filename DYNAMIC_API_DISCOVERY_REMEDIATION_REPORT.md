# Dynamic API Discovery — Remediation Report

## 1. Initial repository state

- Repository root: `D:\ai-assistant-plugin`
- Branch: `main`
- Worktree was already dirty before remediation. Modified files at initial inspection:
  `.env.example`, `README.md`, `backend/.env.example`,
  `backend/src/actions/tool-converter.js`, `backend/src/routes/chat.js`,
  `docs/security.md`, `package-lock.json`, and `package.json`.
- Pre-existing untracked paths included the dynamic API implementation directory,
  `docs/dynamic-api-discovery.md`, `tests/dynamic-api.test.js`,
  `DYNAMIC_API_DISCOVERY_IMPLEMENTATION_REPORT.md`, and
  `SDK_DYNAMIC_API_DISCOVERY_AND_TOOL_GENERATION_AUDIT.md`.
- Those changes were preserved. No production `.env` file was read or changed.
- The package scripts in this checkout configure `npm test` to run `npm run test:mock`,
  which invokes only `tests/auth-lifecycle.test.js`, `tests/chat-stream.test.js`, and
  `tests/dynamic-api.test.js`. The earlier script at `HEAD` referenced numerous test
  files that are absent from this checkout; that pre-existing script change was not
  modified in this remediation.

## 2. Issues verified and remediated

1. `createRequestActionRegistry()` cloned the assistant registry even when discovery
   was disabled and did not copy a custom registry tag. This could change the existing
   registry identity and fenced-action tag. Disabled discovery now returns the original
   registry. Enabled discovery uses a request-local clone that preserves the tag and
   static action definitions.
2. The HTTPS timeout began only after DNS resolution. It now starts before DNS and
   covers DNS wait, connection/request, and response-body reading. Timeout and
   cancellation settle the request, destroy pending request/response streams, clear
   the timer, and prevent a late DNS result from starting an HTTP request.
3. IPv4/IPv6 address classification omitted several special-use ranges, including
   IPv4 documentation/special-purpose ranges and IPv6 `2001:db8::/32`. The classifier
   now uses explicit IPv4 CIDR exclusions and allows only IPv6 global-unicast addresses
   outside its documented special ranges. IPv4-mapped IPv6 addresses are rejected
   because they are outside the accepted IPv6 global-unicast space.
4. The integration executor did not independently recheck the feature/production
   gates. It now checks them before authorization or network execution.
5. Operation IDs were only checked for a non-empty length. Registration and parsed
   specifications now restrict IDs to a bounded identifier syntax. Generated names
   use a longer digest and a bounded slug.
6. The guide omitted the `VERCEL_ENV` production gate and did not state missing/invalid
   limit behavior. Those details are now documented.

## 3. Files modified in this remediation

- `backend/src/dynamic-api/catalog.js`
- `backend/src/dynamic-api/openapi.js`
- `backend/src/dynamic-api/secure-http.js`
- `tests/dynamic-api.test.js`
- `docs/dynamic-api-discovery.md`
- `DYNAMIC_API_DISCOVERY_REMEDIATION_REPORT.md` (this report)

No authentication implementation, production environment configuration, package
manifest, or unrelated existing modification was changed.

## 4. Registry compatibility

- With discovery disabled, the original assistant registry object is returned and
  existing static/manual actions and its tag remain unchanged.
- With discovery enabled, each chat request receives a separate `ActionRegistry`
  initialized with the existing tag and static definitions. Generated actions are
  added only to that request-local instance.
- Regression tests verify the default `action` tag, a custom `action:tenant` tag,
  static action preservation, custom fenced-proposal parsing/dispatch, disabled-mode
  identity, and isolation between concurrent authorized/unauthorized request registries.
- No dynamic definitions are written into the shared static action registry.

## 5. IP classification and outbound request policy

- Exact hostname allowlisting, HTTPS-only URLs, DNS resolution, public-address
  validation, and pinning the selected DNS result remain enforced.
- IPv4 exclusions include unspecified, private, shared-address, loopback, link-local,
  documentation, benchmarking, special-purpose, multicast, and reserved ranges,
  including the explicit blocks used in the test table.
- IPv6 addresses must be in `2000::/3` and are rejected for the IETF protocol
  assignments block `2001::/23`, documentation blocks `2001:db8::/32` and `3fff::/20`,
  and 6to4 `2002::/16`. Loopback, unspecified, link-local, unique-local, multicast,
  IPv4-compatible, and IPv4-mapped forms are outside the accepted range.
- Tests cover representative public and prohibited values in each requested category,
  dotted and hexadecimal IPv4-mapped forms, scoped IPv6, and invalid input.
- This is an explicit conservative policy, not an automatically maintained copy of
  every IANA special-purpose registry entry. Newly allocated ranges require policy
  review and tests before they can be claimed as covered.

## 6. Timeout implementation

`API_DISCOVERY_TIMEOUT_MS` now applies as one absolute timeout per outbound request,
beginning before DNS lookup and ending only after response-body consumption. DNS
lookup itself is not cancellable through Node's `dns.lookup` promise; when timeout or
abort occurs, the outer operation rejects immediately, and a late DNS completion is
checked before request creation. Thus, it cannot start an outbound HTTPS request after
the caller has timed out or cancelled.

The HTTPS request remains pinned to the validated address, does not follow redirects,
and retains response size/content-type limits. Stream listeners and timeout/abort
listeners are cleaned up on completion, error, abort, and timeout.

## 7. Tests added or expanded

`tests/dynamic-api.test.js` now contains 17 tests covering:

- OpenAPI JSON/YAML parsing, local references, and GET-only operations.
- Feature default-off, both production gates, and execution-time gate recheck.
- Default/custom registry tags, static/manual actions, fenced action execution,
  disabled-mode behavior, and request isolation.
- Operation-ID validation and generated tool-name collision resistance.
- Permission enforcement, parameter validation, server-side credential callback use,
  and response-field projection.
- Host allowlisting, IP range categories, DNS pinning, redirect rejection, response
  content-type/size limits, and invalid configuration limits.
- DNS timeout/cancellation, no request after late DNS completion, connection timeout,
  overall timeout, response timeout/cancellation, and resource destruction.

All network behavior in these tests is mocked. No DNS lookup, real application API,
or AI provider was contacted.

## 8. Verification results

- `node --test tests/dynamic-api.test.js` — **17 passed, 0 failed, 0 skipped**.
- `npm test` — **43 passed, 0 failed, 0 skipped** across the three files named by the
  current configured mock-test script.
- `npm run build` — **passed**; the widget/SDK bundles built successfully. This
  repository has no separate backend build script.
- `git diff --check` — **passed** before report creation; it is rerun after this report
  is written as part of final verification.

The entire historical list of test paths from the earlier package script was not
executed because those files are absent from the current checkout and are not in the
current configured script. No live-provider test was run.

## 9. Remaining limitations

- No application-specific integration is registered. No HirePool API behavior has been
  verified or connected.
- Dynamic discovery remains opt-in and gated off when `NODE_ENV` or `VERCEL_ENV` is
  exactly `production`. The operator must also keep the feature flag false in production;
  the environment checks cannot identify production if deployment markers are missing.
- The range policy is intentionally explicit and conservative, but must be maintained
  as special-purpose IP allocations evolve.
- DNS resolution cannot be forcibly cancelled through the current promise API. The
  request layer rejects on timeout/cancel and does not issue HTTPS if DNS completes late.
- GET semantics do not guarantee that a host endpoint is side-effect-free. Each
  operation must be reviewed by its application owner before allowlisting.
- No real host service, deployment, or browser flow was verified.

## 10. Controlled integration testing

The remediated code is appropriate for **mock-based testing and isolated controlled
integration testing** using a test service, test credentials, exact host allowlisting,
and reviewed read-only operations. It is not production-ready and must not be enabled
in production. Do not use real candidate/customer data or unreviewed host endpoints
during evaluation.

## 11. Final safety checks

- Production environment configuration: not changed.
- Authentication code: not changed.
- Dynamic discovery: remains disabled by default and blocked when either production
  marker is set.
- Real application APIs or providers contacted: no.
- Deployment, commit, or push: none.
- Git history or unrelated user changes: preserved.
