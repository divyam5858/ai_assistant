/**
 * HirePool Domain Restriction & Classification Policy
 *
 * Enforces strict domain boundaries for the HirePool conversational AI assistant.
 * Prevents the assistant from acting as a general-purpose chatbot or answering
 * arbitrary questions outside of HirePool's operational and recruitment domain.
 */

import { detectHirePoolPublicTopic, HIREPOOL_PUBLIC_TOPICS } from './knowledge-base.js';
import { isHirePoolProfileEditRequest } from './candidate-profile-edit.js';

export const HIREPOOL_DOMAIN_CATEGORIES = Object.freeze({
  HIREPOOL_IN_SCOPE: 'HIREPOOL_IN_SCOPE',
  CAREER_RELATED: 'CAREER_RELATED',
  PRODUCT_COMPARISON: 'PRODUCT_COMPARISON',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  AMBIGUOUS: 'AMBIGUOUS'
});

export const HIREPOOL_INTENT_CATEGORIES = Object.freeze({
  PLATFORM_INFO: 'PLATFORM_INFO',
  JOB_DISCOVERY: 'JOB_DISCOVERY',
  CANDIDATE_ONBOARDING: 'CANDIDATE_ONBOARDING',
  PRICING_SUBSCRIPTIONS: 'PRICING_SUBSCRIPTIONS',
  PRIVACY_LEGAL: 'PRIVACY_LEGAL',
  ACCOUNT_OPERATIONS: 'ACCOUNT_OPERATIONS',
  ACCOUNT_LOGOUT: 'ACCOUNT_LOGOUT',
  PROFILE_EDIT: 'PROFILE_EDIT',
  CAREER_RELATED: 'CAREER_RELATED',
  PRODUCT_COMPARISON: 'PRODUCT_COMPARISON',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  AMBIGUOUS: 'AMBIGUOUS'
});

