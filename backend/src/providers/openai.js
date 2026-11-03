import OpenAI from 'openai';
import { BaseAIProvider } from './base.js';
import { decodeToolName } from '../actions/tool-converter.js';

/**
 * OpenAI Provider Adapter
 * Communicates with OpenAI using official JavaScript SDK and supports native tool calling.
 */
export class OpenAIProvider extends BaseAIProvider {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey] OpenAI API key (defaults to process.env.OPENAI_API_KEY)
   * @param {string} [options.model] Default model (defaults to process.env.OPENAI_MODEL or 'gpt-4o-mini')
   * @param {number} [options.timeoutMs] Request timeout in milliseconds (default: 30000)
   * @param {OpenAI} [options.client] Optional pre-configured OpenAI SDK client instance (for testing/mocking)
   */
  constructor(options = {}) {
    super('openai');
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.timeoutMs = options.timeoutMs || 30000;

    // Use injected client or instantiate official OpenAI client if key is present
    if (options.client) {
      this.client = options.client;
    } else if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        timeout: this.timeoutMs
      });
    } else {
      this.client = null;
    }
  }

  /**
   * Sanitize error messages to ensure API keys are never exposed in logs or response bodies.
   * @param {Error|any} error
   * @returns {Error}
   */
  _sanitizeError(error) {
    if (!error) return new Error('Unknown error');
    const rawMsg = error.message || String(error);
    const sanitizedMsg = this.apiKey ? rawMsg.replaceAll(this.apiKey, '[REDACTED_KEY]') : rawMsg;
    const sanitized = new Error(sanitizedMsg);
    sanitized.statusCode = error.status || error.statusCode || 500;
    return sanitized;
  }

  /**
   * Format internal messages and system instruction for OpenAI Chat Completions API.
   * Supports user, assistant, system, and tool execution messages.
   *
   * @param {Array<object>} messages
   * @param {string} [systemInstruction]
   * @returns {Array<object>} OpenAI formatted messages
   */
  _formatMessages(messages = [], systemInstruction = '') {
    const formatted = [];

    if (systemInstruction) {
      formatted.push({
        role: 'system',
        content: systemInstruction
      });
    }

    for (const m of messages) {
      if (m.role === 'tool') {
        formatted.push({
          role: 'tool',
          tool_call_id: m.tool_call_id || m.toolCallId,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        });
      } else if (m.role === 'assistant') {
        const msg = {
          role: 'assistant',
          content: m.content || null
        };
        if (m.tool_calls || m.toolCalls) {
          msg.tool_calls = m.tool_calls || m.toolCalls;
        }
        formatted.push(msg);
      } else {
        formatted.push({
          role: 'user',
          content: typeof m.content === 'string' ? m.content : String(m.content)
        });
      }
    }

    return formatted;
  }

  /**
   * Parse tool arguments safely. Handles stringified JSON and detects malformed inputs.
   * @param {string|object} rawArgs
   * @returns {{ parsed: object, error: boolean }}
   */
  _parseToolArguments(rawArgs) {
    if (typeof rawArgs === 'object' && rawArgs !== null) {
      return { parsed: rawArgs, error: false };
    }
    if (!rawArgs || typeof rawArgs !== 'string') {
      return { parsed: {}, error: false };
    }
    try {
      return { parsed: JSON.parse(rawArgs), error: false };
    } catch {
      return { parsed: {}, error: true };
    }
  }

  /**
   * Health check / validation of OpenAI API connectivity
   */
  async checkHealth() {
    if (!this.apiKey) {
      return {
        available: false,
        model: this.model,
        message: 'OPENAI_API_KEY is not configured on the server.'
      };
    }

    try {
      if (this.client?.models?.list) {
        await this.client.models.list({ timeout: 5000 });
      }
      return {
        available: true,
        model: this.model,
        message: 'OpenAI provider is healthy and responsive.'
      };
    } catch (err) {
      return {
        available: false,
        model: this.model,
        message: this._sanitizeError(err).message
      };
    }
  }

  /**
   * Non-streaming chat generation with optional native tool calling.
   *
   * @param {object} options
   * @param {Array<object>} options.messages
   * @param {string} [options.systemInstruction]
   * @param {Array<object>} [options.tools] Native tools in OpenAI format
   * @param {number} [options.temperature]
   * @param {number} [options.maxTokens]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ text: string, model: string, finishReason: string, toolCalls?: Array<object>, rawMessage?: object }>}
   */
  async chat({ messages, systemInstruction, tools, temperature = 0.7, maxTokens = 2048, signal }) {
    if (!this.apiKey && !this.client) {
      throw new Error('OPENAI_API_KEY is missing. Configure OPENAI_API_KEY in the server environment.');
    }

    const payload = {
      model: this.model,
      messages: this._formatMessages(messages, systemInstruction),
      temperature,
      max_tokens: maxTokens
    };

    if (tools && Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    try {
      const response = await this.client.chat.completions.create(payload, { signal });
      const choice = response.choices?.[0];
      const message = choice?.message || {};
      const text = message.content || '';
      const finishReason = choice?.finish_reason || 'stop';

      let toolCalls;
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map(tc => {
          const { parsed, error } = this._parseToolArguments(tc.function?.arguments);
          return {
            id: tc.id,
            type: tc.type || 'function',
            name: decodeToolName(tc.function?.name),
            rawName: tc.function?.name,
            arguments: parsed,
            argumentsError: error
          };
        });
      }

      return {
        text,
        toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        model: response.model || this.model,
        finishReason,
        rawMessage: message
      };
    } catch (err) {
      throw this._sanitizeError(err);
    }
  }

  /**
   * Streaming chat generation with native tool support.
   */
  async chatStream({ messages, systemInstruction, tools, temperature = 0.7, maxTokens = 2048, onChunk, signal }) {
    if (!this.apiKey && !this.client) {
      throw new Error('OPENAI_API_KEY is missing. Configure OPENAI_API_KEY in the server environment.');
    }

    const payload = {
      model: this.model,
      messages: this._formatMessages(messages, systemInstruction),
      temperature,
      max_tokens: maxTokens,
      stream: true
    };

    if (tools && Array.isArray(tools) && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    try {
      const stream = await this.client.chat.completions.create(payload, { signal });
      let accumulatedText = '';
      const accumulatedToolCalls = [];

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          accumulatedText += delta.content;
          if (onChunk) {
            onChunk(delta.content);
          }
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? accumulatedToolCalls.length;
            if (!accumulatedToolCalls[index]) {
              accumulatedToolCalls[index] = {
                id: tc.id || '',
                type: tc.type || 'function',
                rawName: tc.function?.name || '',
                rawArguments: tc.function?.arguments || ''
              };
            } else {
              if (tc.id) accumulatedToolCalls[index].id = tc.id;
              if (tc.function?.name) accumulatedToolCalls[index].rawName += tc.function.name;
              if (tc.function?.arguments) accumulatedToolCalls[index].rawArguments += tc.function.arguments;
            }
          }
        }
      }

      const toolCalls = accumulatedToolCalls.filter(Boolean).map(tc => {
        const { parsed, error } = this._parseToolArguments(tc.rawArguments);
        return {
          id: tc.id,
          type: tc.type,
          name: decodeToolName(tc.rawName),
          rawName: tc.rawName,
          arguments: parsed,
          argumentsError: error
        };
      });

      return {
        text: accumulatedText,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model: this.model
      };
    } catch (err) {
      throw this._sanitizeError(err);
    }
  }

  /**
   * Summarization capability
   */
  async summarize({ text, style = 'concise', focus, stream = false, onChunk, signal }) {
    if (!this.apiKey && !this.client) {
      throw new Error('OPENAI_API_KEY is missing. Configure OPENAI_API_KEY in the server environment.');
    }

    const styleInstructions = {
      concise: 'Provide a concise, direct summary in 2-3 well-crafted sentences.',
      detailed: 'Provide a detailed, thorough summary with context, key findings, and implications.',
      bullet_points: 'Summarize the content as clear, actionable bullet points.',
      key_takeaways: 'Extract the most important key takeaways with brief explanations.',
      action_items: 'Identify and list all action items, next steps, and responsibilities.',
      structured_json: 'Output a valid JSON object with fields: "title", "summary", "keyPoints" (array of strings), and "actionItems" (array of strings).'
    };

    const instruction = styleInstructions[style] || styleInstructions.concise;
    const focusInstruction = focus ? ` Focus particularly on aspects relating to: "${focus}".` : '';

    const systemPrompt = `You are an expert executive summarizer.${focusInstruction}\n${instruction}`;

    const messages = [
      { role: 'user', content: text }
    ];

    if (stream) {
      return this.chatStream({ messages, systemInstruction: systemPrompt, onChunk, signal });
    }

    return this.chat({ messages, systemInstruction: systemPrompt, signal });
  }
}
