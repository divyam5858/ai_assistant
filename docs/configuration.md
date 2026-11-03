# Configuration Guide

The AI Assistant separates configuration into two distinct boundaries:

1. **Public Widget Configuration**: Identity, theme, position, greeting, suggested prompts, and UI flags visible to the browser.
2. **Private Server Configuration**: AI credentials, internal model parameters, rate limits, and origin policies that never leave the server.

---

## 1. Private Server Configuration (`.env`)

Defined in `backend/.env` on the server:

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the Express server. |
| `HOST` | `0.0.0.0` | Host binding. |
| `NODE_ENV` | `development` | `development` or `production`. |
| `AI_PROVIDER` | unset | Explicit provider: `gemini`, `groq`, `openai`, or `mock` (development/tests only). Without it, available provider credentials are selected; Gemini uses Groq as fallback when both are configured. The server fails closed if no provider is configured. |
| `GEMINI_API_KEY` | unset | Google Gemini API key. |
| `GEMINI_MODEL` | provider default | Gemini model. |
| `GROQ_API_KEY` | unset | Groq API key; used directly or as Gemini fallback when both credentials are configured. |
| `GROQ_MODEL` | provider default | Groq model. |
| `OPENAI_API_KEY` | unset | OpenAI API key. |
| `OPENAI_MODEL` | provider default | OpenAI model. |
| `AUTH_MODE` | `none` in development; JWT in production | `none`, `jwt`, `api-key`, or `hybrid`. Production cannot use `none`. |
| `AUTH_REQUIRED` | `false` in development; `true` in production | Require authentication on protected API routes. |
| `JWT_SECRET` | unset | Server-only HS256 secret required for JWT authentication. |
| `JWT_ISSUER` / `JWT_AUDIENCE` | unset | Optional required JWT issuer/audience claims. |

The public SDK API permits any browser origin through wildcard CORS. No per-site CORS environment variable is required. Wildcard CORS does not allow cross-origin cookies; use bearer authorization or the API-key header mode for cross-origin clients.
| `API_KEY` | unset | Server-only API key required for API-key or hybrid mode. |
| `ENABLE_HIREPOOL_INTEGRATION` | `false` | Explicitly registers the SDK's HirePool read actions on the backend. |
| `RATE_LIMIT_WINDOW_MS` | `60000` (1 min) | Rate limit sliding window duration in milliseconds. |
| `RATE_LIMIT_MAX_REQUESTS`| `60` | Maximum requests permitted per IP within the window. |
| `MAX_REQUEST_BODY_SIZE` | `1mb` | Maximum JSON request payload size. |
| `SESSION_TTL_MS` | `7200000` (2 hrs) | Sliding expiration for server-side conversation sessions. |
| `MAX_CONTEXT_MESSAGES` | `20` | Maximum messages preserved in active LLM context. |

Document uploads are limited to 10 MiB and require the current versioned consent notice. The browser assertion is not proof of a human's consent; hosts remain responsible for their privacy notices and retention policies. Sessions and extracted text are process-local and temporary in this implementation.

---

## 2. Public Assistant Personas

Defined in `config/assistant-presets.js`:

### `default`
- **Name**: `AI Assistant`
- **Purpose**: General-purpose helpful assistant for Q&A and text editing.
- **Theme**: `auto` | Primary: `#4f46e5` (Indigo)

### `researcher`
- **Name**: `Research & Synthesis AI`
- **Purpose**: Deep dives, document synthesis, and key takeaway extraction.
- **Theme**: `light` | Primary: `#0284c7` (Sky Blue)

### `support`
- **Name**: `Customer Support Guide`
- **Purpose**: Empathetic, step-by-step troubleshooting and onboarding.
- **Theme**: `auto` | Primary: `#059669` (Emerald Green)

### `coder`
- **Name**: `Code & Dev Companion`
- **Purpose**: Architecture review, code snippet generation, and debugging.
- **Theme**: `dark` | Primary: `#9333ea` (Purple)

---

## 3. Adding a Custom Persona

To register a new persona, add an entry to `config/assistant-presets.js`:

```javascript
export const ASSISTANT_PRESETS = {
  // Existing presets...
  analyst: {
    assistantId: 'analyst',
    name: 'Financial Data Analyst',
    description: 'Expert in financial reporting and metrics extraction',
    theme: 'light',
    primaryColor: '#0d9488',
    position: 'bottom-right',
    greeting: 'Hello. Paste financial statements or earnings calls for analysis.',
    suggestedPrompts: [
      'Extract revenue and gross margin metrics',
      'Identify key financial risks',
      'Summarize EBITDA guidance'
    ],
    systemInstruction: `You are a financial analyst. Focus strictly on numbers, audited figures, and risk disclaimers.`,
    features: {
      streaming: true,
      summarization: true,
      copyResponse: true,
      clearHistory: true,
      markdown: true,
      structuredOutput: true
    }
  }
};
```
