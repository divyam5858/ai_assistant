import { sanitizePrompt } from './middleware/security.js';

/**
 * Maximum messages sent to the LLM provider in a single request.
 * Keeps provider requests strictly within the 30-item constraint
 * (e.g. 28 history items + 1 user message = 29 items).
 */
export const MAX_PROVIDER_HISTORY_ITEMS = 28;

/**
 * Summarizes older conversation turns into a compact, neutral context string.
 * Redacts any potential credentials, tokens, or raw secrets.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} [priorSummary='']
 * @returns {string}
 */
export function summarizeEarlierHistory(messages, priorSummary = '') {
  const existingPoints = typeof priorSummary === 'string' &&
    priorSummary.trim() &&
    !priorSummary.startsWith('Ongoing multi-turn') &&
    !priorSummary.startsWith('Prior conversation turns')
    ? priorSummary.split('; ').map(s => s.trim()).filter(Boolean)
    : [];

  if ((!Array.isArray(messages) || messages.length === 0) && existingPoints.length === 0) {
    return 'Prior conversation turns with user queries and assistant responses.';
  }

  const salientPoints = [...existingPoints];
  const assistantTopicPattern = /\b(?:hirepool|created|profile|job|candidate|client|company|consultancy|agency|signup|sign\s*up|register|onboarding|verification|application)\b/i;
  for (const msg of (messages || [])) {
    if (msg.role === 'user') {
      const text = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (text) {
        // Redact any tokens or secret patterns
        const cleaned = text
          .replace(/[A-Za-z0-9_-]{30,}/g, '[REDACTED_IDENTIFIER]')
          .slice(0, 120);
        salientPoints.push(`User asked: "${cleaned}"`);
      }
    } else if (msg.role === 'assistant') {
      const text = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (text && assistantTopicPattern.test(text)) {
        const cleaned = text
          .replace(/[A-Za-z0-9_-]{30,}/g, '[REDACTED_IDENTIFIER]')
          .slice(0, 120);
        salientPoints.push(`Assistant addressed: "${cleaned}"`);
      }
    }
  }

  // Take the most recent salient points from earlier messages
  const recentPoints = salientPoints.slice(-6);
  return recentPoints.length > 0
    ? recentPoints.join('; ')
    : 'Ongoing multi-turn conversation session.';
}

/**
 * Removes out-of-scope question-and-refusal pairs from message history so that
 * subsequent turns are completely isolated from general-purpose context contamination.
 *
 * @param {Array<{role: string, content: string, isOutOfScope?: boolean, scope?: string}>} messages
 * @returns {Array<{role: string, content: string}>}
 */
export function filterOutOfScopeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const clean = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const isOut =
      msg.isOutOfScope === true ||
      msg.scope === 'OUT_OF_SCOPE' ||
      (msg.role === 'assistant' &&
        typeof msg.content === 'string' &&
        msg.content.includes("I'm your HirePool assistant. I can help you with matching jobs") &&
        msg.content.includes("I can't answer general questions outside the HirePool platform"));

    if (isOut) {
      if (clean.length > 0 && clean[clean.length - 1].role === 'user') {
        clean.pop();
      }
      continue;
    }
    clean.push({ role: msg.role, content: msg.content });
  }
  return clean;
}

/**
 * Builds safe messages array for LLM provider execution.
 * Ensures messages <= maxProviderItems, preserves recent conversation turns,
 * and maintains tool-call / tool-result pair integrity.
 *
 * @param {object} options
 * @param {object} [options.session] Server-side conversation session
 * @param {string} options.incomingMessage Current user message
 * @param {Array<object>} [options.clientHistory] Messages passed from client if server session is empty
 * @param {number} [options.maxProviderItems] Max messages to pass to provider (default: 28)
 * @returns {Array<{role: string, content: string}>}
 */
export function buildProviderMessages({
  session,
  incomingMessage,
  clientHistory = [],
  maxProviderItems = MAX_PROVIDER_HISTORY_ITEMS
}) {
  let sourceMessages = [];

  if (session && Array.isArray(session.messages) && session.messages.length > 0) {
    sourceMessages = session.messages.map(m => ({
      role: m.role,
      content: m.content,
      isOutOfScope: m.isOutOfScope,
      scope: m.scope
    }));
  } else if (Array.isArray(clientHistory) && clientHistory.length > 0) {
    sourceMessages = clientHistory.map(m => ({
      role: m.role,
      content: sanitizePrompt(m.content),
      isOutOfScope: m.isOutOfScope,
      scope: m.scope
    }));
  }

  // Filter out any out-of-scope exchanges so provider context remains strictly uncontaminated
  const rawMessages = filterOutOfScopeMessages(sourceMessages);

  const incomingUserMessage = {
    role: 'user',
    content: sanitizePrompt(incomingMessage)
  };

  const priorSummary = typeof session?.conversationSummary === 'string'
    ? session.conversationSummary.trim()
    : '';

  // If rawMessages fits within the provider limit and no evicted summary exists, return directly
  if (rawMessages.length <= maxProviderItems && !priorSummary) {
    return [
      ...rawMessages,
      incomingUserMessage
    ];
  }

  // Conversation history exceeds provider limit or older turns rolled off server session:
  // Allocate 2 slots for summary context + ack, leaving up to (maxProviderItems - 2) for recent messages.
  const targetRecentCount = Math.max(1, maxProviderItems - 2);
  const cutoffIndex = Math.max(0, rawMessages.length - targetRecentCount);

  const olderMessages = rawMessages.slice(0, cutoffIndex);
  const recentMessages = rawMessages.slice(cutoffIndex);

  const summaryText = olderMessages.length > 0
    ? summarizeEarlierHistory(olderMessages, priorSummary)
    : priorSummary;

  const summaryMessage = {
    role: 'user',
    content: `[Context from earlier conversation turns in this session: ${summaryText}]`
  };

  const summaryAck = {
    role: 'assistant',
    content: 'I have retained the context of our earlier discussion and will continue assisting you.'
  };

  return [
    summaryMessage,
    summaryAck,
    ...recentMessages,
    incomingUserMessage
  ];
}
