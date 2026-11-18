/**
 * HirePool Candidate Profile Editing State Machine, Parser & Validator
 *
 * Parses natural-language and structured candidate profile update requests,
 * validates against HirePool UI & backend schema rules, merges arrays against
 * live GET /api/v1/candidates/profile data to prevent overwrites/duplicates,
 * and manages multi-section workflows in `session.hirePoolProfileEdit`.
 */

import {
  LIMITS,
  rangeError,
  WORK_TYPES,
  JOB_TYPES,
  validatePhoneNumber,
  validateEducationItem,
  validateWorkExperienceItem,
  validateWebsiteUrl
} from '../../backend/src/local-integrations/hirepool-validation.js';
import {
  HIREPOOL_PROFILE_SECTIONS,
  HIREPOOL_PROFILE_SECTION_LABELS,
  HIREPOOL_PROFILE_TYPES,
  HIREPOOL_CURRENCIES,
  WORK_TYPE_LABELS,
  JOB_TYPE_LABELS,
  MONTH_MAP,
  normalizeText,
  normKeyPart,
  compareYearMonth,
  parseHirePoolMonthDate,
  isSkillInstructionPhrase,
  cleanSkillToken,
  normalizeSkillsArray,
  parseSkillsInput,
  matchAllowedOption,
  formatRoleProfileReview,
  buildInitialProfileEditState,
  ensureRoleScopedProfileEditState
} from './profile-edit-shared.js';
import { handleOrgProfileEditTurn, getOrgOperationIds } from './org-profile-edit.js';

export {
  HIREPOOL_PROFILE_SECTIONS,
  HIREPOOL_PROFILE_SECTION_LABELS,
  HIREPOOL_PROFILE_TYPES,
  parseHirePoolMonthDate
};