/**
 * Detect explicit user requests to log out / sign out of their HirePool session.
 * Excludes informational how-to questions ("How do I log out?", "Can I sign out?").
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isHirePoolLogoutRequest(message) {
  const text = normalizeTypography(message).replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (
    /^\s*(?:how\s+(?:do|can|would|should)\s+(?:i|we|a\s+user|someone)|where\s+(?:is|can\s+i\s+find)|can\s+i|what\s+happens\s+(?:when|if)\s+i)\b.*\b(?:log\s*out|logout|sign\s*out|signout)\b/i.test(
      text
    )
  ) {
    return false;
  }
  return (
    /^\s*(?:please\s+)?(?:log\s*out|logout|sign\s*out|signout|log\s+me\s+out|sign\s+me\s+out|exit\s+(?:my\s+)?(?:hirepool\s+)?account)(?:\s+(?:of|from)\s+(?:hirepool|my\s+account))?\s*[.!?]*\s*$/i.test(
      text
    ) ||
    /\b(?:i\s+(?:want|would\s+like|'d\s+like|need)\s+to\s+(?:log\s*out|logout|sign\s*out|signout|log\s+out\s+of\s+hirepool|sign\s+out\s+of\s+hirepool|exit\s+my\s+account)|(?:please|can\s+you|could\s+you|help\s+me)\s+(?:log\s*out|logout|sign\s*out|signout|log\s+me\s+out|sign\s+me\s+out))\b/i.test(
      text
    )
  );
}

function normalizeTypography(text) {
  return String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

export const HIREPOOL_OUT_OF_SCOPE_RESPONSE =
  "I'm your HirePool assistant. I can help you with matching jobs, job applications, candidate profiles, recruitment, job postings and other HirePool services. I can't answer general questions outside the HirePool platform.";

export const HIREPOOL_COMPETITOR_POLICY_RESPONSE =
  "I cannot provide ratings or reviews for external job platforms. On HirePool, I can help you with matching jobs, job applications, candidate profiles, recruitment, and job postings.";

export const HIREPOOL_PRODUCT_COMPARISON_RESPONSE =
  "While I cannot provide ratings or reviews for external job platforms like Naukri, here is what distinguishes HirePool:\n\n- **AI-Powered Matching:** Evaluates candidate skills, experience, and preferences against active job requirements for ranked match scores.\n- **Direct Recruitment Across Three Roles:** Dedicated workspaces for **Candidates** (free forever), **Employers / Companies** (direct hiring, screening, and AI video interviews), and **Consultancies / Staffing Agencies** (talent bench and placement tracking).\n- **Transparent Application Tracking:** Real-time visibility into application stages without duplicate submissions.\n\nLet me know if you would like to explore jobs, learn about our hiring features, or create an account!";

export const HIREPOOL_AMBIGUOUS_CLARIFICATION_RESPONSE =
  "Could you please clarify what you'd like assistance with? I can help you with HirePool job matching, applications, candidate profiles, or employer hiring workflows.";

// Competitor identifiers
const COMPETITOR_KEYWORDS = [
  'naukri',
  'linkedin',
  'indeed',
  'monster',
  'glassdoor',
  'foundit',
  'shine',
  'ziprecruiter',
  'careerbuilder',
  'wellfound',
  'angellist',
  'hired',
  'timesjobs',
  'upwork',
  'fiverr'
];

const COMPETITOR_PATTERN = new RegExp(`\\b(?:${COMPETITOR_KEYWORDS.join('|')})\\b`, 'i');

// Prompt injection & jailbreak patterns
const PROMPT_INJECTION_PATTERNS = [
  /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+)?(?:previous|prior|system|above|any)?\s*(?:instructions|rules|prompts|guidelines|restrictions|constraints)\b/i,
  /\b(?:you are now|act as|pretend to be|roleplay as|switch to)\s+(?:a\s+)?(?:general|unrestricted|dan|chatgpt|generic|jailbroken|normal AI|helpful assistant)\b/i,
  /\b(?:system override|developer mode|god mode|jailbreak)\b/i,
  /\b(?:answer (?:anything|any question|general questions|whatever I ask))\b/i
];

// General out-of-scope patterns (world knowledge, trivia, politics, entertainment, leisure)
const OUT_OF_SCOPE_PATTERNS = [
  // Political figures, governments, national leaders
  /\b(?:prime minister|president|chief minister|narendra modi|biden|trump|putin|parliament|election|who rules|monarchy)\b/i,
  // National symbols, geography, trivia
  /\b(?:national animal|national bird|national flower|national anthem|national flag|national sport|national fruit)\b/i,
  /\b(?:capital of|currency of|population of|highest mountain|longest river|deepest ocean|speed of light)\b/i,
  // Jokes, riddles, entertainment, creative fiction
  /\b(?:tell (?:me )?(?:a )?joke|make me laugh|tell (?:a )?riddle|tell (?:a )?story|write (?:a )?poem|write (?:a )?song)\b/i,
  /\b(?:movie|actor|actress|celebrity|box office|cinema|hollywood|bollywood)\b/i,
  // Sports & events
  /\b(?:cricket|football|world cup|olympics|fifa|ipl|tennis|basketball|match score)\b/i,
  // Restaurants, food, cooking
  /\b(?:rate (?:a |this |the )?restaurant|best restaurant|where to eat|recipe for|how to cook|how to bake|make pizza|make burger)\b/i,
  // Unrelated science & math
  /\b(?:quantum physics|black holes?|photosynthesis|theory of relativity|big bang|solar system|planets)\b/i,
  /\b(?:solve (?:this )?math|calculate \d+|\d+\s*[\+\*\/]\s*\d+)\b/i,
  /\b(?:how to make a game|snake game in python|flappy bird|tic tac toe)\b/i
];

// Career-related patterns
const CAREER_RELATED_PATTERNS = [
  /\b(?:actively\s+looking(?:\s+for\s+(?:a\s+)?(?:job|work|role|position|opportunities))?|looking for (?:a )?job|seeking (?:a )?job|unemployed and looking|job hunting|job search tips)\b/i,
  /\b(?:\d+\+?\s+years?(?:\s+of)?\s+experience)\b/i,
  /\b(?:improve|optimize|enhance|review|format)\s+(?:my\s+)?(?:.*?\s+)?(?:resume|cv|curriculum vitae)\b/i,
  /\b(?:interview (?:prep|preparation|questions|tips|guidance)|prepare for (?:an? )?interview)\b/i,
  /\b(?:skills? (?:required|needed|essential|demanded) (?:for|in)|what skills? (?:do i need|should i learn|are required))\b/i,
  /\b(?:salary negotiation|career advice|career guidance|how to transition to)\b/i
];

// HirePool in-scope patterns
const HIREPOOL_IN_SCOPE_PATTERNS = [
  // Candidate list inquiry across employers/consultancies (also covers "my candidates",
  // "give the list of candidates", "show candidates", "list candidates")
  /\b(?:have\s+(?:a\s+)?list\s+of\s+candidates|list\s+of\s+candidates|give\s+(?:me\s+)?(?:the\s+)?(?:list\s+of\s+)?candidates?|my\s+candidates?|show\s+candidates?|list\s+candidates?|view\s+candidates?|check\s+candidates?|our\s+candidates?|bench\s+candidates?)\b/i,
  // Jobs & matching (including public capability discovery, work modes & experience levels)
  /\b(?:find|search|match|recommend|show|get|list|explore|browse|filter|check|view|looking\s+for|look\s+for|are\s+there|do\s+you\s+have|have|offer|support)\b(?:\s+for)?\s+(?:[a-z0-9-]+\s+){0,3}(?:jobs?|openings?|vacancies|roles?|positions?|opportunities?|candidates?)\b/i,
  /\b(?:types?|kinds?|categories)\s+of\s+(?:jobs?|roles?|positions?|opportunities?|employment|work)\b/i,
  /\b(?:remote|hybrid|onsite|on[\s-]*site|full[\s-]*time|part[\s-]*time|contract(?:[\s-]*to[\s-]*hire)?|fresher|freshers|fresh\s+graduates?|entry[\s-]*level|experienced(?:\s+professionals?)?|mid[\s-]*level|senior|lead|executive)\b.*\b(?:jobs?|roles?|positions?|openings?|opportunities?|candidates?|work|hirepool|support(?:ed)?|available)\b/i,
  /\b(?:do\s+you\s+(?:support|have|offer|allow|accept)|does\s+(?:hirepool|this(?:\s+platform)?)\s+(?:support|have|offer|allow|accept)|are\s+(?:there|freshers?|graduates?|remote|hybrid|contract))\b.*\b(?:freshers?|fresh\s+graduates?|entry[\s-]*level|experienced(?:\s+professionals?)?|remote|hybrid|onsite|contract(?:[\s-]*to[\s-]*hire)?|full[\s-]*time|candidates?|employers?|companies|consultanc(?:y|ies)|agencies)\b/i,
  /\b(?:support|jobs?|roles?|opportunities?)\s+(?:for\s+)?(?:freshers?|fresh\s+graduates?|entry[\s-]*level|experienced(?:\s+professionals?)?)\b/i,
  /\b(?:matching jobs|job matches|job listings?|active jobs?|search jobs?|ai\s+(?:job\s+)?matching|matching\s+(?:work|works|score|algorithm)|how\s+(?:does|do)\s+(?:hirepool|ai\s+(?:job\s+)?matching|job\s+matching|matching)\s+work)\b/i,
  // Profiles
  /\b(?:show|view|edit|update|add|improve|complete|finish|fill\s+out|set\s+up|write|draft|help\s+me\s+write|check|replace|remove|delete|what\s+(?:information|info|details|fields?)\s+(?:is|are)\s+missing(?:\s+(?:on|in|from))?)\s+(?:a\s+|an\s+|the\s+|my\s+|our\s+)?(?:candidate\s+|company\s+|client\s+|employer\s+|consultancy\s+|agency\s+|personal\s+|user\s+)?(?:profile|skills?|work\s*experience|experience|education(?:al)?(?:\s+details)?|degree|graduation(?:\s+details)?|professional\s+summary|summary|previous\s+company|employment(?:\s+details)?|contact\s+info|certifications?|certificates?|preferences?|expected\s+salary|notice\s+period|phone(?:\s+number)?|job\s+title|designation|gstin|gst_tax_id|company_size|consultancy_type|industry_specialization|headquarters|linkedin|github|portfolio)\b/i,
  /\b(?:my\s+profile|candidate\s+profile|company\s+profile|client\s+profile|consultancy\s+profile|agency\s+profile|personal\s+profile|profile\s+details|edit\s+my\s+profile|update\s+my\s+profile|improve\s+my\s+profile|update\s+profile|complete\s+profile|profile\s+completion|my\s+skills|add\s+education|add\s+work\s+experience|add\s+professional\s+summary|add\s+a\s+degree|add\s+graduation\s+details|add\s+certifications?)\b/i,
  /\b(?:add|edit|update|remove|delete)\s+(?:b\.?\s*e\.?|b\.?\s*tech|m\.?\s*tech|b\.?\s*sc|m\.?\s*sc|bachelor(?:'s)?|master(?:'s)?|mba|phd|diploma)\b/i,
  // Applications, offers & followups
  /\b(?:show|view|my|check|list)\s+(?:my\s+)?(?:job\s+)?(?:applications?|off(?:er|re)s?)\b/i,
  /\b(?:my\s+off(?:er|re)s?|job\s+offers?|any\s+offers?|check\s+(?:my\s+)?off(?:er|re)s?|off(?:er|re)s?\s+received|view\s+off(?:er|re)s?|show\s+off(?:er|re)s?|do\s+i\s+have\s+(?:any\s+)?off(?:er|re)s?)\b/i,
  /\b(?:my applications|application status|applied jobs?|withdraw application|apply for (?:a|this|the|that) job|apply(?:\s+for|\s+to)?\s+multiple\s+jobs?)\b/i,
  /\b(?:apply|apply for|apply to)\b/i,
  /\b(?:the first (?:one|job)?|the second (?:one|job)?|the third (?:one|job)?|first one|second one|third one)\b/i,
  // Screening & assessments
  /\b(?:screening questions?|screening eligibility|assessment status|interview status)\b/i,
  // Resume
  /\b(?:upload(?:ing)? resume|parse resume|view resume|download resume|show resume|my resume pdf|attached resume)\b/i,
  // Client & Consultancy workflows
  /\b(?:post (?:a )?job|create (?:a )?(?:new )?job|my company profile|company jobs|client jobs|review applicants?|hiring dashboard|job applicants?|(?:client\s+|company\s+|employer\s+|hiring\s+)?dashboard(?:\s+stats|\s+statistics)?|dashboard\s+stats?|hiring\s+pipeline|pipeline\s+stats?)\b/i,
  /\b(?:candidate pool|bench candidates?|(?:add|create|register|onboard)\s+(?:a\s+)?(?:new\s+)?candidate|place (?:a )?candidate|submit\s+(?:a\s+)?candidate|submit\s+[A-Za-z\s.'-]+?\s+(?:for|to)|candidate\s+submission|consultancy profile|agency profile|placement stats|bench pool)\b/i,
  /\bhow\s+(?:do|can)\s+(?:candidates?|employers?|companies|clients?|consultanc(?:y|ies)|agencies)\s+(?:use|find|hire|post|apply|manage|search|work)\b/i,
  // Pricing, trials, subscriptions & candidate cost (with or without explicit "HirePool" mention)
  /\b(?:is\s+(?:hirepool|it|this(?:\s+platform)?)\s+free(?:\s+for\s+(?:candidates?|job\s*seekers?|employers?|companies))?|free\s+for\s+(?:candidates?|job\s*seekers?))\b/i,
  /\b(?:pricing|prices?|cost|plans?|subscriptions?|billing|free\s+trial|enterprise\s+plan|payment\s+methods?|cancel(?:lation)?\s+(?:fee|policy|subscription))\b/i,
  // Privacy Policy, Terms of Service & legal
  /\b(?:privacy(?:\s+policy)?|terms\s+of\s+(?:service|use)|terms\s+and\s+conditions|user\s+agreement|data\s+(?:protection|privacy|retention|sharing|security)|cookie(?:\s+policy|s)?|gdpr|governing\s+law|legal\s+terms)\b/i,
  // Public job discovery & capabilities even without "do you support" wrapper
  /\b(?:freshers?|fresh\s+graduates?|entry[\s-]*level|experienced\s+professionals?|remote\s+(?:jobs?|roles?|work|positions?)|hybrid\s+(?:jobs?|roles?|work|positions?)|onsite\s+(?:jobs?|roles?|positions?)|contract\s+(?:jobs?|roles?|positions?)|ai\s+(?:video\s+)?interviews?|ai\s+matching)\b/i,
  // Platform, Auth & accounts
  /\bhirepool\b/i,
  /\b(?:login|log(?:\s+me)?\s*in|logged[\s-]*in|loggedin|sign(?:\s+me)?\s*in|signed[\s-]*in|sign(?:\s+(?:me|us))?\s*up|signup|register|registration|user agreement|terms|onboarding|logout|log\s*out|log\s+me\s+out|sign\s*out|signout|sign\s+me\s+out|exit\s+(?:my\s+)?account)\b/i,
  /\b(?:my account|which account|user account|candidate account|client account|consultancy account|account details|account status)\b/i,
  // First-time visitor orientation, capabilities & natural signup intents
  /\b(?:i(?:'m| am)\s+new(?:\s+to\s+hirepool|\s+here)?|new\s+to\s+hirepool|help\s+me\s+get\s+started|get\s+started)\b/i,
  /\b(?:(?:don'?t|do\s+not|haven'?t|have\s+not)\s+(?:got\s+)?(?:have\s+)?(?:an?\s+)?(?:hirepool\s+)?account(?:\s+yet)?|no\s+(?:hirepool\s+)?account(?:\s+yet)?|need\s+(?:an?\s+)?(?:hirepool\s+)?account|want\s+to\s+join|would\s+like\s+to\s+join|like\s+to\s+join|join\s+hirepool)\b/i,
  /\b(?:what\s+can\s+you\s+do(?:\s+for\s+me)?|how\s+can\s+you\s+help(?:\s+me)?|what(?:'s| is)\s+hirepool(?:\s+about)?)\b/i,
  /\b(?:looking\s+for\s+(?:a\s+)?job|job\s+opportunities|want\s+to\s+find\s+(?:a\s+)?job)\b/i,
  /\bhow\s+(?:do|can)\s+i\s+(?:sign\s*up|register|join|apply)\b/i
];

// Workflow and visitor/signup continuation patterns
const WORKFLOW_CONTINUATION_PATTERNS = [
  /\b(?:the first (?:one|job)?|the second (?:one|job)?|the third (?:one|job)?|first one|second one|third one)\b/i,
  /^\s*(?:#\s*)?(?:[1-5]|first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\s*[.!?]*\s*$/i,
  /\b(?:number|no\.?)\s*[1-5]\b/i,
  /\b(?:other|another|different|remaining)\b/i,
  /\b(?:apply|details|show details|continue|next|confirm|cancel|yes|no|proceed)\b/i,
  /\b(?:tell\s+me\s+more|show\s+me|more\s+info|go\s+ahead|okay|ok|sure|sounds\s+good)\b/i,
  /^\s*(?:candidate|job\s*seeker|company|client|employer|consultancy|agency|staffing|resend(?:\s+verification)?|check\s+verification|verify(?:\s+email)?|resume(?:\s+signup)?)\s*[.!?]*\s*$/i
];

function matchesActiveShortlist(text, session, options = {}) {
  const workflow = options.workflow || session?.hirePoolWorkflow;
  const jobs = Array.isArray(workflow?.shortlist) ? workflow.shortlist : [];
  if (jobs.length === 0) return false;
  if (/^(?:who|where|when|why)\s+(?:is|are|was|were)\b/i.test(text)) return false;
  const lower = text.toLowerCase();
  return jobs.some(job => {
    const company = typeof job?.company === 'string' ? job.company.trim().toLowerCase() : '';
    const title = typeof job?.title === 'string' ? job.title.trim().toLowerCase() : '';
    return (company.length >= 2 && lower.includes(company)) ||
      (title.length >= 3 && lower.includes(title));
  });
}

// Ambiguous query patterns (short phrases without context)
const AMBIGUOUS_PATTERNS = [
  /^(?:help(?: me)?\??|can you help(?: me)?\??|what do you think\??|tell me more\??|check status\??)[.!?]*$/i
];

/**
 * Check whether the session already has active HirePool context (workflow,
 * visitor state, signup state, or prior in-scope messages) so short follow-ups
 * can resolve contextually without weakening empty/out-of-scope ambiguity checks.
 *
 * @param {object|null|undefined} session
 * @param {object} [options]
 * @returns {boolean}
 */
