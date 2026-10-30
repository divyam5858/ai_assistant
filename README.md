# Standalone AI Assistant Plugin & SDK

> A production-oriented, reusable, conversational AI assistant plugin that runs independently and embeds into any web application through a single JavaScript `<script>` tag.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![AI Provider](https://img.shields.io/badge/provider-Google%20Gemini-orange.svg)
![Tests](https://img.shields.io/badge/tests-43%20passed-success.svg)

---

## Features

- **Framework-Independent Embeddable SDK**: Integrates into HTML, React, Vue, Angular, Shopify, Webflow, or WordPress with a single script tag.
- **Shadow DOM Style Isolation**: Encapsulated within an open Shadow Root to prevent host CSS contamination and prevent widget styles from bleeding out.
- **Real AI Provider Integration**: Powered by Google Gemini with Server-Sent Events (SSE) streaming for fast, token-by-token rendering.
- **Multi-Turn Chat & Context Retention**: Intelligent sliding conversation context with automatic cleanup and privacy-conscious persistence.
- **Advanced Text Summarization**: Summarize articles, reports, and code into concise paragraphs, bullet points, key takeaways, action items, or structured JSON.
- **Configurable Personas & Themes**: Built-in personas (`default`, `researcher`, `support`, `coder`) with customizable light, dark, and auto themes.
- **Full Accessibility**: ARIA roles, semantic landmarks, tab order, focus restoration, and keyboard shortcuts (Enter to send, Shift+Enter for newline, Esc to close).
- **Extensible Connector Architecture**: Documented connector contract for querying external enterprise data and CRM records with server-side authorization.

---

## Project Structure

```
d:\ai-assistant-plugin\
├── backend/                  # Independent Node.js / Express backend server
│   ├── src/
│   │   ├── middleware/       # Security (Helmet, CORS, Rate Limit), logging, error handling
│   │   ├── providers/        # Base AI provider interface, Gemini adapter, Mock provider
│   │   ├── routes/           # Health, public config, chat, streaming, summarization, connectors
│   │   ├── app.js            # Express application setup
│   │   ├── server.js         # Server entry point and port listener
│   │   └── session-manager.js# Sliding context window and session lifecycle
│   └── .env.example          # Server environment variable template
├── config/                   # Schemas, assistant presets, and default configuration
│   ├── assistant-presets.js  # Pre-configured personas (default, researcher, support, coder)
│   ├── defaults.js           # Default timeouts, model settings, and rate limits
│   └── schemas.js            # Zod validation schemas for all requests and configurations
├── connectors/               # External application connector contracts
│   ├── base.js               # BaseConnector interface
│   ├── mock-connector.js     # Mock knowledge base & customer CRM connector
│   └── registry.js           # Connector registry
├── demo/                     # Standalone demonstration application
│   ├── index.html            # Interactive developer showcase & test portal
│   ├── demo.css              # Showcase styles
│   └── demo.js               # Programmatic SDK controls and summarization playground
├── docs/                     # Comprehensive documentation
│   ├── architecture.md       # Architecture diagram, Shadow DOM evaluation, data flow
│   ├── setup.md              # Installation and development setup guide
│   ├── api-reference.md      # Complete REST and SSE endpoints documentation
│   ├── sdk-guide.md          # JavaScript SDK integration guide and framework examples
│   ├── configuration.md      # Configuration guide and persona customization
│   ├── security.md           # Security, secret management, prompt injection defenses
│   └── deployment.md         # Production deployment, Nginx proxy, Dockerfile
├── tests/                    # Automated test suites (43 tests, 100% pass)
│   ├── config.test.js        # Schema validation unit tests
│   ├── session-manager.test.js # Session lifecycle and context window tests
│   ├── markdown.test.js      # XSS escaping and markdown parsing unit tests
│   ├── connectors.test.js    # Connector authorization and action tests
│   ├── security.test.js      # Secret leakage and prompt sanitization tests
│   ├── api-integration.test.js # REST and SSE route integration tests
│   └── gemini-live.test.js   # Live Gemini API end-to-end verification tests
├── widget/                   # Floating chat widget and embeddable SDK
│   ├── src/
│   │   ├── api-client.js     # Client-side HTTP / SSE reader
│   │   ├── markdown.js       # Safe HTML-escaped markdown parser
│   │   ├── sdk.js            # Global AssistantSDK entry point & event emitter
│   │   ├── storage.js        # Session storage persistence manager
│   │   ├── styles.css        # Encapsulated Shadow DOM styling
│   │   └── widget.js         # Chat UI dialog, launcher, and event handling
│   └── build.js              # esbuild bundler script
├── .env.example              # Root environment template
├── .gitignore                # Git ignore configuration
└── package.json              # Project scripts and dependencies
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `backend/.env` and add your Google Gemini API key:
```bash
Copy-Item .env.example backend/.env
```

```ini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash
PORT=3000
```

### 3. Build Widget SDK
```bash
npm run build:widget
```

### 4. Start Server & Demo
```bash
npm start
```

Visit:
- **Interactive Demo**: [http://localhost:3000/demo](http://localhost:3000/demo)
- **Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)
- **Compiled SDK Script**: [http://localhost:3000/sdk/assistant.js](http://localhost:3000/sdk/assistant.js)

---

## Embedding the Widget

### Option A: Zero-Code Script Tag
```html
<script
  src="http://localhost:3000/sdk/assistant.js"
  data-assistant-id="default"
  data-theme="auto"
  data-position="bottom-right"
  defer
></script>
```

### Option B: Programmatic JavaScript API
```javascript
// Initialize assistant
await window.AssistantSDK.init({
  assistantId: 'researcher',
  theme: 'dark',
  primaryColor: '#0284c7'
});

// Control panel
AssistantSDK.open();
AssistantSDK.sendMessage('Please summarize key points from this meeting.');
```

---

## Running Automated Tests

Run the full automated test suite:
```bash
node --env-file=backend/.env --test tests/**/*.test.js
```

All 43 tests pass, covering:
- Zod schema validation
- In-memory context windows & TTL expiration
- XSS prevention & Markdown parsing
- Connector authorization enforcement
- Secret protection & origin validation
- REST endpoints and SSE streaming
- Live Gemini API chat, streaming, and summarization

---

## Documentation Links

- [Architecture & Shadow DOM Evaluation](docs/architecture.md)
- [Setup & Local Development](docs/setup.md)
- [Backend API Reference](docs/api-reference.md)
- [JavaScript SDK Guide](docs/sdk-guide.md)
- [Configuration & Personas](docs/configuration.md)
- [Security & Privacy](docs/security.md)
- [Production Deployment](docs/deployment.md)

