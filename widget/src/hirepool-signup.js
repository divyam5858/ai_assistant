import {
  validatePhoneNumber,
  validateEmail,
  validatePassword,
  validateWebsiteUrl,
  validateCandidateProfile,
  validateClientProfile,
  validateConsultancyProfile,
  CLIENT_INDUSTRIES,
  COMPANY_SIZES,
  CONSULTANCY_TYPES,
  LIMITS
} from './hirepool-validation.js';

export {
  validatePhoneNumber,
  validateEmail,
  validatePassword,
  validateWebsiteUrl,
  validateCandidateProfile,
  validateClientProfile,
  validateConsultancyProfile,
  CLIENT_INDUSTRIES,
  COMPANY_SIZES,
  CONSULTANCY_TYPES,
  LIMITS
};

export const HIREPOOL_SIGNUP_STATES = Object.freeze({
  IDLE: 'idle',
  ROLE_SELECTION: 'role_selection',
  AGREEMENT_FETCHING: 'agreement_fetching',
  SIGNUP_FORM: 'signup_form',
  REGISTERING: 'registering',
  SIGNUP_SUBMITTING: 'registering',
  REGISTRATION_CONFIRMED: 'registration_confirmed',
  EMAIL_VERIFICATION_PENDING: 'email_verification_pending',
  VERIFICATION_PENDING: 'email_verification_pending',
  EMAIL_VERIFICATION_IN_PROGRESS: 'email_verification_in_progress',
  VERIFICATION_IN_PROGRESS: 'email_verification_in_progress',
  EMAIL_VERIFIED: 'email_verified',
  PROFILE_COLLECTION: 'profile_collection',
  PROFILE_REVIEW: 'profile_review',
  PROFILE_SUBMITTING: 'profile_submitting',
  PROFILE_READBACK: 'profile_readback',
  AUTH_SESSION_ESTABLISHED: 'auth_session_established',
  AUTHENTICATION_SMOKE_TEST: 'authentication_smoke_test',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled'
});

export const ROLE_DEFINITIONS = Object.freeze({
  candidate: {
    label: 'Candidate',
    description: 'Looking for tech jobs and personalized AI matching',
    badge: 'Job Seeker',
    defaultTitle: 'Software Engineer'
  },
  client: {
    label: 'Employer / Company',
    description: 'Hiring talent and managing applications for your company',
    badge: 'Hiring Company',
    defaultTitle: 'Hiring Manager'
  },
  consultancy: {
    label: 'Agency / Consultancy',
    description: 'Placing candidates and tracking placements across clients',
    badge: 'Recruitment Agency',
    defaultTitle: 'Recruitment Partner'
  }
});

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const APPROVED_VERIFICATION_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://app.hirepool.ai',
  'https://hirepool.ai'
]);

/**
 * Validate a server-returned email verification URL before exposing it in the UI.
 * Never constructs or guesses tokens; only accepts explicit approved URLs.
 *
 * @param {string|null|undefined} rawUrl
 * @returns {boolean}
 */
export function isSafeVerificationUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (parsed.username || parsed.password) return false;
  if (!APPROVED_VERIFICATION_ORIGINS.has(parsed.origin)) return false;
  if (!parsed.pathname.startsWith('/auth/verify')) return false;
  return Boolean(parsed.searchParams.get('token'));
}

/**
 * Parse a role selection choice (`candidate`, `client`, `consultancy`, or `staffing`)
 * from natural conversational user input.
 *
 * @param {string} text
 * @returns {'candidate'|'client'|'consultancy'|'staffing'|null}
 */
export function parseHirePoolRoleChoice(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  if (/\bstaffing\b/i.test(trimmed)) {
    return 'staffing';
  }
  if (/\b(?:as\s+(?:a\s+)?candidate|candidate|job\s*seeker|applicant)\b/i.test(trimmed)) {
    return 'candidate';
  }
  if (/\b(?:company|client|employer)\b/i.test(trimmed)) {
    return 'client';
  }
  if (/\b(?:consultancy|agency|recruitment\s+(?:agency|firm))\b/i.test(trimmed)) {
    return 'consultancy';
  }
  return null;
}

export class HirePoolSignupCoordinator {
  constructor({ apiClient, onAuthenticated, onStateChange, onAddMessage } = {}) {
    this.apiClient = apiClient;
    this.onAuthenticated = onAuthenticated;
    this.onStateChange = onStateChange;
    this.onAddMessage = onAddMessage;

    this.state = HIREPOOL_SIGNUP_STATES.IDLE;
    this.selectedRole = null;
    this.agreement = null;
    this.session = null;
    this.verificationUrl = null;
    this.profileData = {};
    this.missingFields = [];
    this._verificationCheckPromise = null;
    this._verifiedTransitioned = false;
  }

  setState(nextState, extra = {}) {
    this.state = nextState;
    if (this.onStateChange) {
      this.onStateChange(this.state, {
        role: this.selectedRole,
        session: this.session,
        verificationUrl: this.verificationUrl,
        profileData: this.profileData,
        missingFields: this.missingFields,
        ...extra
      });
    }
  }

