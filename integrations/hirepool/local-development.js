import {
  getHirePoolApiAccessToken,
  getHirePoolValidAccessToken
} from '../../backend/src/local-integrations/hirepool-session-store.js';
import {
  validateJobCreation,
  validateCandidateCreation
} from '../../backend/src/dynamic-api/schemas/hirepool-schemas.js';
import {
  validateCandidateProfileUpdatePayload,
  mergeCandidateProfileUpdate,
  formatCandidateProfileReview
} from './candidate-profile-edit.js';
import {
  HIREPOOL_PROFILE_TYPES,
  validateClientProfileUpdatePayload,
  validateConsultancyProfileUpdatePayload,
  validateOrgUserProfileUpdatePayload,
  formatRoleProfileReview
} from './profile-edit-shared.js';
import {
  getDynamicApiIntegration,
  registerDynamicApiIntegration
} from '../../backend/src/dynamic-api/catalog.js';

export const HIREPOOL_LOCAL_INTEGRATION_ID = 'hirepool-local-development';
export const HIREPOOL_LOCAL_ASSISTANT_ID = 'hirepool';
export const HIREPOOL_LOCAL_APPLICATION_ID = 'hirepool-local-app';

const roleOperationIds = Object.freeze({
  candidate: Object.freeze([
    'get_my_profile_api_v1_candidates_profile_get',
    'update_my_profile_api_v1_candidates_profile_put',
    'search_jobs_api_v1_jobs_search_get',
    'get_matching_jobs_api_v1_matching_jobs_get',
    'get_job_api_v1_jobs__job_id__get',
    'get_screening_questions_for_candidate_api_v1_jobs__job_id__screening_questions_for_candidate_get',
    'check_screening_eligibility_api_v1_applications_screening_eligibility__job_id__get',
    'get_my_applications_api_v1_applications_my_applications_get',
    'create_application_api_v1_applications_post',
    'withdraw_application_api_v1_applications__application_id__withdraw_post'
  ]),
  client: Object.freeze([
    'get_my_company_profile_api_v1_clients_profile_get',
    'update_company_profile_api_v1_clients_profile_put',
    'get_my_user_profile_api_v1_clients_me_get',
    'update_my_user_profile_api_v1_clients_me_put',
    'get_dashboard_stats_api_v1_clients_dashboard_get',
    'get_my_jobs_api_v1_jobs_my_jobs_get',
    'create_job_api_v1_jobs_post',
    'update_job_api_v1_jobs__job_id__put',
    'get_job_api_v1_jobs__job_id__get',
    'get_job_applications_api_v1_applications_job__job_id__get',
    'get_client_applications_api_v1_applications_for_client_get',
    'get_matching_candidates_api_v1_matching_candidates__job_id__get',
    'bulk_update_status_api_v1_applications_bulk_status_post'
  ]),
  consultancy: Object.freeze([
    'get_my_consultancy_profile_api_v1_consultancies_profile_get',
    'update_consultancy_profile_api_v1_consultancies_profile_put',
    'get_my_user_profile_api_v1_consultancies_me_get',
    'update_my_user_profile_api_v1_consultancies_me_put',
    'get_dashboard_stats_api_v1_consultancies_dashboard_get',
    'list_candidates_api_v1_consultancies_candidates_get',
    'add_candidate_api_v1_consultancies_candidates_post',
    'update_candidate_api_v1_consultancies_candidates__candidate_id__put',
    'get_matching_candidates_for_job_api_v1_consultancies_candidates_matching_get',
    'get_placements_api_v1_consultancies_placements_get',
    'get_placement_stats_api_v1_consultancies_placements_stats_get',
    'get_consultancy_submissions_api_v1_applications_for_consultancy_get',
    'create_consultancy_application_api_v1_applications_consultancy_post',
    'bulk_submit_consultancy_candidates_api_v1_applications_consultancy_submit_post',
    'search_jobs_api_v1_jobs_search_get',
    'get_job_api_v1_jobs__job_id__get'
  ])
});

const allowedOperationIds = Object.freeze([...new Set(Object.values(roleOperationIds).flat())]);

