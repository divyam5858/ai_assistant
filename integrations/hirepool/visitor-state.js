/**
 * HirePool Visitor & Conversation State Helpers
 *
 * Keeps visitor onboarding/signup conversation tracking strictly separate from
 * server-verified authentication status so unauthenticated visitors are never
 * locked out while protected account endpoints remain fail-closed.
 */

export const HIREPOOL_VISITOR_STATUSES = Object.freeze({
  NEW_VISITOR: 'new_visitor',
  RETURNING_VISITOR: 'returning_visitor',
  IN_SIGNUP: 'in_signup',
  AUTHENTICATED: 'authenticated'
});

export const HIREPOOL_AUTH_STATUSES = Object.freeze({
  UNAUTHENTICATED: 'unauthenticated',
  UNVERIFIED_CLAIM: 'unverified_claim',
  AUTHENTICATED: 'authenticated'
});

export const HIREPOOL_REGISTRATION_INTENTS = Object.freeze({
  NONE: 'none',
  EXPLORING: 'exploring',
  WANTS_SIGNUP: 'wants_signup',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
});

const VALID_ROLES = new Set(['candidate', 'client', 'consultancy']);

function normalizeVisitorText(message) {
  return String(message || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();
}

/**
 * Normalize role aliases (`employer`, `company`, `agency`, `staffing`) into
 * canonical HirePool role identifiers (`candidate`, `client`, `consultancy`).
 *
 * @param {string|null|undefined} rawRole
 * @returns {'candidate'|'client'|'consultancy'|null}
 */
export function normalizeHirePoolVisitorRole(rawRole) {
  if (!rawRole || typeof rawRole !== 'string') return null;
  const value = rawRole.trim().toLowerCase();
  if (!value) return null;
  if (value === 'candidate' || value === 'job seeker' || value === 'jobseeker' || value === 'applicant') {
    return 'candidate';
  }
  if (value === 'client' || value === 'company' || value === 'employer' || value === 'company_recruiter' || value === 'corporate_recruiter') {
    return 'client';
  }
  if (value === 'consultancy' || value === 'agency' || value === 'staffing' || value === 'agency_recruiter' || value === 'consultancy_recruiter') {
    return 'consultancy';
  }
  return VALID_ROLES.has(value) ? value : null;
}

/**
 * Ensure `session.hirePoolVisitor` exists with a complete structured shape.
 *
 * @param {object|null|undefined} session
 * @param {object} [options]
 * @param {boolean} [options.isAuthenticated=false]
 * @param {string|null} [options.authenticatedRole=null]
 * @returns {object|null}
 */
export function ensureHirePoolVisitorState(session, options = {}) {
  if (!session || typeof session !== 'object') return null;

  if (!session.hirePoolVisitor || typeof session.hirePoolVisitor !== 'object') {
    session.hirePoolVisitor = {
      visitorStatus: options.isAuthenticated
        ? HIREPOOL_VISITOR_STATUSES.AUTHENTICATED
        : HIREPOOL_VISITOR_STATUSES.NEW_VISITOR,
      authenticationStatus: options.isAuthenticated
        ? HIREPOOL_AUTH_STATUSES.AUTHENTICATED
        : HIREPOOL_AUTH_STATUSES.UNAUTHENTICATED,
      registrationIntent: options.isAuthenticated
        ? HIREPOOL_REGISTRATION_INTENTS.COMPLETED
        : HIREPOOL_REGISTRATION_INTENTS.NONE,
      selectedRole: normalizeHirePoolVisitorRole(options.authenticatedRole),
      pendingSignupAction: null,
      activeContext: null,
      lastOfferedAccountAction: null,
      loginCardOfferedCount: 0,
      signupCardOfferedCount: 0,
      unverifiedLoginClaim: false,
      protectedAccountPromptCount: 0,
      lastUpdatedAt: new Date().toISOString()
    };
  }

  return session.hirePoolVisitor;
}

/**
 * Reset unverified-visitor latches once server-verified authentication succeeds.
 *
 * @param {object|null|undefined} session
 * @param {string|null} [authenticatedRole=null]
 * @returns {object|null}
 */
export function resetHirePoolVisitorForVerifiedUser(session, authenticatedRole = null) {
  if (!session || typeof session !== 'object') return null;

  session.hirePoolLoginOffered = false;
  session.hirePoolAccountActionOffered = null;

  const visitor = ensureHirePoolVisitorState(session, {
    isAuthenticated: true,
    authenticatedRole
  });

  visitor.visitorStatus = HIREPOOL_VISITOR_STATUSES.AUTHENTICATED;
  visitor.authenticationStatus = HIREPOOL_AUTH_STATUSES.AUTHENTICATED;
  visitor.registrationIntent = HIREPOOL_REGISTRATION_INTENTS.COMPLETED;
  visitor.selectedRole = normalizeHirePoolVisitorRole(authenticatedRole) || visitor.selectedRole;
  visitor.pendingSignupAction = null;
  visitor.lastOfferedAccountAction = null;
  visitor.unverifiedLoginClaim = false;
  visitor.lastUpdatedAt = new Date().toISOString();

  return visitor;
}

/**
 * Extract an explicit HirePool registration role mentioned in a user message.
 *
 * @param {string} message
 * @returns {'candidate'|'client'|'consultancy'|null}
 */
export function extractHirePoolRegistrationRole(message) {
  const text = normalizeVisitorText(message);
  if (!text) return null;

  if (/\b(?:as\s+(?:a\s+)?candidate|candidate\s+(?:account|role|signup|sign\s*up|profile|onboarding)|join\s+as\s+(?:a\s+)?candidate|job\s*seeker)\b/i.test(text) ||
      /^\s*(?:candidate|job\s*seeker)\s*$/i.test(text)) {
    return 'candidate';
  }

  if (/\b(?:as\s+(?:a\s+)?(?:company|client|employer)|(?:company|client|employer)\s+(?:account|role|signup|sign\s*up|profile|onboarding)|join\s+as\s+(?:a\s+)?(?:company|client|employer)|for\s+(?:my|our)\s+company|hiring\s+for\s+(?:my|our)\s+company|company\s+recruiter|corporate\s+recruiter|direct\s+hire)\b/i.test(text) ||
      /^\s*(?:company|client|employer|for\s+(?:my|our)\s+company)\s*$/i.test(text)) {
    return 'client';
  }

  if (/\b(?:as\s+(?:a|an)\s+)?(?:consultancy|agency|staffing\s+agency|recruitment\s+(?:agency|firm))\b/i.test(text) ||
      /^\s*(?:consultancy|agency|staffing)\s*$/i.test(text)) {
    return 'consultancy';
  }

  return null;
}

/**
 * Detect when a guest claims to have already completed login outside verified session state.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isHirePoolLoginClaim(message) {
  return /^\s*(?:(?:ok(?:ay)?|done|yes|great|thanks|i(?:'m| am)|i have|i've|i just|already|successfully|login is|login was)\b[\s,!.:-]*){0,4}(?:logged[\s-]*in|signed[\s-]*in|authenticated|account connected|completed (?:the )?login|finished (?:the )?login|login (?:is |was )?(?:complete|completed|successful|succeeded))\b/i.test(
    normalizeVisitorText(message)
  );
}

/**
 * Detect when a visitor explicitly asks to log in / sign in.
 * Excludes negative statements ("I have not logged in") and missing-account signup statements.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isHirePoolLoginRequest(message) {
  const text = normalizeVisitorText(message);
  if (
    /\b(?:not|haven't|have not|don't|do not|never|can't|cannot)\s+(?:logged?\s*in|signed?\s*in)\b/i.test(text) ||
    /\b(?:don't|do not|haven't|have not)\s+(?:got\s+)?(?:have\s+)?(?:an?\s+)?(?:hirepool\s+)?account(?:\s+yet)?\b/i.test(text) ||
    /\b(?:no\s+(?:hirepool\s+)?account(?:\s+yet)?|without\s+(?:an?\s+)?account)\b/i.test(text)
  ) {
    return false;
  }
  return /\b(?:login|log(?:\s+me)?\s*in|sign(?:\s+me)?\s*in|signin)\b/i.test(text);
}

/**
 * Detect natural-language registration / signup requests, including visitors saying
 * they do not have an account or want to join. Excludes general informational
 * capability questions such as "Can I search jobs without an account?" or "Do I need an account?".
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isHirePoolSignupRequest(message) {
  const text = normalizeVisitorText(message);
  if (!text) return false;
  if (/^\s*(?:can|could|do|would|is)\s+(?:i|we|a\s+\w+|anyone)\s+(?:search|browse|use|view|explore|see|check|need|require|have\s+to\s+have)\b.*\baccount\b/i.test(text) &&
      !/\b(?:create|sign(?:\s+(?:me|us))?\s*up|signup|register|don't\s+have\s+an?\s+account)\b/i.test(text)) {
    return false;
  }
  if (/\bwithout\s+(?:an?\s+)?account\b/i.test(text) &&
      !/\b(?:sign(?:\s+(?:me|us))?\s*up|signup|register|create\s+(?:an?\s+)?account)\b/i.test(text)) {
    return false;
  }
  return /\b(?:sign(?:\s+(?:me|us))?\s*up|signup|register|registration|create\s+(?:an?\s+)?account|new\s+account|(?:don'?t|do\s+not|haven'?t|have\s+not)\s+(?:got\s+)?(?:have\s+|created\s+)?(?:an?\s+)?(?:hirepool\s+)?account(?:\s+yet)?|no\s+(?:hirepool\s+)?account(?:\s+yet)?|i\s+need\s+(?:a\s+new\s+|an?\s+)?(?:hirepool\s+)?account|haven'?t\s+(?:signed\s*up|registered)|want\s+to\s+join|would\s+like\s+to\s+join|like\s+to\s+join|join\s+hirepool|how\s+(?:do|can)\s+i\s+(?:sign\s*up|register|join)|start\s+(?:my\s+)?(?:signup|sign\s*up|registration|onboarding))\b/i.test(
    text
  );
}

/**
 * Detect protected account/personal data operations that strictly require verified auth.
 * Must NOT match general platform/job-search/pricing/privacy/terms/how-to questions.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isHirePoolAccountRequest(message) {
  const text = normalizeVisitorText(message);
  // Informational, policy, pricing, and how-to questions stay conversational unless asking for private records
  if (
    /^\s*(?:what\s+is|how\s+does|explain|tell\s+me\s+about)\s+(?:a\s+)?(?:candidate\s+|company\s+|consultancy\s+)?profile\b/i.test(text) ||
    /^\s*how\s+(?:do|can|would|should)\s+(?:i|you|we|candidates?|one)\s+(?:complete|finish|fill\s+out|set\s+up|update|edit|create|build)\s+(?:my|a|the)?\s*(?:candidate\s+|company\s+|consultancy\s+)?profile\b/i.test(text) ||
    /^\s*(?:can\s+i|how\s+(?:do|can)\s+i)\s+apply(?:\s+for|\s+to)?\s+(?:multiple\s+)?jobs\b/i.test(text) ||
    /\b(?:pricing|prices?|cost|plans?|subscriptions?|free\s+trial|privacy(?:\s+policy)?|terms\s+of\s+(?:service|use)|user\s+agreement|data\s+retention|freshers?|remote\s+jobs?|experienced\s+professionals?)\b/i.test(text)
  ) {
    return false;
  }
  return /\b(?:mine|my\s+(?:off(?:er|re)s?|applications?|application status(?:es)?|profile|resume|assessments?|interviews?|account|jobs?)|(?:find|show|get|list|check|recommend)\s+(?:me\s+)?(?:my\s+)?matching\s+jobs?\b|\bmatching\s+jobs\s+for\s+(?:me|my\s+profile)\b|\bfind\s+jobs\s+matching\s+my\s+profile\b|i(?:\s+have|'ve)?\s+applied(?:\s+(?:for|to))?|applications?\s+(?:i|my)|application status(?:es)?|assessment status|interview status|candidate profile|profiles?\s+for me|resume for me|apply for (?:a|this|that|the) job|view\s+my\s+profile|show\s+my\s+profile|(?:edit|update|improve|complete|finish|modify)\s+(?:my\s+)?(?:candidate\s+)?profile|what\s+(?:information|info|details|fields?)\s+(?:is|are)\s+missing(?:\s+(?:on|in|from)\s+(?:my\s+)?profile)?|(?:add|edit|update|write|draft|help\s+me\s+write)\s+(?:a\s+|an\s+|the\s+|my\s+)?(?:professional\s+summary|career\s+summary|summary|education(?:al)?(?:\s+details)?|degree|graduation(?:\s+details)?|work\s*experience|employment(?:\s+details)?|previous\s+(?:company|employer|job))|(?:add|edit|update)\s+(?:b\.?\s*e\.?|b\.?\s*tech|m\.?\s*tech|b\.?\s*sc|m\.?\s*sc|bachelor(?:'s)?|master(?:'s)?|mba|phd|diploma))\b/i.test(
    text
  );
}

/**
 * Detect visitor orientation, capability, and general onboarding questions that
 * should remain conversational without triggering an authentication lockout.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function isHirePoolVisitorExplorationRequest(message) {
  const text = normalizeVisitorText(message);
  if (!text) return false;
  return /\b(?:i(?:'m| am)\s+new(?:\s+to\s+hirepool|\s+here)?|new\s+to\s+hirepool|help\s+me\s+get\s+started|get\s+started|how\s+(?:does|do)\s+(?:hirepool|this(?:\s+assistant)?|ai\s+(?:job\s+)?matching|matching)\s+work|what(?:'s| is)\s+hirepool(?:\s+about)?|what\s+can\s+you\s+do(?:\s+for\s+me)?|how\s+can\s+you\s+help(?:\s+me)?|what\s+features|types?\s+of\s+jobs|looking\s+for\s+(?:a\s+)?job|looking\s+for\s+job\s+opportunities|job\s+opportunities|want\s+to\s+find\s+(?:a\s+)?job|find\s+(?:a\s+)?job|search\s+(?:for\s+)?(?:remote|hybrid|onsite|contract|full[\s-]*time)?\s*jobs?|freshers?|experienced\s+professionals?|free\s+for\s+candidates|pricing|privacy|terms|complete\s+my\s+profile|employers?\s+find\s+candidates?|consultanc(?:y|ies)\s+use\s+hirepool)\b/i.test(
    text
  );
}

/**
 * Update visitor conversation state based on an incoming message from an
 * unauthenticated HirePool user. Never promotes `authenticationStatus` to
 * `'authenticated'`; only verified server tokens may do that.
 *
 * @param {object|null|undefined} session
 * @param {string} message
 * @param {object} [options]
 * @param {string|null} [options.signupState]
 * @param {string|null} [options.signupRole]
 * @returns {object|null}
 */
export function updateHirePoolVisitorFromMessage(session, message, options = {}) {
  const visitor = ensureHirePoolVisitorState(session, { isAuthenticated: false });
  if (!visitor) return null;

  const text = normalizeVisitorText(message);
  const explicitRole = extractHirePoolRegistrationRole(text) || normalizeHirePoolVisitorRole(options.signupRole);
  if (explicitRole) {
    visitor.selectedRole = explicitRole;
  }

  if (options.signupState && options.signupState !== 'idle' && options.signupState !== 'cancelled') {
    visitor.visitorStatus = HIREPOOL_VISITOR_STATUSES.IN_SIGNUP;
    visitor.registrationIntent = HIREPOOL_REGISTRATION_INTENTS.IN_PROGRESS;
    visitor.pendingSignupAction = options.signupState;
    visitor.activeContext = 'signup_guidance';
  }

  if (isHirePoolLoginClaim(text)) {
    visitor.unverifiedLoginClaim = true;
    visitor.authenticationStatus = HIREPOOL_AUTH_STATUSES.UNVERIFIED_CLAIM;
    visitor.activeContext = 'account_access';
  } else if (isHirePoolSignupRequest(text)) {
    visitor.visitorStatus = HIREPOOL_VISITOR_STATUSES.IN_SIGNUP;
    visitor.registrationIntent = HIREPOOL_REGISTRATION_INTENTS.WANTS_SIGNUP;
    visitor.pendingSignupAction = visitor.pendingSignupAction || 'role_selection';
    visitor.activeContext = 'signup_guidance';
    // Asking to register/sign up supersedes any stale unverified-login claim
    visitor.unverifiedLoginClaim = false;
    if (visitor.authenticationStatus === HIREPOOL_AUTH_STATUSES.UNVERIFIED_CLAIM) {
      visitor.authenticationStatus = HIREPOOL_AUTH_STATUSES.UNAUTHENTICATED;
    }
  } else if (isHirePoolLoginRequest(text)) {
    visitor.activeContext = 'account_access';
    // Explicitly asking for login resets the dead-end "already logged in" loop
    visitor.unverifiedLoginClaim = false;
    if (visitor.authenticationStatus === HIREPOOL_AUTH_STATUSES.UNVERIFIED_CLAIM) {
      visitor.authenticationStatus = HIREPOOL_AUTH_STATUSES.UNAUTHENTICATED;
    }
  } else if (isHirePoolAccountRequest(text)) {
    visitor.protectedAccountPromptCount += 1;
    visitor.activeContext = 'account_access';
  } else if (isHirePoolVisitorExplorationRequest(text)) {
    if (visitor.visitorStatus === HIREPOOL_VISITOR_STATUSES.NEW_VISITOR) {
      visitor.visitorStatus = HIREPOOL_VISITOR_STATUSES.RETURNING_VISITOR;
    }
    if (visitor.registrationIntent === HIREPOOL_REGISTRATION_INTENTS.NONE) {
      visitor.registrationIntent = HIREPOOL_REGISTRATION_INTENTS.EXPLORING;
    }
    if (/\b(?:job|opportunities|hiring|candidate|client|consultancy)\b/i.test(text)) {
      visitor.activeContext = 'job_search_guidance';
    } else {
      visitor.activeContext = 'platform_overview';
    }
  } else {
    if (visitor.visitorStatus === HIREPOOL_VISITOR_STATUSES.NEW_VISITOR) {
      visitor.visitorStatus = HIREPOOL_VISITOR_STATUSES.RETURNING_VISITOR;
    }
    if (!visitor.activeContext) {
      visitor.activeContext = 'platform_overview';
    }
  }

  visitor.lastUpdatedAt = new Date().toISOString();
  return visitor;
}

/**
 * Serialize non-sensitive visitor state summary for LLM system prompt injection.
 *
 * @param {object|null|undefined} session
 * @param {object} [options]
 * @param {string|null} [options.signupState]
 * @param {string|null} [options.signupRole]
 * @returns {string}
 */
export function getHirePoolVisitorSystemContext(session, options = {}) {
  const visitor = session?.hirePoolVisitor;
  const effectiveRole = normalizeHirePoolVisitorRole(options.signupRole) || visitor?.selectedRole || 'not selected';
  const effectiveSignupState = options.signupState || visitor?.pendingSignupAction || 'none';
  const lines = [
    '[HIREPOOL VISITOR STATE]',
    `- Visitor status: ${visitor?.visitorStatus || HIREPOOL_VISITOR_STATUSES.NEW_VISITOR}`,
    `- Server verification: ${visitor?.authenticationStatus || HIREPOOL_AUTH_STATUSES.UNAUTHENTICATED}`,
    `- Registration intent: ${visitor?.registrationIntent || HIREPOOL_REGISTRATION_INTENTS.NONE}`,
    `- Selected role: ${effectiveRole}`,
    `- Signup step: ${effectiveSignupState}`,
    `- Active context: ${visitor?.activeContext || 'general_overview'}`,
    'GUIDANCE:',
    '- Be helpful, concise, and conversational for guest visitors asking about HirePool capabilities, job discovery, pricing, privacy policy, terms of service, hiring workflows, or registration.',
    '- When a visitor asks general informational, pricing, privacy, or legal questions ("How does HirePool work?", "Do you support freshers?", "Can I search for remote jobs?", "Explain pricing", "Privacy policy", "Terms of Service"), answer in clear text using verified HirePool facts WITHOUT attaching signup or login action cards and WITHOUT refusing them as out of scope.',
    '- Do NOT assume an unverified visitor role without user confirmation. If a visitor mentions having a list of candidates, clarify whether they are hiring as an Employer/Company or managing a talent pool as a Recruitment Consultancy/Staffing Agency, rather than arbitrarily assigning a role.',
    '- When a visitor shares their career background (e.g. "I have 2 years of experience and I\'m actively looking"), recognize it as career/job exploration and explain how HirePool supports experienced candidates with AI job matching, work modes, and free registration.',
    '- Answer greetings ("Hi", "Hello") with a friendly, concise welcome and helpful next steps.',
    '- When asked to compare HirePool with external platforms (e.g. Naukri, LinkedIn), answer factually using verified HirePool capabilities without claiming external platform ratings or refusing the question.',
    '- When a visitor expresses recruiting or hiring intent (e.g. "I\'m here for recruiting", "I need to hire", "I have a job requirement"), explain verified HirePool hiring workflows (job creation, AI candidate matching, applicant review, automated screening) without inventing commercial terms, free trials, or pricing. Clarify whether they are an Employer hiring for their company or a Recruitment Consultancy placing candidates for client companies.',
    '- Offer hirepool_signup ONLY when the visitor explicitly asks to create an account, sign up, register, join HirePool, or states they do not have an account yet (passing selected role if known).',
    '- NEVER emit raw Markdown ```action``` blocks in text or claim access to private account/application/profile data or invent live job listings while Server verification is not authenticated.'
  ];
  return lines.join('\n');
}
