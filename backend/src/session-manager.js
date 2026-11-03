import { randomUUID } from 'crypto';
import { SERVER_DEFAULTS } from '../../config/defaults.js';

/**
 * Error thrown when an unauthorized user attempts to access a session owned by another user.
 */
export class SessionOwnershipError extends Error {
  /**
   * @param {string} [message='Access denied: session belongs to another user']
   */
  constructor(message = 'Access denied: session belongs to another user') {
    super(message);
    this.name = 'SessionOwnershipError';
    this.statusCode = 403;
    this.code = 'SESSION_ACCESS_DENIED';
  }
}

/**
 * Error thrown when a cross-tenant session access attempt is detected.
 */
export class TenantMismatchError extends Error {
  /**
   * @param {string} [message='Access denied: session belongs to another tenant']
   */
  constructor(message = 'Access denied: session belongs to another tenant') {
    super(message);
    this.name = 'TenantMismatchError';
    this.statusCode = 403;
    this.code = 'TENANT_MISMATCH';
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('This conversation has expired. Start a new conversation and upload any documents again.');
    this.name = 'SessionExpiredError';
    this.statusCode = 410;
    this.code = 'SESSION_EXPIRED';
  }
}

export class SessionManager {
  /**
   * @param {object} [options]
   * @param {number} [options.ttlMs] Time-to-live in milliseconds
   * @param {number} [options.maxContextMessages] Max messages to keep in active context
   */
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || SERVER_DEFAULTS.SESSION.TTL_MS;
    this.maxContextMessages = options.maxContextMessages || SERVER_DEFAULTS.SESSION.MAX_MESSAGES_IN_CONTEXT;
    this.sessions = new Map();
    this.expiredSessions = new Map();

    // Periodic sweep every 5 minutes to release expired memory
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  _getActiveSession(id) {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (Date.now() - session.lastActiveAt > this.ttlMs) {
      this.sessions.delete(id);
      this.expiredSessions.set(id, Date.now() + this.ttlMs);
      return null;
    }
    return session;
  }

  _cleanupExpiredSessionMarkers(now = Date.now()) {
    for (const [id, expiresAt] of this.expiredSessions) {
      if (expiresAt <= now) this.expiredSessions.delete(id);
    }
  }

  /**
   * Validate session ownership and tenant isolation.
   * Throws 403 error if ownership or tenant does not match.
   *
   * @param {object} session
   * @param {object} [options]
   * @param {string|null} [options.userId] Authenticated user identity
   * @param {string|null} [options.tenantId] Authenticated tenant identity
   * @param {boolean} [options.enforceOwnership=true]
   */
  validateOwnership(session, options = {}) {
    if (!session) return;

    if (session.tenantId && options.tenantId && session.tenantId !== options.tenantId) {
      throw new TenantMismatchError();
    }

    if (options.enforceOwnership !== false && session.userId && session.userId !== (options.userId || null)) {
      throw new SessionOwnershipError();
    }

    if (session.tenantId && !options.tenantId) {
      throw new TenantMismatchError();
    }
  }

