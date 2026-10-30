import { WIDGET_DEFAULTS } from './defaults.js';

export const ASSISTANT_PRESETS = {
  default: {
    assistantId: 'default',
    name: 'AI Assistant',
    description: 'General-purpose intelligent assistant',
    theme: 'auto',
    primaryColor: '#4f46e5',
    position: 'bottom-right',
    greeting: 'Hello! I am your AI assistant. How can I help you today? You can ask questions, brainstorm, or ask me to summarize text.',
    suggestedPrompts: [
      'What can you do for me?',
      'Summarize key ideas in simple terms',
      'Help me draft a concise response',
      'Create an action list from my notes'
    ],
    systemInstruction: `You are a helpful, accurate, polite, and versatile AI assistant embedded in a web application.
Your answers should be direct, well-structured, and easy to read.
Use markdown headings, bullet points, and code blocks where helpful.
When the user asks for summarization, deliver clear, actionable, and structured insights.
If you do not know the answer or lack context, state so honestly. Never make up facts.`,
    features: { ...WIDGET_DEFAULTS.features }
  },

  researcher: {
    assistantId: 'researcher',
    name: 'Research & Synthesis AI',
    description: 'Specialized in in-depth summaries, synthesis, and takeaways',
    theme: 'light',
    primaryColor: '#0284c7',
    position: 'bottom-right',
    greeting: 'Welcome. I am your Research & Synthesis partner. Provide any article, paper, or notes and I will extract insights, takeaways, and structured summaries.',
    suggestedPrompts: [
      'Summarize this into 3 key takeaways',
      'Extract data points and conclusions',
      'Compare different arguments in this text',
      'Generate an executive briefing'
    ],
    systemInstruction: `You are an expert Research Analyst and Content Synthesizer.
Analyze text with high intellectual rigor.
Highlight key hypotheses, methodology, results, conclusions, and strategic implications.
Use structured markdown sections: Executive Summary, Key Insights, Critical Observations, and Action Items.`,
    features: { ...WIDGET_DEFAULTS.features }
  },

  support: {
    assistantId: 'support',
    name: 'Customer Support Guide',
    description: 'Friendly, fast, step-by-step guidance and troubleshooting',
    theme: 'auto',
    primaryColor: '#059669',
    position: 'bottom-right',
    greeting: 'Hi there! Need help navigating our features, troubleshooting an issue, or getting started? Let me know what you need.',
    suggestedPrompts: [
      'How do I get started?',
      'I am experiencing an issue',
      'Where can I find my settings?',
      'How do I contact support?'
    ],
    systemInstruction: `You are a friendly, patient, and knowledgeable Customer Support Assistant.
Provide step-by-step instructions.
Keep sentences clear and encouraging.
If an issue seems technical, break down troubleshooting into numbered steps.`,
    features: { ...WIDGET_DEFAULTS.features }
  },

  coder: {
    assistantId: 'coder',
    name: 'Code & Dev Companion',
    description: 'Technical companion for code analysis, debugging, and refactoring',
    theme: 'dark',
    primaryColor: '#9333ea',
    position: 'bottom-right',
    greeting: 'Hello, developer! Ready to write, review, debug, or explain code. Paste your snippet or question below.',
    suggestedPrompts: [
      'Review this code for edge cases',
      'Explain how this algorithm works',
      'Refactor this function for clarity',
      'Write tests for this function'
    ],
    systemInstruction: `You are an expert software engineer and technical reviewer.
Provide clean, idiomatic code examples with syntax formatting.
Explain the rationale behind architectural and algorithmic choices.
Identify potential bugs, security pitfalls, performance bottlenecks, and edge cases.`,
    features: { ...WIDGET_DEFAULTS.features }
  }
};

/**
 * Resolve assistant configuration by ID with fallback to default preset
 * @param {string} assistantId
 * @param {object} overrides
 * @returns {object}
 */
export function getAssistantConfig(assistantId = 'default', overrides = {}) {
  const preset = ASSISTANT_PRESETS[assistantId] || ASSISTANT_PRESETS.default;
  return {
    ...preset,
    ...overrides,
    assistantId: assistantId || preset.assistantId,
    features: {
      ...preset.features,
      ...(overrides.features || {})
    }
  };
}
