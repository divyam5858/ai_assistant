import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../backend/src/providers/gemini.js';

const apiKey = process.env.GEMINI_API_KEY;

describe('Live Gemini Provider Verification', { skip: !apiKey ? 'GEMINI_API_KEY not configured' : false }, () => {
  const provider = new GeminiProvider({
    apiKey,
    model: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
    timeoutMs: 30000
  });

  test('checkHealth confirms Gemini API access and quota', async () => {
    const health = await provider.checkHealth();
    assert.equal(health.available, true);
    assert.ok(health.model);
  });

  test('chat generates genuine AI response for multi-turn conversation', async () => {
    const messages = [
      { role: 'user', content: 'My secret project code name is Project Neptune.' },
      { role: 'assistant', content: 'Understood. I will remember that your project code name is Project Neptune.' },
      { role: 'user', content: 'What is my secret project code name? Respond with only the code name.' }
    ];

    const result = await provider.chat({
      messages,
      temperature: 0.2
    });

    assert.ok(result.text.length > 0);
    assert.ok(result.text.includes('Neptune'), `Expected response to include "Neptune", got: "${result.text}"`);
  });

  test('chatStream streams response chunks via SSE', async () => {
    const chunks = [];
    const result = await provider.chatStream({
      messages: [{ role: 'user', content: 'List 3 fruits, separated by commas.' }],
      onChunk: (chunk) => {
        chunks.push(chunk);
      }
    });

    assert.ok(chunks.length >= 1, 'Expected at least 1 streamed chunk');
    assert.ok(result.text.length > 0);
  });

  test('summarize generates structured concise summary', async () => {
    const sample = 'Antigravity 2.0 introduces autonomous agent capabilities, real-time code execution, and modular SDK integration for enterprise applications.';
    const result = await provider.summarize({
      text: sample,
      style: 'concise'
    });

    assert.ok(result.text.length > 0);
  });
});