  /**
   * Get an existing session or initialize a new one with ownership and tenant attributes
   * @param {string} [conversationId]
   * @param {string} [assistantId='default']
   * @param {object} [options]
   * @param {string|null} [options.userId]
   * @param {string|null} [options.tenantId]
   * @returns {object} Session record
   */
  getOrCreate(conversationId, assistantId = 'default', options = {}) {
    // Support invocation where second parameter is options object
    let resolvedAssistantId = assistantId;
    let resolvedOptions = options;
    if (typeof assistantId === 'object' && assistantId !== null) {
      resolvedOptions = assistantId;
      resolvedAssistantId = resolvedOptions.assistantId || 'default';
    }

    const id = conversationId && typeof conversationId === 'string' && conversationId.trim()
      ? conversationId.trim()
      : randomUUID();

    const now = Date.now();
    this._cleanupExpiredSessionMarkers(now);
    let session = this._getActiveSession(id);

    if (!session && this.expiredSessions.has(id)) {
      throw new SessionExpiredError();
    }

    if (session) {
      this.validateOwnership(session, resolvedOptions);

      // Bind unowned session to newly authenticated user/tenant
      if (!session.userId && resolvedOptions.userId) {
        session.userId = resolvedOptions.userId;
      }
      if (!session.tenantId && resolvedOptions.tenantId) {
        session.tenantId = resolvedOptions.tenantId;
      }

      session.lastActiveAt = now;
      return session;
    }

    session = {
      id,
      assistantId: resolvedAssistantId,
      userId: resolvedOptions.userId || null,
      tenantId: resolvedOptions.tenantId || null,
      messages: [],
      documents: [],
      context: null,
      createdAt: now,
      lastActiveAt: now
    };

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Append a message to the conversation session
   * @param {string} conversationId
   * @param {string} role 'user' | 'assistant'
   * @param {string} content
   * @param {object} [options]
   */
  addMessage(conversationId, role, content, options = {}) {
    const session = this.getOrCreate(conversationId, 'default', options);
    session.messages.push({
      role,
      content,
      timestamp: Date.now()
    });
    session.lastActiveAt = Date.now();

    // Truncate to maximum context window
    if (session.messages.length > this.maxContextMessages) {
      // Retain the most recent messages
      session.messages = session.messages.slice(-this.maxContextMessages);
    }

    return session;
  }

  /**
   * Retrieve messages formatted for the AI provider
   * @param {string} conversationId
   * @param {object} [options]
   */
  getContextMessages(conversationId, options = {}) {
    const session = this._getActiveSession(conversationId);
    if (!session) return [];
    this.validateOwnership(session, options);
    return session.messages.map(m => ({
      role: m.role,
      content: m.content
    }));
  }

  /**
   * Set application context for a session
   * @param {string} conversationId
   * @param {string|null} context
   * @param {object} [options]
   */
  setContext(conversationId, context, options = {}) {
    const session = this.getOrCreate(conversationId, 'default', options);
    session.context = (typeof context === 'string' && context.trim().length > 0)
      ? context.trim()
      : null;
    session.lastActiveAt = Date.now();
    return session.context;
  }

  /**
   * Get active application context for a session
   * @param {string} conversationId
   * @param {object} [options]
   * @returns {string|null}
   */
  getContext(conversationId, options = {}) {
    const session = this._getActiveSession(conversationId);
    if (!session) return null;
    this.validateOwnership(session, options);
    return session?.context ?? null;
  }

  /**
   * Clear conversation history, documents, and context for a session while retaining the session ID
   * @param {string} conversationId
   * @param {object} [options]
   */
  clear(conversationId, options = {}) {
    const session = this._getActiveSession(conversationId);
    if (session) {
      this.validateOwnership(session, options);
      session.messages = [];
      session.documents = [];
      session.context = null;
      session.lastActiveAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Add a document to the conversation session
   * @param {string} conversationId
   * @param {object} docData
   * @param {object} [options]
   */
  addDocument(conversationId, docData, options = {}) {
    const session = this.getOrCreate(conversationId, 'default', options);
    if (!Array.isArray(session.documents)) {
      session.documents = [];
    }

    const docId = docData.id || randomUUID();
    const doc = {
      id: docId,
      filename: docData.filename || 'document',
      fileType: docData.format || docData.fileType || 'txt',
      fileSize: docData.fileSize || 0,
      text: docData.text || '',
      charCount: docData.charCount || (docData.text ? docData.text.length : 0),
      wordCount: docData.wordCount || (docData.text ? docData.text.split(/\s+/).filter(Boolean).length : 0),
      pageCount: docData.pageCount,
      consentVersion: docData.consentVersion || null,
      consentAcceptedAt: docData.consentAcceptedAt || null,
      uploadedAt: docData.uploadedAt || Date.now()
    };

    // Limit maximum documents per session (max 5)
    const MAX_DOCS_PER_SESSION = 5;
    if (session.documents.length >= MAX_DOCS_PER_SESSION) {
      session.documents.shift();
    }

    session.documents.push(doc);
    session.lastActiveAt = Date.now();
    return doc;
  }

  /**
   * Retrieve all documents attached to a session
   * @param {string} conversationId
   * @param {object} [options]
   * @returns {Array<object>}
   */
  getDocuments(conversationId, options = {}) {
    const session = this._getActiveSession(conversationId);
    if (!session) return [];
    this.validateOwnership(session, options);
    return Array.isArray(session.documents) ? [...session.documents] : [];
  }

  /**
   * Retrieve a specific document by ID
   * @param {string} conversationId
   * @param {string} documentId
   * @param {object} [options]
   * @returns {object|null}
   */
  getDocument(conversationId, documentId, options = {}) {
    const docs = this.getDocuments(conversationId, options);
    return docs.find(d => d.id === documentId) || null;
  }

  /**
   * Remove a specific document from a session
   * @param {string} conversationId
   * @param {string} documentId
   * @param {object} [options]
   * @returns {boolean}
   */
  removeDocument(conversationId, documentId, options = {}) {
    const session = this._getActiveSession(conversationId);
    if (!session) return false;
    this.validateOwnership(session, options);
    if (!Array.isArray(session.documents)) return false;
    const initialLen = session.documents.length;
    session.documents = session.documents.filter(d => d.id !== documentId);
    session.lastActiveAt = Date.now();
    return session.documents.length < initialLen;
  }

  /**
   * Clear all documents attached to a session
   * @param {string} conversationId
   * @param {object} [options]
   */
  clearDocuments(conversationId, options = {}) {
    const session = this._getActiveSession(conversationId);
    if (!session) return false;
    this.validateOwnership(session, options);
    session.documents = [];
    session.lastActiveAt = Date.now();
    return true;
  }

  /**
   * Completely remove a session from memory
   * @param {string} conversationId
   * @param {object} [options]
   */
  destroy(conversationId, options = {}) {
    const session = this._getActiveSession(conversationId);
    if (session) {
      this.validateOwnership(session, options);
      return this.sessions.delete(conversationId);
    }
    return false;
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpired() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt > this.ttlMs) {
        this.sessions.delete(id);
        this.expiredSessions.set(id, now + this.ttlMs);
      }
    }
    this._cleanupExpiredSessionMarkers(now);
  }

  /**
   * Return telemetry stats
   */
  getStats() {
    return {
      activeSessions: this.sessions.size,
      ttlMs: this.ttlMs,
      maxContextMessages: this.maxContextMessages
    };
  }

  /**
   * Teardown timer
   */
  close() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

export const sessionManager = new SessionManager();
