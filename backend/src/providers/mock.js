import { BaseAIProvider } from './base.js';

/**
 * Mock AI Provider for automated tests and offline development.
 */
export class MockAIProvider extends BaseAIProvider {
  constructor(options = {}) {
    super('mock');
    this.model = options.model || 'mock-model-v1';
    this.delayMs = options.delayMs ?? 10;
  }

  async checkHealth() {
    return {
      available: true,
      model: this.model,
      message: 'Mock provider is active and ready.'
    };
  }

  async chat({ messages, systemInstruction, temperature, maxTokens, signal }) {
    if (signal?.aborted) {
      const err = new Error('Request was aborted');
      err.statusCode = 499;
      throw err;
    }

    if (this.delayMs > 0) {
      await new Promise(r => setTimeout(r, this.delayMs));
    }

    const lastMessage = messages[messages.length - 1]?.content || '';

    this.lastSystemInstruction = systemInstruction || null;
    this.lastMessages = messages;

    // Echo instruction hook for context testing
    if (lastMessage.includes('ECHO_SYSTEM_INSTRUCTION')) {
      return {
        text: systemInstruction || '[NO_SYSTEM_INSTRUCTION]',
        model: this.model,
        finishReason: 'STOP'
      };
    }

    if (lastMessage.startsWith('ECHO_RESPONSE:')) {
      return {
        text: lastMessage.slice('ECHO_RESPONSE:'.length).trim(),
        model: this.model,
        finishReason: 'STOP'
      };
    }

    // Error simulation hook
    if (lastMessage.includes('TRIGGER_500_ERROR')) {
      const err = new Error('Simulated internal provider failure');
      err.statusCode = 500;
      throw err;
    }
    if (lastMessage.includes('TRIGGER_TIMEOUT')) {
      const err = new Error('Simulated request timeout');
      err.statusCode = 504;
      throw err;
    }

    return {
      text: `[Mock Response] I received your message: "${lastMessage}". This is a simulated response for testing.`,
      model: this.model,
      finishReason: 'STOP'
    };
  }

  async chatStream({ messages, systemInstruction, onChunk, signal }) {
    if (signal?.aborted) {
      const err = new Error('Request was aborted');
      err.statusCode = 499;
      throw err;
    }

    this.lastSystemInstruction = systemInstruction || null;
    this.lastMessages = messages;

    const lastMessage = messages[messages.length - 1]?.content || '';

    // Echo instruction hook for streaming context testing
    if (lastMessage.includes('ECHO_SYSTEM_INSTRUCTION')) {
      const text = systemInstruction || '[NO_SYSTEM_INSTRUCTION]';
      if (onChunk) onChunk(text);
      return { text, model: this.model };
    }

    if (lastMessage.startsWith('ECHO_RESPONSE:')) {
      const text = lastMessage.slice('ECHO_RESPONSE:'.length).trim();
      if (onChunk) onChunk(text);
      return { text, model: this.model };
    }

    const words = `[Mock Stream] Response to: ${lastMessage}. Multi-token stream simulation is working.`.split(' ');

    let fullText = '';
    for (const word of words) {
      if (signal?.aborted) {
        break;
      }
      if (this.delayMs > 0) {
        await new Promise(r => setTimeout(r, this.delayMs));
      }
      const chunk = word + ' ';
      fullText += chunk;
      if (onChunk) onChunk(chunk);
    }

    return {
      text: fullText.trim(),
      model: this.model
    };
  }

  async summarize({ text, style = 'concise', stream = false, onChunk, signal }) {
    if (style === 'structured_json') {
      const jsonRes = JSON.stringify({
        summary: `Mock summary of text (${text.length} chars)`,
        keyPoints: ['Key takeaway 1', 'Key takeaway 2', 'Key takeaway 3'],
        actionItems: ['Review findings', 'Implement next steps'],
        sentiment: 'objective'
      }, null, 2);

      if (stream && onChunk) {
        onChunk(jsonRes);
      }
      return { text: jsonRes, model: this.model };
    }

    const summaryText = `[Mock Summary (${style})]: Extracted insights from ${text.slice(0, 50)}...`;
    if (stream && onChunk) {
      onChunk(summaryText);
    }
    return { text: summaryText, model: this.model };
  }
}
