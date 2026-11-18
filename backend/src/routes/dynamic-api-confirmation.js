import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  executeDynamicApiAction,
  executeApprovedDynamicApiConfirmation,
  cancelDynamicApiConfirmationWithContext,
  createRequestActionRegistry
} from '../dynamic-api/catalog.js';
import { ActionRegistry } from '../actions/registry.js';
import {
  getHirePoolApiAccessToken,
  getHirePoolContextBySessionId
} from '../local-integrations/hirepool-session-store.js';
import { sessionManager } from '../session-manager.js';
import { createSessionOptions } from '../session-scope.js';
import {
  HIREPOOL_PROFILE_SECTIONS,
  HIREPOOL_PROFILE_SECTION_LABELS
} from '../../../integrations/hirepool/candidate-profile-edit.js';
import {
  verifyCandidateProfileReadback,
  verifyProfileReadbackByOperationId
} from '../../../integrations/hirepool/profile-edit-shared.js';

export { verifyCandidateProfileReadback };

export const dynamicApiConfirmationRouter = Router();

function isVerifiedHirePoolUser(user) {
  if (
    user?.assistantId !== 'hirepool' ||
    user?.applicationId !== 'hirepool-local-app' ||
    !['candidate', 'client', 'consultancy'].includes(user?.role) ||
    typeof user?.integrationSessionId !== 'string'
  ) return false;

  const context = getHirePoolContextBySessionId(user.integrationSessionId);
  return Boolean(
    context &&
    context.identity.id === user.id &&
    context.identity.userType === user.role &&
    getHirePoolApiAccessToken(user)
  );
}

function getProfileReadOperationId(operationId) {
  const profileReadOperationIds = {
    'update_my_profile_api_v1_candidates_profile_put': 'get_my_profile_api_v1_candidates_profile_get',
    'update_company_profile_api_v1_clients_profile_put': 'get_my_company_profile_api_v1_clients_profile_get',
    'update_my_user_profile_api_v1_clients_me_put': 'get_my_user_profile_api_v1_clients_me_get',
    'update_consultancy_profile_api_v1_consultancies_profile_put': 'get_my_consultancy_profile_api_v1_consultancies_profile_get',
    'update_my_user_profile_api_v1_consultancies_me_put': 'get_my_user_profile_api_v1_consultancies_me_get'
  };
  return profileReadOperationIds[operationId] || null;
}

function resultMessage(actionDefinition, data) {
  const operationId = actionDefinition.metadata.dynamicApi.operationId;
  if (operationId === 'create_application_api_v1_applications_post') {
    if (typeof data?.id !== 'string' || typeof data?.status !== 'string') {
      throw new Error('HirePool returned an incomplete application response; verify application history before retrying.');
    }
    return `HirePool created application ${data.id} with current status "${data.status}".`;
  }
  if (operationId === 'withdraw_application_api_v1_applications__application_id__withdraw_post') {
    if (typeof data?.message !== 'string') {
      throw new Error('HirePool returned an incomplete withdrawal response.');
    }
    return data.message;
  }
  if (operationId === 'update_my_profile_api_v1_candidates_profile_put') {
    return data?.verificationStatus === 'verified'
      ? 'HirePool saved the profile update and a fresh profile read verified it.'
      : 'HirePool accepted the profile update, but I could not verify it with a fresh profile read. Retrieve your profile again before relying on the change.';
  }
  if (operationId === 'create_job_api_v1_jobs_post') {
    const jobTitle = data?.title || 'job';
    const jobIdInfo = data?.id ? ` (Job ID: ${data.id})` : '';
    return `Your ${jobTitle} job has been created successfully.${jobIdInfo}`;
  }
  if (operationId === 'add_candidate_api_v1_consultancies_candidates_post') {
    const candName = `${data?.first_name || ''} ${data?.last_name || ''}`.trim() || 'Candidate';
    const candIdInfo = data?.id ? ` (Candidate ID: ${data.id})` : '';
    return `${candName} has been added to your consultancy talent pool.${candIdInfo}`;
  }
  if (operationId === 'create_consultancy_application_api_v1_applications_consultancy_post') {
    const candName = data?.candidate_name ? ` for ${data.candidate_name}` : '';
    const jobTitle = data?.job_title ? ` to ${data.job_title}` : '';
    const appIdInfo = data?.id ? ` (Application ID: ${data.id})` : '';
    return `Candidate submission${candName}${jobTitle} was completed successfully${appIdInfo}. Current status: "${data?.status || 'applied'}".`;
  }
  if (operationId === 'update_company_profile_api_v1_clients_profile_put') {
    return data?.verificationStatus === 'verified'
      ? 'Your company profile has been updated successfully and verified in HirePool.'
      : 'HirePool accepted the company profile update, but I could not verify it with a fresh profile read. Retrieve your company profile again before relying on the change.';
  }
  if (
    operationId === 'update_my_user_profile_api_v1_clients_me_put' ||
    operationId === 'update_my_user_profile_api_v1_consultancies_me_put'
  ) {
    return data?.verificationStatus === 'verified'
      ? 'Your personal HirePool account profile has been updated and verified.'
      : 'HirePool accepted the personal profile update, but I could not verify it with a fresh read. Retrieve your account profile again before relying on the change.';
  }
  if (operationId === 'update_consultancy_profile_api_v1_consultancies_profile_put') {
    return data?.verificationStatus === 'verified'
      ? 'Your consultancy profile has been updated successfully and verified in HirePool.'
      : 'HirePool accepted the consultancy profile update, but I could not verify it with a fresh profile read. Retrieve your consultancy profile again before relying on the change.';
  }
  return `HirePool confirmed ${actionDefinition.metadata.dynamicApi.description || 'the requested update'}.`;
}

