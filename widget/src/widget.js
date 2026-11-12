import { parseMarkdown, escapeHtml } from './markdown.js';
import {
  formatHirePoolResumeSize,
  HIREPOOL_RESUME_STATES,
  HirePoolResumeUpload
} from './hirepool-resume.js';
import {
  HirePoolSignupCoordinator,
  HIREPOOL_SIGNUP_STATES,
  ROLE_DEFINITIONS,
  parseHirePoolRoleChoice,
  renderRoleSelectionCard,
  renderSignupFormCard,
  renderVerificationCard,
  renderProfileCollectionCard,
  renderProfileReviewCard
} from './hirepool-signup.js';

// SVG Icons
const ICONS = {
  chat: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  minimize: `<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
  send: `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
  stop: `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  attachment: `<svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>`
};

export class AssistantWidgetUI {
  constructor(options, apiClient, storage, events) {
    this.options = options;
    this.apiClient = apiClient;
    this.storage = storage;
    this.events = events;
    this._initialGreeting = options.greeting || '';
    this._initialSuggestedPrompts = Array.isArray(options.suggestedPrompts)
      ? [...options.suggestedPrompts]
      : [];

    this.isOpen = false;
    this.isGenerating = false;
    this.abortController = null;
    this.documentUploadController = null;
    this.hirePoolResume = new HirePoolResumeUpload(
      apiClient,
      state => this._renderHirePoolResumeState(state)
    );
    this.hirePoolResumeCard = null;
    this.hirePoolSignup = new HirePoolSignupCoordinator({
      apiClient: this.apiClient,
      onAuthenticated: async (session) => {
        await this._handleHirePoolSignupSuccess(session);
      },
      onStateChange: (state, data) => {
        this._renderHirePoolSignupState(state, data);
      }
    });
    this.hirePoolSignupCard = null;
    this._verificationPollTimer = null;
    this._verificationFocusHandler = null;
    this._verificationVisibilityHandler = null;
    this.hostIdentity = null;
    this.messages = [];
    this.activeConversationId = null;
    this.contextOverrideSet = false;

    this.hostElement = null;
    this.shadowRoot = null;
  }

  /**
   * Mount widget into the DOM
   */
  mount(cssContent = '') {
    // Prevent duplicate DOM attachment
    if (this.hostElement && this.hostElement.parentNode) {
      return;
    }
    if (document.getElementById('ai-assistant-plugin-root')) {
      throw new Error('An AI Assistant widget is already mounted on this page.');
    }

    this.hostElement = document.createElement('div');
    this.hostElement.id = 'ai-assistant-plugin-root';
    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

    // Inject CSS
    const styleTag = document.createElement('style');
    styleTag.textContent = cssContent;
    this.shadowRoot.appendChild(styleTag);

    // Build DOM structure
    this._buildDOM();

    // Restore conversation history from session storage
    this._restoreState();

    // Attach event listeners
    this._attachEvents();

    document.body.appendChild(this.hostElement);
  }

  /**
   * Unmount widget and clean up DOM
   */
  unmount() {
    this._stopVerificationWatcher();
    if (this.abortController) {
      this.abortController.abort();
    }
    this.cancelDocumentUpload();
    if (this.hirePoolResume.state === HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION) {
      void this.hirePoolResume.cancel();
    }
    if (this.hirePoolSignup && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.IDLE) {
      void this.hirePoolSignup.cancel();
    }
    if (this.hostElement && this.hostElement.parentNode) {
      this.hostElement.parentNode.removeChild(this.hostElement);
    }
    this.hostElement = null;
    this.shadowRoot = null;
  }

  _buildDOM() {
    const { name, theme, position, primaryColor, greeting, suggestedPrompts, avatarUrl } = this.options;

    const container = document.createElement('div');
    container.className = `ai-widget-container pos-${position || 'bottom-right'}`;
    container.setAttribute('data-theme', theme || 'auto');
    if (primaryColor) {
      container.style.setProperty('--ai-primary', primaryColor);
      container.style.setProperty('--ai-user-bubble', primaryColor);
    }
    this.container = container;

    // Floating Launcher Button
    const launcherBtn = document.createElement('button');
    launcherBtn.className = 'ai-launcher-btn';
    launcherBtn.type = 'button';
    launcherBtn.setAttribute('aria-label', `Open ${name}`);
    launcherBtn.setAttribute('aria-haspopup', 'dialog');
    launcherBtn.setAttribute('aria-expanded', 'false');
    launcherBtn.innerHTML = `
      <span class="icon-chat">${ICONS.chat}</span>
      <span class="icon-close">${ICONS.close}</span>
    `;
    this.launcherBtn = launcherBtn;

    // Chat Panel Dialog
    const panel = document.createElement('div');
    panel.className = 'ai-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', name);

    // Header
    const avatarHtml = avatarUrl
      ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)} avatar"/>`
      : escapeHtml(name.charAt(0).toUpperCase());

    panel.innerHTML = `
      <header class="ai-header">
        <div class="ai-header-info">
          <div class="ai-avatar">${avatarHtml}</div>
          <div class="ai-header-titles">
            <span class="ai-title">${escapeHtml(name)}</span>
            <span class="ai-status">
              <span class="ai-status-dot"></span>
              <span class="ai-status-text">Online</span>
            </span>
          </div>
        </div>
        <div class="ai-header-actions">
          <button class="ai-icon-btn btn-new-chat" type="button" title="New Conversation" aria-label="Start new conversation">
            ${ICONS.refresh}
          </button>
          <button class="ai-icon-btn btn-close" type="button" title="Close" aria-label="Close chat panel">
            ${ICONS.close}
          </button>
        </div>
      </header>

      <main class="ai-body" role="log" aria-live="polite" aria-relevant="additions text">
        <div class="ai-welcome-box">
          <div class="ai-welcome-greeting">${escapeHtml(greeting)}</div>
          ${suggestedPrompts && suggestedPrompts.length > 0 ? `
            <div class="ai-suggested-prompts">
            <div class="ai-suggested-prompts-label">Suggested Prompts</div>
            <div class="ai-prompts-list">
              ${suggestedPrompts.map(p => `<button type="button" class="ai-prompt-pill">${escapeHtml(p)}</button>`).join('')}
            </div>
            </div>
          ` : ''}
        </div>
        <div class="ai-messages-list"></div>
        <div class="ai-streaming-indicator" style="display: none;">
          <span class="ai-typing-dot"></span>
          <span class="ai-typing-dot"></span>
          <span class="ai-typing-dot"></span>
        </div>
      </main>

      <footer class="ai-footer">
        <form class="ai-input-form">
          <button class="ai-attach-btn" type="button" aria-label="Upload document" title="Upload a document (PDF, DOCX, TXT)">
            ${ICONS.attachment}
          </button>
          <input type="file" class="ai-file-input" accept=".pdf,.docx,.txt,.text,.md,.markdown,.csv,.json,.log,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/json" style="display: none;" />
          <textarea
            class="ai-textarea"
            placeholder="Ask a question or request a summary..."
            rows="1"
            aria-label="Message input"
            maxlength="10000"
          ></textarea>
          <button class="ai-send-btn" type="submit" aria-label="Send message" disabled>
            ${ICONS.send}
          </button>
          <button class="ai-stop-btn" type="button" aria-label="Stop generating" style="display: none;">
            ${ICONS.stop}
          </button>
        </form>
        <div class="ai-footer-note">Press Enter to send, Shift+Enter for newline</div>
      </footer>
    `;

    this.panel = panel;
    this.messagesList = panel.querySelector('.ai-messages-list');
    this.streamingIndicator = panel.querySelector('.ai-streaming-indicator');
    this.statusDot = panel.querySelector('.ai-status-dot');
    this.statusText = panel.querySelector('.ai-status-text');
    this.textarea = panel.querySelector('.ai-textarea');
    this.sendBtn = panel.querySelector('.ai-send-btn');
    this.stopBtn = panel.querySelector('.ai-stop-btn');
    this.attachBtn = panel.querySelector('.ai-attach-btn');
    this.fileInput = panel.querySelector('.ai-file-input');
    if (this._isHirePoolResumeEnabled()) {
      this.attachBtn.disabled = true;
      this.attachBtn.title = 'Sign in to a verified HirePool candidate account to upload a resume.';
      this.attachBtn.setAttribute('aria-label', this.attachBtn.title);
    }
    this.fileInput.accept = this._isHirePoolResumeEnabled()
      ? '.pdf,application/pdf'
      : this.options.documentUpload?.allowedExtensions?.join(',') || '.pdf,.docx,.txt';
    this.body = panel.querySelector('.ai-body');

    container.appendChild(panel);
    container.appendChild(launcherBtn);
    this.shadowRoot.appendChild(container);
  }

  _attachEvents() {
    // Toggle Launcher
    this.launcherBtn.addEventListener('click', () => {
      this.toggle();
    });

    // Close button in header
    this.panel.querySelector('.btn-close').addEventListener('click', () => {
      this.close();
    });

    // New Chat button in header
    this.panel.querySelector('.btn-new-chat').addEventListener('click', () => {
      this.newConversation();
    });

    // Stop button
    this.stopBtn.addEventListener('click', () => {
      this.cancelGeneration();
    });

    // Suggested prompt pills
    this.panel.querySelectorAll('.ai-prompt-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const text = e.target.textContent.trim();
        if (text) {
          this.sendMessage(text);
        }
      });
    });

    // Input form & textarea auto-grow
    this.textarea.addEventListener('input', () => {
      this.textarea.style.height = 'auto';
      this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + 'px';
      this.sendBtn.disabled = !this.textarea.value.trim() || this.isGenerating;
    });

    // Enter to send, Shift+Enter for newline
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = this.textarea.value.trim();
        if (text && !this.isGenerating) {
          this.sendMessage(text);
        }
      }
    });

    // Submit form
    this.panel.querySelector('.ai-input-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.textarea.value.trim();
      if (text && !this.isGenerating) {
        this.sendMessage(text);
      }
    });

    // Attachment button & file upload
    if (this.attachBtn && this.fileInput) {
      this.attachBtn.addEventListener('click', () => {
        if (this.isGenerating) return;
        if (this._isHirePoolResumeEnabled() &&
            this.hirePoolResume.state === HIREPOOL_RESUME_STATES.UPLOADING) return;
        this.fileInput.click();
      });

      this.fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        this.fileInput.value = '';
        if (this._isHirePoolResumeEnabled()) {
          this._handleHirePoolResumeFile(file);
        } else {
          this._handleFileUpload(file);
        }
      });
    }

    // Esc key closes panel
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // Global copy buttons inside messages delegation
    this.messagesList.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.ai-msg-action-btn') || e.target.closest('.copy-code-btn');
      if (copyBtn) {
        this._handleCopyClick(copyBtn);
      }
      const retryBtn = e.target.closest('.ai-error-retry-btn');
      if (retryBtn) {
        const lastUserMsg = [...this.messages].reverse().find(m => m.role === 'user');
        if (lastUserMsg) {
          this.sendMessage(lastUserMsg.content);
        }
      }
    });
  }

  _handleCopyClick(btn) {
    let textToCopy = '';
    if (btn.classList.contains('copy-code-btn')) {
      const wrapper = btn.closest('.code-block-wrapper');
      textToCopy = wrapper ? wrapper.querySelector('code').innerText : '';
    } else {
      const row = btn.closest('.ai-message-row');
      textToCopy = row ? row.getAttribute('data-raw-content') : '';
    }

    if (textToCopy && navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        const originalText = btn.innerHTML;
        btn.innerHTML = btn.classList.contains('copy-code-btn') ? 'Copied!' : `${ICONS.check} Copied`;
        setTimeout(() => {
          btn.innerHTML = originalText;
        }, 2000);
      }).catch(err => {
        console.warn('Copy failed:', err);
      });
    }
  }

  _restoreState() {
    const savedSession = this.storage.get('hirepool_session', null);

    if (savedSession && savedSession.credential) {
      this.apiClient.setAuthenticatedSession(savedSession);
      this.hostIdentity = savedSession.identity;
      if (typeof this.storage.setUser === 'function') {
        this.storage.setUser(savedSession.identity?.id);
      }
      if (this.options.integration) {
        this.options.integration.getAuthHeaders = async () => ({ Authorization: `Bearer ${savedSession.credential}` });
        this.options.integration.getSessionScope = async () => savedSession.sessionScope;
        this.options.integration.getIdentity = async () => savedSession.identity;
        if (typeof this.options.integration.setSession === 'function') {
          this.options.integration.setSession(savedSession);
        }
      }

      // Asynchronously validate stored session in background
      void this.apiClient.validateHirePoolSession(savedSession.credential).then(validation => {
        if (!validation?.valid) {
          this._clearSessionAndFallbackToGuest();
        }
      }).catch(() => {
        this._clearSessionAndFallbackToGuest();
      });
    }

    const savedConvoId = this.storage.getConversationId();
    const savedMessages = this.storage.get('messages', []);

    this.activeConversationId = savedConvoId;
    if (Array.isArray(savedMessages) && savedMessages.length > 0) {
      this.messages = savedMessages;
      this.messages.forEach(msg => {
        this._renderMessageBubble(msg.role, msg.content, false, msg.action);
      });
    }

    const wasOpen = this.storage.get('is_open', false);
    if (wasOpen) {
      this.open();
    }

    if (this._isGuestSession() && this._isHirePoolSignupEnabled()) {
      const savedSignup = this.storage.getSignupProgress?.();
      if (savedSignup) {
        void this.hirePoolSignup.restoreProgress(savedSignup).catch(() => {
          this.storage.clearSignupProgress?.();
        });
      }
    }
  }

  _clearHirePoolContextAuth() {
    const ctx = this.options?.context;
    if (!ctx) return;
    if (typeof ctx === 'object' && !Array.isArray(ctx)) {
      if ('authentication' in ctx || 'identity' in ctx) {
        const sanitized = { ...ctx };
        delete sanitized.authentication;
        delete sanitized.identity;
        this.options.context = sanitized;
      }
      return;
    }
    if (typeof ctx === 'string' && ctx.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(ctx);
        if (parsed && typeof parsed === 'object' && ('authentication' in parsed || 'identity' in parsed)) {
          delete parsed.authentication;
          delete parsed.identity;
          this.options.context = JSON.stringify(parsed);
        }
      } catch {}
    }
  }

  _resetHirePoolIntegrationToGuest() {
    this._clearHirePoolContextAuth();
    const integration = this.options?.integration;
    if (integration) {
      integration.getAuthHeaders = async () => ({});
      integration.getSessionScope = async () => 'guest';
      integration.getIdentity = async () => null;
      if ('authHeadersProvider' in integration) integration.authHeadersProvider = () => ({});
      if ('sessionScopeProvider' in integration) integration.sessionScopeProvider = () => 'guest';
      if ('identityProvider' in integration) integration.identityProvider = () => null;
    }
    if (this.apiClient) {
      this.apiClient.clearAuthenticatedSession();
      this.apiClient.clearDemoToken?.();
      this.apiClient.getAuthHeaders = integration ? () => integration.getAuthHeaders() : null;
    }
  }

  _clearSessionAndFallbackToGuest() {
    this.storage.remove('hirepool_session');
    this._resetHirePoolIntegrationToGuest();
    if (typeof this.storage.setUser === 'function') {
      this.storage.setUser(null);
    }
    this.storage.remove('hirepool_session');
    this.setHostIdentity(null, 'guest');
  }

  async _handleHirePoolLogout(logoutInfo = {}, confirmationMessage = null) {
    this.cancelGeneration();
    this.cancelDocumentUpload();
    this._stopVerificationWatcher();
    this._dismissRecoverableBanner();
    this.hirePoolResume?.reset?.();
    this.storage.clearSignupProgress?.();

    if (this.hirePoolSignupCard) {
      this.hirePoolSignupCard.remove();
      this.hirePoolSignupCard = null;
    }
    if (this.hirePoolSignup && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.IDLE) {
      this.hirePoolSignup.state = HIREPOOL_SIGNUP_STATES.IDLE;
      this.hirePoolSignup.selectedRole = null;
      this.hirePoolSignup.agreement = null;
      this.hirePoolSignup.session = null;
      this.hirePoolSignup.verificationUrl = null;
      this.hirePoolSignup.profileData = {};
      this.hirePoolSignup.missingFields = [];
    }

    const integration = this.options?.integration;
    for (const hook of [
      integration?.clearSession,
      integration?.logout,
      integration?.onLogout,
      integration?.logoutHandler,
      this.options?.onLogout
    ]) {
      if (typeof hook === 'function') {
        try {
          await hook.call(integration || this.options, logoutInfo);
        } catch {}
      }
    }

    this.storage.remove('hirepool_session');
    this.storage.clear();
    this._resetHirePoolIntegrationToGuest();

    if (typeof this.storage.setUser === 'function') {
      this.storage.setUser(null);
    }
    this.storage.remove('hirepool_session');
    this.storage.clear();

    this.activeConversationId = null;
    this.messages = [];
    if (this.messagesList) {
      this.messagesList.innerHTML = '';
    }
    this.setHostIdentity(null, 'guest');
    this.setGreeting(this._initialGreeting || '', this._initialSuggestedPrompts || []);
    this._persistState();
    this._setGenerating(false);

    if (confirmationMessage) {
      this._renderMessageBubble('assistant', confirmationMessage, false);
    }
    this.events.emit('auth:logout', logoutInfo || { loggedOut: true });
    this.events.emit('conversation:cleared');
  }

  _persistState() {
    this.storage.set('messages', this.messages.map(message => (
      message.action?.action === 'hirepool_begin_login' ||
      message.action?.parameters?.continuationReference
        ? { ...message, action: { ...message.action, parameters: {} } }
        : message
    )));
    this.storage.saveConversationId(this.activeConversationId);
    this.storage.set('is_open', this.isOpen);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.container.classList.add('is-open');
    this.launcherBtn.setAttribute('aria-expanded', 'true');
    this._persistState();
    this.events.emit('open');

    // Focus input smoothly
    setTimeout(() => {
      this.textarea.focus();
      this._scrollToBottom();
    }, 100);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.container.classList.remove('is-open');
    this.launcherBtn.setAttribute('aria-expanded', 'false');
    this._persistState();
    this.events.emit('close');

    // Return focus to launcher button
    this.launcherBtn.focus();
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  setTheme(theme) {
    if (['light', 'dark', 'auto'].includes(theme)) {
      this.container.setAttribute('data-theme', theme);
      this.options.theme = theme;
    }
  }

  setPosition(pos) {
    ['bottom-right', 'bottom-left', 'top-right', 'top-left'].forEach(p => {
      this.container.classList.remove(`pos-${p}`);
    });
    this.container.classList.add(`pos-${pos}`);
    this.options.position = pos;
  }

  setContext(context, override = true) {
    this.options.context = context;
    this.contextOverrideSet = override;
  }

  setGreeting(greeting, suggestedPrompts = []) {
    const welcome = this.panel?.querySelector('.ai-welcome-box');
    const greetingElement = welcome?.querySelector('.ai-welcome-greeting');
    if (!welcome || !greetingElement) return;
    greetingElement.textContent = greeting;
    this.options.greeting = greeting;
    this.options.suggestedPrompts = suggestedPrompts;

    let promptSection = welcome.querySelector('.ai-suggested-prompts');
    if (!suggestedPrompts.length) {
      promptSection?.remove();
      return;
    }
    if (!promptSection) {
      promptSection = document.createElement('div');
      promptSection.className = 'ai-suggested-prompts';
      promptSection.innerHTML = '<div class="ai-suggested-prompts-label">Suggested Prompts</div><div class="ai-prompts-list"></div>';
      greetingElement.insertAdjacentElement('afterend', promptSection);
    }
    const promptList = promptSection.querySelector('.ai-prompts-list');
    promptList.replaceChildren(...suggestedPrompts.map(prompt => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-prompt-pill';
      button.textContent = prompt;
      button.addEventListener('click', () => this.sendMessage(prompt));
      return button;
    }));
  }

  async newConversation() {
    if (this.hirePoolResume.state === HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION) {
      if (!await this.hirePoolResume.cancel()) return false;
    } else if (
      this.hirePoolResume.state === HIREPOOL_RESUME_STATES.PREPARING ||
      this.hirePoolResume.state === HIREPOOL_RESUME_STATES.UPLOADING
    ) {
      this._renderHirePoolResumeError('Wait for the current resume operation to finish before starting a new chat.');
      return false;
    }
    this.cancelGeneration();
    this.cancelDocumentUpload();
    this._stopVerificationWatcher();
    if (this.activeConversationId) {
      try {
        await this.apiClient.clearSession(this.activeConversationId);
      } catch (err) {
        this._renderErrorBanner(`Could not clear the previous conversation: ${err.message}`);
        this.events.emit('error', err);
        return false;
      }
    }
    this.activeConversationId = null;
    this.messages = [];
    this.messagesList.innerHTML = '';
    this.hirePoolResume.reset();
    if (this.hirePoolSignup && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.IDLE) {
      await this.hirePoolSignup.cancel();
    }
    this.storage.clear();
    this._persistState();
    this._setGenerating(false);
    this.events.emit('conversation:cleared');
    this.textarea.focus();
    return true;
  }

  clearLocalConversation() {
    this.cancelGeneration();
    this.cancelDocumentUpload();
    this._stopVerificationWatcher();
    this.hirePoolResume.reset();
    if (this.hirePoolSignup && this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.IDLE) {
      void this.hirePoolSignup.cancel();
    }
    this.activeConversationId = null;
    this.messages = [];
    this.messagesList.innerHTML = '';
    this.storage.clear();
    this._persistState();
    this._setGenerating(false);
    this.events.emit('conversation:cleared');
  }

  cancelGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this._setGenerating(false);
  }

  _setGenerating(generating) {
    this.isGenerating = generating;
    if (generating) {
      this.statusDot.classList.add('busy');
      this.statusText.textContent = 'Thinking...';
      this.sendBtn.style.display = 'none';
      this.stopBtn.style.display = 'flex';
      this.streamingIndicator.style.display = 'flex';
    } else {
      this.statusDot.classList.remove('busy');
      this.statusText.textContent = 'Online';
      this.sendBtn.style.display = 'flex';
      this.stopBtn.style.display = 'none';
      this.streamingIndicator.style.display = 'none';
      this.sendBtn.disabled = !this.textarea.value.trim();
    }
  }

  _scrollToBottom() {
    this.body.scrollTop = this.body.scrollHeight;
  }

  _stripActionBlocks(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/```(?:action:[a-zA-Z0-9_-]+|action)\s*\n[\s\S]*?\n```/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  _syncMessageActionState(action) {
    if (!action || !Array.isArray(this.messages)) return;
    for (const msg of this.messages) {
      if (msg?.action && (msg.action === action || (action.id && msg.action.id === action.id))) {
        msg.action._status = action._status;
        msg.action._statusMessage = action._statusMessage;
      }
    }
    this._persistState();
  }

  _extractAction(text, actionProp) {
    if (actionProp && typeof actionProp === 'object') {
      return actionProp;
    }
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/```(?:action:[a-zA-Z0-9_-]+|action)\s*\n([\s\S]*?)\n```/i);
    if (!match) return null;
    try {
      const data = JSON.parse(match[1].trim());
      if (data && data.action && data.title) {
        if (this.options?.assistantId === 'hirepool') {
          const hasToken = typeof data.confirmationToken === 'string' &&
            /^[A-Za-z0-9_-]{43}$/.test(data.confirmationToken);
          if (!hasToken) {
            return null;
          }
        }
        return data;
      }
    } catch {}
    return null;
  }

  _renderActionCard(bubble, action) {
    if (!action || !action.action) return;
    if (this.options?.assistantId === 'hirepool' &&
        action.requiresConfirmation === false &&
        action.action !== 'hirepool_login' &&
        action.action !== 'hirepool_signup') {
      return;
    }
    if (typeof this.options.hasActionHandler !== 'function' ||
        !this.options.hasActionHandler(action)) return;

    // Prevent duplicate action cards in same bubble
    const actionId = action.id || action.action;
    if (bubble.querySelector(`[data-action-id="${escapeHtml(actionId)}"]`)) {
      return;
    }

    const card = document.createElement('div');
    card.className = 'ai-action-card';
    card.setAttribute('data-action-id', actionId);
    card.setAttribute('data-action-type', action.action);
    this.events.emit('action:proposed', action);
    const risk = ['read', 'write', 'destructive'].includes(action.risk) ? action.risk : 'write';
    const requiresAcknowledgement = risk === 'destructive';

    const isHirePoolAccountAction = ['hirepool_login', 'hirepool_signup'].includes(action.action);
    const accountButtonLabel = action.action === 'hirepool_signup'
      ? 'Sign up for HirePool'
      : 'Log in to HirePool';
    const badgeLabel = isHirePoolAccountAction
      ? 'HirePool account'
      : (action.formattedReview ? 'Review & Confirm' : 'Application action');

    // Format parameters or structured review
    let detailsHtml = '';
    const hasReview = Boolean(action.formattedReview && typeof action.formattedReview === 'object');
    if (hasReview) {
      const review = action.formattedReview;
      let rowsHtml = '';
      if (Array.isArray(review.fields)) {
        rowsHtml = `
          <table class="ai-review-table">
            <tbody>
              ${review.fields.map(f => `
                <tr>
                  <th class="ai-review-key">${escapeHtml(f.label)}</th>
                  <td class="ai-review-val">${escapeHtml(f.value)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
      let skillsHtml = '';
      if (Array.isArray(review.requiredSkills) && review.requiredSkills.length > 0) {
        skillsHtml += `
          <div class="ai-review-section">
            <div class="ai-review-section-title">Required Skills</div>
            <div class="ai-review-tags">
              ${review.requiredSkills.map(s => `<span class="ai-review-tag">${escapeHtml(s)}</span>`).join('')}
            </div>
          </div>
        `;
      }
      if (Array.isArray(review.preferredSkills) && review.preferredSkills.length > 0) {
        skillsHtml += `
          <div class="ai-review-section">
            <div class="ai-review-section-title">Preferred Skills</div>
            <div class="ai-review-tags">
              ${review.preferredSkills.map(s => `<span class="ai-review-tag preferred">${escapeHtml(s)}</span>`).join('')}
            </div>
          </div>
        `;
      }
      let descHtml = '';
      if (review.description && typeof review.description === 'string' && review.description.trim()) {
        descHtml = `
          <div class="ai-review-section">
            <div class="ai-review-section-title">Job Description</div>
            <div class="ai-review-desc">${escapeHtml(review.description.trim())}</div>
          </div>
        `;
      }
      detailsHtml = `
        <div class="ai-review-card-content">
          ${rowsHtml}
          ${skillsHtml}
          ${descHtml}
        </div>
      `;
    } else {
      const params = action.parameters?.body || action.parameters || {};
      let paramRowsHtml = '';
      for (const [key, val] of Object.entries(params)) {
        if (key === 'continuationReference' || key === 'confirmationToken' || val === undefined || val === null || val === '') continue;
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        let formattedVal = '';
        if (typeof val === 'object') {
          if (Array.isArray(val)) {
            formattedVal = val.join(', ');
          } else {
            formattedVal = Object.entries(val)
              .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
              .join('; ');
          }
        } else {
          formattedVal = String(val);
        }
        paramRowsHtml += `
          <div class="ai-action-param-row">
            <span class="ai-action-param-key">${escapeHtml(formattedKey)}:</span>
            <span class="ai-action-param-val">${escapeHtml(formattedVal)}</span>
          </div>
        `;
      }
      if (paramRowsHtml) {
        detailsHtml = `<div class="ai-action-details">${paramRowsHtml}</div>`;
      }
    }

    const titleText = action.formattedReview?.title || action.title || 'Review Action';
    const confirmBtnLabel = action.formattedReview?.type === 'job_creation'
      ? 'Confirm &amp; Create'
      : (isHirePoolAccountAction ? accountButtonLabel : 'Confirm &amp; Execute');

    card.innerHTML = `
      <div class="ai-action-header">
        <span class="ai-action-badge">${badgeLabel}</span>
        <span class="ai-action-risk risk-${risk}">${risk === 'destructive' ? 'Destructive' : risk === 'read' ? 'Read' : 'Write'}</span>
        <span class="ai-action-title">${escapeHtml(titleText)}</span>
      </div>
      ${action.explanation ? `<p class="ai-action-explanation">${escapeHtml(action.explanation)}</p>` : ''}
      ${detailsHtml}
      ${requiresAcknowledgement ? `
        <label class="ai-action-acknowledgement">
          <input type="checkbox" class="ai-action-acknowledge">
          I understand this action may be difficult to undo.
        </label>
      ` : ''}
      <div class="ai-action-status-msg" style="display: none;"></div>
      <div class="ai-action-controls">
        <button type="button" class="ai-btn-action-confirm" ${requiresAcknowledgement ? 'disabled' : ''}>${confirmBtnLabel}</button>
        ${hasReview ? '<button type="button" class="ai-btn-action-edit">Edit details</button>' : ''}
        <button type="button" class="ai-btn-action-cancel">${isHirePoolAccountAction ? 'Not now' : 'Cancel'}</button>
      </div>
    `;

    const btnConfirm = card.querySelector('.ai-btn-action-confirm');
    const btnCancel = card.querySelector('.ai-btn-action-cancel');
    const btnEdit = card.querySelector('.ai-btn-action-edit');
    const statusMsg = card.querySelector('.ai-action-status-msg');
    const controls = card.querySelector('.ai-action-controls');
    const acknowledgement = card.querySelector('.ai-action-acknowledge');

    if (action._status && action._status !== 'pending') {
      if (controls) controls.style.display = 'none';
      if (acknowledgement) acknowledgement.disabled = true;
      btnConfirm.disabled = true;
      btnCancel.disabled = true;
      if (btnEdit) btnEdit.disabled = true;
      statusMsg.style.display = 'flex';
      statusMsg.className = `ai-action-status-msg ${action._status === 'completed' ? 'success' : action._status}`;
      statusMsg.textContent = action._statusMessage || (
        action._status === 'completed'
          ? 'Action executed successfully!'
          : action._status === 'cancelled'
            ? 'Action cancelled.'
            : 'Action could not be completed.'
      );
      bubble.appendChild(card);
      this._scrollToBottom();
      return;
    }

    if (btnEdit) {
      btnEdit.addEventListener('click', () => {
        this.textarea.focus();
        this.textarea.placeholder = 'Type changes to profile, job, or candidate details...';
        this._scrollToBottom();
      });
    }

    let executing = false;
    let timeoutId = null;

    acknowledgement?.addEventListener('change', () => {
      btnConfirm.disabled = !acknowledgement.checked;
    });

    btnConfirm.addEventListener('click', () => {
      if (executing || (action._status && action._status !== 'pending')) return;

      if (action.action === 'hirepool_signup') {
        card.remove();
        void this._startHirePoolSignup(action.parameters?.role || null);
        return;
      }

      executing = true;
      btnConfirm.disabled = true;
      btnCancel.disabled = true;

      statusMsg.style.display = 'flex';
      statusMsg.className = 'ai-action-status-msg executing';
      statusMsg.textContent = isHirePoolAccountAction
        ? 'Opening HirePool login...'
        : 'Executing action in the host application...';

      let handled = false;

      // Safety timeout if host does not respond within 15 seconds
      timeoutId = setTimeout(() => {
        if (!handled && executing) {
          executing = false;
          statusMsg.style.display = 'flex';
          statusMsg.className = 'ai-action-status-msg error';
          if (action.confirmationToken) {
            const timeoutMsg = 'The confirmation result was not received. Do not retry this write; check HirePool application history before asking for a fresh readiness check.';
            statusMsg.textContent = timeoutMsg;
            controls.style.display = 'none';
            action._status = 'error';
            action._statusMessage = timeoutMsg;
            this._syncMessageActionState(action);
          } else {
            statusMsg.textContent = 'Action timed out before confirmation completed. Click Retry to try again or Cancel to dismiss.';
            btnConfirm.disabled = false;
            btnCancel.disabled = false;
            btnConfirm.textContent = 'Retry';
          }
        }
      }, 15000);

      this.events.emit('action:execute', {
        actionId: action.id,
        action: action.action,
        parameters: action.parameters || {},
        confirmationToken: action.confirmationToken,
        resolve: (result) => {
          handled = true;
          executing = false;
          clearTimeout(timeoutId);
          const successMsg = result?.message || 'Action executed successfully!';
          statusMsg.style.display = 'flex';
          statusMsg.className = 'ai-action-status-msg success';
          statusMsg.innerHTML = `${ICONS.check} ${escapeHtml(successMsg)}`;
          controls.style.display = 'none';
          action._status = 'completed';
          action._statusMessage = successMsg;
          this._syncMessageActionState(action);
          this.events.emit('action:success', { actionId: action.id, action: action.action, result });
          this._scrollToBottom();
        },
        reject: (err) => {
          handled = true;
          executing = false;
          clearTimeout(timeoutId);
          const errorMsg = err?.message || 'Action failed';
          statusMsg.style.display = 'flex';
          statusMsg.className = 'ai-action-status-msg error';
          statusMsg.innerHTML = `⚠️ ${escapeHtml(errorMsg)}`;
          const isTerminalWriteError = Boolean(action.confirmationToken) || (err?.status >= 400 && err?.status < 500);
          if (isTerminalWriteError) {
            controls.style.display = 'none';
            action._status = 'error';
            action._statusMessage = errorMsg;
            this._syncMessageActionState(action);
          } else {
            btnConfirm.disabled = false;
            btnCancel.disabled = false;
            btnConfirm.textContent = 'Retry';
          }
          this.events.emit('action:error', { actionId: action.id, action: action.action, error: err });
          this._scrollToBottom();
        }
      });
    });

    btnCancel.addEventListener('click', () => {
      if (executing || (action._status && action._status !== 'pending')) return;
      btnConfirm.disabled = true;
      btnCancel.disabled = true;
      clearTimeout(timeoutId);
      controls.style.display = 'none';
      statusMsg.style.display = 'flex';
      statusMsg.className = 'ai-action-status-msg cancelled';
      statusMsg.textContent = 'Action cancelled.';
      action._status = 'cancelled';
      action._statusMessage = 'Action cancelled.';
      this._syncMessageActionState(action);
      this.events.emit('action:cancel', {
        actionId: action.id,
        action: action.action,
        confirmationToken: action.confirmationToken
      });
      this._scrollToBottom();
    });

    bubble.appendChild(card);
    this._scrollToBottom();
  }

  _isHirePoolResumeEnabled() {
    return this.options.assistantId === 'hirepool' &&
      this.options.applicationId === 'hirepool-local-app' &&
      typeof this.apiClient.prepareHirePoolResume === 'function';
  }

  setHostIdentity(identity, sessionScope = null) {
    this.hostIdentity = identity;
    const roleType = identity?.user_type || identity?.userType;
    if (this.attachBtn && this._isHirePoolResumeEnabled()) {
      const eligible = roleType === 'candidate';
      this.attachBtn.disabled = !eligible;
      this.attachBtn.title = eligible
        ? 'Attach a PDF resume'
        : 'Sign in to a verified HirePool candidate account to upload a resume.';
      this.attachBtn.setAttribute('aria-label', this.attachBtn.title);
    }
    return this.hirePoolResume.setIdentity(identity, sessionScope);
  }

  _handleHirePoolResumeFile(file) {
    const roleType = this.hostIdentity?.user_type || this.hostIdentity?.userType;
    if (roleType !== 'candidate') {
      this._renderHirePoolResumeError('Sign in to a verified HirePool candidate account to upload a resume.');
      return;
    }
    try {
      this.hirePoolResume.selectFile(file, this.activeConversationId);
    } catch (error) {
      this._renderHirePoolResumeError(error.message);
    }
  }

  _renderHirePoolResumeError(message) {
    const row = document.createElement('div');
    row.className = 'ai-message-row assistant';
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    const error = document.createElement('p');
    error.className = 'ai-action-status-msg error';
    error.textContent = message;
    bubble.appendChild(error);
    row.appendChild(bubble);
    this.messagesList.appendChild(row);
    this._scrollToBottom();
  }

  _renderHirePoolResumeState(state) {
    if (state.conversationId && !this.activeConversationId) {
      this.activeConversationId = state.conversationId;
      this._persistState();
    }
    const busy = state.state === HIREPOOL_RESUME_STATES.PREPARING ||
      state.state === HIREPOOL_RESUME_STATES.UPLOADING;
    if (this.attachBtn && this._isHirePoolResumeEnabled()) {
      this.attachBtn.disabled = busy || this.hostIdentity?.user_type !== 'candidate';
    }
    if (state.state === HIREPOOL_RESUME_STATES.IDLE) {
      this.hirePoolResumeCard?.remove();
      this.hirePoolResumeCard = null;
      return;
    }
    if (!this.messagesList) return;

    if (!this.hirePoolResumeCard) {
      const row = document.createElement('div');
      row.className = 'ai-message-row assistant';
      const bubble = document.createElement('div');
      bubble.className = 'ai-bubble';
      const card = document.createElement('section');
      card.className = 'ai-hirepool-resume-card';
      card.setAttribute('aria-live', 'polite');
      bubble.appendChild(card);
      row.appendChild(bubble);
      this.messagesList.appendChild(row);
      this.hirePoolResumeCard = card;
    }

    const card = this.hirePoolResumeCard;
    card.replaceChildren();
    const addText = (tagName, className, text) => {
      const node = document.createElement(tagName);
      if (className) node.className = className;
      node.textContent = text;
      card.appendChild(node);
      return node;
    };
    const addButton = (label, className, handler, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.disabled = disabled;
      button.addEventListener('click', handler);
      controls.appendChild(button);
      return button;
    };
    const controls = document.createElement('div');
    controls.className = 'ai-hirepool-resume-controls';
    const filename = state.filename || 'Selected resume';
    const size = Number.isInteger(state.fileSize)
      ? formatHirePoolResumeSize(state.fileSize)
      : '';
    const fileDescription = size ? `${filename} (${size})` : filename;

    if (state.state === HIREPOOL_RESUME_STATES.FILE_SELECTED) {
      addText('strong', '', fileDescription);
      addText('p', '', 'Review the selected PDF before preparing a secure upload.');
      addButton('Remove', 'ai-btn-resume-remove', () => this.hirePoolResume.removeFile());
      addButton('Prepare upload', 'ai-btn-resume-prepare', () => {
        void this.hirePoolResume.prepare(this.activeConversationId);
      });
    } else if (state.state === HIREPOOL_RESUME_STATES.PREPARING) {
      addText('strong', '', 'Preparing resume upload…');
      addText('p', '', 'Your PDF is being securely staged. It is not being sent to the assistant.');
      addText('span', 'ai-spinner', '');
    } else if (state.state === HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION) {
      addText('strong', '', fileDescription);
      addText(
        'p',
        '',
        state.replacingExisting
          ? 'Confirming will replace the resume currently stored in your HirePool profile.'
          : 'Confirm to upload this resume to your HirePool profile.'
      );
      addButton('Confirm upload', 'ai-btn-resume-confirm', () => {
        void this.hirePoolResume.confirm();
      });
      addButton('Cancel', 'ai-btn-resume-cancel', () => {
        void this.hirePoolResume.cancel();
      });
    } else if (state.state === HIREPOOL_RESUME_STATES.UPLOADING) {
      addText('strong', '', state.message || 'Uploading resume…');
      addText('span', 'ai-spinner', '');
    } else if (state.state === HIREPOOL_RESUME_STATES.UPLOAD_SUCCESS) {
      addText('strong', '', 'Your resume was uploaded and verified by HirePool.');
    } else if (state.state === HIREPOOL_RESUME_STATES.UPLOAD_UNVERIFIED) {
      addText('strong', '', 'HirePool may have accepted the resume, but the result could not be verified.');
      addText('p', '', 'Check your HirePool profile before trying another upload.');
    } else if (state.state === HIREPOOL_RESUME_STATES.UPLOAD_FAILED) {
      addText('strong', '', state.error || 'HirePool could not complete the resume operation.');
      if (state.filename) {
        addText('p', '', 'You can select a PDF again after checking your HirePool profile.');
      }
    } else if (state.state === HIREPOOL_RESUME_STATES.CANCELLED) {
      addText('p', 'ai-document-cancelled', 'The prepared resume upload was cancelled.');
    }

    if (state.state === HIREPOOL_RESUME_STATES.FILE_SELECTED ||
        state.state === HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION) {
      card.appendChild(controls);
    }
    this._scrollToBottom();
  }

  _stopVerificationWatcher() {
    if (this._verificationPollTimer) {
      clearInterval(this._verificationPollTimer);
      this._verificationPollTimer = null;
    }
    if (this._verificationFocusHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('focus', this._verificationFocusHandler);
      this._verificationFocusHandler = null;
    }
    if (this._verificationVisibilityHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this._verificationVisibilityHandler);
      this._verificationVisibilityHandler = null;
    }
  }

  _startVerificationWatcher() {
    this._stopVerificationWatcher();

    const triggerCheck = async () => {
      if (
        !this.hirePoolSignup ||
        (this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING &&
          this.hirePoolSignup.state !== HIREPOOL_SIGNUP_STATES.VERIFICATION_PENDING)
      ) {
        this._stopVerificationWatcher();
        return;
      }
      try {
        await this.hirePoolSignup.checkVerificationStatus({ silent: true });
      } catch (err) {
        if (/expired/i.test(err?.message || '')) {
          this._stopVerificationWatcher();
        }
      }
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._verificationFocusHandler = () => {
        void triggerCheck();
      };
      window.addEventListener('focus', this._verificationFocusHandler);
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this._verificationVisibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          void triggerCheck();
        }
      };
      document.addEventListener('visibilitychange', this._verificationVisibilityHandler);
    }

    let pollsRemaining = 100; // Up to 5 minutes at 3s intervals
    this._verificationPollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      pollsRemaining -= 1;
      if (pollsRemaining <= 0) {
        this._stopVerificationWatcher();
        return;
      }
      void triggerCheck();
    }, 3000);
    this._verificationPollTimer.unref?.();
  }

  _renderHirePoolSignupState(state, data) {
    if (this.hirePoolSignupCard) {
      this.hirePoolSignupCard.remove();
      this.hirePoolSignupCard = null;
    }

    const isPendingVerificationState =
      state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING ||
      state === HIREPOOL_SIGNUP_STATES.VERIFICATION_PENDING;
    const isInProgressVerificationState =
      state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_IN_PROGRESS ||
      state === HIREPOOL_SIGNUP_STATES.VERIFICATION_IN_PROGRESS;

    if (!isPendingVerificationState && !isInProgressVerificationState) {
      this._stopVerificationWatcher();
    }

    if (state === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFIED) {
      this._appendAssistantSignupNotice(
        'Your email has been verified! Complete your HirePool profile details below to finish creating your account.'
      );
    }

    const safeSnapshot = this.hirePoolSignup.getSafeProgressSnapshot?.();
    if (safeSnapshot) {
      this.storage.saveSignupProgress?.(safeSnapshot);
    } else {
      this.storage.clearSignupProgress?.();
    }

    if (state === HIREPOOL_SIGNUP_STATES.IDLE || state === HIREPOOL_SIGNUP_STATES.CANCELLED) {
      return;
    }

    const row = document.createElement('div');
    row.className = 'ai-message-row assistant ai-signup-row';
    let card = null;

    if (state === HIREPOOL_SIGNUP_STATES.ROLE_SELECTION) {
      card = renderRoleSelectionCard({
        onSelect: (role) => void this.hirePoolSignup.selectRole(role),
        onCancel: () => void this.hirePoolSignup.cancel()
      });
    } else if (state === HIREPOOL_SIGNUP_STATES.SIGNUP_FORM) {
      card = renderSignupFormCard({
        role: data.role || this.hirePoolSignup.selectedRole,
        agreement: data.agreement || this.hirePoolSignup.agreement,
        onSubmit: (formData) => this.hirePoolSignup.submitSignup(formData),
        onCancel: () => void this.hirePoolSignup.cancel()
      });
    } else if (isPendingVerificationState || isInProgressVerificationState) {
      const verificationUrl = data.verificationUrl ?? this.hirePoolSignup.verificationUrl ?? null;
      if (isPendingVerificationState) {
        this._startVerificationWatcher();
      }
      card = renderVerificationCard({
        email: data.session?.email || this.hirePoolSignup.session?.email,
        verificationUrl,
        notVerifiedYet: Boolean(data.notVerifiedYet),
        message: data.message,
        error: data.error,
        onVerifyClick: (url) => {
          if (typeof window !== 'undefined' && typeof window.open === 'function') {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
          this._startVerificationWatcher();
        },
        onCheckStatus: () => this.hirePoolSignup.checkVerificationStatus(),
        onResend: () => this.hirePoolSignup.resendVerification(),
        onCancel: () => void this.hirePoolSignup.cancel()
      });
    } else if (state === HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION) {
      card = renderProfileCollectionCard({
        role: data.role || this.hirePoolSignup.selectedRole,
        profileData: data.profileData || this.hirePoolSignup.profileData,
        missingFields: data.missingFields || this.hirePoolSignup.missingFields,
        onReview: (updatedData) => {
          this.hirePoolSignup.profileData = { ...this.hirePoolSignup.profileData, ...updatedData };
          this.hirePoolSignup.setState(HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW, {
            profileData: this.hirePoolSignup.profileData
          });
        },
        onCancel: () => void this.hirePoolSignup.cancel()
      });
    } else if (state === HIREPOOL_SIGNUP_STATES.PROFILE_REVIEW) {
      card = renderProfileReviewCard({
        role: data.role || this.hirePoolSignup.selectedRole,
        profileData: data.profileData || this.hirePoolSignup.profileData,
        onConfirm: () => this.hirePoolSignup.completeProfile(),
        onEdit: () => {
          this.hirePoolSignup.setState(HIREPOOL_SIGNUP_STATES.PROFILE_COLLECTION, {
            profileData: this.hirePoolSignup.profileData,
            missingFields: this.hirePoolSignup.missingFields
          });
        },
        onCancel: () => void this.hirePoolSignup.cancel()
      });
    }

    if (card) {
      this.hirePoolSignupCard = card;
      row.appendChild(card);
      this.messagesList.appendChild(row);
      this._scrollToBottom();
    }
  }

  async _handleHirePoolSignupSuccess(sessionData) {
    if (!sessionData?.credential) {
      throw new Error('Authentication transition failed: missing SDK session credential.');
    }

    // Step 1: User / conversation scoping
    const newUserId = sessionData.identity?.id;
    const previousSession = this.storage.get('hirepool_session', null);
    const previousUserId = previousSession?.identity?.id;

    if (typeof this.storage.setUser === 'function') {
      this.storage.setUser(newUserId);
    }

    if (previousUserId && previousUserId !== newUserId) {
      this.activeConversationId = null;
      this.storage.clearConversationId();
      this.messages = [];
      if (this.messagesList) {
        this.messagesList.innerHTML = '';
      }
    }

    // Step 2: Establish authenticated session in API client, storage, and host identity
    this.storage.clearSignupProgress?.();
    this.apiClient.setAuthenticatedSession(sessionData);
    this.storage.set('hirepool_session', sessionData);
    this.setHostIdentity(sessionData.identity, sessionData.sessionScope);

    if (this.options.integration) {
      this.options.integration.getAuthHeaders = async () => ({ Authorization: `Bearer ${sessionData.credential}` });
      this.options.integration.getSessionScope = async () => sessionData.sessionScope;
      this.options.integration.getIdentity = async () => sessionData.identity;
      if (typeof this.options.integration.setSession === 'function') {
        this.options.integration.setSession(sessionData);
      }
    }

    // Step 3: Run authentication smoke test to verify backend readiness before claiming success
    const runSmokeTest = async () => {
      try {
        const smokeResult = await this.apiClient.validateHirePoolSession(sessionData.credential);
        if (!smokeResult?.valid) {
          throw new Error('HirePool could not validate the newly established session.');
        }
        this._dismissRecoverableBanner();
        this._displaySignupConfirmation(sessionData);
        this.events.emit('auth:session', sessionData);
        return true;
      } catch (smokeErr) {
        console.warn('[AI Assistant] Smoke test failed after account creation:', smokeErr);
        this._renderRecoverableWarningBanner(
          'Account created successfully! However, assistant session verification timed out.',
          'Retry Connection',
          () => runSmokeTest()
        );
        return false;
      }
    };

    await runSmokeTest();
  }

  _displaySignupConfirmation(sessionData) {
    const role = sessionData.role || sessionData.identity?.userType;
    let greeting = 'Welcome to HirePool!';
    let prompts = [];
    let welcomeMsg = '';

    if (role === 'candidate') {
      greeting = 'Welcome back. I can help with matching jobs, applications, and your profile.';
      prompts = ['Find matching jobs', 'View my profile', 'My applications'];
      welcomeMsg = `🎉 **Welcome to HirePool!** Your candidate account is verified and your profile is complete. You can now use the assistant to access your account and explore jobs.`;
    } else if (role === 'client') {
      greeting = 'Welcome back. I can help with your hiring dashboard and jobs.';
      prompts = ['View my jobs', 'View company profile', 'Dashboard stats'];
      welcomeMsg = `🎉 **Welcome to HirePool!** Your company account is verified and your profile is complete. You can now use the assistant to manage your job listings and view applications.`;
    } else if (role === 'consultancy') {
      greeting = 'Welcome back. I can help with placements, bench candidates, and your consultancy dashboard.';
      prompts = ['View candidate pool', 'Add a candidate', 'Placement stats', 'View agency profile'];
      welcomeMsg = `🎉 **Welcome to HirePool!** Your consultancy account is verified and your profile is complete. You can now use the assistant to manage bench candidates, track placements, and view your consultancy dashboard.`;
    }

    this.setGreeting(greeting, prompts);
    this._renderMessageBubble('assistant', welcomeMsg);
    this.messages.push({ role: 'assistant', content: welcomeMsg });
    this._persistState();

    // Render quick action prompt pills right below the message
    const pillRow = document.createElement('div');
    pillRow.className = 'ai-message-row assistant';
    const pillContainer = document.createElement('div');
    pillContainer.className = 'ai-suggested-prompts';
    pillContainer.style.marginTop = '4px';
    pillContainer.style.marginBottom = '8px';
    prompts.forEach(promptText => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-prompt-chip';
      btn.textContent = promptText;
      btn.addEventListener('click', () => {
        this.sendMessage(promptText);
      });
      pillContainer.appendChild(btn);
    });
    pillRow.appendChild(pillContainer);
    this.messagesList.appendChild(pillRow);
    this._scrollToBottom();
  }

  _handleFileUpload(file) {
    if (!file) return;

    const settings = this.options.documentUpload;
    if (!settings?.enabled) {
      this._renderMessageBubble('assistant', 'Document upload is disabled for this assistant.');
      return;
    }

    const filename = typeof file.name === 'string' ? file.name : 'document';
    const extension = '.' + filename.split('.').pop().toLowerCase();
    if (!settings.allowedExtensions.includes(extension)) {
      this._renderMessageBubble('assistant', 'Unsupported document type.');
      return;
    }
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > settings.maxSizeBytes) {
      const limitMb = Math.floor(settings.maxSizeBytes / (1024 * 1024));
      this._renderMessageBubble('assistant', `Document exceeds the ${limitMb} MB upload limit or is empty.`);
      return;
    }

    const sizeFormatted = (file.size / 1024).toFixed(0) + ' KB';
    const hasHostListener = Boolean(this.events?.listeners?.get('file:upload')?.size > 0);
    const consent = settings.consent;
    const consentId = `ai-document-consent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const row = document.createElement('div');
    row.className = 'ai-message-row assistant';
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    const description = hasHostListener ? consent.hostDescription : consent.description;
    const checkboxLabel = hasHostListener ? consent.hostCheckboxLabel : consent.checkboxLabel;

    bubble.innerHTML = `
      <section class="ai-document-consent" role="group" aria-labelledby="${consentId}-title">
        <h3 id="${consentId}-title">${escapeHtml(consent.title)}</h3>
        <p>${escapeHtml(description)}</p>
        <label class="ai-document-consent-choice" for="${consentId}-accepted">
          <input id="${consentId}-accepted" type="checkbox" class="ai-document-consent-checkbox">
          <span>${escapeHtml(checkboxLabel)}</span>
        </label>
        <div class="ai-document-consent-controls">
          <button type="button" class="ai-btn-document-consent-accept" disabled>Continue</button>
          <button type="button" class="ai-btn-document-consent-cancel">Cancel</button>
        </div>
      </section>
    `;
    row.appendChild(bubble);
    this.messagesList.appendChild(row);
    this._scrollToBottom();

    const checkbox = bubble.querySelector('.ai-document-consent-checkbox');
    const acceptButton = bubble.querySelector('.ai-btn-document-consent-accept');
    const cancelButton = bubble.querySelector('.ai-btn-document-consent-cancel');
    checkbox.addEventListener('change', () => {
      acceptButton.disabled = !checkbox.checked;
    });
    acceptButton.addEventListener('click', () => {
      if (!checkbox.checked || acceptButton.disabled) return;
      this.events.emit('document:consent-accepted', { filename });
      this._processFileUpload(file, bubble, sizeFormatted, hasHostListener);
    });
    cancelButton.addEventListener('click', () => {
      bubble.innerHTML = '<p class="ai-document-cancelled">Document processing cancelled. The file was not sent.</p>';
      this.events.emit('document:consent-rejected', { filename });
      this._scrollToBottom();
    });
  }

  _processFileUpload(file, bubble, sizeFormatted, hasHostListener) {
    const filename = typeof file.name === 'string' ? file.name : 'document';
    const controller = new AbortController();
    this.documentUploadController = controller;
    const uploadMessage = `Uploaded document: ${filename} (${sizeFormatted})`;
    this.messages.push({ role: 'user', content: uploadMessage });
    this._renderMessageBubble('user', uploadMessage);
    this._persistState();

    bubble.innerHTML = `
      <div class="ai-processing-state">
        <span class="ai-spinner"></span>
        <span>Processing <strong>${escapeHtml(filename)}</strong>...</span>
        <button type="button" class="ai-btn-document-cancel">Cancel</button>
      </div>
    `;
    const cancelButton = bubble.querySelector('.ai-btn-document-cancel');
    cancelButton.addEventListener('click', () => controller.abort(), { once: true });

    const showCancelled = () => {
      bubble.innerHTML = '<p class="ai-document-cancelled">Document processing cancelled.</p>';
      this.events.emit('document:cancelled', { filename });
      if (this.documentUploadController === controller) this.documentUploadController = null;
      this._scrollToBottom();
    };
    controller.signal.addEventListener('abort', showCancelled, { once: true });

    if (hasHostListener) {
      let handled = false;
      const timeout = setTimeout(() => {
        if (handled || controller.signal.aborted) return;
        handled = true;
        if (this.documentUploadController === controller) this.documentUploadController = null;
        bubble.innerHTML = '<p class="ai-action-status-msg error">The host application did not complete document processing in time.</p>';
        this._scrollToBottom();
      }, 45000);

      this.events.emit('file:upload', {
        file,
        filename,
        fileSize: file.size,
        fileType: file.type,
        signal: controller.signal,
        resolve: (result) => {
          if (handled || controller.signal.aborted) return;
          handled = true;
          clearTimeout(timeout);
          if (this.documentUploadController === controller) this.documentUploadController = null;
          const message = typeof result?.message === 'string'
            ? result.message
            : 'The host application processed the document.';
          bubble.innerHTML = `<p class="ai-document-host-result">${escapeHtml(message)}</p>`;
          this.events.emit('document:host-processed', { filename, result });
          this._scrollToBottom();
        },
        reject: (error) => {
          if (handled || controller.signal.aborted) return;
          handled = true;
          clearTimeout(timeout);
          if (this.documentUploadController === controller) this.documentUploadController = null;
          bubble.innerHTML = `<p class="ai-action-status-msg error">${escapeHtml(error?.message || 'The host application could not process this document.')}</p>`;
          this._scrollToBottom();
        }
      });
      controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
      return;
    }

    this.apiClient.uploadDocument(file, this.activeConversationId, {
      assistantId: this.config?.assistantId,
      consentAccepted: true,
      signal: controller.signal
    }).then(async (data) => {
      if (controller.signal.aborted) {
        await this.apiClient.removeDocument(data.conversationId, data.document.id);
        return;
      }
      if (data.conversationId && !this.activeConversationId) {
        this.activeConversationId = data.conversationId;
        this._persistState();
      }
      const doc = data.document;
      const wordsCount = doc.wordCount || Math.round(doc.textLength / 5) || 0;
      const pageInfo = doc.pageCount ? ` • ${doc.pageCount} page${doc.pageCount > 1 ? 's' : ''}` : '';
      bubble.innerHTML = `
        <div class="ai-doc-card">
          <div class="ai-doc-header">
            <div class="ai-doc-icon">📄</div>
            <div class="ai-doc-details">
              <div class="ai-doc-title">${escapeHtml(doc.filename)}</div>
              <div class="ai-doc-meta">${escapeHtml(doc.fileType.toUpperCase())} • ${sizeFormatted}${pageInfo} • ${wordsCount} words</div>
            </div>
            <div class="ai-doc-badge">Ready for questions</div>
          </div>
          <p class="ai-doc-hint">You can ask questions about the extracted text. The text is temporary and limited to this conversation session.</p>
          <button type="button" class="ai-btn-document-remove" aria-label="Remove ${escapeHtml(doc.filename)} from this conversation">Remove document</button>
        </div>
      `;
      const knownDocuments = this.storage.get('documents', []);
      this.storage.set('documents', [...knownDocuments.filter(item => item.id !== doc.id), doc]);
      this.messages.push({ role: 'assistant', content: `Processed document: ${doc.filename}. Ready for questions.` });
      this._persistState();
      bubble.querySelector('.ai-btn-document-remove').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try {
          await this.apiClient.removeDocument(this.activeConversationId, doc.id);
          const remaining = this.storage.get('documents', []).filter(item => item.id !== doc.id);
          this.storage.set('documents', remaining);
          bubble.innerHTML = '<p class="ai-document-cancelled">Document removed from this conversation.</p>';
          this.events.emit('document:removed', doc);
        } catch (error) {
          event.currentTarget.disabled = false;
          this._renderErrorBanner(error.message);
          this.events.emit('error', error);
        }
        this._scrollToBottom();
      });
      this.events.emit('document:uploaded', doc);
      this._scrollToBottom();
    }).catch((error) => {
      if (error.name === 'AbortError') return;
      bubble.innerHTML = `<p class="ai-action-status-msg error">${escapeHtml(error?.message || 'Failed to process document')}</p>`;
      this._scrollToBottom();
    }).finally(() => {
      controller.signal.removeEventListener('abort', showCancelled);
      if (this.documentUploadController === controller) this.documentUploadController = null;
    });
  }

  cancelDocumentUpload() {
    this.documentUploadController?.abort();
    this.documentUploadController = null;
  }

  _renderMessageBubble(role, content, animate = true, action = null) {
    const row = document.createElement('div');
    row.className = `ai-message-row ${role}`;
    row.setAttribute('data-raw-content', content);

    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';

    if (role === 'user') {
      bubble.textContent = content;
      row.appendChild(bubble);
    } else {
      const renderedContent = this.options?.assistantId === 'hirepool'
        ? this._stripActionBlocks(content)
        : content;
      bubble.innerHTML = parseMarkdown(renderedContent);
      const detectedAction = action || this._extractAction(content);
      if (detectedAction) {
        this._renderActionCard(bubble, detectedAction);
      }
      row.appendChild(bubble);

      // Add copy button action bar
      const actions = document.createElement('div');
      actions.className = 'ai-message-actions';
      actions.innerHTML = `
        <button class="ai-msg-action-btn" type="button" aria-label="Copy response">
          ${ICONS.copy} Copy
        </button>
      `;
      row.appendChild(actions);
    }

    this.messagesList.appendChild(row);
    this._scrollToBottom();
    return row;
  }

  _renderRecoverableWarningBanner(message, actionText = 'Retry Connection', actionCallback = null) {
    this._dismissRecoverableBanner();
    const banner = document.createElement('div');
    banner.className = 'ai-warning-banner ai-recoverable-banner';
    banner.style.cssText = 'background: #fff3cd; color: #856404; border: 1px solid #ffeeba; border-radius: 8px; padding: 10px 14px; margin: 8px 12px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; gap: 8px;';
    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    banner.appendChild(textSpan);

    if (actionCallback) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-warning-action-btn';
      btn.style.cssText = 'background: #856404; color: #ffffff; border: none; border-radius: 4px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;';
      btn.textContent = actionText;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Verifying...';
        try {
          await actionCallback();
        } finally {
          btn.disabled = false;
          btn.textContent = actionText;
        }
      });
      banner.appendChild(btn);
    }
    this._recoverableBanner = banner;
    this.messagesList.appendChild(banner);
    this._scrollToBottom();
  }

  _dismissRecoverableBanner() {
    if (this._recoverableBanner && this._recoverableBanner.parentNode) {
      this._recoverableBanner.parentNode.removeChild(this._recoverableBanner);
      this._recoverableBanner = null;
    }
  }

  _renderErrorBanner(message) {
    const banner = document.createElement('div');
    banner.className = 'ai-error-banner';
    banner.innerHTML = `
      <span>${escapeHtml(message || 'An error occurred. Please try again.')}</span>
      <button class="ai-error-retry-btn" type="button">Retry</button>
    `;
    this.messagesList.appendChild(banner);
    this._scrollToBottom();
  }

  displayHirePoolLoginNotice(message) {
    this._renderMessageBubble('assistant', message, false, {
      id: `hirepool-login-recovery-${Date.now()}`,
      action: 'hirepool_login',
      title: 'Sign in to HirePool',
      explanation: 'Renew your HirePool session. The assistant will verify your account again after sign-in.',
      parameters: {},
      risk: 'read',
      requiresConfirmation: true
    });
  }

  invalidatePendingActions(message) {
    for (const card of this.messagesList.querySelectorAll('.ai-action-card')) {
      if (['hirepool_login', 'hirepool_signup'].includes(card.getAttribute('data-action-type'))) continue;
      const controls = card.querySelector('.ai-action-controls');
      const status = card.querySelector('.ai-action-status-msg');
      if (controls) controls.style.display = 'none';
      if (status) {
        status.style.display = 'flex';
        status.className = 'ai-action-status-msg cancelled';
        status.textContent = message;
      }
    }
  }

  _isGuestSession() {
    if (this.apiClient?.getAuthenticatedSession?.()) return false;
    if (this.hostIdentity?.id || this.hostIdentity?.email) return false;
    const ctx = this.options?.context;
    if (ctx && typeof ctx === 'object' && ctx.authentication?.identity) return false;
    if (typeof ctx === 'string' && ctx.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(ctx);
        if (parsed?.authentication?.identity) return false;
      } catch {}
    }
    return true;
  }

  _isHirePoolSignupEnabled() {
    return Boolean(
      (!this.options?.assistantId || this.options.assistantId === 'hirepool') &&
      typeof this.apiClient?.getSignupAgreement === 'function'
    );
  }

  _buildChatContextPayload(rawContext) {
    let baseContext = typeof rawContext === 'string' && rawContext.trim().length > 0
      ? rawContext.trim()
      : '';

    const activeSignupStates = new Set([
      HIREPOOL_SIGNUP_STATES.IDLE,
      HIREPOOL_SIGNUP_STATES.CANCELLED,
      HIREPOOL_SIGNUP_STATES.COMPLETED
    ]);

    if (this._isHirePoolSignupEnabled() && this.hirePoolSignup && !activeSignupStates.has(this.hirePoolSignup.state)) {
      const rolePart = this.hirePoolSignup.selectedRole
        ? ` role=${this.hirePoolSignup.selectedRole}`
        : '';
      const tag = `[HIREPOOL_SIGNUP_STATE state=${this.hirePoolSignup.state}${rolePart}]`;
      baseContext = baseContext ? `${baseContext}\n${tag}` : tag;
    }

    return baseContext || undefined;
  }

  _appendAssistantSignupNotice(text) {
    this._renderMessageBubble('assistant', text, true);
    this.messages.push({ role: 'assistant', content: text });
    this._persistState();
    this.events.emit('message:received', { role: 'assistant', content: text });
  }

  async _startHirePoolSignup(initialRole = null) {
    try {
      await this.hirePoolSignup.start(initialRole || null);
    } catch (error) {
      this._renderErrorBanner(error?.message || 'Unable to start HirePool signup.');
    }
  }

  async _handleHirePoolSignupConversation(trimmed) {
    if (!this._isGuestSession() || !this._isHirePoolSignupEnabled()) {
      return false;
    }

    const signupState = this.hirePoolSignup.state;
    const inActiveSignup = ![
      HIREPOOL_SIGNUP_STATES.IDLE,
      HIREPOOL_SIGNUP_STATES.CANCELLED,
      HIREPOOL_SIGNUP_STATES.COMPLETED
    ].includes(signupState);

    if (inActiveSignup) {
      if (/^\s*(?:cancel|stop|quit|never\s*mind|close\s+signup)(?:\s+signup)?\s*[.!?]*\s*$/i.test(trimmed)) {
        await this.hirePoolSignup.cancel();
        this._appendAssistantSignupNotice(
          'Signup has been cancelled. Ask me anything about HirePool or say "Signup" whenever you would like to start again.'
        );
        return true;
      }

      if (
        signupState === HIREPOOL_SIGNUP_STATES.ROLE_SELECTION ||
        signupState === HIREPOOL_SIGNUP_STATES.SIGNUP_FORM ||
        signupState === HIREPOOL_SIGNUP_STATES.ERROR
      ) {
        const parsedRole = parseHirePoolRoleChoice(trimmed);
        const explicitRolePhrase = /^\s*(?:i(?:'m| am)\s+(?:a|an)\s+|i\s+(?:want|would\s+like|'d\s+like)\s+(?:to\s+(?:join|sign\s*up|register)\s+as\s+)?(?:a|an)\s+|as\s+(?:a|an)\s+|join\s+(?:hirepool\s+)?as\s+(?:a|an)\s+|switch\s+(?:role\s+)?to\s+|change\s+(?:role\s+)?to\s+|select\s+|choose\s+)?(?:candidate|job\s*seeker|company|client|employer|consultancy|agency|staffing(?:\s+agency)?)\b/i.test(trimmed);

        if (parsedRole && (signupState === HIREPOOL_SIGNUP_STATES.ROLE_SELECTION || explicitRolePhrase)) {
          const canonicalRole = parsedRole === 'staffing' ? 'consultancy' : parsedRole;
          const label = ROLE_DEFINITIONS[canonicalRole]?.label || canonicalRole;
          this._appendAssistantSignupNotice(
            `Great — I selected the **${label}** role and loaded your HirePool registration form below.`
          );
          try {
            await this.hirePoolSignup.selectRole(parsedRole);
          } catch (error) {
            this._renderErrorBanner(error?.message || 'Unable to load the selected signup role.');
          }
          return true;
        }
      }

      if (
        signupState === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_PENDING ||
        signupState === HIREPOOL_SIGNUP_STATES.VERIFICATION_PENDING ||
        signupState === HIREPOOL_SIGNUP_STATES.EMAIL_VERIFICATION_IN_PROGRESS ||
        signupState === HIREPOOL_SIGNUP_STATES.VERIFICATION_IN_PROGRESS
      ) {
        if (/\b(?:resend|send\s+again|new\s+(?:link|email|verification))\b/i.test(trimmed)) {
          try {
            await this.hirePoolSignup.resendVerification();
            this._appendAssistantSignupNotice(
              'I requested a fresh verification email. Please check your inbox and click Verify once you have opened the link.'
            );
          } catch (error) {
            this._renderErrorBanner(error?.message || 'Could not resend verification email.');
          }
          return true;
        }

        if (/^\s*(?:done|verified|i(?:'ve| have)?\s+verified|i\s+clicked|check(?:\s+verification(?:\s+status)?)?|verify|continue)\s*[.!?]*\s*$/i.test(trimmed)) {
          try {
            await this.hirePoolSignup.checkVerificationStatus();
          } catch (error) {
            this._renderErrorBanner(error?.message || 'Could not verify email status yet.');
          }
          return true;
        }
      }

      if (/^\s*(?:continue|resume|show\s+(?:signup|form|card)|go\s+back\s+to\s+signup)\s*[.!?]*\s*$/i.test(trimmed)) {
        this._appendAssistantSignupNotice(
          'Here is your active HirePool signup step below—complete the card or type "cancel" to exit.'
        );
        this.hirePoolSignup.resume();
        return true;
      }

      // Allow informational questions during active signup to fall through to the backend LLM
      return false;
    }

    const isRoleSpecificTrigger = /^\s*(?:(?:i\s+(?:want|would\s+like|'d\s+like)\s+to\s+)?(?:sign\s*up|signup|register|join)|(?:create\s+(?:an?\s+)?account))\s+(?:hirepool\s+)?as\s+(?:an?\s+)?(?:candidate|job\s*seeker|company|client|employer|consultancy|agency|staffing(?:\s+agency)?)\b/i.test(trimmed) ||
      /^\s*(?:sign\s*up|register)(?:\s+as)?\s+(?:an?\s+)?(?:candidate|company|client|employer|consultancy|agency|staffing)\b/i.test(trimmed);

    if (isRoleSpecificTrigger) {
      const parsedRole = parseHirePoolRoleChoice(trimmed);
      if (parsedRole) {
        const canonicalRole = parsedRole === 'staffing' ? 'consultancy' : parsedRole;
        const label = ROLE_DEFINITIONS[canonicalRole]?.label || canonicalRole;
        this._appendAssistantSignupNotice(
          `Starting your **${label}** HirePool signup right here in chat.`
        );
        await this._startHirePoolSignup(parsedRole);
        return true;
      }
    }

    const isGeneralSignupTrigger = /^\s*(?:(?:sign\s*up|signup|register|create\s+(?:an?\s+)?account)\s*(?:for\s+hirepool)?|i\s+(?:want|would\s+like|'d\s+like)\s+to\s+(?:sign\s*up|signup|register|join(?:\s+hirepool)?))\s*[.!?]*\s*$/i.test(trimmed);

    if (isGeneralSignupTrigger) {
      this._appendAssistantSignupNotice(
        'Let’s get your HirePool account set up! Choose your account type below, or reply with **Candidate**, **Employer / Company**, or **Agency / Consultancy**.'
      );
      await this._startHirePoolSignup(null);
      return true;
    }

    return false;
  }

  async _assertDocumentContextAvailable() {
    const knownDocuments = this.storage.get('documents', []);
    if (!Array.isArray(knownDocuments) || knownDocuments.length === 0) return;
    if (!this.activeConversationId) {
      throw new Error('The previous document session is unavailable. Start a new conversation and upload the document again.');
    }

    const currentDocuments = await this.apiClient.getDocuments(this.activeConversationId);
    const availableIds = new Set(currentDocuments.map(document => document.id));
    if (knownDocuments.some(doc => !availableIds.has(doc.id))) {
      throw new Error('Document context is no longer available for this conversation. Start a new conversation and upload the document again.');
    }
  }

  async sendMessage(text, { displayUserMessage = true } = {}) {
    const trimmed = (text || '').trim();
    if (!trimmed || this.isGenerating) return;

    try {
      await this._assertDocumentContextAvailable();
    } catch (error) {
      this._renderErrorBanner(error.message);
      this.events.emit('error', error);
      return;
    }

    // Reset textarea
    this.textarea.value = '';
    this.textarea.style.height = 'auto';

    if (displayUserMessage) {
      this.messages.push({ role: 'user', content: trimmed });
      this._renderMessageBubble('user', trimmed);
      this._persistState();
    }
    this.events.emit('message:sent', {
      role: 'user',
      content: trimmed,
      resumed: !displayUserMessage
    });

    const isHandledBySignup = await this._handleHirePoolSignupConversation(trimmed);
    if (isHandledBySignup) {
      if (this.sendBtn) this.sendBtn.disabled = true;
      return;
    }

    this._setGenerating(true);
    this.abortController = new AbortController();

    const stream = this.options.features?.streaming ?? true;

    const sendAttempt = async (isRetry = false) => {
      let assistantBubbleRow = null;
      let assistantBubbleContent = null;
      let accumulatedText = '';

      const handleError = async (err) => {
        const isSessionDenied =
          err?.status === 403 ||
          err?.code === 'SESSION_ACCESS_DENIED' ||
          String(err?.message || '').toLowerCase().includes('belongs to another user');

        if (!isRetry && isSessionDenied) {
          console.warn('[AI Assistant] Conversation ownership conflict detected; resetting conversation ID and retrying:', err.message);
          this.activeConversationId = null;
          this.storage.clearConversationId();
          if (assistantBubbleRow && assistantBubbleRow.parentNode) {
            assistantBubbleRow.parentNode.removeChild(assistantBubbleRow);
          }
          await sendAttempt(true);
          return;
        }

        if (err?.name !== 'AbortError') {
          this._renderErrorBanner(err.message);
          this.events.emit('error', err);
        }
      };

      try {
        const rawContext = this.options.integration && !this.contextOverrideSet
          ? await this.options.integration.getContext()
          : this.options.context;
        const contextPayload = this._buildChatContextPayload(rawContext);
        await this.apiClient.sendMessage({
          assistantId: this.options.assistantId || 'default',
          message: trimmed,
          context: contextPayload,
          conversationId: (typeof this.activeConversationId === 'string' && this.activeConversationId.trim().length > 0) ? this.activeConversationId.trim() : undefined,
          history: (displayUserMessage ? this.messages.slice(0, -1) : this.messages).slice(-25),
          stream,
          signal: this.abortController.signal,
          onStart: (event) => {
            if (event.conversationId) {
              this.activeConversationId = event.conversationId;
              this._persistState();
            }
          },
          onChunk: (delta) => {
            accumulatedText += delta;
            if (!assistantBubbleRow) {
              this.streamingIndicator.style.display = 'none';
              assistantBubbleRow = document.createElement('div');
              assistantBubbleRow.className = 'ai-message-row assistant';
              assistantBubbleContent = document.createElement('div');
              assistantBubbleContent.className = 'ai-bubble';
              assistantBubbleRow.appendChild(assistantBubbleContent);
              this.messagesList.appendChild(assistantBubbleRow);
            }
            assistantBubbleContent.innerHTML = parseMarkdown(accumulatedText);
            assistantBubbleRow.setAttribute('data-raw-content', accumulatedText);
            this._scrollToBottom();
          },
          onDone: (result) => {
            const rawFinalText = result.text || accumulatedText;
            const finalText = this.options?.assistantId === 'hirepool'
              ? (this._stripActionBlocks(rawFinalText) || rawFinalText)
              : rawFinalText;
            const detectedAction = result.action || this._extractAction(rawFinalText);

            if (result?.logout?.loggedOut) {
              if (assistantBubbleRow && assistantBubbleRow.parentNode) {
                assistantBubbleRow.parentNode.removeChild(assistantBubbleRow);
              }
              this.streamingIndicator.style.display = 'none';
              void this._handleHirePoolLogout(result.logout, finalText);
              this.events.emit('message:received', {
                role: 'assistant',
                content: finalText,
                logout: result.logout
              });
              return;
            }

            if (result.conversationId) {
              this.activeConversationId = result.conversationId;
            }

            if (!assistantBubbleRow) {
              this.streamingIndicator.style.display = 'none';
              this._renderMessageBubble('assistant', finalText, true, detectedAction);
            } else {
              assistantBubbleContent.innerHTML = parseMarkdown(finalText);
              if (detectedAction) {
                this._renderActionCard(assistantBubbleContent, detectedAction);
              }
              // Append actions
              const actions = document.createElement('div');
              actions.className = 'ai-message-actions';
              actions.innerHTML = `
                <button class="ai-msg-action-btn" type="button" aria-label="Copy response">
                  ${ICONS.copy} Copy
                </button>
              `;
              assistantBubbleRow.appendChild(actions);
            }

            this.messages.push({ role: 'assistant', content: finalText, action: detectedAction || undefined });
            this._persistState();
            this.events.emit('message:received', { role: 'assistant', content: finalText, action: detectedAction || undefined });
          },
          onError: async (err) => {
            await handleError(err);
          }
        });
      } catch (err) {
        await handleError(err);
      }
    };

    try {
      await sendAttempt(false);
    } finally {
      this._setGenerating(false);
      this.abortController = null;
    }
  }
}