  async start(initialRole = null) {
    if (initialRole && ROLE_DEFINITIONS[initialRole]) {
      return this.selectRole(initialRole);
    }
    this.setState(HIREPOOL_SIGNUP_STATES.ROLE_SELECTION);
    return { stage: HIREPOOL_SIGNUP_STATES.ROLE_SELECTION };
  }

  async selectRole(role) {
    let resolvedRole = role;
    let initialConsultancyType = null;
    if (role === 'staffing') {
      resolvedRole = 'consultancy';
      initialConsultancyType = 'staffing';
    }
    if (!ROLE_DEFINITIONS[resolvedRole]) {
      throw new Error(`Unsupported role: ${role}`);
    }
    this.selectedRole = resolvedRole;
    if (initialConsultancyType) {
      this.profileData.consultancy_type = initialConsultancyType;
    }
    this.setState(HIREPOOL_SIGNUP_STATES.AGREEMENT_FETCHING, { role: this.selectedRole });

    try {
      const agreement = await this.apiClient.getSignupAgreement(this.selectedRole);
      this.agreement = agreement;
      this.setState(HIREPOOL_SIGNUP_STATES.SIGNUP_FORM, { agreement, role: this.selectedRole });
      return { stage: HIREPOOL_SIGNUP_STATES.SIGNUP_FORM, agreement };
    } catch (error) {
      this.setState(HIREPOOL_SIGNUP_STATES.ERROR, { error: error.message });
      throw error;
    }
  }

