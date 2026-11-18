/**
 * HirePool Schema Metadata, Normalization, and Pre-Execution Validation
 *
 * Implements strict schema-driven field validation and human-readable error normalization
 * based on HirePool FastAPI backend models and OpenAPI specs.
 */

// Work type (remote_type in backend)
export const HIREPOOL_WORK_TYPES = Object.freeze({
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site'
});

// Experience levels
export const HIREPOOL_EXPERIENCE_LEVELS = Object.freeze({
  entry: 'Entry Level',
  mid: 'Mid Level',
  senior: 'Senior',
  lead: 'Lead',
  executive: 'Executive'
});

// Job types
export const HIREPOOL_JOB_TYPES = Object.freeze({
  full_time: 'Full Time',
  contract_to_hire: 'Contract to Hire',
  contract: 'Contract'
});

// Employment types (STRICTLY permanent or contract)
export const HIREPOOL_EMPLOYMENT_TYPES = Object.freeze({
  permanent: 'Permanent',
  contract: 'Contract'
});

// Pay periods (STRICTLY hour, week, month, year)
export const HIREPOOL_PAY_PERIODS = Object.freeze({
  hour: 'Hourly',
  week: 'Weekly',
  month: 'Monthly',
  year: 'Yearly'
});

// Currency
export const HIREPOOL_CURRENCIES = Object.freeze(['INR', 'USD', 'EUR', 'GBP']);

/**
 * Normalizes salary text such as "3-5 LPA" or numeric amounts into standard yearly INR numbers.
 */
export function normalizeSalary(rawSalary, defaultCurrency = 'INR', defaultPayPeriod = 'year') {
  if (!rawSalary) return null;

  if (typeof rawSalary === 'object') {
    let min = rawSalary.salary_min ?? rawSalary.pay_min;
    let max = rawSalary.salary_max ?? rawSalary.pay_max;
    const currency = (rawSalary.salary_currency || defaultCurrency).toUpperCase();
    let period = (rawSalary.pay_period || defaultPayPeriod).toLowerCase();

    // Map common aliases
    if (period === 'yearly' || period === 'annually' || period === 'annual') period = 'year';
    if (period === 'monthly') period = 'month';
    if (period === 'weekly') period = 'week';
    if (period === 'hourly') period = 'hour';

    if (typeof min === 'string') min = Number.parseFloat(min.replace(/[^0-9.]/g, ''));
    if (typeof max === 'string') max = Number.parseFloat(max.replace(/[^0-9.]/g, ''));

    return {
      salary_min: min || null,
      salary_max: max || null,
      salary_currency: HIREPOOL_CURRENCIES.includes(currency) ? currency : 'INR',
      pay_period: Object.hasOwn(HIREPOOL_PAY_PERIODS, period) ? period : 'year'
    };
  }

  const str = String(rawSalary).trim();
  // Match "3-5 LPA" or "3 to 5 LPA" or "3-5 Lakhs"
  const lpaMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?)/i);
  if (lpaMatch) {
    const minLacs = Number.parseFloat(lpaMatch[1]);
    const maxLacs = Number.parseFloat(lpaMatch[2]);
    return {
      salary_min: Math.round(minLacs * 100_000),
      salary_max: Math.round(maxLacs * 100_000),
      salary_currency: 'INR',
      pay_period: 'year'
    };
  }

  // Match single "5 LPA"
  const singleLpa = str.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?)/i);
  if (singleLpa) {
    const lacs = Number.parseFloat(singleLpa[1]);
    return {
      salary_min: Math.round(lacs * 100_000),
      salary_max: Math.round(lacs * 100_000),
      salary_currency: 'INR',
      pay_period: 'year'
    };
  }

  return null;
}

/**
 * Normalizes date to YYYY-MM-DD.
 */
export function normalizeDate(input) {
  if (!input) return null;
  const str = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) return str;
  }
  const dateObj = new Date(str);
  if (!Number.isNaN(dateObj.getTime())) {
    return dateObj.toISOString().split('T')[0];
  }
  return null;
}

/**
 * Validates and normalizes Job Creation request payload before dynamic API staging.
 */
