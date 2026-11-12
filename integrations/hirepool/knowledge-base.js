/**
 * Verified HirePool Platform Knowledge & Grounded Responses
 *
 * Strictly grounded in inspected HirePool public website pages (`hirepool.ai`),
 * Privacy Policy (`/privacy`), Terms of Service (`/terms`), Pricing (`/pricing`),
 * Features (`/features`), and verified backend API capabilities.
 */

export const HIREPOOL_PUBLIC_URLS = Object.freeze({
  home: 'https://hirepool.ai',
  features: 'https://hirepool.ai/features',
  pricing: 'https://hirepool.ai/pricing',
  enterprise: 'https://hirepool.ai/enterprise',
  partners: 'https://hirepool.ai/partners',
  privacy: 'https://hirepool.ai/privacy',
  terms: 'https://hirepool.ai/terms',
  contact: 'https://hirepool.ai/contact',
  email: 'hi@hirepool.ai'
});

export const HIREPOOL_PUBLIC_TOPICS = Object.freeze({
  PRICING: 'pricing',
  PRIVACY: 'privacy',
  TERMS: 'terms',
  FRESHERS: 'freshers',
  WORK_MODES: 'work_modes',
  EXPERIENCED: 'experienced',
  MATCHING: 'matching',
  MULTI_APPLY: 'multi_apply',
  PROFILE_COMPLETION: 'profile_completion',
  PLATFORM: 'platform'
});

/**
 * Concise, verified system-prompt knowledge block injected for all HirePool turns.
 */
