import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getAIProvider, ProviderConfigurationError, setAIProvider } from '../backend/src/providers/factory.js';
import { MockAIProvider } from '../backend/src/providers/mock.js';

const variableNames = [
  'NODE_ENV',
  'AI_PROVIDER',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'OPENAI_API_KEY'
];
const originalEnvironment = Object.fromEntries(variableNames.map(name => [name, process.env[name]]));

afterEach(() => {
  for (const name of variableNames) {
    if (originalEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnvironment[name];
  }
  setAIProvider(null);
});

test('requires an explicitly configured AI provider instead of returning demo responses silently', () => {
  delete process.env.AI_PROVIDER;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.NODE_ENV = 'development';
  setAIProvider(null);

  assert.throws(
    () => getAIProvider(),
    error => error instanceof ProviderConfigurationError && error.code === 'PROVIDER_NOT_CONFIGURED'
  );
});

test('allows an explicitly selected mock only outside production', () => {
  process.env.NODE_ENV = 'test';
  process.env.AI_PROVIDER = 'mock';
  setAIProvider(null);
  assert.ok(getAIProvider() instanceof MockAIProvider);

  process.env.NODE_ENV = 'production';
  setAIProvider(null);
  assert.throws(
    () => getAIProvider(),
    error => error instanceof ProviderConfigurationError && /disabled in production/.test(error.message)
  );
});
