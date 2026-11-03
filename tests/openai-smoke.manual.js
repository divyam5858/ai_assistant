/**
 * OPT-IN MANUAL SMOKE TEST: OpenAI Native Tool Calling
 *
 * ATTENTION:
 * - This test makes REAL LIVE network calls to OpenAI API.
 * - This test MAY INCUR API USAGE / CHARGES against your OpenAI account.
 * - Do NOT run this test automatically in CI or standard unit test runs.
 * - To run this test manually:
 *     node --env-file=backend/.env tests/openai-smoke.manual.js
 */

import { OpenAIProvider } from '../backend/src/providers/openai.js';
import { ActionRegistry } from '../backend/src/actions/registry.js';
import { MockConnector } from '../connectors/mock-connector.js';
import { bridgeConnectorToRegistry } from '../connectors/bridge.js';
import { registryToOpenAITools } from '../backend/src/actions/tool-converter.js';

async function runSmokeTest() {
  console.log('====================================================');
  console.log('  OPT-IN OPENAI NATIVE TOOL CALLING LIVE SMOKE TEST ');
  console.log('====================================================');
  console.log('Notice: This test connects to the live OpenAI API and will incur usage.');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('FAIL: OPENAI_API_KEY environment variable is not set. Smoke test skipped.');
    process.exit(1);
  }

  // Ensure API key is NEVER logged
  console.log('API Key Status: Present (Length:', apiKey.length, 'chars, Key masked)');
  console.log('Configured Model:', process.env.OPENAI_MODEL || 'gpt-4o-mini');

  const provider = new OpenAIProvider();

  // 1. Health Probe
  console.log('\n[1/3] Running OpenAI Health Probe...');
  const health = await provider.checkHealth();
  console.log('Health probe result:', health.available ? 'HEALTHY' : 'UNAVAILABLE');
  if (!health.available) {
    console.error('Health check failed:', health.message);
    process.exit(1);
  }

  // 2. Setup Non-destructive Read-only Registry
  console.log('\n[2/3] Preparing Non-Destructive Tool Schema...');
  const smokeRegistry = new ActionRegistry();
  const mockConnector = new MockConnector();
  bridgeConnectorToRegistry(mockConnector, smokeRegistry);
  const nativeTools = registryToOpenAITools(smokeRegistry);
  console.log('Registered Tools for Smoke Test:', nativeTools.map(t => t.function.name));

  // 3. Test Tool Calling Prompt
  console.log('\n[3/3] Sending Tool-Calling Prompt to OpenAI...');
  const prompt = 'Please search the documentation knowledge base for information about embedding the AI Assistant widget.';

  const response = await provider.chat({
    messages: [{ role: 'user', content: prompt }],
    tools: nativeTools,
    systemInstruction: 'You are a technical support assistant. When asked about documentation or widget embedding, use the knowledge base search tool.'
  });

  console.log('OpenAI Response Model:', response.model);
  console.log('Finish Reason:', response.finishReason);

  if (response.toolCalls && response.toolCalls.length > 0) {
    console.log('SUCCESS: Model returned native tool call(s):');
    for (const tc of response.toolCalls) {
      console.log(` - Tool: ${tc.name} (ID: ${tc.id})`);
      console.log('   Arguments:', JSON.stringify(tc.arguments));
    }
  } else {
    console.log('Model responded with text (no tool call was triggered):');
    console.log(response.text.slice(0, 200) + '...');
  }

  console.log('\n====================================================');
  console.log('  OPENAI LIVE SMOKE TEST COMPLETED SUCCESSFULLY     ');
  console.log('====================================================');
}

runSmokeTest().catch((err) => {
  console.error('\nSMOKE TEST ERROR:', err.message);
  process.exit(1);
});
