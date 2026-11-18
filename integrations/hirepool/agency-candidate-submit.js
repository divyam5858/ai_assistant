/**
 * HirePool Consultancy Agency Candidate Submission Workflow
 *
 * Implements conversational multi-turn candidate submission from the Consultancy bench
 * to eligible HirePool job openings via POST /api/v1/applications/consultancy.
 * Enforces candidate ownership, duplicate checks, review, and explicit confirmation.
 */

const CANCEL_PATTERN = /^\s*(?:cancel|discard|abort|never\s*mind|stop)(?:\s+(?:submission|submitting|candidate\s+submission))?\s*$/i;

const CONFIRM_PATTERN = /^\s*(?:(?:please\s+)?(?:submit|send|apply|confirm)\s+(?:the\s+|this\s+)?candidate|confirm(?:\s+and\s+execute)?|looks?\s+good|submit\s+it|send\s+it|proceed|yes)\b[.!?]*$/i;

const SUBMISSION_TRIGGER_PATTERN = /\b(?:submit\s+(?:a\s+)?candidate|submit\s+[A-Za-z\s.'-]+?\s+(?:for|to)\b|submit\s+(?:this\s+)?candidate\s+to\b|apply\s+(?:for\s+)?(?:this\s+)?candidate|candidate\s+submission)\b/i;

export function isHirePoolAgencyCandidateSubmitIntent(message, session, authUser) {
  if (authUser && authUser.role !== 'consultancy') return false;
  const text = String(message || '').trim();
  if (!text) return false;

  if (session?.consultancySubmissionDraft?.active) {
    if (/\b(?:dashboard|agency\s+profile|consultancy\s+profile|my\s+profile|logout)\b/i.test(text) &&
        !/\b(?:submit|candidate|job|role|proceed|confirm|yes)\b/i.test(text)) {
      return false;
    }
    return true;
  }

  if (SUBMISSION_TRIGGER_PATTERN.test(text)) return true;

  // Labeled message for candidate submission
  if (/^\s*(?:candidate\s+submission|submit\s+candidate)\s*[:=\-–—]/i.test(text)) return true;

  return false;
}

export function extractSubmissionIntentDetails(message) {
  const text = String(message || '').trim();
  let candidateName = null;
  let jobTitleOrId = null;

  // 1. "Submit Rahul Sharma for Full Stack Developer role"
  const forMatch = text.match(/\bsubmit\s+([A-Za-z\s.'-]+?)\s+(?:for|to)\s+(?:the\s+)?(?:job\s+|role\s+|position\s+|opening\s+)?([A-Za-z0-9\s.+#&-]{3,60}?)(?=[.!?]|$|\bwith\b)/i);
  if (forMatch) {
    candidateName = forMatch[1].trim().replace(/^candidate\s+/i, '').trim();
    jobTitleOrId = forMatch[2].trim().replace(/\s+(?:role|position|opening|job)$/i, '').trim();
  }

  // 2. Labeled extraction
  if (!candidateName) {
    const candMatch = text.match(/(?:^|\n|[;,])\s*candidate(?:\s+name)?\s*(?:[:=]|\s*[-–—]\s+|\s+(?:is|to|as)\s+)\s*([^,;\n]+)/i);
    if (candMatch) candidateName = candMatch[1].trim();
  }

  if (!jobTitleOrId) {
    const jobMatch = text.match(/(?:^|\n|[;,])\s*(?:target\s+)?(?:job|opening|role)(?:\s+title|\s+id)?\s*(?:[:=]|\s*[-–—]\s+|\s+(?:is|to|as)\s+)\s*([^,;\n]+)/i);
    if (jobMatch) jobTitleOrId = jobMatch[1].trim();
  }

  // 3. Fallback candidate name extraction after "submit"
  if (!candidateName) {
    const simpleSubmit = text.match(/\bsubmit\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
    if (simpleSubmit && !/^(?:a|the|this|my|our|candidate|candidates)$/i.test(simpleSubmit[1])) {
      candidateName = simpleSubmit[1].trim();
    }
  }

  return { candidateName, jobTitleOrId };
}

export async function handleHirePoolAgencyCandidateSubmitTurn(
  optionsOrMessage,
  sessionParam,
  registryParam,
  authUserParam,
  executeActionParam
) {
  const opts = typeof optionsOrMessage === 'object' && optionsOrMessage !== null && !Array.isArray(optionsOrMessage) && 'session' in optionsOrMessage
    ? optionsOrMessage
    : {
        message: optionsOrMessage,
        session: sessionParam,
        registry: registryParam,
        authUser: authUserParam,
        executeAction: executeActionParam
      };

  const {
    message,
    session,
    registry,
    authUser,
    executeAction,
    stageCandidateSubmitConfirmation,
    cancelConfirmation
  } = opts;

  const text = String(message || '').trim();

  // 1. Cancellation
  if (CANCEL_PATTERN.test(text)) {
    if (session?.consultancySubmissionDraft?.confirmationToken && cancelConfirmation) {
      try {
        await cancelConfirmation(session.consultancySubmissionDraft.confirmationToken);
      } catch {}
    }
    session.consultancySubmissionDraft = null;
    return {
      handled: true,
      text: 'I have cancelled the candidate submission. No application was submitted to HirePool.'
    };
  }

  // 2. If awaiting confirmation and user affirms
  if (session?.consultancySubmissionDraft?.stage === 'awaiting_confirmation') {
    if (CONFIRM_PATTERN.test(text)) {
      return {
        handled: true,
        text: 'Please click the **Confirm & Execute** button on the candidate submission card above to finalize submitting this candidate to the job opening.',
        hostAction: session.consultancySubmissionDraft.hostAction
      };
    }
  }

  const draft = session?.consultancySubmissionDraft || {
    active: true,
    candidate: null,
    job: null,
    coverNote: null
  };

  // Check candidate disambiguation response first
  if (!draft.candidate && draft.candidateChoices && draft.stage === 'disambiguate_candidate') {
    const choiceNum = Number.parseInt(text.trim(), 10);
    if (!Number.isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= draft.candidateChoices.length) {
      draft.candidate = draft.candidateChoices[choiceNum - 1];
    } else {
      const lower = text.trim().toLowerCase();
      const matchById = draft.candidateChoices.find(c =>
        c.id === text.trim() ||
        c.email?.toLowerCase() === lower ||
        `${c.first_name} ${c.last_name}`.toLowerCase() === lower
      );
      if (matchById) draft.candidate = matchById;
    }
    if (!draft.candidate) {
      return {
        handled: true,
        text: 'Please choose one of the listed candidates by typing their number or candidate ID.'
      };
    }
    draft.candidateChoices = null;
    draft.candidateQuery = null;
    draft.stage = null;
  }

  // Check candidate choice from awaiting_candidate list
  if (!draft.candidate && draft.availableCandidateChoices && draft.stage === 'awaiting_candidate') {
    const choiceNum = Number.parseInt(text.trim(), 10);
    if (!Number.isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= draft.availableCandidateChoices.length) {
      draft.candidate = draft.availableCandidateChoices[choiceNum - 1];
      draft.availableCandidateChoices = null;
      draft.stage = null;
    }
  }

  // Check job disambiguation response first
  if (!draft.job && draft.jobChoices && draft.stage === 'disambiguate_job') {
    const choiceNum = Number.parseInt(text.trim(), 10);
    if (!Number.isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= draft.jobChoices.length) {
      draft.job = draft.jobChoices[choiceNum - 1];
    } else {
      const lower = text.trim().toLowerCase();
      const matchById = draft.jobChoices.find(j =>
        j.id === text.trim() ||
        j.title?.toLowerCase() === lower
      );
      if (matchById) draft.job = matchById;
    }
    if (!draft.job) {
      return {
        handled: true,
        text: 'Please choose one of the listed jobs by typing its number or Job ID.'
      };
    }
    draft.jobChoices = null;
    draft.jobQuery = null;
    draft.stage = null;
  }

  // Check job choice from awaiting_job list
  if (!draft.job && draft.availableJobChoices && draft.stage === 'awaiting_job') {
    const choiceNum = Number.parseInt(text.trim(), 10);
    if (!Number.isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= draft.availableJobChoices.length) {
      draft.job = draft.availableJobChoices[choiceNum - 1];
      draft.availableJobChoices = null;
      draft.stage = null;
    }
  }

  const extracted = extractSubmissionIntentDetails(text);
  const targetCandidateQuery = draft.candidate ? null : (extracted.candidateName || draft.candidateQuery || null);
  let targetJobQuery = draft.job ? null : (extracted.jobTitleOrId || draft.jobQuery || null);
  if (targetJobQuery) {
    targetJobQuery = targetJobQuery.replace(/\s+(?:role|position|opening|job)$/i, '').trim();
  }

  // Step 1: Resolve Candidate if not yet selected
  if (!draft.candidate) {
    if (!targetCandidateQuery) {
      // List available bench candidates to let user pick
      const listAction = registry?.list()?.find(a =>
        a.metadata?.dynamicApi?.operationId === 'list_candidates_api_v1_consultancies_candidates_get'
      );
      let candidatesList = [];
      if (listAction && executeAction) {
        try {
          const res = await executeAction(listAction, { query: { page: 1, page_size: 20 } });
          candidatesList = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
        } catch {}
      }

      session.consultancySubmissionDraft = {
        ...draft,
        active: true,
        stage: 'awaiting_candidate',
        availableCandidateChoices: candidatesList,
        jobQuery: targetJobQuery
      };

      if (candidatesList.length === 0) {
        return {
          handled: true,
          text: 'To submit a candidate, you need at least one candidate record on your agency bench.\n\nWould you like to **add a candidate to your bench** first? Just say "Add a candidate".'
        };
      }

      const options = candidatesList.slice(0, 5).map((c, i) =>
        `${i + 1}. **${c.first_name} ${c.last_name}** — ${c.job_title || 'Specialist'} (${c.current_location || 'Location not specified'})`
      );

      return {
        handled: true,
        text: `Which candidate from your agency bench would you like to submit? You can specify their name:\n\n${options.join('\n')}`
      };
    }

    // Candidate query was provided: search bench
    const listAction = registry?.list()?.find(a =>
      a.metadata?.dynamicApi?.operationId === 'list_candidates_api_v1_consultancies_candidates_get'
    );
    let matchedCandidates = [];
    if (listAction && executeAction) {
      try {
        const res = await executeAction(listAction, { query: { query: targetCandidateQuery, page: 1, page_size: 10 } });
        matchedCandidates = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      } catch {}
    }

    if (matchedCandidates.length === 0 && listAction && executeAction) {
      try {
        const resAll = await executeAction(listAction, { query: { page: 1, page_size: 50 } });
        const all = Array.isArray(resAll?.items) ? resAll.items : [];
        const lowerQ = targetCandidateQuery.toLowerCase();
        matchedCandidates = all.filter(c =>
          `${c.first_name} ${c.last_name}`.toLowerCase().includes(lowerQ) ||
          (c.first_name && c.first_name.toLowerCase().includes(lowerQ)) ||
          (c.last_name && c.last_name.toLowerCase().includes(lowerQ))
        );
      } catch {}
    }

    if (matchedCandidates.length === 0) {
      return {
        handled: true,
        text: `I couldn't find a candidate matching "${targetCandidateQuery}" in your agency bench. Please verify the candidate's name or say "View my bench candidates" to check your bench roster.`
      };
    }

    if (matchedCandidates.length > 1) {
      // Disambiguate
      const list = matchedCandidates.map((c, i) =>
        `${i + 1}. **${c.first_name} ${c.last_name}** (Email: ${c.email}, Role: ${c.job_title || 'Specialist'}, ID: \`${c.id}\`)`
      );
      session.consultancySubmissionDraft = {
        ...draft,
        active: true,
        candidateQuery: targetCandidateQuery,
        candidateChoices: matchedCandidates,
        jobQuery: targetJobQuery,
        stage: 'disambiguate_candidate'
      };
      return {
        handled: true,
        text: `I found multiple candidates matching "${targetCandidateQuery}" in your bench. Please specify which candidate you want to submit:\n\n${list.join('\n')}`
      };
    }

    // Exact single match found!
    draft.candidate = matchedCandidates[0];
  }

  // Step 2: Resolve Job if not yet selected
  if (!draft.job) {
    if (!targetJobQuery) {
      let openJobs = [];
      const searchAction = registry?.list()?.find(a =>
        a.metadata?.dynamicApi?.operationId === 'search_jobs_api_v1_jobs_search_get' ||
        a.metadata?.dynamicApi?.operationId === 'get_matching_jobs_api_v1_matching_jobs_get'
      );
      if (searchAction && executeAction) {
        try {
          const res = await executeAction(searchAction, { query: { page: 1, page_size: 10 } });
          openJobs = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
        } catch {}
      }

      session.consultancySubmissionDraft = {
        ...draft,
        active: true,
        candidate: draft.candidate,
        stage: 'awaiting_job',
        availableJobChoices: openJobs
      };

      const candName = draft.candidate.full_name || `${draft.candidate.first_name || ''} ${draft.candidate.last_name || ''}`.trim() || 'Candidate';
      const candFirstName = draft.candidate.first_name || candName;
      if (openJobs.length === 0) {
        return {
          handled: true,
          text: `Selected candidate: **${candName}** (${draft.candidate.job_title || 'Specialist'}).\n\nWhich job opening would you like to submit ${candFirstName} for? Please specify the job title or Job ID.`
        };
      }

      const jobOptions = openJobs.slice(0, 5).map((j, i) =>
        `${i + 1}. **${j.title}** ${j.company_name ? `at ${j.company_name}` : ''} (ID: \`${j.id}\`, Work mode: ${j.remote_type || j.work_type || 'General'})`
      );

      return {
        handled: true,
        text: `Selected candidate: **${candName}** (${draft.candidate.job_title || 'Specialist'}).\n\nPlease select the job opening you want to submit them to:\n\n${jobOptions.join('\n')}\n\nYou can reply with the job title or number.`
      };
    }

    // Job query provided: search jobs
    let matchedJobs = [];
    const searchAction = registry?.list()?.find(a =>
      a.metadata?.dynamicApi?.operationId === 'search_jobs_api_v1_jobs_search_get'
    );
    if (searchAction && executeAction) {
      try {
        const res = await executeAction(searchAction, { query: { query: targetJobQuery, page: 1, page_size: 10 } });
        matchedJobs = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      } catch {}
    }

    // Try finding by exact Job ID
    if (matchedJobs.length === 0 && /^[0-9a-f-]{36}$/i.test(targetJobQuery.trim())) {
      const getJobAction = registry?.list()?.find(a =>
        a.metadata?.dynamicApi?.operationId === 'get_job_api_v1_jobs__job_id__get'
      );
      if (getJobAction && executeAction) {
        try {
          const res = await executeAction(getJobAction, { path: { job_id: targetJobQuery.trim() } });
          if (res?.id) matchedJobs = [res];
        } catch {}
      }
    }

    if (matchedJobs.length === 0) {
      return {
        handled: true,
        text: `I could not find an active HirePool job opening matching "${targetJobQuery}". Please verify the job title or provide a valid Job ID.`
      };
    }

    if (matchedJobs.length > 1) {
      const list = matchedJobs.map((j, i) =>
        `${i + 1}. **${j.title}** ${j.company_name ? `at ${j.company_name}` : ''} (ID: \`${j.id}\`)`
      );
      session.consultancySubmissionDraft = {
        ...draft,
        active: true,
        candidate: draft.candidate,
        jobQuery: targetJobQuery,
        jobChoices: matchedJobs,
        stage: 'disambiguate_job'
      };
      const candFirstName = draft.candidate.first_name || draft.candidate.full_name || 'the candidate';
      return {
        handled: true,
        text: `Multiple active jobs match "${targetJobQuery}". Which one would you like to submit ${candFirstName} for?\n\n${list.join('\n')}`
      };
    }

    draft.job = matchedJobs[0];
  }

  // Step 3: Check for duplicate submission
  const submissionsAction = registry?.list()?.find(a =>
    a.metadata?.dynamicApi?.operationId === 'get_consultancy_submissions_api_v1_applications_for_consultancy_get'
  );
  if (submissionsAction && executeAction) {
    try {
      const checkRes = await executeAction(submissionsAction, {
        query: {
          job_id: draft.job.id,
          candidate_id: draft.candidate.id
        }
      });
      const existing = Array.isArray(checkRes?.items) ? checkRes.items : (Array.isArray(checkRes) ? checkRes : []);
      if (existing.length > 0) {
        const app = existing[0];
        const candDupName = draft.candidate.full_name || `${draft.candidate.first_name || ''} ${draft.candidate.last_name || ''}`.trim() || 'Candidate';
        session.consultancySubmissionDraft = null;
        return {
          handled: true,
          text: `**${candDupName}** has already been submitted to **${draft.job.title}** (Application ID: \`${app.id}\`, Status: **${app.status || 'applied'}**). HirePool does not accept duplicate submissions for the same job opening.`
        };
      }
    } catch {}
  }

  // Step 4: Display complete review & Stage explicit confirmation
  const candName = draft.candidate.full_name || `${draft.candidate.first_name || ''} ${draft.candidate.last_name || ''}`.trim() || 'Candidate';
  const jobTitle = draft.job.title || 'Selected Opening';
  const companyName = draft.job.company_name || 'HirePool Client Employer';
  const location = draft.job.locations ? (Array.isArray(draft.job.locations) ? draft.job.locations.join(', ') : draft.job.locations) : (draft.job.remote_type || 'General');

  const coverNote = draft.coverNote || `Candidate submitted from agency bench by ${authUser?.email || 'Consultancy'}.`;

  const submissionPayload = {
    job_id: draft.job.id,
    consultancy_candidate_id: draft.candidate.id,
    consultancy_cover_note: coverNote
  };

  let staged = null;
  if (typeof stageCandidateSubmitConfirmation === 'function') {
    try {
      staged = await stageCandidateSubmitConfirmation({ body: submissionPayload });
    } catch (err) {
      return {
        handled: true,
        text: `I could not stage the candidate submission: ${err?.message || 'Verification failed.'}`
      };
    }
  }

  session.consultancySubmissionDraft = {
    active: true,
    stage: 'awaiting_confirmation',
    candidate: draft.candidate,
    job: draft.job,
    coverNote,
    confirmationToken: staged?.hostAction?.confirmationToken || null,
    hostAction: staged?.hostAction || null,
    pendingConfirmation: true,
    updatedAt: new Date().toISOString()
  };

  const reviewLines = [
    '### Review Candidate Submission Details',
    'Please review the candidate and job opening details before submitting to HirePool:',
    '',
    `- **Candidate:** ${candName} (${draft.candidate.job_title || 'Specialist'})`,
    `- **Candidate Email:** ${draft.candidate.email}`,
    `- **Candidate Experience:** ${draft.candidate.years_of_experience || 0} years`,
    `- **Target Job:** ${jobTitle}`,
    `- **Company:** ${companyName}`,
    `- **Job Location:** ${location}`,
    `- **Submission Note:** ${coverNote}`,
    '',
    'Click **Confirm & Execute** below to submit this candidate to the job opening.'
  ];

  const response = {
    handled: true,
    text: reviewLines.join('\n')
  };

  if (staged?.hostAction) {
    response.hostAction = staged.hostAction;
  } else if (registry) {
    const submitAction = registry.list()?.find(a =>
      a.metadata?.dynamicApi?.operationId === 'create_consultancy_application_api_v1_applications_consultancy_post'
    );
    if (submitAction) {
      response.action = {
        name: submitAction.name,
        description: 'Submit candidate to job opening',
        arguments: {
          body: submissionPayload
        }
      };
    }
  }

  return response;
}
