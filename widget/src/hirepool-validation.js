/**
 * Authoritative HirePool Validation Module (Widget / Client-Side)
 * Synchronized with HirePool Frontend and Backend schemas (D:\talenthub-develop)
 */

export const LIMITS = Object.freeze({
  yearsExperience: { min: 0, max: 50 },
  monthsExperience: { min: 0, max: 11 },
  noticeDays: { min: 0, max: 180 },
  expectedSalaryInr: { min: 0, max: 50_000_000 },
  foundingYear: { min: 1800, max: 2100 },
  maxPhoneLength: 20,
  exactPhoneDigits: 10
});

/**
 * Sanity limits for numbers (from frontend/src/utils/validation.ts)
 * @param {string} label
 * @param {number | null | undefined} v
 * @param {number} min
 * @param {number} max
 * @param {string} [unit]
 * @returns {string | null}
 */
export function rangeError(label, v, min, max, unit = '') {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  if (v < min) return `${label} must be at least ${min.toLocaleString('en-IN')}${unit}`;
  if (v > max) return `${label} cannot be more than ${max.toLocaleString('en-IN')}${unit}`;
  return null;
}

export const CLIENT_INDUSTRIES = Object.freeze([
  'Technology',
  'Healthcare',
  'Finance',
  'Education',
  'Manufacturing',
  'Retail',
  'Consulting',
  'Media',
  'Real Estate',
  'Logistics',
  'E-commerce',
  'Other'
]);

export const CONSULTANCY_SPECIALIZATIONS = Object.freeze([
  'Technology',
  'Healthcare',
  'Finance',
  'Engineering',
  'Sales',
  'Marketing',
  'HR',
  'Operations',
  'Design',
  'Data Science',
  'General'
]);

export const COMPANY_SIZES = Object.freeze([
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '500+'
]);

export const CONSULTANCY_TYPES = Object.freeze(['recruitment', 'staffing']);
export const WORK_TYPES = Object.freeze(['remote', 'hybrid', 'onsite']);
export const JOB_TYPES = Object.freeze(['full_time', 'contract']);

/**
 * Remove all non-digits except +
 * @param {string} value
 * @returns {string}
 */
export function sanitizePhoneNumber(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\d+]/g, '');
}

/**
 * Validate phone number against HirePool UI standard (Input.tsx):
 * Must be exactly 10 numeric digits if non-empty.
 * Alphabetic characters and invalid lengths are rejected.
 *
 * @param {string} value
 * @param {{ required?: boolean, fieldLabel?: string }} [options]
 * @returns {{ isValid: boolean, error?: string, digits?: string }}
 */
export function validatePhoneNumber(value, { required = false, fieldLabel = 'Phone number' } = {}) {
  const str = typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());

  if (!str) {
    if (required) {
      return { isValid: false, error: `${fieldLabel} is required`, digits: '' };
    }
    return { isValid: true, digits: '' };
  }

  // Reject alphabetic or special characters other than standard phone punctuation
  if (/[a-zA-Z]/.test(str)) {
    return { isValid: false, error: 'Phone number must contain exactly 10 digits', digits: '' };
  }

  let digitsOnly = str.replace(/\D/g, '');

  // Normalize international/trunk prefix if applicable:
  // e.g. +91 98765 43210 -> digitsOnly is 919876543210 (12 digits starting with 91)
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    digitsOnly = digitsOnly.slice(2);
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('0')) {
    digitsOnly = digitsOnly.slice(1);
  }

  if (digitsOnly.length !== 10) {
    return { isValid: false, error: 'Phone number must contain exactly 10 digits', digits: digitsOnly };
  }

  return { isValid: true, digits: digitsOnly };
}

/**
 * Validate email address against Register.tsx and Pydantic EmailStr
 * @param {string} value
 * @param {{ required?: boolean }} [options]
 * @returns {{ isValid: boolean, error?: string, sanitized?: string }}
 */
