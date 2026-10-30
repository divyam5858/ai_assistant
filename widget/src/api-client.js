/**
 * Client for communicating with the AI Assistant Backend
 */
export class AssistantApiClient {
  /**
   * @param {string} baseUrl
   */
  constructor(baseUrl = '') {
    // Strip trailing slash if present
    this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  }

  /**
   * Fetch public assistant configuration
   */
  async fetchConfig(assistantId = 'default') {
    const url = `${this.baseUrl}/api/config/${encodeURIComponent(assistantId)}`;
    const res = await fetch(url);
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal
      });

      if (!response.ok) {
        let errMsg = `Server returned HTTP ${response.status}`;
        try {
          const errData = await response.json();
          if (errData?.error) {
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
        throw error;
      }

      // Non-streaming response
      if (!stream) {
        const data = await response.json();
        if (onDone) onDone(data);
        return data;
      }

      // SSE Streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';
      let activeConversationId = conversationId;
      let actionProposal = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6).trim();

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'start') {
              activeConversationId = event.conversationId || activeConversationId;
              if (onStart) onStart(event);
            } else if (event.type === 'chunk') {
              accumulatedText += event.delta;
              if (onChunk) onChunk(event.delta, accumulatedText);
            } else if (event.type === 'action') {
              actionProposal = event.action;
              if (onAction) onAction(event.action);
            } else if (event.type === 'done') {
              if (onDone) onDone({
                text: event.text || accumulatedText,
                action: event.action || actionProposal,
                conversationId: event.conversationId || activeConversationId,
                model: event.model
              });
            } else if (event.type === 'error') {
              throw new Error(event.error?.message || 'Streaming error occurred');
            }
          } catch (err) {
            if (err.message && err.message.includes('Streaming error occurred')) {
              throw err;
            }
          }
        }
      }

      return {
        text: accumulatedText,
        conversationId: activeConversationId
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, style, focus, stream }),
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

      // Stream SSE
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6).trim();

          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'chunk') {
              accumulated += event.delta;
              if (onChunk) onChunk(event.delta, accumulated);
            } else if (event.type === 'done') {
              if (onDone) onDone({ text: accumulated, model: event.model });
            } else if (event.type === 'error') {
              throw new Error(event.error?.message || 'Stream error in summarization');
            }
          } catch (err) {
            if (err.message && err.message.includes('Stream error')) throw err;
          }
        }
      }

      return { text: accumulated };
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (onError) onError(err);
      throw err;
    }
  }

  /**
   * Clear session on the server
   */
  async clearSession(conversationId) {
    if (!conversationId) return;
    try {
      await fetch(`${this.baseUrl}/api/sessions/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId })
      });
    } catch (err) {
      console.warn('Failed to clear session on backend:', err);
    }
  }
}
