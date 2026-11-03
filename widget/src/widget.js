import { parseMarkdown, escapeHtml } from './markdown.js';

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

    this.isOpen = false;
    this.isGenerating = false;
    this.abortController = null;
    this.documentUploadController = null;
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
    if (this.abortController) {
      this.abortController.abort();
    }
    this.cancelDocumentUpload();
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
            <div class="ai-suggested-prompts-label">Suggested Prompts</div>
            <div class="ai-prompts-list">
              ${suggestedPrompts.map(p => `<button type="button" class="ai-prompt-pill">${escapeHtml(p)}</button>`).join('')}
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
        <form class="ai-input-form" onsubmit="return false;">
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
    this.fileInput.accept = this.options.documentUpload?.allowedExtensions?.join(',') || '.pdf,.docx,.txt';
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
        this.fileInput.click();
      });

      this.fileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        this.fileInput.value = '';
        this._handleFileUpload(file);
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
    const savedMessages = this.storage.get('messages', []);
    const savedConvoId = this.storage.getConversationId();
    const wasOpen = this.storage.get('is_open', false);

    this.activeConversationId = savedConvoId;
    if (Array.isArray(savedMessages) && savedMessages.length > 0) {
      this.messages = savedMessages;
      this.messages.forEach(msg => {
        this._renderMessageBubble(msg.role, msg.content, false, msg.action);
      });
    }

    if (wasOpen) {
      this.open();
    }
  }

  _persistState() {
    this.storage.set('messages', this.messages);
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

  async newConversation() {
    this.cancelGeneration();
    this.cancelDocumentUpload();
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
    this.storage.clear();
    this._persistState();
    this._setGenerating(false);
    this.events.emit('conversation:cleared');
    this.textarea.focus();
    return true;
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
        return data;
      }
    } catch {}
    return null;
  }

  _renderActionCard(bubble, action) {
    if (!action || !action.action) return;

    // Prevent duplicate action cards in same bubble
    const actionId = action.id || 'act_' + Date.now();
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

    const badgeLabel = 'Application action';

    // Format parameters
    const params = action.parameters || {};
    let paramRowsHtml = '';
    for (const [key, val] of Object.entries(params)) {
      if (val === undefined || val === null || val === '') continue;
      const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const formattedVal = Array.isArray(val) ? val.join(', ') : String(val);
      paramRowsHtml += `
        <div class="ai-action-param-row">
          <span class="ai-action-param-key">${escapeHtml(formattedKey)}:</span>
          <span class="ai-action-param-val">${escapeHtml(formattedVal)}</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="ai-action-header">
        <span class="ai-action-badge">${badgeLabel}</span>
        <span class="ai-action-risk risk-${risk}">${risk === 'destructive' ? 'Destructive' : risk === 'read' ? 'Read' : 'Write'}</span>
        <span class="ai-action-title">${escapeHtml(action.title || 'Proposed Action')}</span>
      </div>
      ${action.explanation ? `<p class="ai-action-explanation">${escapeHtml(action.explanation)}</p>` : ''}
      ${paramRowsHtml ? `<div class="ai-action-details">${paramRowsHtml}</div>` : ''}
      ${requiresAcknowledgement ? `
        <label class="ai-action-acknowledgement">
          <input type="checkbox" class="ai-action-acknowledge">
          I understand this action may be difficult to undo.
        </label>
      ` : ''}
      <div class="ai-action-status-msg" style="display: none;"></div>
      <div class="ai-action-controls">
        <button type="button" class="ai-btn-action-confirm" ${requiresAcknowledgement ? 'disabled' : ''}>Confirm &amp; Execute</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    `;

    const btnConfirm = card.querySelector('.ai-btn-action-confirm');
    const btnCancel = card.querySelector('.ai-btn-action-cancel');
    const statusMsg = card.querySelector('.ai-action-status-msg');
    const controls = card.querySelector('.ai-action-controls');
    const acknowledgement = card.querySelector('.ai-action-acknowledge');

    let executing = false;

    acknowledgement?.addEventListener('change', () => {
      btnConfirm.disabled = !acknowledgement.checked;
    });

    btnConfirm.addEventListener('click', () => {
      if (executing) return;
      executing = true;
      btnConfirm.disabled = true;
      btnCancel.disabled = true;

      statusMsg.style.display = 'flex';
      statusMsg.className = 'ai-action-status-msg executing';
      statusMsg.textContent = 'Executing action in the host application...';

      let handled = false;

      this.events.emit('action:execute', {
        actionId: action.id,
        action: action.action,
        parameters: action.parameters || {},
        resolve: (result) => {
          handled = true;
          executing = false;
          statusMsg.style.display = 'flex';
          statusMsg.className = 'ai-action-status-msg success';
          statusMsg.innerHTML = `${ICONS.check} ${escapeHtml(result?.message || 'Action executed successfully!')}`;
          controls.style.display = 'none';
          this.events.emit('action:success', { actionId: action.id, action: action.action, result });
          this._scrollToBottom();
        },
        reject: (err) => {
          handled = true;
          executing = false;
          statusMsg.style.display = 'flex';
          statusMsg.className = 'ai-action-status-msg error';
          statusMsg.innerHTML = `⚠️ ${escapeHtml(err?.message || 'Action failed')}`;
          btnConfirm.disabled = false;
          btnCancel.disabled = false;
          btnConfirm.textContent = 'Retry';
          this.events.emit('action:error', { actionId: action.id, action: action.action, error: err });
          this._scrollToBottom();
        }
      });

      // Safety timeout if host does not respond within 15 seconds
      setTimeout(() => {
        if (!handled && executing) {
          executing = false;
          statusMsg.style.display = 'flex';
          statusMsg.className = 'ai-action-status-msg error';
          statusMsg.innerHTML = '⚠️ Action timed out or no action handler is registered.';
          btnConfirm.disabled = false;
          btnCancel.disabled = false;
          btnConfirm.textContent = 'Retry';
        }
      }, 15000);
    });

    btnCancel.addEventListener('click', () => {
      if (executing) return;
      btnConfirm.disabled = true;
      btnCancel.disabled = true;
      controls.style.display = 'none';
      statusMsg.style.display = 'flex';
      statusMsg.className = 'ai-action-status-msg cancelled';
      statusMsg.textContent = 'Action cancelled.';
      this.events.emit('action:cancel', { actionId: action.id, action: action.action });
      this._scrollToBottom();
    });

    bubble.appendChild(card);
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
      bubble.innerHTML = parseMarkdown(content);
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

  async sendMessage(text) {
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

    // Append user message
    this.messages.push({ role: 'user', content: trimmed });
    this._renderMessageBubble('user', trimmed);
    this._persistState();
    this.events.emit('message:sent', { role: 'user', content: trimmed });

    this._setGenerating(true);
    this.abortController = new AbortController();

    // Prepare active placeholder for streaming assistant response
    let assistantBubbleRow = null;
    let assistantBubbleContent = null;
    let accumulatedText = '';

    const stream = this.options.features?.streaming ?? true;

    try {
      const context = this.options.integration && !this.contextOverrideSet
        ? await this.options.integration.getContext()
        : this.options.context;
      await this.apiClient.sendMessage({
        assistantId: this.options.assistantId || 'default',
        message: trimmed,
        context: typeof context === 'string' && context.trim().length > 0 ? context.trim() : undefined,
        conversationId: (typeof this.activeConversationId === 'string' && this.activeConversationId.trim().length > 0) ? this.activeConversationId.trim() : undefined,
        history: this.messages.slice(0, -1),
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
          const finalText = result.text || accumulatedText;
          const detectedAction = result.action || this._extractAction(finalText);
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
        onError: (err) => {
          this._renderErrorBanner(err.message);
          this.events.emit('error', err);
        }
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        this._renderErrorBanner(err.message);
        this.events.emit('error', err);
      }
    } finally {
      this._setGenerating(false);
      this.abortController = null;
    }
  }
}
