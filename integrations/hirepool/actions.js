import { z } from 'zod';
import { getAssistantActionRegistry } from '../../connectors/bridge.js';

export const HIREPOOL_ASSISTANT_ID = 'hirepool';

export const HIREPOOL_ACTION_DEFINITIONS = [
  {
    name: 'jobs:search',
    title: 'Search active jobs',
    description: 'Search publicly available active HirePool jobs by keyword, skills, or location.',
    parameters: {
      query: 'Optional keywords to search in job titles and descriptions.',
      skills: 'Optional comma-separated skills.',
      locations: 'Optional comma-separated locations.'
    },
    parameterSchema: z.object({
      query: z.string().trim().max(160).optional().describe('Keywords to search in active jobs.'),
      skills: z.string().trim().max(200).optional().describe('Comma-separated required skills.'),
      locations: z.string().trim().max(200).optional().describe('Comma-separated locations.')
    }).strict(),
    risk: 'read',
    requiresConfirmation: false,
    promptGuideline: 'Search active HirePool jobs using only the search criteria explicitly requested by the user.'
  },
  {
    name: 'jobs:view',
    title: 'View job details',
    description: 'View a job that is public or otherwise authorized for the current HirePool user.',
    parameters: {
      job_id: 'UUID of the job to view.'
    },
    parameterSchema: z.object({
      job_id: z.string().uuid().describe('UUID of a job.')
    }).strict(),
    risk: 'read',
    requiresConfirmation: false,
    promptGuideline: 'View details only for a job identified by the user or returned from a job search.'
  },
  {
    name: 'profile:view',
    title: 'View my profile summary',
    description: 'View a minimal summary of the authenticated candidate’s own profile.',
    parameters: {},
    parameterSchema: z.object({}).strict(),
    risk: 'read',
    requiresConfirmation: false,
    promptGuideline: 'Use only to summarize the current candidate’s profile when the candidate asks.'
  },
  {
    name: 'applications:list',
    title: 'List my applications',
    description: 'List a small page of applications belonging to the authenticated candidate.',
    parameters: {
      page_size: 'Optional number of recent applications to show (1 to 10).'
    },
    parameterSchema: z.object({
      page_size: z.number().int().min(1).max(10).optional()
        .describe('Number of recent applications to return, from 1 to 10.')
    }).strict(),
    risk: 'read',
    requiresConfirmation: false,
    promptGuideline: 'List the current candidate’s applications only when they ask about their application status.'
  }
];

export function registerHirePoolActions() {
  const registry = getAssistantActionRegistry(HIREPOOL_ASSISTANT_ID);
  registry.tag = 'action:hirepool';
  const missingActions = HIREPOOL_ACTION_DEFINITIONS.filter(action => !registry.has(action.name));
  if (missingActions.length > 0) {
    registry.registerMany(missingActions);
  }
  return registry;
}
