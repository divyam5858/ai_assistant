/**
 * Shared Constants, Validation, Extractors, Review Formatters, and Readback Verifiers
 * for HirePool Profile Updates across Candidate, Client (Employer), and Consultancy (Agency) roles.
 */

import {
  LIMITS,
  rangeError,
  CLIENT_INDUSTRIES,
  CONSULTANCY_SPECIALIZATIONS,
  COMPANY_SIZES,
  CONSULTANCY_TYPES,
  WORK_TYPES,
  JOB_TYPES,
  validatePhoneNumber,
  validateWebsiteUrl,
  validateGstin
} from '../../backend/src/local-integrations/hirepool-validation.js';

export const HIREPOOL_PROFILE_SECTIONS = Object.freeze({
  PROFESSIONAL_SUMMARY: 'professional_summary',
  EDUCATION: 'education',
  WORK_EXPERIENCE: 'work_experience',
  CERTIFICATIONS: 'certifications',
  SKILLS: 'skills',
  BASIC_INFO: 'basic_info',
  PREFERENCES: 'preferences',
  LINKS: 'links',
  COMPANY_PROFILE: 'company_profile',
  CONSULTANCY_PROFILE: 'consultancy_profile',
  USER_PROFILE: 'user_profile'
});

export const HIREPOOL_PROFILE_SECTION_LABELS = Object.freeze({
  [HIREPOOL_PROFILE_SECTIONS.PROFESSIONAL_SUMMARY]: 'Professional Summary',
  [HIREPOOL_PROFILE_SECTIONS.EDUCATION]: 'Education',
  [HIREPOOL_PROFILE_SECTIONS.WORK_EXPERIENCE]: 'Work Experience',
  [HIREPOOL_PROFILE_SECTIONS.CERTIFICATIONS]: 'Certifications',
  [HIREPOOL_PROFILE_SECTIONS.SKILLS]: 'Skills',
  [HIREPOOL_PROFILE_SECTIONS.BASIC_INFO]: 'Basic Details & Preferences',
  [HIREPOOL_PROFILE_SECTIONS.PREFERENCES]: 'Work & Compensation Preferences',
  [HIREPOOL_PROFILE_SECTIONS.LINKS]: 'Profile & Portfolio Links',
  [HIREPOOL_PROFILE_SECTIONS.COMPANY_PROFILE]: 'Company Profile',
  [HIREPOOL_PROFILE_SECTIONS.CONSULTANCY_PROFILE]: 'Consultancy Profile',
  [HIREPOOL_PROFILE_SECTIONS.USER_PROFILE]: 'Personal Account Profile'
});

export const HIREPOOL_PROFILE_TYPES = Object.freeze({
  CANDIDATE: 'candidate',
  CLIENT_COMPANY: 'client_company',
  CLIENT_ME: 'client_me',
  CONSULTANCY_ORG: 'consultancy_org',
  CONSULTANCY_ME: 'consultancy_me'
});

export const HIREPOOL_CURRENCIES = Object.freeze(['INR', 'USD', 'EUR', 'GBP']);

export const WORK_TYPE_LABELS = Object.freeze({
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site'
});

export const JOB_TYPE_LABELS = Object.freeze({
  full_time: 'Full Time',
  contract: 'Contract'
});

export const MONTH_MAP = Object.freeze({
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12'
});

const PRESENT_DATE_PATTERN = /^(?:present|current|currently|now|ongoing|till\s*date|to\s*date)$/i;

