import { BaseAIProvider } from './base.js';

/**
 * Mock AI Provider for automated tests and offline development.
 */
export class MockAIProvider extends BaseAIProvider {
  constructor(options = {}) {
    super('mock');
    this.model = options.model || 'mock-model-v1';
    this.delayMs = options.delayMs ?? 10;
    this.mockToolCalls = options.mockToolCalls || null;
  }

  async checkHealth() {
    return {
      available: true,
      model: this.model,
      message: 'Mock provider is active and ready.'
    };
  }

  async chat({ messages, systemInstruction, tools, temperature, maxTokens, signal }) {
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
    this.lastTools = tools || null;

    // Echo instruction hook for context testing
    if (lastMessage.includes('ECHO_SYSTEM_INSTRUCTION')) {
      return {
        text: systemInstruction || '[NO_SYSTEM_INSTRUCTION]',
        model: this.model,
        finishReason: 'STOP'
      };
    }

    // Native tool call simulation hooks
    if (this.mockToolCalls) {
      const toolCalls = Array.isArray(this.mockToolCalls) ? this.mockToolCalls : [this.mockToolCalls];
      this.mockToolCalls = null; // consume
      return {
        text: 'Executing requested tool...',
        toolCalls,
        model: this.model,
        finishReason: 'tool_calls'
      };
    }

    if (lastMessage.startsWith('MOCK_TOOL_CALL:')) {
      const jsonStr = lastMessage.slice('MOCK_TOOL_CALL:'.length).trim();
      try {
        const parsed = JSON.parse(jsonStr);
        const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
        return {
          text: 'Executing tool call...',
          toolCalls,
          model: this.model,
          finishReason: 'tool_calls'
        };
      } catch (err) {
        return {
          text: 'Failed to parse mock tool call JSON: ' + err.message,
          model: this.model,
          finishReason: 'STOP'
        };
      }
    }

    // Check if previous message was a tool result
    const lastMsgObj = messages[messages.length - 1];
    if (lastMsgObj?.role === 'tool') {
      return {
        text: `[Mock Synthesized] Based on the tool result: ${lastMsgObj.content}`,
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

    // Document Q&A simulation hook when document context is attached
    if (systemInstruction && systemInstruction.includes('[UPLOADED DOCUMENTS CONTEXT]')) {
      const lower = lastMessage.toLowerCase();
      if (lower.includes('priya') || lower.includes('skills') || lower.includes('experience') || lower.includes('background') || lower.includes('education') || lower.includes('summar')) {
        return {
          text: `Based on the uploaded document for Priya Nair: She is a Frontend Developer based in Bengaluru, Karnataka with 1 year of experience at Demo Digital Labs. Her technical skills include JavaScript, React.js, HTML5, CSS3, Tailwind CSS, REST APIs, and Git. She holds a B.Sc. in Computer Science from Sample City College (2025).`,
          model: this.model,
          finishReason: 'STOP'
        };
      }
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

  async chatStream({ messages, systemInstruction, tools, onChunk, signal }) {
    if (signal?.aborted) {
      const err = new Error('Request was aborted');
      err.statusCode = 499;
      throw err;
    }

    this.lastSystemInstruction = systemInstruction || null;
    this.lastMessages = messages;
    this.lastTools = tools || null;

    const lastMessage = messages[messages.length - 1]?.content || '';

    // Echo instruction hook for streaming context testing
    if (lastMessage.includes('ECHO_SYSTEM_INSTRUCTION')) {
      const text = systemInstruction || '[NO_SYSTEM_INSTRUCTION]';
      if (onChunk) onChunk(text);
      return { text, model: this.model };
    }

    if (lastMessage.startsWith('MOCK_TOOL_CALL:')) {
      const jsonStr = lastMessage.slice('MOCK_TOOL_CALL:'.length).trim();
      try {
        const parsed = JSON.parse(jsonStr);
        const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
        const text = 'Executing tool stream...';
        if (onChunk) onChunk(text);
        return {
          text,
          toolCalls,
          model: this.model
        };
      } catch (err) {
        const text = 'Failed to parse mock tool call: ' + err.message;
        if (onChunk) onChunk(text);
        return { text, model: this.model };
      }
    }

    if (lastMessage.startsWith('ECHO_RESPONSE:')) {
      const text = lastMessage.slice('ECHO_RESPONSE:'.length).trim();
      if (onChunk) onChunk(text);
      return { text, model: this.model };
    }

    // Document Q&A simulation hook when document context is attached
    if (systemInstruction && systemInstruction.includes('[UPLOADED DOCUMENTS CONTEXT]')) {
      const lower = lastMessage.toLowerCase();
      if (lower.includes('priya') || lower.includes('skills') || lower.includes('experience') || lower.includes('background') || lower.includes('education') || lower.includes('summar')) {
        const text = `Based on the uploaded document for Priya Nair: She is a Frontend Developer based in Bengaluru, Karnataka with 1 year of experience at Demo Digital Labs. Her technical skills include JavaScript, React.js, HTML5, CSS3, Tailwind CSS, REST APIs, and Git. She holds a B.Sc. in Computer Science from Sample City College (2025).`;
        if (onChunk) onChunk(text);
        return { text, model: this.model };
      }
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
