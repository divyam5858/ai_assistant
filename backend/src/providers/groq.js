import { BaseAIProvider } from './base.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Groq AI Provider adapter
 * Handles communication with Groq's high-speed inference engine using standard OpenAI-compatible endpoints.
 * Native fetch implementation requires zero third-party packages.
 */
export class GroqProvider extends BaseAIProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] Groq API Key (defaults to process.env.GROQ_API_KEY)
   * @param {string} [options.model] Default model (defaults to process.env.GROQ_MODEL or llama-3.3-70b-versatile)
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    super('groq');
    this.apiKey = options.apiKey || process.env.GROQ_API_KEY || '';
    this.model = options.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    this.timeoutMs = options.timeoutMs || 25000;
  }

  _sanitizeError(error) {
    if (!error) return new Error('Unknown error');
    const msg = error.message || String(error);
    const sanitized = this.apiKey ? msg.replaceAll(this.apiKey, '[REDACTED_KEY]') : msg;
    const sanitizedError = new Error(sanitized);
    sanitizedError.statusCode = error.statusCode || 500;
    return sanitizedError;
  }

  _formatMessages(messages, systemInstruction) {
    const formatted = [];
    if (systemInstruction) {
      formatted.push({ role: 'system', content: systemInstruction });
    }
    for (const m of messages) {
      formatted.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      });
    }
    return formatted;
  }

  async checkHealth() {
    if (!this.apiKey) {
      return {
        available: false,
        model: this.model,
        message: 'GROQ_API_KEY is not configured on the server.'
      };
    }

    try {
      const res = await fetch(`${GROQ_BASE_URL}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        return { available: true, model: this.model, message: 'Groq provider is healthy and responsive.' };
      }

      return {
        available: false,
        model: this.model,
        message: `Groq health probe returned status ${res.status}`
      };
    } catch (err) {
      return {
        available: false,
        model: this.model,
        message: err.message
      };
    }
  }

  async chat({ messages, systemInstruction, temperature = 0.7, maxTokens = 2048, signal }) {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY is missing. Configure GROQ_API_KEY in the server environment.');
    }

    const body = {
      model: this.model,
      messages: this._formatMessages(messages, systemInstruction),
      temperature,
      max_tokens: maxTokens,
      stream: false
    };

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    try {
      const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: combinedSignal
      });

      if (!response.ok) {
        const errText = await response.text();
        let parsedMessage = `Groq API returned status ${response.status}`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error?.message) parsedMessage = parsed.error.message;
        } catch {}
        const error = new Error(parsedMessage);
        error.statusCode = response.status;
        throw this._sanitizeError(error);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      const text = choice?.message?.content || '';
      const finishReason = choice?.finish_reason || 'stop';

      return {
        text,
        model: this.model,
        finishReason
      };
    } catch (err) {
      throw this._sanitizeError(err);
    }
  }

  async chatStream({ messages, systemInstruction, temperature = 0.7, maxTokens = 2048, onChunk, signal }) {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY is missing. Configure GROQ_API_KEY in the server environment.');
    }

    const body = {
      model: this.model,
      messages: this._formatMessages(messages, systemInstruction),
      temperature,
      max_tokens: maxTokens,
      stream: true
    };

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    try {
      const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: combinedSignal
      });

      if (!response.ok) {
        const errText = await response.text();
        let parsedMessage = `Groq API returned status ${response.status}`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error?.message) parsedMessage = parsed.error.message;
        } catch {}
        const error = new Error(parsedMessage);
        error.statusCode = response.status;
        throw this._sanitizeError(error);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';
      let buffer = '';

      try {
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
            if (jsonStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed?.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullText += delta;
                if (onChunk) onChunk(delta);
              }
            } catch {}
          }
        }
      } finally {
        reader.releaseLock();
      }

      return {
        text: fullText,
        model: this.model
      };
    } catch (err) {
      throw this._sanitizeError(err);
    }
  }

  async summarize({ text, style = 'concise', focus, stream = false, onChunk, signal }) {
    const styleInstruction = `Summarize the following text in ${style} style.${focus ? ` Focus on: ${focus}.` : ''}`;
    const messages = [{ role: 'user', content: `${styleInstruction}\n\n${text}` }];

    if (stream && onChunk) {
      return this.chatStream({
        messages,
        systemInstruction: 'You are an expert summarizer. Return only the summary.',
        temperature: 0.3,
        onChunk,
        signal
      });
    }

    return this.chat({
      messages,
      systemInstruction: 'You are an expert summarizer. Return only the summary.',
      temperature: 0.3,
      signal
    });
  }
}