function errorResponse(error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
  if (error?.code === 'CONFIRMATION_INVALID_OR_EXPIRED' || error?.code === 'CONFIRMATION_EXPIRED') {
    return {
      statusCode: 410,
      code: 'CONFIRMATION_EXPIRED',
      message: 'This confirmation expired or is invalid. No write was attempted. Ask the assistant to re-check the requirements and prepare a fresh confirmation.'
    };
  }
  if (error?.code === 'ALREADY_EXECUTING') {
    return {
      statusCode: 409,
      code: 'ALREADY_EXECUTING',
      message: 'This operation is already executing. Please wait for the current request to complete.'
    };
  }
  if (/timed?\s*out|timeout/i.test(String(error?.message || ''))) {
    return {
      statusCode: 504,
      code: 'HIREPOOL_API_TIMEOUT',
      message: 'HirePool took too long to confirm the operation. The completion outcome could not be verified; check your dashboard before retrying.'
    };
  }
  if (statusCode === 401) {
    return {
      statusCode,
      message: 'Your HirePool session expired. Sign in again; no successful result was received.'
    };
  }
  if (statusCode >= 500) {
    return {
      statusCode: 502,
      message: `HirePool could not confirm the operation (HTTP ${statusCode}). Check your application history before retrying.`
    };
  }
  return {
    statusCode,
    message: typeof error?.message === 'string'
      ? error.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)
      : 'HirePool rejected the operation.'
  };
}

export async function executeAndVerifyProfileUpdate(actionDefinition, argumentsValue, user, {
  request,
  fetchSpec
} = {}) {
  const data = await executeDynamicApiAction(actionDefinition, argumentsValue, user, {
    approved: true,
    request
  });

  try {
    const registry = await createRequestActionRegistry(
      'hirepool',
      user,
      new ActionRegistry({ actions: [] }),
      { fetchSpec }
    );
    const readOperationId = getProfileReadOperationId(actionDefinition.metadata.dynamicApi.operationId);
    const profileAction = registry.list().find(action =>
      action.metadata?.dynamicApi?.operationId === readOperationId
    );
    if (!profileAction) {
      return {
        status: 'unverified',
        message: resultMessage(actionDefinition, { verificationStatus: 'unavailable' }),
        data
      };
    }
    const verifiedProfile = await executeDynamicApiAction(profileAction, {}, user, { request });
    const operationId = actionDefinition.metadata?.dynamicApi?.operationId;
    if (!verifyProfileReadbackByOperationId(operationId, argumentsValue?.body, verifiedProfile)) {
      return {
        status: 'unverified',
        message: resultMessage(actionDefinition, { verificationStatus: 'unavailable' }),
        data: { ...data, verifiedProfile, verificationStatus: 'mismatch' }
      };
    }
    return {
      status: 'success',
      message: resultMessage(actionDefinition, { verificationStatus: 'verified' }),
      data: { ...data, verifiedProfile, verificationStatus: 'verified' }
    };
  } catch (error) {
    console.warn(
      '[HirePool] Profile update succeeded, but fresh profile verification failed:',
      error?.message || 'verification unavailable'
    );
    return {
      status: 'unverified',
      message: resultMessage(actionDefinition, { verificationStatus: 'unavailable' }),
      data: { ...data, verificationStatus: 'unavailable' }
    };
  }
}