export function normalizeText(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normKeyPart(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

export function compareYearMonth(start, end) {
  if (!start || !end) return null;
  const [sYear, sMonth] = String(start).split('-').map(n => Number.parseInt(n, 10));
  const [eYear, eMonth] = String(end).split('-').map(n => Number.parseInt(n, 10));
  if (!Number.isFinite(sYear) || !Number.isFinite(eYear)) return null;
  if (eYear < sYear) return 'End date cannot be earlier than start date.';
  if (eYear === sYear && Number.isFinite(sMonth) && Number.isFinite(eMonth) && eMonth < sMonth) {
    return 'End date cannot be earlier than start date.';
  }
  return null;
}

/**
 * Parse and normalize a month/year string into HirePool UI format (`YYYY-MM` or `YYYY`).
 */
export function parseHirePoolMonthDate(raw, { allowPresent = false } = {}) {
  if (raw === null || raw === undefined || raw === '') {
    return { valid: true, value: null, isPresent: false };
  }
  const text = normalizeText(raw).replace(/,/g, '').trim();
  if (!text) return { valid: true, value: null, isPresent: false };

  if (allowPresent && PRESENT_DATE_PATTERN.test(text)) {
    return { valid: true, value: null, isPresent: true };
  }

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10);
    const month = Number.parseInt(isoMatch[2], 10);
    if (year < 1950 || year > 2100 || month < 1 || month > 12) {
      return { valid: false, value: null, isPresent: false, error: `Invalid date "${raw}". Use YYYY-MM or Month YYYY (e.g., Dec 2022).` };
    }
    if (isoMatch[3]) {
      const day = Number.parseInt(isoMatch[3], 10);
      if (day < 1 || day > 31) {
        return { valid: false, value: null, isPresent: false, error: `Invalid day in date "${raw}".` };
      }
    }
    return { valid: true, value: `${year}-${String(month).padStart(2, '0')}`, isPresent: false };
  }

  const slashMatch = text.match(/^(\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const month = Number.parseInt(slashMatch[1], 10);
    const year = Number.parseInt(slashMatch[2], 10);
    if (year < 1950 || year > 2100 || month < 1 || month > 12) {
      return { valid: false, value: null, isPresent: false, error: `Invalid date "${raw}". Month must be 01-12.` };
    }
    return { valid: true, value: `${year}-${String(month).padStart(2, '0')}`, isPresent: false };
  }

  const namedMatch = text.match(/^([a-zA-Z]+)\.?\s+(\d{4})$/);
  if (namedMatch) {
    const mm = MONTH_MAP[namedMatch[1].toLowerCase()];
    const year = Number.parseInt(namedMatch[2], 10);
    if (!mm || year < 1950 || year > 2100) {
      return { valid: false, value: null, isPresent: false, error: `Invalid month/year "${raw}".` };
    }
    return { valid: true, value: `${year}-${mm}`, isPresent: false };
  }

  const yearOnly = text.match(/^(\d{4})$/);
  if (yearOnly) {
    const year = Number.parseInt(yearOnly[1], 10);
    if (year < 1950 || year > 2100) {
      return { valid: false, value: null, isPresent: false, error: `Year "${raw}" must be between 1950 and 2100.` };
    }
    return { valid: true, value: `${year}`, isPresent: false };
  }

  return {
    valid: false,
    value: null,
    isPresent: false,
    error: `Invalid date "${raw}". Use Month YYYY (e.g., December 2022) or YYYY-MM format.`
  };
}

// ============================================================================
// Skills Normalization, Typo Repair & Instruction Separation
// ============================================================================

export const SKILL_TYPO_MAP = Object.freeze({
  kuberetes: 'Kubernetes',
  kubernates: 'Kubernetes',
  kubernets: 'Kubernetes',
  kube: 'Kubernetes',
  pytohn: 'Python',
  pyhton: 'Python',
  javscript: 'JavaScript',
  javascipt: 'JavaScript',
  typescipt: 'TypeScript',
  typecript: 'TypeScript',
  postgress: 'PostgreSQL',
  postgre: 'PostgreSQL',
  mongdb: 'MongoDB',
  dockr: 'Docker'
});

export const SKILL_CANONICAL_CASE = Object.freeze({
  'react.js': 'React.js',
  reactjs: 'React.js',
  react: 'React',
  'node.js': 'Node.js',
  nodejs: 'Node.js',
  'next.js': 'Next.js',
  nextjs: 'Next.js',
  'vue.js': 'Vue.js',
  vuejs: 'Vue.js',
  'express.js': 'Express.js',
  python: 'Python',
  aws: 'AWS',
  s3: 'S3',
  'amazon s3': 'Amazon S3',
  'fast api': 'FastAPI',
  fastapi: 'FastAPI',
  'gen ai': 'Gen AI',
  genai: 'Gen AI',
  'generative ai': 'Generative AI',
  'agentic ai': 'Agentic AI',
  rag: 'RAG',
  n8n: 'n8n',
  docker: 'Docker',
  kubernetes: 'Kubernetes',
  sql: 'SQL',
  nosql: 'NoSQL',
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  redis: 'Redis',
  graphql: 'GraphQL',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  html: 'HTML',
  css: 'CSS',
  git: 'Git',
  go: 'Go',
  golang: 'Go',
  java: 'Java',
  rust: 'Rust',
  gcp: 'GCP',
  azure: 'Azure',
  'c++': 'C++',
  'c#': 'C#',
  '.net': '.NET'
});

const DOT_EXTENSION_PATTERN = /\.(?:js|ts|jsx|tsx|py|net|io|ai|ml|css|html|sql|go|rb|cs)$/i;

const INSTRUCTION_FILLER_SKILL_PATTERN =
  /^(?:(?:please|can\s+you|could\s+you|i\s+(?:want|would\s+like|need)\s+to|let'?s)\s+)?(?:add|update|edit|change|modify|replace|remove|delete|set|clear)\s+(?:all\s+|some\s+|new\s+|my\s+|the\s+)?skills?$/i;

const SKILL_STOPWORDS = new Set(['and', 'or', 'etc', 'etc.', 'skills', 'skill', 'my', 'the', 'none']);

export function isSkillInstructionPhrase(text) {
  const norm = normalizeText(text).replace(/[.!?]+$/g, '').trim();
  if (!norm) return true;
  if (INSTRUCTION_FILLER_SKILL_PATTERN.test(norm)) return true;
  if (/^(?:continue|next|proceed|done|skip|cancel|help)$/i.test(norm)) return true;
  return false;
}

export function cleanSkillToken(rawToken) {
  let token = normalizeText(rawToken)
    .replace(/^[-*•\u2022]+\s*/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim();

  if (!token) return null;

  // Strip trailing sentence punctuation while preserving .js, .ts, .py, .net, etc.
  // Also handle e.g. "react.js." -> "react.js"
  while (/[!?,;:]$/.test(token)) {
    token = token.slice(0, -1).trim();
  }
  if (token.endsWith('.')) {
    const withoutDot = token.slice(0, -1);
    if (DOT_EXTENSION_PATTERN.test(withoutDot) || !DOT_EXTENSION_PATTERN.test(token)) {
      token = withoutDot.trim();
    }
  }

  if (!token) return null;
  const lower = token.toLowerCase().replace(/\s+/g, ' ');
  if (SKILL_STOPWORDS.has(lower) || isSkillInstructionPhrase(token)) {
    return null;
  }

  if (Object.hasOwn(SKILL_TYPO_MAP, lower)) {
    return {
      skill: SKILL_TYPO_MAP[lower],
      correctedFrom: token
    };
  }
  if (Object.hasOwn(SKILL_CANONICAL_CASE, lower)) {
    return {
      skill: SKILL_CANONICAL_CASE[lower],
      correctedFrom: null
    };
  }
  return {
    skill: token.slice(0, 100),
    correctedFrom: null
  };
}

export function normalizeSkillsArray(rawList) {
  const items = Array.isArray(rawList) ? rawList : [];
  const deduped = [];
  const seen = new Set();
  const corrections = [];

  for (const raw of items) {
    const cleaned = cleanSkillToken(raw);
    if (!cleaned || !cleaned.skill) continue;
    const key = cleaned.skill.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(cleaned.skill);
    }
    if (cleaned.correctedFrom) {
      corrections.push({ from: cleaned.correctedFrom, to: cleaned.skill });
    }
  }
  return { skills: deduped, corrections };
}

/**
 * Parse a user message in the Skills workflow (or direct inline skill command),
 * cleanly separating edit instructions from actual skill items.
 */
export function parseSkillsInput(rawMessage, existingSkills = [], currentOperation = 'add') {
  const raw = String(rawMessage || '').trim();
  const text = normalizeText(raw);
  const hasExisting = Array.isArray(existingSkills) && existingSkills.length > 0;

  // Bare instruction commands without item values — NEVER treat as skill names
  const bareActionMatch = text.match(
    /^(?:(?:please|can\s+you|could\s+you)\s+)?(?:i\s+(?:want|would\s+like|need)\s+to\s+|let'?s\s+)?(add|update|edit|change|modify|replace(?:\s+all)?|remove|delete|set|clear(?:\s+all)?)\s+(?:all\s+|some\s+|new\s+|my\s+|the\s+)?(?:technical\s+)?skills?\s*[.!?]*$/i
  );
  if (bareActionMatch) {
    const verb = bareActionMatch[1].toLowerCase();
    if (verb.startsWith('clear')) {
      return { kind: 'clear', operation: 'replace', skills: [], corrections: [] };
    }
    let operation = 'add';
    if (verb.startsWith('replace')) operation = 'replace';
    else if (verb === 'remove' || verb === 'delete') operation = 'remove';
    else if (verb !== 'add' && hasExisting) operation = 'ambiguous';
    return { kind: 'instruction', operation, skills: [], corrections: [] };
  }

  if (/^(?:skills?|continue|next)\s*[.!?]*$/i.test(text)) {
    return { kind: 'instruction', operation: currentOperation || 'add', skills: [], corrections: [] };
  }

  // Check clear/remove-all phrasing
  if (/^(?:please\s+)?(?:clear|remove|delete)\s+all\s+(?:my\s+|the\s+)?skills?\s*[.!?]*$/i.test(text)) {
    return { kind: 'clear', operation: 'replace', skills: [], corrections: [] };
  }

  // Detect explicit operation prefix with values
  let explicitOp = null;
  let working = raw;

  const prefixRules = [
    {
      op: 'remove',
      regex: /^(?:(?:please|actually|instead)\s+)*(?:remove|delete|drop)\s+(?:(?:my|the)\s+)?(?:skills?\s*(?::|called|named|such\s+as)?\s*)?/i,
      suffixRegex: /\s+(?:from\s+(?:my\s+|the\s+)?skills?(?:\s+list)?)\s*[.!?]*$/i
    },
    {
      op: 'replace',
      regex: /^(?:(?:please|actually|instead)\s+)*(?:replace(?:\s+all)?|overwrite|set)\s+(?:(?:my|the|existing)\s+)?(?:skills?\s*)?(?:with|to|as|:)?\s*/i
    },
    {
      op: 'add',
      regex: /^(?:(?:please|actually|instead)\s+)*(?:also\s+)?add\s+(?:(?:new|more|some|to)\s+)?(?:(?:my|the)\s+)?(?:skills?\s*)?(?:like|such\s+as|including|to|as|with|:)?\s*/i
    },
    {
      op: 'ambiguous',
      regex: /^(?:(?:please|actually|instead)\s+)*(?:update|edit|change|modify)\s+(?:(?:my|the|all)\s+)?(?:skills?\s*)?(?:to|with|as|:)?\s*/i
    }
  ];

  for (const rule of prefixRules) {
    if (rule.regex.test(working)) {
      const stripped = working.replace(rule.regex, '').trim();
      const cleanedTail = rule.suffixRegex ? stripped.replace(rule.suffixRegex, '').trim() : stripped;
      if (cleanedTail.length > 0 && cleanedTail.toLowerCase() !== working.toLowerCase()) {
        explicitOp = rule.op;
        working = cleanedTail;
        break;
      }
    }
  }

  // Strip natural-language lead-ins and trailing destination skill clauses
  working = working
    .replace(/^(?:here\s+are\s+my\s+skills?|my\s+(?:technical\s+)?skills?\s+(?:are|include)|i\s+(?:know|have\s+skills\s+in|work\s+with|specialize\s+in)|skills\s*(?:are|include)?)\s*(?:such\s+as|including|:)?\s*/i, '')
    .replace(/\s+(?:on|to|into|in)\s+(?:my\s+|the\s+)?(?:technical\s+)?skills?(?:\s+list)?(?:\s+on\s+my\s+profile)?\s*[.!?]*$/i, '')
    .replace(/\s+(?:on|to|in)\s+my\s+profile\s*[.!?]*$/i, '')
    .trim();

  if (isSkillInstructionPhrase(working)) {
    return {
      kind: 'instruction',
      operation: explicitOp || (hasExisting ? 'ambiguous' : 'add'),
      skills: [],
      corrections: []
    };
  }

  // Split comma, semicolon, pipe, newline, and ", and " or " and " between skill items
  const preSplit = working
    .replace(/,\s+and\s+/gi, ',')
    .replace(/;\s+and\s+/gi, ';');

  const rawChunks = preSplit
    .split(/[,;\n|]+/)
    .flatMap(chunk => {
      const trimmedChunk = chunk.trim();
      if (!trimmedChunk) return [];
      // Only split standalone " and " when it joins distinct items (avoid breaking long prose clauses)
      if (/\s+and\s+/i.test(trimmedChunk) && trimmedChunk.split(/\s+/).length <= 8) {
        return trimmedChunk.split(/\s+and\s+/i);
      }
      return [trimmedChunk];
    });

  const { skills, corrections } = normalizeSkillsArray(rawChunks);
  let resolvedOperation = explicitOp || currentOperation || 'add';
  if (resolvedOperation === 'ambiguous' && !hasExisting) {
    resolvedOperation = 'add';
  }
  if (resolvedOperation === 'edit') {
    resolvedOperation = hasExisting ? 'ambiguous' : 'add';
  }

  return {
    kind: skills.length > 0 ? 'values' : 'empty',
    operation: resolvedOperation,
    skills,
    corrections
  };
}

// ============================================================================
// Client & Consultancy Normalization + Validation + Extractors
// ============================================================================

export function matchAllowedOption(raw, allowedValues, aliases = {}) {
  const cleaned = normalizeText(raw).toLowerCase();
  if (!cleaned) return null;
  if (Object.hasOwn(aliases, cleaned)) {
    return aliases[cleaned];
  }
  return allowedValues.find(opt => opt.toLowerCase() === cleaned) || null;
}

export function normalizeCompanySize(raw) {
  const cleaned = normalizeText(raw)
    .toLowerCase()
    .replace(/\s*employees?\s*/g, '')
    .replace(/\s+to\s+/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*plus$/i, '+')
    .trim();
  return COMPANY_SIZES.find(sz => sz === cleaned) || null;
}

export function normalizeSocialLinksPatch(rawLinks) {
  if (!rawLinks || typeof rawLinks !== 'object' || Array.isArray(rawLinks)) {
    return { isValid: false, errors: { social_media_links: 'Social media links must be an object with linkedin, twitter, facebook, or instagram URLs.' }, sanitized: {} };
  }
  const allowedKeys = ['linkedin', 'twitter', 'facebook', 'instagram'];
  const errors = {};
  const sanitized = {};
  for (const [k, v] of Object.entries(rawLinks)) {
    const key = k.trim().toLowerCase();
    if (!allowedKeys.includes(key)) {
      errors[`social_media_links.${k}`] = `Unsupported social link "${k}". Supported keys: ${allowedKeys.join(', ')}.`;
      continue;
    }
    if (v === null || v === '') {
      sanitized[key] = null;
      continue;
    }
    const urlRes = validateWebsiteUrl(String(v), { required: false, fieldLabel: `${key} URL` });
    if (!urlRes.isValid) {
      errors[`social_media_links.${key}`] = urlRes.error;
    } else {
      sanitized[key] = urlRes.sanitized;
    }
  }
  return { isValid: Object.keys(errors).length === 0, errors, sanitized };
}

const CLIENT_EDITABLE_FIELDS = new Set([
  'company_name',
  'industry',
  'company_size',
  'headquarters_location',
  'company_website',
  'about_company',
  'founding_year',
  'social_media_links',
  'registration_number',
  'gst_tax_id'
]);

const CONSULTANCY_EDITABLE_FIELDS = new Set([
  'consultancy_name',
  'consultancy_type',
  'industry_specialization',
  'company_size',
  'headquarters_location',
  'website',
  'about_company',
  'founding_year',
  'social_media_links',
  'commission_structure'
]);

const ORG_USER_EDITABLE_FIELDS = new Set(['full_name', 'designation', 'phone']);

export function validateClientProfileUpdatePayload(body, existingProfile = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    return {
      isValid: false,
      errors: { body: 'Provide at least one company profile field to update.' },
      firstError: 'Provide at least one company profile field to update.',
      sanitizedBody: {}
    };
  }

  const errors = {};
  const sanitized = {};

  for (const key of Object.keys(body)) {
    if (!CLIENT_EDITABLE_FIELDS.has(key)) {
      errors[key] = `Field "${key}" is not editable on HirePool company profiles.`;
    }
  }

  if (Object.hasOwn(body, 'company_name')) {
    const val = typeof body.company_name === 'string' ? body.company_name.trim() : '';
    if (!val || val.length > 255) {
      errors.company_name = 'Company name must be between 1 and 255 characters.';
    } else {
      sanitized.company_name = val;
    }
  }

  if (Object.hasOwn(body, 'industry')) {
    const rawInd = typeof body.industry === 'string' ? body.industry.trim() : '';
    if (!rawInd || rawInd.length > 100) {
      errors.industry = 'Industry is required (up to 100 characters).';
    } else {
      const matched = matchAllowedOption(rawInd, CLIENT_INDUSTRIES, {
        tech: 'Technology',
        it: 'Technology',
        software: 'Technology',
        ecommerce: 'E-commerce',
        'e commerce': 'E-commerce',
        fintech: 'Finance',
        health: 'Healthcare'
      });
      if (!matched) {
        errors.industry = `Please select a valid industry: ${CLIENT_INDUSTRIES.join(', ')}.`;
      } else {
        sanitized.industry = matched;
      }
    }
  }

  if (Object.hasOwn(body, 'company_size')) {
    const normSize = body.company_size ? normalizeCompanySize(body.company_size) : '';
    if (!normSize) {
      errors.company_size = `Please select a valid company size (${COMPANY_SIZES.join(', ')}).`;
    } else {
      sanitized.company_size = normSize;
    }
  }

  if (Object.hasOwn(body, 'headquarters_location')) {
    const val = typeof body.headquarters_location === 'string' ? body.headquarters_location.trim() : '';
    if (!val || val.length > 255) {
      errors.headquarters_location = 'Headquarters location must be between 1 and 255 characters.';
    } else {
      sanitized.headquarters_location = val;
    }
  }

  if (Object.hasOwn(body, 'company_website')) {
    const val = body.company_website === null ? '' : String(body.company_website || '').trim();
    const res = validateWebsiteUrl(val, { required: false, fieldLabel: 'Company website' });
    if (!res.isValid) {
      errors.company_website = res.error;
    } else {
      sanitized.company_website = res.sanitized || '';
    }
  }

  if (Object.hasOwn(body, 'about_company')) {
    const val = typeof body.about_company === 'string' ? body.about_company.trim() : '';
    if (!val) {
      errors.about_company = 'About company description cannot be empty.';
    } else if (val.length > 4000) {
      errors.about_company = 'About company description cannot exceed 4000 characters.';
    } else {
      sanitized.about_company = val;
    }
  }

  if (Object.hasOwn(body, 'founding_year')) {
    const yr = Number(body.founding_year);
    if (!Number.isFinite(yr) || !Number.isInteger(yr) || yr < LIMITS.foundingYear.min || yr > LIMITS.foundingYear.max) {
      errors.founding_year = `Founding year must be a whole year between ${LIMITS.foundingYear.min} and ${LIMITS.foundingYear.max}.`;
    } else {
      sanitized.founding_year = yr;
    }
  }

  if (Object.hasOwn(body, 'registration_number')) {
    const val = body.registration_number === null ? '' : String(body.registration_number || '').trim();
    if (val.length > 100) {
      errors.registration_number = 'Registration number cannot exceed 100 characters.';
    } else {
      sanitized.registration_number = val;
    }
  }

  if (Object.hasOwn(body, 'gst_tax_id')) {
    const rawGstin = body.gst_tax_id === null ? '' : String(body.gst_tax_id || '').trim().toUpperCase();
    if (rawGstin === '') {
      sanitized.gst_tax_id = '';
    } else {
      const gstRes = validateGstin(rawGstin);
      if (!gstRes.isValid) {
        errors.gst_tax_id = gstRes.error;
      } else {
        sanitized.gst_tax_id = rawGstin;
      }
    }
  }

  if (Object.hasOwn(body, 'social_media_links')) {
    const socialRes = normalizeSocialLinksPatch(body.social_media_links);
    if (!socialRes.isValid) {
      Object.assign(errors, socialRes.errors);
    } else {
      const mergedLinks = {
        ...(existingProfile?.social_media_links && typeof existingProfile.social_media_links === 'object'
          ? existingProfile.social_media_links
          : {}),
        ...socialRes.sanitized
      };
      sanitized.social_media_links = mergedLinks;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    firstError: Object.values(errors)[0] || null,
    sanitizedBody: sanitized
  };
}

export function validateConsultancyProfileUpdatePayload(body, existingProfile = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    return {
      isValid: false,
      errors: { body: 'Provide at least one consultancy profile field to update.' },
      firstError: 'Provide at least one consultancy profile field to update.',
      sanitizedBody: {}
    };
  }

  const errors = {};
  const sanitized = {};

  for (const key of Object.keys(body)) {
    if (!CONSULTANCY_EDITABLE_FIELDS.has(key)) {
      errors[key] = `Field "${key}" is not editable on HirePool consultancy profiles.`;
    }
  }

  if (Object.hasOwn(body, 'consultancy_name')) {
    const val = typeof body.consultancy_name === 'string' ? body.consultancy_name.trim() : '';
    if (!val || val.length > 255) {
      errors.consultancy_name = 'Consultancy name must be between 1 and 255 characters.';
    } else {
      sanitized.consultancy_name = val;
    }
  }

  if (Object.hasOwn(body, 'consultancy_type')) {
    const val = typeof body.consultancy_type === 'string' ? body.consultancy_type.trim().toLowerCase() : '';
    if (!CONSULTANCY_TYPES.includes(val)) {
      errors.consultancy_type = `Consultancy type must be either "${CONSULTANCY_TYPES[0]}" or "${CONSULTANCY_TYPES[1]}".`;
    } else {
      sanitized.consultancy_type = val;
    }
  }

  if (Object.hasOwn(body, 'industry_specialization')) {
    const rawSpecs = Array.isArray(body.industry_specialization)
      ? body.industry_specialization
      : typeof body.industry_specialization === 'string'
        ? body.industry_specialization.split(/[,;\n]+/)
        : [];
    const normalizedSpecs = [];
    const seen = new Set();
    const invalidSpecs = [];
    for (const rawItem of rawSpecs) {
      const cleaned = normalizeText(rawItem).replace(/[.!?]+$/g, '').trim();
      if (!cleaned) continue;
      const matched = matchAllowedOption(cleaned, CONSULTANCY_SPECIALIZATIONS, {
        tech: 'Technology',
        it: 'Technology',
        software: 'Technology',
        health: 'Healthcare',
        'human resources': 'HR',
        data: 'Data Science'
      });
      if (!matched) {
        invalidSpecs.push(cleaned);
      } else if (!seen.has(matched)) {
        seen.add(matched);
        normalizedSpecs.push(matched);
      }
    }
    if (invalidSpecs.length > 0) {
      errors.industry_specialization = `Unsupported specialization(s): ${invalidSpecs.join(', ')}. Allowed options: ${CONSULTANCY_SPECIALIZATIONS.join(', ')}.`;
    } else if (normalizedSpecs.length === 0) {
      errors.industry_specialization = `Select at least one industry specialization (${CONSULTANCY_SPECIALIZATIONS.join(', ')}).`;
    } else {
      sanitized.industry_specialization = normalizedSpecs;
    }
  }

  if (Object.hasOwn(body, 'company_size')) {
    const normSize = body.company_size ? normalizeCompanySize(body.company_size) : '';
    if (!normSize) {
      errors.company_size = `Please select a valid company size (${COMPANY_SIZES.join(', ')}).`;
    } else {
      sanitized.company_size = normSize;
    }
  }

  if (Object.hasOwn(body, 'headquarters_location')) {
    const val = typeof body.headquarters_location === 'string' ? body.headquarters_location.trim() : '';
    if (!val || val.length > 255) {
      errors.headquarters_location = 'Headquarters location must be between 1 and 255 characters.';
    } else {
      sanitized.headquarters_location = val;
    }
  }

  if (Object.hasOwn(body, 'website')) {
    const val = body.website === null ? '' : String(body.website || '').trim();
    const res = validateWebsiteUrl(val, { required: false, fieldLabel: 'Website' });
    if (!res.isValid) {
      errors.website = res.error;
    } else {
      sanitized.website = res.sanitized || '';
    }
  }

  if (Object.hasOwn(body, 'about_company')) {
    const val = typeof body.about_company === 'string' ? body.about_company.trim() : '';
    if (!val) {
      errors.about_company = 'About company description cannot be empty.';
    } else if (val.length > 4000) {
      errors.about_company = 'About company description cannot exceed 4000 characters.';
    } else {
      sanitized.about_company = val;
    }
  }

  if (Object.hasOwn(body, 'founding_year')) {
    const yr = Number(body.founding_year);
    if (!Number.isFinite(yr) || !Number.isInteger(yr) || yr < LIMITS.foundingYear.min || yr > LIMITS.foundingYear.max) {
      errors.founding_year = `Founding year must be a whole year between ${LIMITS.foundingYear.min} and ${LIMITS.foundingYear.max}.`;
    } else {
      sanitized.founding_year = yr;
    }
  }

  if (Object.hasOwn(body, 'social_media_links')) {
    const socialRes = normalizeSocialLinksPatch(body.social_media_links);
    if (!socialRes.isValid) {
      Object.assign(errors, socialRes.errors);
    } else {
      const mergedLinks = {
        ...(existingProfile?.social_media_links && typeof existingProfile.social_media_links === 'object'
          ? existingProfile.social_media_links
          : {}),
        ...socialRes.sanitized
      };
      sanitized.social_media_links = mergedLinks;
    }
  }

  if (Object.hasOwn(body, 'commission_structure')) {
    if (!body.commission_structure || typeof body.commission_structure !== 'object' || Array.isArray(body.commission_structure)) {
      errors.commission_structure = 'Commission structure must be a structured key-value object.';
    } else {
      sanitized.commission_structure = body.commission_structure;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    firstError: Object.values(errors)[0] || null,
    sanitizedBody: sanitized
  };
}

export function validateOrgUserProfileUpdatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    return {
      isValid: false,
      errors: { body: 'Provide at least one personal profile field to update (full name, designation, or phone).' },
      firstError: 'Provide at least one personal profile field to update (full name, designation, or phone).',
      sanitizedBody: {}
    };
  }

  const errors = {};
  const sanitized = {};

  for (const key of Object.keys(body)) {
    if (!ORG_USER_EDITABLE_FIELDS.has(key)) {
      errors[key] = `Field "${key}" is not editable on personal team-member profiles (/me). Allowed fields: full_name, designation, phone.`;
    }
  }

  if (Object.hasOwn(body, 'full_name')) {
    const val = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    if (!val || val.length > 200) {
      errors.full_name = 'Full name must be between 1 and 200 characters.';
    } else {
      sanitized.full_name = val;
    }
  }

  if (Object.hasOwn(body, 'designation')) {
    const val = body.designation === null ? '' : String(body.designation || '').trim();
    if (val.length > 100) {
      errors.designation = 'Designation cannot exceed 100 characters.';
    } else {
      sanitized.designation = val;
    }
  }

  if (Object.hasOwn(body, 'phone')) {
    const phoneRes = validatePhoneNumber(body.phone, { required: false, fieldLabel: 'Phone number' });
    if (!phoneRes.isValid) {
      errors.phone = phoneRes.error;
    } else {
      sanitized.phone = phoneRes.digits || null;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    firstError: Object.values(errors)[0] || null,
    sanitizedBody: sanitized
  };
}

// ============================================================================
// Unified Review Formatting (Current vs Proposed)
// ============================================================================

function formatFieldDisplay(key, value) {
  if (value === null || value === undefined || value === '') return '(none)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    if (key === 'preferred_work_types') return value.map(v => WORK_TYPE_LABELS[v] || v).join(', ');
    if (key === 'preferred_job_types') return value.map(v => JOB_TYPE_LABELS[v] || v).join(', ');
    if (key === 'certifications') {
      return value.map(c => `${c.name}${c.issuing_organization ? ` (${c.issuing_organization})` : ''}`).join(' | ');
    }
    if (typeof value[0] === 'string') return value.join(', ');
    return `${value.length} item(s)`;
  }
  if (typeof value === 'object') {
    const pairs = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '');
    return pairs.length ? pairs.map(([k, v]) => `${k}: ${v}`).join(', ') : '(none)';
  }
  return String(value);
}

export function formatRoleProfileReview({
  role,
  profileType,
  sanitizedBody,
  currentProfile = {},
  nextSectionLabel = null,
  notes = []
}) {
  const titleMap = {
    [HIREPOOL_PROFILE_TYPES.CANDIDATE]: 'Review Candidate Profile Update',
    [HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY]: 'Review Company Profile Update',
    [HIREPOOL_PROFILE_TYPES.CLIENT_ME]: 'Review Your Account Profile Update',
    [HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG]: 'Review Consultancy Profile Update',
    [HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME]: 'Review Your Account Profile Update'
  };
  const headerMap = {
    [HIREPOOL_PROFILE_TYPES.CANDIDATE]: 'Review your proposed HirePool candidate profile update:',
    [HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY]: 'Review your proposed HirePool company profile update:',
    [HIREPOOL_PROFILE_TYPES.CLIENT_ME]: 'Review your proposed HirePool personal account profile update:',
    [HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG]: 'Review your proposed HirePool consultancy profile update:',
    [HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME]: 'Review your proposed HirePool personal account profile update:'
  };

  const fields = [];
  const lines = [headerMap[profileType] || `Review your proposed HirePool ${role || ''} profile update:`];

  for (const [key, nextVal] of Object.entries(sanitizedBody || {})) {
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const currVal = currentProfile?.[key];

    if (key === 'education' && Array.isArray(nextVal)) {
      const existingCount = Array.isArray(currVal) ? currVal.length : 0;
      const summaryEntries = nextVal.map((edu, idx) => {
        const span = [edu.start_date, edu.end_date].filter(Boolean).join(' to ');
        const parts = [edu.degree, edu.field_of_study, edu.institution].filter(Boolean).join(' — ');
        return `${idx + 1}. ${parts}${span ? ` (${span})` : ''}${edu.grade ? ` [${edu.grade}]` : ''}`;
      });
      fields.push({
        label: `Education (${nextVal.length} total, ${existingCount} existing)`,
        value: summaryEntries.join(' | ') || '(none)'
      });
      lines.push(`- **Education (${nextVal.length} total):**`, ...summaryEntries.map(s => `  - ${s}`));
      continue;
    }

    if (key === 'work_experience' && Array.isArray(nextVal)) {
      const existingCount = Array.isArray(currVal) ? currVal.length : 0;
      const summaryEntries = nextVal.map((exp, idx) => {
        const span = [exp.start_date, exp.is_current ? 'Present' : exp.end_date].filter(Boolean).join(' to ');
        return `${idx + 1}. ${exp.title} at ${exp.company}${exp.location ? `, ${exp.location}` : ''}${span ? ` (${span})` : ''}`;
      });
      fields.push({
        label: `Work Experience (${nextVal.length} total, ${existingCount} existing)`,
        value: summaryEntries.join(' | ') || '(none)'
      });
      lines.push(`- **Work Experience (${nextVal.length} total):**`, ...summaryEntries.map(s => `  - ${s}`));
      continue;
    }

    if (key === 'certifications' && Array.isArray(nextVal)) {
      const existingCount = Array.isArray(currVal) ? currVal.length : 0;
      const summaryEntries = nextVal.map((cert, idx) => {
        const span = [cert.issue_date, cert.expiry_date].filter(Boolean).join(' to ');
        return `${idx + 1}. ${cert.name}${cert.issuing_organization ? ` by ${cert.issuing_organization}` : ''}${span ? ` (${span})` : ''}`;
      });
      fields.push({
        label: `Certifications (${nextVal.length} total, ${existingCount} existing)`,
        value: summaryEntries.join(' | ') || '(none)'
      });
      lines.push(`- **Certifications (${nextVal.length} total):**`, ...summaryEntries.map(s => `  - ${s}`));
      continue;
    }

    const currStr = formatFieldDisplay(key, currVal);
    const nextStr = formatFieldDisplay(key, nextVal);
    fields.push({ label, current: currStr, value: nextStr });
    lines.push(`- **${label}:** ${currStr} -> **${nextStr}**`);
  }

  if (Array.isArray(notes) && notes.length > 0) {
    lines.push('', ...notes.map(n => `*Note: ${n}*`));
  }
  if (nextSectionLabel) {
    lines.push('', `After confirming this update, I will help you complete **${nextSectionLabel}** next.`);
  }
  lines.push(
    '',
    'Choose **“Confirm & Execute”** below to save these changes to HirePool. Reply with edits if you want to adjust anything first, or reply **"Cancel"** to keep your profile unchanged.'
  );

  return {
    reviewMessage: lines.join('\n'),
    formattedReview: {
      type: `${profileType}_update`,
      title: titleMap[profileType] || 'Review Profile Update',
      fields
    }
  };
}

// ============================================================================
// Structured Session State Helpers
// ============================================================================

export function buildInitialProfileEditState({
  userId = null,
  role = 'candidate',
  profileType = HIREPOOL_PROFILE_TYPES.CANDIDATE,
  operation = 'add',
  selectedSection = null,
  pendingSections = [],
  existingValues = {}
} = {}) {
  return {
    userId,
    role,
    profileType,
    active: true,
    stage: 'awaiting_section_choice',
    selectedSection,
    pendingSections: Array.isArray(pendingSections) ? [...pendingSections] : [],
    completedSections: [],
    operation,
    targetIndex: null,
    draftData: {},
    existingValues,
    validationState: { valid: true, errors: {} },
    pendingConfirmation: false,
    confirmationToken: null,
    confirmationPayload: null,
    updatedAt: new Date().toISOString()
  };
}

export function ensureRoleScopedProfileEditState(session, authUser) {
  if (!session?.hirePoolProfileEdit) return null;
  const st = session.hirePoolProfileEdit;
  if (
    (st.userId && authUser?.id && st.userId !== authUser.id) ||
    (st.role && authUser?.role && st.role !== authUser.role)
  ) {
    session.hirePoolProfileEdit = null;
    return null;
  }
  return st;
}

// ============================================================================
// Field-Level GET-after-PUT Readback Verification Across All Roles
// ============================================================================

function normReadback(v) {
  return String(v ?? '').trim().toLowerCase();
}

function normalizedSetEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  const setA = new Set(a.map(normReadback).filter(Boolean));
  const setB = new Set(b.map(normReadback).filter(Boolean));
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}

