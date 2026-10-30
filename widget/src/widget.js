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
    this.messages = [];
    this.activeConversationId = null;

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
          <button class="ai-attach-btn" type="button" aria-label="Upload document" title="Upload candidate document (PDF, DOCX)">
            ${ICONS.attachment}
          </button>
          <input type="file" class="ai-file-input" accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword" style="display: none;" />
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
    const savedConvoId = this.storage.get('conversation_id', null);
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
    this.storage.set('conversation_id', this.activeConversationId);
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

  setContext(context) {
    this.options.context = (typeof context === 'string' && context.trim().length > 0)
      ? context.trim()
      : null;
  }

  newConversation() {
    this.cancelGeneration();
    this.activeConversationId = null;
    this.messages = [];
    this.messagesList.innerHTML = '';
    this.storage.clear();
    this._persistState();
    this._setGenerating(false);
    this.events.emit('conversation:cleared');
    this.textarea.focus();
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
    const match = text.match(/```(?:action:hirepool|action)\s*\n([\s\S]*?)\n```/i);
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

    const badgeLabel = action.action.startsWith('candidate:') ? 'Candidate Action'
      : action.action.startsWith('consultancy:') ? 'Agency Action'
      : action.action.startsWith('client:') ? 'Client Action'
      : 'Action';

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
        <span class="ai-action-title">${escapeHtml(action.title || 'Proposed Action')}</span>
      </div>
      ${action.explanation ? `<p class="ai-action-explanation">${escapeHtml(action.explanation)}</p>` : ''}
      ${paramRowsHtml ? `<div class="ai-action-details">${paramRowsHtml}</div>` : ''}
      <div class="ai-action-status-msg" style="display: none;"></div>
      <div class="ai-action-controls">
        <button type="button" class="ai-btn-action-confirm">Confirm &amp; Execute</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    `;

    const btnConfirm = card.querySelector('.ai-btn-action-confirm');
    const btnCancel = card.querySelector('.ai-btn-action-cancel');
    const statusMsg = card.querySelector('.ai-action-status-msg');
    const controls = card.querySelector('.ai-action-controls');

    let executing = false;

    btnConfirm.addEventListener('click', () => {
      if (executing) return;
      executing = true;
      btnConfirm.disabled = true;
      btnCancel.disabled = true;

      statusMsg.style.display = 'flex';
      statusMsg.className = 'ai-action-status-msg executing';
      statusMsg.innerHTML = 'Executing action in Hirepool...';

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

    // Validate extension
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const allowed = ['.pdf', '.docx', '.doc'];
    if (!allowed.includes(ext)) {
      this._renderMessageBubble('assistant', '⚠️ Unsupported file type. Please upload a PDF or DOCX document.');
      return;
    }

    // Validate size (10 MB limit)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      this._renderMessageBubble('assistant', '⚠️ File exceeds 10MB limit. Please upload a smaller document.');
      return;
    }

    const sizeFormatted = (file.size / 1024).toFixed(0) + ' KB';

    // 1. Render user upload bubble
    this.messages.push({ role: 'user', content: `📎 Uploaded document: ${file.name} (${sizeFormatted})` });
    this._renderMessageBubble('user', `📎 Uploaded document: ${file.name} (${sizeFormatted})`);
    this._persistState();

    // 2. Render assistant processing placeholder bubble
    const row = document.createElement('div');
    row.className = 'ai-message-row assistant';
    const bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.innerHTML = `
      <div class="ai-processing-state">
        <span class="ai-spinner"></span>
        <span>Processing <strong>${escapeHtml(file.name)}</strong>... Extracting candidates and validating details.</span>
      </div>
    `;
    row.appendChild(bubble);
    this.messagesList.appendChild(row);
    this._scrollToBottom();

    // 3. Emit file:upload event to host adapter
    let handled = false;
    this.events.emit('file:upload', {
      file,
      filename: file.name,
      fileSize: file.size,
      fileType: file.type,
      resolve: (data) => {
        handled = true;
        bubble.innerHTML = '';
        if (data && data.candidates && data.candidates.length > 0) {
          this._renderCandidateReviewCard(bubble, data);
        } else {
          bubble.innerHTML = `<p>No candidate records could be extracted from <strong>${escapeHtml(file.name)}</strong>.</p>`;
        }
        this._scrollToBottom();
      },
      reject: (err) => {
        handled = true;
        bubble.innerHTML = `
          <div class="ai-action-status-msg error">
            ⚠️ ${escapeHtml(err?.message || 'Failed to process document')}
          </div>
        `;
        this._scrollToBottom();
      }
    });

    // Safety timeout
    setTimeout(() => {
      if (!handled) {
        bubble.innerHTML = `
          <div class="ai-action-status-msg error">
            ⚠️ Document processing timed out. Please ensure you are logged into an authorized agency account.
          </div>
        `;
        this._scrollToBottom();
      }
    }, 45000);
  }

  _renderCandidateReviewCard(bubble, data) {
    const candidates = JSON.parse(JSON.stringify(data.candidates || []));
    const filename = data.filename || 'Uploaded Document';

    const card = document.createElement('div');
    card.className = 'ai-candidate-review-card';

    let consentConfirmed = true;

    // Track selected candidates: default true for eligible candidates
    const selectedIndices = new Set();
    candidates.forEach((cand, idx) => {
      if (cand.eligible_for_creation) {
        selectedIndices.add(idx);
      }
    });

    const updateSummary = () => {
      const countEl = card.querySelector('.ai-sel-count');
      if (countEl) countEl.textContent = selectedIndices.size;
      const confirmBtn = card.querySelector('.ai-btn-confirm-candidates');
      if (confirmBtn) {
        confirmBtn.disabled = selectedIndices.size === 0 || !consentConfirmed;
      }
    };

    let itemsHtml = '';
    candidates.forEach((cand, idx) => {
      const isChecked = selectedIndices.has(idx) ? 'checked' : '';
      const dupBadge = cand.is_duplicate
        ? (cand.duplicate_scope === 'agency'
            ? `<span class="ai-dup-badge agency" title="${escapeHtml(cand.duplicate_message || '')}">⚠️ In Agency Pool</span>`
            : `<span class="ai-dup-badge global" title="${escapeHtml(cand.duplicate_message || '')}">⛔ Platform Duplicate</span>`)
        : '';
      const missingBadge = cand.missing_fields && cand.missing_fields.length > 0
        ? `<span class="ai-warn-badge">Missing: ${escapeHtml(cand.missing_fields.join(', '))}</span>`
        : '';
      const validBadge = cand.is_valid && !cand.is_duplicate
        ? `<span class="ai-valid-badge">✓ Ready</span>`
        : '';

      const skillsFormatted = Array.isArray(cand.skills) ? cand.skills.join(', ') : (cand.skills || '');

      itemsHtml += `
        <div class="ai-candidate-item" data-idx="${idx}">
          <div class="ai-candidate-item-header">
            <label class="ai-candidate-select-label">
              <input type="checkbox" class="ai-cand-chk" data-idx="${idx}" ${isChecked} />
              <strong class="ai-cand-title">Candidate #${idx + 1}</strong>
            </label>
            <div class="ai-cand-badges">
              ${dupBadge}
              ${missingBadge}
              ${validBadge}
            </div>
          </div>
          ${cand.duplicate_message ? `<div class="ai-cand-dup-note">${escapeHtml(cand.duplicate_message)}</div>` : ''}
          <div class="ai-card-input-grid">
            <div class="ai-input-group">
              <label>First Name *</label>
              <input type="text" class="ai-card-input" data-field="first_name" data-idx="${idx}" value="${escapeHtml(cand.first_name || '')}" placeholder="First Name" />
            </div>
            <div class="ai-input-group">
              <label>Last Name *</label>
              <input type="text" class="ai-card-input" data-field="last_name" data-idx="${idx}" value="${escapeHtml(cand.last_name || '')}" placeholder="Last Name" />
            </div>
            <div class="ai-input-group">
              <label>Email *</label>
              <input type="email" class="ai-card-input" data-field="email" data-idx="${idx}" value="${escapeHtml(cand.email || '')}" placeholder="Email" />
            </div>
            <div class="ai-input-group">
              <label>Phone</label>
              <input type="text" class="ai-card-input" data-field="phone" data-idx="${idx}" value="${escapeHtml(cand.phone || '')}" placeholder="Phone" />
            </div>
            <div class="ai-input-group">
              <label>Job Title</label>
              <input type="text" class="ai-card-input" data-field="job_title" data-idx="${idx}" value="${escapeHtml(cand.job_title || '')}" placeholder="e.g. Developer" />
            </div>
            <div class="ai-input-group">
              <label>Location</label>
              <input type="text" class="ai-card-input" data-field="current_location" data-idx="${idx}" value="${escapeHtml(cand.current_location || '')}" placeholder="Location" />
            </div>
            <div class="ai-input-group full-width">
              <label>Skills</label>
              <input type="text" class="ai-card-input" data-field="skills" data-idx="${idx}" value="${escapeHtml(skillsFormatted)}" placeholder="e.g. React, Node.js" />
            </div>
          </div>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="ai-review-header">
        <span class="ai-action-badge">Candidate Review</span>
        <span class="ai-action-title">${escapeHtml(filename)} (${candidates.length} parsed)</span>
      </div>
      <p class="ai-review-instructions">
        Review candidate details below. You can correct information, review duplicates, and select candidates to add to your agency pool.
      </p>
      <div class="ai-candidate-list-scroll">
        ${itemsHtml}
      </div>
      <div class="ai-review-footer">
        <label class="ai-consent-row">
          <input type="checkbox" class="ai-consent-checkbox" checked />
          <span>I confirm candidate consent has been obtained for represented candidates.</span>
        </label>
        <div class="ai-selection-summary">
          Selected: <strong class="ai-sel-count">${selectedIndices.size}</strong> of ${candidates.length} candidate(s)
        </div>
        <div class="ai-review-status-msg" style="display: none;"></div>
        <div class="ai-review-controls">
          <button type="button" class="ai-btn-confirm-candidates" ${selectedIndices.size === 0 ? 'disabled' : ''}>Confirm &amp; Create Selected</button>
          <button type="button" class="ai-btn-cancel-candidates">Cancel</button>
        </div>
      </div>
    `;

    card.querySelectorAll('.ai-cand-chk').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (e.target.checked) {
          selectedIndices.add(idx);
        } else {
          selectedIndices.delete(idx);
        }
        updateSummary();
      });
    });

    card.querySelectorAll('.ai-card-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        const field = e.target.getAttribute('data-field');
        const val = e.target.value.trim();
        if (candidates[idx]) {
          if (field === 'skills') {
            candidates[idx].skills = val.split(',').map(s => s.trim()).filter(Boolean);
          } else {
            candidates[idx][field] = val;
          }
        }
      });
    });

    const consentChk = card.querySelector('.ai-consent-checkbox');
    consentChk.addEventListener('change', (e) => {
      consentConfirmed = e.target.checked;
      updateSummary();
    });

    const btnConfirm = card.querySelector('.ai-btn-confirm-candidates');
    const btnCancel = card.querySelector('.ai-btn-cancel-candidates');
    const statusMsg = card.querySelector('.ai-review-status-msg');
    const controls = card.querySelector('.ai-review-controls');

    let executing = false;

    btnConfirm.addEventListener('click', () => {
      if (executing || selectedIndices.size === 0 || !consentConfirmed) return;
      executing = true;
      btnConfirm.disabled = true;
      btnCancel.disabled = true;

      const candidatesToCreate = [];
      selectedIndices.forEach(idx => {
        const c = candidates[idx];
        if (c) {
          candidatesToCreate.push({
            first_name: c.first_name,
            last_name: c.last_name,
            email: c.email,
            phone: c.phone || undefined,
            current_location: c.current_location || undefined,
            job_title: c.job_title || undefined,
            professional_summary: c.professional_summary || undefined,
            years_of_experience: c.years_of_experience,
            skills: Array.isArray(c.skills) && c.skills.length > 0 ? c.skills : ['General'],
            education: c.education || [],
            work_experience: c.work_experience || [],
            certifications: c.certifications || [],
            candidate_consent: true,
            exclusivity_agreement: false
          });
        }
      });

      statusMsg.style.display = 'flex';
      statusMsg.className = 'ai-action-status-msg executing';
      statusMsg.innerHTML = `Creating ${candidatesToCreate.length} candidate(s) in your pool...`;

      this.events.emit('action:execute', {
        action: 'consultancy:create_candidates_batch',
        parameters: { candidates: candidatesToCreate },
        resolve: (result) => {
          executing = false;
          statusMsg.style.display = 'flex';
          statusMsg.className = 'ai-action-status-msg success';
          statusMsg.innerHTML = `${ICONS.check} ${escapeHtml(result?.message || 'Candidates created successfully!')}`;
          controls.style.display = 'none';
          this._scrollToBottom();
        },
        reject: (err) => {
          executing = false;
          statusMsg.style.display = 'flex';
          statusMsg.className = 'ai-action-status-msg error';
          statusMsg.innerHTML = `⚠️ ${escapeHtml(err?.message || 'Creation failed')}`;
          btnConfirm.disabled = false;
          btnCancel.disabled = false;
          this._scrollToBottom();
        }
      });
    });

    btnCancel.addEventListener('click', () => {
      if (executing) return;
      controls.style.display = 'none';
      statusMsg.style.display = 'flex';
      statusMsg.className = 'ai-action-status-msg cancelled';
      statusMsg.textContent = 'Candidate creation cancelled.';
      this._scrollToBottom();
    });

    bubble.appendChild(card);
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

  async sendMessage(text) {
    const trimmed = (text || '').trim();
    if (!trimmed || this.isGenerating) return;

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
      await this.apiClient.sendMessage({
        assistantId: this.options.assistantId || 'default',
        message: trimmed,
        context: (typeof this.options.context === 'string' && this.options.context.trim().length > 0) ? this.options.context.trim() : undefined,
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