  async submitSignup({ email, password, confirmPassword }) {
    if (!this.selectedRole || !this.agreement) {
      throw new Error('Please select an account type and accept the User Agreement.');
    }

    this.setState(HIREPOOL_SIGNUP_STATES.REGISTERING);

    try {
      const result = await this.apiClient.signupRegister({
        email,
        password,
        confirmPassword,
        userType: this.selectedRole,
        acceptAgreement: true,
        agreementVersionId: this.agreement.id
      });

      this.session = {
        signupToken: result.signupToken,
        email: result.email,
        userType: result.userType
      };
      this.verificationUrl = isSafeVerificationUrl(result?.verificationUrl)
        ? result.verificationUrl
        : null;
      this._verifiedTransitioned = false;

      this.setState(HIREPOOL_SIGNUP_STATES.REGISTRATION_CONFIRMED, {
        session: this.session,
        verificationUrl: this.verificationUrl,
        result
      });
      this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, {
        session: this.session,
        verificationUrl: this.verificationUrl
      });
      return result;
    } catch (error) {
      this.setState(HIREPOOL_SIGNUP_STATES.SIGNUP_FORM, { error: error.message });
      throw error;
    }
  }

  async resendVerification() {
    if (!this.session?.signupToken) {
      throw new Error('No active registration session.');
    }
    const result = await this.apiClient.resendSignupVerification({ signupToken: this.session.signupToken });
    if (isSafeVerificationUrl(result?.verificationUrl)) {
      this.verificationUrl = result.verificationUrl;
      if (this.state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING) {
        this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, {
          session: this.session,
          verificationUrl: this.verificationUrl,
          message: 'A fresh verification email has been sent. Use the button below to verify your email.'
        });
      }
    }
    return result;
  }

  async verifyWithToken(tokenOrUrl) {
    if (!this.session?.signupToken) {
      throw new Error('No active registration session.');
    }
    if (this._verifiedTransitioned) {
      return { isVerified: true };
    }

    this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_IN_PROGRESS);

    try {
      const result = await this.apiClient.verifySignupEmail({
        signupToken: this.session.signupToken,
        verificationToken: tokenOrUrl
      });

      this._verifiedTransitioned = true;
      this.verificationUrl = null;
      this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED);
      this.missingFields = this._getInitialMissingFields(this.selectedRole);
      this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION, { missingFields: this.missingFields });
      return result;
    } catch (error) {
      this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, { error: error.message });
      throw error;
    }
  }

  async checkVerificationStatus({ silent = false } = {}) {
    if (!this.session?.signupToken) {
      throw new Error('No active registration session.');
    }

    if (
      this._verifiedTransitioned ||
      this.state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED ||
      this.state === HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION ||
      this.state === HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW ||
      this.state === HIREPOOL_SIGNUP_STATES.COMPLETED
    ) {
      return { isVerified: true };
    }

    if (this._verificationCheckPromise) {
      return this._verificationCheckPromise;
    }

    if (!silent) {
      this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_IN_PROGRESS);
    }

    const runCheck = (async () => {
      try {
        const result = await this.apiClient.checkSignupVerificationStatus(this.session.signupToken);
        if (result.isVerified) {
          if (!this._verifiedTransitioned) {
            this._verifiedTransitioned = true;
            this.verificationUrl = null;
            this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED);
            this.missingFields = this._getInitialMissingFields(this.selectedRole);
            this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION, { missingFields: this.missingFields });
          }
        } else if (!silent) {
          this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, {
            notVerifiedYet: true,
            verificationUrl: this.verificationUrl,
            message: this.verificationUrl
              ? 'Email verification not completed yet. Click "Verify Email" above (or use the link in your inbox), then we will continue automatically.'
              : 'Verification link not yet clicked. Please check your email inbox and click the link, then try again.'
          });
        }
        return result;
      } catch (error) {
        if (!silent) {
          this.setState(HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING, {
            verificationUrl: this.verificationUrl,
            error: error.message
          });
        }
        throw error;
      } finally {
        this._verificationCheckPromise = null;
      }
    })();

    this._verificationCheckPromise = runCheck;
    return runCheck;
  }

  async updateProfileFields(fields) {
    if (!this.session?.signupToken) {
      throw new Error('No active registration session.');
    }

    const result = await this.apiClient.updateSignupProfile({
      signupToken: this.session.signupToken,
      fields
    });

    this.profileData = result.profileData;
    this.missingFields = result.missingFields;
    this.setState(result.stage, {
      profileData: this.profileData,
      missingFields: this.missingFields
    });
    return result;
  }

  async completeProfile(finalProfile = null) {
    if (!this.session?.signupToken) {
      throw new Error('No active registration session.');
    }

    this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_SUBMITTING);

    try {
      const payload = finalProfile || this.profileData;
      const result = await this.apiClient.completeSignupProfile({
        signupToken: this.session.signupToken,
        confirmedProfile: payload
      });

      // Step 13: PROFILE_READBACK
      this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_READBACK, { profile: result.profile });

      // Step 14: AUTH_SESSION_ESTABLISHED
      this.setState(HIREPOOL_SIGNUP_STATES.AUTH_SESSION_ESTABLISHED, { result });

      // Step 15: AUTHENTICATION_SMOKE_TEST (run via onAuthenticated)
      this.setState(HIREPOOL_SIGNUP_STATES.AUTHENTICATION_SMOKE_TEST);

      if (this.onAuthenticated) {
        await this.onAuthenticated({
          credential: result.credential,
          sessionScope: result.sessionScope,
          expiresIn: result.expiresIn,
          identity: result.identity,
          profile: result.profile,
          role: this.selectedRole
        });
      }

      // Step 16: COMPLETED
      this.setState(HIREPOOL_SIGNUP_STATES.COMPLETED, { result });

      return result;
    } catch (error) {
      this.setState(HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW, { error: error.message });
      throw error;
    }
  }

  async cancel() {
    if (this.session?.signupToken) {
      try {
        await this.apiClient.cancelSignup(this.session.signupToken);
      } catch {}
    }
    this.state = HIREPOOL_SIGNUP_STATES.IDLE;
    this.selectedRole = null;
    this.agreement = null;
    this.session = null;
    this.verificationUrl = null;
    this.profileData = {};
    this.missingFields = [];
    this._verificationCheckPromise = null;
    this._verifiedTransitioned = false;
    this.setState(HIREPOOL_SIGNUP_STATES.IDLE);
  }

  /**
   * Export only non-sensitive pre-registration state (`role_selection` or
   * `signup_form`) for safe persistence across reloads. Never includes
   * credentials, passwords, email addresses, or verification/signup tokens.
   */
  getSafeProgressSnapshot() {
    if (this.state === HIREPOOL_SIGNUP_STATES.ROLE_SELECTION) {
      return {
        state: 'role_selection',
        selectedRole: null,
        consultancyType: null,
        agreement: null
      };
    }

    if (this.state === HIREPOOL_SIGNUP_STATES.SIGNUP_FORM && this.selectedRole) {
      return {
        state: 'signup_form',
        selectedRole: this.selectedRole,
        consultancyType: this.profileData?.consultancy_type || null,
        agreement: this.agreement
          ? {
              id: this.agreement.id || this.agreement.version_id || null,
              version: this.agreement.version || null,
              role: this.agreement.role || this.selectedRole,
              title: this.agreement.title || null,
              summary: this.agreement.summary || null,
              effectiveDate: this.agreement.effectiveDate || this.agreement.effective_date || null
            }
          : null
      };
    }

    return null;
  }

  /**
   * Restore safe non-sensitive signup UI state (`role_selection` or `signup_form`)
   * after a page reload.
   *
   * @param {object|null} snapshot
   */
  async restoreProgress(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;

    if (snapshot.state === 'role_selection') {
      this.selectedRole = null;
      this.agreement = null;
      this.setState(HIREPOOL_SIGNUP_STATES.ROLE_SELECTION);
      return true;
    }

    if (snapshot.state === 'signup_form' && snapshot.selectedRole && ROLE_DEFINITIONS[snapshot.selectedRole]) {
      this.selectedRole = snapshot.selectedRole;
      if (snapshot.consultancyType) {
        this.profileData.consultancy_type = snapshot.consultancyType;
      }
      if (snapshot.agreement && snapshot.agreement.id) {
        this.agreement = snapshot.agreement;
        this.setState(HIREPOOL_SIGNUP_STATES.SIGNUP_FORM, {
          agreement: this.agreement,
          role: this.selectedRole
        });
        return true;
      }
      await this.selectRole(snapshot.selectedRole);
      return true;
    }

    return false;
  }

  /**
   * Re-emit / focus the current active signup card when the user asks to
   * continue or resume signup via chat.
   */
  resume() {
    if (
      this.state === HIREPOOL_SIGNUP_STATES.IDLE ||
      this.state === HIREPOOL_SIGNUP_STATES.CANCELLED ||
      this.state === HIREPOOL_SIGNUP_STATES.COMPLETED
    ) {
      return false;
    }
    this.setState(this.state, {
      role: this.selectedRole,
      agreement: this.agreement,
      session: this.session,
      profileData: this.profileData,
      missingFields: this.missingFields
    });
    return true;
  }

  _getInitialMissingFields(role) {
    if (role === 'candidate') {
      return ['first_name', 'last_name', 'current_location', 'job_title'];
    }
    if (role === 'client') {
      return ['company_name', 'industry', 'company_size', 'headquarters_location', 'primary_contact.full_name'];
    }
    if (role === 'consultancy') {
      return ['consultancy_name', 'consultancy_type', 'industry_specialization', 'headquarters_location', 'primary_contact.full_name'];
    }
    return [];
  }
}