export function verifyCandidateProfileReadback(requestedBody, verifiedProfile) {
  if (!requestedBody || typeof requestedBody !== 'object') return true;
  if (!verifiedProfile || typeof verifiedProfile !== 'object') return false;

  const stringFields = [
    'first_name',
    'last_name',
    'job_title',
    'phone',
    'current_location',
    'professional_summary',
    'salary_currency',
    'linkedin_url',
    'github_url',
    'portfolio_url',
    'personal_website'
  ];
  for (const key of stringFields) {
    if (typeof requestedBody[key] === 'string') {
      if (normReadback(verifiedProfile[key]) !== normReadback(requestedBody[key])) {
        return false;
      }
    }
  }

  for (const numKey of ['years_of_experience', 'months_of_experience', 'notice_period_days', 'expected_salary_min', 'expected_salary_max']) {
    if (Number.isFinite(requestedBody[numKey])) {
      if (Number(verifiedProfile[numKey]) !== Number(requestedBody[numKey])) {
        return false;
      }
    }
  }

  if (typeof requestedBody.is_open_to_work === 'boolean') {
    if (verifiedProfile.is_open_to_work !== requestedBody.is_open_to_work) {
      return false;
    }
  }

  if (Array.isArray(requestedBody.skills)) {
    if (!normalizedSetEqual(requestedBody.skills, verifiedProfile.skills)) {
      return false;
    }
  }
  if (Array.isArray(requestedBody.preferred_work_types)) {
    if (!normalizedSetEqual(requestedBody.preferred_work_types, verifiedProfile.preferred_work_types)) {
      return false;
    }
  }
  if (Array.isArray(requestedBody.preferred_job_types)) {
    if (!normalizedSetEqual(requestedBody.preferred_job_types, verifiedProfile.preferred_job_types)) {
      return false;
    }
  }

  if (Array.isArray(requestedBody.education)) {
    if (!Array.isArray(verifiedProfile.education) || verifiedProfile.education.length !== requestedBody.education.length) {
      return false;
    }
    for (const expected of requestedBody.education) {
      const matched = verifiedProfile.education.some(actual =>
        normReadback(actual?.institution) === normReadback(expected?.institution) &&
        normReadback(actual?.degree) === normReadback(expected?.degree) &&
        (!expected?.start_date || normReadback(actual?.start_date) === normReadback(expected.start_date))
      );
      if (!matched) return false;
    }
  }

  if (Array.isArray(requestedBody.work_experience)) {
    if (!Array.isArray(verifiedProfile.work_experience) || verifiedProfile.work_experience.length !== requestedBody.work_experience.length) {
      return false;
    }
    for (const expected of requestedBody.work_experience) {
      const matched = verifiedProfile.work_experience.some(actual =>
        normReadback(actual?.company) === normReadback(expected?.company) &&
        normReadback(actual?.title) === normReadback(expected?.title) &&
        (!expected?.start_date || normReadback(actual?.start_date) === normReadback(expected.start_date))
      );
      if (!matched) return false;
    }
  }

  if (Array.isArray(requestedBody.certifications)) {
    if (!Array.isArray(verifiedProfile.certifications) || verifiedProfile.certifications.length !== requestedBody.certifications.length) {
      return false;
    }
    for (const expected of requestedBody.certifications) {
      const matched = verifiedProfile.certifications.some(actual =>
        normReadback(actual?.name) === normReadback(expected?.name) &&
        (!expected?.issuing_organization || normReadback(actual?.issuing_organization) === normReadback(expected.issuing_organization))
      );
      if (!matched) return false;
    }
  }

  return true;
}