export function validateEmail(value, { required = true } = {}) {
  const str = typeof value === 'string' ? value.trim() : '';

  if (!str) {
    if (required) {
      return { isValid: false, error: 'Email is required' };
    }
    return { isValid: true, sanitized: '' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(str)) {
    return { isValid: false, error: 'Invalid email address' };
  }

  return { isValid: true, sanitized: str.toLowerCase() };
}

/**
 * Validate password against Register.tsx and backend password_policy.py
 *
 * @param {string} password
 * @param {{ confirmPassword?: string, acceptAgreement?: boolean, requireAgreement?: boolean }} [options]
 * @returns {{ isValid: boolean, errors: string[], firstError?: string }}
 */
export function validatePassword(password, { confirmPassword = null, acceptAgreement = null, requireAgreement = false } = {}) {
  const errors = [];

  if (typeof password !== 'string' || !password) {
    errors.push('Password is required');
    return { isValid: false, errors, firstError: 'Password is required' };
  }

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  } else if (password.length > 128) {
    errors.push('Password must be at most 128 characters');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (confirmPassword !== null && password !== confirmPassword) {
    errors.push('Passwords do not match');
  }

  if (requireAgreement && acceptAgreement !== true) {
    errors.push('You must agree to the User Agreement to create an account');
  }

  return {
    isValid: errors.length === 0,
    errors,
    firstError: errors[0]
  };
}

/**
 * Validate website URL against ClientOnboarding.tsx & ConsultancyOnboarding.tsx
 *
 * @param {string} url
 * @param {{ required?: boolean, fieldLabel?: string }} [options]
 * @returns {{ isValid: boolean, error?: string, sanitized?: string }}
 */
export function validateWebsiteUrl(url, { required = false, fieldLabel = 'Website' } = {}) {
  const str = typeof url === 'string' ? url.trim() : '';

  if (!str) {
    if (required) {
      return { isValid: false, error: `${fieldLabel} is required` };
    }
    return { isValid: true, sanitized: null };
  }

  if (!/^https?:\/\//i.test(str)) {
    return { isValid: false, error: 'Website must start with http:// or https://' };
  }

  try {
    const parsed = new URL(str);
    const hostname = parsed.hostname;
    if (!hostname.includes('.') || hostname.startsWith('.') || hostname.endsWith('.')) {
      return { isValid: false, error: 'Please enter a valid website URL' };
    }
    const parts = hostname.split('.');
    const tld = parts[parts.length - 1];
    if (tld.length < 2) {
      return { isValid: false, error: 'Please enter a valid website URL' };
    }
    return { isValid: true, sanitized: str };
  } catch {
    return { isValid: false, error: 'Please enter a valid website URL' };
  }
}

/**
 * Validate GSTIN
 * @param {string} gstin
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateGstin(gstin) {
  const str = typeof gstin === 'string' ? gstin.trim().toUpperCase() : '';
  if (!str) return { isValid: true };

  if (str.length !== 15) {
    return { isValid: false, error: 'GSTIN must be exactly 15 characters' };
  }

  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  if (!gstinRegex.test(str)) {
    return { isValid: false, error: 'Please enter a valid GSTIN format' };
  }

  const stateCode = parseInt(str.substring(0, 2), 10);
  if (!((stateCode >= 1 && stateCode <= 38) || stateCode === 97 || stateCode === 99)) {
    return { isValid: false, error: 'Invalid state code in GSTIN' };
  }

  return { isValid: true };
}

/**
 * Validate Education Item
 * @param {object} item
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateEducationItem(item) {
  if (!item || typeof item !== 'object') {
    return { isValid: false, error: 'Education entry must be an object' };
  }
  const inst = typeof item.institution === 'string' ? item.institution.trim() : '';
  const deg = typeof item.degree === 'string' ? item.degree.trim() : '';

  if (!inst && !deg && !item.field_of_study) {
    return { isValid: false, error: 'Empty education entries cannot be submitted' };
  }
  if (!inst) {
    return { isValid: false, error: 'Institution is required' };
  }
  if (!deg) {
    return { isValid: false, error: 'Degree is required' };
  }
  return { isValid: true };
}

/**
 * Validate Work Experience Item
 * @param {object} item
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateWorkExperienceItem(item) {
  if (!item || typeof item !== 'object') {
    return { isValid: false, error: 'Work experience entry must be an object' };
  }
  const comp = typeof item.company === 'string' ? item.company.trim() : '';
  const title = typeof item.title === 'string' ? item.title.trim() : '';

  if (!comp && !title && !item.description) {
    return { isValid: false, error: 'Empty work experience entries cannot be submitted' };
  }
  if (!comp) {
    return { isValid: false, error: 'Company is required' };
  }
  if (!title) {
    return { isValid: false, error: 'Job title is required' };
  }
  return { isValid: true };
}

/**
 * Validate Candidate Profile
 * @param {object} profile
 * @param {{ mode?: 'onboarding' | 'profile' }} [options]
 * @returns {{ isValid: boolean, errors: Record<string, string>, firstError?: string, sanitizedData: object }}
 */
export function validateCandidateProfile(profile, { mode = 'onboarding' } = {}) {
  const errors = {};
  const data = { ...(profile || {}) };

  const firstName = typeof data.first_name === 'string' ? data.first_name.trim() : '';
  if (!firstName) {
    errors.first_name = 'First name is required';
  } else if (firstName.length > 100) {
    errors.first_name = 'First name cannot be more than 100 characters';
  } else {
    data.first_name = firstName;
  }

  const lastName = typeof data.last_name === 'string' ? data.last_name.trim() : '';
  if (!lastName) {
    errors.last_name = 'Last name is required';
  } else if (lastName.length > 100) {
    errors.last_name = 'Last name cannot be more than 100 characters';
  } else {
    data.last_name = lastName;
  }

  const location = typeof data.current_location === 'string' ? data.current_location.trim() : '';
  if (!location) {
    errors.current_location = 'Location is required';
  } else if (location.length > 255) {
    errors.current_location = 'Location cannot be more than 255 characters';
  } else {
    data.current_location = location;
  }

  const jobTitle = typeof data.job_title === 'string' ? data.job_title.trim() : '';
  if (!jobTitle) {
    errors.job_title = 'Job title is required';
  } else if (jobTitle.length > 255) {
    errors.job_title = 'Job title cannot be more than 255 characters';
  } else {
    data.job_title = jobTitle;
  }

  const phoneRes = validatePhoneNumber(data.phone, {
    required: mode === 'profile',
    fieldLabel: 'Phone number'
  });
  if (!phoneRes.isValid) {
    errors.phone = phoneRes.error;
  } else {
    data.phone = phoneRes.digits || null;
  }

  if (data.years_of_experience !== undefined && data.years_of_experience !== null && data.years_of_experience !== '') {
    const yoe = Number(data.years_of_experience);
    if (!Number.isFinite(yoe) || !Number.isInteger(yoe) || yoe < LIMITS.yearsExperience.min || yoe > LIMITS.yearsExperience.max) {
      errors.years_of_experience = `Years of experience must be between ${LIMITS.yearsExperience.min} and ${LIMITS.yearsExperience.max}`;
    } else {
      data.years_of_experience = yoe;
    }
  } else if (mode === 'profile') {
    errors.years_of_experience = 'Years of experience is required';
  } else {
    data.years_of_experience = 0;
  }

  if (data.months_of_experience !== undefined && data.months_of_experience !== null && data.months_of_experience !== '') {
    const moe = Number(data.months_of_experience);
    if (!Number.isFinite(moe) || !Number.isInteger(moe) || moe < LIMITS.monthsExperience.min || moe > LIMITS.monthsExperience.max) {
      errors.months_of_experience = 'Months of experience must be between 0 and 11';
    } else {
      data.months_of_experience = moe;
    }
  } else {
    data.months_of_experience = 0;
  }

  if (data.notice_period_days !== undefined && data.notice_period_days !== null && data.notice_period_days !== '') {
    const notice = Number(data.notice_period_days);
    const err = rangeError('Notice period', notice, LIMITS.noticeDays.min, LIMITS.noticeDays.max, ' days');
    if (!Number.isFinite(notice) || err) {
      errors.notice_period_days = err || `Notice period cannot be more than ${LIMITS.noticeDays.max} days`;
    } else {
      data.notice_period_days = Math.floor(notice);
    }
  } else {
    data.notice_period_days = null;
  }

  let salMin = null;
  let salMax = null;
  if (data.expected_salary_min !== undefined && data.expected_salary_min !== null && data.expected_salary_min !== '') {
    const v = Number(data.expected_salary_min);
    const err = rangeError('Minimum expected salary', v, LIMITS.expectedSalaryInr.min, LIMITS.expectedSalaryInr.max);
    if (!Number.isFinite(v) || err) {
      errors.expected_salary_min = err || 'Minimum expected salary cannot be more than 50,000,000';
    } else {
      salMin = Math.floor(v);
      data.expected_salary_min = salMin;
    }
  } else {
    data.expected_salary_min = null;
  }

  if (data.expected_salary_max !== undefined && data.expected_salary_max !== null && data.expected_salary_max !== '') {
    const v = Number(data.expected_salary_max);
    const err = rangeError('Maximum expected salary', v, LIMITS.expectedSalaryInr.min, LIMITS.expectedSalaryInr.max);
    if (!Number.isFinite(v) || err) {
      errors.expected_salary_max = err || 'Maximum expected salary cannot be more than 50,000,000';
    } else {
      salMax = Math.floor(v);
      data.expected_salary_max = salMax;
    }
  } else {
    data.expected_salary_max = null;
  }

  if (salMin !== null && salMax !== null && salMin > salMax) {
    errors.expected_salary_min = 'The minimum expected salary cannot be more than the maximum';
  }

  let skillsList = [];
  if (Array.isArray(data.skills)) {
    skillsList = data.skills.map(s => String(s).trim()).filter(Boolean);
  } else if (typeof data.skills === 'string') {
    skillsList = data.skills.split(',').map(s => s.trim()).filter(Boolean);
  }
  data.skills = skillsList;
  if (mode === 'profile' && skillsList.length === 0) {
    errors.skills = 'At least one skill is required';
  }

  for (const urlField of ['linkedin_url', 'github_url', 'portfolio_url', 'personal_website']) {
    if (data[urlField]) {
      const urlRes = validateWebsiteUrl(data[urlField], { required: false });
      if (!urlRes.isValid) {
        errors[urlField] = urlRes.error;
      } else {
        data[urlField] = urlRes.sanitized;
      }
    } else {
      data[urlField] = null;
    }
  }

  if (Array.isArray(data.education) && data.education.length > 0) {
    for (let i = 0; i < data.education.length; i++) {
      const eduRes = validateEducationItem(data.education[i]);
      if (!eduRes.isValid) {
        errors[`education.${i}`] = eduRes.error;
        break;
      }
    }
  }

  if (Array.isArray(data.work_experience) && data.work_experience.length > 0) {
    for (let i = 0; i < data.work_experience.length; i++) {
      const expRes = validateWorkExperienceItem(data.work_experience[i]);
      if (!expRes.isValid) {
        errors[`work_experience.${i}`] = expRes.error;
        break;
      }
    }
  }

  const isValid = Object.keys(errors).length === 0;
  return {
    isValid,
    errors,
    firstError: Object.values(errors)[0],
    sanitizedData: data
  };
}

/**
 * Validate Client Profile
 * @param {object} profile
 * @param {{ mode?: 'onboarding' | 'profile' }} [options]
 * @returns {{ isValid: boolean, errors: Record<string, string>, firstError?: string, sanitizedData: object }}
 */
export function validateClientProfile(profile, { mode = 'onboarding' } = {}) {
  const errors = {};
  const data = { ...(profile || {}) };

  const companyName = typeof data.company_name === 'string' ? data.company_name.trim() : '';
  if (!companyName) {
    errors.company_name = 'Company name is required';
  } else if (companyName.length > 255) {
    errors.company_name = 'Company name cannot be more than 255 characters';
  } else {
    data.company_name = companyName;
  }

  const industry = typeof data.industry === 'string' ? data.industry.trim() : '';
  if (!industry) {
    errors.industry = 'Industry is required';
  } else {
    data.industry = industry;
  }

  const companySize = typeof data.company_size === 'string' ? data.company_size.trim() : '';
  if (!companySize) {
    errors.company_size = 'Company size is required';
  } else if (!COMPANY_SIZES.includes(companySize)) {
    errors.company_size = 'Please select a valid company size';
  } else {
    data.company_size = companySize;
  }

  const location = typeof data.headquarters_location === 'string' ? data.headquarters_location.trim() : '';
  if (!location) {
    errors.headquarters_location = 'Location is required';
  } else if (location.length > 255) {
    errors.headquarters_location = 'Location cannot be more than 255 characters';
  } else {
    data.headquarters_location = location;
  }

  const contact = { ...(data.primary_contact || {}) };
  const contactName = typeof contact.full_name === 'string'
    ? contact.full_name.trim()
    : (typeof data.full_name === 'string' ? data.full_name.trim() : '');

  if (!contactName) {
    errors['primary_contact.full_name'] = 'Your name is required';
  } else if (contactName.length > 200) {
    errors['primary_contact.full_name'] = 'Name cannot be more than 200 characters';
  } else {
    contact.full_name = contactName;
  }

  const rawPhone = contact.phone || data.phone;
  const phoneRes = validatePhoneNumber(rawPhone, {
    required: mode === 'profile',
    fieldLabel: 'Phone number'
  });
  if (!phoneRes.isValid) {
    errors['primary_contact.phone'] = phoneRes.error;
  } else {
    contact.phone = phoneRes.digits || null;
  }

  if (contact.designation) {
    contact.designation = String(contact.designation).trim().slice(0, 100);
  } else if (data.designation) {
    contact.designation = String(data.designation).trim().slice(0, 100);
  } else {
    contact.designation = null;
  }
  data.primary_contact = contact;

  if (data.company_website) {
    const webRes = validateWebsiteUrl(data.company_website, { required: false });
    if (!webRes.isValid) {
      errors.company_website = webRes.error;
    } else {
      data.company_website = webRes.sanitized;
    }
  } else {
    data.company_website = null;
  }

  if (data.founding_year !== undefined && data.founding_year !== null && data.founding_year !== '') {
    const yr = Number(data.founding_year);
    if (!Number.isFinite(yr) || yr < LIMITS.foundingYear.min || yr > LIMITS.foundingYear.max) {
      errors.founding_year = `Founding year must be between ${LIMITS.foundingYear.min} and ${LIMITS.foundingYear.max}`;
    } else {
      data.founding_year = Math.floor(yr);
    }
  } else {
    data.founding_year = null;
  }

  if (data.gst_tax_id) {
    const gstinRes = validateGstin(data.gst_tax_id);
    if (!gstinRes.isValid) {
      errors.gst_tax_id = gstinRes.error;
    }
  }

  const isValid = Object.keys(errors).length === 0;
  return {
    isValid,
    errors,
    firstError: Object.values(errors)[0],
    sanitizedData: data
  };
}

/**
 * Validate Consultancy Profile
 * @param {object} profile
 * @param {{ mode?: 'onboarding' | 'profile' }} [options]
 * @returns {{ isValid: boolean, errors: Record<string, string>, firstError?: string, sanitizedData: object }}
 */
export function validateConsultancyProfile(profile, { mode = 'onboarding' } = {}) {
  const errors = {};
  const data = { ...(profile || {}) };

  const consultType = typeof data.consultancy_type === 'string' ? data.consultancy_type.trim().toLowerCase() : '';
  if (!consultType || !CONSULTANCY_TYPES.includes(consultType)) {
    errors.consultancy_type = 'Please select your agency type';
  } else {
    data.consultancy_type = consultType;
  }

  const consultName = typeof data.consultancy_name === 'string' ? data.consultancy_name.trim() : '';
  if (!consultName) {
    errors.consultancy_name = 'Agency name is required';
  } else if (consultName.length > 255) {
    errors.consultancy_name = 'Agency name cannot be more than 255 characters';
  } else {
    data.consultancy_name = consultName;
  }

  const location = typeof data.headquarters_location === 'string' ? data.headquarters_location.trim() : '';
  if (!location) {
    errors.headquarters_location = 'Location is required';
  } else if (location.length > 255) {
    errors.headquarters_location = 'Location cannot be more than 255 characters';
  } else {
    data.headquarters_location = location;
  }

  let specs = [];
  if (Array.isArray(data.industry_specialization)) {
    specs = data.industry_specialization.map(s => String(s).trim()).filter(Boolean);
  } else if (typeof data.industry_specialization === 'string') {
    specs = data.industry_specialization.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (specs.length === 0) {
    errors.industry_specialization = 'Select at least one industry';
  } else {
    data.industry_specialization = specs;
  }

  if (data.company_size) {
    const cs = String(data.company_size).trim();
    if (cs && !COMPANY_SIZES.includes(cs)) {
      errors.company_size = 'Please select a valid company size';
    } else {
      data.company_size = cs || null;
    }
  } else {
    data.company_size = null;
  }

  const contact = { ...(data.primary_contact || {}) };
  const contactName = typeof contact.full_name === 'string'
    ? contact.full_name.trim()
    : (typeof data.full_name === 'string' ? data.full_name.trim() : '');

  if (!contactName) {
    errors['primary_contact.full_name'] = 'Your name is required';
  } else if (contactName.length > 200) {
    errors['primary_contact.full_name'] = 'Name cannot be more than 200 characters';
  } else {
    contact.full_name = contactName;
  }

  const rawPhone = contact.phone || data.phone;
  const phoneRes = validatePhoneNumber(rawPhone, {
    required: mode === 'profile',
    fieldLabel: 'Phone number'
  });
  if (!phoneRes.isValid) {
    errors['primary_contact.phone'] = phoneRes.error;
  } else {
    contact.phone = phoneRes.digits || null;
  }

  if (contact.designation) {
    contact.designation = String(contact.designation).trim().slice(0, 100);
  } else if (data.designation) {
    contact.designation = String(data.designation).trim().slice(0, 100);
  } else {
    contact.designation = null;
  }
  data.primary_contact = contact;

  if (data.website) {
    const webRes = validateWebsiteUrl(data.website, { required: false });
    if (!webRes.isValid) {
      errors.website = webRes.error;
    } else {
      data.website = webRes.sanitized;
    }
  } else {
    data.website = null;
  }

  if (data.founding_year !== undefined && data.founding_year !== null && data.founding_year !== '') {
    const yr = Number(data.founding_year);
    if (!Number.isFinite(yr) || yr < LIMITS.foundingYear.min || yr > LIMITS.foundingYear.max) {
      errors.founding_year = `Founding year must be between ${LIMITS.foundingYear.min} and ${LIMITS.foundingYear.max}`;
    } else {
      data.founding_year = Math.floor(yr);
    }
  } else {
    data.founding_year = null;
  }

  const isValid = Object.keys(errors).length === 0;
  return {
    isValid,
    errors,
    firstError: Object.values(errors)[0],
    sanitizedData: data
  };
}

/**
 * Universal validator checking missing mandatory fields for all three roles.
 *
 * @param {string} userType 'candidate' | 'client' | 'consultancy'
 * @param {object} profile
 * @param {{ mode?: 'onboarding' | 'profile' }} [options]
 * @returns {string[]} List of missing field keys
 */
export function getMissingMandatoryFields(userType, profile, { mode = 'onboarding' } = {}) {
  const missing = [];
  if (!profile || typeof profile !== 'object') {
    return ['all'];
  }

  if (userType === 'candidate') {
    if (!profile.first_name || !String(profile.first_name).trim()) missing.push('first_name');
    if (!profile.last_name || !String(profile.last_name).trim()) missing.push('last_name');
    if (!profile.current_location || !String(profile.current_location).trim()) missing.push('current_location');
    if (!profile.job_title || !String(profile.job_title).trim()) missing.push('job_title');
    if (mode === 'profile') {
      if (!profile.phone || !String(profile.phone).trim()) missing.push('phone');
      if (profile.years_of_experience === undefined || profile.years_of_experience === null) missing.push('years_of_experience');
      if (!profile.skills || (Array.isArray(profile.skills) && profile.skills.length === 0)) missing.push('skills');
    }
  } else if (userType === 'client') {
    if (!profile.company_name || !String(profile.company_name).trim()) missing.push('company_name');
    if (!profile.industry || !String(profile.industry).trim()) missing.push('industry');
    if (!profile.company_size || !String(profile.company_size).trim()) missing.push('company_size');
    if (!profile.headquarters_location || !String(profile.headquarters_location).trim()) missing.push('headquarters_location');
    const contactName = profile.primary_contact?.full_name || profile.full_name;
    if (!contactName || !String(contactName).trim()) missing.push('primary_contact.full_name');
    if (mode === 'profile') {
      const contactPhone = profile.primary_contact?.phone || profile.phone;
      if (!contactPhone || !String(contactPhone).trim()) missing.push('primary_contact.phone');
    }
  } else if (userType === 'consultancy') {
    if (!profile.consultancy_name || !String(profile.consultancy_name).trim()) missing.push('consultancy_name');
    if (!['recruitment', 'staffing'].includes(profile.consultancy_type)) missing.push('consultancy_type');
    if (!Array.isArray(profile.industry_specialization) || profile.industry_specialization.length === 0) {
      missing.push('industry_specialization');
    }
    if (!profile.headquarters_location || !String(profile.headquarters_location).trim()) missing.push('headquarters_location');
    const contactName = profile.primary_contact?.full_name || profile.full_name;
    if (!contactName || !String(contactName).trim()) missing.push('primary_contact.full_name');
    if (mode === 'profile') {
      const contactPhone = profile.primary_contact?.phone || profile.phone;
      if (!contactPhone || !String(contactPhone).trim()) missing.push('primary_contact.phone');
    }
  } else {
    missing.push('unsupported_role');
  }

  return missing;
}