export const HIREPOOL_GROUNDED_KNOWLEDGE_PROMPT = `[VERIFIED HIREPOOL PLATFORM CAPABILITIES]
- Official site & contact: ${HIREPOOL_PUBLIC_URLS.home} | Features: ${HIREPOOL_PUBLIC_URLS.features} | Pricing: ${HIREPOOL_PUBLIC_URLS.pricing} | Privacy Policy: ${HIREPOOL_PUBLIC_URLS.privacy} | Terms of Service: ${HIREPOOL_PUBLIC_URLS.terms} | Contact email: ${HIREPOOL_PUBLIC_URLS.email}.
- Accounts & Roles: HirePool supports three account types — Candidates (job seekers), Companies / Employers (hiring & posting jobs), and Consultancies / Agencies (staffing partners managing bench candidates & placements).
- Freshers & Experience Levels: Supported. Candidate profiles support 0+ years of experience (0–50), and jobs span entry-level (suitable for freshers and recent graduates where employers post entry roles), mid, senior, lead, and executive roles.
- Work Modes & Job Types: Job search supports filtering by remote, hybrid, and onsite work modes, as well as full-time, contract, and contract-to-hire employment types, skills, locations, experience level, and salary range.
- AI Job Matching: Evaluates candidate profile skills, experience, location, work preferences, and education against job requirements to generate match scores once signed in with a completed profile.
- Applying to Multiple Jobs: Candidates can apply to multiple different active openings using one profile; duplicate applications to the same job are prevented.
- Profile Completion: Completed right after email verification during signup or updated anytime once signed in (e.g., name/company/agency, location, title/industry, experience, and skills).

[VERIFIED HIREPOOL PRICING & PLANS (${HIREPOOL_PUBLIC_URLS.pricing})]
- Candidates (For Job Seekers): Free forever — includes unlimited job applications, AI-powered job matching, AI video interviews, real-time application tracking, resume parsing & optimization, and push notifications.
- Companies (For Employers): Custom / "Contact Us" plans based on active jobs and users, starting with a 14-day free trial with full feature access (no credit card required). Includes unlimited job postings, AI candidate screening, video interviews & assessments, analytics dashboard, team collaboration, ATS integrations, and priority support.
- Consultancies (For Staffing Agencies): Custom / "Contact Us" plans covering bulk candidate management, multi-client dashboard, automated matching, placement tracking, revenue analytics, white-label options, and a dedicated account manager.
- Enterprise, Cancellation & Payment: Custom enterprise plans are available via sales (${HIREPOOL_PUBLIC_URLS.email} / ${HIREPOOL_PUBLIC_URLS.pricing}). Paid subscriptions can be cancelled anytime with no cancellation fees (active until the end of the billing period). Accepted payments: major credit cards, bank transfers, and purchase orders for enterprise customers.

[VERIFIED HIREPOOL PRIVACY POLICY (${HIREPOOL_PUBLIC_URLS.privacy}, Updated March 2026)]
- Personal info collected: Contact info (name, email, phone), professional details (resume, work history, skills, education), credentials, company details, AI interview video recordings, and assessment responses/results.
- Automatic data collected: Browser/device info, IP/location data, usage analytics, and cookies/similar tracking technologies.
- How it is used & shared: Used to provide and improve HirePool, match candidates to jobs, evaluate AI interviews, support recruiter communication and notifications, prevent fraud, and meet legal obligations. Shared with potential employers, authorized staffing consultancies, service providers, or when required by law/business transfers.
- Security, Retention & Rights: Encryption in transit and at rest, access controls/authentication, security audits, and staff training. Candidate profiles and application data are typically retained for 2 years after last activity before anonymization or deletion. Users can request access, correction, deletion, restriction/objection, portability, or withdraw consent; platform is not intended for users under 18. Privacy inquiries: ${HIREPOOL_PUBLIC_URLS.email}.

[VERIFIED HIREPOOL TERMS OF SERVICE (${HIREPOOL_PUBLIC_URLS.terms}, Updated March 2026)]
- Covers acceptance of Terms, AI recruitment platform scope, account registration/security across Candidates/Recruiters/Consultancies, acceptable conduct (accurate info; no unauthorized scraping, spam, tampering, or unlawful use), and IP (users retain ownership of their resumes/profiles while granting HirePool a license to operate the service).
- AI Features Disclosure: AI match recommendations and interview evaluations are assistive suggestions, not guarantees; human recruiters make final hiring decisions.
- Subscriptions & Legal: Paid plans auto-renew unless cancelled prior to renewal. Users can delete their account via settings. Provided "as is" / "as available" without guaranteed employment or hiring outcomes; governed by the laws of Singapore with disputes resolved via good-faith negotiation or binding arbitration in Singapore. Legal inquiries: ${HIREPOOL_PUBLIC_URLS.email}.

[GROUNDING & BOUNDARY RULES]
- Pricing, subscriptions, free trials, Privacy Policy, Terms of Service, freshers/entry-level support, experienced roles, remote/hybrid/onsite jobs, AI matching, and role capabilities are ALL IN-SCOPE HirePool questions — answer them directly and accurately using ONLY the verified facts above.
- NEVER emit fake credentials, private account data, or unverified live job listings when unauthenticated.`;

/**
 * Identify a primary public HirePool FAQ topic for grounded fallback recovery.
 *
 * @param {string} message
 * @returns {string|null}
 */