export function validateJobCreation(input) {
  const body = { ...(input || {}) };
  const fieldErrors = {};
  const missingFields = [];

  // 1. Title (required, min 3, max 150)
  const title = String(body.title || '').trim();
  if (!title) {
    missingFields.push('title');
    fieldErrors.title = 'Job title is required (e.g. Full Stack Developer).';
  } else if (title.length < 3 || title.length > 150) {
    fieldErrors.title = 'Job title must be between 3 and 150 characters.';
  }

  // 2. Description (required, min 30, max 20000)
  const description = String(body.description || '').trim();
  if (!description) {
    missingFields.push('description');
    fieldErrors.description = 'Job description is required (at least 30 characters).';
  } else if (description.length < 30) {
    fieldErrors.description = `Job description must be at least 30 characters (currently ${description.length} characters).`;
  }

  // 3. Work type (remote_type: remote | hybrid | onsite)
  let remoteType = body.remote_type || body.work_type || null;
  if (remoteType) {
    remoteType = String(remoteType).toLowerCase().trim().replace(/[-_\s]/g, '');
    if (remoteType === 'onsite' || remoteType === 'on-site' || remoteType === 'office') remoteType = 'onsite';
    if (remoteType === 'remote' || remoteType === 'wfh') remoteType = 'remote';
    if (remoteType === 'hybrid') remoteType = 'hybrid';
    if (!Object.hasOwn(HIREPOOL_WORK_TYPES, remoteType)) {
      fieldErrors.work_type = `Work type must be one of: ${Object.values(HIREPOOL_WORK_TYPES).join(', ')}.`;
      remoteType = null;
    }
  }

  // 4. Employment type (MUST be permanent or contract)
  let employmentType = body.employment_type || null;
  if (employmentType) {
    const rawEmp = String(employmentType).toLowerCase().trim();
    // Catch common mix-ups: if user provided work type as employment type
    if (['remote', 'hybrid', 'onsite', 'on-site'].includes(rawEmp)) {
      if (!remoteType) {
        remoteType = rawEmp === 'on-site' ? 'onsite' : rawEmp;
      }
      fieldErrors.employment_type = 'The employment type must be either Permanent or Contract. Work type (Remote, Hybrid, On-site) is separate.';
      employmentType = null;
    } else if (rawEmp === 'permanent' || rawEmp === 'full_time' || rawEmp === 'fulltime') {
      employmentType = 'permanent';
    } else if (rawEmp === 'contract' || rawEmp === 'contractor' || rawEmp === 'c2c') {
      employmentType = 'contract';
    } else {
      fieldErrors.employment_type = 'The employment type must be either Permanent or Contract. Please select one of the available options.';
      employmentType = null;
    }
  }

  // 5. Experience level (entry | mid | senior | lead | executive)
  let experienceLevel = body.experience_level || null;
  if (experienceLevel) {
    const rawExp = String(experienceLevel).toLowerCase().trim();
    if (rawExp.includes('entry') || rawExp.includes('junior') || rawExp.includes('fresher')) experienceLevel = 'entry';
    else if (rawExp.includes('mid') || rawExp.includes('intermediate')) experienceLevel = 'mid';
    else if (rawExp.includes('senior') || rawExp.includes('sr')) experienceLevel = 'senior';
    else if (rawExp.includes('lead') || rawExp.includes('principal')) experienceLevel = 'lead';
    else if (rawExp.includes('exec') || rawExp.includes('director') || rawExp.includes('vp')) experienceLevel = 'executive';
    else if (!Object.hasOwn(HIREPOOL_EXPERIENCE_LEVELS, experienceLevel)) {
      fieldErrors.experience_level = `Experience level must be one of: ${Object.values(HIREPOOL_EXPERIENCE_LEVELS).join(', ')}.`;
      experienceLevel = null;
    }
  }

  // 6. Pay period (hour | week | month | year)
  let payPeriod = body.pay_period || 'year';
  if (payPeriod) {
    const rawPeriod = String(payPeriod).toLowerCase().trim();
    if (rawPeriod === 'hourly' || rawPeriod === 'hour') payPeriod = 'hour';
    else if (rawPeriod === 'weekly' || rawPeriod === 'week') payPeriod = 'week';
    else if (rawPeriod === 'monthly' || rawPeriod === 'month') payPeriod = 'month';
    else if (rawPeriod === 'yearly' || rawPeriod === 'annually' || rawPeriod === 'year' || rawPeriod === 'annual') payPeriod = 'year';
    else {
      fieldErrors.pay_period = `Pay period must be Hourly, Weekly, Monthly, or Yearly.`;
      payPeriod = 'year';
    }
  }

  // 7. Salary handling
  let salaryMin = body.salary_min ?? body.pay_min ?? null;
  let salaryMax = body.salary_max ?? body.pay_max ?? null;
  let currency = (body.salary_currency || 'INR').toUpperCase();
  if (!HIREPOOL_CURRENCIES.includes(currency)) currency = 'INR';

  if (body.salary && typeof body.salary === 'string') {
    const parsed = normalizeSalary(body.salary, currency, payPeriod);
    if (parsed) {
      salaryMin = parsed.salary_min;
      salaryMax = parsed.salary_max;
      currency = parsed.salary_currency;
      payPeriod = parsed.pay_period;
    }
  }

  if (salaryMin !== null && salaryMax !== null && Number(salaryMin) > Number(salaryMax)) {
    fieldErrors.salary = 'Minimum salary cannot be greater than maximum salary.';
  }

  // 8. Application deadline
  let deadline = null;
  if (body.application_deadline) {
    deadline = normalizeDate(body.application_deadline);
    if (!deadline) {
      fieldErrors.application_deadline = 'The application deadline must use YYYY-MM-DD format (e.g. 2026-12-15).';
    }
  }

  // 9. Locations
  let locations = Array.isArray(body.locations) ? body.locations : [];
  if (typeof body.location === 'string' && body.location.trim()) {
    locations = [body.location.trim()];
  }
  locations = locations.map(l => String(l).trim()).filter(Boolean);

  // 10. Skills
  const requiredSkills = Array.isArray(body.required_skills)
    ? body.required_skills.map(s => String(s).trim()).filter(Boolean)
    : (typeof body.required_skills === 'string' ? body.required_skills.split(',').map(s => s.trim()).filter(Boolean) : []);

  const preferredSkills = Array.isArray(body.preferred_skills)
    ? body.preferred_skills.map(s => String(s).trim()).filter(Boolean)
    : (typeof body.preferred_skills === 'string' ? body.preferred_skills.split(',').map(s => s.trim()).filter(Boolean) : []);

  const isValid = missingFields.length === 0 && Object.keys(fieldErrors).length === 0;

  // Normalized payload ready for HirePool backend
  const normalized = {
    title,
    description,
    department: body.department ? String(body.department).trim() : null,
    locations,
    remote_type: remoteType,
    job_type: body.job_type || 'full_time',
    employment_type: employmentType,
    experience_level: experienceLevel,
    experience_min: body.experience_min !== undefined ? Number(body.experience_min) : null,
    experience_max: body.experience_max !== undefined ? Number(body.experience_max) : null,
    required_skills: requiredSkills,
    preferred_skills: preferredSkills,
    pay_period: payPeriod,
    salary_currency: currency,
    salary_min: salaryMin !== null ? Number(salaryMin) : null,
    salary_max: salaryMax !== null ? Number(salaryMax) : null,
    number_of_openings: body.number_of_openings ? Number.parseInt(body.number_of_openings, 10) : 1,
    application_deadline: deadline,
    status: body.status || 'draft'
  };

  // Structured review data for rich widget rendering
  const formattedReview = {
    type: 'job_creation',
    title: 'Review Job Details',
    fields: [
      { label: 'Job title', value: title || 'Not provided' },
      { label: 'Department', value: normalized.department || 'General' },
      { label: 'Location', value: locations.length > 0 ? locations.join(', ') : 'Not specified' },
      { label: 'Work type', value: remoteType ? HIREPOOL_WORK_TYPES[remoteType] : 'Not specified' },
      { label: 'Experience level', value: experienceLevel ? HIREPOOL_EXPERIENCE_LEVELS[experienceLevel] : 'Not specified' },
      { label: 'Employment type', value: employmentType ? HIREPOOL_EMPLOYMENT_TYPES[employmentType] : 'Not specified' },
      {
        label: 'Salary range',
        value: salaryMin && salaryMax
          ? `${currency === 'INR' ? '₹' : currency} ${Number(salaryMin).toLocaleString()} – ${Number(salaryMax).toLocaleString()} (${HIREPOOL_PAY_PERIODS[payPeriod] || payPeriod})`
          : 'Not specified'
      },
      { label: 'Openings', value: String(normalized.number_of_openings) },
      { label: 'Deadline', value: deadline || 'Not specified' }
    ],
    requiredSkills,
    preferredSkills,
    description
  };

  // Build conversational guidance if invalid
  let guidanceMessage = null;
  if (!isValid) {
    const errorLines = [];
    if (missingFields.length > 0) {
      errorLines.push(`I need a few more details to create the job:`);
      if (missingFields.includes('title')) errorLines.push(`- **Job title**: Please provide a job title.`);
      if (missingFields.includes('description')) errorLines.push(`- **Job description**: Please provide a description of at least 30 characters.`);
    }

    const fieldErrorEntries = Object.entries(fieldErrors);
    if (fieldErrorEntries.length > 0) {
      errorLines.push('\nPlease clarify the following:');
      for (const [_, msg] of fieldErrorEntries) {
        errorLines.push(`- ${msg}`);
      }
    }

    // Include selectable choices for user clarity
    errorLines.push('\n**Available options:**');
    errorLines.push(`- **Work type**: ${Object.values(HIREPOOL_WORK_TYPES).join(', ')}`);
    errorLines.push(`- **Experience level**: ${Object.values(HIREPOOL_EXPERIENCE_LEVELS).join(', ')}`);
    errorLines.push(`- **Employment type**: ${Object.values(HIREPOOL_EMPLOYMENT_TYPES).join(', ')}`);
    errorLines.push(`- **Pay period**: ${Object.values(HIREPOOL_PAY_PERIODS).join(', ')}`);

    guidanceMessage = errorLines.join('\n');
  }

  return {
    isValid,
    normalized,
    missingFields,
    fieldErrors,
    guidanceMessage,
    formattedReview
  };
}