const responseFields = Object.freeze({
  get_my_profile_api_v1_candidates_profile_get: [
    'first_name',
    'last_name',
    'phone',
    'current_location',
    'job_title',
    'professional_summary',
    'years_of_experience',
    'months_of_experience',
    'skills',
    'education.institution',
    'education.degree',
    'education.field_of_study',
    'education.start_date',
    'education.end_date',
    'education.grade',
    'work_experience.company',
    'work_experience.title',
    'work_experience.location',
    'work_experience.start_date',
    'work_experience.end_date',
    'work_experience.is_current',
    'work_experience.description',
    'certifications.name',
    'certifications.issuing_organization',
    'certifications.issue_date',
    'certifications.expiry_date',
    'certifications.credential_id',
    'certifications.credential_url',
    'preferred_job_types',
    'preferred_work_types',
    'expected_salary_min',
    'expected_salary_max',
    'salary_currency',
    'notice_period_days',
    'linkedin_url',
    'github_url',
    'portfolio_url',
    'personal_website',
    'is_open_to_work',
    'profile_completion_percentage',
  ],
  search_jobs_api_v1_jobs_search_get: [
    'items.id',
    'items.title',
    'items.company_name',
    'items.job_type',
    'items.experience_level',
    'items.required_skills',
    'items.locations',
    'items.remote_type',
    'items.salary_min',
    'items.salary_max',
    'items.salary_currency',
    'items.status',
    'items.has_screening'
  ],
  get_matching_jobs_api_v1_matching_jobs_get: [
    'id',
    'title',
    'company_name',
    'locations',
    'remote_type',
    'job_type',
    'experience_level',
    'required_skills',
    'status',
    'applications_count',
    'created_at',
    'matching_score',
    'has_screening'
  ],
  get_job_api_v1_jobs__job_id__get: [
    'id',
    'title',
    'description',
    'department',
    'locations',
    'remote_type',
    'job_type',
    'employment_type',
    'experience_level',
    'experience_min',
    'experience_max',
    'required_skills',
    'preferred_skills',
    'education_requirements',
    'application_deadline',
    'status',
    'has_screening',
    'company_name',
    'salary_min',
    'salary_max',
    'salary_currency',
    'pay_min',
    'pay_max'
  ],
  get_screening_questions_for_candidate_api_v1_jobs__job_id__screening_questions_for_candidate_get: [
    'questions.id'
  ],
  check_screening_eligibility_api_v1_applications_screening_eligibility__job_id__get: [
    'eligible',
    'reason',
    'application_id'
  ],
  get_my_applications_api_v1_applications_my_applications_get: [
    'items.id',
    'items.job_id',
    'items.status',
    'items.job_title',
    'items.company_name',
    'items.created_at',
    'items.last_status_change_at',
    'total',
    'page',
    'page_size',
    'total_pages'
  ],
  create_application_api_v1_applications_post: [
    'id',
    'job_id',
    'status',
    'job_title',
    'company_name',
    'created_at'
  ],
  update_my_profile_api_v1_candidates_profile_put: [
    'id',
    'first_name',
    'last_name',
    'phone',
    'job_title',
    'professional_summary',
    'years_of_experience',
    'months_of_experience',
    'skills',
    'work_experience.company',
    'work_experience.title',
    'work_experience.location',
    'work_experience.start_date',
    'work_experience.end_date',
    'work_experience.is_current',
    'work_experience.description',
    'education.institution',
    'education.degree',
    'education.field_of_study',
    'education.start_date',
    'education.end_date',
    'education.grade',
    'certifications.name',
    'certifications.issuing_organization',
    'certifications.issue_date',
    'certifications.expiry_date',
    'certifications.credential_id',
    'certifications.credential_url',
    'current_location',
    'preferred_job_types',
    'preferred_work_types',
    'expected_salary_min',
    'expected_salary_max',
    'salary_currency',
    'notice_period_days',
    'linkedin_url',
    'github_url',
    'portfolio_url',
    'personal_website',
    'is_open_to_work',
    'profile_completion_percentage'
  ],
  withdraw_application_api_v1_applications__application_id__withdraw_post: [
    'message'
  ],
  create_job_api_v1_jobs_post: [
    'id',
    'title',
    'status',
    'company_name',
    'locations',
    'created_at'
  ],
  update_job_api_v1_jobs__job_id__put: [
    'id',
    'title',
    'status',
    'company_name',
    'locations',
    'updated_at'
  ],
  bulk_update_status_api_v1_applications_bulk_status_post: [
    'updated_count',
    'application_ids',
    'status'
  ],
  update_company_profile_api_v1_clients_profile_put: [
    'id',
    'company_name',
    'industry',
    'company_size',
    'headquarters_location',
    'company_website',
    'about_company',
    'founding_year',
    'logo_url',
    'registration_number',
    'gst_tax_id',
    'social_media_links',
    'social_media_links.linkedin',
    'social_media_links.twitter',
    'social_media_links.facebook',
    'social_media_links.instagram',
    'verification_status'
  ],
  get_my_company_profile_api_v1_clients_profile_get: [
    'id',
    'company_name',
    'industry',
    'company_size',
    'headquarters_location',
    'company_website',
    'about_company',
    'founding_year',
    'logo_url',
    'registration_number',
    'gst_tax_id',
    'social_media_links',
    'social_media_links.linkedin',
    'social_media_links.twitter',
    'social_media_links.facebook',
    'social_media_links.instagram',
    'verification_status'
  ],
  get_my_user_profile_api_v1_clients_me_get: [
    'id',
    'user_id',
    'client_id',
    'email',
    'full_name',
    'designation',
    'phone',
    'role',
    'photo_url',
    'company_name',
    'organization_name'
  ],
  update_my_user_profile_api_v1_clients_me_put: [
    'id',
    'user_id',
    'client_id',
    'email',
    'full_name',
    'designation',
    'phone',
    'role',
    'photo_url',
    'company_name',
    'organization_name'
  ],
  get_dashboard_stats_api_v1_clients_dashboard_get: [
    'total_jobs',
    'active_jobs',
    'total_applicants',
    'pending_applications',
    'recent_activity'
  ],
  get_my_jobs_api_v1_jobs_my_jobs_get: [
    'items.id',
    'items.title',
    'items.status',
    'items.company_name',
    'items.location',
    'items.locations',
    'items.department',
    'items.remote_type',
    'items.job_type',
    'items.employment_type',
    'items.salary_min',
    'items.salary_max',
    'items.salary_currency',
    'items.number_of_openings',
    'items.updated_at',
    'total'
  ],
  get_job_applications_api_v1_applications_job__job_id__get: [
    'items.id',
    'items.candidate_id',
    'items.status',
    'items.matching_score',
    'items.created_at',
    'items.updated_at',
    'total',
    'page',
    'page_size'
  ],
  get_client_applications_api_v1_applications_for_client_get: [
    'items.id',
    'items.job_id',
    'items.candidate_id',
    'items.candidate_name',
    'items.candidate_job_title',
    'items.candidate_location',
    'items.candidate_skills',
    'items.matching_score',
    'items.status',
    'items.job_title',
    'items.company_name',
    'items.source',
    'items.consultancy_name',
    'items.created_at',
    'items.last_status_change_at',
    'total',
    'page',
    'page_size'
  ],
  get_matching_candidates_api_v1_matching_candidates__job_id__get: [
    'items.id',
    'items.full_name',
    'items.email',
    'items.matching_score',
    'items.current_location',
    'items.skills',
    'items.status'
  ],
  add_candidate_api_v1_consultancies_candidates_post: [
    'id',
    'full_name',
    'first_name',
    'last_name',
    'email',
    'job_title',
    'skills',
    'current_location',
    'status'
  ],
  update_candidate_api_v1_consultancies_candidates__candidate_id__put: [
    'id',
    'full_name',
    'email',
    'skills',
    'current_location',
    'availability',
    'status'
  ],
  update_consultancy_profile_api_v1_consultancies_profile_put: [
    'id',
    'consultancy_name',
    'consultancy_type',
    'industry_specialization',
    'company_size',
    'headquarters_location',
    'website',
    'about_company',
    'founding_year',
    'logo_url',
    'social_media_links',
    'social_media_links.linkedin',
    'social_media_links.twitter',
    'social_media_links.facebook',
    'social_media_links.instagram',
    'commission_structure',
    'verification_status',
    'candidate_pool_size'
  ],
  get_my_consultancy_profile_api_v1_consultancies_profile_get: [
    'id',
    'consultancy_name',
    'consultancy_type',
    'industry_specialization',
    'company_size',
    'headquarters_location',
    'website',
    'about_company',
    'founding_year',
    'logo_url',
    'social_media_links',
    'social_media_links.linkedin',
    'social_media_links.twitter',
    'social_media_links.facebook',
    'social_media_links.instagram',
    'commission_structure',
    'verification_status',
    'candidate_pool_size'
  ],
  get_my_user_profile_api_v1_consultancies_me_get: [
    'id',
    'user_id',
    'consultancy_id',
    'email',
    'full_name',
    'designation',
    'phone',
    'role',
    'photo_url',
    'consultancy_name',
    'organization_name'
  ],
  update_my_user_profile_api_v1_consultancies_me_put: [
    'id',
    'user_id',
    'consultancy_id',
    'email',
    'full_name',
    'designation',
    'phone',
    'role',
    'photo_url',
    'consultancy_name',
    'organization_name'
  ],
  get_dashboard_stats_api_v1_consultancies_dashboard_get: [
    'total_candidates',
    'active_jobs',
    'shortlisted_candidates',
    'pending_submissions',
    'placements',
    'recent_activity'
  ],
  list_candidates_api_v1_consultancies_candidates_get: [
    'items.id',
    'items.full_name',
    'items.first_name',
    'items.last_name',
    'items.email',
    'items.job_title',
    'items.skills',
    'items.current_location',
    'items.availability',
    'items.status',
    'total',
    'page',
    'page_size'
  ],
  get_matching_candidates_for_job_api_v1_consultancies_candidates_matching_get: [
    'items.id',
    'items.full_name',
    'items.email',
    'items.matching_score',
    'items.current_location',
    'items.skills',
    'items.status'
  ],
  get_placements_api_v1_consultancies_placements_get: [
    'items.id',
    'items.candidate_name',
    'items.company_name',
    'items.status',
    'items.start_date',
    'items.end_date',
    'total',
    'page',
    'page_size'
  ],
  get_placement_stats_api_v1_consultancies_placements_stats_get: [
    'total_placements',
    'this_month',
    'this_year'
  ],
  bulk_submit_consultancy_candidates_api_v1_applications_consultancy_submit_post: [
    'success',
    'submitted_count',
    'job_id',
    'candidate_ids'
  ],
  create_consultancy_application_api_v1_applications_consultancy_post: [
    'id',
    'job_id',
    'consultancy_candidate_id',
    'consultancy_id',
    'status',
    'matching_score',
    'candidate_name',
    'job_title',
    'created_at'
  ],
  get_consultancy_submissions_api_v1_applications_for_consultancy_get: [
    'items.id',
    'items.job_id',
    'items.candidate_id',
    'items.status',
    'items.job_title',
    'items.company_name',
    'items.created_at',
    'items.last_status_change_at',
    'total',
    'page',
    'page_size'
  ]
});

