/**
 * HirePool Organization & Team-Member Profile Editing Workflow
 * Supports Client (Employer/Company: /clients/profile + /clients/me) and
 * Consultancy (Agency: /consultancies/profile + /consultancies/me) roles.
 */

import {
  HIREPOOL_PROFILE_SECTIONS,
  HIREPOOL_PROFILE_TYPES,
  CLIENT_INDUSTRIES,
  CONSULTANCY_SPECIALIZATIONS,
  COMPANY_SIZES,
  CONSULTANCY_TYPES,
  normalizeText,
  matchAllowedOption,
  validateClientProfileUpdatePayload,
  validateConsultancyProfileUpdatePayload,
  validateOrgUserProfileUpdatePayload,
  formatRoleProfileReview,
  buildInitialProfileEditState,
  ensureRoleScopedProfileEditState
} from './profile-edit-shared.js';

const CANCEL_PATTERN = /^\s*(?:cancel|stop|exit|never\s*mind|quit|close|don'?t\s+save|discard)\b(?:\s+(?:profile\s+edit|editing|changes?))?[.!?]*$/i;
const PIVOT_PATTERN = /\b(?:post\s+(?:a\s+)?job|create\s+(?:a\s+)?job|my\s+jobs?|company\s+jobs?|applicants?|applications?|bench\s+candidates?|add\s+(?:a\s+)?candidate|dashboard\s+stats?|placement\s+stats?|matching\s+candidates?|find\s+jobs?)\b/i;

const CANDIDATE_ONLY_FIELD_PATTERN =
  /\b(?:education(?:al)?(?:\s+details|\s+history)?|degree|work\s*experience|job\s+history|career\s+history|professional\s+summary|career\s+summary|skills?|certifications?|expected\s+salary|notice\s+period|years\s+of\s+experience|months\s+of\s+experience|open\s+to\s+work|preferred\s+work\s+types?|preferred\s+job\s+types?|github|portfolio)\b/i;

const ORG_PROFILE_FIELD_LABELS = Object.freeze({
  company_name: 'Company Name',
  consultancy_name: 'Consultancy Name',
  consultancy_type: 'Consultancy Type',
  industry: 'Industry',
  industry_specialization: 'Industry Specialization',
  company_size: 'Company Size',
  headquarters_location: 'Headquarters Location',
  company_website: 'Company Website',
  website: 'Website',
  about_company: 'About Company',
  founding_year: 'Founding Year',
  registration_number: 'Registration Number',
  gst_tax_id: 'GSTIN / Tax ID',
  social_media_links: 'Social Media Links',
  commission_structure: 'Commission Structure',
  full_name: 'Full Name',
  designation: 'Designation',
  phone: 'Phone Number'
});

function detectTargetProfileScope(text, role, state) {
  const explicitlyOrg = /\b(?:company|client|employer|organization|org|consultancy|agency|business)\s+(?:profile|details|info|name|size|industry|website|location|hq|headquarters|gst|gstin|registration|description|about|founding|social|specialization|type|commission)\b|\b(?:consultancy_type|industry_specialization|company_size|headquarters_location|company_website|about_company|founding_year|gst_tax_id|registration_number|social_media_links|gstin|commission\s+structure)\b/i.test(text);
  const explicitlyMe = (
    /\b(?:my\s+(?:personal|own|user)\s+profile|personal\s+profile|my\s+account\s+details|my\s+designation|designation\b|my\s+full\s+name|full\s+name\b|my\s+name\b(?!.*company|.*agency|.*consultancy)|(?:my\s+)?(?:personal\s+)?phone(?:\s+number)?|\/me\b)\b/i.test(text) ||
    state?.draftData?.pendingField === 'phone' ||
    state?.draftData?.pendingField === 'designation' ||
    state?.draftData?.pendingField === 'full_name' ||
    (/^\s*(?:\+?91[\s-]?)?[6-9]\d{9}\s*$/.test(text) && state?.draftData?.pendingField === 'phone')
  ) && !explicitlyOrg;

  if (explicitlyMe) {
    return role === 'client' ? HIREPOOL_PROFILE_TYPES.CLIENT_ME : HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME;
  }
  if (explicitlyOrg) {
    return role === 'client' ? HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY : HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG;
  }
  if (state?.profileType === HIREPOOL_PROFILE_TYPES.CLIENT_ME || state?.profileType === HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME) {
    return state.profileType;
  }
  return role === 'client' ? HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY : HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG;
}

function detectOrgProfileUnsupportedRequest(raw, role, targetProfileType) {
  const text = normalizeText(raw);

  if (CANDIDATE_ONLY_FIELD_PATTERN.test(text)) {
    const label = role === 'client' ? 'Client / Employer' : 'Consultancy / Agency';
    const exampleFields = role === 'client'
      ? 'Company Name, Industry, Company Size, Headquarters Location, Website, About Company, Founding Year, Registration Number, GSTIN, Social Links, or your Personal Account Profile (Full Name, Designation, Phone)'
      : 'Consultancy Name, Consultancy Type, Industry Specialization, Company Size, Headquarters Location, Website, About Company, Founding Year, Social Links, or your Personal Account Profile (Full Name, Designation, Phone)';
    return `Education, work experience, skills, certifications, and candidate professional summary edits apply only to **Candidate** profiles. For your **${label}** account, you can update ${exampleFields}.`;
  }

  if (role === 'client' && /\b(?:consultancy_name|consultancy_type|industry_specialization|commission_structure|consultancy\s+(?:profile|type)|agency\s+(?:profile|type))\b/i.test(text)) {
    return 'Consultancy-specific fields (`consultancy_type`, `industry_specialization`, `commission_structure`) apply only to **Consultancy** profiles, not **Client / Employer** profiles.';
  }

  if (role === 'consultancy' && /\b(?:gst_tax_id|gstin|gst\s+(?:number|id|tax)|registration_number|registration\s+number|company\s+profile)\b/i.test(text)) {
    return 'Employer fields such as `gst_tax_id` (GSTIN) and `registration_number` apply only to **Client / Employer** company profiles, not **Consultancy** profiles.';
  }

  if (/\b(?:logo|profile\s+picture|avatar|photo)\b/i.test(text)) {
    return 'Company/agency logos and user photos require a multipart image upload (`POST .../logo` or `POST .../me/photo`) and cannot be updated via text chat. Please upload your image directly in the HirePool dashboard.';
  }

  if (/\b(?:work\s+email|login\s+email|account\s+email)\b/i.test(text) || (/\bemail\b/i.test(text) && /\b(?:update|change|edit|modify|set)\b/i.test(text))) {
    return 'Your login/work email cannot be changed through profile edit chat. Email changes must be performed through HirePool account authentication settings.';
  }

  if (role === 'consultancy' && /\b(?:verification_status|candidate_pool_size|pool\s+size)\b/i.test(text)) {
    return '`verification_status` and `candidate_pool_size` are read-only platform-managed fields and cannot be edited through consultancy profile updates.';
  }

  const orgScopeSelected =
    targetProfileType === HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY ||
    targetProfileType === HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG;

  if (orgScopeSelected && /\b(?:company|employer|client|consultancy|agency|org(?:anization)?)\s+(?:email|phone(?:\s+number)?)\b/i.test(text)) {
    return role === 'client'
      ? 'HirePool\'s **Company Profile** (`PUT /api/v1/clients/profile`) does not expose organization-level `email` or `phone` fields. If you want to update your own contact phone number on your team-member profile (`PUT /api/v1/clients/me`), say **"Update my personal phone to <10 digits>"**.'
      : 'HirePool\'s **Consultancy Profile** (`PUT /api/v1/consultancies/profile`) does not expose organization-level `email` or `phone` fields. If you want to update your own contact phone number on your team-member profile (`PUT /api/v1/consultancies/me`), say **"Update my personal phone to <10 digits>"**.';
  }

  if (/\b(?:billing\s+address|bank\s+details|pan\s+number)\b/i.test(text)) {
    return 'Billing address, bank details, and PAN are not editable fields on HirePool profile update endpoints.';
  }

  return null;
}

function checkOrgRolePermission(authUser, targetProfileType, fetchedOrgRole = null) {
  const rawRole = fetchedOrgRole || authUser?.organizationRole || authUser?.orgRole || null;
  const orgRole = typeof rawRole === 'string'
    ? rawRole.trim().toLowerCase()
    : null;
  if (!orgRole) return { allowed: true };

  if (targetProfileType === HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY) {
    if (!['admin', 'hiring_manager'].includes(orgRole)) {
      return {
        allowed: false,
        message: `In HirePool, only Company **Admins** or **Hiring Managers** can update the company profile (\`PUT /api/v1/clients/profile\`). Your current organization role is **${rawRole}**. You can still update your personal profile details (full name, designation, and phone number).`
      };
    }
  }

  if (targetProfileType === HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG) {
    if (orgRole !== 'admin') {
      return {
        allowed: false,
        message: `In HirePool, only Consultancy **Admins** can update the consultancy/agency profile (\`PUT /api/v1/consultancies/profile\`). Your current organization role is **${rawRole}**. You can still update your personal profile details (full name, designation, and phone number).`
      };
    }
  }

  return { allowed: true };
}

function extractLabeledFieldValues(raw, patterns) {
  const extracted = {};
  const text = String(raw || '').trim();
  const normalized = normalizeText(text);

  // Support multi-clause separation by semicolon or newline
  const clauses = normalized
    .split(/[;\n]+/)
    .map(c => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    for (const { field, regex, valueGroup = 1, transform } of patterns) {
      const m = clause.match(regex);
      if (m && m[valueGroup] !== undefined) {
        const val = String(m[valueGroup]).trim().replace(/^[:"']+|["']+$|[.!]+$/g, '').trim();
        if (val) {
          extracted[field] = transform ? transform(val, clause) : val;
        }
      }
    }
  }
  return extracted;
}

function extractSocialLinksFromMessage(raw) {
  const links = {};
  const patterns = [
    ['linkedin', /\b(?:company\s+|agency\s+)?linkedin(?:\s+url|\s+link)?\s*(?:to|is|=|:|\s+at)?\s*(https?:\/\/[^\s,;]+|[^\s,;]*linkedin\.com[^\s,;]*)/i],
    ['twitter', /\b(?:company\s+|agency\s+)?(?:twitter|x)(?:\s+url|\s+link)?\s*(?:to|is|=|:|\s+at)?\s*(https?:\/\/[^\s,;]+|[^\s,;]*(?:twitter\.com|x\.com)[^\s,;]*)/i],
    ['facebook', /\b(?:company\s+|agency\s+)?facebook(?:\s+url|\s+link)?\s*(?:to|is|=|:|\s+at)?\s*(https?:\/\/[^\s,;]+|[^\s,;]*facebook\.com[^\s,;]*)/i],
    ['instagram', /\b(?:company\s+|agency\s+)?instagram(?:\s+url|\s+link)?\s*(?:to|is|=|:|\s+at)?\s*(https?:\/\/[^\s,;]+|[^\s,;]*instagram\.com[^\s,;]*)/i]
  ];
  for (const [key, regex] of patterns) {
    const m = raw.match(regex);
    if (m?.[1]) {
      links[key] = m[1].trim().replace(/[.,;!?]+$/g, '');
    }
  }
  return Object.keys(links).length ? links : null;
}

function extractClientFields(raw, pendingField = null) {
  const text = normalizeText(raw);
  const body = {};

  if (/^(?:clear|remove|delete)\s+(?:my\s+|the\s+|our\s+)?gst(?:in|\s*tax\s*id)?\s*[.!?]*$/i.test(text)) {
    body.gst_tax_id = '';
  }

  const patterns = [
    {
      field: 'company_name',
      regex: /\bcompany\s+name\s*(?:to|as|is|:|=)\s*([^,;]+?)(?=\s*(?:,|;|$|\band\s+(?:(?:update|set|change|edit)\s+)?(?:industry|company|headquarters|location|website|about|founding|gst|gstin|registration|linkedin|twitter|facebook|instagram)))/i
    },
    {
      field: 'industry',
      regex: /\bindustry\s*(?:to|as|is|:|=)\s*([^,;]+?)(?=\s*(?:,|;|$|\band\s+(?:(?:update|set|change|edit)\s+)?(?:company|headquarters|location|website|about|founding|gst|gstin|registration|linkedin|twitter|facebook|instagram)))/i
    },
    {
      field: 'company_size',
      regex: /\b(?:company\s+size|team\s+size|size)\s*(?:to|as|is|:|=)\s*([^,;]+?)(?=\s*(?:,|;|$|\band\s+(?:(?:update|set|change|edit)\s+)?(?:industry|headquarters|location|website|about|founding|gst|gstin|registration|linkedin|twitter|facebook|instagram)))/i
    },
    {
      field: 'headquarters_location',
      regex: /\b(?:headquarters(?:\s+location)?|hq(?:\s+location)?|location)\s*(?:to|as|is|in|:|=)\s*([^;]+?)(?=\s*(?:;|$|\band\s+(?:(?:update|set|change|edit)\s+)?(?:industry|company|website|about|founding|gst|gstin|registration|linkedin|twitter|facebook|instagram)))/i
    },
    {
      field: 'company_website',
      regex: /\b(?:company\s+)?website(?:\s+url)?\s*(?:to|as|is|:|=)\s*([^\s,;]+)/i
    },
    {
      field: 'about_company',
      regex: /\b(?:about\s+company|company\s+description|description|about\s+us)\s*(?:to|as|is|:|=)\s*(.+?)(?=\s*(?:;\s*|\b(?:company|industry|headquarters|website|founding|gst|gstin|registration)\s|$))/i
    },
    {
      field: 'founding_year',
      regex: /(?:(?:founding\s+year|founded\s+(?:year|in)))\s*(?:to|as|is|:|=)?\s*(\d{3,4})/i
    },
    {
      field: 'registration_number',
      regex: /(?:registration\s+number|reg(?:\.|istration)?\s*(?:no|number|#)|cin)\s*(?:to|as|is|:|=)\s*([A-Za-z0-9._/-]+)/i
    },
    {
      field: 'gst_tax_id',
      regex: /(?:gst_tax_id|gstin|gst\s*(?:number|id|tax\s*id)?)\s*(?:to|as|is|:|=)\s*([A-Za-z0-9]+)/i
    }
  ];

  // Try comma-free full-sentence extraction across text too
  for (const { field, regex } of patterns) {
    const m = text.match(regex);
    if (m?.[1] && body[field] === undefined) {
      let cleaned = m[1].trim().replace(/^[:"']+|["']+$|[.,;!?]+$/g, '').trim();
      if (field === 'company_website' && raw.match(/https?:\/\/[^\s,;]+/i)) {
        // Re-extract exact URL without corrupting trailing path chars except sentence end
        const urlMatch = raw.match(/(?:company\s+)?website(?:\s+url)?\s*(?:to|as|is|:|=)\s*([^\s,;]+)/i);
        if (urlMatch?.[1]) cleaned = urlMatch[1].replace(/[.,;!?]+$/g, '');
      }
      if (cleaned) body[field] = cleaned;
    }
  }

  Object.assign(body, extractLabeledFieldValues(raw, patterns));

  const social = extractSocialLinksFromMessage(raw);
  if (social) body.social_media_links = social;

  // Bare field reply when prompted for a specific single field
  if (Object.keys(body).length === 0 && pendingField && !isOrgBareCommand(text)) {
    let val = raw.trim();
    if (pendingField === 'company_website') {
      val = val.replace(/[.!?]+$/, '').trim();
    } else if (pendingField === 'founding_year') {
      const ym = val.match(/\d{3,4}/);
      val = ym ? ym[0] : val;
    } else if (pendingField === 'gst_tax_id') {
      val = /^(?:clear|none|remove)$/i.test(val) ? '' : val.replace(/[.!?]+$/, '').trim().toUpperCase();
    }
    body[pendingField] = val;
  }

  return body;
}

function parseSpecializationCommand(raw, existingSpecs = [], currentOp = 'add') {
  const text = normalizeText(raw);
  const specClauseMatch = text.match(
    /(?:^(?:please\s+)?(?:(add|replace(?:\s+all)?|overwrite|set|remove|delete|update|edit|change)\s+)?(?:(?:my|our|the)\s+)?(?:industry\s+)?specializations?\s*(?:with|to|as|from|:)?\s*(.+)?$)/i
  );

  let op = currentOp || 'add';
  let valueChunk = raw;
  if (specClauseMatch) {
    const verb = (specClauseMatch[1] || '').toLowerCase();
    if (verb.startsWith('replace') || verb === 'set' || verb === 'overwrite') op = 'replace';
    else if (verb === 'remove' || verb === 'delete') op = 'remove';
    else if (verb === 'add') op = 'add';
    else if (verb && existingSpecs.length > 0) op = 'ambiguous';
    valueChunk = (specClauseMatch[2] || '').replace(/\s+from\s+(?:my|our|the)\s+(?:industry\s+)?specializations?$/i, '').trim();
  } else {
    const inlineMatch = text.match(/(?:^|\b)(add|replace|remove|delete)\s+([A-Za-z0-9\s,&/+-]+?)\s+(?:to|into|from|in)\s+(?:our\s+|my\s+|the\s+)?(?:industry\s+)?specializations?\b/i);
    if (inlineMatch) {
      const verb = inlineMatch[1].toLowerCase();
      op = verb === 'remove' || verb === 'delete' ? 'remove' : verb;
      valueChunk = inlineMatch[2];
    }
  }

  valueChunk = String(valueChunk || '')
    .replace(/\s+(?:to|into|from|in)\s+(?:my\s+|our\s+|the\s+)?(?:industry\s+)?specializations?\s*[.!?]*$/i, '')
    .trim();

  const items = valueChunk
    .split(/[,;\n|]+|\s+and\s+/i)
    .map(s => s.trim().replace(/[.!?]+$/g, '').trim())
    .filter(Boolean)
    .filter(s => !/^(?:(?:add|replace|remove|delete|update|edit|change)\s+)?(?:industry\s+)?specializations?$/i.test(s));

  return { operation: op, items };
}

function extractConsultancyFields(raw, currentProfile = {}, pendingField = null) {
  const text = normalizeText(raw);
  const body = {};

  const patterns = [
    {
      field: 'consultancy_name',
      regex: /\b(?:consultancy|agency)\s+name\s*(?:to|as|is|:|=)\s*([^,;]+?)(?=\s*(?:,|;|$|\band\s+(?:consultancy|agency|industry|company|headquarters|location|website|about|founding|social|commission|linkedin|twitter|facebook|instagram)))/i
    },
    {
      field: 'consultancy_type',
      regex: /(?:consultancy|agency)\s+type\s*(?:to|as|is|:|=)\s*([A-Za-z_-]+)/i
    },
    {
      field: 'company_size',
      regex: /\b(?:company\s+size|agency\s+size|team\s+size|size)\s*(?:to|as|is|:|=)\s*([^,;]+?)(?=\s*(?:,|;|$|\band\s+(?:headquarters|location|website|about|founding|industry|social|commission|linkedin|twitter|facebook|instagram)))/i
    },
    {
      field: 'headquarters_location',
      regex: /\b(?:headquarters(?:\s+location)?|hq(?:\s+location)?|location)\s*(?:to|as|is|in|:|=)\s*([^;]+?)(?=\s*(?:;|$|\band\s+(?:consultancy|agency|website|about|founding|industry|social|commission|linkedin|twitter|facebook|instagram)))/i
    },
    {
      field: 'website',
      regex: /\b(?:(?:consultancy|agency)\s+)?website(?:\s+url)?\s*(?:to|as|is|:|=)\s*([^\s,;]+)/i
    },
    {
      field: 'about_company',
      regex: /\b(?:about\s+company|about\s+(?:our\s+|the\s+)?(?:consultancy|agency)|agency\s+description|description)\s*(?:to|as|is|:|=)\s*(.+?)(?=\s*(?:;\s*|\b(?:consultancy|agency|industry|company|headquarters|website|founding|commission)\s|$))/i
    },
    {
      field: 'founding_year',
      regex: /(?:(?:founding\s+year|founded\s+(?:year|in)))\s*(?:to|as|is|:|=)?\s*(\d{3,4})/i
    }
  ];

  for (const { field, regex } of patterns) {
    const m = text.match(regex);
    if (m?.[1] && body[field] === undefined) {
      let cleaned = m[1].trim().replace(/^[:"']+|["']+$|[.,;!?]+$/g, '').trim();
      if (field === 'website') {
        const urlMatch = raw.match(/(?:(?:consultancy|agency)\s+)?website(?:\s+url)?\s*(?:to|as|is|:|=)\s*([^\s,;]+)/i);
        if (urlMatch?.[1]) cleaned = urlMatch[1].replace(/[.,;!?]+$/g, '');
      }
      if (cleaned) body[field] = cleaned;
    }
  }

  Object.assign(body, extractLabeledFieldValues(raw, patterns));

  if (/\b(?:industry\s+)?specializations?\b/i.test(text) || pendingField === 'industry_specialization') {
    const { operation, items } = parseSpecializationCommand(
      raw,
      Array.isArray(currentProfile?.industry_specialization) ? currentProfile.industry_specialization : [],
      'add'
    );
    if (items.length > 0) {
      const existing = Array.isArray(currentProfile?.industry_specialization) ? currentProfile.industry_specialization : [];
      if (operation === 'remove') {
        const removeSet = new Set(items.map(s => s.toLowerCase()));
        body.industry_specialization = existing.filter(s => !removeSet.has(String(s).toLowerCase()));
      } else if (operation === 'add') {
        body.industry_specialization = [...existing, ...items];
      } else {
        body.industry_specialization = items;
      }
    }
  }

  if (/\bcommission\s+structure\b/i.test(text)) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        body.commission_structure = JSON.parse(jsonMatch[0]);
      } catch {
        body.commission_structure = 'invalid';
      }
    } else {
      const afterCommission = raw.replace(/^[\s\S]*?\bcommission\s+structure\s*(?:to|as|is|:|=)?\s*/i, '').trim();
      const kvMatches = [...afterCommission.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]\s*([^,;]+)/g)];
      if (kvMatches.length) {
        body.commission_structure = Object.fromEntries(kvMatches.map(m => [m[1].trim(), m[2].trim()]));
      } else if (afterCommission) {
        body.commission_structure = afterCommission;
      }
    }
  }

  const social = extractSocialLinksFromMessage(raw);
  if (social) body.social_media_links = social;

  if (Object.keys(body).length === 0 && pendingField && !isOrgBareCommand(text)) {
    let val = raw.trim();
    if (pendingField === 'website') val = val.replace(/[.!?]+$/, '').trim();
    else if (pendingField === 'founding_year') val = val.match(/\d{3,4}/)?.[0] || val;
    body[pendingField] = val;
  }

  return body;
}

function extractOrgUserFields(raw, pendingField = null) {
  const text = normalizeText(raw);
  const body = {};

  const nameMatch = text.match(/\b(?:my\s+)?(?:full\s+name|name)\s*(?:to|as|is|:|=)\s*([^,;]+)/i);
  if (nameMatch?.[1]) body.full_name = nameMatch[1].replace(/[.!?]+$/g, '').trim();

  const desigMatch = text.match(/\b(?:my\s+)?designation\s*(?:to|as|is|:|=)\s*([^,;]+)/i);
  if (desigMatch?.[1]) body.designation = desigMatch[1].replace(/[.!?]+$/g, '').trim();

  const phoneMatch = text.match(/\b(?:(?:add|update|set|change|enter)\s+)?(?:my\s+)?(?:personal\s+)?phone(?:\s+number)?\s*(?:to|as|is|:|=|\s)\s*([+0-9\s-]{10,20})/i) ||
    text.match(/\b(?:my\s+)?(?:personal\s+)?phone(?:\s+number)?\s*(?:to|as|is|:|=)\s*([^\s,;][^\n,;]*)/i);
  if (phoneMatch?.[1]) {
    body.phone = phoneMatch[1].replace(/[.!?]+$/g, '').trim();
  } else if (pendingField === 'phone' || (Object.keys(body).length === 0 && /(?:phone|mobile|call)/i.test(raw))) {
    const digitsMatch = raw.match(/(?:\+?91[\s-]?)?([6-9]\d{9})\b/) || raw.match(/\b\d{10}\b/);
    if (digitsMatch) {
      body.phone = digitsMatch[1] || digitsMatch[0];
    }
  }

  if (Object.keys(body).length === 0 && pendingField && !isOrgBareCommand(text)) {
    const trimmed = raw.trim().replace(/[.!?]+$/, '').trim();
    if (pendingField === 'phone') {
      const digitsMatch = trimmed.match(/(?:\+?91[\s-]?)?([6-9]\d{9})\b/) || trimmed.match(/\b\d{10}\b/);
      body.phone = digitsMatch ? (digitsMatch[1] || digitsMatch[0]) : trimmed;
    } else {
      body[pendingField] = trimmed;
    }
  }

  return body;
}

function isOrgBareCommand(text) {
  return /^(?:please\s+)?(?:update|edit|change|modify|set|view)\s+(?:my\s+|our\s+|the\s+)?(?:company|client|employer|consultancy|agency|personal|account)?\s*(?:profile|details|info|name|size|industry|website|location|headquarters|about|founding\s+year|gst|gstin|registration\s+number|social\s+links|type|specializations?|designation|phone(?:\s+number)?|full\s+name)\s*[.!?]*$/i.test(text);
}

export function isHirePoolOrgProfileEditRequest(message) {
  const text = normalizeText(message);
  if (!text) return false;

  // Never intercept job creation, management, or application commands
  if (/\b(?:post\s+(?:a\s+)?job|create\s+(?:a\s+)?job|add\s+(?:a\s+)?job|new\s+job|job\s+posting|openings?)\b/i.test(text)) return false;
  if (/^\s*(?:job\s+)?title\s*[:=\-–—]/i.test(text) || /\bjob\s+title\s*[:=\-–—]/i.test(text)) return false;
  if (/\b(?:view\s+(?:my\s+)?jobs?|show\s+(?:my\s+)?jobs?|my\s+jobs?|list\s+jobs?|posted\s+jobs?|company\s+jobs?)\b/i.test(text)) return false;
  if (/\b(?:applications?|applicants?|candidates?\s+applied)\b/i.test(text)) return false;
  if (/\b(?:dashboard|hiring\s+pipeline|pipeline\s+stats?|placement\s+stats?)\b/i.test(text)) return false;
  if (/\b(?:bench\s+candidates?|talent\s+pool|add\s+(?:a\s+|this\s+)?candidate|register\s+(?:a\s+)?candidate|submit\s+(?:a\s+|this\s+)?candidate|submissions?)\b/i.test(text)) return false;
  if (/^\s*(?:candidate\s+)?(?:name|first_name|full\s+name)\s*[:=\-–—]/i.test(text)) return false;

  // Read-only profile view requests should NOT trigger edit flow (handled by verified read intent)
  if (
    /^(?:please\s+)?(?:view|show|get|display|open|see|what(?:'s| is)\s+(?:on|in))\s+(?:my\s+)?(?:company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?profile(?:\s+details|\s+info|\s+completion)?[.!?]*$/i.test(text) ||
    /^\s*(?:my\s+)?(?:company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?profile\s*[.!?]*$/i.test(text)
  ) {
    return false;
  }

  // Profile edit requests
  if (/\b(?:edit|update|improve|complete|finish|modify|fill\s+out|fix|revise|change)\s+(?:my\s+|the\s+|our\s+)?(?:company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?(?:profile|details|information|info)\b/i.test(text)) return true;
  if (/\bi\s+(?:want|would\s+like|need)\s+to\s+(?:edit|update|improve|complete|finish|change|modify)\s+(?:my\s+|the\s+|our\s+)?(?:company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?(?:profile|details|information|info)\b/i.test(text)) return true;

  // Specific profile fields (personal or organization)
  if (/\b(?:add|edit|update|change|modify|set|provide|upload)\s+(?:my\s+|our\s+|the\s+|company\s+|client\s+|employer\s+|consultancy\s+|agency\s+)?(?:company[_\s]name|consultancy[_\s]name|consultancy[_\s]type|industry|industry[_\s]specialization|specializations?|company[_\s]size|headquarters|headquarters[_\s]location|company[_\s]website|consultancy[_\s]website|website|about[_\s]company|about\s+us|founding[_\s]year|registration[_\s]number|gst[_\s]tax[_\s]id|gstin|social[_\s]media[_\s]links?|social\s+links?|commission[_\s]structure|full[_\s]name|designation|phone(?:\s+number)?|mobile(?:\s+number)?|logo|profile\s+picture|avatar|photo|work\s+email|login\s+email|email|verification\s+status|candidate\s+pool(?:\s+size)?|pool\s+size)\b/i.test(text)) return true;

  if (/\b(?:add|append|include|replace|remove|delete|drop|set)\s+.{1,160}\s+(?:to|into|from|in)\s+(?:my\s+|our\s+|the\s+|company\s+|consultancy\s+|agency\s+)?(?:industry[_\s]specializations?|specializations?|social[_\s]media[_\s]links?|social\s+links?)\b/i.test(text)) return true;

  if (/\b(?:remove|delete|drop)\s+.+?\s+(?:from|in)\s+(?:my\s+|our\s+|the\s+|company\s+|consultancy\s+|agency\s+)?(?:industry[_\s]specializations?|specializations?)\b/i.test(text)) return true;

  // Labeled inputs (e.g. "phone: 9876543210", "designation: Senior Recruiter", "website: https://company.com")
  if (/^(?:company[_\s]name|consultancy[_\s]name|industry|company[_\s]size|headquarters|website|about[_\s]company|founding[_\s]year|registration[_\s]number|gstin|gst[_\s]tax[_\s]id|designation|phone(?:\s+number)?|full[_\s]name)\s*[:=]\s*.+/i.test(text)) return true;

  // Candidate-only fields (to trigger clean refusal message)
  if (CANDIDATE_ONLY_FIELD_PATTERN.test(text)) return true;

  return false;
}

function detectSingleRequestedOrgField(text, role, targetProfileType) {
  if (targetProfileType === HIREPOOL_PROFILE_TYPES.CLIENT_ME || targetProfileType === HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME) {
    if (/\b(?:full\s+name|my\s+name)\b/i.test(text)) return 'full_name';
    if (/\bdesignation\b/i.test(text)) return 'designation';
    if (/\bphone(?:\s+number)?\b/i.test(text)) return 'phone';
    return null;
  }
  // Personal profile fields take precedence even if initially scoped to organization
  if (/\bphone(?:\s+number)?\b/i.test(text)) return 'phone';
  if (/\bdesignation\b/i.test(text)) return 'designation';
  if (/\b(?:full\s+name|my\s+name)\b/i.test(text)) return 'full_name';

  if (role === 'client') {
    if (/\bcompany\s+name\b/i.test(text)) return 'company_name';
    if (/\bindustry\b/i.test(text)) return 'industry';
    if (/\bcompany\s+size\b/i.test(text)) return 'company_size';
    if (/\b(?:headquarters|hq|location)\b/i.test(text)) return 'headquarters_location';
    if (/\b(?:company\s+)?website\b/i.test(text)) return 'company_website';
    if (/\babout\b/i.test(text)) return 'about_company';
    if (/\bfounding\s+year\b/i.test(text)) return 'founding_year';
    if (/\bregistration\b/i.test(text)) return 'registration_number';
    if (/\bgstin|gst\b/i.test(text)) return 'gst_tax_id';
    return null;
  }
  if (/\b(?:consultancy|agency)\s+name\b/i.test(text)) return 'consultancy_name';
  if (/\b(?:consultancy|agency)\s+type\b/i.test(text)) return 'consultancy_type';
  if (/\bspecializations?\b/i.test(text)) return 'industry_specialization';
  if (/\bcompany\s+size\b/i.test(text)) return 'company_size';
  if (/\b(?:headquarters|hq|location)\b/i.test(text)) return 'headquarters_location';
  if (/\bwebsite\b/i.test(text)) return 'website';
  if (/\babout\b/i.test(text)) return 'about_company';
  if (/\bfounding\s+year\b/i.test(text)) return 'founding_year';
  return null;
}

function buildOrgFieldPrompt(field, role, currentProfile = {}) {
  const label = ORG_PROFILE_FIELD_LABELS[field] || field;
  const current = currentProfile?.[field];
  const currStr = Array.isArray(current) ? (current.join(', ') || '(none)') : (current || '(not set)');

  if (field === 'company_size') {
    return `Current **${label}**: ${currStr}.\nPlease choose one of: \`${COMPANY_SIZES.join('`, `')}\`.`;
  }
  if (field === 'industry') {
    return `Current **${label}**: ${currStr}.\nValid options: ${CLIENT_INDUSTRIES.join(', ')}. Which industry would you like to set?`;
  }
  if (field === 'consultancy_type') {
    return `Current **${label}**: ${currStr}.\nPlease specify either **recruitment** or **staffing**.`;
  }
  if (field === 'industry_specialization') {
    return `Current **${label}**: ${currStr}.\nValid options: ${CONSULTANCY_SPECIALIZATIONS.join(', ')}.\nTell me which specializations to add, replace, or remove.`;
  }
  if (field === 'company_website' || field === 'website') {
    return `Current **${label}**: ${currStr}.\nPlease share the full website URL starting with \`http://\` or \`https://\`.`;
  }
  if (field === 'founding_year') {
    return `Current **${label}**: ${currStr}.\nPlease provide a 4-digit founding year between \`1800\` and \`2100\`.`;
  }
  if (field === 'gst_tax_id') {
    return `Current **${label}**: ${currStr}.\nPlease enter a valid 15-character GSTIN (e.g., \`29ABCDE1234F1Z5\`), or reply **"Clear GSTIN"** to clear it.`;
  }
  if (field === 'phone') {
    return `Current **${label}**: ${currStr}.\nPlease provide your 10-digit phone number.`;
  }
  return `Current **${label}**: ${currStr}.\nWhat new value would you like to set for **${label}**?`;
}

function buildOrgOverviewPrompt(role, profileType, profile = {}) {
  const lines = [];
  if (profileType === HIREPOOL_PROFILE_TYPES.CLIENT_ME || profileType === HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME) {
    lines.push(
      'I checked your current HirePool **Personal Account Profile** (`/me`):',
      `- **Full Name:** ${profile.full_name || '(not set)'}`,
      `- **Designation:** ${profile.designation || '(not set)'}`,
      `- **Phone:** ${profile.phone || '(not set)'}`,
      '',
      'Tell me which field(s) you would like to update (for example: *"Update my designation to Lead Recruiter"* or *"Update my phone to 9876543210"*).'
    );
    return lines.join('\n');
  }

  if (role === 'client') {
    lines.push(
      'I checked your current HirePool **Company Profile**:',
      `- **Company Name:** ${profile.company_name || '(not set)'}`,
      `- **Industry:** ${profile.industry || '(not set)'}`,
      `- **Company Size:** ${profile.company_size || '(not set)'}`,
      `- **Headquarters Location:** ${profile.headquarters_location || '(not set)'}`,
      `- **Website:** ${profile.company_website || '(not set)'}`,
      `- **Founding Year:** ${profile.founding_year ?? '(not set)'}`,
      `- **GSTIN:** ${profile.gst_tax_id || '(not set)'}`,
      '',
      'You can also update `about_company`, `registration_number`, `social_media_links`, or your personal account details (`full_name`, `designation`, `phone`).',
      'Tell me what you would like to update (for example: *"Update industry to Technology and company size to 51-200"*).'
    );
    return lines.join('\n');
  }

  lines.push(
    'I checked your current HirePool **Consultancy / Agency Profile**:',
    `- **Consultancy Name:** ${profile.consultancy_name || '(not set)'}`,
    `- **Consultancy Type:** ${profile.consultancy_type || '(not set)'}`,
    `- **Industry Specialization:** ${Array.isArray(profile.industry_specialization) && profile.industry_specialization.length ? profile.industry_specialization.join(', ') : '(not set)'}`,
    `- **Company Size:** ${profile.company_size || '(not set)'}`,
    `- **Headquarters Location:** ${profile.headquarters_location || '(not set)'}`,
    `- **Website:** ${profile.website || '(not set)'}`,
    `- **Founding Year:** ${profile.founding_year ?? '(not set)'}`,
    '',
    'You can also update `about_company`, `social_media_links`, `commission_structure`, or your personal account details (`full_name`, `designation`, `phone`).',
    'Tell me what you would like to update (for example: *"Update consultancy type to staffing and add Healthcare to industry specialization"*).'
  );
  return lines.join('\n');
}

export function getOrgOperationIds(profileType) {
  switch (profileType) {
    case HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY:
      return {
        readOp: 'get_my_company_profile_api_v1_clients_profile_get',
        writeOp: 'update_company_profile_api_v1_clients_profile_put',
        section: HIREPOOL_PROFILE_SECTIONS.COMPANY_PROFILE
      };
    case HIREPOOL_PROFILE_TYPES.CLIENT_ME:
      return {
        readOp: 'get_my_user_profile_api_v1_clients_me_get',
        writeOp: 'update_my_user_profile_api_v1_clients_me_put',
        section: HIREPOOL_PROFILE_SECTIONS.USER_PROFILE
      };
    case HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG:
      return {
        readOp: 'get_my_consultancy_profile_api_v1_consultancies_profile_get',
        writeOp: 'update_consultancy_profile_api_v1_consultancies_profile_put',
        section: HIREPOOL_PROFILE_SECTIONS.CONSULTANCY_PROFILE
      };
    case HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME:
      return {
        readOp: 'get_my_user_profile_api_v1_consultancies_me_get',
        writeOp: 'update_my_user_profile_api_v1_consultancies_me_put',
        section: HIREPOOL_PROFILE_SECTIONS.USER_PROFILE
      };
    default:
      return null;
  }
}

export async function handleOrgProfileEditTurn({
  message,
  session,
  authUser,
  readProfile,
  stageProfileUpdate,
  cancelConfirmation
}) {
  const raw = String(message || '').trim();
  const text = normalizeText(raw);
  if (!text) return { handled: false };

  const role = authUser?.role;
  if (role !== 'client' && role !== 'consultancy') {
    return { handled: false };
  }

  const currentState = ensureRoleScopedProfileEditState(session, authUser);
  const isActiveWorkflow = Boolean(currentState?.active && !['completed', 'cancelled'].includes(currentState.stage));
  const isProfileEditIntent = isHirePoolOrgProfileEditRequest(text);

  if (!isActiveWorkflow && !isProfileEditIntent) {
    return { handled: false };
  }

  // Yield cleanly if user pivots to other role workflows
  if (isActiveWorkflow && PIVOT_PATTERN.test(text) && !/\b(?:profile|gstin|company\s+size|website|headquarters|designation|specializations?)\b/i.test(text)) {
    session.hirePoolProfileEdit = {
      ...(currentState || {}),
      active: false,
      stage: 'cancelled',
      pendingConfirmation: false,
      updatedAt: new Date().toISOString()
    };
    return { handled: false };
  }

  // Handle explicit cancel
  if (isActiveWorkflow && CANCEL_PATTERN.test(text)) {
    if (currentState?.confirmationToken && typeof cancelConfirmation === 'function') {
      try {
        cancelConfirmation(currentState.confirmationToken);
      } catch {}
    }
    session.hirePoolProfileEdit = {
      ...currentState,
      active: false,
      stage: 'cancelled',
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

  const targetProfileType = detectTargetProfileScope(text, role, currentState);

  // Check unsupported fields and cross-role boundaries cleanly before staging anything
  const unsupportedReason = detectOrgProfileUnsupportedRequest(raw, role, targetProfileType);
  if (unsupportedReason) {
    return { handled: true, text: unsupportedReason };
  }

  // Discover organization team role from authUser or /me endpoint if targeting org profile
  let fetchedOrgRole = authUser?.organizationRole || authUser?.orgRole || null;
  if (
    !fetchedOrgRole &&
    (targetProfileType === HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY || targetProfileType === HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG)
  ) {
    try {
      const meOp = role === 'client'
        ? 'get_my_user_profile_api_v1_clients_me_get'
        : 'get_my_user_profile_api_v1_consultancies_me_get';
      const meProfile = await readProfile(meOp);
      if (meProfile?.role) fetchedOrgRole = meProfile.role;
    } catch {
      // Non-fatal: downstream API / prepareAction will also enforce org permissions
    }
  }

  // Check organization-level write permission (recruiter/member restrictions)
  const permission = checkOrgRolePermission(authUser, targetProfileType, fetchedOrgRole);
  if (!permission.allowed) {
    return { handled: true, text: permission.message };
  }

  const ops = getOrgOperationIds(targetProfileType);
  if (!ops) return { handled: false };

  let currentProfile;
  try {
    currentProfile = await readProfile(ops.readOp);
  } catch (error) {
    const status = error?.statusCode;
    return {
      handled: true,
      text: status === 401
        ? 'Your HirePool session needs to be renewed before I can access your profile.'
        : status === 403
          ? 'Your HirePool account role does not have permission to access or update that profile.'
          : `I could not retrieve your current HirePool profile right now (${error?.message || 'API unavailable'}). No profile changes were made.`
    };
  }

  const state = currentState && isActiveWorkflow
    ? {
        ...currentState,
        userId: authUser.id,
        role,
        profileType: targetProfileType,
        selectedSection: ops.section,
        draftData: { ...(currentState.draftData || {}) },
        existingValues: currentProfile
      }
    : buildInitialProfileEditState({
        userId: authUser.id,
        role,
        profileType: targetProfileType,
        operation: 'update',
        selectedSection: ops.section,
        pendingSections: [ops.section],
        existingValues: currentProfile
      });

  const pendingField = state.draftData?.pendingField || null;

  // Bare field prompt or overview
  const extracted = targetProfileType === HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY
    ? extractClientFields(raw, pendingField)
    : targetProfileType === HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG
      ? extractConsultancyFields(raw, currentProfile, pendingField)
      : extractOrgUserFields(raw, pendingField);

  if (Object.keys(extracted).length === 0) {
    const requestedSingleField = detectSingleRequestedOrgField(text, role, targetProfileType);
    if (requestedSingleField) {
      if (['phone', 'designation', 'full_name'].includes(requestedSingleField) &&
          targetProfileType !== HIREPOOL_PROFILE_TYPES.CLIENT_ME &&
          targetProfileType !== HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME) {
        state.profileType = role === 'client' ? HIREPOOL_PROFILE_TYPES.CLIENT_ME : HIREPOOL_PROFILE_TYPES.CONSULTANCY_ME;
      }
      state.stage = 'collecting';
      state.draftData = { ...state.draftData, pendingField: requestedSingleField };
      state.updatedAt = new Date().toISOString();
      session.hirePoolProfileEdit = state;
      return {
        handled: true,
        text: buildOrgFieldPrompt(requestedSingleField, role, currentProfile)
      };
    }

    state.stage = 'awaiting_section_choice';
    state.draftData = { ...state.draftData, pendingField: null };
    state.updatedAt = new Date().toISOString();
    session.hirePoolProfileEdit = state;
    return {
      handled: true,
      text: buildOrgOverviewPrompt(role, targetProfileType, currentProfile)
    };
  }

  // Edit-before-confirm: merge with prior staged body if amending before confirmation
  const isAmendingConfirmation = Boolean(
    state.stage === 'awaiting_confirmation' &&
    state.confirmationPayload &&
    targetProfileType === currentState?.profileType
  );

  if (isAmendingConfirmation && state.confirmationToken && typeof cancelConfirmation === 'function') {
    try {
      cancelConfirmation(state.confirmationToken);
    } catch {}
  }

  const candidateBody = isAmendingConfirmation
    ? { ...state.confirmationPayload, ...extracted }
    : extracted;

  if (isAmendingConfirmation && extracted.social_media_links && state.confirmationPayload?.social_media_links) {
    candidateBody.social_media_links = {
      ...state.confirmationPayload.social_media_links,
      ...extracted.social_media_links
    };
  }

  const validation = targetProfileType === HIREPOOL_PROFILE_TYPES.CLIENT_COMPANY
    ? validateClientProfileUpdatePayload(candidateBody, currentProfile)
    : targetProfileType === HIREPOOL_PROFILE_TYPES.CONSULTANCY_ORG
      ? validateConsultancyProfileUpdatePayload(candidateBody, currentProfile)
      : validateOrgUserProfileUpdatePayload(candidateBody);

  if (!validation.isValid) {
    state.validationState = { valid: false, errors: validation.errors };
    state.stage = 'collecting';
    state.pendingConfirmation = false;
    state.confirmationToken = null;
    state.updatedAt = new Date().toISOString();
    session.hirePoolProfileEdit = state;
    return {
      handled: true,
      text: `I could not validate that profile update: **${validation.firstError}** Please provide a valid value and try again.`
    };
  }

  const review = formatRoleProfileReview({
    role,
    profileType: targetProfileType,
    sanitizedBody: validation.sanitizedBody,
    currentProfile
  });

  const staged = await stageProfileUpdate({
    operationId: ops.writeOp,
    body: validation.sanitizedBody,
    reviewMessage: review.reviewMessage,
    formattedReview: review.formattedReview
  });

  state.draftData = { pendingField: null, collectedValues: validation.sanitizedBody };
  state.validationState = { valid: true, errors: {} };
  state.pendingConfirmation = true;
  state.confirmationToken = staged.hostAction?.confirmationToken || null;
  state.confirmationPayload = validation.sanitizedBody;
  state.stage = 'awaiting_confirmation';
  state.updatedAt = new Date().toISOString();
  session.hirePoolProfileEdit = state;

  return {
    handled: true,
    confirmationStaged: true,
    text: review.reviewMessage,
    hostAction: staged.hostAction
  };
}