export async function executeAndVerifyJobCreation(actionDefinition, argumentsValue, user, {
  request,
  fetchSpec
} = {}) {
  const data = await executeDynamicApiAction(actionDefinition, argumentsValue, user, {
    approved: true,
    request
  });

  if (!data || !data.id) {
    return {
      status: 'unverified',
      message: 'HirePool job creation could not be verified by the server. Please check your jobs list.',
      data: { ...data, verificationStatus: 'unverified' }
    };
  }

  let verifiedJob = null;
  try {
    const registry = await createRequestActionRegistry(
      'hirepool',
      user,
      new ActionRegistry({ actions: [] }),
      { fetchSpec }
    );
    const jobReadAction = registry.list().find(action =>
      action.metadata?.dynamicApi?.operationId === 'get_job_api_v1_jobs__job_id__get' ||
      action.metadata?.dynamicApi?.operationId === 'get_my_jobs_api_v1_jobs_my_jobs_get'
    );
    if (jobReadAction) {
      const readParams = jobReadAction.metadata?.dynamicApi?.operationId === 'get_job_api_v1_jobs__job_id__get'
        ? { job_id: data.id }
        : {};
      verifiedJob = await executeDynamicApiAction(jobReadAction, readParams, user, { request });
    }
  } catch {}

  const jobTitle = data?.title || argumentsValue?.body?.title || 'job';
  return {
    status: 'success',
    message: `Your ${jobTitle} job has been created and verified in HirePool (Job ID: ${data.id}).`,
    data: { ...data, verifiedJob: verifiedJob || data, verificationStatus: 'verified' }
  };
}

export async function executeAndVerifyConsultancyCandidateAdd(actionDefinition, argumentsValue, user, {
  request,
  fetchSpec
} = {}) {
  const data = await executeDynamicApiAction(actionDefinition, argumentsValue, user, {
    approved: true,
    request
  });

  if (!data || !data.id) {
    return {
      status: 'unverified',
      message: 'HirePool candidate record could not be verified by the server. Please check your agency bench list.',
      data: { ...data, verificationStatus: 'unverified' }
    };
  }

  let verifiedCandidate = null;
  try {
    const registry = await createRequestActionRegistry(
      'hirepool',
      user,
      new ActionRegistry({ actions: [] }),
      { fetchSpec }
    );
    const candReadAction = registry.list().find(action =>
      action.metadata?.dynamicApi?.operationId === 'get_candidate_api_v1_consultancies_candidates__candidate_id__get' ||
      action.metadata?.dynamicApi?.operationId === 'list_candidates_api_v1_consultancies_candidates_get'
    );
    if (candReadAction) {
      const readParams = candReadAction.metadata?.dynamicApi?.operationId === 'get_candidate_api_v1_consultancies_candidates__candidate_id__get'
        ? { candidate_id: data.id }
        : { query: { query: data.email || data.first_name } };
      verifiedCandidate = await executeDynamicApiAction(candReadAction, readParams, user, { request });
    }
  } catch {}

  const candName = data?.full_name ||
    `${data?.first_name || ''} ${data?.last_name || ''}`.trim() ||
    `${argumentsValue?.body?.first_name || ''} ${argumentsValue?.body?.last_name || ''}`.trim() ||
    'Candidate';
  const candIdInfo = data?.id ? ` (Candidate ID: ${data.id})` : '';
  return {
    status: 'success',
    message: `${candName} has been added to your consultancy talent pool.${candIdInfo}`,
    data: { ...data, verifiedCandidate: verifiedCandidate || data, verificationStatus: 'verified' }
  };
}

