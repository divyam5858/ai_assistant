import { z } from 'zod';
import { getAssistantActionRegistry } from '../../../connectors/bridge.js';

const demoRegistry = getAssistantActionRegistry('integration-demo');
demoRegistry.tag = 'action:generic';

if (!demoRegistry.has('notes:search')) {
  demoRegistry.registerMany([
    {
      name: 'notes:search',
      title: 'Search Notes',
      description: 'Search notes in the mock host application.',
      risk: 'read',
      requiresConfirmation: false,
      parameterSchema: z.object({
        query: z.string().trim().min(1).max(200)
      }),
      promptGuideline: 'Search the mock host application for notes matching a user query.'
    },
    {
      name: 'notes:update',
      title: 'Update a Note',
      description: 'Update the text of an existing note in the mock host application.',
      risk: 'write',
      requiresConfirmation: true,
      parameterSchema: z.object({
        noteId: z.string().trim().min(1).max(100),
        text: z.string().trim().min(1).max(2000)
      }),
      promptGuideline: 'Propose a note update only when the user explicitly asks to change a note.'
    }
  ]);
}

export function registerIntegrationDemoActions() {
  return demoRegistry;
}
