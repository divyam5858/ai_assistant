# Setup and Local Development Guide

This guide walks you through installing dependencies, configuring environment variables, running the independent backend server, launching the demo application, and executing the automated test suite.

---

## 1. Prerequisites

- **Node.js**: v18.0.0 or later (tested on Node v24 LTS).
- **npm**: v9.0.0 or later.
- **Google Gemini API Key**: Obtain a key from [Google AI Studio](https://aistudio.google.com/).

---

## 2. Installing Dependencies

Run the following command from the project root:

```bash
npm install
```

This installs runtime dependencies (`express`, `cors`, `helmet`, `express-rate-limit`, `zod`, `dotenv`) and build dependencies (`esbuild`, `supertest`).

---

## 3. Environment Variables Configuration

Copy the example environment template:

```bash
# Windows PowerShell
Copy-Item .env.example backend/.env

# Linux / macOS
cp .env.example backend/.env
```

Edit `backend/.env` with your settings:

```ini
# Server Port & Host
PORT=3000
HOST=localhost
NODE_ENV=development

# Allowed CORS Origins (comma-separated list, or * for open development)
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Google Gemini API Provider Configuration
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODEL=gemini-flash-latest

# Rate Limiting (per IP)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# Conversation Context & In-Memory Session Storage
SESSION_TTL_MS=7200000
MAX_CONTEXT_MESSAGES=20
```

> [!WARNING]
> Never commit `backend/.env` to source control. The `.gitignore` file is configured to exclude all `.env` files automatically.

---

## 4. Building the Widget SDK

Before running the server or demo, bundle the widget SDK into a single standalone distribution file:

```bash
npm run build:widget
```

This command runs `esbuild` to compile `widget/src/sdk.js` and inlines `widget/src/styles.css` into:
- `widget/dist/assistant.js` (standard bundle with source map, ~52 KB)
- `widget/dist/assistant.min.js` (production minified bundle, ~35 KB)

---

## 5. Starting the Backend Server

Start the backend with the environment file loaded:

```bash
npm start
```

For development mode (auto-rebuilding the widget before starting):

```bash
npm run dev
```

Upon startup, the console displays:

```text
=======================================================
 AI Assistant Backend & SDK Server running!
 Server URL:      http://localhost:3000
 Health Check:    http://localhost:3000/api/health
 Demo App:        http://localhost:3000/demo
 Embeddable SDK:  http://localhost:3000/sdk/assistant.js
 Environment:     development
 AI Provider:     gemini (model: gemini-3.5-flash) - READY
=======================================================
```

---

## 6. Accessing the Standalone Demo

Open your browser and navigate to:

```
http://localhost:3000/demo
```

The demo application showcases:
1. **The Floating Widget**: Test the launcher, panel opening, real Gemini chat responses, and markdown rendering.
2. **Programmatic Controls**: Test opening, closing, theme toggling (`light`, `dark`, `auto`), position shifting, and persona switching.
3. **Live Summarization Studio**: Run multi-style summarizations (concise, bullet points, key takeaways, action items, structured JSON) with live SSE streaming.
4. **Real-Time Event Stream**: Inspect runtime events emitted by `AssistantSDK`.

---

## 7. Running Automated Tests

Run the full automated test suite:

```bash
npm test
```

Or run tests with environment variables loaded to include the live Gemini verification suite:

```bash
node --env-file=backend/.env --test tests/**/*.test.js
```

### Test Suite Structure
- `tests/config.test.js`: Validates Zod request schemas and assistant configurations.
- `tests/session-manager.test.js`: Validates sliding context windows, TTL expiry, and conversation isolation.
- `tests/markdown.test.js`: Validates HTML escaping (XSS prevention) and Markdown conversion.
- `tests/connectors.test.js`: Validates public and protected connector authorization.
- `tests/security.test.js`: Verifies API key protection, prompt sanitization, and safe error masking.
- `tests/api-integration.test.js`: Integration tests for all REST/SSE endpoints using Express and Supertest.
- `tests/gemini-live.test.js`: End-to-end tests calling the live Gemini API.

