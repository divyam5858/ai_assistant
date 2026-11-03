# Document Q&A and Session Flow

## Upload-to-answer lifecycle

```text
Widget selects file
  → POST /api/documents/upload (multipart: file, optional conversationId, assistantId)
  → authenticate middleware (optional in development; configurable)
  → multer memory buffer (10 MiB maximum)
  → parse PDF / DOCX / supported text format
  → get or create conversation session
  → attach extracted text and metadata to in-memory session
  → response includes conversationId and document metadata
  → widget persists conversationId
  → next chat request includes conversationId
  → backend retrieves documents, escapes and bounds prompt context, then calls AI provider
```

If an upload starts without a conversation ID, the backend creates one and returns it. The widget associates that ID with its active conversation so later chat and document requests use the same session. The response includes metadata, not the extracted text.

## Supported files and limits

- PDF, DOCX, and text-based files (`.txt`, `.text`, `.md`, `.markdown`, `.csv`, `.json`, `.log`, or a `text/*` MIME type).
- `.doc` legacy binary Word files and scanned/image-only PDFs are not supported. No OCR is performed.
- Maximum file size: 10 MiB.
- Maximum extracted text: 100,000 characters per document.
- Maximum attached documents: five per session; adding another evicts the oldest.
- Maximum document text inserted into chat context: 50,000 escaped characters across all attached documents.
- Each document prompt frame includes escaped metadata and indicates truncation where applicable. Document contents are explicitly treated as untrusted data rather than instructions.

Parser failures include unsupported format, empty/no-readable-text, corrupt content, and size errors. Upload route errors are returned as structured JSON; document-list and session-clear errors are surfaced by the widget rather than silently treated as success.

## Session and browser behavior

Browser `sessionStorage` stores the conversation ID and rendered messages by assistant ID. It survives refresh in the same tab, and ordinarily ends with the tab session. If browser storage is blocked, storage falls back to memory and does not survive a refresh.

The server stores session messages, host context, documents, and ownership attributes in a process-local `Map`. The default session TTL is two hours; a cleanup sweep runs every five minutes. Chat context retains at most 20 messages. This is not durable: restart, cold start, a different serverless instance, or horizontal scaling can lose or fail to find the session. Browser persistence is only an identifier/cache and does not make server data durable.

Starting a new conversation calls `POST /api/sessions/clear`, which clears messages, documents, and context for the current ID. The widget then clears its saved conversation ID and displayed state. `DELETE /api/sessions/:conversationId` is available for complete server-side removal.

## Access isolation

Session records bind to authenticated user and tenant claims when present. A protected session cannot be accessed by an unauthenticated/different user or by a request missing the tenant identity. Unowned sessions can be bound when first accessed by an authenticated principal. Browser-supplied identity fields are not authoritative; the backend derives identity from verified credentials.

Configure authentication consistently on chat, upload, document retrieval/deletion, and session endpoints. For a production multi-tenant deployment, durable storage must enforce the same ownership checks atomically at the storage layer.

## Production persistence adapter requirements

Before deploying across processes/instances, replace or wrap the in-memory manager with storage that:

1. atomically reads/creates sessions and enforces owner/tenant equality;
2. stores messages/documents with encryption and explicit retention limits;
3. supports deletion of individual documents, clearing conversation data, and destroying sessions;
4. prevents cross-tenant access through every query key and index;
5. has an eviction/TTL strategy compatible with required retention and backup policies; and
6. does not make raw extracted document text available in logs, analytics, or untrusted caches.

The current repository does not include that durable adapter. See [Architecture Audit](./SDK_COMPLETE_ARCHITECTURE_AND_INTEGRATION_AUDIT.md).