export async function executeAndVerifyConsultancySubmission(actionDefinition, argumentsValue, user, {
  request,
  fetchSpec
} = {}) {
  const data = await executeDynamicApiAction(actionDefinition, argumentsValue, user, {
    approved: true,
    request
  });

  if (!data || !data.id) {
    return {
      status: 'unverified',
      message: 'HirePool candidate submission could not be verified by the server.',
      data: { ...data, verificationStatus: 'unverified' }
    };
  }

  let verifiedSubmission = null;
  try {
    const registry = await createRequestActionRegistry(
      'hirepool',
      user,
      new ActionRegistry({ actions: [] }),
      { fetchSpec }
    );
    const subReadAction = registry.list().find(action =>
      action.metadata?.dynamicApi?.operationId === 'get_consultancy_submissions_api_v1_applications_for_consultancy_get'
    );
    if (subReadAction) {
      const readParams = {
        query: {
          application_id: data.id
        }
      };
      verifiedSubmission = await executeDynamicApiAction(subReadAction, readParams, user, { request });
    }
  } catch {}

  const candName = data?.candidate_name ? ` for ${data.candidate_name}` : '';
  const jobTitle = data?.job_title ? ` to ${data.job_title}` : '';
  return {
    status: 'success',
    message: `Candidate submission${candName}${jobTitle} was completed successfully (Application ID: ${data.id}, Status: "${data.status || 'applied'}").`,
    data: { ...data, verifiedSubmission: verifiedSubmission || data, verificationStatus: 'verified' }
  };
}

dynamicApiConfirmationRouter.post('/cancel', authenticate(), async (req, res) => {
  const user = req.user;
  if (!isVerifiedHirePoolUser(user)) {
    return res.status(401).json({
      error: { code: 'EXPIRED_SESSION', message: 'A verified HirePool session is required to cancel this action.' }
    });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'confirmationToken') ||
      typeof body.confirmationToken !== 'string') {
    return res.status(400).json({
      error: { code: 'INVALID_CONFIRMATION', message: 'A valid action confirmation is required.' }
    });
  }
  const cancelCtx = cancelDynamicApiConfirmationWithContext(body.confirmationToken, user);
  if (!cancelCtx.cancelled) {
    return res.status(409).json({
      error: { code: 'CONFIRMATION_NOT_PENDING', message: 'This action is no longer pending and was not cancelled.' }
    });
  }
  if (cancelCtx.conversationId && getProfileReadOperationId(cancelCtx.operationId)) {
    sessionManager.setProfileEditState(cancelCtx.conversationId, previous => (
      previous
        ? {
            ...previous,
            active: false,
            stage: 'cancelled',
            draftData: {},
            validationState: { valid: true, errors: {} },
            pendingConfirmation: false,
            confirmationToken: null,
            confirmationPayload: null,
            updatedAt: new Date().toISOString()
          }
        : null
    ), createSessionOptions(user, 'hirepool'));
    const currentSession = sessionManager.getSession(cancelCtx.conversationId, createSessionOptions(user, 'hirepool'));
    if (currentSession?.hirePoolJobCreate) {
      currentSession.hirePoolJobCreate = {
        active: false,
        stage: 'cancelled',
        jobData: null,
        confirmationToken: null,
        updatedAt: new Date().toISOString()
      };
    }
    if (currentSession?.consultancyCandidateDraft) {
      currentSession.consultancyCandidateDraft = null;
    }
    if (currentSession?.consultancySubmissionDraft) {
      currentSession.consultancySubmissionDraft = null;
    }
  }
  return res.json({ status: 'cancelled' });
});

