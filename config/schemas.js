import { z } from 'zod';

export const HexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const AssistantConfigSchema = z.object({
  assistantId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Assistant ID must contain only alphanumeric characters, underscores, or hyphens'),
  name: z.string().min(1).max(60).default('AI Assistant'),
  description: z.string().max(200).optional().default('Your helpful AI assistant'),
  avatarUrl: z.string().url().or(z.string().regex(/^data:image\//)).optional(),
  theme: z.enum(['light', 'dark', 'auto']).default('auto'),
  primaryColor: z.string().regex(HexColorRegex, 'Invalid hex color format').default('#4f46e5'),
  position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']).default('bottom-right'),
  greeting: z.string().max(500).default('Hello! How can I help you today? Ask a question or paste text to summarize.'),
  suggestedPrompts: z.array(z.string().max(120)).max(6).default([
    'Summarize this document',
    'Extract key action items',
    'Explain this in simple terms',
    'Write a concise email response'
  ]),
  systemInstruction: z.string().max(4000).optional(),
  features: z.object({
    streaming: z.boolean().default(true),
    summarization: z.boolean().default(true),
    copyResponse: z.boolean().default(true),
    clearHistory: z.boolean().default(true),
    markdown: z.boolean().default(true),
    structuredOutput: z.boolean().default(true)
  }).default({
    streaming: true,
    summarization: true,
    copyResponse: true,
    clearHistory: true,
    markdown: true,
    structuredOutput: true
  })
});

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(20000).default('')
});

export const ChatRequestSchema = z.object({
  assistantId: z.string().min(1).max(64).default('default'),
  message: z.string().trim().min(1, 'Message cannot be empty').max(10000, 'Message cannot exceed 10,000 characters'),
  context: z.string().trim().max(30000, 'Context exceeds 30,000 character limit').nullable().optional(),
  conversationId: z.string().max(64).nullable().optional(),
  history: z.array(ChatMessageSchema).max(30).nullable().optional().default([]),
  stream: z.boolean().optional().default(false),
  parameters: z.object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().min(1).max(8192).optional()
  }).nullable().optional().default({})
});

export const SummarizeRequestSchema = z.object({
  text: z.string().trim().min(1, 'Text to summarize cannot be empty').max(50000, 'Text exceeds 50,000 character limit'),
  style: z.enum(['concise', 'detailed', 'bullet_points', 'key_takeaways', 'action_items', 'structured_json']).default('concise'),
  stream: z.boolean().optional().default(false),
  conversationId: z.string().max(64).nullable().optional(),
  focus: z.string().max(200).nullable().optional()
});

export const ConnectorActionSchema = z.object({
  connectorId: z.string().min(1).max(64),
  action: z.string().min(1).max(64),
  parameters: z.record(z.any()).default({}),
  authToken: z.string().optional()
});

export const ALLOWED_ACTIONS = [
  'candidate:apply_job',
  'consultancy:add_candidate',
  'consultancy:create_candidates_batch',
  'client:create_job'
];

export const ActionProposalSchema = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(ALLOWED_ACTIONS),
  title: z.string().min(1).max(120),
  explanation: z.string().max(1000).optional().default(''),
  parameters: z.record(z.any()).default({})
});