const CANCEL_WORKFLOW_PATTERN = /^\s*(?:cancel|stop|exit|never\s*mind|quit|close|don'?t\s+save|discard)\b(?:\s+(?:profile\s+edit|editing|changes?))?[.!?]*$/i;

const ALLOWED_CANDIDATE_PROFILE_FIELDS = new Set([
  'first_name',
  'last_name',
  'phone',
  'current_location',
  'profile_picture_url',
  'job_title',
  'professional_summary',
  'years_of_experience',
  'months_of_experience',
  'skills',
  'education',
  'work_experience',
  'certifications',
  'preferred_work_types',
  'preferred_job_types',
  'expected_salary_min',
  'expected_salary_max',
  'salary_currency',
  'notice_period_days',
  'linkedin_url',
  'github_url',
  'portfolio_url',
  'personal_website',
  'is_open_to_work'
]);

function isFilledField(value, fieldName) {
  if (value === null || value === undefined) return false;
  if (fieldName === 'years_of_experience' || fieldName === 'months_of_experience') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
}

/**
 * Determine whether a question is general informational guidance about profiles
 * (must stay public/conversational and NOT trigger private profile editing).
 */
export function isHirePoolHowToProfileQuestion(message) {
  const text = normalizeText(message);
  if (!text) return false;
  return (
    /^\s*(?:how\s+(?:do|can|would|should)\s+(?:i|we|you|candidates?|employers?|clients?|consultanc(?:y|ies)|agenc(?:y|ies)|someone|one)\s+(?:complete|finish|fill\s+out|set\s+up|update|edit|create|build)\s+(?:a|the|my)?\s*(?:candidate\s+|company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+)?profile)\b/i.test(text) ||
    /^\s*(?:what\s+is|explain|tell\s+me\s+about)\s+(?:a\s+)?(?:candidate\s+|company\s+|client\s+|consultancy\s+)?profile\b/i.test(text)
  );
}

/**
 * Detect whether a user message intends to edit, add to, remove from, or audit missing
 * fields on their HirePool profile (Candidate, Employer/Company, or Consultancy/Agency).
 */
export function isHirePoolProfileEditRequest(message) {
  const text = normalizeText(message);
  if (!text) return false;
  if (isHirePoolHowToProfileQuestion(text)) return false;

  // Read-only profile view requests (unless asking what is missing)
  if (
    /^(?:please\s+)?(?:view|show|get|display|open|see|what(?:'s| is)\s+(?:on|in))\s+(?:my\s+)?(?:candidate\s+|company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?profile(?:\s+details|\s+info|\s+completion)?[.!?]*$/i.test(text) ||
    /^\s*(?:my\s+)?(?:candidate\s+|company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?profile\s*[.!?]*$/i.test(text)
  ) {
    return false;
  }

  // Never intercept job creation or consultancy candidate bench/submission commands
  if (
    /\b(?:bench\s+candidates?|talent\s+pool|add\s+(?:a\s+|this\s+)?candidate|register\s+(?:a\s+)?candidate|submit\s+(?:a\s+|this\s+)?candidate|submissions?)\b/i.test(text) ||
    /^\s*(?:candidate\s+)?(?:name|first_name|full\s+name)\s*[:=\-–—]/i.test(text) ||
    /^\s*(?:job\s+)?title\s*[:=\-–—]/i.test(text)
  ) {
    return false;
  }

  const patterns = [
    /\b(?:edit|update|improve|complete|finish|modify|fill\s+out|fix|revise|change)\s+(?:my\s+|the\s+)?(?:candidate\s+|company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?profile\b/i,
    /\bi\s+(?:want|would\s+like|need)\s+to\s+(?:edit|update|improve|complete|finish|change|modify)\s+(?:my\s+|the\s+)?(?:candidate\s+|company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?profile\b/i,
    /\bwhat\s+(?:information|info|details|fields?)\s+(?:is|are)\s+missing(?:\s+(?:on|in|from)\s+(?:my\s+)?profile)?\b/i,
    /\bmissing\s+(?:profile\s+)?(?:information|info|details|fields?)\b/i,
    /\b(?:add|edit|update|write|rewrite|draft|help\s+me\s+write|improve|change|modify|set)\s+(?:a\s+|an\s+|the\s+|my\s+)?(?:professional\s+summary|career\s+summary|profile\s+summary|bio|summary)\b/i,
    /\b(?:add|edit|update|change|modify|enter|submit|remove|delete|drop)\s+(?:a\s+|an\s+|the\s+|my\s+|existing\s+)?(?:education(?:al)?(?:\s+details|\s+history|\s+background|\s+and\b)?|degree|graduation(?:\s+details)?|qualification|b\.?\s*e\.?|b\.?\s*tech|b\.?\s*sc|m\.?\s*tech|m\.?\s*sc|bachelor(?:'s)?|master(?:'s)?|mba|phd|diploma)\b/i,
    /\b(?:add|edit|update|change|modify|enter|submit|remove|delete|drop)\s+(?:a\s+|an\s+|the\s+|my\s+|existing\s+)?(?:work\s*experience|employment(?:\s+details|\s+history)?|previous\s+(?:company|employer|job|role)|job\s+history|career\s+history|\bexperience\b(?!\s+(?:level|years|months)))\b/i,
    /\b(?:add|edit|update|change|modify|replace(?:\s+all)?|overwrite|remove|delete|drop|set|clear(?:\s+all)?)\s+(?:all\s+|some\s+|new\s+|the\s+|my\s+|existing\s+)?(?:technical\s+)?skills?\b/i,
    /\b(?:add|append|include|replace|remove|delete|drop)\s+.{1,160}\s+(?:to|into|from|in)\s+(?:my\s+|the\s+)?(?:technical\s+)?skills?\b/i,
    /\b(?:remove|delete|drop)\s+.+?\s+from\s+(?:my\s+|the\s+)?skills?\b/i,
    /^\s*(?:here\s+are\s+my\s+skills?|my\s+(?:technical\s+)?skills?\s+(?:are|include)|i\s+(?:want|would\s+like|need)\s+to\s+(?:add|update|edit|change|replace|remove)\s+(?:my\s+|the\s+)?skills?)\b/i,
    /\b(?:add|edit|update|change|modify|remove|delete|drop|set|enter)\s+(?:a\s+|an\s+|the\s+|my\s+)?(?:certifications?|certificates?)\b/i,
    /\b(?:add|edit|update|change|modify|set|remove|delete|clear)\s+(?:my\s+|the\s+)?(?:basic\s+(?:info|details)|first\s+name|last\s+name|phone(?:\s+number)?|current\s+location|location|job\s+title|headline|expected\s+salary|salary\s+(?:range|expectation|currency)|notice\s+period|years?\s+of\s+experience|months?\s+of\s+experience|experience\s+(?:to|as|is|=|:)\s*\d+|open\s+to\s+work|is_open_to_work|preferred\s+work\s+types?|preferred\s+job\s+types?|work(?:\s+type)?\s+preferences?|job(?:\s+type)?\s+preferences?|linkedin(?:_url)?|github(?:_url)?|portfolio(?:_url)?|personal\s+website|profile\s+links?)\b/i,
    /\b(?:add|edit|update|change|modify|set|replace|remove|delete)\s+(?:my\s+|the\s+|our\s+)?(?:company_?name|consultancy_?name|consultancy_?type|industry_?specializations?|company\s+size|headquarters(?:\s+location)?|company_?website|about_?company|founding_?year|founding\s+year|registration_?number|registration\s+number|gst_?tax_?id|gstin|social_?media_?links?|commission_?structure|designation|full_?name|my\s+personal\s+phone|my\s+personal\s+name)\b/i,
    /\b(?:add|append|include|replace|remove|delete|drop)\s+.{1,160}\s+(?:to|into|from|in)\s+(?:our\s+|my\s+|the\s+)?(?:industry[_\s]+)?specializations?\b/i,
    /\b(?:update|change|edit|upload|replace|remove|set)\s+(?:my\s+|the\s+)?(?:profile\s+)?(?:email(?:\s+address)?|resume|cv|profile\s+picture|avatar|photo|logo|verification_status|candidate_pool_size)\b/i
  ];

  if (patterns.some(p => p.test(text))) return true;
  // Compound skill edit without explicit "skills" keyword (e.g. "remove SQL and add PostgreSQL, Redis")
  if (
    !/\b(?:education|work\s*experience|certifications?|specializations?|applications?|jobs?|company|consultancy|logo|email|resume)\b/i.test(text) &&
    parseCompoundSkillEdit(text).matched
  ) {
    return true;
  }
  return false;
}

/**
 * Extract ordered profile section targets and operation mode ('add' | 'edit' | 'replace' | 'remove') from text.
 */
export function extractProfileEditSections(message) {
  const text = normalizeText(message);
  const candidates = [
    {
      section: HIREPOOL_PROFILE_SECTIONS.EDUCATION,
      regex: /\b(?:education(?:al)?(?:\s+details|\s+history|\s+background)?|degree|graduation(?:\s+details)?|qualification|university|college|b\.?\s*e\.?|b\.?\s*tech|b\.?\s*sc|m\.?\s*tech|m\.?\s*sc|bachelor(?:'s)?|master(?:'s)?|mba|phd|diploma)\b/i
    },
    {
      section: HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE,
      regex: /\b(?:work\s*experience|employment(?:\s+details|\s+history)?|previous\s+(?:company|employer|job|role)|job\s+history|career\s+history|internship|\bexperience\b(?!\s*(?:level|years?|months?|to\s+\d+|as\s+\d+|is\s+\d+|[:=]\s*\d+|\d+\s*years?)))\b/i
    },
    {
      section: HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS,
      regex: /\b(?:certifications?|certificates?)\b/i
    },
    {
      section: HIREPOOL_PROFILE_SECTIONS.PROFESSIONAL_SUMMARY,
      regex: /\b(?:professional\s+summary|career\s+summary|profile\s+summary|bio|\bsummary\b)\b/i
    },
    {
      section: HIREPOOL_PROFILE_SECTIONS.SKILLS,
      regex: /\b(?:skills?|technical\s+skills?)\b/i
    },
    {
      section: HIREPOOL_PROFILE_SECTIONS.PREFERENCES,
      regex: /\b(?:preferences?|work\s+preferences?|job\s+preferences?|preferred\s+work\s+types?|preferred\s+job\s+types?|expected\s+salary|salary\s+(?:range|expectation|currency)|salary_currency|notice\s+period)\b/i
    },
    {
      section: HIREPOOL_PROFILE_SECTIONS.LINKS,
      regex: /\b(?:profile\s+links?|social\s+links?|links?|linkedin(?:_url)?|github(?:_url)?|portfolio(?:_url)?|personal_?\s*website)\b/i
    },
    {
      section: HIREPOOL_PROFILE_SECTIONS.BASIC_INFO,
      regex: /\b(?:basic\s+(?:info|details)|first_?\s*name|last_?\s*name|phone(?:\s+number)?|current_?\s*location|location|job_?\s*title|headline|years?\s+of\s+experience|months?\s+of\s+experience|experience\s+(?:to|as|is|=|:)\s*\d+|open\s+to\s+work|is_open_to_work)\b/i
    }
  ];

  const found = [];
  for (const entry of candidates) {
    const match = text.match(entry.regex);
    if (match) {
      found.push({ section: entry.section, index: match.index ?? 0 });
    }
  }
  found.sort((a, b) => a.index - b.index);
  const sections = [...new Set(found.map(item => item.section))];

  let operation = 'add';
  if (/\b(?:remove|delete|drop)\b/i.test(text) && !/\badd\b/i.test(text)) {
    operation = 'remove';
  } else if (/\b(?:replace(?:\s+all)?|overwrite|clear(?:\s+all)?)\b/i.test(text)) {
    operation = 'replace';
  } else if (/\b(?:edit|modify|change|revise|fix)\b/i.test(text) || (/\bupdate\b/i.test(text) && !/\badd\b/i.test(text))) {
    operation = 'edit';
  }

  let targetIndex = null;
  const idxMatch = text.match(/(?:#|entry\s+|number\s+|item\s+)(\d+)\b/i);
  if (idxMatch) {
    const parsed = Number.parseInt(idxMatch[1], 10);
    if (Number.isInteger(parsed) && parsed >= 1) targetIndex = parsed - 1;
  } else if (/\bfirst\b/i.test(text)) {
    targetIndex = 0;
  } else if (/\bsecond\b/i.test(text)) {
    targetIndex = 1;
  } else if (/\bthird\b/i.test(text)) {
    targetIndex = 2;
  }

  return { sections, operation, targetIndex };
}

/**
 * Compute genuinely missing fields aligned with HirePool Profile.tsx (`getMissingFields`).
 */
export function computeCandidateMissingFields(profile = {}) {
  const coreSpecs = [
    ['first_name', 'First Name'],
    ['last_name', 'Last Name'],
    ['phone', 'Phone Number'],
    ['current_location', 'Location'],
    ['job_title', 'Job Title'],
    ['professional_summary', 'Professional Summary'],
    ['years_of_experience', 'Years of Experience']
  ];
  const optionalSpecs = [
    ['skills', 'Skills'],
    ['education', 'Education'],
    ['work_experience', 'Work Experience'],
    ['preferred_job_types', 'Job Type Preference'],
    ['expected_salary_min', 'Expected Salary']
  ];

  const coreMissing = coreSpecs
    .filter(([key]) => !isFilledField(profile[key], key))
    .map(([, label]) => label);
  const optionalMissing = optionalSpecs
    .filter(([key]) => !isFilledField(profile[key], key))
    .map(([, label]) => label);

  return {
    coreMissing,
    optionalMissing,
    allMissing: [...coreMissing, ...optionalMissing]
  };
}

function extractLabeledFields(text, labelAliases) {
  const result = {};
  const escapedAliases = Object.keys(labelAliases)
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `(?:^|[\\n;,])\\s*(${escapedAliases.join('|')})(?:\\s*[:=]\\s*|\\s*[-–—]\\s+)([^\\n;]+?)(?=(?:[\\n;,]\\s*(?:${escapedAliases.join('|')})(?:\\s*[:=]|\\s*[-–—])|[\\n;]|$))`,
    'gi'
  );
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const rawKey = match[1].toLowerCase().trim();
    const canonical = labelAliases[rawKey];
    const value = match[2].trim();
    if (canonical && value) {
      result[canonical] = value;
    }
  }
  return result;
}

function extractDateRangeFromText(text, { allowPresent = false } = {}) {
  const dateToken = '(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+\\d{4}|\\d{4}-\\d{1,2}(?:-\\d{1,2})?|\\d{1,2}[/-]\\d{4}|\\d{4})';
  const endToken = allowPresent ? `(?:${dateToken}|present|current|currently|now|ongoing|till\\s*date)` : dateToken;
  const rangeRegex = new RegExp(
    `(?:from\\s+)?(${dateToken})\\s*(?:to|until|till|-|–|—)\\s*(${endToken})`,
    'i'
  );
  const match = text.match(rangeRegex);
  if (!match) return { found: false };
  return {
    found: true,
    matchedText: match[0],
    rawStart: match[1],
    rawEnd: match[2]
  };
}

/**
 * Extract structured Education fields from freeform or labeled chat text without inventing values.
 */
export function parseEducationFromMessage(message, existingDraft = {}, { expectingField = null } = {}) {
  const raw = String(message || '').trim();
  const normalized = normalizeText(raw);
  const draft = {
    institution: existingDraft.institution || null,
    degree: existingDraft.degree || null,
    field_of_study: existingDraft.field_of_study || null,
    start_date: existingDraft.start_date || null,
    end_date: existingDraft.end_date || null,
    grade: existingDraft.grade || null
  };
  const errors = [];

  const labeled = extractLabeledFields(raw, {
    institution: 'institution',
    university: 'institution',
    college: 'institution',
    school: 'institution',
    institute: 'institution',
    degree: 'degree',
    'field of study': 'field_of_study',
    field_of_study: 'field_of_study',
    major: 'field_of_study',
    specialization: 'field_of_study',
    branch: 'field_of_study',
    stream: 'field_of_study',
    'start date': 'start_date',
    start_date: 'start_date',
    started: 'start_date',
    from: 'start_date',
    'end date': 'end_date',
    end_date: 'end_date',
    ended: 'end_date',
    until: 'end_date',
    to: 'end_date',
    grade: 'grade',
    cgpa: 'grade',
    gpa: 'grade',
    percentage: 'grade',
    score: 'grade'
  });

  if (labeled.institution) draft.institution = labeled.institution.replace(/[.,]+$/, '').trim();
  if (labeled.degree) draft.degree = labeled.degree.replace(/[.,]+$/, '').trim();
  if (labeled.field_of_study) draft.field_of_study = labeled.field_of_study.replace(/[.,]+$/, '').trim();
  if (labeled.grade) draft.grade = labeled.grade.replace(/[.,]+$/, '').trim();
  if (labeled.start_date) {
    const res = parseHirePoolMonthDate(labeled.start_date);
    if (!res.valid) errors.push(res.error);
    else draft.start_date = res.value;
  }
  if (labeled.end_date) {
    const res = parseHirePoolMonthDate(labeled.end_date);
    if (!res.valid) errors.push(res.error);
    else draft.end_date = res.value;
  }

  // Strip command prefixes for freeform parsing
  let remainder = normalized
    .replace(/^(?:please\s+)?(?:add|edit|update|set|enter|my|an?|the)\s+(?:my\s+)?(?:education(?:al)?\s*(?:details|entry|info)?\s*(?:to|as|is|:)?\s*)?/i, '')
    .trim();

  // Extract grade in freeform e.g. "8.9 CGPA", "GPA 3.8", "85%"
  const gradeMatch = remainder.match(/\b(?:cgpa|gpa)\s*[:=]?\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)|(\d+(?:\.\d+)?)\s*(?:cgpa|gpa)\b|(\b\d{1,3}(?:\.\d+)?%)/i);
  if (gradeMatch && !draft.grade) {
    draft.grade = gradeMatch[0].trim();
    remainder = remainder.replace(gradeMatch[0], ' ').trim();
  }

  // Extract date range in freeform
  const dateRange = extractDateRangeFromText(remainder, { allowPresent: false });
  if (dateRange.found) {
    const sRes = parseHirePoolMonthDate(dateRange.rawStart);
    const eRes = parseHirePoolMonthDate(dateRange.rawEnd);
    if (!sRes.valid) errors.push(sRes.error);
    else if (!draft.start_date) draft.start_date = sRes.value;
    if (!eRes.valid) errors.push(eRes.error);
    else if (!draft.end_date) draft.end_date = eRes.value;
    remainder = remainder.replace(dateRange.matchedText, ' ').replace(/,\s*$/, '').trim();
  }

  // Freeform degree + field + optional "at/from Institution"
  const degreeTokens = '(?:B\\.?\\s*E\\.?|B\\.?\\s*Tech\\.?|M\\.?\\s*Tech\\.?|B\\.?\\s*Sc\\.?|M\\.?\\s*Sc\\.?|B\\.?\\s*C\\.?\\s*A\\.?|M\\.?\\s*C\\.?\\s*A\\.?|B\\.?\\s*B\\.?\\s*A\\.?|M\\.?\\s*B\\.?\\s*A\\.?|Ph\\.?\\s*D\\.?|Bachelor(?:\'s)?(?:\\s+of\\s+[A-Za-z]+)?|Master(?:\'s)?(?:\\s+of\\s+[A-Za-z]+)?|Associate(?:\'s)?|Diploma)';
  const eduFullRegex = new RegExp(
    `(${degreeTokens})(?:\\s+in\\s+([^,;]+?))?(?:\\s+(?:at|from)\\s+([^,;]+))?(?:\\s*$|[.,;])`,
    'i'
  );
  const freeMatch = remainder.match(eduFullRegex);
  if (freeMatch && Object.keys(labeled).length === 0) {
    if (!draft.degree && freeMatch[1]) {
      draft.degree = freeMatch[1].replace(/\s+/g, ' ').replace(/,+$/, '').trim();
    }
    if (!draft.field_of_study && freeMatch[2]) {
      draft.field_of_study = freeMatch[2].replace(/\s+(?:at|from)\s+.*$/i, '').replace(/[.,]+$/, '').trim();
    }
    if (!draft.institution && freeMatch[3]) {
      draft.institution = freeMatch[3].replace(/[.,]+$/, '').trim();
    }
  } else if (Object.keys(labeled).length === 0 && !dateRange.found) {
    // Check explicit "at/from <Institution>"
    const instMatch = remainder.match(/^(?:i\s+(?:studied|graduated|completed(?:\s+my\s+degree)?)\s+)?(?:at|from)\s+(.+)$/i);
    if (instMatch && !draft.institution) {
      draft.institution = instMatch[1].replace(/[.,]+$/, '').trim();
    } else if (expectingField === 'institution' && remainder && !/\b(?:add|edit|update|cancel|skip|continue)\b/i.test(remainder)) {
      // Conversational single-field answer (e.g. "PES University", "IIT Madras")
      draft.institution = remainder.replace(/[.,]+$/, '').trim();
    } else if (expectingField === 'degree' && remainder && !/\b(?:add|edit|update|cancel|skip|continue)\b/i.test(remainder)) {
      draft.degree = remainder.replace(/[.,]+$/, '').trim();
    }
  }

  // Chronological & length validation
  const dateOrderError = compareYearMonth(draft.start_date, draft.end_date);
  if (dateOrderError) errors.push(dateOrderError);

  return { draft, errors };
}

/**
 * Extract structured Work Experience fields from freeform or labeled chat text.
 */
export function parseWorkExperienceFromMessage(message, existingDraft = {}, { expectingField = null } = {}) {
  const raw = String(message || '').trim();
  const normalized = normalizeText(raw);
  const draft = {
    company: existingDraft.company || null,
    title: existingDraft.title || null,
    location: existingDraft.location || null,
    start_date: existingDraft.start_date || null,
    end_date: existingDraft.end_date || null,
    is_current: Boolean(existingDraft.is_current),
    description: existingDraft.description || null
  };
  const errors = [];

  const labeled = extractLabeledFields(raw, {
    company: 'company',
    employer: 'company',
    organization: 'company',
    title: 'title',
    'job title': 'title',
    role: 'title',
    position: 'title',
    location: 'location',
    city: 'location',
    'start date': 'start_date',
    start_date: 'start_date',
    from: 'start_date',
    'end date': 'end_date',
    end_date: 'end_date',
    to: 'end_date',
    current: 'is_current',
    is_current: 'is_current',
    'currently working': 'is_current',
    description: 'description',
    responsibilities: 'description',
    summary: 'description'
  });

  if (labeled.company) draft.company = labeled.company.replace(/[.,]+$/, '').trim();
  if (labeled.title) draft.title = labeled.title.replace(/[.,]+$/, '').trim();
  if (labeled.location) draft.location = labeled.location.replace(/[.,]+$/, '').trim();
  if (labeled.description) draft.description = labeled.description.trim();
  if (labeled.is_current !== undefined) {
    draft.is_current = /^(?:true|yes|y|1|current|currently)$/i.test(labeled.is_current.trim());
    if (draft.is_current) draft.end_date = null;
  }
  if (labeled.start_date) {
    const res = parseHirePoolMonthDate(labeled.start_date);
    if (!res.valid) errors.push(res.error);
    else draft.start_date = res.value;
  }
  if (labeled.end_date) {
    const res = parseHirePoolMonthDate(labeled.end_date, { allowPresent: true });
    if (!res.valid) errors.push(res.error);
    else if (res.isPresent) {
      draft.is_current = true;
      draft.end_date = null;
    } else {
      draft.is_current = false;
      draft.end_date = res.value;
    }
  }

  let remainder = normalized
    .replace(/^(?:please\s+)?(?:add|edit|update|set|enter)\s+(?:my\s+)?(?:work\s*experience|employment(?:\s+details)?|previous\s+(?:company|job)|job\s+history)\s*(?:as|to|is|:)?\s*/i, '')
    .trim();

  const dateRange = extractDateRangeFromText(remainder, { allowPresent: true });
  if (dateRange.found) {
    const sRes = parseHirePoolMonthDate(dateRange.rawStart);
    const eRes = parseHirePoolMonthDate(dateRange.rawEnd, { allowPresent: true });
    if (!sRes.valid) errors.push(sRes.error);
    else if (!draft.start_date) draft.start_date = sRes.value;
    if (!eRes.valid) errors.push(eRes.error);
    else if (eRes.isPresent) {
      draft.is_current = true;
      draft.end_date = null;
    } else if (!draft.end_date && !draft.is_current) {
      draft.end_date = eRes.value;
    }
    remainder = remainder.replace(dateRange.matchedText, ' ').replace(/,\s*$/, '').trim();
  }

  if (Object.keys(labeled).length === 0) {
    // Pattern: "<Title> at <Company> [in <Location>]"
    const roleAtMatch = remainder.match(/^(?:worked\s+as\s+(?:a\s+|an\s+)?)?(.+?)\s+at\s+([^,;]+?)(?:\s+in\s+([^,;]+?))?(?:[,;]\s*(.+))?$/i);
    if (roleAtMatch && roleAtMatch[1].length >= 2 && roleAtMatch[2].length >= 2) {
      if (!draft.title) draft.title = roleAtMatch[1].replace(/^(?:as|a|an)\s+/i, '').trim();
      if (!draft.company) draft.company = roleAtMatch[2].replace(/[.,]+$/, '').trim();
      if (!draft.location && roleAtMatch[3]) draft.location = roleAtMatch[3].replace(/[.,]+$/, '').trim();
      if (!draft.description && roleAtMatch[4] && roleAtMatch[4].trim().length > 5) {
        draft.description = roleAtMatch[4].trim();
      }
    } else if (!dateRange.found && remainder && !/\b(?:add|edit|update|cancel|skip|continue)\b/i.test(remainder)) {
      if (expectingField === 'company' && !draft.company) {
        draft.company = remainder.replace(/[.,]+$/, '').trim();
      } else if (expectingField === 'title' && !draft.title) {
        draft.title = remainder.replace(/[.,]+$/, '').trim();
      }
    }
  }

  if (!draft.is_current) {
    const dateOrderError = compareYearMonth(draft.start_date, draft.end_date);
    if (dateOrderError) errors.push(dateOrderError);
  }

  return { draft, errors };
}

function normalizeEducationEntry(item = {}) {
  return {
    institution: typeof item.institution === 'string' ? item.institution.trim() : '',
    degree: typeof item.degree === 'string' ? item.degree.trim() : '',
    ...(typeof item.field_of_study === 'string' && item.field_of_study.trim() ? { field_of_study: item.field_of_study.trim() } : { field_of_study: null }),
    ...(item.start_date ? { start_date: item.start_date } : { start_date: null }),
    ...(item.end_date ? { end_date: item.end_date } : { end_date: null }),
    ...(typeof item.grade === 'string' && item.grade.trim() ? { grade: item.grade.trim() } : { grade: null })
  };
}

function normalizeWorkEntry(item = {}) {
  const isCurrent = Boolean(item.is_current);
  return {
    company: typeof item.company === 'string' ? item.company.trim() : '',
    title: typeof item.title === 'string' ? item.title.trim() : '',
    ...(typeof item.location === 'string' && item.location.trim() ? { location: item.location.trim() } : { location: null }),
    ...(item.start_date ? { start_date: item.start_date } : { start_date: null }),
    end_date: isCurrent ? null : (item.end_date || null),
    is_current: isCurrent,
    ...(typeof item.description === 'string' && item.description.trim() ? { description: item.description.trim() } : { description: null })
  };
}

function educationSignature(item) {
  return [
    normKeyPart(item.institution),
    normKeyPart(item.degree),
    normKeyPart(item.field_of_study),
    normKeyPart(item.start_date),
    normKeyPart(item.end_date)
  ].join('|');
}

function educationLooseSignature(item) {
  return [
    normKeyPart(item.institution),
    normKeyPart(item.degree),
    normKeyPart(item.start_date)
  ].join('|');
}

function workSignature(item) {
  return [
    normKeyPart(item.company),
    normKeyPart(item.title),
    normKeyPart(item.start_date),
    normKeyPart(item.end_date),
    item.is_current ? '1' : '0'
  ].join('|');
}

function workLooseSignature(item) {
  return [
    normKeyPart(item.company),
    normKeyPart(item.title),
    normKeyPart(item.start_date)
  ].join('|');
}

function normalizeCertificationEntry(item = {}) {
  return {
    name: typeof item.name === 'string' ? item.name.trim() : '',
    issuing_organization: typeof item.issuing_organization === 'string' && item.issuing_organization.trim() ? item.issuing_organization.trim() : null,
    issue_date: typeof item.issue_date === 'string' && item.issue_date.trim() ? item.issue_date.trim() : null,
    expiry_date: typeof item.expiry_date === 'string' && item.expiry_date.trim() ? item.expiry_date.trim() : null,
    credential_id: typeof item.credential_id === 'string' && item.credential_id.trim() ? item.credential_id.trim() : null,
    credential_url: typeof item.credential_url === 'string' && item.credential_url.trim() ? item.credential_url.trim() : null
  };
}

function certificationSignature(item) {
  return [
    normKeyPart(item.name),
    normKeyPart(item.issuing_organization),
    normKeyPart(item.issue_date),
    normKeyPart(item.credential_id)
  ].join('|');
}

function certificationLooseSignature(item) {
  return [
    normKeyPart(item.name),
    normKeyPart(item.issuing_organization)
  ].join('|');
}

export function parseCertificationsFromMessage(message, existingDraft = {}, { expectingField = null } = {}) {
  const raw = String(message || '').trim();
  const normalized = normalizeText(raw);
  const draft = {
    name: existingDraft.name || null,
    issuing_organization: existingDraft.issuing_organization || null,
    issue_date: existingDraft.issue_date || null,
    expiry_date: existingDraft.expiry_date || null,
    credential_id: existingDraft.credential_id || null,
    credential_url: existingDraft.credential_url || null
  };
  const errors = [];

  const labeled = extractLabeledFields(raw, {
    name: 'name',
    certification: 'name',
    certificate: 'name',
    cert: 'name',
    'certification name': 'name',
    issuer: 'issuing_organization',
    organization: 'issuing_organization',
    'issuing organization': 'issuing_organization',
    issuing_organization: 'issuing_organization',
    'issued by': 'issuing_organization',
    'issue date': 'issue_date',
    issue_date: 'issue_date',
    issued: 'issue_date',
    'expiry date': 'expiry_date',
    expiry_date: 'expiry_date',
    expiry: 'expiry_date',
    expires: 'expiry_date',
    'credential id': 'credential_id',
    credential_id: 'credential_id',
    'credential url': 'credential_url',
    credential_url: 'credential_url',
    url: 'credential_url'
  });

  if (labeled.name) draft.name = labeled.name.replace(/[.,]+$/, '').trim();
  if (labeled.issuing_organization) draft.issuing_organization = labeled.issuing_organization.replace(/[.,]+$/, '').trim();
  if (labeled.credential_id) draft.credential_id = labeled.credential_id.replace(/[.,]+$/, '').trim();
  if (labeled.credential_url) draft.credential_url = labeled.credential_url.trim();
  if (labeled.issue_date) {
    const res = parseHirePoolMonthDate(labeled.issue_date);
    if (!res.valid) errors.push(res.error);
    else draft.issue_date = res.value;
  }
  if (labeled.expiry_date) {
    const res = parseHirePoolMonthDate(labeled.expiry_date);
    if (!res.valid) errors.push(res.error);
    else draft.expiry_date = res.value;
  }

  let remainder = normalized
    .replace(/^(?:please\s+)?(?:add|edit|update|set|enter)\s+(?:a\s+|an\s+|the\s+|my\s+)?(?:certifications?|certificates?)\s*(?:as|to|is|:)?\s*/i, '')
    .trim();

  if (Object.keys(labeled).length === 0 && remainder) {
    const urlMatch = remainder.match(/(?:\b(?:credential\s+)?url\s*(?:to|as|is|:|=)?\s*)?([a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+)/i);
    if (urlMatch) {
      draft.credential_url = urlMatch[1].replace(/[.,;]+$/, '');
      remainder = remainder.replace(urlMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

    const credIdMatch = remainder.match(/\bcredential\s*(?:id|#)?\s*[:=]?\s*([A-Za-z0-9._-]+)/i);
    if (credIdMatch) {
      draft.credential_id = credIdMatch[1].trim();
      remainder = remainder.replace(credIdMatch[0], ' ').replace(/\s+/g, ' ').trim();
    }

    const dateRange = extractDateRangeFromText(remainder, { allowPresent: false });
    if (dateRange.found) {
      const sRes = parseHirePoolMonthDate(dateRange.rawStart);
      const eRes = parseHirePoolMonthDate(dateRange.rawEnd);
      if (!sRes.valid) errors.push(sRes.error);
      else draft.issue_date = sRes.value;
      if (!eRes.valid) errors.push(eRes.error);
      else draft.expiry_date = eRes.value;
      remainder = remainder.replace(dateRange.matchedText, ' ').replace(/\s+/g, ' ').trim();
    } else {
      const issuedMatch = remainder.match(/\b(?:issued|earned)\s+(?:in\s+|on\s+)?([A-Za-z]+\.?\s+\d{4}|\d{4}-\d{1,2}(?:-\d{1,2})?|\d{1,2}[/-]\d{4}|\d{4})\b/i);
      if (issuedMatch) {
        const res = parseHirePoolMonthDate(issuedMatch[1]);
        if (!res.valid) errors.push(res.error);
        else draft.issue_date = res.value;
        remainder = remainder.replace(issuedMatch[0], ' ').replace(/\s+/g, ' ').trim();
      }
      const expiresMatch = remainder.match(/\b(?:expires?|expiring|expiry(?:\s+date)?|valid\s+(?:until|till))\s+(?:in\s+|on\s+)?([A-Za-z]+\.?\s+\d{4}|\d{4}-\d{1,2}(?:-\d{1,2})?|\d{1,2}[/-]\d{4}|\d{4})\b/i);
      if (expiresMatch) {
        const res = parseHirePoolMonthDate(expiresMatch[1]);
        if (!res.valid) errors.push(res.error);
        else draft.expiry_date = res.value;
        remainder = remainder.replace(expiresMatch[0], ' ').replace(/\s+/g, ' ').trim();
      }
    }

    const byMatch = remainder.match(/^(.+?)\s+(?:by|from)\s+([^,;]+?)(?:\s*[,;]|$)/i);
    if (byMatch) {
      draft.name = byMatch[1].replace(/[.,]+$/, '').trim();
      draft.issuing_organization = byMatch[2].replace(/[.,]+$/, '').trim();
    } else if (expectingField === 'name' && !draft.name && !/\b(?:add|edit|update|cancel|skip|continue)\b/i.test(remainder)) {
      draft.name = remainder.replace(/[.,]+$/, '').trim();
    } else if (!draft.name && remainder.length >= 2 && !/\b(?:add|edit|update|cancel|skip|continue)\b/i.test(remainder)) {
      draft.name = remainder.replace(/[.,]+$/, '').trim();
    }
  }

  const orderErr = compareYearMonth(draft.issue_date, draft.expiry_date);
  if (orderErr) errors.push(orderErr.replace('start date', 'issue date').replace('End date', 'Expiry date'));

  return { draft, errors };
}

function normalizeCandidateWorkTypeToken(raw) {
  const cleaned = normalizeText(raw).toLowerCase().replace(/[\s-]+/g, '_');
  if (cleaned === 'on_site' || cleaned === 'in_office' || cleaned === 'office') return 'onsite';
  return cleaned;
}

function normalizeCandidateJobTypeToken(raw) {
  const cleaned = normalizeText(raw).toLowerCase().replace(/[\s-]+/g, '_');
  if (cleaned === 'fulltime') return 'full_time';
  if (cleaned === 'contractor' || cleaned === 'contractual') return 'contract';
  return cleaned;
}

const NEXT_FIELD_PATTERNS = '(?:my\\s+)?(?:first|last|phone|location|current_?location|job_?title|headline|years?|months?|notice|expected|salary|currency|preferred|work_?types?|job_?types?|linkedin|github|portfolio|personal|open_?to|skills?|summary|certifications?|email|resume)\\b';
const NEXT_FIELD_LOOKAHEAD = `(?=,|;|\\n|$|\\s+(?:and|with)\\s+${NEXT_FIELD_PATTERNS})`;
const NEXT_LIST_FIELD_LOOKAHEAD = `(?:(?=;|\\n|$|,\\s*(?:(?:and|with)\\s+)?${NEXT_FIELD_PATTERNS}|\\s+(?:and|with)\\s+${NEXT_FIELD_PATTERNS}))`;

function stripTrailingConj(val) {
  return String(val || '')
    .replace(/\s+(?:on|in|for)\s+my\s+profile$/i, '')
    .replace(/^[:"']|[:"',.]+$/g, '')
    .trim();
}

export function extractCandidateInlineFields(rawMessage, { pendingField = null } = {}) {
  const raw = String(rawMessage || '').trim();
  const text = normalizeText(raw);
  const patch = {};
  const parseErrors = [];

  const labeled = extractLabeledFields(raw, {
    first_name: 'first_name',
    'first name': 'first_name',
    last_name: 'last_name',
    'last name': 'last_name',
    phone: 'phone',
    'phone number': 'phone',
    mobile: 'phone',
    current_location: 'current_location',
    location: 'current_location',
    city: 'current_location',
    job_title: 'job_title',
    'job title': 'job_title',
    headline: 'job_title',
    years_of_experience: 'years_of_experience',
    'years of experience': 'years_of_experience',
    months_of_experience: 'months_of_experience',
    'months of experience': 'months_of_experience',
    notice_period_days: 'notice_period_days',
    'notice period': 'notice_period_days',
    'notice period days': 'notice_period_days',
    expected_salary_min: 'expected_salary_min',
    'expected salary min': 'expected_salary_min',
    'min salary': 'expected_salary_min',
    expected_salary_max: 'expected_salary_max',
    'expected salary max': 'expected_salary_max',
    'max salary': 'expected_salary_max',
    salary_currency: 'salary_currency',
    'salary currency': 'salary_currency',
    currency: 'salary_currency',
    preferred_work_types: 'preferred_work_types',
    'preferred work types': 'preferred_work_types',
    'work types': 'preferred_work_types',
    preferred_job_types: 'preferred_job_types',
    'preferred job types': 'preferred_job_types',
    'job types': 'preferred_job_types',
    linkedin_url: 'linkedin_url',
    linkedin: 'linkedin_url',
    github_url: 'github_url',
    github: 'github_url',
    portfolio_url: 'portfolio_url',
    portfolio: 'portfolio_url',
    personal_website: 'personal_website',
    'personal website': 'personal_website',
    is_open_to_work: 'is_open_to_work',
    'open to work': 'is_open_to_work'
  });

  if (labeled.first_name) patch.first_name = stripTrailingConj(labeled.first_name);
  if (labeled.last_name) patch.last_name = stripTrailingConj(labeled.last_name);
  if (labeled.phone !== undefined) patch.phone = labeled.phone.trim();
  if (labeled.current_location) patch.current_location = stripTrailingConj(labeled.current_location);
  if (labeled.job_title) patch.job_title = stripTrailingConj(labeled.job_title);
  if (labeled.years_of_experience !== undefined) {
    const n = Number(String(labeled.years_of_experience).replace(/[^\d.-]/g, ''));
    patch.years_of_experience = Number.isFinite(n) ? n : labeled.years_of_experience;
  }
  if (labeled.months_of_experience !== undefined) {
    const n = Number(String(labeled.months_of_experience).replace(/[^\d.-]/g, ''));
    patch.months_of_experience = Number.isFinite(n) ? n : labeled.months_of_experience;
  }
  if (labeled.notice_period_days !== undefined) {
    const rawNotice = labeled.notice_period_days.trim();
    if (/\bimmediate\b/i.test(rawNotice)) patch.notice_period_days = 0;
    else {
      const n = Number(rawNotice.replace(/[^\d.-]/g, ''));
      patch.notice_period_days = Number.isFinite(n) ? n : rawNotice;
    }
  }
  if (labeled.expected_salary_min !== undefined) {
    const n = Number(String(labeled.expected_salary_min).replace(/[,\s]/g, '').replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n)) patch.expected_salary_min = /\blpa\b/i.test(labeled.expected_salary_min) ? n * 100000 : n;
  }
  if (labeled.expected_salary_max !== undefined) {
    const n = Number(String(labeled.expected_salary_max).replace(/[,\s]/g, '').replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n)) patch.expected_salary_max = /\blpa\b/i.test(labeled.expected_salary_max) ? n * 100000 : n;
  }
  if (labeled.salary_currency) {
    patch.salary_currency = labeled.salary_currency.trim().toUpperCase();
  }
  if (labeled.preferred_work_types) {
    patch.preferred_work_types = labeled.preferred_work_types
      .split(/[,;/]+|\s+and\s+/i)
      .map(normalizeCandidateWorkTypeToken)
      .filter(Boolean);
  }
  if (labeled.preferred_job_types) {
    patch.preferred_job_types = labeled.preferred_job_types
      .split(/[,;/]+|\s+and\s+/i)
      .map(normalizeCandidateJobTypeToken)
      .filter(Boolean);
  }
  for (const urlField of ['linkedin_url', 'github_url', 'portfolio_url', 'personal_website']) {
    if (labeled[urlField] !== undefined) {
      patch[urlField] = labeled[urlField].trim().replace(/[.,;]+$/, '');
    }
  }
  if (labeled.is_open_to_work !== undefined) {
    const rawBool = labeled.is_open_to_work.trim().toLowerCase();
    if (/^(?:true|yes|1|open)$/.test(rawBool)) patch.is_open_to_work = true;
    else if (/^(?:false|no|0|closed)$/.test(rawBool)) patch.is_open_to_work = false;
    else patch.is_open_to_work = rawBool;
  }

  // Freeform NL extractors for scalar, preference, and link fields
  if (patch.first_name === undefined) {
    const m = text.match(new RegExp(`\\bfirst\\s+name\\s+(?:to|as|is|=|:)\\s+(.+?)${NEXT_FIELD_LOOKAHEAD}`, 'i'));
    if (m) patch.first_name = stripTrailingConj(m[1]);
  }
  if (patch.last_name === undefined) {
    const m = text.match(new RegExp(`\\blast\\s+name\\s+(?:to|as|is|=|:)\\s+(.+?)${NEXT_FIELD_LOOKAHEAD}`, 'i'));
    if (m) patch.last_name = stripTrailingConj(m[1]);
  }
  if (patch.phone === undefined) {
    const m = text.match(new RegExp(`\\b(?:phone(?:\\s+number)?|mobile(?:\\s+number)?|contact\\s+number)\\s+(?:to|as|is|=|:)\\s+([^,;]+?)${NEXT_FIELD_LOOKAHEAD}`, 'i'));
    if (m) patch.phone = m[1].trim().replace(/[.,;]+$/, '');
  }
  if (patch.current_location === undefined) {
    const m = text.match(new RegExp(`\\b(?:current\\s+location|current_location|location|city)\\s+(?:to|as|is|=|:)\\s+(.+?)${NEXT_FIELD_LOOKAHEAD}`, 'i'));
    if (m) patch.current_location = stripTrailingConj(m[1]);
  }
  if (patch.job_title === undefined) {
    const m = text.match(new RegExp(`\\b(?:job\\s+title|job_title|headline|role\\s+title)\\s+(?:to|as|is|=|:)\\s+(.+?)${NEXT_FIELD_LOOKAHEAD}`, 'i'));
    if (m) patch.job_title = stripTrailingConj(m[1]);
  }
  if (patch.years_of_experience === undefined) {
    const m =
      text.match(/\byears?\s+of\s+experience\s+(?:to|as|is|=|:)\s*(-?\d+(?:\.\d+)?)\b/i) ||
      text.match(/\b(\d+)\s+years?\b(?:\s+and\s+\d+\s+months?)?\s+(?:of\s+)?experience\b/i) ||
      text.match(/\bexperience\s+(?:to|as|is|=|:)\s*(\d+)\s+years?\b/i);
    if (m) patch.years_of_experience = Number(m[1]);
  }
  if (patch.months_of_experience === undefined) {
    const m =
      text.match(/\bmonths?\s+of\s+experience\s+(?:to|as|is|=|:)\s*(-?\d+(?:\.\d+)?)\b/i) ||
      text.match(/\b(?:\d+\s+years?\s+(?:and\s+)?)?(\d+)\s+months?\s+(?:of\s+)?experience\b/i) ||
      text.match(/\bexperience\s+(?:to|as|is|=|:)\s*(?:\d+\s+years?(?:\s+and|\s*,|\s+)?)?(\d+)\s+months?\b/i);
    if (m) patch.months_of_experience = Number(m[1]);
  }
  if (patch.notice_period_days === undefined) {
    if (/\bnotice\s+period\b.*\bimmediate\b|\bimmediate\s+notice\s+period\b/i.test(text)) {
      patch.notice_period_days = 0;
    } else {
      const m = text.match(/\bnotice\s+period(?:\s+days)?\s+(?:to|as|is|=|:)?\s*(-?\d+)\s*(?:days?)?\b/i);
      if (m) patch.notice_period_days = Number(m[1]);
    }
  }
  if (patch.expected_salary_min === undefined && patch.expected_salary_max === undefined) {
    const rangeLpa = text.match(/\bexpected\s+salary\s+(?:range\s+)?(?:to|as|is|of|from|=|:)?\s*(\d+(?:\.\d+)?)\s*(?:lpa)?\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*lpa\b(?:\s*(inr|usd|eur|gbp))?/i);
    const rangeAbs = text.match(/\bexpected\s+salary\s+(?:range\s+)?(?:to|as|is|of|from|=|:)?\s*([\d,]+)\s*(?:-|to)\s*([\d,]+)\s*(inr|usd|eur|gbp)?\b/i);
    const minOnly = text.match(/\bexpected[_\s]+salary[_\s]+min\s+(?:to|as|is|=|:)?\s*([\d,]+)(?:\s*(lpa))?\b/i);
    const maxOnly = text.match(/\bexpected[_\s]+salary[_\s]+max\s+(?:to|as|is|=|:)?\s*([\d,]+)(?:\s*(lpa))?\b/i);
    if (rangeLpa) {
      patch.expected_salary_min = Math.round(Number(rangeLpa[1]) * 100000);
      patch.expected_salary_max = Math.round(Number(rangeLpa[2]) * 100000);
      if (rangeLpa[3]) patch.salary_currency = rangeLpa[3].toUpperCase();
    } else if (rangeAbs) {
      patch.expected_salary_min = Number(rangeAbs[1].replace(/,/g, ''));
      patch.expected_salary_max = Number(rangeAbs[2].replace(/,/g, ''));
      if (rangeAbs[3]) patch.salary_currency = rangeAbs[3].toUpperCase();
    } else {
      if (minOnly) {
        const val = Number(minOnly[1].replace(/,/g, ''));
        patch.expected_salary_min = minOnly[2] ? Math.round(val * 100000) : val;
      }
      if (maxOnly) {
        const val = Number(maxOnly[1].replace(/,/g, ''));
        patch.expected_salary_max = maxOnly[2] ? Math.round(val * 100000) : val;
      }
    }
  }
  if (patch.salary_currency === undefined) {
    const curMatch = text.match(/\b(?:salary[_\s]+currency|currency)\s+(?:to|as|is|=|:)\s*([A-Za-z]{2,5})\b/i);
    if (curMatch) patch.salary_currency = curMatch[1].toUpperCase();
  }
  if (patch.preferred_work_types === undefined) {
    const wtMatch = text.match(new RegExp(`\\b(?:preferred[\\s_]+work[\\s_]+types?|work(?:\\s+type)?\\s+preferences?|work\\s+types?)\\s+(?:to|as|are|is|=|:)\\s*(.+?)${NEXT_LIST_FIELD_LOOKAHEAD}`, 'i'));
    if (wtMatch) {
      patch.preferred_work_types = wtMatch[1]
        .split(/[,;/]+|\s+and\s+/i)
        .map(normalizeCandidateWorkTypeToken)
        .filter(Boolean);
    }
  }
  if (patch.preferred_job_types === undefined) {
    const jtMatch = text.match(new RegExp(`\\b(?:preferred[\\s_]+job[\\s_]+types?|job(?:\\s+type)?\\s+preferences?|job\\s+types?)\\s+(?:to|as|are|is|=|:)\\s*(.+?)${NEXT_LIST_FIELD_LOOKAHEAD}`, 'i'));
    if (jtMatch) {
      patch.preferred_job_types = jtMatch[1]
        .split(/[,;/]+|\s+and\s+/i)
        .map(normalizeCandidateJobTypeToken)
        .filter(Boolean);
    }
  }
  for (const [field, pattern] of [
    ['linkedin_url', /\b(?:linkedin(?:\s+url)?|linkedin_url)\s+(?:to|as|is|=|:)\s*([^\s,;]+)/i],
    ['github_url', /\b(?:github(?:\s+url)?|github_url)\s+(?:to|as|is|=|:)\s*([^\s,;]+)/i],
    ['portfolio_url', /\b(?:portfolio(?:\s+url)?|portfolio_url)\s+(?:to|as|is|=|:)\s*([^\s,;]+)/i],
    ['personal_website', /\b(?:personal\s+website|personal_website)\s+(?:to|as|is|=|:)\s*([^\s,;]+)/i]
  ]) {
    if (patch[field] === undefined) {
      const m = text.match(pattern);
      if (m) patch[field] = m[1].trim().replace(/[.,;]+$/, '');
    }
  }
  if (patch.is_open_to_work === undefined) {
    const openMatch = text.match(/\b(?:is_open_to_work|open\s+to\s+work(?:\s+status)?)\s+(?:to|as|is|=|:)?\s*(true|false|yes|no)\b/i);
    if (openMatch) {
      patch.is_open_to_work = /^(?:true|yes)$/i.test(openMatch[1]);
    } else if (/\bnot\s+open\s+to\s+work\b/i.test(text)) {
      patch.is_open_to_work = false;
    } else if (/\b(?:mark\s+me\s+(?:as\s+)?|set\s+(?:me\s+)?(?:as\s+)?|i\s+am\s+)open\s+to\s+work\b/i.test(text)) {
      patch.is_open_to_work = true;
    }
  }

  // Inline skills extraction inside multi-field turns (e.g., "... and add skills Python, FastAPI")
  let inlineSkillsMeta = null;
  const inlineSkillsMatch = raw.match(/\b(?:(add|replace|set|remove|update)\s+)?skills?\s*(?:to|as|with|:)?\s*([^.!?\n]+)$/i);
  if (inlineSkillsMatch && !isSkillInstructionPhrase(inlineSkillsMatch[2])) {
    const skillCmd = (inlineSkillsMatch[1] ? `${inlineSkillsMatch[1]} skills ` : '') + inlineSkillsMatch[2];
    const parsedSkills = parseSkillsInput(skillCmd, [], inlineSkillsMatch[1] ? inlineSkillsMatch[1].toLowerCase() : 'add');
    if (parsedSkills.kind === 'values' && parsedSkills.skills.length > 0) {
      inlineSkillsMeta = parsedSkills;
    }
  }

  // Single-field answer resolution when assistant explicitly asked for one field
  if (Object.keys(patch).length === 0 && pendingField && raw && !isSkillInstructionPhrase(raw)) {
    const val = raw.trim();
    if (pendingField === 'years_of_experience' || pendingField === 'months_of_experience' || pendingField === 'notice_period_days') {
      const n = Number(val.replace(/[^\d.-]/g, ''));
      patch[pendingField] = Number.isFinite(n) ? n : val;
    } else if (pendingField === 'expected_salary_min' || pendingField === 'expected_salary_max') {
      const n = Number(val.replace(/[,\s]/g, '').replace(/[^\d.-]/g, ''));
      patch[pendingField] = Number.isFinite(n) ? (/\blpa\b/i.test(val) ? n * 100000 : n) : val;
    } else if (pendingField === 'preferred_work_types') {
      patch.preferred_work_types = val.split(/[,;/]+|\s+and\s+/i).map(normalizeCandidateWorkTypeToken).filter(Boolean);
    } else if (pendingField === 'preferred_job_types') {
      patch.preferred_job_types = val.split(/[,;/]+|\s+and\s+/i).map(normalizeCandidateJobTypeToken).filter(Boolean);
    } else if (pendingField === 'is_open_to_work') {
      if (/^(?:true|yes|1|open)$/i.test(val)) patch.is_open_to_work = true;
      else if (/^(?:false|no|0|closed)$/i.test(val)) patch.is_open_to_work = false;
      else patch.is_open_to_work = val;
    } else if (pendingField === 'salary_currency') {
      patch.salary_currency = val.toUpperCase();
    } else {
      patch[pendingField] = val;
    }
  }

  return { patch, inlineSkillsMeta, parseErrors };
}

function detectUnsupportedCandidateRequest(raw) {
  const text = normalizeText(raw);
  if (/\b(?:update|change|edit|modify|set|replace|remove)\s+(?:my\s+|the\s+)?(?:profile\s+)?email(?:\s+address)?\b|\bemail\s*(?:to|as|=|:)\s*\S+@\S+/i.test(text)) {
    return 'Account email cannot be updated via the HirePool candidate profile endpoint (`PUT /api/v1/candidates/profile`). Email changes must be made in your HirePool account authentication settings.';
  }
  if (/\b(?:upload|update|change|edit|replace|remove)\s+(?:my\s+|the\s+)?(?:resume|cv)\b/i.test(text)) {
    return 'Resume uploads (`POST /api/v1/candidates/profile/resume`) require a file upload (`multipart/form-data`) directly on the HirePool dashboard and cannot be completed through text chat.';
  }
  if (/\b(?:upload|update|change|edit|replace|remove)\s+(?:my\s+|the\s+)?(?:profile\s+)?(?:picture|photo|avatar|logo)\b/i.test(text)) {
    return 'Profile photo uploads (`POST /api/v1/candidates/profile/photo`) require a multipart image upload directly on HirePool and cannot be updated via text chat.';
  }
  if (/\b(?:company_name|company_size|gst_tax_id|gstin|registration_number|consultancy_name|consultancy_type|industry_specialization|verification_status|candidate_pool_size|company\s+profile|consultancy\s+profile)\b/i.test(text)) {
    return 'Company/Employer and Consultancy profile fields apply only to **Client / Employer** or **Consultancy** accounts, not **Candidate** profiles.';
  }
  return null;
}

/**
 * Validate partial or full candidate profile update payload against HirePool UI & backend schema rules.
 */
export function validateCandidateProfileUpdatePayload(body, existingProfile = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    return {
      isValid: false,
      errors: { body: 'Provide at least one candidate profile field to update.' },
      firstError: 'Provide at least one candidate profile field to update.',
      sanitizedBody: {}
    };
  }

  const errors = {};
  const sanitized = { ...body };

  for (const key of Object.keys(sanitized)) {
    if (!ALLOWED_CANDIDATE_PROFILE_FIELDS.has(key)) {
      errors[key] = `"${key}" is not a supported editable field on CandidateProfileUpdate.`;
    }
  }

  if (Object.hasOwn(sanitized, 'first_name')) {
    const val = typeof sanitized.first_name === 'string' ? sanitized.first_name.trim() : '';
    if (!val || val.length > 100) errors.first_name = 'First name must be between 1 and 100 characters.';
    else sanitized.first_name = val;
  }
  if (Object.hasOwn(sanitized, 'last_name')) {
    const val = typeof sanitized.last_name === 'string' ? sanitized.last_name.trim() : '';
    if (!val || val.length > 100) errors.last_name = 'Last name must be between 1 and 100 characters.';
    else sanitized.last_name = val;
  }
  if (Object.hasOwn(sanitized, 'phone')) {
    const res = validatePhoneNumber(sanitized.phone, { required: false, fieldLabel: 'Phone number' });
    if (!res.isValid) errors.phone = res.error;
    else sanitized.phone = res.digits || null;
  }
  if (Object.hasOwn(sanitized, 'current_location')) {
    const val = typeof sanitized.current_location === 'string' ? sanitized.current_location.trim() : '';
    if (!val || val.length > 255) errors.current_location = 'Location must be between 1 and 255 characters.';
    else sanitized.current_location = val;
  }
  if (Object.hasOwn(sanitized, 'job_title')) {
    const val = typeof sanitized.job_title === 'string' ? sanitized.job_title.trim() : '';
    if (!val || val.length > 255) errors.job_title = 'Job title must be between 1 and 255 characters.';
    else sanitized.job_title = val;
  }
  if (Object.hasOwn(sanitized, 'professional_summary')) {
    const val = typeof sanitized.professional_summary === 'string' ? sanitized.professional_summary.trim() : '';
    if (!val) errors.professional_summary = 'Professional summary cannot be empty.';
    else if (val.length > 2000) errors.professional_summary = 'Professional summary cannot exceed 2000 characters.';
    else sanitized.professional_summary = val;
  }
  if (Object.hasOwn(sanitized, 'years_of_experience')) {
    const num = Number(sanitized.years_of_experience);
    const err = rangeError('Years of experience', num, LIMITS.yearsExperience.min, LIMITS.yearsExperience.max);
    if (!Number.isFinite(num) || !Number.isInteger(num) || err) {
      errors.years_of_experience = err || 'Years of experience must be an integer between 0 and 50.';
    } else {
      sanitized.years_of_experience = num;
    }
  }
  if (Object.hasOwn(sanitized, 'months_of_experience')) {
    const num = Number(sanitized.months_of_experience);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < LIMITS.monthsExperience.min || num > LIMITS.monthsExperience.max) {
      errors.months_of_experience = 'Months of experience must be between 0 and 11.';
    } else {
      sanitized.months_of_experience = num;
    }
  }
  if (Object.hasOwn(sanitized, 'notice_period_days')) {
    const num = Number(sanitized.notice_period_days);
    const err = rangeError('Notice period', num, LIMITS.noticeDays.min, LIMITS.noticeDays.max, ' days');
    if (!Number.isFinite(num) || !Number.isInteger(num) || err) {
      errors.notice_period_days = err || 'Notice period must be an integer between 0 and 180 days.';
    } else {
      sanitized.notice_period_days = num;
    }
  }

  for (const salField of ['expected_salary_min', 'expected_salary_max']) {
    if (Object.hasOwn(sanitized, salField) && sanitized[salField] !== null && sanitized[salField] !== '') {
      const num = Number(sanitized[salField]);
      const label = salField === 'expected_salary_min' ? 'Minimum expected salary' : 'Maximum expected salary';
      const err = rangeError(label, num, LIMITS.expectedSalaryInr.min, LIMITS.expectedSalaryInr.max);
      if (!Number.isFinite(num) || err) errors[salField] = err || `${label} cannot exceed 50,000,000.`;
      else sanitized[salField] = Math.floor(num);
    }
  }
  const effMin = Object.hasOwn(sanitized, 'expected_salary_min') ? sanitized.expected_salary_min : existingProfile?.expected_salary_min;
  const effMax = Object.hasOwn(sanitized, 'expected_salary_max') ? sanitized.expected_salary_max : existingProfile?.expected_salary_max;
  if (Number.isFinite(effMin) && Number.isFinite(effMax) && effMin > effMax) {
    errors.expected_salary_min = 'The minimum expected salary cannot be more than the maximum.';
  }

  if (Object.hasOwn(sanitized, 'salary_currency')) {
    const cur = String(sanitized.salary_currency || '').trim().toUpperCase();
    if (!HIREPOOL_CURRENCIES.includes(cur)) {
      errors.salary_currency = `Salary currency must be one of: ${HIREPOOL_CURRENCIES.join(', ')}.`;
    } else {
      sanitized.salary_currency = cur;
    }
  }

  if (Object.hasOwn(sanitized, 'preferred_work_types')) {
    if (!Array.isArray(sanitized.preferred_work_types)) {
      errors.preferred_work_types = 'Preferred work types must be a list (e.g. remote, hybrid, onsite).';
    } else {
      const validSet = new Set();
      for (const rawItem of sanitized.preferred_work_types) {
        const matched = matchAllowedOption(normalizeCandidateWorkTypeToken(rawItem), WORK_TYPES);
        if (!matched) {
          errors.preferred_work_types = `Unsupported work type "${rawItem}". Allowed values: ${WORK_TYPES.join(', ')}.`;
          break;
        }
        validSet.add(matched);
      }
      if (!errors.preferred_work_types) sanitized.preferred_work_types = [...validSet];
    }
  }

  if (Object.hasOwn(sanitized, 'preferred_job_types')) {
    if (!Array.isArray(sanitized.preferred_job_types)) {
      errors.preferred_job_types = 'Preferred job types must be a list (full_time, contract).';
    } else {
      const validSet = new Set();
      for (const rawItem of sanitized.preferred_job_types) {
        const matched = matchAllowedOption(normalizeCandidateJobTypeToken(rawItem), JOB_TYPES);
        if (!matched) {
          errors.preferred_job_types = `HirePool supports only full_time and contract for preferred_job_types ("${rawItem}" is not valid).`;
          break;
        }
        validSet.add(matched);
      }
      if (!errors.preferred_job_types) sanitized.preferred_job_types = [...validSet];
    }
  }

  if (Object.hasOwn(sanitized, 'is_open_to_work')) {
    if (typeof sanitized.is_open_to_work === 'boolean') {
      // valid
    } else if (/^(?:true|false)$/i.test(String(sanitized.is_open_to_work))) {
      sanitized.is_open_to_work = String(sanitized.is_open_to_work).toLowerCase() === 'true';
    } else {
      errors.is_open_to_work = 'Open to work status must be true or false.';
    }
  }

  for (const urlField of ['linkedin_url', 'github_url', 'portfolio_url', 'personal_website']) {
    if (Object.hasOwn(sanitized, urlField)) {
      if (sanitized[urlField] === '' || sanitized[urlField] === null) {
        sanitized[urlField] = null;
      } else {
        const urlRes = validateWebsiteUrl(sanitized[urlField], { required: false, fieldLabel: urlField.replace(/_/g, ' ') });
        if (!urlRes.isValid) errors[urlField] = urlRes.error;
        else sanitized[urlField] = urlRes.sanitized;
      }
    }
  }

  if (Object.hasOwn(sanitized, 'skills')) {
    const rawList = Array.isArray(sanitized.skills)
      ? sanitized.skills
      : (typeof sanitized.skills === 'string' ? sanitized.skills.split(/[,;\n]+/) : []);
    const { skills: cleanSkills } = normalizeSkillsArray(rawList);
    if (cleanSkills.length === 0) {
      errors.skills = 'Provide at least one valid skill (instruction text is not accepted as a skill name).';
    } else {
      sanitized.skills = cleanSkills;
    }
  }

  if (Object.hasOwn(sanitized, 'education')) {
    if (!Array.isArray(sanitized.education)) {
      errors.education = 'Education must be a list of entries.';
    } else {
      const cleaned = [];
      for (let i = 0; i < sanitized.education.length; i += 1) {
        const entry = normalizeEducationEntry(sanitized.education[i]);
        const res = validateEducationItem(entry);
        if (!res.isValid) {
          errors[`education.${i}`] = res.error;
          break;
        }
        if (entry.institution.length > 255) {
          errors[`education.${i}`] = 'Institution cannot exceed 255 characters.';
          break;
        }
        if (entry.degree.length > 150) {
          errors[`education.${i}`] = 'Degree cannot exceed 150 characters.';
          break;
        }
        const sParsed = parseHirePoolMonthDate(entry.start_date);
        const eParsed = parseHirePoolMonthDate(entry.end_date);
        if (!sParsed.valid) {
          errors[`education.${i}`] = sParsed.error;
          break;
        }
        if (!eParsed.valid) {
          errors[`education.${i}`] = eParsed.error;
          break;
        }
        entry.start_date = sParsed.value;
        entry.end_date = eParsed.value;
        const orderErr = compareYearMonth(entry.start_date, entry.end_date);
        if (orderErr) {
          errors[`education.${i}`] = orderErr;
          break;
        }
        cleaned.push(entry);
      }
      sanitized.education = cleaned;
    }
  }

  if (Object.hasOwn(sanitized, 'work_experience')) {
    if (!Array.isArray(sanitized.work_experience)) {
      errors.work_experience = 'Work experience must be a list of entries.';
    } else {
      const cleaned = [];
      for (let i = 0; i < sanitized.work_experience.length; i += 1) {
        const entry = normalizeWorkEntry(sanitized.work_experience[i]);
        const res = validateWorkExperienceItem(entry);
        if (!res.isValid) {
          errors[`work_experience.${i}`] = res.error;
          break;
        }
        if (entry.company.length > 255) {
          errors[`work_experience.${i}`] = 'Company name cannot exceed 255 characters.';
          break;
        }
        if (entry.title.length > 150) {
          errors[`work_experience.${i}`] = 'Job title cannot exceed 150 characters.';
          break;
        }
        const sParsed = parseHirePoolMonthDate(entry.start_date);
        const eParsed = parseHirePoolMonthDate(entry.end_date, { allowPresent: true });
        if (!sParsed.valid) {
          errors[`work_experience.${i}`] = sParsed.error;
          break;
        }
        if (!eParsed.valid) {
          errors[`work_experience.${i}`] = eParsed.error;
          break;
        }
        entry.start_date = sParsed.value;
        if (eParsed.isPresent || entry.is_current) {
          entry.is_current = true;
          entry.end_date = null;
        } else {
          entry.end_date = eParsed.value;
        }
        if (!entry.is_current) {
          const orderErr = compareYearMonth(entry.start_date, entry.end_date);
          if (orderErr) {
            errors[`work_experience.${i}`] = orderErr;
            break;
          }
        }
        cleaned.push(entry);
      }
      sanitized.work_experience = cleaned;
    }
  }

  if (Object.hasOwn(sanitized, 'certifications')) {
    if (!Array.isArray(sanitized.certifications)) {
      errors.certifications = 'Certifications must be a list of entries.';
    } else {
      const cleaned = [];
      for (let i = 0; i < sanitized.certifications.length; i += 1) {
        const entry = normalizeCertificationEntry(sanitized.certifications[i]);
        if (!entry.name || entry.name.length > 200) {
          errors[`certifications.${i}`] = 'Certification name is required (max 200 characters).';
          break;
        }
        const sParsed = parseHirePoolMonthDate(entry.issue_date);
        const eParsed = parseHirePoolMonthDate(entry.expiry_date);
        if (!sParsed.valid) {
          errors[`certifications.${i}`] = sParsed.error;
          break;
        }
        if (!eParsed.valid) {
          errors[`certifications.${i}`] = eParsed.error;
          break;
        }
        entry.issue_date = sParsed.value;
        entry.expiry_date = eParsed.value;
        const orderErr = compareYearMonth(entry.issue_date, entry.expiry_date);
        if (orderErr) {
          errors[`certifications.${i}`] = 'Expiry date cannot be earlier than issue date.';
          break;
        }
        if (entry.credential_url) {
          const urlRes = validateWebsiteUrl(entry.credential_url, { required: false, fieldLabel: 'Credential URL' });
          if (!urlRes.isValid) {
            errors[`certifications.${i}`] = urlRes.error;
            break;
          }
          entry.credential_url = urlRes.sanitized;
        }
        cleaned.push(entry);
      }
      sanitized.certifications = cleaned;
    }
  }

  const isValid = Object.keys(errors).length === 0;
  return {
    isValid,
    errors,
    firstError: Object.values(errors)[0] || null,
    sanitizedBody: sanitized
  };
}

/**
 * Merge an incoming partial profile update with existing `GET /api/v1/candidates/profile`
 * state so `PUT /api/v1/candidates/profile` preserves untouched list entries, handles
 * add/edit/replace/remove accurately, and deduplicates retries cleanly.
 */
export function mergeCandidateProfileUpdate(currentProfile = {}, requestedBody = {}, {
  operation = 'add',
  targetIndex = null
} = {}) {
  const mergedBody = { ...requestedBody };

  if (Array.isArray(requestedBody.education)) {
    const existingList = (Array.isArray(currentProfile?.education) ? currentProfile.education : [])
      .map(normalizeEducationEntry);
    const incomingList = requestedBody.education.map(normalizeEducationEntry);

    if (operation === 'edit' && Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < existingList.length && incomingList.length === 1) {
      const next = [...existingList];
      const patch = incomingList[0];
      next[targetIndex] = {
        ...existingList[targetIndex],
        ...(patch.institution ? { institution: patch.institution } : {}),
        ...(patch.degree ? { degree: patch.degree } : {}),
        ...(patch.field_of_study ? { field_of_study: patch.field_of_study } : {}),
        ...(patch.start_date ? { start_date: patch.start_date } : {}),
        ...(patch.end_date ? { end_date: patch.end_date } : {}),
        ...(patch.grade ? { grade: patch.grade } : {})
      };
      mergedBody.education = next;
    } else if (operation !== 'replace_all' && operation !== 'exact') {
      const combined = [...existingList];
      for (const item of incomingList) {
        const exactSig = educationSignature(item);
        const looseSig = educationLooseSignature(item);
        const existingIdx = combined.findIndex(existing =>
          educationSignature(existing) === exactSig ||
          (normKeyPart(item.institution) && normKeyPart(item.degree) && educationLooseSignature(existing) === looseSig)
        );
        if (existingIdx >= 0) {
          combined[existingIdx] = {
            ...combined[existingIdx],
            ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null && v !== ''))
          };
        } else {
          combined.push(item);
        }
      }
      mergedBody.education = combined;
    }
  }

  if (Array.isArray(requestedBody.work_experience)) {
    const existingList = (Array.isArray(currentProfile?.work_experience) ? currentProfile.work_experience : [])
      .map(normalizeWorkEntry);
    const incomingList = requestedBody.work_experience.map(normalizeWorkEntry);

    if (operation === 'edit' && Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < existingList.length && incomingList.length === 1) {
      const next = [...existingList];
      const patch = incomingList[0];
      const isCurrent = Object.hasOwn(requestedBody.work_experience[0] || {}, 'is_current')
        ? patch.is_current
        : existingList[targetIndex].is_current;
      next[targetIndex] = {
        ...existingList[targetIndex],
        ...(patch.company ? { company: patch.company } : {}),
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.location ? { location: patch.location } : {}),
        ...(patch.start_date ? { start_date: patch.start_date } : {}),
        ...(isCurrent ? { is_current: true, end_date: null } : (patch.end_date ? { is_current: false, end_date: patch.end_date } : {})),
        ...(patch.description ? { description: patch.description } : {})
      };
      mergedBody.work_experience = next;
    } else if (operation !== 'replace_all' && operation !== 'exact') {
      const combined = [...existingList];
      for (const item of incomingList) {
        const exactSig = workSignature(item);
        const looseSig = workLooseSignature(item);
        const existingIdx = combined.findIndex(existing =>
          workSignature(existing) === exactSig ||
          (normKeyPart(item.company) && normKeyPart(item.title) && workLooseSignature(existing) === looseSig)
        );
        if (existingIdx >= 0) {
          combined[existingIdx] = {
            ...combined[existingIdx],
            ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null && v !== ''))
          };
        } else {
          combined.push(item);
        }
      }
      mergedBody.work_experience = combined;
    }
  }

  if (Array.isArray(requestedBody.certifications)) {
    const existingList = (Array.isArray(currentProfile?.certifications) ? currentProfile.certifications : [])
      .map(normalizeCertificationEntry);
    const incomingList = requestedBody.certifications.map(normalizeCertificationEntry);

    if (operation === 'edit' && Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < existingList.length && incomingList.length === 1) {
      const next = [...existingList];
      const patch = incomingList[0];
      next[targetIndex] = {
        ...existingList[targetIndex],
        ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== ''))
      };
      mergedBody.certifications = next;
    } else if (operation !== 'replace_all' && operation !== 'exact') {
      const combined = [...existingList];
      for (const item of incomingList) {
        const exactSig = certificationSignature(item);
        const looseSig = certificationLooseSignature(item);
        const existingIdx = combined.findIndex(existing =>
          certificationSignature(existing) === exactSig ||
          (normKeyPart(item.name) && certificationLooseSignature(existing) === looseSig)
        );
        if (existingIdx >= 0) {
          combined[existingIdx] = {
            ...combined[existingIdx],
            ...Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null && v !== ''))
          };
        } else {
          combined.push(item);
        }
      }
      mergedBody.certifications = combined;
    }
  }

  if (Array.isArray(requestedBody.skills)) {
    const existingSkills = Array.isArray(currentProfile?.skills) ? currentProfile.skills : [];
    const { skills: incomingNormalized } = normalizeSkillsArray(requestedBody.skills);

    if (operation === 'add') {
      const { skills: unionSkills } = normalizeSkillsArray([...existingSkills, ...incomingNormalized]);
      mergedBody.skills = unionSkills;
    } else if (operation === 'remove') {
      const removeKeys = new Set(incomingNormalized.map(s => s.toLowerCase()));
      mergedBody.skills = existingSkills.filter(s => !removeKeys.has(String(s || '').trim().toLowerCase()));
    } else {
      mergedBody.skills = incomingNormalized;
    }
  }

  return mergedBody;
}