export function hasInScopeSessionContext(session, options = {}) {
  const workflow = options.workflow || session?.hirePoolWorkflow;
  if (
    workflow?.selectedJob ||
    (Array.isArray(workflow?.shortlist) && workflow.shortlist.length > 0) ||
    (workflow?.stage && workflow.stage !== 'IDLE')
  ) {
    return true;
  }

  const profileEdit = session?.hirePoolProfileEdit;
  if (profileEdit?.active && !['completed', 'cancelled'].includes(profileEdit.stage)) {
    return true;
  }

  const jobCreate = session?.hirePoolJobCreate;
  if (jobCreate?.active && !['completed', 'cancelled'].includes(jobCreate.stage)) {
    return true;
  }

  if (options.signupState && options.signupState !== 'idle' && options.signupState !== 'cancelled') {
    return true;
  }

  const visitor = session?.hirePoolVisitor;
  if (visitor && visitor.authenticationStatus !== 'authenticated') {
    if (
      visitor.selectedRole ||
      visitor.pendingSignupAction ||
      visitor.activeContext ||
      (visitor.registrationIntent && visitor.registrationIntent !== 'none')
    ) {
      return true;
    }
  }

  const historyList = Array.isArray(options.history) ? options.history : [];
  for (let i = historyList.length - 1; i >= Math.max(0, historyList.length - 6); i -= 1) {
    const h = historyList[i];
    const hText = typeof h?.content === 'string' ? h.content : '';
    if (
      h?.role === 'assistant' &&
      /\b(?:which\s+\*{0,2}skills?|update\s+your\s+\*{0,2}(?:candidate|company|consultancy|personal)\s+profile|would\s+you\s+like\s+to\s+\*{0,2}add\*{0,2}.*\*{0,2}replace\*{0,2}|confirm\s*&\s*execute|share\s+the\s+\*{0,2}(?:education|work\s+experience|certification|preference|link|basic|company|consultancy))/i.test(hText)
    ) {
      return true;
    }
  }

  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    const category = msg.domainCategory || msg.scope;
    if (
      category === HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE ||
      category === HIREPOOL_DOMAIN_CATEGORIES.CAREER_RELATED
    ) {
      return true;
    }
  }

  return false;
}

