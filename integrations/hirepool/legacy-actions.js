/**
 * Legacy HirePool Action Definitions
 *
 * Encapsulates the recruitment-specific action definitions, schemas, and prompt instructions
 * for explicit use by legacy HirePool integrations.
 */

export const HIREPOOL_ACTIONS = Object.freeze([
  'candidate:apply_job',
  'consultancy:add_candidate',
  'consultancy:create_candidates_batch',
  'client:create_job'
]);

export const HIREPOOL_ACTION_DEFINITIONS = Object.freeze([
  {
    name: 'candidate:apply_job',
    title: 'Apply for Job',
    description: 'When a Candidate asks to apply for a job.',
    parameters: {
      job_id: '<UUID from context>',
      job_title: '<title>',
      company_name: '<company>',
      cover_letter: '<optional short note>'
    },
    promptGuideline: `When a Candidate asks to apply for a job.
   Parameters: { "job_id": "<UUID from context>", "job_title": "<title>", "company_name": "<company>", "cover_letter": "<optional short note>" }
   CRITICAL: The job_id MUST be one of the exact Job IDs provided in the context. Never fabricate a job ID. If no job ID is found, ask the candidate which job they want to apply for.`,
    promptable: true,
    requiresConfirmation: true,
    metadata: {
      role: 'candidate',
      domain: 'hirepool'
    }
  },
  {
    name: 'consultancy:add_candidate',
    title: 'Add Candidate to Agency Pool',
    description: 'When a Consultancy (agency) user asks to add a candidate to their pool.',
    parameters: {
      first_name: '<name>',
      last_name: '<name>',
      email: '<email>',
      candidate_consent: true,
      phone: '<optional>',
      job_title: '<optional>',
      skills: ['skill1'],
      years_of_experience: 0,
      current_location: '<optional>'
    },
    promptGuideline: `When a Consultancy (agency) user asks to add a candidate to their pool.
   Parameters: { "first_name": "<name>", "last_name": "<name>", "email": "<email>", "candidate_consent": true, "phone": "<optional>", "job_title": "<optional>", "skills": ["skill1", ...], "years_of_experience": <number>, "current_location": "<optional>" }
   CRITICAL: Candidate consent MUST be explicitly confirmed. If not confirmed yet, ask the user for confirmation first.`,
    promptable: true,
    requiresConfirmation: true,
    metadata: {
      role: 'consultancy',
      domain: 'hirepool'
    }
  },
  {
    name: 'client:create_job',
    title: 'Create Draft Job Posting',
    description: 'When a Client user asks to draft or create a job posting.',
    parameters: {
      title: '<title (min 3 chars)>',
      description: '<detailed description (min 30 chars)>',
      job_type: 'full_time',
      hiring_type: 'contract',
      pay_period: 'year',
      salary_currency: 'INR',
      status: 'draft'
    },
    promptGuideline: `When a Client user asks to draft or create a job posting.
   Parameters: { "title": "<title (min 3 chars)>", "description": "<detailed description (min 30 chars)>", "job_type": "full_time" | "contract" | "contract_to_hire", "hiring_type": "contract" | "one_time" | "c2c", "pay_period": "year" | "month" | "week" | "hour", "salary_currency": "INR", "pay_min": <optional number>, "pay_max": <optional number>, "status": "draft", "required_skills": ["..."], "locations": ["..."], "remote_type": "remote" | "hybrid" | "onsite", "experience_level": "entry" | "mid" | "senior" | "lead" | "executive" }
   CRITICAL: Always set "status": "draft".`,
    promptable: true,
    requiresConfirmation: true,
    metadata: {
      role: 'client',
      domain: 'hirepool'
    }
  },
  {
    name: 'consultancy:create_candidates_batch',
    title: 'Batch Create Agency Candidates',
    description: 'When an agency user confirms parsed candidates from an uploaded document.',
    parameters: {
      candidates: []
    },
    promptable: false,
    requiresConfirmation: true,
    metadata: {
      role: 'consultancy',
      domain: 'hirepool'
    }
  }
]);

export function registerLegacyHirePoolActions(registry) {
  if (!registry || typeof registry.registerMany !== 'function') {
    throw new TypeError('An action registry is required');
  }
  registry.tag = 'action:hirepool';
  registry.registerMany(HIREPOOL_ACTION_DEFINITIONS);
  return registry;
}