/**
 * Validates and normalizes Candidate Creation by Consultancy.
 */
export function validateCandidateCreation(input) {
  const body = { ...(input || {}) };
  const fieldErrors = {};
  const missingFields = [];

  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || '').trim();
  if (!firstName) {
    missingFields.push('first_name');
    fieldErrors.first_name = 'First name is required.';
  }
  if (!lastName) {
    missingFields.push('last_name');
    fieldErrors.last_name = 'Last name is required.';
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    missingFields.push('email');
    fieldErrors.email = 'A valid email address is required.';
  }

  const location = String(body.current_location || body.location || '').trim();
  if (!location) {
    missingFields.push('current_location');
    fieldErrors.current_location = 'Current location is required (City, Country).';
  }

  const jobTitle = String(body.job_title || body.title || '').trim();
  if (!jobTitle) {
    missingFields.push('job_title');
    fieldErrors.job_title = 'Job title or primary specialization is required.';
  }

  const skills = Array.isArray(body.skills)
    ? body.skills.map(s => String(s).trim()).filter(Boolean)
    : (typeof body.skills === 'string' ? body.skills.split(',').map(s => s.trim()).filter(Boolean) : []);

  const isValid = missingFields.length === 0 && Object.keys(fieldErrors).length === 0;

  const expYears = body.years_of_experience !== undefined
    ? Number(body.years_of_experience)
    : (body.experience_years !== undefined ? Number(body.experience_years) : 0);

  const normalized = {
    first_name: firstName,
    last_name: lastName,
    email,
    phone: body.phone ? String(body.phone).trim() : null,
    current_location: location,
    job_title: jobTitle,
    years_of_experience: expYears,
    skills,
    bench_status: body.bench_status || 'available',
    notice_period_days: body.notice_period_days !== undefined && body.notice_period_days !== null ? Number(body.notice_period_days) : null
  };

  const formattedReview = {
    type: 'candidate_creation',
    title: 'Review Candidate Details',
    fields: [
      { label: 'Full name', value: `${firstName} ${lastName}`.trim() },
      { label: 'Email', value: email },
      { label: 'Phone', value: normalized.phone || 'Not provided' },
      { label: 'Job title', value: jobTitle },
      { label: 'Location', value: location },
      { label: 'Experience', value: `${expYears} years` },
      { label: 'Bench status', value: normalized.bench_status },
      { label: 'Skills', value: skills.length > 0 ? skills.join(', ') : 'None listed' }
    ],
    requiredSkills: skills,
    preferredSkills: [],
    description: normalized.notes || ''
  };

  let guidanceMessage = null;
  if (!isValid) {
    guidanceMessage = `Please provide the required candidate information:\n${
      missingFields.map(f => `- ${f.replace(/_/g, ' ')}`).join('\n')
    }`;
  }

  return {
    isValid,
    normalized,
    missingFields,
    fieldErrors,
    guidanceMessage,
    formattedReview
  };
}