function getLocalApiBaseUrl(env = process.env) {
  return env.HIREPOOL_LOCAL_API_BASE_URL || 'http://localhost:8000/';
}

function getLocalOpenApiUrl(env = process.env) {
  return env.HIREPOOL_LOCAL_OPENAPI_URL || 'http://localhost:8000/api/openapi.json';
}

function safeReviewText(value, maxLength = 400) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function createApplicationReview(job, profile, body, questions = []) {
  const lines = [
    'I verified the available job and screening requirements with HirePool. Review the application details before confirming:',
    '',
    `- Job: ${safeReviewText(job.title)}`,
    `- Company: ${safeReviewText(job.company_name) || 'Not listed'}`,
    `- Location: ${safeReviewText((job.locations || []).join(', ')) || 'Not listed'}`,
    `- Job type: ${safeReviewText(job.job_type) || 'Not listed'}`,
    `- Candidate profile: ${safeReviewText(`${profile.first_name} ${profile.last_name}`)}; ${safeReviewText(profile.job_title) || 'no headline'}; ${safeReviewText((profile.skills || []).join(', ')) || 'no listed skills'}`,
    `- Cover letter: ${safeReviewText(body.cover_letter) || 'None included'}`
  ];
  lines.push(questions.length
    ? `- Candidate-side screening questions: ${questions.length}`
    : '- Candidate-side screening questions: None required for this job.');
  lines.push('', 'Choose “Confirm & Execute” below to submit this application, or cancel to make no changes.');
  return lines.join('\n');
}