/**
 * Format structured human-readable review summary with `current -> proposed` diff
 * for candidate profile PUT confirmation.
 */
export function formatCandidateProfileReview(body, currentProfile = {}, nextSectionLabel = null, { notes = [] } = {}) {
  const fields = [];
  const lines = ['Review your proposed HirePool candidate profile update:'];

  if (typeof body.professional_summary === 'string') {
    const prev = currentProfile?.professional_summary ? `"${currentProfile.professional_summary}"` : '(none)';
    fields.push({ label: 'Professional Summary', value: body.professional_summary });
    lines.push(`- **Professional Summary:** ${currentProfile?.professional_summary ? `${prev} -> ` : ''}${body.professional_summary}`);
  }
  if (Array.isArray(body.education)) {
    const existingCount = Array.isArray(currentProfile?.education) ? currentProfile.education.length : 0;
    const summaryEntries = body.education.map((edu, idx) => {
      const span = [edu.start_date, edu.end_date].filter(Boolean).join(' to ');
      const parts = [edu.degree, edu.field_of_study, edu.institution].filter(Boolean).join(' — ');
      return `${idx + 1}. ${parts}${span ? ` (${span})` : ''}${edu.grade ? ` [${edu.grade}]` : ''}`;
    });
    fields.push({
      label: `Education (${body.education.length} total, ${existingCount} existing)`,
      value: summaryEntries.length ? summaryEntries.join(' | ') : '(cleared)'
    });
    lines.push(`- **Education (${body.education.length} total, ${existingCount} existing):**`, ...summaryEntries.map(s => `  - ${s}`));
  }
  if (Array.isArray(body.work_experience)) {
    const existingCount = Array.isArray(currentProfile?.work_experience) ? currentProfile.work_experience.length : 0;
    const summaryEntries = body.work_experience.map((exp, idx) => {
      const span = [exp.start_date, exp.is_current ? 'Present' : exp.end_date].filter(Boolean).join(' to ');
      return `${idx + 1}. ${exp.title} at ${exp.company}${exp.location ? `, ${exp.location}` : ''}${span ? ` (${span})` : ''}`;
    });
    fields.push({
      label: `Work Experience (${body.work_experience.length} total, ${existingCount} existing)`,
      value: summaryEntries.length ? summaryEntries.join(' | ') : '(cleared)'
    });
    lines.push(`- **Work Experience (${body.work_experience.length} total, ${existingCount} existing):**`, ...summaryEntries.map(s => `  - ${s}`));
  }
  if (Array.isArray(body.certifications)) {
    const existingCount = Array.isArray(currentProfile?.certifications) ? currentProfile.certifications.length : 0;
    const summaryEntries = body.certifications.map((cert, idx) => {
      const span = [cert.issue_date, cert.expiry_date].filter(Boolean).join(' to ');
      const parts = [cert.name, cert.issuing_organization].filter(Boolean).join(' — ');
      return `${idx + 1}. ${parts}${span ? ` (${span})` : ''}${cert.credential_id ? ` [${cert.credential_id}]` : ''}`;
    });
    fields.push({
      label: `Certifications (${body.certifications.length} total, ${existingCount} existing)`,
      value: summaryEntries.length ? summaryEntries.join(' | ') : '(none)'
    });
    lines.push(`- **Certifications (${body.certifications.length} total):**`, ...summaryEntries.map(s => `  - ${s}`));
  }
  if (Array.isArray(body.skills)) {
    const existingSkills = Array.isArray(currentProfile?.skills) ? currentProfile.skills : [];
    const existingKeys = new Set(existingSkills.map(s => String(s).trim().toLowerCase()));
    const nextKeys = new Set(body.skills.map(s => String(s).trim().toLowerCase()));
    const added = body.skills.filter(s => !existingKeys.has(s.toLowerCase()));
    const removed = existingSkills.filter(s => !nextKeys.has(String(s).trim().toLowerCase()));
    const diffHints = [];
    if (added.length) diffHints.push(`Added: ${added.join(', ')}`);
    if (removed.length) diffHints.push(`Removed: ${removed.join(', ')}`);
    const suffix = diffHints.length ? ` (${diffHints.join('; ')})` : '';
    fields.push({ label: 'Skills', value: body.skills.join(', ') });
    lines.push(`- **Skills:** ${body.skills.join(', ')}${suffix}`);
  }
  if (Array.isArray(body.preferred_work_types)) {
    const labelList = body.preferred_work_types.map(k => WORK_TYPE_LABELS[k] || k).join(', ') || '(none)';
    fields.push({ label: 'Preferred Work Types', value: labelList });
    lines.push(`- **Preferred Work Types:** ${labelList}`);
  }
  if (Array.isArray(body.preferred_job_types)) {
    const labelList = body.preferred_job_types.map(k => JOB_TYPE_LABELS[k] || k).join(', ') || '(none)';
    fields.push({ label: 'Preferred Job Types', value: labelList });
    lines.push(`- **Preferred Job Types:** ${labelList}`);
  }

  const scalarFields = [
    'first_name',
    'last_name',
    'job_title',
    'current_location',
    'phone',
    'years_of_experience',
    'months_of_experience',
    'expected_salary_min',
    'expected_salary_max',
    'salary_currency',
    'notice_period_days',
    'is_open_to_work',
    'linkedin_url',
    'github_url',
    'portfolio_url',
    'personal_website'
  ];
  for (const scalar of scalarFields) {
    if (Object.hasOwn(body, scalar) && body[scalar] !== undefined) {
      const label = scalar.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const prev = currentProfile?.[scalar];
      const nextVal = body[scalar] === null ? '(cleared)' : String(body[scalar]);
      const diffText = prev !== undefined && prev !== null && prev !== '' && String(prev) !== nextVal
        ? `${prev} -> ${nextVal}`
        : nextVal;
      fields.push({ label, value: nextVal });
      lines.push(`- **${label}:** ${diffText}`);
    }
  }

  if (Array.isArray(notes) && notes.length > 0) {
    lines.push('', ...notes.map(n => `- *Note:* ${n}`));
  }

  if (nextSectionLabel) {
    lines.push('', `After confirming this update, I will help you complete **${nextSectionLabel}** next.`);
  }
  lines.push('', 'Choose **“Confirm & Execute”** below to save these changes to HirePool, or tell me what to adjust first (or say **Cancel** to discard).');

  return {
    reviewMessage: lines.join('\n'),
    formattedReview: {
      type: 'candidate_profile_update',
      title: 'Review Profile Update',
      fields
    }
  };
}

