import { BaseAIProvider } from './base.js';
import { GeminiProvider } from './gemini.js';
import { GroqProvider } from './groq.js';
import { MockAIProvider } from './mock.js';

let activeProviderInstance = null;

/**
 * Resilient fallback provider wrapper
 * Automatically fails over from primary (e.g. Gemini) to fallback (e.g. Groq) on rate limits or service outages
 */
export class ResilientFallbackProvider extends BaseAIProvider {
  constructor(primary, fallback) {
    super('resilient-fallback');
    this.primary = primary;
    this.fallback = fallback;
  }

  async checkHealth() {
    const primaryHealth = await this.primary.checkHealth();
    if (primaryHealth.available) return primaryHealth;
    if (this.fallback) {
      const fallbackHealth = await this.fallback.checkHealth();
      return {
        ...fallbackHealth,
        message: `Primary unavailable (${primaryHealth.message}). Fallback active: ${fallbackHealth.message}`
      };
    }
    return primaryHealth;
  }

  async chat(options) {
    try {
      return await this.primary.chat(options);
    } catch (err) {
      const isRetryable = err.statusCode === 429 || err.statusCode === 503 || err.statusCode === 504 || (err.message && err.message.includes('429'));
      if (this.fallback && isRetryable) {
        console.warn(`[AI Provider] Primary provider failed (${err.message}), falling back to ${this.fallback.name}...`);
        return await this.fallback.chat(options);
      }
      throw err;
    }
  }

  async chatStream(options) {
    try {
      return await this.primary.chatStream(options);
    } catch (err) {
      const isRetryable = err.statusCode === 429 || err.statusCode === 503 || err.statusCode === 504 || (err.message && err.message.includes('429'));
      if (this.fallback && isRetryable) {
        console.warn(`[AI Provider] Primary provider stream failed (${err.message}), falling back to ${this.fallback.name}...`);
        return await this.fallback.chatStream(options);
      }
      throw err;
    }
  }

  async summarize(options) {
    try {
      return await this.primary.summarize(options);
    } catch (err) {
      const isRetryable = err.statusCode === 429 || err.statusCode === 503 || err.statusCode === 504;
      if (this.fallback && isRetryable) {
        return await this.fallback.summarize(options);
      }
      throw err;
    }
  }
}

function instantiateProvider(name, options = {}) {
  switch (name.toLowerCase()) {
    case 'gemini':
      return new GeminiProvider(options);
    case 'groq':
      return new GroqProvider(options);
    case 'mock':
      return new MockAIProvider(options);
    default:
      throw new Error(`Unknown AI provider: "${name}". Supported providers: "gemini", "groq", "mock"`);
  }
}

/**
 * AI Provider Factory
 * @param {string} [providerName]
 * @param {object} [options]
 * @returns {import('./base.js').BaseAIProvider}
 */
export function getAIProvider(providerName, options = {}) {
  if (providerName) {
    return instantiateProvider(providerName, options);
  }

  if (activeProviderInstance && !options.forceNew) {
    return activeProviderInstance;
  }

  const configuredProvider = process.env.AI_PROVIDER;
  if (configuredProvider) {
    activeProviderInstance = instantiateProvider(configuredProvider, options);
    return activeProviderInstance;
  }

  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasGroq = !!process.env.GROQ_API_KEY;

  if (hasGemini && hasGroq) {
    const primary = new GeminiProvider(options);
    const fallback = new GroqProvider(options);
    activeProviderInstance = new ResilientFallbackProvider(primary, fallback);
  } else if (hasGemini) {
    activeProviderInstance = new GeminiProvider(options);
  } else if (hasGroq) {
    activeProviderInstance = new GroqProvider(options);
  } else {
    activeProviderInstance = new MockAIProvider(options);
  }

  return activeProviderInstance;
}

export function setAIProvider(provider) {
  activeProviderInstance = provider;
}
