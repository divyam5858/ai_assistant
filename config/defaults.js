export const SERVER_DEFAULTS = {
  PORT: 3000,
  HOST: '0.0.0.0',
  NODE_ENV: 'development',
  ALLOWED_ORIGINS: ['*'],
  RATE_LIMIT: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 60       // 60 requests per minute
  },
  SESSION: {
    TTL_MS: 2 * 60 * 60 * 1000, // 2 hours
    MAX_MESSAGES_IN_CONTEXT: 20
  },
  GEMINI: {
    DEFAULT_MODEL: 'gemini-flash-lite-latest',
    FALLBACK_MODEL: 'gemini-flash-lite-latest',
    TIMEOUT_MS: 30000,
    MAX_RETRIES: 2
  }
};

export const WIDGET_DEFAULTS = {
  name: 'AI Assistant',
  description: 'Your helpful AI assistant',
  theme: 'auto',
  primaryColor: '#4f46e5',
  position: 'bottom-right',
  greeting: 'Hello! How can I help you today? Ask me questions, request explanations, or paste text to summarize.',
  suggestedPrompts: [
    'Summarize this document',
    'Extract key action items',
    'Explain this in simple terms',
    'Write a concise email response'
  ],
  features: {
    streaming: true,
    summarization: true,
    copyResponse: true,
    clearHistory: true,
    markdown: true,
    structuredOutput: true
  }
};