dynamicApiConfirmationRouter.post('/', authenticate(), async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'A verified HirePool session is required.' } });
  }
  if (!['candidate', 'client', 'consultancy'].includes(user.role)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only HirePool candidate, client, and consultancy sessions can confirm this operation.' } });
  }
  if (!isVerifiedHirePoolUser(user)) {
    return res.status(401).json({ error: { code: 'EXPIRED_SESSION', message: 'The verified HirePool session is no longer available.' } });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'confirmationToken') ||
      typeof body.confirmationToken !== 'string') {
    return res.status(400).json({ error: { code: 'INVALID_CONFIRMATION', message: 'A valid action confirmation is required.' } });
  }

  try {
    const result = await executeApprovedDynamicApiConfirmation(
      body.confirmationToken,
      user,
      async (actionDefinition, argumentsValue) => {
        if (getProfileReadOperationId(actionDefinition.metadata.dynamicApi.operationId)) {
          return executeAndVerifyProfileUpdate(actionDefinition, argumentsValue, user);
        }
        if (actionDefinition.metadata?.dynamicApi?.operationId === 'create_job_api_v1_jobs_post') {
          return executeAndVerifyJobCreation(actionDefinition, argumentsValue, user);
        }
        if (actionDefinition.metadata?.dynamicApi?.operationId === 'add_candidate_api_v1_consultancies_candidates_post') {
          return executeAndVerifyConsultancyCandidateAdd(actionDefinition, argumentsValue, user);
        }
        if (actionDefinition.metadata?.dynamicApi?.operationId === 'create_consultancy_application_api_v1_applications_consultancy_post') {
          return executeAndVerifyConsultancySubmission(actionDefinition, argumentsValue, user);
        }
        const data = await executeDynamicApiAction(actionDefinition, argumentsValue, user, { approved: true });
        return {
          status: 'success',
          message: resultMessage(actionDefinition, data),
          data
        };
      },
      {
        onSuccess: ({ actionDefinition, argumentsValue, conversationId, result: executionResult }) => {
          const operationId = actionDefinition.metadata?.dynamicApi?.operationId;
          if (!conversationId || executionResult?.status !== 'success') return;

          if (operationId === 'update_my_profile_api_v1_candidates_profile_put') {
            const body = argumentsValue?.body || {};
            const updatedSections = [];
            if (Array.isArray(body.education)) updatedSections.push(HIREPOOL_PROFILE_SECTIONS.EDUCATION);
            if (Array.isArray(body.work_experience)) updatedSections.push(HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE);
            if (Array.isArray(body.certifications)) updatedSections.push(HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS);
            if (typeof body.professional_summary === 'string') updatedSections.push(HIREPOOL_PROFILE_SECTIONS.PROFESSIONAL_SUMMARY);
            if (Array.isArray(body.skills)) updatedSections.push(HIREPOOL_PROFILE_SECTIONS.SKILLS);
            if (
              Array.isArray(body.preferred_work_types) ||
              Array.isArray(body.preferred_job_types) ||
              Number.isFinite(body.expected_salary_min) ||
              Number.isFinite(body.expected_salary_max) ||
              typeof body.salary_currency === 'string' ||
              Number.isFinite(body.notice_period_days) ||
              typeof body.is_open_to_work === 'boolean'
            ) {
              updatedSections.push(HIREPOOL_PROFILE_SECTIONS.PREFERENCES);
            }
            if (
              Object.hasOwn(body, 'linkedin_url') ||
              Object.hasOwn(body, 'github_url') ||
              Object.hasOwn(body, 'portfolio_url') ||
              Object.hasOwn(body, 'personal_website')
            ) {
              updatedSections.push(HIREPOOL_PROFILE_SECTIONS.LINKS);
            }
            if (
              Object.hasOwn(body, 'first_name') ||
              Object.hasOwn(body, 'last_name') ||
              Object.hasOwn(body, 'phone') ||
              Object.hasOwn(body, 'current_location') ||
              Object.hasOwn(body, 'job_title') ||
              Object.hasOwn(body, 'years_of_experience') ||
              Object.hasOwn(body, 'months_of_experience')
            ) {
              updatedSections.push(HIREPOOL_PROFILE_SECTIONS.BASIC_INFO);
            }

            let nextQueuedSection = null;
            sessionManager.setProfileEditState(conversationId, previous => {
              if (!previous) return null;
              const prevPending = Array.isArray(previous.pendingSections) ? previous.pendingSections : [];
              const prevCompleted = Array.isArray(previous.completedSections) ? previous.completedSections : [];
              const remaining = prevPending.filter(s => !updatedSections.includes(s));
              const completed = [...new Set([...prevCompleted, ...updatedSections])];
              if (remaining.length > 0) {
                nextQueuedSection = remaining[0];
                return {
                  ...previous,
                  active: true,
                  stage: 'between_sections',
                  selectedSection: nextQueuedSection,
                  pendingSections: remaining,
                  completedSections: completed,
                  operation: 'add',
                  targetIndex: null,
                  draftData: {},
                  validationState: { valid: true, errors: {} },
                  pendingConfirmation: false,
                  confirmationToken: null,
                  confirmationPayload: null,
                  updatedAt: new Date().toISOString()
                };
              }
              return {
                ...previous,
                active: false,
                stage: 'completed',
                selectedSection: null,
                pendingSections: [],
                completedSections: completed,
                draftData: {},
                validationState: { valid: true, errors: {} },
                pendingConfirmation: false,
                confirmationToken: null,
                confirmationPayload: null,
                updatedAt: new Date().toISOString()
              };
            }, createSessionOptions(user, 'hirepool'));

            if (nextQueuedSection && executionResult?.data?.verificationStatus === 'verified') {
              const nextLabel = HIREPOOL_PROFILE_SECTION_LABELS[nextQueuedSection] || nextQueuedSection;
              executionResult.message = `${executionResult.message} Reply "Continue" when you are ready for ${nextLabel}.`;
              executionResult.data.nextSection = nextQueuedSection;
              executionResult.data.nextSectionLabel = nextLabel;
            }
            return;
          }

          if (getProfileReadOperationId(operationId)) {
            sessionManager.setProfileEditState(conversationId, previous => {
              if (!previous) return null;
              const prevCompleted = Array.isArray(previous.completedSections) ? previous.completedSections : [];
              const sec = previous.selectedSection;
              return {
                ...previous,
                active: false,
                stage: 'completed',
                selectedSection: null,
                pendingSections: [],
                completedSections: sec ? [...new Set([...prevCompleted, sec])] : prevCompleted,
                draftData: {},
                validationState: { valid: true, errors: {} },
                pendingConfirmation: false,
                confirmationToken: null,
                confirmationPayload: null,
                updatedAt: new Date().toISOString()
              };
            }, createSessionOptions(user, 'hirepool'));
            return;
          }

          if (operationId === 'create_job_api_v1_jobs_post') {
            const currentSession = sessionManager.getSession(conversationId, createSessionOptions(user, 'hirepool'));
            if (currentSession) {
              currentSession.hirePoolJobCreate = {
                active: false,
                stage: 'completed',
                jobData: null,
                confirmationToken: null,
                updatedAt: new Date().toISOString()
              };
            }
            return;
          }

          if (operationId === 'add_candidate_api_v1_consultancies_candidates_post') {
            const currentSession = sessionManager.getSession(conversationId, createSessionOptions(user, 'hirepool'));
            if (currentSession) {
              currentSession.consultancyCandidateDraft = null;
            }
            return;
          }

          if (operationId === 'create_consultancy_application_api_v1_applications_consultancy_post') {
            const currentSession = sessionManager.getSession(conversationId, createSessionOptions(user, 'hirepool'));
            if (currentSession) {
              currentSession.consultancySubmissionDraft = null;
            }
            return;
          }

          if (
            operationId !== 'create_application_api_v1_applications_post' ||
            typeof executionResult.data?.id !== 'string' ||
            typeof executionResult.data?.status !== 'string'
          ) return;
          const updated = sessionManager.setWorkflowState(conversationId, previous => {
            const submittedJobId = argumentsValue.body?.job_id;
            const prevShortlist = Array.isArray(previous?.shortlist) ? previous.shortlist : [];
            const nextShortlist = prevShortlist.map(item =>
              item?.id === submittedJobId
                ? {
                  ...item,
                  applicationStatus: executionResult.data.status,
                  applicationId: executionResult.data.id
                }
                : item
            );
            return {
              ...(previous || {}),
              stage: 'APPLICATION_SUBMITTED',
              shortlist: nextShortlist,
              selectedJob: {
                ...(previous?.selectedJob || {}),
                id: submittedJobId,
                title: executionResult.data.job_title || previous?.selectedJob?.title || null,
                company: executionResult.data.company_name || previous?.selectedJob?.company || null,
                applicationStatus: executionResult.data.status,
                applicationId: executionResult.data.id
              }
            };
          }, createSessionOptions(user, 'hirepool'));
          if (!updated) {
            console.warn('[HirePool] Application succeeded, but its conversation workflow session is unavailable.');
          }
        }
      }
    );
    return res.json(result);
  } catch (error) {
    const response = errorResponse(error);
    return res.status(response.statusCode).json({
      error: {
        code: error?.code || 'DYNAMIC_API_CONFIRMATION_FAILED',
        message: response.message
      }
    });
  }
});