/**
 * Build a factual professional summary draft strictly grounded in verified profile facts
 * without fabricating companies, certifications, metrics, or skills.
 */
export function buildGroundedSummarySuggestion(profile = {}, profileEditState = null) {
  const role = profile.job_title || null;
  const yoe = Number.isFinite(profile.years_of_experience) ? profile.years_of_experience : null;
  const skills = Array.isArray(profile.skills) ? profile.skills.filter(s => typeof s === 'string' && s.trim()) : [];
  const education = Array.isArray(profile.education) ? profile.education : [];
  const work = Array.isArray(profile.work_experience) ? profile.work_experience : [];
  const recentEdu = education.length > 0 ? education[education.length - 1] : null;
  const recentWork = work.length > 0 ? work[work.length - 1] : null;

  const clauses = [];
  if (role && yoe !== null && yoe > 0) {
    clauses.push(`${role} with ${yoe}+ year${yoe === 1 ? '' : 's'} of experience`);
  } else if (role) {
    clauses.push(role);
  } else if (recentEdu?.degree && recentEdu?.field_of_study) {
    clauses.push(`${recentEdu.degree} candidate in ${recentEdu.field_of_study}${recentEdu.institution ? ` at ${recentEdu.institution}` : ''}`);
  } else if (recentEdu?.degree && recentEdu?.institution) {
    clauses.push(`${recentEdu.degree} student/graduate from ${recentEdu.institution}`);
  }

  if (recentWork?.title && recentWork?.company) {
    clauses.push(`including experience as ${recentWork.title} at ${recentWork.company}`);
  }
  if (skills.length > 0) {
    clauses.push(`with verified skills in ${skills.slice(0, 6).join(', ')}`);
  }

  if (clauses.length === 0) {
    return { draft: null };
  }

  const draft = `${clauses.join(', ')}.`;
  return { draft };
}