async function getCandidateApplications(readOperation) {
  const operationId = 'get_my_applications_api_v1_applications_my_applications_get';
  const pageSize = 100;
  const firstPage = await readOperation(operationId, { query: { page: 1, page_size: pageSize } });
  if (!Array.isArray(firstPage?.items) ||
      !Number.isInteger(firstPage.total_pages) ||
      firstPage.total_pages < 0 ||
      firstPage.total_pages > 20) {
    throw new Error('Candidate application history could not be verified.');
  }
  const items = [...firstPage.items];
  for (let page = 2; page <= firstPage.total_pages; page += 1) {
    const result = await readOperation(operationId, { query: { page, page_size: pageSize } });
    if (!Array.isArray(result?.items) || result.total_pages !== firstPage.total_pages) {
      throw new Error('Candidate application history changed while it was being verified.');
    }
    items.push(...result.items);
  }
  return items;
}

async function prepareHirePoolAction({ actionDefinition, argumentsValue, user, options = {}, readOperation }) {
  const operationId = actionDefinition.metadata.dynamicApi.operationId;
  if (operationId === 'update_my_profile_api_v1_candidates_profile_put') {
    const body = argumentsValue.body;
    if (!body || Object.keys(body).length === 0) {
      throw new Error('Provide at least one candidate profile field to update.');
    }
    const currentProfile = await readOperation('get_my_profile_api_v1_candidates_profile_get');
    const mergedBody = options?.profileMergeMode === 'exact'
      ? { ...body }
      : mergeCandidateProfileUpdate(currentProfile, body, { operation: 'add' });
    const validation = validateCandidateProfileUpdatePayload(mergedBody, currentProfile);
    if (!validation.isValid) {
      return {
        ready: false,
        reviewMessage: `Please fix the following profile validation issue: ${validation.firstError}`,
        validation
      };
    }
    argumentsValue.body = validation.sanitizedBody;
    const review = formatCandidateProfileReview(validation.sanitizedBody, currentProfile);
    return {
      reviewMessage: review.reviewMessage,
      formattedReview: review.formattedReview
    };
  }

  if (operationId === 'update_company_profile_api_v1_clients_profile_put') {
    const body = argumentsValue.body;
    if (!body || Object.keys(body).length === 0) {
      throw new Error('Provide at least one company profile field to update.');
    }
    let meProfile = null;
    try {
      meProfile = await readOperation('get_my_user_profile_api_v1_clients_me_get');
    } catch {
      meProfile = null;
    }
    const effectiveOrgRole = (meProfile?.role || user?.organizationRole || user?.orgRole || '').toLowerCase();
    if (effectiveOrgRole && effectiveOrgRole !== 'admin' && effectiveOrgRole !== 'hiring_manager') {
      return {
        ready: false,
        reviewMessage: `Your client organization role is **${effectiveOrgRole}**. Only organization admins or hiring managers can update the company profile (\`/clients/profile\`). You can still update your personal profile (\`/clients/me\`).`
      };
    }
    const currentProfile = await readOperation('get_my_company_profile_api_v1_clients_profile_get');
    const validation = validateClientProfileUpdatePayload(body, currentProfile);
    if (!validation.isValid) {
      return {
        ready: false,
        reviewMessage: `Please fix the following company profile validation issue: ${validation.firstError}`,
        validation
      };
    }
    argumentsValue.body = validation.sanitizedBody;
    const review = formatRoleProfileReview({
      role: 'client',
      profileType: HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY,
      sanitizedBody: validation.sanitizedBody,
      currentProfile
    });
    return {
      reviewMessage: review.reviewMessage,
      formattedReview: review.formattedReview
    };
  }

  if (operationId === 'update_my_user_profile_api_v1_clients_me_put') {
    const body = argumentsValue.body;
    if (!body || Object.keys(body).length === 0) {
      throw new Error('Provide at least one personal profile field to update.');
    }
    const currentProfile = await readOperation('get_my_user_profile_api_v1_clients_me_get');
    const validation = validateOrgUserProfileUpdatePayload(body);
    if (!validation.isValid) {
      return {
        ready: false,
        reviewMessage: `Please fix the following user profile validation issue: ${validation.firstError}`,
        validation
      };
    }
    argumentsValue.body = validation.sanitizedBody;
    const review = formatRoleProfileReview({
      role: 'client',
      profileType: HIREPOOL_PROFILE_TYPES.CLIENT_ME,
      sanitizedBody: validation.sanitizedBody,
      currentProfile
    });
    return {
      reviewMessage: review.reviewMessage,
      formattedReview: review.formattedReview
    };
  }

  if (operationId === 'update_consultancy_profile_api_v1_consultancies_profile_put') {
    const body = argumentsValue.body;
    if (!body || Object.keys(body).length === 0) {
      throw new Error('Provide at least one consultancy profile field to update.');
    }
    let meProfile = null;
    try {
      meProfile = await readOperation('get_my_user_profile_api_v1_consultancies_me_get');
    } catch {
      meProfile = null;
    }
    const effectiveOrgRole = (meProfile?.role || user?.organizationRole || user?.orgRole || '').toLowerCase();
    if (effectiveOrgRole && effectiveOrgRole !== 'admin') {
      return {
        ready: false,
        reviewMessage: `Your consultancy team role is **${effectiveOrgRole}**. Only consultancy admins can update the consultancy organization profile (\`/consultancies/profile\`). You can still update your personal profile (\`/consultancies/me\`).`
      };
    }
    const currentProfile = await readOperation('get_my_consultancy_profile_api_v1_consultancies_profile_get');
    const validation = validateConsultancyProfileUpdatePayload(body, currentProfile);
    if (!validation.isValid) {
      return {
        ready: false,
        reviewMessage: `Please fix the following consultancy profile validation issue: ${validation.firstError}`,
        validation
      };
    }
    argumentsValue.body = validation.sanitizedBody;
    const review = formatRoleProfileReview({
      role: 'consultancy',
      profileType: HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG,
      sanitizedBody: validation.sanitizedBody,
      currentProfile
    });
    return {
      reviewMessage: review.reviewMessage,
      formattedReview: review.formattedReview
    };
  }

  if (operationId === 'update_my_user_profile_api_v1_consultancies_me_put') {
    const body = argumentsValue.body;
    if (!body || Object.keys(body).length === 0) {
      throw new Error('Provide at least one personal profile field to update.');
    }
    const currentProfile = await readOperation('get_my_user_profile_api_v1_consultancies_me_get');
    const validation = validateOrgUserProfileUpdatePayload(body);
    if (!validation.isValid) {
      return {
        ready: false,
        reviewMessage: `Please fix the following user profile validation issue: ${validation.firstError}`,
        validation
      };
    }
    argumentsValue.body = validation.sanitizedBody;
    const review = formatRoleProfileReview({
      role: 'consultancy',
      profileType: HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME,
      sanitizedBody: validation.sanitizedBody,
      currentProfile
    });
    return {
      reviewMessage: review.reviewMessage,
      formattedReview: review.formattedReview
    };
  }

  if (operationId === 'create_job_api_v1_jobs_post') {
    const body = argumentsValue.body || {};
    const validation = validateJobCreation(body);
    if (!validation.isValid) {
      return {
        ready: false,
        reviewMessage: validation.guidanceMessage
      };
    }
    return {
      ready: true,
      argumentsValue: { ...argumentsValue, body: validation.normalized },
      formattedReview: validation.formattedReview,
      reviewMessage: [
        'I verified the job details according to HirePool specifications. Review the details below:',
        ...validation.formattedReview.fields.map(f => `- **${f.label}**: ${f.value}`),
        '',
        'Choose “Confirm & Execute” to publish this job to HirePool.'
      ].join('\n')
    };
  }

  if (
    operationId === 'add_candidate_api_v1_consultancies_candidates_post' ||
    operationId === 'update_candidate_api_v1_consultancies_candidates__candidate_id__put'
  ) {
    const body = argumentsValue.body || {};
    const validation = validateCandidateCreation(body);
    if (!validation.isValid) {
      return {
        ready: false,
        reviewMessage: validation.guidanceMessage
      };
    }
    return {
      ready: true,
      argumentsValue: { ...argumentsValue, body: validation.normalized },
      formattedReview: validation.formattedReview,
      reviewMessage: [
        'I verified the candidate details before saving to HirePool:',
        ...validation.formattedReview.fields.map(f => `- **${f.label}**: ${f.value}`),
        '',
        'Choose “Confirm & Execute” to save this candidate profile.'
      ].join('\n')
    };
  }

  if (operationId === 'withdraw_application_api_v1_applications__application_id__withdraw_post') {
    const applicationId = argumentsValue.path?.application_id;
    const history = await readOperation(
      'get_my_applications_api_v1_applications_my_applications_get',
      { query: { page: 1, page_size: 100 } }
    );
    const application = history?.items?.find(item => item.id === applicationId);
    if (!application) {
      throw new Error('That application is not present in your own HirePool application history. Refresh your history before trying to withdraw it.');
    }
    if (application.status === 'withdrawn') {
      throw new Error('This application is already withdrawn.');
    }
    return {
      reviewMessage: [
        'I verified this application in your HirePool application history:',
        `- Application: ${safeReviewText(application.job_title) || 'Job application'}`,
        `- Company: ${safeReviewText(application.company_name) || 'Not listed'}`,
        `- Current status: ${safeReviewText(application.status)}`,
        `- Application ID: ${safeReviewText(application.id)}`,
        `- Withdrawal reason: ${safeReviewText(argumentsValue.body?.reason) || 'None provided'}`,
        '',
        'Withdrawal is destructive. Check the acknowledgement and choose “Confirm & Execute” only if you want to proceed.'
      ].join('\n')
    };
  }

  if (operationId === 'update_job_api_v1_jobs__job_id__put') {
    const jobId = argumentsValue.path?.job_id;
    const body = argumentsValue.body || {};
    return {
      reviewMessage: [
        'I verified the job record and the requested change is scoped to the selected HirePool job.',
        `- Job ID: ${safeReviewText(jobId) || 'Not provided'}`,
        `- Requested update: ${safeReviewText(typeof body === 'object' ? JSON.stringify(body) : String(body), 700) || 'No explicit field changes provided'}`,
        '',
        'Choose “Confirm & Execute” only if these job changes are correct and you want to save them.'
      ].join('\n')
    };
  }

  if (operationId === 'bulk_update_status_api_v1_applications_bulk_status_post') {
    const body = argumentsValue.body || {};
    return {
      reviewMessage: [
        'I verified the requested application status change before it is sent to HirePool.',
        `- Application IDs: ${safeReviewText(Array.isArray(body.application_ids) ? body.application_ids.join(', ') : JSON.stringify(body.application_ids || []), 700) || 'Not provided'}`,
        `- Status: ${safeReviewText(body.status) || 'Not provided'}`,
        `- Reason: ${safeReviewText(body.reason) || 'No reason provided'}`,
        '',
        'Choose “Confirm & Execute” only if the target applications and new status are correct.'
      ].join('\n')
    };
  }

  if (operationId === 'create_consultancy_application_api_v1_applications_consultancy_post') {
    const body = argumentsValue.body || {};
    return {
      reviewMessage: [
        'I verified the candidate submission details before submitting to HirePool:',
        `- Candidate ID: ${safeReviewText(body.consultancy_candidate_id) || 'Not provided'}`,
        `- Job ID: ${safeReviewText(body.job_id) || 'Not provided'}`,
        `- Cover Note: ${safeReviewText(body.consultancy_cover_note) || 'None provided'}`,
        '',
        'Review the selected candidate and job opening, then choose “Confirm & Execute” to submit the candidate.'
      ].join('\n')
    };
  }

  if (operationId === 'bulk_submit_consultancy_candidates_api_v1_applications_consultancy_submit_post') {
    const body = argumentsValue.body || {};
    return {
      reviewMessage: [
        'I verified the proposed candidate submission for HirePool before it is executed.',
        `- Candidate IDs: ${safeReviewText(Array.isArray(body.candidate_ids) ? body.candidate_ids.join(', ') : JSON.stringify(body.candidate_ids || []), 700) || 'Not provided'}`,
        `- Job ID: ${safeReviewText(body.job_id) || 'Not provided'}`,
        '',
        'Review the selected candidates and job, then choose “Confirm & Execute” only if the submission is correct.'
      ].join('\n')
    };
  }

  if (operationId !== 'create_application_api_v1_applications_post') return null;

  const body = argumentsValue.body;
  const jobId = body?.job_id;
  const job = await readOperation('get_job_api_v1_jobs__job_id__get', {
    path: { job_id: jobId }
  });
  if (job?.id !== jobId) throw new Error('The selected job could not be verified. Select a current HirePool job.');
  if (job.status !== 'active') throw new Error('This job is no longer accepting applications.');
  const [profile, applications] = await Promise.all([
    readOperation('get_my_profile_api_v1_candidates_profile_get'),
    getCandidateApplications(readOperation)
  ]);
  let screening;
  try {
    screening = await readOperation(
      'get_screening_questions_for_candidate_api_v1_jobs__job_id__screening_questions_for_candidate_get',
      { path: { job_id: jobId } }
    );
  } catch {
    return {
      ready: false,
      reviewMessage: "I couldn't verify whether this job requires screening questions because HirePool's screening endpoint is unavailable. Please check your HirePool dashboard. I won't prepare the application until its requirements can be verified."
    };
  }
  if (!screening || !Array.isArray(screening.questions) ||
      typeof job.has_screening !== 'boolean') {
    return {
      ready: false,
      reviewMessage: "I couldn't verify whether this job requires screening questions because HirePool returned incomplete requirement data. Please check your HirePool dashboard. I won't prepare the application until its requirements can be verified."
    };
  }

  const questions = screening.questions;
  if (questions.length > 0) {
    let eligibility;
    try {
      eligibility = await readOperation(
        'check_screening_eligibility_api_v1_applications_screening_eligibility__job_id__get',
        { path: { job_id: jobId } }
      );
    } catch {
      return {
        ready: false,
        reviewMessage: "I couldn't verify whether the required screening has been completed. Please check your HirePool dashboard. I won't prepare the application until HirePool's completion status can be verified."
      };
    }
    if (!eligibility || typeof eligibility.eligible !== 'boolean') {
      return {
        ready: false,
        reviewMessage: "I couldn't verify whether the required screening has been completed because HirePool returned incomplete eligibility data. Please check your HirePool dashboard. I won't prepare the application."
      };
    }

    const existingApplication = applications.find(application => application.job_id === jobId);
    if (eligibility.eligible === false && eligibility.reason !== 'screening_completed') {
      return {
        ready: false,
        reviewMessage: "HirePool returned an eligibility state I can't verify for this screening. Please check your HirePool dashboard. I won't prepare the application."
      };
    }
    if (eligibility.eligible === false && !existingApplication) {
      return {
        ready: false,
        reviewMessage: "HirePool reports screening as completed, but I couldn't verify a matching application in your application history. Please check your dashboard; I won't submit another application."
      };
    }
    if (existingApplication) {
      if (eligibility.reason === 'screening_completed') {
        return {
          ready: false,
          reviewMessage: `HirePool verifies that screening is complete, and your application already exists (status: ${safeReviewText(existingApplication.status) || 'unknown'}). I won't submit a duplicate. Check its current status in your HirePool dashboard.`
        };
      }
      return {
        ready: false,
        reviewMessage: `HirePool already has an application for this job (status: ${safeReviewText(existingApplication.status) || 'unknown'}), and screening is not verified as complete. Open your HirePool dashboard, complete and submit the required screening yourself, then return to this conversation. I won't submit a duplicate application.`
      };
    }
    return {
      ready: false,
      reviewMessage: eligibility.application_id
        ? `I checked this job and HirePool reports ${questions.length} candidate-side screening question${questions.length === 1 ? '' : 's'} with screening still incomplete. Open your HirePool dashboard, complete and submit the required questions yourself, then return to this same conversation. I will re-check the job, screening status, profile, and application history. I won't answer assessment questions or prepare an application confirmation before requirements are verified.`
        : `I checked this job and HirePool reports ${questions.length} candidate-side screening question${questions.length === 1 ? '' : 's'} that you have not started. Open your HirePool dashboard, complete and submit the required questions yourself, then return to this same conversation. I will re-check the job, screening status, profile, and application history. I won't answer assessment questions or prepare an application confirmation before requirements are verified.`
    };
  }
  const existingApplication = applications.find(application => application.job_id === jobId);
  if (existingApplication) {
    return {
      ready: false,
      reviewMessage: `HirePool already has an application for this job (status: ${safeReviewText(existingApplication.status) || 'unknown'}). I will not prepare a duplicate submission. Check its current status in your HirePool dashboard.`
    };
  }
  if (body.screening_responses?.length) {
    throw new Error('Screening answers must be completed and submitted by you in your HirePool dashboard.');
  }
  delete body.screening_responses;
  body.auto_submitted = false;
  if (job.has_screening) {
    return {
      ready: false,
      reviewMessage: "HirePool marks screening as required, but its screening endpoint returned no questions. The requirement data is inconclusive. Please check your HirePool dashboard; I won't prepare an application confirmation until HirePool's requirements can be verified."
    };
  }
  if (typeof profile?.first_name !== 'string' || !profile.first_name.trim() ||
      typeof profile?.last_name !== 'string' || !profile.last_name.trim()) {
    return {
      ready: false,
      reviewMessage: 'Your HirePool profile is missing required name information. Complete your candidate profile before applying.'
    };
  }

  return {
    argumentsValue,
    reviewMessage: createApplicationReview(job, profile, body, questions)
  };
}

