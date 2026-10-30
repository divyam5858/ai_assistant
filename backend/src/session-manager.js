import { randomUUID } from 'crypto';
import { SERVER_DEFAULTS } from '../../config/defaults.js';

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

    // Periodic sweep every 5 minutes to release expired memory
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Get an existing session or initialize a new one
   */
  getOrCreate(conversationId, assistantId = 'default') {
    const id = conversationId && typeof conversationId === 'string' && conversationId.trim()
      ? conversationId.trim()
      : randomUUID();

    const now = Date.now();
    let session = this.sessions.get(id);

    if (session) {
      // Check expiration
      if (now - session.lastActiveAt > this.ttlMs) {
        this.sessions.delete(id);
        session = null;
      } else {
        session.lastActiveAt = now;
        return session;
      }
    }

    session = {
      id,
      assistantId,
      messages: [],
      context: null,
      createdAt: now,
      lastActiveAt: now
    };

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Append a message to the conversation session
   */
  addMessage(conversationId, role, content) {
    const session = this.getOrCreate(conversationId);
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
   */
  getContextMessages(conversationId) {
    const session = this.sessions.get(conversationId);
    if (!session) return [];
    return session.messages.map(m => ({
      role: m.role,
      content: m.content
    }));
  }

  /**
   * Set application context for a session
   * @param {string} conversationId
   * @param {string|null} context
   */
  setContext(conversationId, context) {
    const session = this.getOrCreate(conversationId);
    session.context = (typeof context === 'string' && context.trim().length > 0)
      ? context.trim()
      : null;
    session.lastActiveAt = Date.now();
    return session.context;
  }

  /**
   * Get active application context for a session
   * @param {string} conversationId
   * @returns {string|null}
   */
  getContext(conversationId) {
    const session = this.sessions.get(conversationId);
    return session?.context ?? null;
  }

  /**
   * Clear conversation history and context for a session while retaining the session ID
   */
  clear(conversationId) {
    const session = this.sessions.get(conversationId);
    if (session) {
      session.messages = [];
      session.context = null;
      session.lastActiveAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Completely remove a session from memory
   */
  destroy(conversationId) {
    return this.sessions.delete(conversationId);
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpired() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
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