export function verifyClientCompanyProfileReadback(requestedBody, verifiedProfile) {
  if (!requestedBody || typeof requestedBody !== 'object') return true;
  if (!verifiedProfile || typeof verifiedProfile !== 'object') return false;

  for (const key of ['company_name', 'industry', 'company_size', 'headquarters_location', 'company_website', 'about_company', 'registration_number', 'gst_tax_id']) {
    if (typeof requestedBody[key] === 'string') {
      if (normReadback(verifiedProfile[key]) !== normReadback(requestedBody[key])) {
        return false;
      }
    }
  }
  if (Number.isFinite(requestedBody.founding_year)) {
    if (Number(verifiedProfile.founding_year) !== Number(requestedBody.founding_year)) {
      return false;
    }
  }
  if (requestedBody.social_media_links && typeof requestedBody.social_media_links === 'object') {
    const actualSocial = verifiedProfile.social_media_links || {};
    for (const [k, v] of Object.entries(requestedBody.social_media_links)) {
      if (v && normReadback(actualSocial[k]) !== normReadback(v)) {
        return false;
      }
    }
  }
  return true;
}

export function verifyConsultancyProfileReadback(requestedBody, verifiedProfile) {
  if (!requestedBody || typeof requestedBody !== 'object') return true;
  if (!verifiedProfile || typeof verifiedProfile !== 'object') return false;

  for (const key of ['consultancy_name', 'consultancy_type', 'company_size', 'headquarters_location', 'website', 'about_company']) {
    if (typeof requestedBody[key] === 'string') {
      if (normReadback(verifiedProfile[key]) !== normReadback(requestedBody[key])) {
        return false;
      }
    }
  }
  if (Number.isFinite(requestedBody.founding_year)) {
    if (Number(verifiedProfile.founding_year) !== Number(requestedBody.founding_year)) {
      return false;
    }
  }
  if (Array.isArray(requestedBody.industry_specialization)) {
    if (!normalizedSetEqual(requestedBody.industry_specialization, verifiedProfile.industry_specialization)) {
      return false;
    }
  }
  if (requestedBody.social_media_links && typeof requestedBody.social_media_links === 'object') {
    const actualSocial = verifiedProfile.social_media_links || {};
    for (const [k, v] of Object.entries(requestedBody.social_media_links)) {
      if (v && normReadback(actualSocial[k]) !== normReadback(v)) {
        return false;
      }
    }
  }
  return true;
}

