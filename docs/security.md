# Security and Privacy Architecture

The AI Assistant Plugin implements defense-in-depth principles across the browser widget, backend server, and external AI provider connections.

---

## 1. Zero-Exposure Secret Management

- **No Frontend Keys**: The client-side SDK never possesses, requests, or stores the Google Gemini API key.
- **Environment Isolation**: Credentials reside exclusively in `backend/.env`, which is strictly excluded from version control via `.gitignore`.
- **Automatic Error Redaction**: If the upstream provider returns an error string containing an API key or internal identifier, `GeminiProvider._sanitizeError()` scrubs the sensitive substring before the error propagates.
- **Masked Config Endpoints**: The public configuration endpoint `/api/config/:assistantId` filters out internal server properties (such as system instructions and credentials).

---

## 2. Cross-Origin Resource Sharing (CORS)

- Production API CORS permits only exact origins listed in `CORS_ALLOWED_ORIGINS`. Invalid entries (including paths, credentials, query strings, and fragments) fail configuration rather than being silently normalized.
- In non-production environments, an empty allowlist retains permissive development behavior; set an explicit list when testing deployed origins.
- The static `/sdk` script is served with cross-origin script-loading headers; this does not grant API access to the page that loaded it.
- API preflight supports `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`, with `OPTIONS` handled by the CORS middleware. The allow-header list includes bearer/API-key authorization and document consent headers.
- API CORS does not enable `Access-Control-Allow-Credentials`; cross-origin cookie/session authentication is therefore not supported. CORS is not authorization: authentication, session ownership, connector authorization, document consent, rate limiting, and request validation remain enforced independently of `Origin` or `Referer`.

## 3. Rate Limiting & Denial-of-Service Defense

- Built on `express-rate-limit` using an IP sliding window (`RATE_LIMIT_WINDOW_MS = 60000`, `RATE_LIMIT_MAX_REQUESTS = 60`).
- Clients exceeding the threshold receive `429 Too Many Requests` with a standard `Retry-After` header.
- Maximum JSON body size is restricted to `1mb` (`MAX_REQUEST_BODY_SIZE`) to block oversized payload attacks.

---

## 4. Input Sanitization & Prompt Injection Mitigation

- `sanitizePrompt()` removes null bytes (`\u0000`) and unicode bidirectional overrides (`\u202A` - `\u202E`) which are commonly used in prompt injection and obfuscation attacks.
- Strict input length boundaries enforced by Zod:
  - Chat messages: maximum 10,000 characters.
  - Summarization texts: maximum 50,000 characters.
  - Assistant ID / Conversation ID: alphanumeric / UUID only.

---

## 5. Cross-Site Scripting (XSS) Prevention

- The Markdown parser (`widget/src/markdown.js`) passes all incoming assistant text and user text through `escapeHtml()` **before** applying any Markdown transformations.
- Any `<script>`, `<iframe>`, `<img>` with `onerror`, or `<style>` tags are neutralized into harmless text entities (`&lt;script&gt;`).
- Link attributes are strictly sanitized and injected with `target="_blank" rel="noopener noreferrer"`.
- Encapsulation in Shadow DOM guarantees that even if malformed CSS were injected, it cannot affect the host page.

---

## 6. Connector Authorization

- Connectors enforcing access to protected records (e.g. `MockConnector.getCustomerProfile`) require a valid server-validated `authToken`.
- Authorization checks are executed entirely server-side; client claims are never trusted blindly.

## 7. Authentication, actions, and documents

- Production API routes require authentication by default. Configure `AUTH_MODE=jwt` (or `api-key`/`hybrid`) and the corresponding server-only secret; `AUTH_MODE=none` is rejected in production.
- The generic action registry starts empty. Application action definitions are registered explicitly, filtered using verified backend claims where configured, and must be authorized again by the host API at execution time.
- Document upload requires the current versioned consent assertion before multipart parsing and before extraction. It is a protocol check, not cryptographic proof that a person clicked a checkbox. The host must provide accurate, applicable privacy language.
- Extracted document text is held in temporary process memory and can be sent to the configured AI provider with later chat requests. Avoid uploads of data that the host is not permitted to transmit; configure retention and deletion at the deployment boundary.
- The PDF parser uses the package's embedded worker data to avoid relying on a separate worker file being present in a serverless deployment.
- Dynamic API discovery is disabled by default and forcibly disabled in production. Integrations are registered in server code, require an authorization callback, use an exact HTTPS hostname allowlist, pin public DNS results, reject redirects, and generate only explicitly allowlisted GET/JSON POST/PUT operations. Writes are schema-validated and staged server-side; execution requires a short-lived, one-use confirmation bound to the authenticated user, session, operation, and arguments. API credentials are supplied by a server callback; browser tokens and arbitrary client-provided specs/URLs are never used. Response fields must be allowlisted per operation.