// -----------------------------------------------------------------------------
// UI Card Renderers
// -----------------------------------------------------------------------------

export function renderRoleSelectionCard({ onSelect, onCancel }) {
  const card = document.createElement('div');
  card.className = 'ai-action-card ai-signup-card';
  card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">Registration</span>
      <span class="ai-action-title">Create a HirePool Account</span>
    </div>
    <p class="ai-action-explanation">Select your role to begin registration directly inside this assistant:</p>
    <div class="ai-signup-role-options">
      <button type="button" class="ai-role-btn" data-role="candidate">
        <div class="ai-role-badge">Job Seeker</div>
        <div class="ai-role-title">Candidate</div>
        <div class="ai-role-desc">Looking for tech jobs and AI match scoring</div>
      </button>
      <button type="button" class="ai-role-btn" data-role="client">
        <div class="ai-role-badge">Hiring Company</div>
        <div class="ai-role-title">Employer / Company</div>
        <div class="ai-role-desc">Post jobs and manage your candidate pipeline</div>
      </button>
      <button type="button" class="ai-role-btn" data-role="consultancy">
        <div class="ai-role-badge">Recruitment Agency</div>
        <div class="ai-role-title">Agency / Consultancy</div>
        <div class="ai-role-desc">Place agency candidates and track commissions</div>
      </button>
    </div>
    <div class="ai-action-controls" style="margin-top: 12px;">
      <button type="button" class="ai-btn-action-cancel">Cancel</button>
    </div>
  `;

  card.querySelectorAll('.ai-role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = btn.getAttribute('data-role');
      onSelect(role);
    });
  });

  card.querySelector('.ai-btn-action-cancel')?.addEventListener('click', () => {
    card.remove();
    if (onCancel) onCancel();
  });

  return card;
}

export function renderSignupFormCard({ role, agreement, onSubmit, onCancel }) {
  const card = document.createElement('div');
  card.className = 'ai-action-card ai-signup-card';
  const roleMeta = ROLE_DEFINITIONS[role] || { label: role, badge: 'HirePool Account' };

  card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">${escapeHtml(roleMeta.badge)}</span>
      <span class="ai-action-title">Sign up as ${escapeHtml(roleMeta.label)}</span>
    </div>
    <p class="ai-action-explanation">Enter your details to create your ${escapeHtml(roleMeta.label)} account. Passwords are encrypted directly and never shared with the AI model.</p>
    
    <form class="ai-signup-form" autocomplete="off">
      <div class="ai-form-group">
        <label class="ai-form-label">Email Address *</label>
        <input type="email" name="email" class="ai-form-input" required placeholder="you@company.com" autocomplete="username">
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Password * (min 8 chars, 1 uppercase, 1 lowercase, 1 number)</label>
        <div class="ai-password-wrapper">
          <input type="password" name="password" class="ai-form-input" required minlength="8" placeholder="••••••••" autocomplete="new-password">
          <button type="button" class="ai-password-toggle" title="Show/Hide Password">👁</button>
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Confirm Password *</label>
        <input type="password" name="confirmPassword" class="ai-form-input" required minlength="8" placeholder="••••••••" autocomplete="new-password">
      </div>

      <div class="ai-form-group ai-agreement-group">
        <label class="ai-action-acknowledgement" style="font-size: 13px;">
          <input type="checkbox" name="acceptAgreement" required>
          I agree to the <a href="http://localhost:5173/agreements?role=${encodeURIComponent(role)}" target="_blank" rel="noopener noreferrer" style="color: #16a34a; text-decoration: underline;">HirePool User Agreement (v${escapeHtml(agreement?.version || '1.0')})</a>.
        </label>
      </div>

      <div class="ai-form-error" style="display: none; color: #dc2626; font-size: 13px; margin-bottom: 10px;"></div>

      <div class="ai-action-controls">
        <button type="submit" class="ai-btn-action-confirm">Create Account</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    </form>
  `;

  const form = card.querySelector('form');
  const errorBox = card.querySelector('.ai-form-error');
  const submitBtn = card.querySelector('.ai-btn-action-confirm');
  const cancelBtn = card.querySelector('.ai-btn-action-cancel');
  const passwordInput = card.querySelector('input[name="password"]');
  const toggleBtn = card.querySelector('.ai-password-toggle');

  toggleBtn?.addEventListener('click', () => {
    passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    const email = form.email.value.trim();
    const password = form.password.value;
    const confirmPassword = form.confirmPassword.value;
    const acceptAgreement = form.acceptAgreement.checked;

    const emailRes = validateEmail(email, { required: true });
    if (!emailRes.isValid) {
      errorBox.textContent = emailRes.error || 'Please enter a valid email address.';
      errorBox.style.display = 'block';
      form.email.focus();
      return;
    }

    const passRes = validatePassword(password, { confirmPassword, acceptAgreement, requireAgreement: true });
    if (!passRes.isValid) {
      errorBox.textContent = passRes.firstError;
      errorBox.style.display = 'block';
      if (passRes.firstError.includes('match')) {
        form.confirmPassword.focus();
      } else if (passRes.firstError.includes('Agreement')) {
        form.acceptAgreement.focus();
      } else {
        form.password.focus();
      }
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    try {
      await onSubmit({ email: emailRes.sanitized, password, confirmPassword });
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
      errorBox.textContent = err.message || 'Registration failed.';
      errorBox.style.display = 'block';
    }
  });

  cancelBtn.addEventListener('click', () => {
    card.remove();
    if (onCancel) onCancel();
  });

  return card;
}

export function renderVerificationCard({
  email,
  verificationUrl = null,
  onVerifyClick,
  onCheckStatus,
  onResend,
  onCancel,
  notVerifiedYet = false,
  message = null,
  error = null
}) {
  const card = document.createElement('div');
  card.className = 'ai-action-card ai-signup-card';
  const safeUrl = isSafeVerificationUrl(verificationUrl) ? verificationUrl : null;
  const introText = safeUrl
    ? `Your verification email has been sent to <strong>${escapeHtml(email)}</strong>. You can verify your email using the button below.`
    : `We've sent a verification link to <strong>${escapeHtml(email)}</strong>.`;
  const hintHtml = safeUrl
    ? 'Click <strong>Verify Email</strong> below to confirm your address. Once verified, we\'ll automatically load your profile setup here.'
    : '<strong>Check your email:</strong> Open the verification link sent to your inbox to verify your account. We\'ll detect verification automatically when you return, or you can check status below.';

  card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">Email Verification</span>
      <span class="ai-action-title">Verify Your Email</span>
    </div>
    <div class="ai-verification-body">
      <p style="margin: 0 0 10px 0; font-size: 13px; line-height: 1.5; color: var(--ai-text, #0f172a); overflow-wrap: break-word;">
        ${introText}
      </p>
      <div style="background: rgba(22, 163, 74, 0.08); border: 1px solid rgba(22, 163, 74, 0.25); border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; font-size: 12px; line-height: 1.45; color: var(--ai-text, #0f172a); overflow-wrap: break-word;">
        ${hintHtml}
      </div>

      <div class="ai-verification-msg" style="display: ${error || notVerifiedYet || message ? 'block' : 'none'}; font-size: 12px; margin-bottom: 12px; padding: 8px 10px; border-radius: 6px; overflow-wrap: break-word; ${error || notVerifiedYet ? 'background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;' : 'background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;'}">
        ${escapeHtml(error || message || '')}
      </div>

      <div class="ai-action-controls">
        ${safeUrl ? '<button type="button" class="ai-btn-action-confirm ai-btn-verify-email">Verify Email</button>' : ''}
        <button type="button" class="${safeUrl ? 'ai-btn-action-edit ai-btn-check-status' : 'ai-btn-action-confirm ai-btn-check-status'}">${safeUrl ? 'Check status' : 'Check Verification Status'}</button>
        <button type="button" class="ai-btn-action-edit ai-btn-resend">Resend email</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    </div>
  `;

  const verifyBtn = card.querySelector('.ai-btn-verify-email');
  const checkStatusBtn = card.querySelector('.ai-btn-check-status');
  const resendBtn = card.querySelector('.ai-btn-resend');
  const cancelBtn = card.querySelector('.ai-btn-action-cancel');
  const msgBox = card.querySelector('.ai-verification-msg');

  const showMsg = (text, isError = true) => {
    msgBox.textContent = text;
    msgBox.style.color = isError ? '#991b1b' : '#1e40af';
    msgBox.style.background = isError ? '#fef2f2' : '#eff6ff';
    msgBox.style.border = isError ? '1px solid #fecaca' : '1px solid #bfdbfe';
    msgBox.style.display = 'block';
  };

  if (verifyBtn && safeUrl) {
    verifyBtn.addEventListener('click', () => {
      if (onVerifyClick) {
        onVerifyClick(safeUrl);
      } else if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
      }
      showMsg('Verification link opened. Complete verification in that tab and we will advance automatically once confirmed.', false);
    });
  }

  checkStatusBtn.addEventListener('click', async () => {
    if (checkStatusBtn.disabled) return;
    checkStatusBtn.disabled = true;
    const idleLabel = safeUrl ? 'Check status' : 'Check Verification Status';
    checkStatusBtn.textContent = 'Checking...';
    try {
      const res = await onCheckStatus();
      if (!res?.isVerified) {
        showMsg('Verification not detected yet. Complete verification and we will automatically continue once confirmed.');
        checkStatusBtn.disabled = false;
        checkStatusBtn.textContent = idleLabel;
      }
    } catch (err) {
      checkStatusBtn.disabled = false;
      checkStatusBtn.textContent = idleLabel;
      showMsg(err.message || 'Could not verify status.');
    }
  });

  resendBtn.addEventListener('click', async () => {
    if (resendBtn.disabled) return;
    resendBtn.disabled = true;
    resendBtn.textContent = 'Sending...';
    try {
      const res = await onResend();
      showMsg(
        res?.verificationUrl
          ? 'A fresh verification email has been sent. Use Verify Email above to verify.'
          : 'A fresh verification email has been requested. Check your inbox.',
        false
      );
    } catch (err) {
      showMsg(err.message || 'Could not resend email.');
    } finally {
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend email';
    }
  });

  cancelBtn.addEventListener('click', () => {
    card.remove();
    if (onCancel) onCancel();
  });

  return card;
}

export function renderProfileCollectionCard({ role, profileData = {}, missingFields = [], onReview, onCancel }) {
  const card = document.createElement('div');
  card.className = 'ai-action-card ai-signup-card';
  const roleMeta = ROLE_DEFINITIONS[role] || { label: role, badge: 'Profile' };

  let fieldsHtml = '';
  if (role === 'candidate') {
    fieldsHtml = `
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">First Name *</label>
          <input type="text" name="first_name" class="ai-form-input" required value="${escapeHtml(profileData.first_name || '')}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Last Name *</label>
          <input type="text" name="last_name" class="ai-form-input" required value="${escapeHtml(profileData.last_name || '')}">
        </div>
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Current Location (City) *</label>
          <input type="text" name="current_location" class="ai-form-input" required placeholder="e.g. Bengaluru" value="${escapeHtml(profileData.current_location || '')}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Phone Number (10 digits)</label>
          <input type="tel" name="phone" class="ai-form-input" placeholder="e.g. 9876543210" value="${escapeHtml(profileData.phone || '')}">
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Current / Desired Job Title *</label>
        <input type="text" name="job_title" class="ai-form-input" required placeholder="e.g. Senior Frontend Developer" value="${escapeHtml(profileData.job_title || '')}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Years of Experience (0-50)</label>
          <input type="number" name="years_of_experience" min="0" max="50" class="ai-form-input" value="${profileData.years_of_experience !== undefined ? profileData.years_of_experience : 0}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Notice Period (Days, 0-180)</label>
          <input type="number" name="notice_period_days" min="0" max="180" class="ai-form-input" placeholder="30" value="${profileData.notice_period_days || ''}">
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Skills (comma separated)</label>
        <input type="text" name="skills" class="ai-form-input" placeholder="React, Node.js, Python, TypeScript" value="${escapeHtml(Array.isArray(profileData.skills) ? profileData.skills.join(', ') : profileData.skills || '')}">
      </div>
    `;
  } else if (role === 'client') {
    fieldsHtml = `
      <div class="ai-form-group">
        <label class="ai-form-label">Company Name *</label>
        <input type="text" name="company_name" class="ai-form-input" required placeholder="e.g. Acme Technologies" value="${escapeHtml(profileData.company_name || '')}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Industry *</label>
          <select name="industry" class="ai-form-input" required>
            ${CLIENT_INDUSTRIES.map(ind => `<option value="${escapeHtml(ind)}" ${profileData.industry === ind ? 'selected' : ''}>${escapeHtml(ind)}</option>`).join('')}
          </select>
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Company Size *</label>
          <select name="company_size" class="ai-form-input" required>
            ${COMPANY_SIZES.map(sz => `<option value="${escapeHtml(sz)}" ${profileData.company_size === sz ? 'selected' : ''}>${escapeHtml(sz)} employees</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Headquarters Location (City) *</label>
        <input type="text" name="headquarters_location" class="ai-form-input" required placeholder="e.g. Mumbai, India" value="${escapeHtml(profileData.headquarters_location || '')}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Primary Contact Full Name *</label>
          <input type="text" name="contact_name" class="ai-form-input" required placeholder="Your full name" value="${escapeHtml(profileData.primary_contact?.full_name || profileData.contact_name || '')}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Primary Contact Phone</label>
          <input type="tel" name="contact_phone" class="ai-form-input" placeholder="e.g. 9876543210" value="${escapeHtml(profileData.primary_contact?.phone || profileData.contact_phone || '')}">
        </div>
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Designation</label>
          <input type="text" name="designation" class="ai-form-input" placeholder="e.g. Head of HR" value="${escapeHtml(profileData.primary_contact?.designation || profileData.designation || '')}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Company Website</label>
          <input type="url" name="company_website" class="ai-form-input" placeholder="https://example.com" value="${escapeHtml(profileData.company_website || '')}">
        </div>
      </div>
    `;
  } else if (role === 'consultancy') {
    fieldsHtml = `
      <div class="ai-form-group">
        <label class="ai-form-label">Agency / Consultancy Name *</label>
        <input type="text" name="consultancy_name" class="ai-form-input" required placeholder="e.g. Apex Recruitment" value="${escapeHtml(profileData.consultancy_name || '')}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Agency Type *</label>
          <select name="consultancy_type" class="ai-form-input" required>
            <option value="recruitment" ${(profileData.consultancy_type || 'recruitment') === 'recruitment' ? 'selected' : ''}>Recruitment Agency</option>
            <option value="staffing" ${profileData.consultancy_type === 'staffing' ? 'selected' : ''}>Staffing Agency</option>
          </select>
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Headquarters Location *</label>
          <input type="text" name="headquarters_location" class="ai-form-input" required placeholder="e.g. Bengaluru" value="${escapeHtml(profileData.headquarters_location || '')}">
        </div>
      </div>
      <div class="ai-form-group">
        <label class="ai-form-label">Specializations (comma separated) *</label>
        <input type="text" name="industry_specialization" class="ai-form-input" required placeholder="Technology, Finance, Engineering" value="${escapeHtml(Array.isArray(profileData.industry_specialization) ? profileData.industry_specialization.join(', ') : profileData.industry_specialization || 'Technology')}">
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Primary Contact Full Name *</label>
          <input type="text" name="contact_name" class="ai-form-input" required placeholder="Your full name" value="${escapeHtml(profileData.primary_contact?.full_name || profileData.contact_name || '')}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Primary Contact Phone</label>
          <input type="tel" name="contact_phone" class="ai-form-input" placeholder="e.g. 9876543210" value="${escapeHtml(profileData.primary_contact?.phone || profileData.contact_phone || '')}">
        </div>
      </div>
      <div class="ai-form-row">
        <div class="ai-form-group">
          <label class="ai-form-label">Designation</label>
          <input type="text" name="designation" class="ai-form-input" placeholder="e.g. Managing Director" value="${escapeHtml(profileData.primary_contact?.designation || profileData.designation || '')}">
        </div>
        <div class="ai-form-group">
          <label class="ai-form-label">Agency Website</label>
          <input type="url" name="website" class="ai-form-input" placeholder="https://example.com" value="${escapeHtml(profileData.website || '')}">
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">${escapeHtml(roleMeta.badge)}</span>
      <span class="ai-action-title">Complete Your Profile</span>
    </div>
    <p class="ai-action-explanation">Your email is verified! Complete the required information below to finish setting up your account:</p>
    
    <form class="ai-profile-form">
      ${fieldsHtml}
      <div class="ai-form-error" style="display: none; color: #dc2626; font-size: 13px; margin: 8px 0;"></div>
      <div class="ai-action-controls" style="margin-top: 14px;">
        <button type="submit" class="ai-btn-action-confirm">Review Profile Details</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    </form>
  `;

  const form = card.querySelector('form');
  const errorBox = card.querySelector('.ai-form-error');
  const cancelBtn = card.querySelector('.ai-btn-action-cancel');

  const setInputError = (input, msg) => {
    if (!input) return;
    input.classList.add('ai-input-invalid');
    let errElem = input.parentElement?.querySelector('.ai-field-error');
    if (!errElem) {
      errElem = document.createElement('div');
      errElem.className = 'ai-field-error';
      input.parentElement?.appendChild(errElem);
    }
    errElem.textContent = msg;
    errElem.style.display = 'block';
  };

  const clearInputError = (input) => {
    if (!input) return;
    input.classList.remove('ai-input-invalid');
    const errElem = input.parentElement?.querySelector('.ai-field-error');
    if (errElem) {
      errElem.remove();
    }
  };

  const clearAllFieldErrors = () => {
    form.querySelectorAll('.ai-input-invalid').forEach(inp => inp.classList.remove('ai-input-invalid'));
    form.querySelectorAll('.ai-field-error').forEach(el => el.remove());
  };

  // Real-time phone validation (Level 1)
  const phoneInput = form.querySelector('input[name="phone"], input[name="contact_phone"]');
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      const val = phoneInput.value;
      if (/[a-zA-Z]/.test(val)) {
        setInputError(phoneInput, 'Phone number must contain exactly 10 digits');
      } else {
        clearInputError(phoneInput);
      }
    });
    phoneInput.addEventListener('blur', () => {
      const val = phoneInput.value.trim();
      if (val) {
        const res = validatePhoneNumber(val, { required: false });
        if (!res.isValid) {
          setInputError(phoneInput, res.error);
        } else {
          clearInputError(phoneInput);
        }
      } else {
        clearInputError(phoneInput);
      }
    });
  }

  // Real-time website validation (Level 1)
  const websiteInput = form.querySelector('input[name="company_website"], input[name="website"]');
  if (websiteInput) {
    websiteInput.addEventListener('blur', () => {
      const val = websiteInput.value.trim();
      if (val) {
        const res = validateWebsiteUrl(val, { required: false });
        if (!res.isValid) {
          setInputError(websiteInput, res.error);
        } else {
          clearInputError(websiteInput);
        }
      } else {
        clearInputError(websiteInput);
      }
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    clearAllFieldErrors();

    const formData = new FormData(form);
    const data = {};
    for (const [key, val] of formData.entries()) {
      data[key] = val;
    }

    if (role === 'client' || role === 'consultancy') {
      data.primary_contact = {
        full_name: data.contact_name,
        designation: data.designation || null,
        phone: data.contact_phone || null
      };
      delete data.contact_name;
      delete data.designation;
      delete data.contact_phone;
    }

    if (data.skills && typeof data.skills === 'string') {
      data.skills = data.skills.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (data.industry_specialization && typeof data.industry_specialization === 'string') {
      data.industry_specialization = data.industry_specialization.split(',').map(s => s.trim()).filter(Boolean);
    }

    let valResult;
    if (role === 'candidate') {
      valResult = validateCandidateProfile(data, { mode: 'onboarding' });
    } else if (role === 'client') {
      valResult = validateClientProfile(data, { mode: 'onboarding' });
    } else if (role === 'consultancy') {
      valResult = validateConsultancyProfile(data, { mode: 'onboarding' });
    }

    if (valResult && !valResult.isValid) {
      errorBox.textContent = valResult.firstError || 'Please correct the highlighted errors.';
      errorBox.style.display = 'block';

      let firstInvalidInput = null;
      for (const [errField, errMsg] of Object.entries(valResult.errors)) {
        let inputEl = null;
        if (errField === 'primary_contact.full_name') {
          inputEl = form.querySelector('[name="contact_name"]');
        } else if (errField === 'primary_contact.phone') {
          inputEl = form.querySelector('[name="contact_phone"]');
        } else if (errField === 'primary_contact.designation') {
          inputEl = form.querySelector('[name="designation"]');
        } else {
          inputEl = form.querySelector(`[name="${errField}"]`);
        }

        if (inputEl) {
          setInputError(inputEl, errMsg);
          if (!firstInvalidInput) firstInvalidInput = inputEl;
        }
      }

      if (firstInvalidInput) {
        firstInvalidInput.focus();
      }
      return;
    }

    onReview(valResult ? valResult.sanitizedData : data);
  });

  cancelBtn.addEventListener('click', () => {
    card.remove();
    if (onCancel) onCancel();
  });

  return card;
}

export function renderProfileReviewCard({ role, profileData, onConfirm, onEdit, onCancel }) {
  const card = document.createElement('div');
  card.className = 'ai-action-card ai-signup-card';
  const roleMeta = ROLE_DEFINITIONS[role] || { label: role, badge: 'Profile Review' };

  let summaryRows = '';
  for (const [key, val] of Object.entries(profileData)) {
    if (val === undefined || val === null || val === '' || (typeof val === 'object' && Object.keys(val).length === 0)) continue;
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    let displayVal = val;
    if (key === 'primary_contact' && typeof val === 'object') {
      const parts = [];
      if (val.full_name) parts.push(`Name: ${val.full_name}`);
      if (val.designation) parts.push(`Designation: ${val.designation}`);
      if (val.phone) parts.push(`Phone: ${val.phone}`);
      displayVal = parts.join(', ');
    } else if (Array.isArray(val)) {
      if (val.length === 0) continue;
      if (typeof val[0] === 'object') {
        displayVal = val.map(item => Object.values(item).filter(Boolean).join(' - ')).join('; ');
      } else {
        displayVal = val.join(', ');
      }
    } else if (typeof val === 'object') {
      displayVal = Object.entries(val).map(([k, v]) => `${k}: ${v}`).join(', ');
    }
    summaryRows += `
      <div class="ai-action-param-row">
        <span class="ai-action-param-key">${escapeHtml(label)}:</span>
        <span class="ai-action-param-val">${escapeHtml(String(displayVal))}</span>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="ai-action-header">
      <span class="ai-action-badge">${escapeHtml(roleMeta.badge)}</span>
      <span class="ai-action-title">Review &amp; Confirm Your Profile</span>
    </div>
    <p class="ai-action-explanation">Please review the details below. Once confirmed, your profile will be created and your assistant will be ready for account actions.</p>
    <div class="ai-action-details">${summaryRows}</div>
    <div class="ai-review-msg" style="display: none; color: #dc2626; font-size: 13px; margin: 8px 0;"></div>
    <div class="ai-action-controls" style="margin-top: 14px;">
      <button type="button" class="ai-btn-action-confirm ai-btn-complete">Confirm &amp; Complete Registration</button>
      <button type="button" class="ai-btn-edit" style="background: #f1f5f9; color: #0f172a; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px;">Edit</button>
      <button type="button" class="ai-btn-action-cancel">Cancel</button>
    </div>
  `;

  const confirmBtn = card.querySelector('.ai-btn-complete');
  const editBtn = card.querySelector('.ai-btn-edit');
  const cancelBtn = card.querySelector('.ai-btn-action-cancel');
  const msgBox = card.querySelector('.ai-review-msg');

  confirmBtn.addEventListener('click', async () => {
    msgBox.style.display = 'none';

    // Pre-submission review validation (Level 2)
    let valRes;
    if (role === 'candidate') {
      valRes = validateCandidateProfile(profileData, { mode: 'onboarding' });
    } else if (role === 'client') {
      valRes = validateClientProfile(profileData, { mode: 'onboarding' });
    } else if (role === 'consultancy') {
      valRes = validateConsultancyProfile(profileData, { mode: 'onboarding' });
    }

    if (valRes && !valRes.isValid) {
      msgBox.textContent = valRes.firstError || 'Profile validation failed. Please edit your details.';
      msgBox.style.display = 'block';
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Saving & Verifying...';

    try {
      await onConfirm();
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm & Complete Registration';
      msgBox.textContent = err.message || 'Could not complete registration.';
      msgBox.style.display = 'block';
    }
  });

  editBtn.addEventListener('click', () => {
    card.remove();
    onEdit();
  });

  cancelBtn.addEventListener('click', () => {
    card.remove();
    if (onCancel) onCancel();
  });

  return card;
}