export function detectHirePoolPublicTopic(message) {
  const text = String(message || '').replace(/[\u2018\u2019]/g, "'").trim();
  if (!text) return null;

  if (/\b(?:privacy(?:\s+policy)?|data\s+(?:protection|privacy|retention|sharing)|cookies?|gdpr|how\s+(?:does|do)\s+(?:hirepool|you)\s+(?:use|store|protect|handle|retain)\s+(?:my\s+)?(?:data|personal\s+information))\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.PRIVACY;
  }

  if (/\b(?:terms\s+of\s+(?:service|use)|tos|terms\s+and\s+conditions|user\s+agreement|governing\s+law|legal\s+terms)\b/i.test(text) ||
      /^\s*terms\.?\s*$/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.TERMS;
  }

  if (/\b(?:pricing|prices?|cost|plans?|subscriptions?|billing|free\s+trial|payment\s+methods?|cancel\s+(?:my\s+)?subscription|is\s+(?:hirepool|it|this(?:\s+platform)?)\s+free)\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.PRICING;
  }

  if (/\b(?:freshers?|fresh\s+graduates?|entry[\s-]*level|zero\s+experience|0\s+years)\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.FRESHERS;
  }

  if (/\b(?:remote|hybrid|onsite|on[\s-]*site|work\s+from\s+home)\b/i.test(text) &&
      !/\bmy\s+(?:matching|applied|saved)\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.WORK_MODES;
  }

  if (/\b(?:experienced(?:\s+professionals?)?|mid[\s-]*level|senior|lead|executive)\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.EXPERIENCED;
  }

  if (/\b(?:how\s+(?:does|do)\s+(?:ai\s+)?(?:job\s+)?matching\s+work|ai\s+(?:job\s+)?matching)\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.MATCHING;
  }

  if (/\b(?:can\s+i|how\s+(?:do|can)\s+i)\s+apply(?:\s+for|\s+to)?\s+multiple\s+jobs\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.MULTI_APPLY;
  }

  if (/\bhow\s+(?:do|can|should|to)\s+(?:i\s+)?(?:complete|finish|fill(?:\s+out)?|update|improve|build)\s+(?:a\s+|an\s+|my\s+)?(?:candidate\s+|company\s+|consultancy\s+)?profile\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.PROFILE_COMPLETION;
  }

  if (/\b(?:what(?:'s| is)\s+hirepool|how\s+(?:does|do)\s+hirepool\s+work|what\s+can\s+you\s+do|what\s+features)\b/i.test(text)) {
    return HIREPOOL_PUBLIC_TOPICS.PLATFORM;
  }

  return null;
}

/**
 * Return a verified, concise Markdown response for an in-scope HirePool FAQ topic
 * if a language model erroneously refuses an in-scope informational question.
 *
 * @param {string|null} topic
 * @returns {string|null}
 */
export function getHirePoolGroundedFaqResponse(topic) {
  switch (topic) {
    case HIREPOOL_PUBLIC_TOPICS.PRICING:
      return [
        '## HirePool Pricing & Plans',
        '- **Candidates (Job Seekers):** **Free forever** — includes unlimited job applications, AI-powered job matching, AI video interviews, real-time application tracking, resume parsing & optimization, and push notifications.',
        '- **Companies (Employers):** Custom **Contact Us** plans based on hiring needs, active job postings, and users — starting with a **14-day free trial** with full access and no credit card required.',
        '- **Consultancies (Staffing Agencies):** Custom **Contact Us** plans including bulk candidate management, multi-client dashboard, automated matching, placement tracking, revenue analytics, white-label options, and a dedicated account manager.',
        '- **Enterprise, Billing & Cancellation:** Custom enterprise plans are available, subscriptions can be cancelled anytime with no cancellation fees (active through the end of the billing period), and payments support major credit cards, bank transfers, and purchase orders for enterprise customers.',
        '',
        `See full pricing details at ${HIREPOOL_PUBLIC_URLS.pricing} or contact ${HIREPOOL_PUBLIC_URLS.email}.`
      ].join('\n');

    case HIREPOOL_PUBLIC_TOPICS.PRIVACY:
      return [
        `## HirePool Privacy Policy Summary (${HIREPOOL_PUBLIC_URLS.privacy})`,
        '- **Information Collected:** Personal details you provide (name, email, phone, resume, work history, skills, education, credentials, company details, AI interview video recordings, and assessment responses) plus automatic technical data (browser/device info, IP/location data, usage analytics, and cookies).',
        '- **How Data Is Used & Shared:** Used for job matching, evaluating AI interview responses, recruiter messaging, application notifications, service improvement, fraud prevention, and legal compliance. Shared with potential employers, authorized consultancies, service providers, or when required by law.',
        '- **Security & Retention:** Protected with encryption in transit and at rest, access controls, and regular security audits. Candidate profiles and application data are typically retained for **2 years** after last activity before anonymization or deletion.',
        '- **Your Rights & Age Policy:** You can request access, correction, deletion, restriction, portability, or withdraw consent. HirePool is not intended for individuals under 18.',
        '',
        `Read the full Privacy Policy (updated March 2026) at ${HIREPOOL_PUBLIC_URLS.privacy} or email ${HIREPOOL_PUBLIC_URLS.email}.`
      ].join('\n');

    case HIREPOOL_PUBLIC_TOPICS.TERMS:
      return [
        `## HirePool Terms of Service Summary (${HIREPOOL_PUBLIC_URLS.terms})`,
        '- **Platform & Accounts:** Covers use of HirePool across Candidate, Recruiter/Company, and Consultancy accounts. Users must provide accurate information and safeguard credentials, and must not scrape data, tamper with systems, spam, or act unlawfully.',
        '- **Content & Intellectual Property:** You keep ownership of submitted resumes and profiles while granting HirePool a license to store and display them to operate the service.',
        '- **AI Features:** AI-generated job recommendations and interview evaluations are advisory suggestions — human recruiters make final hiring decisions, and HirePool does not guarantee employment or hires.',
        '- **Subscriptions & Legal:** Paid plans renew automatically unless cancelled prior to the renewal date, and accounts can be deleted anytime via settings. Governed by the laws of **Singapore**, with disputes resolved through negotiation or binding arbitration in Singapore.',
        '',
        `Read the full Terms of Service (updated March 2026) at ${HIREPOOL_PUBLIC_URLS.terms} or contact ${HIREPOOL_PUBLIC_URLS.email}.`
      ].join('\n');

    case HIREPOOL_PUBLIC_TOPICS.FRESHERS:
      return 'Yes — **HirePool supports freshers and entry-level candidates**. Candidate profiles allow **0+ years of experience**, and HirePool job listings include an **entry** experience level alongside mid, senior, lead, and executive roles (depending on active employer openings).';

    case HIREPOOL_PUBLIC_TOPICS.WORK_MODES:
      return 'Yes — you can search active HirePool openings filtered by work mode (**remote**, **hybrid**, and **onsite**), employment type (**full-time**, **contract**, and **contract-to-hire**), skills, locations, experience level, and salary range.';

    case HIREPOOL_PUBLIC_TOPICS.EXPERIENCED:
      return 'Yes — **HirePool supports experienced professionals** across **mid**, **senior**, **lead**, and **executive** experience levels, in addition to entry-level roles. Once signed in, AI matching evaluates your experience, skills, and preferences against active openings.';

    case HIREPOOL_PUBLIC_TOPICS.MATCHING:
      return 'HirePool’s **AI job matching** evaluates your candidate profile — including skills, years of experience, location, education, and work preferences — against active job requirements to generate match scores once you are signed in with a completed profile.';

    case HIREPOOL_PUBLIC_TOPICS.MULTI_APPLY:
      return 'Yes — once signed in with your HirePool candidate profile, you can apply to **multiple different active jobs** without re-entering your profile details (duplicate applications to the same job are prevented).';

    case HIREPOOL_PUBLIC_TOPICS.PROFILE_COMPLETION:
      return [
        'You can complete your **HirePool** profile right after email verification during signup, or update it anytime from **My Profile** (or here in chat once signed in):',
        '- **Candidate profile:** Fill in your **Name**, **Phone**, **Location**, **Job Title**, **Years of Experience**, **Skills**, **Professional Summary**, **Education**, and **Work Experience** (you can also upload a PDF resume when signed in as a candidate).',
        '- **Company / Consultancy profile:** Add your organization name, industry, location, and contact details during onboarding or profile settings.'
      ].join('\n');

    case HIREPOOL_PUBLIC_TOPICS.PLATFORM:
      return `**HirePool** (${HIREPOOL_PUBLIC_URLS.home}) is an AI-powered talent acquisition platform connecting **Candidates** (free forever), **Companies / Employers**, and **Consultancies / Staffing Agencies** with smart job matching, AI video interviews, screening assessments, resume parsing, and real-time application tracking.`;

    default:
      return null;
  }
}
