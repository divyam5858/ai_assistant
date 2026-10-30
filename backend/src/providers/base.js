/**
 * Base AI Provider interface
 * Decouples the backend and widget from any specific LLM provider (Gemini, OpenAI, Anthropic, etc.)
 */
export class BaseAIProvider {
  constructor(name = 'base') {
    if (new.target === BaseAIProvider) {
      throw new TypeError('Cannot instantiate BaseAIProvider directly');
    }
    this.name = name;
  }

  /**
   * Health check / validation of provider credentials and connectivity
   * @returns {Promise<{ available: boolean, model: string, message?: string }>}
   */
  async checkHealth() {
    throw new Error('checkHealth() must be implemented');
  }

  /**
   * Non-streaming chat generation
   * @param {object} options
   * @param {Array<{ role: 'user'|'assistant'|'system', content: string }>} options.messages
   * @param {string} [options.systemInstruction]
   * @param {number} [options.temperature]
   * @param {number} [options.maxTokens]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ text: string, model: string, finishReason?: string }>}
   */
  async chat(options) {
    throw new Error('chat() must be implemented');
  }

  /**
   * Streaming chat generation
   * @param {object} options
   * @param {Array<{ role: 'user'|'assistant'|'system', content: string }>} options.messages
   * @param {string} [options.systemInstruction]
   * @param {number} [options.temperature]
   * @param {number} [options.maxTokens]
   * @param {(chunk: string) => void} options.onChunk
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ text: string, model: string }>}
   */
  async chatStream(options) {
    throw new Error('chatStream() must be implemented');
  }

  /**
   * Summarization capability
   * @param {object} options
   * @param {string} options.text
   * @param {'concise'|'detailed'|'bullet_points'|'key_takeaways'|'action_items'|'structured_json'} options.style
   * @param {string} [options.focus]
   * @param {boolean} [options.stream]
   * @param {(chunk: string) => void} [options.onChunk]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ text: string, model: string }>}
   */
  async summarize(options) {
    throw new Error('summarize() must be implemented');
  }
}