export function registerHirePoolLocalDevelopmentIntegration() {
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE !== 'true' ||
    process.env.DYNAMIC_API_DISCOVERY_ENABLED !== 'true'
  ) {
    throw new Error('HirePool local integration requires explicit local development flags');
  }
  if (getDynamicApiIntegration(HIREPOOL_LOCAL_INTEGRATION_ID)) {
    return { id: HIREPOOL_LOCAL_INTEGRATION_ID };
  }

  return registerDynamicApiIntegration({
    id: HIREPOOL_LOCAL_INTEGRATION_ID,
    assistantId: HIREPOOL_LOCAL_ASSISTANT_ID,
    applicationId: HIREPOOL_LOCAL_APPLICATION_ID,
    openApiSpecUrl: getLocalOpenApiUrl(),
    apiBaseUrl: getLocalApiBaseUrl(),
    allowedHosts: ['localhost'],
    allowedOperationIds,
    destructiveOperationIds: [
      'withdraw_application_api_v1_applications__application_id__withdraw_post'
    ],
    responseFields,
    roleOperationIds,
    allowLocalDevelopment: true,
    enabled: true,
    authenticationRequired: true,
    limits: {
      timeoutMs: 10000,
      maxSpecBytes: 1024 * 1024,
      maxResponseBytes: 64 * 1024,
      maxResultBytes: 16 * 1024
    },
    authorize: async user =>
      user?.assistantId === HIREPOOL_LOCAL_ASSISTANT_ID &&
      user?.applicationId === HIREPOOL_LOCAL_APPLICATION_ID &&
      Object.hasOwn(roleOperationIds, user?.role) &&
      typeof user?.integrationSessionId === 'string' &&
      Boolean(await getHirePoolValidAccessToken(user)),
    prepareAction: prepareHirePoolAction,
    getAuthHeaders: async user => {
      const accessToken = await getHirePoolValidAccessToken(user);
      if (!accessToken) throw new Error('The validated HirePool session has expired');
      return { Authorization: `Bearer ${accessToken}` };
    }
  });
}