export function verifyOrgUserProfileReadback(requestedBody, verifiedProfile) {
  if (!requestedBody || typeof requestedBody !== 'object') return true;
  if (!verifiedProfile || typeof verifiedProfile !== 'object') return false;

  for (const key of ['full_name', 'designation', 'phone']) {
    if (typeof requestedBody[key] === 'string') {
      if (normReadback(verifiedProfile[key]) !== normReadback(requestedBody[key])) {
        return false;
      }
    }
  }
  return true;
}

export function verifyProfileReadbackByOperationId(operationId, requestedBody, verifiedProfile) {
  switch (operationId) {
    case 'update_my_profile_api_v1_candidates_profile_put':
      return verifyCandidateProfileReadback(requestedBody, verifiedProfile);
    case 'update_company_profile_api_v1_clients_profile_put':
      return verifyClientCompanyProfileReadback(requestedBody, verifiedProfile);
    case 'update_consultancy_profile_api_v1_consultancies_profile_put':
      return verifyConsultancyProfileReadback(requestedBody, verifiedProfile);
    case 'update_my_user_profile_api_v1_clients_me_put':
    case 'update_my_user_profile_api_v1_consultancies_me_put':
      return verifyOrgUserProfileReadback(requestedBody, verifiedProfile);
    default:
      return true;
  }
}

export {
  LIMITS,
  rangeError,
  CLIENT_INDUSTRIES,
  CONSULTANCY_SPECIALIZATIONS,
  COMPANY_SIZES,
  CONSULTANCY_TYPES,
  WORK_TYPES,
  JOB_TYPES,
  validatePhoneNumber,
  validateWebsiteUrl,
  validateGstin
};
