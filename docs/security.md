# Security and Privacy Architecture

The AI Assistant Plugin implements defense-in-depth principles across the browser widget, backend server, and external AI provider connections.

---

## 1. Zero-Exposure Secret Management

- **No Frontend Keys**: The client-side SDK never possesses, requests, or stores the Google Gemini API key.
- **Environment Isolation**: Credentials reside exclusively in `backend/.env`, which is strictly excluded from version control via `.gitignore`.
- **Automatic Error Redaction**: If the upstream provider returns an error string containing an API key or internal identifier, `GeminiProvider._sanitizeError()` scrubs the sensitive substring before the error propagates.
- **Masked Config Endpoints**: The public configuration endpoint `/api/config/:assistantId` filters out internal server properties (such as system instructions and credentials).

---

## 2. Origin Validation & Cross-Origin Resource Sharing (CORS)

- In development, `ALLOWED_ORIGINS` defaults to `*` or local development ports (`http://localhost:3000`).
- In production, specify an explicit comma-separated list of allowed domains:
  ```ini
  ALLOWED_ORIGINS=https://app.company.com,https://dashboard.company.com
  ```
- Unauthorized origins receive an immediate `403 Forbidden` response.
- Note: CORS is not authorization. Public endpoints remain protected by rate limiting and input size controls.

---

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

