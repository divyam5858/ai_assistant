import { DOCUMENT_PROCESSING_CONSENT_VERSION } from '../../config/document-upload.js';

async function readSseEvents(response, onEvent) {
  if (!response.body?.getReader) {
    throw new Error('The server did not return a readable streaming response.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const dispatchFrame = async (frame) => {
    const data = frame.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;

    let event;
    try {
      event = JSON.parse(data);
    } catch (cause) {
      throw new Error('The server returned a malformed streaming event.', { cause });
    }
    await onEvent(event);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) {
        await dispatchFrame(frame);
      }
      if (done) break;
    }
    if (buffer.trim()) {
      await dispatchFrame(buffer);
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function createStreamError(event, fallbackMessage) {
  const error = new Error(event.error?.message || fallbackMessage);
  error.code = event.error?.code;
  error.status = event.error?.status;
  return error;
}

/**
 * Client for communicating with the AI Assistant Backend
 */
export class AssistantApiClient {
  /**
   * @param {string} baseUrl
   */
  constructor(baseUrl = '', options = {}) {
    // Strip trailing slash if present
    this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
    this.assistantId = options.assistantId || 'default';
    this.getAuthHeaders = options.getAuthHeaders;
    this.credentials = options.credentials || 'same-origin';
    this._demoToken = null;
    this._demoTokenExpiresAt = 0;
    this._tokenFetchPromise = null;
    this._authenticatedSession = null;
  }

  setAuthenticatedSession(session) {
    this._authenticatedSession = session && typeof session === 'object' ? session : null;
  }

  getAuthenticatedSession() {
    return this._authenticatedSession;
  }

  clearAuthenticatedSession() {
    this._authenticatedSession = null;
  }

  clearDemoToken() {
    this._demoToken = null;
    this._demoTokenExpiresAt = 0;
  }

  /**
   * Acquire a scoped demo token from the backend when running in standalone / demo mode
   * without a host integration auth provider.
   * @returns {Promise<string|null>}
   */
  async _getOrFetchDemoToken() {
    if (this.getAuthHeaders) return null;

    // Return cached token if still valid (with 60-second buffer)
    if (this._demoToken && Date.now() < this._demoTokenExpiresAt - 60000) {
      return this._demoToken;
    }

    if (this._tokenFetchPromise) {
      return this._tokenFetchPromise;
    }

    this._tokenFetchPromise = (async () => {
      try {
        const url = `${this.baseUrl}/api/auth/token`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assistantId: this.assistantId || 'default' }),
          credentials: this.credentials
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.token) {
            this._demoToken = data.token;
            this._demoTokenExpiresAt = Date.now() + ((data.expiresIn || 3600) * 1000);
            return this._demoToken;
          }
        }
      } catch {
        // Silently fall back to unauthenticated guest mode if endpoint is unavailable
      } finally {
        this._tokenFetchPromise = null;
      }
      return null;
    })();

    return this._tokenFetchPromise;
  }

  async _headers(json = false) {
    let headers = {};
    if (this._authenticatedSession?.credential) {
      headers = { Authorization: `Bearer ${this._authenticatedSession.credential}` };
    } else if (this.getAuthHeaders) {
      headers = (await this.getAuthHeaders()) || {};
      if (!headers.Authorization && this._authenticatedSession?.credential) {
        headers.Authorization = `Bearer ${this._authenticatedSession.credential}`;
      }
    } else {
      const token = await this._getOrFetchDemoToken();
      if (token) {
        headers = { Authorization: `Bearer ${token}` };
      }
    }
    return json ? { ...headers, 'Content-Type': 'application/json' } : headers;
  }

  async _hirePoolResumeRequest(path, { method, body, json = false } = {}) {
    const response = await fetch(`${this.baseUrl}/api/hirepool/resume/${path}`, {
      method,
      headers: await this._headers(json),
      body,
      credentials: this.credentials,
      cache: 'no-store'
    });
    let result = null;
    try {
      result = await response.json();
    } catch {
      // The caller validates the response envelope and reports a safe error.
    }
    if (!response.ok) {
      const error = new Error(
        typeof result?.error?.message === 'string'
          ? result.error.message
          : `Resume upload request failed (HTTP ${response.status}).`
      );
      error.status = response.status;
      error.responseStatus = result?.status;
      error.code = result?.error?.code;
      throw error;
    }
    return result;
  }

  async prepareHirePoolResume(file, conversationId) {
    const body = new FormData();
    body.append('file', file, file.name);
    if (typeof conversationId === 'string' && conversationId) {
      body.append('conversationId', conversationId);
    }
    return this._hirePoolResumeRequest('prepare', { method: 'POST', body });
  }

  async confirmHirePoolResume(confirmationToken, conversationId) {
    return this._hirePoolResumeRequest('confirm', {
      method: 'POST',
      body: JSON.stringify({ confirmationToken, conversationId }),
      json: true
    });
  }

  async cancelHirePoolResume(confirmationToken, conversationId) {
    return this._hirePoolResumeRequest('cancel', {
      method: 'POST',
      body: JSON.stringify({ confirmationToken, conversationId }),
      json: true
    });
  }

  /**
   * Fetch public assistant configuration
   */
  async fetchConfig(assistantId = 'default') {
    const url = `${this.baseUrl}/api/config/${encodeURIComponent(assistantId)}`;
    const res = await fetch(url, { credentials: this.credentials });
    if (!res.ok) {
      throw new Error(`Failed to load assistant configuration (HTTP ${res.status})`);
    }
    const data = await res.json();
    return data.assistant;
  }

  /**
   * Send a chat message (streaming or non-streaming)
   */
  async sendMessage({
    assistantId = 'default',
    message,
    context,
    conversationId,
    history = [],
    stream = true,
    signal,
    onStart,
    onChunk,
    onDone,
    onAction,
    onError
  }) {
    const endpoint = stream ? '/api/chat/stream' : '/api/chat';
    const url = `${this.baseUrl}${endpoint}`;

    const payload = {
      assistantId: assistantId || 'default',
      message,
      stream: !!stream
    };
    if (conversationId && typeof conversationId === 'string' && conversationId.trim().length > 0) {
      payload.conversationId = conversationId.trim();
    }
    if (Array.isArray(history) && history.length > 0) {
      payload.history = history;
    }
    if (typeof context === 'string' && context.trim().length > 0) {
      payload.context = context.trim();
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: await this._headers(true),
        body: JSON.stringify(payload),
        credentials: this.credentials,
        signal
      });

      if (!response.ok) {
        let errMsg = `Server returned HTTP ${response.status}`;
        let errCode = null;
        try {
          const errData = await response.json();
          if (errData?.error) {
            errCode = errData.error.code || null;
            if (Array.isArray(errData.error.details) && errData.error.details.length > 0) {
              const detailMsg = errData.error.details.map(d => `${d.field}: ${d.message}`).join(', ');
              errMsg = `${errData.error.message} (${detailMsg})`;
            } else if (errData.error.message) {
              errMsg = errData.error.message;
            }
          }
        } catch {}
        const error = new Error(errMsg);
        error.status = response.status;
        error.code = errCode;
        throw error;
      }

      // Non-streaming response
      if (!stream) {
        const data = await response.json();
        if (onDone) onDone(data);
        return data;
      }

      let accumulatedText = '';
      let activeConversationId = conversationId;
      let actionProposal = null;
      let doneEvent = null;

      await readSseEvents(response, (event) => {
        if (event.type === 'start') {
          activeConversationId = event.conversationId || activeConversationId;
          if (onStart) onStart(event);
        } else if (event.type === 'chunk') {
          accumulatedText += event.delta || '';
          if (onChunk) onChunk(event.delta || '', accumulatedText);
        } else if (event.type === 'action') {
          actionProposal = event.action;
          if (onAction) onAction(event.action);
        } else if (event.type === 'done') {
          if (doneEvent) throw new Error('The streaming response contained duplicate completion events.');
          doneEvent = event;
          const result = {
            text: event.text || accumulatedText,
            action: event.action || actionProposal,
            conversationId: event.logout?.loggedOut ? null : (event.conversationId || activeConversationId),
            model: event.model,
            logout: event.logout || null,
            connectorResult: event.connectorResult || null
          };
          if (onDone) onDone(result);
        } else if (event.type === 'error') {
          throw createStreamError(event, 'Streaming request failed.');
        }
      });

      if (!doneEvent) {
        throw new Error('The streaming response ended before the assistant completed the request.');
      }

      return {
        text: doneEvent.text || accumulatedText,
        action: doneEvent.action || actionProposal,
        conversationId: doneEvent.logout?.loggedOut ? null : (doneEvent.conversationId || activeConversationId),
        model: doneEvent.model,
        logout: doneEvent.logout || null,
        connectorResult: doneEvent.connectorResult || null
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        // Handled cleanly as cancellation
        return;
      }
      if (onError) onError(err);
      throw err;
    }
  }

  /**
   * Summarize text
   */
  async summarize({ text, style = 'concise', focus, stream = false, signal, onChunk, onDone, onError }) {
    const url = `${this.baseUrl}/api/summarize`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: await this._headers(true),
        body: JSON.stringify({ text, style, focus, stream }),
        credentials: this.credentials,
        signal
      });

      if (!response.ok) {
        let errMsg = `Summarization failed (HTTP ${response.status})`;
        try {
          const data = await response.json();
          if (data?.error?.message) errMsg = data.error.message;
        } catch {}
        throw new Error(errMsg);
      }

      if (!stream) {
        const data = await response.json();
        if (onDone) onDone(data);
        return data;
      }

      let accumulated = '';
      let doneEvent = null;

      await readSseEvents(response, (event) => {
        if (event.type === 'chunk') {
          accumulated += event.delta || '';
          if (onChunk) onChunk(event.delta || '', accumulated);
        } else if (event.type === 'done') {
          if (doneEvent) throw new Error('The summarization stream contained duplicate completion events.');
          doneEvent = event;
          if (onDone) onDone({ text: event.text || accumulated, model: event.model });
        } else if (event.type === 'error') {
          throw createStreamError(event, 'Streaming summarization failed.');
        }
      });

      if (!doneEvent) {
        throw new Error('The summarization stream ended before completion.');
      }

      return { text: doneEvent.text || accumulated, model: doneEvent.model };
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (onError) onError(err);
      throw err;
    }
  }

  /**
   * Upload a document to the backend and attach it to the conversation session
   * @param {File|Blob} file
   * @param {string} [conversationId]
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async uploadDocument(file, conversationId, options = {}) {
    if (options.consentAccepted !== true) {
      throw new Error('Explicit document-processing consent is required before upload.');
    }
    const url = `${this.baseUrl}/api/documents/upload`;
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('consentAccepted', 'true');
    formData.append('consentVersion', DOCUMENT_PROCESSING_CONSENT_VERSION);
    if (conversationId) {
      formData.append('conversationId', conversationId);
    }
    if (options.assistantId) {
      formData.append('assistantId', options.assistantId);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...await this._headers(),
        'X-Document-Processing-Consent': 'accepted',
        'X-Document-Consent-Version': DOCUMENT_PROCESSING_CONSENT_VERSION
      },
      body: formData,
      credentials: this.credentials,
      signal: options.signal
    });

    if (!res.ok) {
      let errMsg = `Upload failed (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data?.error?.message) {
          errMsg = data.error.message;
        }
      } catch {}
      const error = new Error(errMsg);
      error.status = res.status;
      throw error;
    }

    return await res.json();
  }

  /**
   * Fetch list of documents attached to a session
   * @param {string} conversationId
   */
  async getDocuments(conversationId) {
    if (!conversationId) return [];
    const url = `${this.baseUrl}/api/documents/${encodeURIComponent(conversationId)}?assistantId=${encodeURIComponent(this.assistantId)}`;
    const res = await fetch(url, {
      headers: await this._headers(),
      credentials: this.credentials
    });
    if (!res.ok) {
      let message = `Failed to retrieve documents (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data?.error?.message) message = data.error.message;
      } catch {}
      throw new Error(message);
    }
    const data = await res.json();
    return data.documents || [];
  }

  async removeDocument(conversationId, documentId) {
    if (!conversationId || !documentId) return;
    const res = await fetch(
      `${this.baseUrl}/api/documents/${encodeURIComponent(conversationId)}/${encodeURIComponent(documentId)}?assistantId=${encodeURIComponent(this.assistantId)}`,
      {
        method: 'DELETE',
        headers: await this._headers(),
        credentials: this.credentials
      }
    );
    if (!res.ok) {
      let message = `Failed to remove document (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data?.error?.message) message = data.error.message;
      } catch {}
      throw new Error(message);
    }
  }

  /**
   * Clear session on the server
   */
  async clearSession(conversationId) {
    if (!conversationId) return;
    const res = await fetch(`${this.baseUrl}/api/sessions/clear`, {
      method: 'POST',
      headers: await this._headers(true),
      body: JSON.stringify({ conversationId, assistantId: this.assistantId }),
      credentials: this.credentials
    });
    if (!res.ok) {
      let message = `Failed to clear conversation (HTTP ${res.status})`;
      try {
        const data = await res.json();
        if (data?.error?.message) message = data.error.message;
      } catch {}
      throw new Error(message);
    }
  }

  async _hirePoolSignupRequest(path, { method = 'POST', body, json = true } = {}) {
    const isGet = method === 'GET';
    const headers = json ? { 'Content-Type': 'application/json' } : {};
    const response = await fetch(`${this.baseUrl}/api/hirepool/signup/${path}`, {
      method,
      headers,
      body: isGet ? undefined : (json && body ? JSON.stringify(body) : body),
      credentials: this.credentials,
      cache: 'no-store'
    });
    let result = null;
    try {
      result = await response.json();
    } catch {}
    if (!response.ok) {
      const error = new Error(
        typeof result?.error?.message === 'string'
          ? result.error.message
          : `Signup request failed (HTTP ${response.status}).`
      );
      error.status = response.status;
      error.code = result?.error?.code;
      error.details = result?.error;
      throw error;
    }
    return result;
  }

  async getSignupAgreement(role) {
    return this._hirePoolSignupRequest(`agreement?role=${encodeURIComponent(role)}`, {
      method: 'GET',
      json: false
    });
  }

  async signupRegister(data) {
    return this._hirePoolSignupRequest('register', { body: data });
  }

  async resendSignupVerification(data) {
    return this._hirePoolSignupRequest('resend-verification', { body: data });
  }

  async verifySignupEmail(data) {
    return this._hirePoolSignupRequest('verify-email', { body: data });
  }

  async checkSignupVerificationStatus(signupToken) {
    return this._hirePoolSignupRequest('check-verification', { body: { signupToken } });
  }

  async updateSignupProfile(data) {
    return this._hirePoolSignupRequest('profile-update', { body: data });
  }

  async completeSignupProfile(data) {
    return this._hirePoolSignupRequest('complete-profile', { body: data });
  }

  async cancelSignup(signupToken) {
    return this._hirePoolSignupRequest('cancel', { body: { signupToken } });
  }

  async validateHirePoolSession(credential = null) {
    const cred = credential || this._authenticatedSession?.credential;
    if (!cred) throw new Error('No session credential to validate');
    let response = await fetch(`${this.baseUrl}/api/hirepool/session/validate`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cred}`,
        Accept: 'application/json'
      },
      credentials: this.credentials,
      cache: 'no-store'
    });
    if (response.status === 404) {
      try {
        const altResponse = await fetch(`${this.baseUrl}/api/hirepool/signup/validate`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cred}`,
            Accept: 'application/json'
          },
          credentials: this.credentials,
          cache: 'no-store'
        });
        if (altResponse.ok || altResponse.status !== 404) {
          response = altResponse;
        }
      } catch {}
    }
    let result = null;
    try {
      result = await response.json();
    } catch {}
    if (!response.ok) {
      const error = new Error(result?.error?.message || `Session validation failed (HTTP ${response.status})`);
      error.status = response.status;
      error.code = result?.error?.code;
      throw error;
    }
    return result;
  }

  async confirmDynamicApiAction(confirmationToken) {
    const response = await fetch(`${this.baseUrl}/api/dynamic-api/confirm`, {
      method: 'POST',
      headers: await this._headers(true),
      body: JSON.stringify({ confirmationToken }),
      credentials: this.credentials,
      cache: 'no-store'
    });
    let result = null;
    try {
      result = await response.json();
    } catch {}
    if (!response.ok) {
      const error = new Error(result?.error?.message || `Dynamic API action failed (HTTP ${response.status})`);
      error.status = response.status;
      error.code = result?.error?.code;
      throw error;
    }
    return result;
  }

  async cancelDynamicApiAction(confirmationToken) {
    const response = await fetch(`${this.baseUrl}/api/dynamic-api/confirm/cancel`, {
      method: 'POST',
      headers: await this._headers(true),
      body: JSON.stringify({ confirmationToken }),
      credentials: this.credentials,
      cache: 'no-store'
    });
    let result = null;
    try {
      result = await response.json();
    } catch {}
    if (!response.ok) {
      const error = new Error(result?.error?.message || `Dynamic API cancellation failed (HTTP ${response.status})`);
      error.status = response.status;
      error.code = result?.error?.code;
      throw error;
    }
    return result;
  }

  async logoutHirePoolSession(conversationId = null) {
    const body = {};
    if (typeof conversationId === 'string' && conversationId.trim()) {
      body.conversationId = conversationId.trim();
    }
    try {
      const response = await fetch(`${this.baseUrl}/api/hirepool/session/logout`, {
        method: 'POST',
        headers: await this._headers(true),
        body: JSON.stringify(body),
        credentials: this.credentials,
        cache: 'no-store'
      });
      let result = null;
      try {
        result = await response.json();
      } catch {}
      if (!response.ok) {
        const error = new Error(result?.error?.message || `Logout failed (HTTP ${response.status})`);
        error.status = response.status;
        error.code = result?.error?.code;
        throw error;
      }
      return result;
    } finally {
      this.clearAuthenticatedSession();
      this.clearDemoToken();
    }
  }
}
