# Host Integration Security Model

This document describes the security boundaries implemented by the SDK and the controls that the host/deployment must supply. It is not a formal penetration test or a claim of security certification.

## Trust boundaries

| Input or component | Trust level | Required treatment |
|---|---|---|
| Verified JWT claims on the backend | Trusted after signature/claim verification | Use for user, tenant, and action scopes. Keep the signing secret server-side. |
| Host page context | Untrusted | Provide only needed context; it is sanitized and framed as context, but must never authorize an API operation or be treated as a security boundary. |
| User text, client history, uploaded document text | Untrusted | Validate size/schema; restrict history roles; treat as data, not system instructions. |
| Model-generated action proposal/tool call | Untrusted | Require a registered action, validate parameters, filter by trusted scopes, and independently authorize execution. |
| Browser permission callback/confirmation | UX signal only | Do not accept as backend authorization; re-check identity, permissions, tenant, and record access at the host API. |
| Backend provider keys and JWT/API keys | Secret | Keep in server environment/configuration; never ship in the JavaScript bundle or context. |

## Controls present in source

- Authentication middleware supports HS256 JWT verification and API-key comparison, optional/required modes, issuer/audience checks, expiry and not-before validation, and timing-safe signature/key comparison.
- Session ownership and tenant isolation are checked for chat, document, and session routes.
- Client history schema allows only `user` and `assistant` roles; system instructions remain server-generated.
- Host context/document contents are framed separately from system instructions. Document content is escaped and capped before being included in the prompt.
- Action/tool exposure is constrained to registered definitions and trusted JWT scopes. Parameters may have Zod schemas; action risk is represented as read/write/destructive.
- The widget escapes action details and requires a separate acknowledgement for destructive-risk proposals.
- Express middleware includes Helmet, CORS, and API rate limiting; API errors use structured responses and production 5xx responses are sanitized.

## Required host-side controls

1. **Authorization:** Every executor must revalidate current user, tenant, record ownership, and permission in the host API. Never trust `canExecuteAction`, a role in page context, or model intent as proof of authorization.
2. **Credentials:** Use short-lived scoped bearer tokens or a same-origin backend session. Do not expose service API keys to browsers. Protect JWT secrets and configure issuer/audience.
3. **Transport and origin policy:** Require TLS. The generic SDK API uses wildcard CORS and does not require each host origin to be configured. CORS is not authentication; production authorization remains mandatory for protected endpoints.
4. **Credentialed requests:** Wildcard CORS is sent without `Access-Control-Allow-Credentials`. Cross-origin clients must use bearer authorization or `X-API-Key`; cookie credentials are not compatible with this policy.
5. **Session storage:** Replace process-local memory with a durable store that applies owner/tenant checks at every read/write and supports deletion and retention policies.
6. **Action effects:** Validate input again, make writes idempotent where possible, use confirmation UX for consequential changes, and keep server-side audit records.
7. **Privacy:** Limit context and document uploads to what is needed; establish retention/deletion rules; avoid logging raw file text, credentials, or personal data.
8. **Availability:** Configure provider timeouts/retries, rate limits, payload limits, monitoring, and provider fallback according to operational needs.

## Limitations and residual risks

- The in-memory session store is unsuitable for durable or multi-instance production operation.
- `sessionStorage` content is available to scripts running in the host origin; do not treat it as a secret store.
- The generic SDK API intentionally permits any origin without credentialed cross-origin cookies; authentication and authorization must not depend on origin headers.
- The browser action callback is not a security boundary. A user can bypass or alter browser code.
- The generic demo uses mock user state and in-memory note data only.
- Context/document prompt framing mitigates accidental instruction confusion but cannot guarantee that an AI model will ignore all malicious text; model output must remain constrained and independently validated.

For the API/session lifecycle see [Document Q&A and Session Flow](./SDK_DOCUMENT_QA_AND_SESSION_FLOW.md). For setup and action wiring see [Level 3 Integration Guide](./SDK_LEVEL3_INTEGRATION_GUIDE.md).