function buildSectionPrompt(section, profile = {}, { operation = 'add', pendingSections = [] } = {}) {
  const remaining = pendingSections.filter(s => s !== section).map(s => HIREPOOL_PROFILE_SECTION_LABELS[s] || s);
  const currentLabel = HIREPOOL_PROFILE_SECTION_LABELS[section] || section;
  const queueHeader = remaining.length
    ? `Queued sections: **${pendingSections.map(s => HIREPOOL_PROFILE_SECTION_LABELS[s] || s).join(' -> ')}** (starting with **${currentLabel}**).\n\n`
    : '';
  const queueNote = remaining.length
    ? `\n\nOnce we finish **${currentLabel}**, we'll continue to **${remaining.join(', ')}**.`
    : '';

  if (section === HIREPOOL_PROFILE_SECTIONS.EDUCATION) {
    const existing = Array.isArray(profile?.education) ? profile.education : [];
    const existingText = existing.length
      ? ['\nYour current education entries:', ...existing.map((e, i) => `  ${i + 1}. ${[e.degree, e.field_of_study, e.institution].filter(Boolean).join(' — ')}${e.start_date || e.end_date ? ` (${[e.start_date, e.end_date].filter(Boolean).join(' to ')})` : ''}`)].join('\n')
      : '';
    if (operation === 'remove' && existing.length > 0) {
      return queueHeader + [
        'Which **Education** entry would you like to remove?' + existingText,
        '',
        'Reply with the entry number (for example: `remove education #1`) or institution name.'
      ].join('\n') + queueNote;
    }
    if (operation === 'edit' && existing.length > 0) {
      return queueHeader + [
        'Which **Education** entry would you like to edit, and what should I update?' + existingText,
        '',
        'You can reply with the entry number (e.g., `1`) and updated fields such as institution, degree, field of study, start/end dates (`YYYY-MM` or `Month YYYY`), or grade.'
      ].join('\n') + queueNote;
    }
    return queueHeader + [
      `Please share the **Education** details you want to add:${existingText}`,
      '- **Institution / University** (required)',
      '- **Degree** (required, e.g. `B.E.`, `B.Tech`, `M.Sc`)',
      '- **Field of Study** (optional, e.g. `Artificial Intelligence and Machine Learning`)',
      '- **Start & End Dates** (optional, e.g. `December 2022 to June 2026`)',
      '- **Grade / CGPA** (optional)',
      '',
      'You can share everything in one message (for example: `B.E. in AI & ML at PES University, December 2022 to June 2026`).'
    ].join('\n') + queueNote;
  }

  if (section === HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE) {
    const existing = Array.isArray(profile?.work_experience) ? profile.work_experience : [];
    const existingText = existing.length
      ? ['\nYour current work experience entries:', ...existing.map((w, i) => `  ${i + 1}. ${w.title} at ${w.company}${w.start_date ? ` (${w.start_date} to ${w.is_current ? 'Present' : (w.end_date || 'N/A')})` : ''}`)].join('\n')
      : '';
    if (operation === 'remove' && existing.length > 0) {
      return queueHeader + [
        'Which **Work Experience** entry would you like to remove?' + existingText,
        '',
        'Reply with the entry number (for example: `remove work experience #1`) or company name.'
      ].join('\n') + queueNote;
    }
    if (operation === 'edit' && existing.length > 0) {
      return [
        'Which **Work Experience** entry would you like to edit, and what would you like to change?' + existingText,
        '',
        'Share the entry number (or company/role) along with updated company, job title, location, start/end date (or `Present`), or description.'
      ].join('\n') + queueNote;
    }
    return [
      `Please share your **Work Experience** details:${existingText}`,
      '- **Company** (required)',
      '- **Job Title** (required)',
      '- **Location** (optional)',
      '- **Start & End Dates** (optional, e.g. `June 2025 to Present`)',
      '- **Description** (optional)'
    ].join('\n') + queueNote;
  }

  if (section === HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS) {
    const existing = Array.isArray(profile?.certifications) ? profile.certifications : [];
    const existingText = existing.length
      ? ['\nYour current certifications:', ...existing.map((c, i) => `  ${i + 1}. ${c.name}${c.issuing_organization ? ` — ${c.issuing_organization}` : ''}${c.issue_date ? ` (${c.issue_date})` : ''}`)].join('\n')
      : '';
    if (operation === 'remove' && existing.length > 0) {
      return queueHeader + 'Which **Certification** would you like to remove?' + existingText + '\n\nReply with the entry number or certification name.' + queueNote;
    }
    return queueHeader + [
      `Please share the **Certification** details you want to add:${existingText}`,
      '- **Certification Name** (required)',
      '- **Issuing Organization** (optional, e.g. `Amazon Web Services`)',
      '- **Issue Date / Expiry Date** (optional, e.g. `March 2024`)',
      '- **Credential ID / Credential URL** (optional)'
    ].join('\n') + queueNote;
  }

  if (section === HIREPOOL_PROFILE_SECTIONS.PROFESSIONAL_SUMMARY) {
    const currentText = profile?.professional_summary
      ? `\nYour current summary: *"${profile.professional_summary}"*\n`
      : '\nYou currently do not have a **Professional Summary** saved.\n';
    return `Let's update your **Professional Summary**.${currentText}\nPaste the summary you would like to save, or reply **"Help me write a professional summary"** and I will draft one strictly from your verified HirePool profile details.` + queueNote;
  }

  if (section === HIREPOOL_PROFILE_SECTIONS.SKILLS) {
    const existingSkills = Array.isArray(profile?.skills) ? profile.skills : [];
    const existingLine = existingSkills.length
      ? `\nYour current skills: **${existingSkills.join(', ')}**`
      : '\nYou currently have no skills saved on your profile.';
    if (existingSkills.length > 0 && operation === 'ambiguous') {
      return queueHeader + [
        `Let's update your **Skills**.${existingLine}`,
        '',
        'Tell me which skills to **add** (e.g., *"Add Python, FastAPI"*), **remove** (e.g., *"Remove SQL"*), or **replace** your existing list with (e.g., *"Replace my skills with Go, Rust"*).'
      ].join('\n') + queueNote;
    }
    if (operation === 'remove' && existingSkills.length > 0) {
      return queueHeader + `Which skills would you like to **remove** from your profile?${existingLine}` + queueNote;
    }
    if (operation === 'replace' && existingSkills.length > 0) {
      return queueHeader + `Share the new list of skills to **replace** your existing skills:${existingLine}` + queueNote;
    }
    return queueHeader + `Which **skills** would you like to add to your profile? (You can provide a comma-separated list or a sentence like *"Add Python, FastAPI, Docker"*.)` + existingLine + queueNote;
  }

  if (section === HIREPOOL_PROFILE_SECTIONS.PREFERENCES) {
    return queueHeader + [
      'Share the **Work & Compensation Preferences** you want to update:',
      '- **Preferred Work Types:** `remote`, `hybrid`, `onsite`',
      '- **Preferred Job Types:** `full_time`, `contract`',
      '- **Expected Salary Range & Currency:** e.g., `1800000 - 2500000 INR` (supported: `INR`, `USD`, `EUR`, `GBP`)',
      '- **Notice Period (days):** `0` to `180`',
      '- **Open to Work:** `true` or `false`'
    ].join('\n') + queueNote;
  }

  if (section === HIREPOOL_PROFILE_SECTIONS.LINKS) {
    return queueHeader + [
      'Share the **Profile & Portfolio Links** (`http://` or `https://`) you want to update:',
      '- `linkedin_url`, `github_url`, `portfolio_url`, `personal_website`'
    ].join('\n') + queueNote;
  }

  if (section === HIREPOOL_PROFILE_SECTIONS.BASIC_INFO) {
    return queueHeader + [
      'Tell me which **Basic Details** you want to update:',
      '- `first_name`, `last_name`, `phone` (10 digits), `current_location`, `job_title`, `years_of_experience` (`0-50`), `months_of_experience` (`0-11`)'
    ].join('\n') + queueNote;
  }

  return 'Which section of your profile would you like to update: **Professional Summary**, **Education**, **Work Experience**, **Certifications**, **Skills**, **Preferences**, **Links**, or **Basic Details**?';
}

function buildOverviewPrompt(profile = {}) {
  const { coreMissing, optionalMissing } = computeCandidateMissingFields(profile);
  const pct = Number.isFinite(profile?.profile_completion_percentage)
    ? `HirePool currently shows **${profile.profile_completion_percentage}%** profile completion.`
    : 'I checked your current HirePool candidate profile.';

  const lines = [pct];
  if (coreMissing.length || optionalMissing.length) {
    lines.push('', '### Missing Profile Information');
    if (coreMissing.length) lines.push(`- **Required fields missing:** ${coreMissing.join(', ')}`);
    if (optionalMissing.length) lines.push(`- **Additional sections missing:** ${optionalMissing.join(', ')}`);
  } else {
    lines.push('', 'All core and optional profile sections are filled in.');
  }

  lines.push(
    '',
    '### Sections you can update here',
    '- **Professional Summary** (add, edit, or draft from your profile)',
    '- **Education** (add, edit, or remove an entry)',
    '- **Work Experience** (add, edit, or remove a role)',
    '- **Certifications** (add, edit, or remove a certification)',
    '- **Skills** (add, remove, or replace skills)',
    '- **Preferences** (work types, job types, salary range & currency, notice period, open to work)',
    '- **Links & Basic Details** (LinkedIn, GitHub, portfolio, website, name, phone, location, job title, experience)',
    '',
    'Tell me which section (or specific fields) you want to update.'
  );
  return lines.join('\n');
}

function normalizeSectionAnswer(text) {
  const trimmed = normalizeText(text);
  if (/^\s*(?:professional\s+summary|summary|bio)\s*[.!?]*$/i.test(trimmed)) {
    return HIREPOOL_PROFILE_SECTIONS.PROFESSIONAL_SUMMARY;
  }
  if (/^\s*(?:education|degree|graduation(?:\s+details)?)\s*[.!?]*$/i.test(trimmed)) {
    return HIREPOOL_PROFILE_SECTIONS.EDUCATION;
  }
  if (/^\s*(?:work\s*experience|experience|employment(?:\s+details)?)\s*[.!?]*$/i.test(trimmed)) {
    return HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE;
  }
  if (/^\s*(?:certifications?|certificates?)\s*[.!?]*$/i.test(trimmed)) {
    return HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS;
  }
  if (/^\s*skills?\s*[.!?]*$/i.test(trimmed)) {
    return HIREPOOL_PROFILE_SECTIONS.SKILLS;
  }
  if (/^\s*(?:preferences?|work\s+preferences?|job\s+preferences?)\s*[.!?]*$/i.test(trimmed)) {
    return HIREPOOL_PROFILE_SECTIONS.PREFERENCES;
  }
  if (/^\s*(?:links?|profile\s+links?|social\s+links?)\s*[.!?]*$/i.test(trimmed)) {
    return HIREPOOL_PROFILE_SECTIONS.LINKS;
  }
  if (/^\s*(?:basic\s+(?:details|info))\s*[.!?]*$/i.test(trimmed)) {
    return HIREPOOL_PROFILE_SECTIONS.BASIC_INFO;
  }
  return null;
}

function cancelStaleConfirmation(state, cancelConfirmation) {
  if (state?.confirmationToken && typeof cancelConfirmation === 'function') {
    try {
      cancelConfirmation(state.confirmationToken);
    } catch {
      // Non-fatal: stale confirmation token may already have expired/cleared
    }
    state.confirmationToken = null;
  }
}

