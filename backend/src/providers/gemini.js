import { BaseAIProvider } from './base.js';
import { SERVER_DEFAULTS } from '../../../config/defaults.js';
import { randomUUID } from 'node:crypto';
import { decodeToolName } from '../actions/tool-converter.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Known working models on v1beta
const KNOWN_ACTIVE_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
const GEMINI_SCHEMA_TYPES = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  object: 'OBJECT',
  array: 'ARRAY'
};

function toGeminiSchema(schema) {
  const nullableTypes = Array.isArray(schema?.type) ? schema.type : [schema?.type];
  const type = nullableTypes.find(candidate => candidate !== 'null');
  const geminiType = GEMINI_SCHEMA_TYPES[type];
  if (!geminiType) throw new Error('Tool schema contains a type unsupported by Gemini');
  const output = { type: geminiType };
  if (schema.description) output.description = schema.description;
  if (nullableTypes.includes('null') || schema.nullable) output.nullable = true;
  if (Array.isArray(schema.enum)) output.enum = schema.enum;
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined) output[key] = schema[key];
  }
  if (type === 'object') {
    output.properties = Object.fromEntries(
      Object.entries(schema.properties || {}).map(([name, property]) => [name, toGeminiSchema(property)])
    );
    if (Array.isArray(schema.required) && schema.required.length) output.required = schema.required;
  } else if (type === 'array') {
    output.items = toGeminiSchema(schema.items);
  }
  return output;
}

function toGeminiTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const functionDeclarations = tools
    .filter(tool => tool?.type === 'function' && tool.function?.name)
    .map(tool => ({
      name: tool.function.name,
      description: tool.function.description || tool.function.name,
      parameters: toGeminiSchema(tool.function.parameters || { type: 'object', properties: {} })
    }));
  return functionDeclarations.length ? [{ functionDeclarations }] : undefined;
}

/**
 * Gemini AI Provider adapter
 * Handles communication with Google Gemini API, including SSE streaming,
 * retries, timeout management, error sanitization, and style-based summarization.
 */