function hasRecentProfileEditHistory(options = {}) {
  const historyList = Array.isArray(options?.history) ? options.history : [];
  for (let i = historyList.length - 1; i >= Math.max(0, historyList.length - 4); i -= 1) {
    const h = historyList[i];
    const hText = typeof h?.content === 'string' ? h.content : '';
    if (
      h?.role === 'assistant' &&
      /\b(?:which\s+\*{0,2}skills?|add\s+or\s+replace|would\s+you\s+like\s+to\s+\*{0,2}add\*{0,2}.*\*{0,2}replace\*{0,2}|confirm\s*&\s*execute|review\s+your\s+proposed\s+hirepool\s+.*\s+profile\s+update|share\s+(?:the\s+)?\*{0,2}(?:education|work\s+experience|certification|preference|link|basic|company|consultancy|personal)|create and publish a new job|Job Title recorded|Please provide a \*{0,2}Job Description|Job Description recorded)\b/i.test(hText)
    ) {
      return true;
    }
  }
  return false;
}

function resolveInScopeIntent(text, publicTopic, session = null) {
  if (isHirePoolLogoutRequest(text)) {
    return HIREPOOL_INTENT_CATEGORIES.ACCOUNT_LOGOUT;
  }
  const isSwitchIntent =
    /\b(?:my\s+off(?:er|re)s?|job\s+offers?|any\s+offers?|check\s+(?:my\s+)?off(?:er|re)s?|off(?:er|re)s?\s+received|view\s+off(?:er|re)s?|show\s+off(?:er|re)s?|do\s+i\s+have\s+(?:any\s+)?off(?:er|re)s?)\b/i.test(text) ||
    /\b(?:apply(?:\s+(?:for|to))?|matching\s+jobs?|job\s+applications?|my\s+applications?|search\s+(?:for\s+)?jobs?|find\s+jobs?)\b/i.test(text) ||
    /\b(?:(?:view|show|display|see|what(?:'s| is)\s+(?:on|in))\s+(?:my\s+)?profile|(?:my\s+)?dashboard)\b/i.test(text);

  if (isHirePoolProfileEditRequest(text) && !isSwitchIntent) {
    return HIREPOOL_INTENT_CATEGORIES.PROFILE_EDIT;
  }
  if (
    session?.hirePoolProfileEdit?.active &&
    !session?.hirePoolProfileEdit?.suspended &&
    !isSwitchIntent &&
    !['completed', 'cancelled'].includes(session.hirePoolProfileEdit.stage)
  ) {
    return HIREPOOL_INTENT_CATEGORIES.PROFILE_EDIT;
  }
  if (
    session?.hirePoolJobCreate?.active &&
    !['completed', 'cancelled'].includes(session.hirePoolJobCreate.stage)
  ) {
    return HIREPOOL_INTENT_CATEGORIES.ACCOUNT_OPERATIONS;
  }
  if (
    session?.consultancyCandidateDraft?.active ||
    session?.consultancySubmissionDraft?.active
  ) {
    return HIREPOOL_INTENT_CATEGORIES.ACCOUNT_OPERATIONS;
  }
  if (publicTopic === HIREPOOL_PUBLIC_TOPICS.PRICING) {
    return HIREPOOL_INTENT_CATEGORIES.PRICING_SUBSCRIPTIONS;
  }
  if (publicTopic === HIREPOOL_PUBLIC_TOPICS.PRIVACY || publicTopic === HIREPOOL_PUBLIC_TOPICS.TERMS) {
    return HIREPOOL_INTENT_CATEGORIES.PRIVACY_LEGAL;
  }
  if (/\b(?:sign(?:\s+(?:me|us))?\s*up|signup|register|registration|create\s+(?:an?\s+)?account|new\s+account|(?:don'?t|do\s+not|haven'?t|have\s+not)\s+(?:got\s+)?(?:have\s+)?(?:an?\s+)?(?:hirepool\s+)?account(?:\s+yet)?|no\s+(?:hirepool\s+)?account(?:\s+yet)?|want\s+to\s+join|would\s+like\s+to\s+join|join\s+hirepool|onboarding|verify\s+email|verification\s+link)\b/i.test(text)) {
    return HIREPOOL_INTENT_CATEGORIES.CANDIDATE_ONBOARDING;
  }
  if (/\b(?:my\s+(?:off(?:er|re)s?|applications?|application\s+status|profile|resume|assessments?|interviews?|account|jobs?)|view\s+my\s+(?:company\s+|consultancy\s+|personal\s+|candidate\s+)?profile|show\s+my\s+(?:company\s+|consultancy\s+|personal\s+|candidate\s+)?profile|my\s+applications?|apply\s+for\s+(?:a|this|the|that)|withdraw\s+application|candidate\s+pool|company\s+jobs|bench\s+candidates?|submissions?|(?:add|create|register|onboard)\s+(?:a\s+)?(?:new\s+)?candidate|submit\s+(?:a\s+)?candidate)\b/i.test(text)) {
    return HIREPOOL_INTENT_CATEGORIES.ACCOUNT_OPERATIONS;
  }
  if (
    [
      HIREPOOL_PUBLIC_TOPICS.FRESHERS,
      HIREPOOL_PUBLIC_TOPICS.WORK_MODES,
      HIREPOOL_PUBLIC_TOPICS.EXPERIENCED,
      HIREPOOL_PUBLIC_TOPICS.MATCHING,
      HIREPOOL_PUBLIC_TOPICS.MULTI_APPLY
    ].includes(publicTopic) ||
    /\b(?:jobs?|openings?|roles?|positions?|vacancies|opportunities?|matching|remote|hybrid|onsite|freshers?|experienced|skills?|apply)\b/i.test(text)
  ) {
    return HIREPOOL_INTENT_CATEGORIES.JOB_DISCOVERY;
  }
  return HIREPOOL_INTENT_CATEGORIES.PLATFORM_INFO;
}

/**
 * Classify a user message into one of the HirePool domain categories plus fine-grained intent.
 *
 * @param {string} message Incoming user query
 * @param {object} [session] Optional conversation session for workflow context
 * @param {object} [options]
 * @param {object} [options.authUser] Authenticated user credentials/identity
 * @param {object} [options.workflow] Candidate or client workflow state
 * @returns {{ category: string, intent: string, publicTopic: string|null, reason: string, suggestedResponse?: string }}
 */
export function classifyHirePoolMessage(message, session = null, options = {}) {
  const text = normalizeTypography(typeof message === 'string' ? message : '').trim();
  if (!text) {
    return {
      category: HIREPOOL_DOMAIN_CATEGORIES.AMBIGUOUS,
      intent: HIREPOOL_INTENT_CATEGORIES.AMBIGUOUS,
      publicTopic: null,
      reason: 'Empty message',
      suggestedResponse: HIREPOOL_AMBIGUOUS_CLARIFICATION_RESPONSE
    };
  }

  // Conversational Greeting Check
  const GREETING_PATTERN = /^\s*(?:hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening)|hi\s+hirepool|hello\s+hirepool)\b[.!?]*\s*$/i;
  if (GREETING_PATTERN.test(text)) {
    return {
      category: HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
      intent: HIREPOOL_INTENT_CATEGORIES.PLATFORM_INFO,
      publicTopic: null,
      reason: 'Standard conversational greeting',
      suggestedResponse: "Hello! I'm your HirePool assistant. I can help you explore matching jobs, review applications, update your profile, or guide you through employer hiring and candidate screening on HirePool. What can I help you with today?"
    };
  }

  // 1. Security Check: Prompt injection and jailbreak overrides
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        category: HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE,
        intent: HIREPOOL_INTENT_CATEGORIES.OUT_OF_SCOPE,
        publicTopic: null,
        reason: 'Detected prompt injection or instruction override attempt',
        suggestedResponse: HIREPOOL_OUT_OF_SCOPE_RESPONSE
      };
    }
  }

  const inProfileEditFlow = Boolean(
    (session?.hirePoolProfileEdit?.active &&
      !['completed', 'cancelled'].includes(session.hirePoolProfileEdit.stage)) ||
    hasRecentProfileEditHistory(options) ||
    isHirePoolProfileEditRequest(text) ||
    /\b(?:linkedin(?:_url|\s+url|\s+profile|\s+link)?\s*(?:to|as|is|=|:)|linkedin\.com\/(?:in|company)\/)/i.test(text)
  );
  const explicitComparisonCue = /\b(?:vs\.?|versus|better\s+than|compare|difference\s+between|rate|rating|review|how\s+good\s+is)\b/i.test(text);

  // 2. Product Comparison & Competitor Check
  if (COMPETITOR_PATTERN.test(text) && (!inProfileEditFlow || explicitComparisonCue)) {
    const isDirectRating = /\b(?:rate|rating|review|how good is|is .* good)\b/i.test(text);
    const isComparison = /\b(?:vs\.?|versus|or|better than|compare|difference between)\b/i.test(text);

    if (isDirectRating && !isComparison) {
      return {
        category: HIREPOOL_DOMAIN_CATEGORIES.PRODUCT_COMPARISON,
        intent: HIREPOOL_INTENT_CATEGORIES.PRODUCT_COMPARISON,
        publicTopic: null,
        reason: 'Competitor rating or review request',
        suggestedResponse: HIREPOOL_COMPETITOR_POLICY_RESPONSE
      };
    }

    return {
      category: HIREPOOL_DOMAIN_CATEGORIES.PRODUCT_COMPARISON,
      intent: HIREPOOL_INTENT_CATEGORIES.PRODUCT_COMPARISON,
      publicTopic: null,
      reason: 'Competitor comparison request',
      suggestedResponse: HIREPOOL_PRODUCT_COMPARISON_RESPONSE
    };
  }

  // 3. General Out-of-Scope Detection (World Knowledge, Trivia, Politics, Entertainment)
  for (const pattern of OUT_OF_SCOPE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        category: HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE,
        intent: HIREPOOL_INTENT_CATEGORIES.OUT_OF_SCOPE,
        publicTopic: null,
        reason: 'Unrelated general-purpose question outside HirePool domain',
        suggestedResponse: HIREPOOL_OUT_OF_SCOPE_RESPONSE
      };
    }
  }

  const hasActiveContext = hasInScopeSessionContext(session, options);
  const publicTopic = detectHirePoolPublicTopic(text);

  // 4. Workflow, Profile-Edit & Visitor Continuation Check (e.g. "1", "Acme Labs", "the first one", "show details", "continue", or institution/summary/skills/URL/numeric values during active profile edit / job creation)
  const isIntentSwitch =
    /\b(?:my\s+off(?:er|re)s?|job\s+offers?|any\s+offers?|check\s+(?:my\s+)?off(?:er|re)s?|off(?:er|re)s?\s+received|view\s+off(?:er|re)s?|show\s+off(?:er|re)s?|do\s+i\s+have\s+(?:any\s+)?off(?:er|re)s?)\b/i.test(text) ||
    /\b(?:apply(?:\s+(?:for|to))?|matching\s+jobs?|job\s+applications?|my\s+applications?|search\s+(?:for\s+)?jobs?|find\s+jobs?)\b/i.test(text) ||
    /\b(?:(?:view|show|display|see|what(?:'s| is)\s+(?:on|in))\s+(?:my\s+)?profile|(?:my\s+)?dashboard)\b/i.test(text);

  const inActiveProfileEdit = Boolean(
    session?.hirePoolProfileEdit?.active &&
    !session?.hirePoolProfileEdit?.suspended &&
    !['completed', 'cancelled'].includes(session.hirePoolProfileEdit.stage) &&
    !isIntentSwitch
  ) || (hasRecentProfileEditHistory(options) && !isIntentSwitch);
  const inActiveJobCreate = Boolean(
    session?.hirePoolJobCreate?.active &&
      !['completed', 'cancelled'].includes(session.hirePoolJobCreate.stage)
  );
  const generalKnowledgeQ = /^(?:who|what|where|when|why|how|which)\s+(?:is|are|was|were|do|does|did|can|will|should)\b/i;

  if ((inActiveProfileEdit || inActiveJobCreate) && !generalKnowledgeQ.test(text) && !isHirePoolLogoutRequest(text)) {
    return {
      category: HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
      intent: resolveInScopeIntent(text, publicTopic, session),
      publicTopic,
      reason: inActiveJobCreate ? 'Active HirePool job creation step continuation' : 'Active HirePool profile editing step continuation'
    };
  }

  if (isHirePoolLogoutRequest(text) || isHirePoolProfileEditRequest(text)) {
    return {
      category: HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
      intent: resolveInScopeIntent(text, publicTopic, session),
      publicTopic,
      reason: isHirePoolLogoutRequest(text) ? 'Explicit HirePool logout request' : 'HirePool profile editing request'
    };
  }

  if (hasActiveContext) {
    if (
      WORKFLOW_CONTINUATION_PATTERNS.some(pattern => pattern.test(text)) ||
      matchesActiveShortlist(text, session, options) ||
      /\b(?:add|replace|remove|delete|drop|use\s+that|looks\s+good)\b/i.test(text)
    ) {
      return {
        category: HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
        intent: resolveInScopeIntent(text, publicTopic, session),
        publicTopic,
        reason: 'Contextual continuation resolving against active HirePool session context'
      };
    }
  }

  // 5. Ambiguous Input Detection
  for (const pattern of AMBIGUOUS_PATTERNS) {
    if (pattern.test(text)) {
      return {
        category: HIREPOOL_DOMAIN_CATEGORIES.AMBIGUOUS,
        intent: HIREPOOL_INTENT_CATEGORIES.AMBIGUOUS,
        publicTopic: null,
        reason: 'Ambiguous request lacking HirePool context',
        suggestedResponse: HIREPOOL_AMBIGUOUS_CLARIFICATION_RESPONSE
      };
    }
  }

  // 6. Career-Related Guidance Check
  for (const pattern of CAREER_RELATED_PATTERNS) {
    if (pattern.test(text)) {
      return {
        category: HIREPOOL_DOMAIN_CATEGORIES.CAREER_RELATED,
        intent: HIREPOOL_INTENT_CATEGORIES.CAREER_RELATED,
        publicTopic,
        reason: 'Career and professional guidance relevant to HirePool recruitment'
      };
    }
  }

  // 7. HirePool Platform In-Scope Check
  for (const pattern of HIREPOOL_IN_SCOPE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        category: HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
        intent: resolveInScopeIntent(text, publicTopic),
        publicTopic,
        reason: 'Direct HirePool platform operation or data request'
      };
    }
  }

  // 8. Broad Semantic Analysis: Check for recruitment/employment/pricing/legal keywords vs general knowledge
  const recruitmentTerms = /\b(?:workplace|work\s+(?:mode|types?|experience|from\s+home)|open\s+to\s+work|hire|hiring|recruit(?:ing|er|ers|ment)?|candidates?|employers?|jobs?|positions?|roles?|salar(?:y|ies)|resumes?|cvs?|interviews?|applications?|applied|apply(?:ing)?|applicants?|skills?|careers?|office|compan(?:y|ies)|staffing|consultanc(?:y|ies)|agenc(?:y|ies)|bench|accounts?|onboard(?:ing)?|freshers?|fresh\s+graduates?|entry[\s-]*level|experienced(?:\s+professionals?)?|remote|hybrid|onsite|contract(?:[\s-]*to[\s-]*hire)?|full[\s-]*time|pricing|free\s+trial|plans?|subscriptions?|privacy(?:\s+policy)?|terms\s+of\s+service|user\s+agreement|data\s+retention|hirepool|dashboard|dashboards|pipeline|submit|submitting|submissions?|developers?|engineers?|programmers?|specialists?|architects?)\b/i;
  if (recruitmentTerms.test(text)) {
    return {
      category: HIREPOOL_DOMAIN_CATEGORIES.HIREPOOL_IN_SCOPE,
      intent: resolveInScopeIntent(text, publicTopic),
      publicTopic,
      reason: 'Semantically related to employment, recruitment, or HirePool platform policy'
    };
  }

  // 9. If text has a question structure on general knowledge (who is, what is, where is, how many)
  // and has zero relation to recruitment or HirePool, treat as OUT_OF_SCOPE
  const generalQuestionPattern = /^(?:who|what|where|when|why|how|which)\s+(?:is|are|was|were|do|does|did|can|will|should)\b/i;
  if (generalQuestionPattern.test(text)) {
    return {
      category: HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE,
      intent: HIREPOOL_INTENT_CATEGORIES.OUT_OF_SCOPE,
      publicTopic: null,
      reason: 'General knowledge question with no employment context',
      suggestedResponse: HIREPOOL_OUT_OF_SCOPE_RESPONSE
    };
  }

  // Default fallback: if very short and unrecognized — but exempt authenticated account
  // shorthand phrases like "my candidates", "my profile", "my dashboard" so they reach
  // the authenticated Consultancy / Client / Candidate handlers instead of returning an
  // ambiguous clarification response.
  const isAuthenticatedAccountShorthand =
    /^(?:my\s+(?:candidates?|bench|profile|dashboard|applications?|jobs?|submissions?|stats?|placements?|pool)|view\s+(?:my\s+)?(?:profile|dashboard)|list\s+(?:my\s+)?candidates?)$/i.test(text);
  if (text.split(/\s+/).length <= 2 && !isAuthenticatedAccountShorthand) {
    return {
      category: HIREPOOL_DOMAIN_CATEGORIES.AMBIGUOUS,
      intent: HIREPOOL_INTENT_CATEGORIES.AMBIGUOUS,
      publicTopic: null,
      reason: 'Unrecognized short phrase',
      suggestedResponse: HIREPOOL_AMBIGUOUS_CLARIFICATION_RESPONSE
    };
  }

  // If longer and completely unrelated to jobs/hiring, default to OUT_OF_SCOPE
  return {
    category: HIREPOOL_DOMAIN_CATEGORIES.OUT_OF_SCOPE,
    intent: HIREPOOL_INTENT_CATEGORIES.OUT_OF_SCOPE,
    publicTopic: null,
    reason: 'Unrelated to HirePool or recruitment domain',
    suggestedResponse: HIREPOOL_OUT_OF_SCOPE_RESPONSE
  };
}

export function classifyHirePoolIntent(message, session = null, options = {}) {
  return classifyHirePoolMessage(message, session, options);
}

/**
 * Determines whether a message is an out-of-scope response or query that should be
 * excluded from LLM prompt history to avoid context contamination.
 *
 * @param {object} message
 * @returns {boolean}
 */
export function isHirePoolOutOfScopeMessage(message) {
  if (!message || typeof message !== 'object') return false;
  if (message.isOutOfScope === true || message.scope === 'OUT_OF_SCOPE') return true;

  if (message.role === 'assistant' && typeof message.content === 'string') {
    if (
      message.content.includes("I'm your HirePool assistant. I can help you with matching jobs") ||
      message.content.includes("I can't answer general questions outside the HirePool platform")
    ) {
      return true;
    }
  }

  return false;
}