async function finalizeCandidateConfirmationStage({
  state,
  session,
  activeSection,
  sanitizedBody,
  currentProfile,
  stageProfileUpdate,
  cancelConfirmation,
  operationApplied = 'add',
  notes = [],
  extraDraftData = {}
}) {
  cancelStaleConfirmation(state, cancelConfirmation);

  const nextQueue = (Array.isArray(state.pendingSections) ? state.pendingSections : []).filter(s => s !== activeSection);
  const nextLabel = nextQueue.length ? (HIREPOOL_PROFILE_SECTION_LABELS[nextQueue[0]] || nextQueue[0]) : null;
  const review = formatCandidateProfileReview(sanitizedBody, currentProfile, nextLabel, { notes });
  const staged = await stageProfileUpdate({
    body: sanitizedBody,
    reviewMessage: review.reviewMessage,
    formattedReview: review.formattedReview,
    profileMergeMode: 'exact'
  });

  state.operation = operationApplied;
  state.draftData = { ...extraDraftData, pendingField: null, pendingSkillItems: null, skillModeAmbiguous: false };
  state.validationState = { valid: true, errors: {} };
  state.pendingConfirmation = true;
  state.confirmationToken = staged?.hostAction?.confirmationToken || null;
  state.confirmationPayload = sanitizedBody;
  state.stage = 'awaiting_confirmation';
  state.updatedAt = new Date().toISOString();
  session.hirePoolProfileEdit = state;

  return {
    handled: true,
    confirmationStaged: true,
    text: review.reviewMessage,
    hostAction: staged?.hostAction
  };
}

function parseCompoundSkillEdit(rawMessage) {
  const raw = String(rawMessage || '').trim();
  // e.g. "remove SQL and add PostgreSQL, Redis" or "actually remove FastAPI and add Kubernetes"
  const removeAddMatch = raw.match(
    /^(?:actually\s+|please\s+)?(?:remove|delete|drop)\s+(.+?)\s+(?:and|,)\s+add\s+(.+)$/i
  );
  if (removeAddMatch) {
    const { skills: removeSkills } = normalizeSkillsArray(removeAddMatch[1].split(/[,;]+|\s+and\s+/i));
    const { skills: addSkills, corrections } = normalizeSkillsArray(removeAddMatch[2].split(/[,;]+|\s+and\s+/i));
    if (removeSkills.length > 0 || addSkills.length > 0) {
      return { matched: true, removeSkills, addSkills, corrections };
    }
  }
  const addRemoveMatch = raw.match(
    /^(?:actually\s+|please\s+)?add\s+(.+?)\s+(?:and|,)\s+(?:remove|delete|drop)\s+(.+)$/i
  );
  if (addRemoveMatch) {
    const { skills: addSkills, corrections } = normalizeSkillsArray(addRemoveMatch[1].split(/[,;]+|\s+and\s+/i));
    const { skills: removeSkills } = normalizeSkillsArray(addRemoveMatch[2].split(/[,;]+|\s+and\s+/i));
    if (removeSkills.length > 0 || addSkills.length > 0) {
      return { matched: true, removeSkills, addSkills, corrections };
    }
  }
  return { matched: false, removeSkills: [], addSkills: [], corrections: [] };
}

function applySkillsUpdate({
  baseSkills,
  operation,
  items = [],
  removeItems = [],
  addItems = []
}) {
  const existing = Array.isArray(baseSkills) ? [...baseSkills] : [];
  if (removeItems.length > 0 || addItems.length > 0) {
    const removeKeys = new Set(removeItems.map(s => String(s).trim().toLowerCase()));
    const filtered = existing.filter(s => !removeKeys.has(String(s).trim().toLowerCase()));
    return normalizeSkillsArray([...filtered, ...addItems]).skills;
  }
  if (operation === 'add') {
    return normalizeSkillsArray([...existing, ...items]).skills;
  }
  if (operation === 'remove') {
    const removeKeys = new Set(items.map(s => String(s).trim().toLowerCase()));
    return existing.filter(s => !removeKeys.has(String(s).trim().toLowerCase()));
  }
  return normalizeSkillsArray(items).skills;
}

function findMatchingEntryIndex(list, rawMessage, targetIndex, labelKeys = []) {
  if (!Array.isArray(list) || list.length === 0) return -1;
  if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < list.length) {
    return targetIndex;
  }
  const lower = normalizeText(rawMessage).toLowerCase();
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i] || {};
    for (const key of labelKeys) {
      const candidateVal = String(entry[key] || '').trim().toLowerCase();
      if (candidateVal && candidateVal.length >= 2 && lower.includes(candidateVal)) {
        return i;
      }
    }
  }
  return list.length === 1 && /\b(?:it|that|this|only|entry)\b/i.test(lower) ? 0 : -1;
}

/**
 * Resolve an authenticated candidate's profile editing conversation turn.
 * Keeps `session.hirePoolProfileEdit` strictly structured and non-sensitive.
 */
