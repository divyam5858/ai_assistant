# Production Deployment Guide

This guide details best practices for deploying the backend API and distributing the embeddable JavaScript SDK.

---

## 1. Production Build

Before deploying, run the build process:

```bash
npm run build:widget
```

This generates the minified standalone bundle `widget/dist/assistant.min.js` (~35 KB), which is served automatically by the backend at `/sdk/assistant.js`.

---

## 2. Reverse Proxy Configuration (Nginx)

When deploying behind Nginx or an API gateway, ensure response buffering is disabled for Server-Sent Events (SSE):

```nginx
server {
    listen 443 ssl http2;
    server_name assistant.yourdomain.com;

    # SSL certificates...

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for SSE streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_set_header X-Accel-Buffering no;
    }

    # Static SDK caching
    location /sdk/ {
        proxy_pass http://localhost:3000;
        add_header Cache-Control "public, max-age=3600, stale-while-revalidate=86400";
        add_header Access-Control-Allow-Origin "*";
    }
}
```

---

## 3. Containerization (Docker)

Sample `Dockerfile` for containerized deployment:

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:widget

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/config ./config
COPY --from=builder /app/connectors ./connectors
COPY --from=builder /app/demo ./demo
COPY --from=builder /app/widget/dist ./widget/dist

EXPOSE 3000
CMD ["node", "backend/src/server.js"]
```

---

## 4. Monitoring & Health Probes

Configure container orchestrators (Kubernetes, AWS ECS, GCP Cloud Run) to poll the health probe:

- **Liveness Probe**: `GET /api/health` (HTTP 200)
- **Readiness Probe**: `GET /api/health` (verifies `provider.available === true`)
- **Interval**: 15 seconds
- **Timeout**: 5 seconds

---

## 5. Vercel Serverless Deployment

The assistant backend and embeddable SDK can be deployed as a unified project on Vercel using the configured `vercel.json` and `api/index.js` entry point.

### Prerequisites & Required Environment Variables
Configure the following in your Vercel Project Settings -> Environment Variables:
- `GEMINI_API_KEY`: Google Gemini API key.
- `GEMINI_MODEL`: (Optional, defaults to `gemini-flash-lite-latest`).
- `ALLOWED_ORIGINS`: Set to `*` or comma-separated allowed origins (e.g., `https://hirepool.ai,https://dev.hirepool.ai`).

### Deploy via Vercel CLI
```bash
# Login to Vercel
npx vercel login

# Deploy to preview
npx vercel

# Deploy to production
npx vercel --prod
```

### Endpoints on Deployed Vercel Project
- Standalone SDK: `https://<deployed-url>/sdk/assistant.js`
- Assistant Configuration: `https://<deployed-url>/api/config/default`
- Health Probe: `https://<deployed-url>/api/health`
- Streaming Chat: `https://<deployed-url>/api/chat/stream`
- Interactive Demo: `https://<deployed-url>/demo`