export class GeminiProvider extends BaseAIProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] Gemini API Key (defaults to process.env.GEMINI_API_KEY)
   * @param {string} [options.model] Default model
   * @param {string} [options.fallbackModel] Fallback model if primary encounters 404 or 503
   * @param {number} [options.timeoutMs] Request timeout in milliseconds
   * @param {number} [options.maxRetries] Number of retry attempts on transient errors
   */
  constructor(options = {}) {
    super('gemini');
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';

    let configuredModel = options.model || process.env.GEMINI_MODEL || SERVER_DEFAULTS.GEMINI.DEFAULT_MODEL;
    // If deprecated model name was configured, automatically migrate to active model
    if (configuredModel === 'gemini-2.5-flash' || configuredModel === 'gemini-1.5-flash') {
      configuredModel = 'gemini-flash-lite-latest';
    }

    this.model = configuredModel;
    this.fallbackModel = options.fallbackModel || process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash';
    this.timeoutMs = options.timeoutMs || SERVER_DEFAULTS.GEMINI.TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? SERVER_DEFAULTS.GEMINI.MAX_RETRIES;
    this.fetch = options.fetch || globalThis.fetch;
  }

  /**
   * Remove any sensitive tokens/keys from error messages
   */
  _sanitizeError(error) {
    if (!error) return new Error('Unknown error');
    const msg = error.message || String(error);
    const sanitized = this.apiKey ? msg.replaceAll(this.apiKey, '[REDACTED_KEY]') : msg;
    const sanitizedError = new Error(sanitized);
    sanitizedError.statusCode = error.statusCode || 500;
    return sanitizedError;
  }

  /**
   * Format generic conversation history into Gemini format
   * User role -> 'user', assistant role -> 'model'
   */
  _formatContents(messages) {
    return messages.map(msg => {
      if (msg.role === 'tool') {
        let response = { result: msg.content };
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) response = parsed;
          else response = { result: parsed };
        } catch {}
        return {
          role: 'user',
          parts: [{
            functionResponse: {
              name: msg.name,
              response
            }
          }]
        };
      }

      if (msg.role === 'assistant' && msg.rawMessage?.role === 'model' && Array.isArray(msg.rawMessage.parts)) {
        return {
          role: 'model',
          parts: msg.rawMessage.parts
        };
      }

      const parts = [];
      if (typeof msg.content === 'string' && msg.content) {
        parts.push({ text: msg.content });
      }
      for (const toolCall of msg.tool_calls || msg.toolCalls || []) {
        const definition = toolCall.function || toolCall;
        if (typeof definition.name !== 'string') continue;
        let args = definition.arguments ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        parts.push({
          functionCall: {
            name: definition.name,
            args
          }
        });
      }
      if (!parts.length) parts.push({ text: '' });
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts
      };
    });
  }

  /**
   * Execute fetch with timeout, model fallback, and retry policy
   */
  async _requestWithRetry(endpoint, body, signal, isStream = false) {
    let currentModel = this.model;
    let attempts = 0;
    const fallbackCandidates = [this.fallbackModel, ...KNOWN_ACTIVE_MODELS];

    while (attempts <= this.maxRetries) {
      const url = `${GEMINI_BASE_URL}/models/${currentModel}:${endpoint}${isStream ? '?alt=sse&' : '?'}key=${this.apiKey}`;
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      try {
        const response = await this.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: combinedSignal
        });

        if (response.ok) {
          // If fallback succeeded, update current model
          this.model = currentModel;
          return { response, modelUsed: currentModel };
        }

        const status = response.status;
        const errText = await response.text();

        // If primary model failed with 404 or 503, try next fallback candidate
        if (status === 404 || status === 503) {
          const nextModel = fallbackCandidates.find(m => m !== currentModel);
          if (nextModel && attempts < this.maxRetries) {
            currentModel = nextModel;
            attempts++;
            continue;
          }
        }

        // Retry on 429 (rate limit) or 503 (server overloaded)
        if ((status === 429 || status === 503) && attempts < this.maxRetries) {
          attempts++;
          const delay = Math.min(1000 * Math.pow(2, attempts) + Math.random() * 500, 5000);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Safe error without exposing the key
        let parsedMessage = `Gemini API returned status ${status}`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error?.message) {
            parsedMessage = parsed.error.message;
          }
        } catch {
          // ignore json parse failure
        }

        const err = new Error(parsedMessage);
        err.statusCode = status;
        throw this._sanitizeError(err);
      } catch (err) {
        if (err.name === 'AbortError' || err.name === 'TimeoutError') {
          const timeoutErr = new Error(signal?.aborted ? 'Request was aborted by client' : `Request timed out after ${this.timeoutMs}ms`);
          timeoutErr.statusCode = signal?.aborted ? 499 : 504;
          throw timeoutErr;
        }

        if (attempts < this.maxRetries && !err.statusCode) {
          attempts++;
          await new Promise(r => setTimeout(r, 1000 * attempts));
          continue;
        }
        throw this._sanitizeError(err);
      }
    }
  }

  /**
   * Health check to verify API key validity and model access
   */
  async checkHealth() {
    if (!this.apiKey) {
      return {
        available: false,
        model: this.model,
        message: 'GEMINI_API_KEY is not configured on the server.'
      };
    }

    try {
      const url = `${GEMINI_BASE_URL}/models/${this.model}?key=${this.apiKey}`;
      const res = await this.fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        return { available: true, model: this.model, message: 'Gemini provider is healthy and responsive.' };
      }

      // Try fallback model
      const fallbackUrl = `${GEMINI_BASE_URL}/models/gemini-3.5-flash?key=${this.apiKey}`;
      const fallbackRes = await this.fetch(fallbackUrl, { signal: AbortSignal.timeout(5000) });
      if (fallbackRes.ok) {
        this.model = 'gemini-3.5-flash';
        return { available: true, model: this.model, message: 'Gemini provider is healthy (using gemini-3.5-flash).' };
      }

      return {
        available: false,
        model: this.model,
        message: `Gemini health probe returned status ${res.status}`
      };
    } catch (err) {
      return {
        available: false,
        model: this.model,
        message: err.message
      };
    }
  }

  /**
   * Non-streaming chat generation
   */
  async chat({ messages, systemInstruction, tools, temperature = 0.7, maxTokens = 2048, signal }) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is missing. Configure GEMINI_API_KEY in the server environment.');
    }

    const body = {
      contents: this._formatContents(messages),
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens
      }
    };
    const geminiTools = toGeminiTools(tools);
    if (geminiTools) {
      body.tools = geminiTools;
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const { response, modelUsed } = await this._requestWithRetry('generateContent', body, signal, false);
    const data = await response.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map(part => part.text || '').filter(Boolean).join('');
    const toolCalls = parts
      .filter(part => part.functionCall && typeof part.functionCall.name === 'string')
      .map(part => ({
        id: part.functionCall.id || randomUUID(),
        type: 'function',
        name: decodeToolName(part.functionCall.name),
        rawName: part.functionCall.name,
        arguments: part.functionCall.args || {}
      }));
    const finishReason = candidate?.finishReason || 'STOP';

    return {
      text,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      rawMessage: candidate?.content,
      model: modelUsed,
      finishReason
    };
  }

  /**
   * Streaming chat generation using Server-Sent Events
   */
  async chatStream({ messages, systemInstruction, tools, temperature = 0.7, maxTokens = 2048, onChunk, signal }) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is missing. Configure GEMINI_API_KEY in the server environment.');
    }

    const body = {
      contents: this._formatContents(messages),
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens
      }
    };
    const geminiTools = toGeminiTools(tools);
    if (geminiTools) {
      body.tools = geminiTools;
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const { response, modelUsed } = await this._requestWithRetry('streamGenerateContent', body, signal, true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';
    const toolCalls = new Map();
    const rawParts = [];
    const rawToolCallIndexes = new Map();
    let rawTextPart = null;
    let finishReason = 'STOP';

    const consumeCandidate = candidate => {
      for (const part of candidate?.content?.parts || []) {
        if (typeof part.text === 'string' && part.text) {
          fullText += part.text;
          if (!rawTextPart) {
            rawTextPart = { text: '' };
            rawParts.push(rawTextPart);
          }
          rawTextPart.text += part.text;
          if (onChunk) onChunk(part.text);
        }
        if (part.functionCall && typeof part.functionCall.name === 'string') {
          const call = part.functionCall;
          const key = call.id || call.name;
          const existingIndex = rawToolCallIndexes.get(key);
          if (existingIndex === undefined) {
            rawToolCallIndexes.set(key, rawParts.length);
            rawParts.push({ ...part });
          } else {
            const existingPart = rawParts[existingIndex];
            const existingCall = existingPart.functionCall || {};
            rawParts[existingIndex] = {
              ...existingPart,
              ...part,
              functionCall: {
                ...existingCall,
                ...call,
                ...(existingCall.args || call.args
                  ? { args: { ...existingCall.args, ...call.args } }
                  : {})
              }
            };
          }
          toolCalls.set(key, {
            id: call.id || randomUUID(),
            type: 'function',
            name: decodeToolName(call.name),
            rawName: call.name,
            arguments: call.args || {}
          });
        } else if (typeof part.text !== 'string') {
          rawParts.push({ ...part });
        }
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);
            consumeCandidate(parsed?.candidates?.[0]);
          } catch {
            // Partial JSON chunk line or keep going
          }
        }
      }

      // Check remaining buffer
      if (buffer.trim().startsWith('data: ')) {
        const jsonStr = buffer.trim().slice(6).trim();
        try {
          const parsed = JSON.parse(jsonStr);
          consumeCandidate(parsed?.candidates?.[0]);
        } catch {}
      }
    } finally {
      reader.releaseLock();
    }

    return {
      text: fullText,
      toolCalls: toolCalls.size ? [...toolCalls.values()] : undefined,
      rawMessage: toolCalls.size ? { role: 'model', parts: rawParts } : undefined,
      finishReason,
      model: modelUsed
    };
  }

  /**
   * Summarization capability
   */
  async summarize({ text, style = 'concise', focus, stream = false, onChunk, signal }) {
    const stylePrompts = {
      concise: 'Provide a concise, crisp summary of the following text in one single cohesive paragraph (under 120 words).',
      detailed: 'Provide a thorough, comprehensive summary of the following text, organized with clear headings and bullet points.',
      bullet_points: 'Extract the core points of the following text into clear, distinct, high-impact bullet points.',
      key_takeaways: 'Analyze the text and extract the top 3 to 5 critical takeaways with a brief explanation for each.',
      action_items: 'Identify and list all concrete action items, responsibilities, decisions, or follow-ups implied in this text. Use bullet points.',
      structured_json: `Analyze the text and return STRICT JSON ONLY (no markdown code blocks, no backticks, no preamble) with the following structure:
{
  "summary": "Brief overall summary",
  "keyPoints": ["point 1", "point 2", ...],
  "actionItems": ["action 1", "action 2", ...],
  "sentiment": "positive|neutral|negative|objective"
}`
    };

    const instruction = stylePrompts[style] || stylePrompts.concise;
    const focusDirective = focus ? `\nFocus specifically on aspects related to: ${focus}.` : '';

    const messages = [
      {
        role: 'user',
        content: `${instruction}${focusDirective}\n\n--- TEXT TO SUMMARIZE ---\n${text}`
      }
    ];

    const systemInstruction = style === 'structured_json'
      ? 'You are a precise data extraction and summarization engine. You output valid raw JSON only.'
      : 'You are an expert summarizer. Deliver clear, accurate, and insightful summaries without unnecessary filler.';

    if (stream && onChunk) {
      return this.chatStream({
        messages,
        systemInstruction,
        temperature: style === 'structured_json' ? 0.2 : 0.4,
        maxTokens: 2048,
        onChunk,
        signal
      });
    }

    return this.chat({
      messages,
      systemInstruction,
      temperature: style === 'structured_json' ? 0.2 : 0.4,
      maxTokens: 2048,
      signal
    });
  }
}