export async function handleCandidateProfileEditTurn({
  message,
  session,
  authUser,
  readCurrentProfile,
  stageProfileUpdate,
  cancelConfirmation
}) {
  const raw = String(message || '').trim();
  const text = normalizeText(raw);
  if (!text) return { handled: false };

  const currentState = ensureRoleScopedProfileEditState(session, authUser);
  const isProfileEditIntent = isHirePoolProfileEditRequest(text);
  const isActiveWorkflow = Boolean(currentState?.active && !['completed', 'cancelled'].includes(currentState.stage));
  const isSuspendedWorkflow = Boolean(currentState?.suspended && !currentState?.active && !['completed', 'cancelled'].includes(currentState.stage));

  // Role boundary: non-candidates asking candidate-only profile edit operations
  if (authUser?.role !== 'candidate') {
    if (authUser?.role === 'client' || authUser?.role === 'consultancy') {
      return await handleOrgProfileEditTurn({
        message,
        session,
        authUser,
        readProfile: readCurrentProfile,
        stageProfileUpdate,
        cancelConfirmation
      });
    }
    if (isProfileEditIntent) {
      return {
        handled: true,
        text: `Education, work experience, and candidate professional summary edits apply only to **Candidate** profiles. You are currently signed in with a **${authUser?.role || 'non-candidate'}** account.`
      };
    }
    return { handled: false };
  }

  // Priority 1: Allow explicit cancel inside active or suspended workflow
  if ((isActiveWorkflow || isSuspendedWorkflow) && CANCEL_WORKFLOW_PATTERN.test(text)) {
    cancelStaleConfirmation(currentState, cancelConfirmation);
    session.hirePoolProfileEdit = {
      ...(currentState || {}),
      userId: authUser?.id || currentState?.userId || null,
      role: 'candidate',
      profileType: HIREPOOL_PROFILE_TYPES.CANDIDATE,
      active: false,
      suspended: false,
      stage: 'cancelled',
      selectedSection: null,
      pendingSections: [],
      completedSections: currentState?.completedSections || [],
      operation: 'add',
      targetIndex: null,
      draftData: {},
      validationState: { valid: true, errors: {} },
      pendingConfirmation: false,
      confirmationToken: null,
      confirmationPayload: null,
      updatedAt: new Date().toISOString()
    };
    return {
      handled: true,
      text: 'Okay — I cancelled the profile edit workflow. No changes were saved to your HirePool profile.'
    };
  }

  // Priority 2: Clear new user intent (suspends active profile edit without losing collected fields)
  const isIntentSwitch =
    !isProfileEditIntent &&
    (/\b(?:my\s+off(?:er|re)s?|job\s+offers?|any\s+offers?|check\s+(?:my\s+)?off(?:er|re)s?|off(?:er|re)s?\s+received|view\s+off(?:er|re)s?|show\s+off(?:er|re)s?|do\s+i\s+have\s+(?:any\s+)?off(?:er|re)s?)\b/i.test(text) ||
     /\b(?:apply(?:\s+(?:for|to))?|matching\s+jobs?|job\s+applications?|my\s+applications?|search\s+(?:for\s+)?jobs?|find\s+jobs?|the\s+(?:first|second|third)\s+(?:job|one))\b/i.test(text) ||
     /\b(?:(?:view|show|display|see|what(?:'s| is)\s+(?:on|in))\s+(?:my\s+)?profile|(?:my\s+)?dashboard|what\s+can\s+you\s+do|how\s+can\s+you\s+help|what\s+is\s+hirepool)\b/i.test(text) ||
     /^\s*(?:hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening))\b/i.test(text) ||
     /\b(?:naukri|indeed|monster|glassdoor|foundit|shine)\b/i.test(text));

  if (isActiveWorkflow && isIntentSwitch) {
    session.hirePoolProfileEdit = {
      ...(currentState || {}),
      active: false,
      suspended: true,
      updatedAt: new Date().toISOString()
    };
    return { handled: false };
  }

  // Priority 3: Explicit continuation/resumption of suspended workflow
  const isResumeIntent =
    /^\s*(?:resume(?:\s+profile(?:\s*edit)?)?|continue(?:\s+(?:profile(?:\s*edit)?|adding\s+(?:work\s*)?experience|adding\s+education|editing))?|go\s+back\s+to\s+profile(?:\s*edit)?)\s*[.!?]*$/i.test(text);

  if (isSuspendedWorkflow) {
    if (!isResumeIntent && !isProfileEditIntent) {
      return { handled: false };
    }
    // Reactivate suspended workflow
    currentState.active = true;
    currentState.suspended = false;
    session.hirePoolProfileEdit = currentState;

    if (isResumeIntent) {
      const activeSec = currentState.selectedSection || HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE;
      let resumeMsg = `Resuming your profile update for **${activeSec.replace(/_/g, ' ')}**.`;
      if (activeSec === HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE) {
        const expDraft = currentState.draftData?.work_experience || {};
        const captured = [
          expDraft.title ? `- **Job title:** ${expDraft.title}` : null,
          expDraft.company ? `- **Company:** ${expDraft.company}` : null,
          expDraft.location ? `- **Location:** ${expDraft.location}` : null,
          expDraft.start_date ? `- **Start date:** ${expDraft.start_date}` : null,
          expDraft.end_date ? `- **End date:** ${expDraft.end_date}` : null
        ].filter(Boolean);
        if (captured.length) {
          resumeMsg += `\n\nI have captured so far:\n${captured.join('\n')}\n\nPlease provide any remaining details or reply "save" to confirm.`;
        } else {
          resumeMsg += '\nPlease provide the company name, job title, and dates for this role.';
        }
      } else if (activeSec === HIREPOOL_PROFILE_SECTIONS.EDUCATION) {
        const eduDraft = currentState.draftData?.education || {};
        const captured = [
          eduDraft.degree ? `- **Degree:** ${eduDraft.degree}` : null,
          eduDraft.institution ? `- **Institution:** ${eduDraft.institution}` : null,
          eduDraft.field_of_study ? `- **Field of study:** ${eduDraft.field_of_study}` : null
        ].filter(Boolean);
        if (captured.length) {
          resumeMsg += `\n\nI have captured so far:\n${captured.join('\n')}\n\nPlease provide any missing details to continue.`;
        } else {
          resumeMsg += '\nPlease provide your degree and institution.';
        }
      } else {
        resumeMsg += '\nWhat details would you like to update?';
      }
      return { handled: true, text: resumeMsg };
    }
  }

  if (!isActiveWorkflow && !currentState?.active && !isProfileEditIntent) {
    return { handled: false };
  }

  // Reject unsupported CandidateProfileUpdate requests honestly without guessing or staging
  const unsupportedReason = detectUnsupportedCandidateRequest(raw);
  if (unsupportedReason) {
    return { handled: true, text: unsupportedReason };
  }

  // Always inspect real HirePool profile via API before reading/staging
  let currentProfile;
  try {
    currentProfile = await readCurrentProfile();
  } catch (error) {
    const status = error?.statusCode;
    return {
      handled: true,
      text: status === 401
        ? 'Your HirePool session needs to be renewed before I can access your profile.'
        : `I could not retrieve your current HirePool profile right now (${error?.message || 'API unavailable'}). No profile changes were made; please try again.`
    };
  }

  // Ensure structured role/user-bound state container
  const state = currentState && isActiveWorkflow
    ? {
        ...currentState,
        userId: authUser?.id || currentState.userId || null,
        role: 'candidate',
        profileType: HIREPOOL_PROFILE_TYPES.CANDIDATE,
        pendingSections: Array.isArray(currentState.pendingSections) ? [...currentState.pendingSections] : [],
        completedSections: Array.isArray(currentState.completedSections) ? [...currentState.completedSections] : [],
        draftData: { ...(currentState.draftData || {}) },
        existingValues: {
          skills: Array.isArray(currentProfile?.skills) ? currentProfile.skills : [],
          educationCount: Array.isArray(currentProfile?.education) ? currentProfile.education.length : 0,
          workExperienceCount: Array.isArray(currentProfile?.work_experience) ? currentProfile.work_experience.length : 0,
          certificationsCount: Array.isArray(currentProfile?.certifications) ? currentProfile.certifications.length : 0
        }
      }
    : buildInitialProfileEditState({
        userId: authUser?.id || null,
        role: 'candidate',
        profileType: HIREPOOL_PROFILE_TYPES.CANDIDATE,
        existingValues: {
          skills: Array.isArray(currentProfile?.skills) ? currentProfile.skills : [],
          educationCount: Array.isArray(currentProfile?.education) ? currentProfile.education.length : 0,
          workExperienceCount: Array.isArray(currentProfile?.work_experience) ? currentProfile.work_experience.length : 0,
          certificationsCount: Array.isArray(currentProfile?.certifications) ? currentProfile.certifications.length : 0
        }
      });

  // Resolve awaiting_skill_operation clarification ("add" vs "replace" vs "remove")
  if (state.stage === 'awaiting_skill_operation' && Array.isArray(state.draftData?.pendingSkillItems) && state.draftData.pendingSkillItems.length > 0) {
    const existingSkills = Array.isArray(currentProfile?.skills) ? currentProfile.skills : [];
    const wantsAdd = /^\s*(?:add(?:\s+them)?|append|keep(?:\s+existing)?|merge)\b/i.test(text);
    const wantsReplace = /^\s*(?:replace(?:\s+all|\s+them|\s+existing)?|overwrite|swap)\b/i.test(text);
    const wantsRemove = /^\s*(?:remove|delete|drop)\b/i.test(text);

    if (wantsAdd || wantsReplace || wantsRemove) {
      const chosenOp = wantsReplace ? 'replace' : (wantsRemove ? 'remove' : 'add');
      const nextSkills = applySkillsUpdate({
        baseSkills: existingSkills,
        operation: chosenOp,
        items: state.draftData.pendingSkillItems
      });
      if (chosenOp === 'remove' && nextSkills.length === 0) {
        return {
          handled: true,
          text: 'HirePool requires at least one skill on your profile (`Profile.tsx`). Keep at least one skill or reply **"replace"** with a new skill list.'
        };
      }
      const validation = validateCandidateProfileUpdatePayload({ skills: nextSkills }, currentProfile);
      if (!validation.isValid) {
        return { handled: true, text: `Validation failed: **${validation.firstError}**` };
      }
      return await finalizeCandidateConfirmationStage({
        state,
        session,
        activeSection: HIREPOOL_PROFILE_SECTIONS.SKILLS,
        sanitizedBody: validation.sanitizedBody,
        currentProfile,
        stageProfileUpdate,
        cancelConfirmation,
        operationApplied: chosenOp,
        notes: state.draftData.pendingSkillNotes || []
      });
    }
    return {
      handled: true,
      text: `You currently have **${existingSkills.join(', ')}**. Please reply **"add"** to keep them and add \`${state.draftData.pendingSkillItems.join(', ')}\`, or reply **"replace"** to replace your skills list with \`${state.draftData.pendingSkillItems.join(', ')}\`.`
    };
  }

  // Edit-before-confirm handling when user amends staged changes prior to clicking Confirm & Execute
  if (state.stage === 'awaiting_confirmation' && state.confirmationPayload) {
    if (/^\s*(?:confirm|yes|save(?:\s+it|\s+changes)?|looks\s+good)\s*[.!?]*$/i.test(text)) {
      return {
        handled: true,
        text: 'Your update is staged and ready. Click **"Confirm & Execute"** below to apply it to HirePool, or tell me what you would like to adjust first (or say **Cancel** to discard).'
      };
    }

    const isAmendmentLead = /^\s*(?:actually|instead|wait|change|also|remove|delete|drop|add|replace|set|make|update)\b/i.test(text);
    const compoundSkillEdit = parseCompoundSkillEdit(raw);
    const stagedSkills = Array.isArray(state.confirmationPayload.skills) ? state.confirmationPayload.skills : null;

    if (compoundSkillEdit.matched && (stagedSkills || state.selectedSection === HIREPOOL_PROFILE_SECTIONS.SKILLS)) {
      const base = stagedSkills || (Array.isArray(currentProfile?.skills) ? currentProfile.skills : []);
      const nextSkills = applySkillsUpdate({
        baseSkills: base,
        removeItems: compoundSkillEdit.removeSkills,
        addItems: compoundSkillEdit.addSkills
      });
      if (nextSkills.length === 0) {
        return {
          handled: true,
          text: 'At least one skill is required on your HirePool profile (`Profile.tsx`). Please keep or add at least one skill.'
        };
      }
      const nextBody = { ...state.confirmationPayload, skills: nextSkills };
      const validation = validateCandidateProfileUpdatePayload(nextBody, currentProfile);
      if (!validation.isValid) {
        return { handled: true, text: `Validation failed: **${validation.firstError}**` };
      }
      return await finalizeCandidateConfirmationStage({
        state,
        session,
        activeSection: state.selectedSection || HIREPOOL_PROFILE_SECTIONS.SKILLS,
        sanitizedBody: validation.sanitizedBody,
        currentProfile,
        stageProfileUpdate,
        cancelConfirmation
      });
    }

    if (isAmendmentLead && stagedSkills && state.selectedSection === HIREPOOL_PROFILE_SECTIONS.SKILLS) {
      const parsedAmend = parseSkillsInput(raw, stagedSkills, 'add');
      if (parsedAmend.kind === 'values' && ['add', 'remove', 'replace'].includes(parsedAmend.operation)) {
        const nextSkills = applySkillsUpdate({
          baseSkills: stagedSkills,
          operation: parsedAmend.operation,
          items: parsedAmend.skills
        });
        if (nextSkills.length === 0) {
          return {
            handled: true,
            text: 'At least one skill is required on your HirePool profile (`Profile.tsx`). Please keep or add at least one skill.'
          };
        }
        const nextBody = { ...state.confirmationPayload, skills: nextSkills };
        const validation = validateCandidateProfileUpdatePayload(nextBody, currentProfile);
        if (!validation.isValid) {
          return { handled: true, text: `Validation failed: **${validation.firstError}**` };
        }
        const notes = parsedAmend.corrections.map(c => `Normalized skill "${c.from}" -> "${c.to}"`);
        return await finalizeCandidateConfirmationStage({
          state,
          session,
          activeSection: HIREPOOL_PROFILE_SECTIONS.SKILLS,
          sanitizedBody: validation.sanitizedBody,
          currentProfile,
          stageProfileUpdate,
          cancelConfirmation,
          operationApplied: parsedAmend.operation,
          notes
        });
      }
    }

    const amendInline = extractCandidateInlineFields(raw);
    const hasAmendFields = Object.keys(amendInline.patch).length > 0 || Boolean(amendInline.inlineSkillsMeta);
    const amendmentTargetsScalarOrPref = hasAmendFields && state.selectedSection !== HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE && state.selectedSection !== HIREPOOL_PROFILE_SECTIONS.EDUCATION && state.selectedSection !== HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS;

    if (amendmentTargetsScalarOrPref) {
      const nextBody = { ...state.confirmationPayload, ...amendInline.patch };
      if (amendInline.inlineSkillsMeta) {
        const base = Array.isArray(state.confirmationPayload.skills)
          ? state.confirmationPayload.skills
          : (Array.isArray(currentProfile?.skills) ? currentProfile.skills : []);
        nextBody.skills = applySkillsUpdate({
          baseSkills: base,
          operation: amendInline.inlineSkillsMeta.operation === 'ambiguous' ? 'add' : amendInline.inlineSkillsMeta.operation,
          items: amendInline.inlineSkillsMeta.skills
        });
      }
      const validation = validateCandidateProfileUpdatePayload(nextBody, currentProfile);
      if (!validation.isValid) {
        return { handled: true, text: `Validation failed: **${validation.firstError}** Please provide a valid value.` };
      }
      return await finalizeCandidateConfirmationStage({
        state,
        session,
        activeSection: state.selectedSection || HIREPOOL_PROFILE_SECTIONS.BASIC_INFO,
        sanitizedBody: validation.sanitizedBody,
        currentProfile,
        stageProfileUpdate,
        cancelConfirmation
      });
    }
  }

  // Explicit skip / continue / next handling when in queued multi-section flow
  const isSkip = /^\s*skip(?:\s+this|\s+section)?\s*[.!?]*$/i.test(text);
  const isContinue = /^\s*(?:continue|next|proceed|go\s+ahead|yes|ready|ok|okay)\s*[.!?]*$/i.test(text);

  if (state.stage === 'between_sections' && isContinue && state.pendingSections.length > 0) {
    const nextSec = state.pendingSections[0];
    state.selectedSection = nextSec;
    state.stage = 'collecting';
    state.operation = 'add';
    state.targetIndex = null;
    state.draftData = {};
    state.updatedAt = new Date().toISOString();
    session.hirePoolProfileEdit = state;
    return {
      handled: true,
      text: buildSectionPrompt(nextSec, currentProfile, {
        operation: state.operation,
        pendingSections: state.pendingSections
      })
    };
  }

  if (isSkip && state.pendingSections.length > 0) {
    const skipped = state.selectedSection || state.pendingSections[0];
    state.pendingSections = state.pendingSections.filter(s => s !== skipped);
    state.draftData = {};
    if (state.pendingSections.length > 0) {
      state.selectedSection = state.pendingSections[0];
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: `Skipped **${HIREPOOL_PROFILE_SECTION_LABELS[skipped] || skipped}**.\n\n` + buildSectionPrompt(state.selectedSection, currentProfile, {
          operation: state.operation,
          pendingSections: state.pendingSections
        })
      };
    }
    state.active = false;
    state.stage = 'completed';
    state.selectedSection = null;
    session.hirePoolProfileEdit = state;
    return { handled: true, text: 'No remaining profile sections queued to update.' };
  }

  // Parse requested section(s) from message
  const { sections: rawParsedSections, operation: parsedOp, targetIndex: parsedIdx } = extractProfileEditSections(text);
  const directChoiceSection = normalizeSectionAnswer(text);
  const parsedSections =
    rawParsedSections.length === 0 && !directChoiceSection && parseCompoundSkillEdit(raw).matched
      ? [HIREPOOL_PROFILE_SECTIONS.SKILLS]
      : rawParsedSections;

  // Fast-path: check if user supplied direct scalar / preference / link / multi-field values inline
  const structuredSectionActive = [
    HIREPOOL_PROFILE_SECTIONS.EDUCATION,
    HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE,
    HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS,
    HIREPOOL_PROFILE_SECTIONS.PROFESSIONAL_SUMMARY
  ].includes(state.selectedSection);
  const explicitInlineSwitch = /\b(?:basic\s+(?:info|details)|preferences?|social\s+links?|profile\s+links?|contact\s+info|my\s+phone|current\s+location)\b/i.test(text) ||
    /^\s*(?:basic\s+(?:info|details)|preferences?|links?)\s*$/i.test(text);
  const targetsInlineSections = explicitInlineSwitch || (
    !structuredSectionActive && parsedSections.some(s => [
      HIREPOOL_PROFILE_SECTIONS.BASIC_INFO,
      HIREPOOL_PROFILE_SECTIONS.PREFERENCES,
      HIREPOOL_PROFILE_SECTIONS.LINKS
    ].includes(s))
  );

  if (!structuredSectionActive || targetsInlineSections || !isActiveWorkflow) {
    const pendingField = state.draftData?.pendingField || null;
    const { patch: inlinePatch, inlineSkillsMeta } = extractCandidateInlineFields(raw, { pendingField });
    const hasInlineFields = Object.keys(inlinePatch).length > 0 || Boolean(inlineSkillsMeta);

    // Avoid hijacking pure skills/summary/education/work/cert messages that had no scalar/pref/link fields
    if (Object.keys(inlinePatch).length > 0) {
      const candidateBody = { ...inlinePatch };
      const notes = [];

      if (inlineSkillsMeta && inlineSkillsMeta.skills.length > 0) {
        const existingSkills = Array.isArray(currentProfile?.skills) ? currentProfile.skills : [];
        if (inlineSkillsMeta.operation === 'ambiguous' && existingSkills.length > 0) {
          // Safe guard: clarify add vs replace when updating skills alongside other fields without saying add/replace
          candidateBody.skills = applySkillsUpdate({
            baseSkills: existingSkills,
            operation: 'add',
            items: inlineSkillsMeta.skills
          });
          notes.push(`Kept your existing skills (${existingSkills.join(', ')}) and added ${inlineSkillsMeta.skills.join(', ')}. Say "replace skills with ..." if you meant to overwrite them.`);
        } else {
          candidateBody.skills = applySkillsUpdate({
            baseSkills: existingSkills,
            operation: inlineSkillsMeta.operation,
            items: inlineSkillsMeta.skills
          });
        }
        if (inlineSkillsMeta.corrections?.length) {
          for (const c of inlineSkillsMeta.corrections) {
            notes.push(`Normalized skill "${c.from}" -> "${c.to}"`);
          }
        }
      }

      const validation = validateCandidateProfileUpdatePayload(candidateBody, currentProfile);
      if (!validation.isValid) {
        state.validationState = { valid: false, errors: validation.errors };
        state.stage = 'collecting';
        state.selectedSection = parsedSections[0] || state.selectedSection || HIREPOOL_PROFILE_SECTIONS.BASIC_INFO;
        state.updatedAt = new Date().toISOString();
        session.hirePoolProfileEdit = state;
        return {
          handled: true,
          text: `I could not validate that update: **${validation.firstError}** Please provide a valid value and try again.`
        };
      }

      const chosenSec = parsedSections[0] || state.selectedSection || HIREPOOL_PROFILE_SECTIONS.BASIC_INFO;
      state.selectedSection = chosenSec;
      return await finalizeCandidateConfirmationStage({
        state,
        session,
        activeSection: chosenSec,
        sanitizedBody: validation.sanitizedBody,
        currentProfile,
        stageProfileUpdate,
        cancelConfirmation,
        operationApplied: parsedOp || 'edit',
        notes
      });
    }
  }

  const explicitSectionRequest = parsedSections.length > 0 && (
    !structuredSectionActive ||
    explicitInlineSwitch ||
    parseCompoundSkillEdit(raw).matched ||
    /\b(?:switch(?:\s+to)?|update|edit|add|change)\s+(?:education|work\s*experience|certifications?|professional\s+summary|skills?|technical\s+skills?|basic\s+(?:info|details)|preferences|links)\b/i.test(text) ||
    /^\s*(?:education|work\s*experience|experience|certifications?|skills|summary|basic\s+(?:info|details)|preferences|links)\s*[.!?]*$/i.test(text)
  );

  if ((explicitSectionRequest || directChoiceSection) && (!structuredSectionActive || explicitInlineSwitch || explicitSectionRequest)) {
    const requestedSections = explicitSectionRequest && parsedSections.length > 0 ? parsedSections : (directChoiceSection ? [directChoiceSection] : []);
    if (requestedSections.length > 0) {
      // Preserve remaining queued sections if user selects/refines the first section without overwriting the queue
      if (requestedSections.length > 1) {
        state.pendingSections = requestedSections;
      } else if (state.pendingSections.length > 1 && state.pendingSections.includes(requestedSections[0])) {
        state.pendingSections = [
          requestedSections[0],
          ...state.pendingSections.filter(s => s !== requestedSections[0])
        ];
      } else if (state.pendingSections.length > 0 && state.pendingSections[0] !== requestedSections[0]) {
        state.pendingSections = [
          requestedSections[0],
          ...state.pendingSections.filter(s => s !== requestedSections[0])
        ];
      } else if (state.pendingSections.length === 0) {
        state.pendingSections = [requestedSections[0]];
      }

      if (state.selectedSection !== requestedSections[0]) {
        state.selectedSection = requestedSections[0];
        state.draftData = {};
      }
      if (parsedOp) state.operation = parsedOp;

      if (parsedSections.length > 1 && !/[:\n]/.test(raw) && !/\b(?:from|19\d{2}|20\d{2}|b\.?\s*(?:e|tech|sc|a|com)|m\.?\s*(?:e|tech|sc|ba|a))\b/i.test(text)) {
        state.stage = 'collecting';
        state.updatedAt = new Date().toISOString();
        session.hirePoolProfileEdit = state;
        return {
          handled: true,
          text: buildSectionPrompt(state.selectedSection, currentProfile, {
            operation: state.operation,
            pendingSections: state.pendingSections
          })
        };
      }
    }
  }
  if (parsedIdx !== null && isActiveWorkflow) {
    state.targetIndex = parsedIdx;
    if (/^(?:#|entry\s+|number\s+|item\s+)?(?:\d+|first|second|third)[.!?]*$/i.test(text)) {
      const targetEntry = state.selectedSection === HIREPOOL_PROFILE_SECTIONS.EDUCATION
        ? currentProfile?.education?.[parsedIdx]
        : state.selectedSection === HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE
          ? currentProfile?.work_experience?.[parsedIdx]
          : state.selectedSection === HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS
            ? currentProfile?.certifications?.[parsedIdx]
            : null;
      if (!targetEntry) {
        return {
          handled: true,
          text: `I could not find entry #${parsedIdx + 1} on your profile. Please choose an existing entry number or add a new entry.`
        };
      }
      state.stage = 'collecting';
      state.updatedAt = new Date().toISOString();
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: `Selected entry **#${parsedIdx + 1}**. What fields would you like to update on this entry?`
      };
    }
  }

  // General profile-edit entry with no section chosen yet
  if (!state.selectedSection) {
    state.stage = 'awaiting_section_choice';
    state.updatedAt = new Date().toISOString();
    session.hirePoolProfileEdit = state;
    return {
      handled: true,
      text: buildOverviewPrompt(currentProfile)
    };
  }

  const activeSection = state.selectedSection;

  // --- SECTION: PROFESSIONAL SUMMARY ---
  if (activeSection === HIREPOOL_PROFILE_SECTIONS.PROFESSIONAL_SUMMARY) {
    const isHelpWrite = /\b(?:help\s+me\s+write|draft|suggest|generate|write\s+(?:one|a\s+summary)\s+for\s+me)\b/i.test(text);
    const isAcceptDraft = Boolean(state.draftData?.suggestedSummary) &&
      /^(?:yes|use\s+(?:that|it|this)|looks\s+good|save\s+(?:that|it)|accept|confirm)\s*[.!?]*$/i.test(text);
    const bareCommand = /^(?:(?:please\s+)?(?:add|edit|update|change|revise|view)\s+(?:a\s+|an\s+|my\s+)?(?:professional\s+summary|summary|bio)|professional\s+summary|summary|continue|next)\s*[.!?]*$/i.test(text);

    if (isHelpWrite) {
      const { draft } = buildGroundedSummarySuggestion(currentProfile, state);
      if (!draft) {
        state.stage = 'collecting';
        session.hirePoolProfileEdit = state;
        return {
          handled: true,
          text: 'Your profile does not have enough filled details yet (such as job title, skills, or education) for me to draft a factual summary without guessing. Please share 1-2 sentences describing your background, key skills, or target role.'
        };
      }
      state.draftData = { suggestedSummary: draft };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: [
          'Here is a **Professional Summary** draft based strictly on your verified HirePool profile:',
          '',
          `> ${draft}`,
          '',
          'Reply **"Use that"** to prepare this update for confirmation, or paste an edited version.'
        ].join('\n')
      };
    }

    let summaryCandidate = null;
    if (isAcceptDraft) {
      summaryCandidate = state.draftData.suggestedSummary;
    } else if (!bareCommand) {
      // Strip optional prefix e.g. "Update my professional summary to: ..."
      const stripped = raw
        .replace(/^(?:please\s+)?(?:add|edit|update|set|change)\s+(?:my\s+)?(?:professional\s+summary|summary|bio)\s*(?:to|as|with|:)?\s*/i, '')
        .trim();
      if (stripped.length > 0 && !/^(?:professional\s+summary|summary|bio)$/i.test(stripped)) {
        summaryCandidate = stripped;
      }
    }

    if (!summaryCandidate) {
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: buildSectionPrompt(activeSection, currentProfile, {
          operation: state.operation,
          pendingSections: state.pendingSections
        })
      };
    }

    const validation = validateCandidateProfileUpdatePayload({ professional_summary: summaryCandidate }, currentProfile);
    if (!validation.isValid) {
      state.validationState = { valid: false, errors: validation.errors };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return { handled: true, text: `${validation.firstError} Please provide a valid professional summary.` };
    }

    return await finalizeCandidateConfirmationStage({
      state,
      session,
      activeSection,
      sanitizedBody: validation.sanitizedBody,
      currentProfile,
      stageProfileUpdate,
      cancelConfirmation,
      operationApplied: state.operation || 'edit',
      extraDraftData: { professional_summary: validation.sanitizedBody.professional_summary }
    });
  }

  // --- SECTION: EDUCATION ---
  if (activeSection === HIREPOOL_PROFILE_SECTIONS.EDUCATION) {
    const existingList = Array.isArray(currentProfile?.education) ? currentProfile.education : [];
    if (state.operation === 'remove') {
      if (existingList.length === 0) {
        return { handled: true, text: 'You do not have any education entries on your HirePool profile to remove.' };
      }
      const removeIdx = findMatchingEntryIndex(existingList, raw, parsedIdx, ['institution', 'degree', 'field_of_study']);
      if (removeIdx < 0) {
        state.stage = 'collecting';
        session.hirePoolProfileEdit = state;
        return {
          handled: true,
          text: buildSectionPrompt(activeSection, currentProfile, {
            operation: 'remove',
            pendingSections: state.pendingSections
          })
        };
      }
      const nextList = existingList.filter((_, i) => i !== removeIdx);
      return await finalizeCandidateConfirmationStage({
        state,
        session,
        activeSection,
        sanitizedBody: { education: nextList },
        currentProfile,
        stageProfileUpdate,
        cancelConfirmation,
        operationApplied: 'remove',
        notes: [`Removing education entry #${removeIdx + 1}: ${[existingList[removeIdx]?.degree, existingList[removeIdx]?.institution].filter(Boolean).join(' — ')}`]
      });
    }

    const bareCommand = /^(?:(?:please\s+)?(?:add|edit|update|modify)\s+(?:a\s+|an\s+|my\s+)?(?:education(?:\s+details)?|degree|graduation(?:\s+details)?)|education|degree|continue|next)\s*[.!?]*$/i.test(text);

    if (bareCommand && !state.draftData?.education?.institution && !state.draftData?.education?.degree) {
      state.stage = 'collecting';
      state.draftData = {};
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: buildSectionPrompt(activeSection, currentProfile, {
          operation: state.operation,
          pendingSections: state.pendingSections
        })
      };
    }

    const currentEduDraft = state.stage === 'awaiting_confirmation' ? {} : (state.draftData?.education || {});
    let expectingField = null;
    if (currentEduDraft.degree && !currentEduDraft.institution) expectingField = 'institution';
    else if (currentEduDraft.institution && !currentEduDraft.degree) expectingField = 'degree';

    const { draft: parsedDraft, errors: parseErrors } = parseEducationFromMessage(raw, currentEduDraft, { expectingField });

    if (parseErrors.length > 0) {
      state.draftData = { ...state.draftData, education: parsedDraft };
      state.validationState = { valid: false, errors: { education: parseErrors[0] } };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: `I could not validate that education detail: **${parseErrors[0]}** Please correct it and try again.`
      };
    }

    // For edits on multiple existing entries without an explicit target index, let user choose
    if (state.operation === 'edit' && existingList.length > 1 && state.targetIndex === null) {
      state.draftData = { ...state.draftData, education: parsedDraft };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: buildSectionPrompt(activeSection, currentProfile, {
          operation: 'edit',
          pendingSections: state.pendingSections
        })
      };
    }
    if (state.operation === 'edit' && existingList.length === 0) {
      state.operation = 'add';
    }
    if (state.operation === 'edit' && state.targetIndex === null && existingList.length === 1) {
      state.targetIndex = 0;
    }

    // In edit mode, merge target existing fields cleanly when validating
    const effectiveEntry = state.operation === 'edit' && Number.isInteger(state.targetIndex) && existingList[state.targetIndex]
      ? {
          ...existingList[state.targetIndex],
          ...Object.fromEntries(Object.entries(parsedDraft).filter(([, v]) => v !== null && v !== ''))
        }
      : parsedDraft;

    const missingRequired = [];
    if (!effectiveEntry.degree?.trim()) missingRequired.push('**Degree** (e.g. `B.E.`, `B.Tech`)');
    if (!effectiveEntry.institution?.trim()) missingRequired.push('**Institution / University** (e.g. `PES University`)');

    state.draftData = { ...state.draftData, education: parsedDraft };
    if (missingRequired.length > 0) {
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      const capturedParts = [
        parsedDraft.degree ? `- **Degree:** ${parsedDraft.degree}` : null,
        parsedDraft.field_of_study ? `- **Field of study:** ${parsedDraft.field_of_study}` : null,
        parsedDraft.institution ? `- **Institution:** ${parsedDraft.institution}` : null,
        parsedDraft.start_date ? `- **Start date:** ${parsedDraft.start_date}` : null,
        parsedDraft.end_date ? `- **End date:** ${parsedDraft.end_date}` : null,
        parsedDraft.grade ? `- **Grade:** ${parsedDraft.grade}` : null
      ].filter(Boolean);

      return {
        handled: true,
        text: [
          capturedParts.length ? 'I captured these education details so far:\n' + capturedParts.join('\n') : 'To add your education entry, I need both your degree and institution.',
          '',
          `Please provide the missing required detail${missingRequired.length > 1 ? 's' : ''}: ${missingRequired.join(' and ')}.`
        ].join('\n')
      };
    }

    const mergedBody = mergeCandidateProfileUpdate(
      currentProfile,
      { education: [effectiveEntry] },
      { operation: state.operation, targetIndex: state.targetIndex }
    );
    const validation = validateCandidateProfileUpdatePayload(mergedBody, currentProfile);
    if (!validation.isValid) {
      state.validationState = { valid: false, errors: validation.errors };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return { handled: true, text: `Validation failed: **${validation.firstError}** Please correct and resend.` };
    }

    return await finalizeCandidateConfirmationStage({
      state,
      session,
      activeSection,
      sanitizedBody: validation.sanitizedBody,
      currentProfile,
      stageProfileUpdate,
      cancelConfirmation,
      operationApplied: state.operation || 'add'
    });
  }

  // --- SECTION: WORK EXPERIENCE ---
  if (activeSection === HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE) {
    const existingList = Array.isArray(currentProfile?.work_experience) ? currentProfile.work_experience : [];
    if (state.operation === 'remove') {
      if (existingList.length === 0) {
        return { handled: true, text: 'You do not have any work experience entries on your HirePool profile to remove.' };
      }
      const removeIdx = findMatchingEntryIndex(existingList, raw, parsedIdx, ['company', 'title']);
      if (removeIdx < 0) {
        state.stage = 'collecting';
        session.hirePoolProfileEdit = state;
        return {
          handled: true,
          text: buildSectionPrompt(activeSection, currentProfile, {
            operation: 'remove',
            pendingSections: state.pendingSections
          })
        };
      }
      const nextList = existingList.filter((_, i) => i !== removeIdx);
      return await finalizeCandidateConfirmationStage({
        state,
        session,
        activeSection,
        sanitizedBody: { work_experience: nextList },
        currentProfile,
        stageProfileUpdate,
        cancelConfirmation,
        operationApplied: 'remove',
        notes: [`Removing work experience entry #${removeIdx + 1}: ${existingList[removeIdx]?.title || ''} at ${existingList[removeIdx]?.company || ''}`]
      });
    }

    const bareCommand = /^(?:(?:please\s+)?(?:add|edit|update|modify)\s+(?:a\s+|an\s+|my\s+)?(?:work\s*experience|employment(?:\s+details)?|previous\s+(?:company|job)|experience)|work\s*experience|experience|continue|next)\s*[.!?]*$/i.test(text);

    if (bareCommand && !state.draftData?.work_experience?.company && !state.draftData?.work_experience?.title) {
      state.stage = 'collecting';
      state.draftData = {};
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: buildSectionPrompt(activeSection, currentProfile, {
          operation: state.operation,
          pendingSections: state.pendingSections
        })
      };
    }

    const currentExpDraft = state.stage === 'awaiting_confirmation' ? {} : (state.draftData?.work_experience || {});
    let expectingField = null;
    if (currentExpDraft.title && !currentExpDraft.company) expectingField = 'company';
    else if (currentExpDraft.company && !currentExpDraft.title) expectingField = 'title';

    const { draft: parsedDraft, errors: parseErrors } = parseWorkExperienceFromMessage(raw, currentExpDraft, { expectingField });
    if (parseErrors.length > 0) {
      state.draftData = { ...state.draftData, work_experience: parsedDraft };
      state.validationState = { valid: false, errors: { work_experience: parseErrors[0] } };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: `I could not validate that work experience detail: **${parseErrors[0]}** Please correct it and try again.`
      };
    }

    if (state.operation === 'edit' && existingList.length > 1 && state.targetIndex === null) {
      state.draftData = { ...state.draftData, work_experience: parsedDraft };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: buildSectionPrompt(activeSection, currentProfile, {
          operation: 'edit',
          pendingSections: state.pendingSections
        })
      };
    }
    if (state.operation === 'edit' && existingList.length === 0) state.operation = 'add';
    if (state.operation === 'edit' && state.targetIndex === null && existingList.length === 1) state.targetIndex = 0;

    const effectiveEntry = state.operation === 'edit' && Number.isInteger(state.targetIndex) && existingList[state.targetIndex]
      ? {
          ...existingList[state.targetIndex],
          ...Object.fromEntries(Object.entries(parsedDraft).filter(([k, v]) => (k === 'is_current' ? true : v !== null && v !== '')))
        }
      : parsedDraft;

    const missingRequired = [];
    if (!effectiveEntry.company?.trim()) missingRequired.push('**Company name**');
    if (!effectiveEntry.title?.trim()) missingRequired.push('**Job title / role**');

    state.draftData = { ...state.draftData, work_experience: parsedDraft };
    if (missingRequired.length > 0) {
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      const capturedParts = [
        parsedDraft.title ? `- **Job title:** ${parsedDraft.title}` : null,
        parsedDraft.company ? `- **Company:** ${parsedDraft.company}` : null,
        parsedDraft.location ? `- **Location:** ${parsedDraft.location}` : null,
        parsedDraft.start_date ? `- **Start date:** ${parsedDraft.start_date}` : null,
        parsedDraft.is_current ? `- **End date:** Present (currently working)` : (parsedDraft.end_date ? `- **End date:** ${parsedDraft.end_date}` : null)
      ].filter(Boolean);

      return {
        handled: true,
        text: [
          capturedParts.length ? 'I captured these work experience details so far:\n' + capturedParts.join('\n') : 'To add work experience, I need both your company and job title.',
          '',
          `Please provide the missing required detail${missingRequired.length > 1 ? 's' : ''}: ${missingRequired.join(' and ')}.`
        ].join('\n')
      };
    }

    const mergedBody = mergeCandidateProfileUpdate(
      currentProfile,
      { work_experience: [effectiveEntry] },
      { operation: state.operation, targetIndex: state.targetIndex }
    );
    const validation = validateCandidateProfileUpdatePayload(mergedBody, currentProfile);
    if (!validation.isValid) {
      state.validationState = { valid: false, errors: validation.errors };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return { handled: true, text: `Validation failed: **${validation.firstError}** Please correct and resend.` };
    }

    return await finalizeCandidateConfirmationStage({
      state,
      session,
      activeSection,
      sanitizedBody: validation.sanitizedBody,
      currentProfile,
      stageProfileUpdate,
      cancelConfirmation,
      operationApplied: state.operation || 'add'
    });
  }

  // --- SECTION: CERTIFICATIONS ---
  if (activeSection === HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS) {
    const existingList = Array.isArray(currentProfile?.certifications) ? currentProfile.certifications : [];
    if (state.operation === 'remove') {
      if (existingList.length === 0) {
        return { handled: true, text: 'You do not have any certifications saved on your HirePool profile to remove.' };
      }
      const removeIdx = findMatchingEntryIndex(existingList, raw, parsedIdx, ['name', 'issuing_organization']);
      if (removeIdx < 0) {
        state.stage = 'collecting';
        session.hirePoolProfileEdit = state;
        return {
          handled: true,
          text: buildSectionPrompt(activeSection, currentProfile, {
            operation: 'remove',
            pendingSections: state.pendingSections
          })
        };
      }
      const nextList = existingList.filter((_, i) => i !== removeIdx);
      return await finalizeCandidateConfirmationStage({
        state,
        session,
        activeSection,
        sanitizedBody: { certifications: nextList },
        currentProfile,
        stageProfileUpdate,
        cancelConfirmation,
        operationApplied: 'remove',
        notes: [`Removing certification #${removeIdx + 1}: ${existingList[removeIdx]?.name || ''}`]
      });
    }

    const bareCommand = /^(?:(?:please\s+)?(?:add|edit|update|modify)\s+(?:a\s+|an\s+|my\s+)?(?:certifications?|certificates?)|certifications?|certificates?|continue|next)\s*[.!?]*$/i.test(text);
    if (bareCommand && !state.draftData?.certifications?.name) {
      state.stage = 'collecting';
      state.draftData = {};
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: buildSectionPrompt(activeSection, currentProfile, {
          operation: state.operation,
          pendingSections: state.pendingSections
        })
      };
    }

    const currentCertDraft = state.stage === 'awaiting_confirmation' ? {} : (state.draftData?.certifications || {});
    const { draft: parsedCert, errors: parseErrors } = parseCertificationsFromMessage(raw, currentCertDraft, {
      expectingField: !currentCertDraft.name ? 'name' : null
    });
    if (parseErrors.length > 0) {
      state.draftData = { ...state.draftData, certifications: parsedCert };
      state.validationState = { valid: false, errors: { certifications: parseErrors[0] } };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: `I could not validate that certification detail: **${parseErrors[0]}** Please correct it and try again.`
      };
    }

    if (state.operation === 'edit' && existingList.length === 0) state.operation = 'add';
    if (state.operation === 'edit' && state.targetIndex === null && existingList.length === 1) state.targetIndex = 0;

    const effectiveEntry = state.operation === 'edit' && Number.isInteger(state.targetIndex) && existingList[state.targetIndex]
      ? {
          ...existingList[state.targetIndex],
          ...Object.fromEntries(Object.entries(parsedCert).filter(([, v]) => v !== null && v !== ''))
        }
      : parsedCert;

    if (!effectiveEntry.name?.trim()) {
      state.draftData = { ...state.draftData, certifications: parsedCert };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: 'Please provide the **Certification Name** (required), along with optional issuing organization, issue/expiry date, credential ID, or URL.'
      };
    }

    const mergedBody = mergeCandidateProfileUpdate(
      currentProfile,
      { certifications: [effectiveEntry] },
      { operation: state.operation, targetIndex: state.targetIndex }
    );
    const validation = validateCandidateProfileUpdatePayload(mergedBody, currentProfile);
    if (!validation.isValid) {
      state.validationState = { valid: false, errors: validation.errors };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return { handled: true, text: `Validation failed: **${validation.firstError}** Please correct and resend.` };
    }

    return await finalizeCandidateConfirmationStage({
      state,
      session,
      activeSection,
      sanitizedBody: validation.sanitizedBody,
      currentProfile,
      stageProfileUpdate,
      cancelConfirmation,
      operationApplied: state.operation || 'add'
    });
  }

  // --- SECTION: SKILLS ---
  if (activeSection === HIREPOOL_PROFILE_SECTIONS.SKILLS) {
    const existingSkills = Array.isArray(currentProfile?.skills) ? currentProfile.skills : [];

    // 1. Compound remove + add in a single message (e.g., "remove SQL and add PostgreSQL, Redis")
    const compound = parseCompoundSkillEdit(raw);
    if (compound.matched) {
      const nextSkills = applySkillsUpdate({
        baseSkills: existingSkills,
        removeItems: compound.removeSkills,
        addItems: compound.addSkills
      });
      if (nextSkills.length === 0) {
        return {
          handled: true,
          text: 'At least one skill is required on your HirePool profile (`Profile.tsx`). Add another skill before removing all existing ones.'
        };
      }
      const validation = validateCandidateProfileUpdatePayload({ skills: nextSkills }, currentProfile);
      if (!validation.isValid) {
        state.validationState = { valid: false, errors: validation.errors };
        state.stage = 'collecting';
        session.hirePoolProfileEdit = state;
        return { handled: true, text: `Validation failed: **${validation.firstError}**` };
      }
      const notes = compound.corrections.map(c => `Normalized skill "${c.from}" -> "${c.to}"`);
      return await finalizeCandidateConfirmationStage({
        state,
        session,
        activeSection,
        sanitizedBody: validation.sanitizedBody,
        currentProfile,
        stageProfileUpdate,
        cancelConfirmation,
        operationApplied: 'replace',
        notes
      });
    }

    // 2. Parse single-operation input while strictly stripping instruction phrases
    const currentSkillOp = state.operation && ['add', 'replace', 'remove', 'ambiguous'].includes(state.operation)
      ? state.operation
      : 'add';
    const parsedSkills = parseSkillsInput(raw, existingSkills, currentSkillOp);

    if (parsedSkills.kind === 'clear') {
      state.stage = 'collecting';
      state.draftData = { ...state.draftData, skillModeAmbiguous: false };
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: 'HirePool requires at least one skill on your profile (`Profile.tsx`), so I cannot save an empty skills list. Provide replacement skills (e.g., *"Replace my skills with Python, Go"*) or tell me specific skills to remove.'
      };
    }

    if (parsedSkills.kind === 'instruction' || parsedSkills.kind === 'empty') {
      state.stage = 'collecting';
      state.draftData = {
        ...state.draftData,
        skillModeAmbiguous: parsedSkills.operation === 'ambiguous'
      };
      state.operation = parsedSkills.operation;
      state.updatedAt = new Date().toISOString();
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: buildSectionPrompt(activeSection, currentProfile, {
          operation: parsedSkills.operation,
          pendingSections: state.pendingSections
        })
      };
    }

    const correctionNotes = parsedSkills.corrections.map(c => `Normalized skill "${c.from}" -> "${c.to}"`);
    const needsClarification =
      existingSkills.length > 0 &&
      (parsedSkills.operation === 'ambiguous' || (state.draftData?.skillModeAmbiguous && !/^\s*(?:add|also\s+add|replace|overwrite|set|remove|delete|drop)\b/i.test(text)));

    if (needsClarification) {
      state.stage = 'awaiting_skill_operation';
      state.draftData = {
        ...state.draftData,
        pendingSkillItems: parsedSkills.skills,
        pendingSkillNotes: correctionNotes
      };
      state.updatedAt = new Date().toISOString();
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: `You currently have **${existingSkills.join(', ')}**. Would you like to **add** \`${parsedSkills.skills.join(', ')}\` to your existing skills, or **replace** your existing skills with them? (Reply **"add"** or **"replace"**.)`
      };
    }

    if (parsedSkills.operation === 'remove') {
      const existingLower = new Set(existingSkills.map(s => String(s).trim().toLowerCase()));
      const foundToRemove = parsedSkills.skills.filter(s => existingLower.has(s.toLowerCase()));
      if (foundToRemove.length === 0) {
        return {
          handled: true,
          text: `None of those skills (${parsedSkills.skills.join(', ')}) were found in your current skills list: **${existingSkills.join(', ') || 'none'}**.`
        };
      }
    }

    const mergedSkills = applySkillsUpdate({
      baseSkills: existingSkills,
      operation: parsedSkills.operation,
      items: parsedSkills.skills
    });

    if (parsedSkills.operation === 'remove' && mergedSkills.length === 0) {
      return {
        handled: true,
        text: 'At least one skill is required on your HirePool profile (`Profile.tsx`). Add another skill before removing your last skill, or replace your list with new skills.'
      };
    }

    const validation = validateCandidateProfileUpdatePayload({ skills: mergedSkills }, currentProfile);
    if (!validation.isValid) {
      state.validationState = { valid: false, errors: validation.errors };
      state.stage = 'collecting';
      session.hirePoolProfileEdit = state;
      return { handled: true, text: `Validation failed: **${validation.firstError}**` };
    }

    return await finalizeCandidateConfirmationStage({
      state,
      session,
      activeSection,
      sanitizedBody: validation.sanitizedBody,
      currentProfile,
      stageProfileUpdate,
      cancelConfirmation,
      operationApplied: parsedSkills.operation,
      notes: correctionNotes
    });
  }

  // --- SECTION: PREFERENCES / LINKS / BASIC_INFO ---
  if (
    activeSection === HIREPOOL_PROFILE_SECTIONS.PREFERENCES ||
    activeSection === HIREPOOL_PROFILE_SECTIONS.LINKS ||
    activeSection === HIREPOOL_PROFILE_SECTIONS.BASIC_INFO
  ) {
    let pendingField = state.draftData?.pendingField || null;
    if (!pendingField) {
      const fieldTriggers = [
        ['phone', /\b(?:phone(?:\s+number)?|mobile)\b/i],
        ['current_location', /\b(?:current[_\s]+location|location)\b/i],
        ['job_title', /\b(?:job[_\s]+title|headline)\b/i],
        ['first_name', /\bfirst[_\s]+name\b/i],
        ['last_name', /\blast[_\s]+name\b/i],
        ['years_of_experience', /\byears?\s+of\s+experience\b/i],
        ['months_of_experience', /\bmonths?\s+of\s+experience\b/i],
        ['notice_period_days', /\bnotice\s+period\b/i],
        ['salary_currency', /\b(?:salary[_\s]+currency|currency)\b/i],
        ['preferred_work_types', /\b(?:preferred[_\s]+work[_\s]+types?|work\s+types?)\b/i],
        ['preferred_job_types', /\b(?:preferred[_\s]+job[_\s]+types?|job\s+types?)\b/i],
        ['linkedin_url', /\blinkedin\b/i],
        ['github_url', /\bgithub\b/i],
        ['portfolio_url', /\bportfolio\b/i],
        ['personal_website', /\bpersonal\s+website\b/i],
        ['is_open_to_work', /\bopen\s+to\s+work\b/i]
      ];
      for (const [fKey, fRegex] of fieldTriggers) {
        if (fRegex.test(text)) {
          pendingField = fKey;
          break;
        }
      }
    }

    state.stage = 'collecting';
    state.draftData = { ...state.draftData, pendingField };
    state.updatedAt = new Date().toISOString();
    session.hirePoolProfileEdit = state;
    return {
      handled: true,
      text: pendingField
        ? `What value would you like to set for **${pendingField.replace(/_/g, ' ')}**?`
        : buildSectionPrompt(activeSection, currentProfile, {
            operation: state.operation,
            pendingSections: state.pendingSections
          })
    };
  }

  return { handled: false };
}

/**
 * Unified role-aware HirePool Profile Edit dispatcher supporting Candidate,
 * Client (Employer/Company), and Consultancy (Agency) roles.
 */
export async function handleHirePoolProfileEditTurn({
  message,
  session,
  authUser,
  readProfile,
  readCurrentProfile,
  stageProfileUpdate,
  cancelConfirmation
}) {
  const text = normalizeText(message);
  if (!text) return { handled: false };

  ensureRoleScopedProfileEditState(session, authUser);

  const role = authUser?.role;
  if (role === 'client' || role === 'consultancy') {
    return await handleOrgProfileEditTurn({
      message,
      session,
      authUser,
      readProfile: readProfile || readCurrentProfile,
      stageProfileUpdate,
      cancelConfirmation
    });
  }

  return await handleCandidateProfileEditTurn({
    message,
    session,
    authUser,
    readCurrentProfile: readCurrentProfile || readProfile,
    stageProfileUpdate,
    cancelConfirmation
  });
}
