var AssistantSDKBundle = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // widget/src/sdk.js
  var sdk_exports = {};
  __export(sdk_exports, {
    default: () => sdk_default
  });

  // widget/src/markdown.js
  function escapeHtml(str) {
    if (typeof str !== "string") return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function parseMarkdown(text) {
    if (!text) return "";
    const textWithoutAction = text.replace(/```(?:action:[a-zA-Z0-9_-]+|action)\s*\n[\s\S]*?\n```/gi, "").trim();
    let md = escapeHtml(textWithoutAction);
    md = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : "";
      return `<div class="code-block-wrapper">
      <div class="code-header">
        ${langLabel}
        <button class="copy-code-btn" type="button" aria-label="Copy code block">Copy</button>
      </div>
      <pre><code>${code.trim()}</code></pre>
    </div>`;
    });
    md = md.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    md = md.replace(/^### (.*$)/gim, "<h4>$1</h4>");
    md = md.replace(/^## (.*$)/gim, "<h3>$1</h3>");
    md = md.replace(/^# (.*$)/gim, "<h2>$1</h2>");
    md = md.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    md = md.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    md = md.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    md = md.replace(/_([^_]+)_/g, "<em>$1</em>");
    md = md.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");
    md = md.replace(/^\s*[-*+]\s+(.*)$/gim, "<li>$1</li>");
    md = md.replace(/(<li>.*<\/li>)/gims, (match) => {
      return `<ul>${match}</ul>`;
    });
    md = md.replace(/<\/ul>\s*<ul>/g, "");
    md = md.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const paragraphs = md.split(/\n{2,}/);
    const formatted = paragraphs.map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return "";
      if (/^<(h[1-4]|div|pre|ul|ol|blockquote)/i.test(trimmed)) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    }).filter(Boolean).join("");
    return formatted;
  }

  // widget/src/widget.js
  var ICONS = {
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
  var AssistantWidgetUI = class {
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
    mount(cssContent = "") {
      if (this.hostElement && this.hostElement.parentNode) {
        return;
      }
      this.hostElement = document.createElement("div");
      this.hostElement.id = "ai-assistant-plugin-root";
      this.shadowRoot = this.hostElement.attachShadow({ mode: "open" });
      const styleTag = document.createElement("style");
      styleTag.textContent = cssContent;
      this.shadowRoot.appendChild(styleTag);
      this._buildDOM();
      this._restoreState();
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
      const container = document.createElement("div");
      container.className = `ai-widget-container pos-${position || "bottom-right"}`;
      container.setAttribute("data-theme", theme || "auto");
      if (primaryColor) {
        container.style.setProperty("--ai-primary", primaryColor);
        container.style.setProperty("--ai-user-bubble", primaryColor);
      }
      this.container = container;
      const launcherBtn = document.createElement("button");
      launcherBtn.className = "ai-launcher-btn";
      launcherBtn.type = "button";
      launcherBtn.setAttribute("aria-label", `Open ${name}`);
      launcherBtn.setAttribute("aria-haspopup", "dialog");
      launcherBtn.setAttribute("aria-expanded", "false");
      launcherBtn.innerHTML = `
      <span class="icon-chat">${ICONS.chat}</span>
      <span class="icon-close">${ICONS.close}</span>
    `;
      this.launcherBtn = launcherBtn;
      const panel = document.createElement("div");
      panel.className = "ai-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", name);
      const avatarHtml = avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)} avatar"/>` : escapeHtml(name.charAt(0).toUpperCase());
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
              ${suggestedPrompts.map((p) => `<button type="button" class="ai-prompt-pill">${escapeHtml(p)}</button>`).join("")}
            </div>
          ` : ""}
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
      this.messagesList = panel.querySelector(".ai-messages-list");
      this.streamingIndicator = panel.querySelector(".ai-streaming-indicator");
      this.statusDot = panel.querySelector(".ai-status-dot");
      this.statusText = panel.querySelector(".ai-status-text");
      this.textarea = panel.querySelector(".ai-textarea");
      this.sendBtn = panel.querySelector(".ai-send-btn");
      this.stopBtn = panel.querySelector(".ai-stop-btn");
      this.attachBtn = panel.querySelector(".ai-attach-btn");
      this.fileInput = panel.querySelector(".ai-file-input");
      this.fileInput.accept = this.options.documentUpload?.allowedExtensions?.join(",") || ".pdf,.docx,.txt";
      this.body = panel.querySelector(".ai-body");
      container.appendChild(panel);
      container.appendChild(launcherBtn);
      this.shadowRoot.appendChild(container);
    }
    _attachEvents() {
      this.launcherBtn.addEventListener("click", () => {
        this.toggle();
      });
      this.panel.querySelector(".btn-close").addEventListener("click", () => {
        this.close();
      });
      this.panel.querySelector(".btn-new-chat").addEventListener("click", () => {
        this.newConversation();
      });
      this.stopBtn.addEventListener("click", () => {
        this.cancelGeneration();
      });
      this.panel.querySelectorAll(".ai-prompt-pill").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const text = e.target.textContent.trim();
          if (text) {
            this.sendMessage(text);
          }
        });
      });
      this.textarea.addEventListener("input", () => {
        this.textarea.style.height = "auto";
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + "px";
        this.sendBtn.disabled = !this.textarea.value.trim() || this.isGenerating;
      });
      this.textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const text = this.textarea.value.trim();
          if (text && !this.isGenerating) {
            this.sendMessage(text);
          }
        }
      });
      this.panel.querySelector(".ai-input-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const text = this.textarea.value.trim();
        if (text && !this.isGenerating) {
          this.sendMessage(text);
        }
      });
      if (this.attachBtn && this.fileInput) {
        this.attachBtn.addEventListener("click", () => {
          if (this.isGenerating) return;
          this.fileInput.click();
        });
        this.fileInput.addEventListener("change", (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          this.fileInput.value = "";
          this._handleFileUpload(file);
        });
      }
      this.panel.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen) {
          this.close();
        }
      });
      this.messagesList.addEventListener("click", (e) => {
        const copyBtn = e.target.closest(".ai-msg-action-btn") || e.target.closest(".copy-code-btn");
        if (copyBtn) {
          this._handleCopyClick(copyBtn);
        }
        const retryBtn = e.target.closest(".ai-error-retry-btn");
        if (retryBtn) {
          const lastUserMsg = [...this.messages].reverse().find((m) => m.role === "user");
          if (lastUserMsg) {
            this.sendMessage(lastUserMsg.content);
          }
        }
      });
    }
    _handleCopyClick(btn) {
      let textToCopy = "";
      if (btn.classList.contains("copy-code-btn")) {
        const wrapper = btn.closest(".code-block-wrapper");
        textToCopy = wrapper ? wrapper.querySelector("code").innerText : "";
      } else {
        const row = btn.closest(".ai-message-row");
        textToCopy = row ? row.getAttribute("data-raw-content") : "";
      }
      if (textToCopy && navigator.clipboard) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalText = btn.innerHTML;
          btn.innerHTML = btn.classList.contains("copy-code-btn") ? "Copied!" : `${ICONS.check} Copied`;
          setTimeout(() => {
            btn.innerHTML = originalText;
          }, 2e3);
        }).catch((err) => {
          console.warn("Copy failed:", err);
        });
      }
    }
    _restoreState() {
      const savedMessages = this.storage.get("messages", []);
      const savedConvoId = this.storage.getConversationId();
      const wasOpen = this.storage.get("is_open", false);
      this.activeConversationId = savedConvoId;
      if (Array.isArray(savedMessages) && savedMessages.length > 0) {
        this.messages = savedMessages;
        this.messages.forEach((msg) => {
          this._renderMessageBubble(msg.role, msg.content, false, msg.action);
        });
      }
      if (wasOpen) {
        this.open();
      }
    }
    _persistState() {
      this.storage.set("messages", this.messages);
      this.storage.saveConversationId(this.activeConversationId);
      this.storage.set("is_open", this.isOpen);
    }
    open() {
      if (this.isOpen) return;
      this.isOpen = true;
      this.container.classList.add("is-open");
      this.launcherBtn.setAttribute("aria-expanded", "true");
      this._persistState();
      this.events.emit("open");
      setTimeout(() => {
        this.textarea.focus();
        this._scrollToBottom();
      }, 100);
    }
    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.container.classList.remove("is-open");
      this.launcherBtn.setAttribute("aria-expanded", "false");
      this._persistState();
      this.events.emit("close");
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
      if (["light", "dark", "auto"].includes(theme)) {
        this.container.setAttribute("data-theme", theme);
        this.options.theme = theme;
      }
    }
    setPosition(pos) {
      ["bottom-right", "bottom-left", "top-right", "top-left"].forEach((p) => {
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
          this.events.emit("error", err);
          return false;
        }
      }
      this.activeConversationId = null;
      this.messages = [];
      this.messagesList.innerHTML = "";
      this.storage.clear();
      this._persistState();
      this._setGenerating(false);
      this.events.emit("conversation:cleared");
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
        this.statusDot.classList.add("busy");
        this.statusText.textContent = "Thinking...";
        this.sendBtn.style.display = "none";
        this.stopBtn.style.display = "flex";
        this.streamingIndicator.style.display = "flex";
      } else {
        this.statusDot.classList.remove("busy");
        this.statusText.textContent = "Online";
        this.sendBtn.style.display = "flex";
        this.stopBtn.style.display = "none";
        this.streamingIndicator.style.display = "none";
        this.sendBtn.disabled = !this.textarea.value.trim();
      }
    }
    _scrollToBottom() {
      this.body.scrollTop = this.body.scrollHeight;
    }
    _extractAction(text, actionProp) {
      if (actionProp && typeof actionProp === "object") {
        return actionProp;
      }
      if (!text || typeof text !== "string") return null;
      const match = text.match(/```(?:action:[a-zA-Z0-9_-]+|action)\s*\n([\s\S]*?)\n```/i);
      if (!match) return null;
      try {
        const data = JSON.parse(match[1].trim());
        if (data && data.action && data.title) {
          return data;
        }
      } catch {
      }
      return null;
    }
    _renderActionCard(bubble, action) {
      if (!action || !action.action) return;
      const actionId = action.id || "act_" + Date.now();
      if (bubble.querySelector(`[data-action-id="${escapeHtml(actionId)}"]`)) {
        return;
      }
      const card = document.createElement("div");
      card.className = "ai-action-card";
      card.setAttribute("data-action-id", actionId);
      card.setAttribute("data-action-type", action.action);
      this.events.emit("action:proposed", action);
      const risk = ["read", "write", "destructive"].includes(action.risk) ? action.risk : "write";
      const requiresAcknowledgement = risk === "destructive";
      const badgeLabel = "Application action";
      const params = action.parameters || {};
      let paramRowsHtml = "";
      for (const [key, val] of Object.entries(params)) {
        if (val === void 0 || val === null || val === "") continue;
        const formattedKey = key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
        const formattedVal = Array.isArray(val) ? val.join(", ") : String(val);
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
        <span class="ai-action-risk risk-${risk}">${risk === "destructive" ? "Destructive" : risk === "read" ? "Read" : "Write"}</span>
        <span class="ai-action-title">${escapeHtml(action.title || "Proposed Action")}</span>
      </div>
      ${action.explanation ? `<p class="ai-action-explanation">${escapeHtml(action.explanation)}</p>` : ""}
      ${paramRowsHtml ? `<div class="ai-action-details">${paramRowsHtml}</div>` : ""}
      ${requiresAcknowledgement ? `
        <label class="ai-action-acknowledgement">
          <input type="checkbox" class="ai-action-acknowledge">
          I understand this action may be difficult to undo.
        </label>
      ` : ""}
      <div class="ai-action-status-msg" style="display: none;"></div>
      <div class="ai-action-controls">
        <button type="button" class="ai-btn-action-confirm" ${requiresAcknowledgement ? "disabled" : ""}>Confirm &amp; Execute</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    `;
      const btnConfirm = card.querySelector(".ai-btn-action-confirm");
      const btnCancel = card.querySelector(".ai-btn-action-cancel");
      const statusMsg = card.querySelector(".ai-action-status-msg");
      const controls = card.querySelector(".ai-action-controls");
      const acknowledgement = card.querySelector(".ai-action-acknowledge");
      let executing = false;
      acknowledgement?.addEventListener("change", () => {
        btnConfirm.disabled = !acknowledgement.checked;
      });
      btnConfirm.addEventListener("click", () => {
        if (executing) return;
        executing = true;
        btnConfirm.disabled = true;
        btnCancel.disabled = true;
        statusMsg.style.display = "flex";
        statusMsg.className = "ai-action-status-msg executing";
        statusMsg.textContent = "Executing action in the host application...";
        let handled = false;
        this.events.emit("action:execute", {
          actionId: action.id,
          action: action.action,
          parameters: action.parameters || {},
          resolve: (result) => {
            handled = true;
            executing = false;
            statusMsg.style.display = "flex";
            statusMsg.className = "ai-action-status-msg success";
            statusMsg.innerHTML = `${ICONS.check} ${escapeHtml(result?.message || "Action executed successfully!")}`;
            controls.style.display = "none";
            this.events.emit("action:success", { actionId: action.id, action: action.action, result });
            this._scrollToBottom();
          },
          reject: (err) => {
            handled = true;
            executing = false;
            statusMsg.style.display = "flex";
            statusMsg.className = "ai-action-status-msg error";
            statusMsg.innerHTML = `\u26A0\uFE0F ${escapeHtml(err?.message || "Action failed")}`;
            btnConfirm.disabled = false;
            btnCancel.disabled = false;
            btnConfirm.textContent = "Retry";
            this.events.emit("action:error", { actionId: action.id, action: action.action, error: err });
            this._scrollToBottom();
          }
        });
        setTimeout(() => {
          if (!handled && executing) {
            executing = false;
            statusMsg.style.display = "flex";
            statusMsg.className = "ai-action-status-msg error";
            statusMsg.innerHTML = "\u26A0\uFE0F Action timed out or no action handler is registered.";
            btnConfirm.disabled = false;
            btnCancel.disabled = false;
            btnConfirm.textContent = "Retry";
          }
        }, 15e3);
      });
      btnCancel.addEventListener("click", () => {
        if (executing) return;
        btnConfirm.disabled = true;
        btnCancel.disabled = true;
        controls.style.display = "none";
        statusMsg.style.display = "flex";
        statusMsg.className = "ai-action-status-msg cancelled";
        statusMsg.textContent = "Action cancelled.";
        this.events.emit("action:cancel", { actionId: action.id, action: action.action });
        this._scrollToBottom();
      });
      bubble.appendChild(card);
      this._scrollToBottom();
    }
    _handleFileUpload(file) {
      if (!file) return;
      const settings = this.options.documentUpload;
      if (!settings?.enabled) {
        this._renderMessageBubble("assistant", "Document upload is disabled for this assistant.");
        return;
      }
      const filename = typeof file.name === "string" ? file.name : "document";
      const extension = "." + filename.split(".").pop().toLowerCase();
      if (!settings.allowedExtensions.includes(extension)) {
        this._renderMessageBubble("assistant", "Unsupported document type.");
        return;
      }
      if (!Number.isFinite(file.size) || file.size < 1 || file.size > settings.maxSizeBytes) {
        const limitMb = Math.floor(settings.maxSizeBytes / (1024 * 1024));
        this._renderMessageBubble("assistant", `Document exceeds the ${limitMb} MB upload limit or is empty.`);
        return;
      }
      const sizeFormatted = (file.size / 1024).toFixed(0) + " KB";
      const hasHostListener = Boolean(this.events?.listeners?.get("file:upload")?.size > 0);
      const consent = settings.consent;
      const consentId = `ai-document-consent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const row = document.createElement("div");
      row.className = "ai-message-row assistant";
      const bubble = document.createElement("div");
      bubble.className = "ai-bubble";
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
      const checkbox = bubble.querySelector(".ai-document-consent-checkbox");
      const acceptButton = bubble.querySelector(".ai-btn-document-consent-accept");
      const cancelButton = bubble.querySelector(".ai-btn-document-consent-cancel");
      checkbox.addEventListener("change", () => {
        acceptButton.disabled = !checkbox.checked;
      });
      acceptButton.addEventListener("click", () => {
        if (!checkbox.checked || acceptButton.disabled) return;
        this.events.emit("document:consent-accepted", { filename });
        this._processFileUpload(file, bubble, sizeFormatted, hasHostListener);
      });
      cancelButton.addEventListener("click", () => {
        bubble.innerHTML = '<p class="ai-document-cancelled">Document processing cancelled. The file was not sent.</p>';
        this.events.emit("document:consent-rejected", { filename });
        this._scrollToBottom();
      });
    }
    _processFileUpload(file, bubble, sizeFormatted, hasHostListener) {
      const filename = typeof file.name === "string" ? file.name : "document";
      const controller = new AbortController();
      this.documentUploadController = controller;
      const uploadMessage = `Uploaded document: ${filename} (${sizeFormatted})`;
      this.messages.push({ role: "user", content: uploadMessage });
      this._renderMessageBubble("user", uploadMessage);
      this._persistState();
      bubble.innerHTML = `
      <div class="ai-processing-state">
        <span class="ai-spinner"></span>
        <span>Processing <strong>${escapeHtml(filename)}</strong>...</span>
        <button type="button" class="ai-btn-document-cancel">Cancel</button>
      </div>
    `;
      const cancelButton = bubble.querySelector(".ai-btn-document-cancel");
      cancelButton.addEventListener("click", () => controller.abort(), { once: true });
      const showCancelled = () => {
        bubble.innerHTML = '<p class="ai-document-cancelled">Document processing cancelled.</p>';
        this.events.emit("document:cancelled", { filename });
        if (this.documentUploadController === controller) this.documentUploadController = null;
        this._scrollToBottom();
      };
      controller.signal.addEventListener("abort", showCancelled, { once: true });
      if (hasHostListener) {
        let handled = false;
        const timeout = setTimeout(() => {
          if (handled || controller.signal.aborted) return;
          handled = true;
          if (this.documentUploadController === controller) this.documentUploadController = null;
          bubble.innerHTML = '<p class="ai-action-status-msg error">The host application did not complete document processing in time.</p>';
          this._scrollToBottom();
        }, 45e3);
        this.events.emit("file:upload", {
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
            const message = typeof result?.message === "string" ? result.message : "The host application processed the document.";
            bubble.innerHTML = `<p class="ai-document-host-result">${escapeHtml(message)}</p>`;
            this.events.emit("document:host-processed", { filename, result });
            this._scrollToBottom();
          },
          reject: (error) => {
            if (handled || controller.signal.aborted) return;
            handled = true;
            clearTimeout(timeout);
            if (this.documentUploadController === controller) this.documentUploadController = null;
            bubble.innerHTML = `<p class="ai-action-status-msg error">${escapeHtml(error?.message || "The host application could not process this document.")}</p>`;
            this._scrollToBottom();
          }
        });
        controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
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
        const pageInfo = doc.pageCount ? ` \u2022 ${doc.pageCount} page${doc.pageCount > 1 ? "s" : ""}` : "";
        bubble.innerHTML = `
        <div class="ai-doc-card">
          <div class="ai-doc-header">
            <div class="ai-doc-icon">\u{1F4C4}</div>
            <div class="ai-doc-details">
              <div class="ai-doc-title">${escapeHtml(doc.filename)}</div>
              <div class="ai-doc-meta">${escapeHtml(doc.fileType.toUpperCase())} \u2022 ${sizeFormatted}${pageInfo} \u2022 ${wordsCount} words</div>
            </div>
            <div class="ai-doc-badge">Ready for questions</div>
          </div>
          <p class="ai-doc-hint">You can ask questions about the extracted text. The text is temporary and limited to this conversation session.</p>
          <button type="button" class="ai-btn-document-remove" aria-label="Remove ${escapeHtml(doc.filename)} from this conversation">Remove document</button>
        </div>
      `;
        const knownDocuments = this.storage.get("documents", []);
        this.storage.set("documents", [...knownDocuments.filter((item) => item.id !== doc.id), doc]);
        this.messages.push({ role: "assistant", content: `Processed document: ${doc.filename}. Ready for questions.` });
        this._persistState();
        bubble.querySelector(".ai-btn-document-remove").addEventListener("click", async (event) => {
          event.currentTarget.disabled = true;
          try {
            await this.apiClient.removeDocument(this.activeConversationId, doc.id);
            const remaining = this.storage.get("documents", []).filter((item) => item.id !== doc.id);
            this.storage.set("documents", remaining);
            bubble.innerHTML = '<p class="ai-document-cancelled">Document removed from this conversation.</p>';
            this.events.emit("document:removed", doc);
          } catch (error) {
            event.currentTarget.disabled = false;
            this._renderErrorBanner(error.message);
            this.events.emit("error", error);
          }
          this._scrollToBottom();
        });
        this.events.emit("document:uploaded", doc);
        this._scrollToBottom();
      }).catch((error) => {
        if (error.name === "AbortError") return;
        bubble.innerHTML = `<p class="ai-action-status-msg error">${escapeHtml(error?.message || "Failed to process document")}</p>`;
        this._scrollToBottom();
      }).finally(() => {
        controller.signal.removeEventListener("abort", showCancelled);
        if (this.documentUploadController === controller) this.documentUploadController = null;
      });
    }
    cancelDocumentUpload() {
      this.documentUploadController?.abort();
      this.documentUploadController = null;
    }
    _renderMessageBubble(role, content, animate = true, action = null) {
      const row = document.createElement("div");
      row.className = `ai-message-row ${role}`;
      row.setAttribute("data-raw-content", content);
      const bubble = document.createElement("div");
      bubble.className = "ai-bubble";
      if (role === "user") {
        bubble.textContent = content;
        row.appendChild(bubble);
      } else {
        bubble.innerHTML = parseMarkdown(content);
        const detectedAction = action || this._extractAction(content);
        if (detectedAction) {
          this._renderActionCard(bubble, detectedAction);
        }
        row.appendChild(bubble);
        const actions = document.createElement("div");
        actions.className = "ai-message-actions";
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
      const banner = document.createElement("div");
      banner.className = "ai-error-banner";
      banner.innerHTML = `
      <span>${escapeHtml(message || "An error occurred. Please try again.")}</span>
      <button class="ai-error-retry-btn" type="button">Retry</button>
    `;
      this.messagesList.appendChild(banner);
      this._scrollToBottom();
    }
    async _assertDocumentContextAvailable() {
      const knownDocuments = this.storage.get("documents", []);
      if (!Array.isArray(knownDocuments) || knownDocuments.length === 0) return;
      if (!this.activeConversationId) {
        throw new Error("The previous document session is unavailable. Start a new conversation and upload the document again.");
      }
      const currentDocuments = await this.apiClient.getDocuments(this.activeConversationId);
      const availableIds = new Set(currentDocuments.map((document2) => document2.id));
      if (knownDocuments.some((doc) => !availableIds.has(doc.id))) {
        throw new Error("Document context is no longer available for this conversation. Start a new conversation and upload the document again.");
      }
    }
    async sendMessage(text) {
      const trimmed = (text || "").trim();
      if (!trimmed || this.isGenerating) return;
      try {
        await this._assertDocumentContextAvailable();
      } catch (error) {
        this._renderErrorBanner(error.message);
        this.events.emit("error", error);
        return;
      }
      this.textarea.value = "";
      this.textarea.style.height = "auto";
      this.messages.push({ role: "user", content: trimmed });
      this._renderMessageBubble("user", trimmed);
      this._persistState();
      this.events.emit("message:sent", { role: "user", content: trimmed });
      this._setGenerating(true);
      this.abortController = new AbortController();
      let assistantBubbleRow = null;
      let assistantBubbleContent = null;
      let accumulatedText = "";
      const stream = this.options.features?.streaming ?? true;
      try {
        const context = this.options.integration && !this.contextOverrideSet ? await this.options.integration.getContext() : this.options.context;
        await this.apiClient.sendMessage({
          assistantId: this.options.assistantId || "default",
          message: trimmed,
          context: typeof context === "string" && context.trim().length > 0 ? context.trim() : void 0,
          conversationId: typeof this.activeConversationId === "string" && this.activeConversationId.trim().length > 0 ? this.activeConversationId.trim() : void 0,
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
              this.streamingIndicator.style.display = "none";
              assistantBubbleRow = document.createElement("div");
              assistantBubbleRow.className = "ai-message-row assistant";
              assistantBubbleContent = document.createElement("div");
              assistantBubbleContent.className = "ai-bubble";
              assistantBubbleRow.appendChild(assistantBubbleContent);
              this.messagesList.appendChild(assistantBubbleRow);
            }
            assistantBubbleContent.innerHTML = parseMarkdown(accumulatedText);
            assistantBubbleRow.setAttribute("data-raw-content", accumulatedText);
            this._scrollToBottom();
          },
          onDone: (result) => {
            const finalText = result.text || accumulatedText;
            const detectedAction = result.action || this._extractAction(finalText);
            if (result.conversationId) {
              this.activeConversationId = result.conversationId;
            }
            if (!assistantBubbleRow) {
              this.streamingIndicator.style.display = "none";
              this._renderMessageBubble("assistant", finalText, true, detectedAction);
            } else {
              assistantBubbleContent.innerHTML = parseMarkdown(finalText);
              if (detectedAction) {
                this._renderActionCard(assistantBubbleContent, detectedAction);
              }
              const actions = document.createElement("div");
              actions.className = "ai-message-actions";
              actions.innerHTML = `
              <button class="ai-msg-action-btn" type="button" aria-label="Copy response">
                ${ICONS.copy} Copy
              </button>
            `;
              assistantBubbleRow.appendChild(actions);
            }
            this.messages.push({ role: "assistant", content: finalText, action: detectedAction || void 0 });
            this._persistState();
            this.events.emit("message:received", { role: "assistant", content: finalText, action: detectedAction || void 0 });
          },
          onError: (err) => {
            this._renderErrorBanner(err.message);
            this.events.emit("error", err);
          }
        });
      } catch (err) {
        if (err.name !== "AbortError") {
          this._renderErrorBanner(err.message);
          this.events.emit("error", err);
        }
      } finally {
        this._setGenerating(false);
        this.abortController = null;
      }
    }
  };

  // config/document-upload.js
  var DOCUMENT_PROCESSING_CONSENT_VERSION = "1";
  var SUPPORTED_EXTENSIONS = Object.freeze([
    ".pdf",
    ".docx",
    ".txt",
    ".text",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".log"
  ]);
  var DEFAULT_DOCUMENT_UPLOAD_SETTINGS = Object.freeze({
    enabled: true,
    maxSizeBytes: 10 * 1024 * 1024,
    allowedExtensions: SUPPORTED_EXTENSIONS,
    consent: Object.freeze({
      title: "Before processing this document",
      description: "If you continue, the SDK sends this file to the assistant backend for text extraction. Extracted text is held temporarily with this conversation and may be sent to the configured AI provider when you ask questions.",
      checkboxLabel: "I agree to process this document for this conversation.",
      hostDescription: "If you continue, this file is passed to the host application\u2019s registered file handler. The host may process or transmit it under its own privacy terms. The SDK document backend is not used in this flow.",
      hostCheckboxLabel: "I agree to let the host application process this document."
    })
  });
  function normalizeDocumentUploadSettings(settings = {}) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new TypeError("documentUpload settings must be an object");
    }
    const maxSizeBytes = settings.maxSizeBytes ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.maxSizeBytes;
    if (!Number.isInteger(maxSizeBytes) || maxSizeBytes < 1 || maxSizeBytes > 10 * 1024 * 1024) {
      throw new RangeError("documentUpload.maxSizeBytes must be an integer between 1 and 10485760");
    }
    const allowedExtensions = settings.allowedExtensions ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.allowedExtensions;
    if (!Array.isArray(allowedExtensions) || allowedExtensions.length === 0 || allowedExtensions.some((extension) => !SUPPORTED_EXTENSIONS.includes(extension))) {
      throw new TypeError(`documentUpload.allowedExtensions must contain supported extensions: ${SUPPORTED_EXTENSIONS.join(", ")}`);
    }
    const consent = settings.consent ?? {};
    if (!consent || typeof consent !== "object" || Array.isArray(consent)) {
      throw new TypeError("documentUpload.consent must be an object");
    }
    const defaults = DEFAULT_DOCUMENT_UPLOAD_SETTINGS.consent;
    const normalizedConsent = {};
    for (const key of Object.keys(defaults)) {
      const value = consent[key] ?? defaults[key];
      if (typeof value !== "string" || value.trim().length === 0 || value.length > 1e3) {
        throw new TypeError(`documentUpload.consent.${key} must be a non-empty string of at most 1000 characters`);
      }
      normalizedConsent[key] = value.trim();
    }
    const enabled = settings.enabled ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.enabled;
    if (typeof enabled !== "boolean") {
      throw new TypeError("documentUpload.enabled must be a boolean");
    }
    return {
      enabled,
      maxSizeBytes,
      allowedExtensions: [...new Set(allowedExtensions)],
      consent: normalizedConsent
    };
  }

  // widget/src/api-client.js
  async function readSseEvents(response, onEvent) {
    if (!response.body?.getReader) {
      throw new Error("The server did not return a readable streaming response.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const dispatchFrame = async (frame) => {
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
      if (!data) return;
      let event;
      try {
        event = JSON.parse(data);
      } catch (cause) {
        throw new Error("The server returned a malformed streaming event.", { cause });
      }
      await onEvent(event);
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const frame of frames) {
          await dispatchFrame(frame);
        }
        if (done) break;
      }
      if (buffer.trim()) {
        await dispatchFrame(buffer);
      }
    } catch (error) {
      try {
        await reader.cancel(error);
      } catch {
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  function createStreamError(event, fallbackMessage) {
    const error = new Error(event.error?.message || fallbackMessage);
    error.code = event.error?.code;
    error.status = event.error?.status;
    return error;
  }
  var AssistantApiClient = class {
    /**
     * @param {string} baseUrl
     */
    constructor(baseUrl = "", options = {}) {
      this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
      this.getAuthHeaders = options.getAuthHeaders;
      this.credentials = options.credentials || "same-origin";
    }
    async _headers(json = false) {
      const headers = this.getAuthHeaders ? await this.getAuthHeaders() : {};
      return json ? { ...headers, "Content-Type": "application/json" } : headers;
    }
    /**
     * Fetch public assistant configuration
     */
    async fetchConfig(assistantId = "default") {
      const url = `${this.baseUrl}/api/config/${encodeURIComponent(assistantId)}`;
      const res = await fetch(url, { credentials: this.credentials });
      if (!res.ok) {
        throw new Error(`Failed to load assistant configuration (HTTP ${res.status})`);
      }
      const data = await res.json();
      return data.assistant;
    }
    /**
     * Send a chat message (streaming or non-streaming)
     */
    async sendMessage({
      assistantId = "default",
      message,
      context,
      conversationId,
      history = [],
      stream = true,
      signal,
      onStart,
      onChunk,
      onDone,
      onAction,
      onError
    }) {
      const endpoint = stream ? "/api/chat/stream" : "/api/chat";
      const url = `${this.baseUrl}${endpoint}`;
      const payload = {
        assistantId: assistantId || "default",
        message,
        stream: !!stream
      };
      if (conversationId && typeof conversationId === "string" && conversationId.trim().length > 0) {
        payload.conversationId = conversationId.trim();
      }
      if (Array.isArray(history) && history.length > 0) {
        payload.history = history;
      }
      if (typeof context === "string" && context.trim().length > 0) {
        payload.context = context.trim();
      }
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: await this._headers(true),
          body: JSON.stringify(payload),
          credentials: this.credentials,
          signal
        });
        if (!response.ok) {
          let errMsg = `Server returned HTTP ${response.status}`;
          try {
            const errData = await response.json();
            if (errData?.error) {
              if (Array.isArray(errData.error.details) && errData.error.details.length > 0) {
                const detailMsg = errData.error.details.map((d) => `${d.field}: ${d.message}`).join(", ");
                errMsg = `${errData.error.message} (${detailMsg})`;
              } else if (errData.error.message) {
                errMsg = errData.error.message;
              }
            }
          } catch {
          }
          const error = new Error(errMsg);
          error.status = response.status;
          throw error;
        }
        if (!stream) {
          const data = await response.json();
          if (onDone) onDone(data);
          return data;
        }
        let accumulatedText = "";
        let activeConversationId = conversationId;
        let actionProposal = null;
        let doneEvent = null;
        await readSseEvents(response, (event) => {
          if (event.type === "start") {
            activeConversationId = event.conversationId || activeConversationId;
            if (onStart) onStart(event);
          } else if (event.type === "chunk") {
            accumulatedText += event.delta || "";
            if (onChunk) onChunk(event.delta || "", accumulatedText);
          } else if (event.type === "action") {
            actionProposal = event.action;
            if (onAction) onAction(event.action);
          } else if (event.type === "done") {
            if (doneEvent) throw new Error("The streaming response contained duplicate completion events.");
            doneEvent = event;
            const result = {
              text: event.text || accumulatedText,
              action: event.action || actionProposal,
              conversationId: event.conversationId || activeConversationId,
              model: event.model
            };
            if (onDone) onDone(result);
          } else if (event.type === "error") {
            throw createStreamError(event, "Streaming request failed.");
          }
        });
        if (!doneEvent) {
          throw new Error("The streaming response ended before the assistant completed the request.");
        }
        return {
          text: doneEvent.text || accumulatedText,
          action: doneEvent.action || actionProposal,
          conversationId: doneEvent.conversationId || activeConversationId,
          model: doneEvent.model
        };
      } catch (err) {
        if (err.name === "AbortError") {
          return;
        }
        if (onError) onError(err);
        throw err;
      }
    }
    /**
     * Summarize text
     */
    async summarize({ text, style = "concise", focus, stream = false, signal, onChunk, onDone, onError }) {
      const url = `${this.baseUrl}/api/summarize`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: await this._headers(true),
          body: JSON.stringify({ text, style, focus, stream }),
          credentials: this.credentials,
          signal
        });
        if (!response.ok) {
          let errMsg = `Summarization failed (HTTP ${response.status})`;
          try {
            const data = await response.json();
            if (data?.error?.message) errMsg = data.error.message;
          } catch {
          }
          throw new Error(errMsg);
        }
        if (!stream) {
          const data = await response.json();
          if (onDone) onDone(data);
          return data;
        }
        let accumulated = "";
        let doneEvent = null;
        await readSseEvents(response, (event) => {
          if (event.type === "chunk") {
            accumulated += event.delta || "";
            if (onChunk) onChunk(event.delta || "", accumulated);
          } else if (event.type === "done") {
            if (doneEvent) throw new Error("The summarization stream contained duplicate completion events.");
            doneEvent = event;
            if (onDone) onDone({ text: event.text || accumulated, model: event.model });
          } else if (event.type === "error") {
            throw createStreamError(event, "Streaming summarization failed.");
          }
        });
        if (!doneEvent) {
          throw new Error("The summarization stream ended before completion.");
        }
        return { text: doneEvent.text || accumulated, model: doneEvent.model };
      } catch (err) {
        if (err.name === "AbortError") return;
        if (onError) onError(err);
        throw err;
      }
    }
    /**
     * Upload a document to the backend and attach it to the conversation session
     * @param {File|Blob} file
     * @param {string} [conversationId]
     * @param {object} [options]
     * @returns {Promise<object>}
     */
    async uploadDocument(file, conversationId, options = {}) {
      if (options.consentAccepted !== true) {
        throw new Error("Explicit document-processing consent is required before upload.");
      }
      const url = `${this.baseUrl}/api/documents/upload`;
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("consentAccepted", "true");
      formData.append("consentVersion", DOCUMENT_PROCESSING_CONSENT_VERSION);
      if (conversationId) {
        formData.append("conversationId", conversationId);
      }
      if (options.assistantId) {
        formData.append("assistantId", options.assistantId);
      }
      const res = await fetch(url, {
        method: "POST",
        headers: {
          ...await this._headers(),
          "X-Document-Processing-Consent": "accepted",
          "X-Document-Consent-Version": DOCUMENT_PROCESSING_CONSENT_VERSION
        },
        body: formData,
        credentials: this.credentials,
        signal: options.signal
      });
      if (!res.ok) {
        let errMsg = `Upload failed (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data?.error?.message) {
            errMsg = data.error.message;
          }
        } catch {
        }
        const error = new Error(errMsg);
        error.status = res.status;
        throw error;
      }
      return await res.json();
    }
    /**
     * Fetch list of documents attached to a session
     * @param {string} conversationId
     */
    async getDocuments(conversationId) {
      if (!conversationId) return [];
      const res = await fetch(`${this.baseUrl}/api/documents/${encodeURIComponent(conversationId)}`, {
        headers: await this._headers(),
        credentials: this.credentials
      });
      if (!res.ok) {
        let message = `Failed to retrieve documents (HTTP ${res.status})`;
        try {
          const data2 = await res.json();
          if (data2?.error?.message) message = data2.error.message;
        } catch {
        }
        throw new Error(message);
      }
      const data = await res.json();
      return data.documents || [];
    }
    async removeDocument(conversationId, documentId) {
      if (!conversationId || !documentId) return;
      const res = await fetch(
        `${this.baseUrl}/api/documents/${encodeURIComponent(conversationId)}/${encodeURIComponent(documentId)}`,
        {
          method: "DELETE",
          headers: await this._headers(),
          credentials: this.credentials
        }
      );
      if (!res.ok) {
        let message = `Failed to remove document (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data?.error?.message) message = data.error.message;
        } catch {
        }
        throw new Error(message);
      }
    }
    /**
     * Clear session on the server
     */
    async clearSession(conversationId) {
      if (!conversationId) return;
      const res = await fetch(`${this.baseUrl}/api/sessions/clear`, {
        method: "POST",
        headers: await this._headers(true),
        body: JSON.stringify({ conversationId }),
        credentials: this.credentials
      });
      if (!res.ok) {
        let message = `Failed to clear conversation (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data?.error?.message) message = data.error.message;
        } catch {
        }
        throw new Error(message);
      }
    }
  };

  // widget/src/storage.js
  var MemoryStore = class {
    constructor() {
      this.map = /* @__PURE__ */ new Map();
    }
    getItem(k) {
      return this.map.has(k) ? this.map.get(k) : null;
    }
    setItem(k, v) {
      this.map.set(k, String(v));
    }
    removeItem(k) {
      this.map.delete(k);
    }
    clear() {
      this.map.clear();
    }
  };
  function getSafeStorage(storageType = "session") {
    try {
      const target = storageType === "local" ? window.localStorage : window.sessionStorage;
      const testKey = "__storage_test__";
      target.setItem(testKey, testKey);
      target.removeItem(testKey);
      return target;
    } catch {
      return new MemoryStore();
    }
  }
  var AssistantStorage = class {
    constructor(assistantId = "default", storageType = "session") {
      this.prefix = `ai_assistant_${assistantId}_`;
      this.store = getSafeStorage(storageType);
    }
    get(key, defaultValue = null) {
      try {
        const raw = this.store.getItem(this.prefix + key);
        return raw !== null ? JSON.parse(raw) : defaultValue;
      } catch {
        return defaultValue;
      }
    }
    set(key, value) {
      try {
        this.store.setItem(this.prefix + key, JSON.stringify(value));
      } catch (err) {
        console.warn("AssistantStorage write failed:", err);
      }
    }
    remove(key) {
      try {
        this.store.removeItem(this.prefix + key);
      } catch {
      }
    }
    getConversationId() {
      return this.get("conversation_id", null);
    }
    saveConversationId(conversationId) {
      if (typeof conversationId === "string" && conversationId.trim()) {
        this.set("conversation_id", conversationId.trim());
      } else {
        this.clearConversationId();
      }
    }
    clearConversationId() {
      this.remove("conversation_id");
    }
    clear() {
      try {
        this.clearConversationId();
        this.remove("messages");
        this.remove("documents");
        this.remove("is_open");
      } catch {
      }
    }
  };

  // widget/src/integration.js
  var MAX_CONTEXT_LENGTH = 3e4;
  function serializeContext(context) {
    if (context === null || context === void 0 || context === "") {
      return null;
    }
    if (typeof context === "string") {
      const value2 = context.trim();
      if (value2.length > MAX_CONTEXT_LENGTH) {
        throw new RangeError(`Application context cannot exceed ${MAX_CONTEXT_LENGTH} characters`);
      }
      return value2 || null;
    }
    if (typeof context !== "object" || Array.isArray(context)) {
      throw new TypeError("Application context must be a string or a plain object");
    }
    const value = JSON.stringify(context);
    if (value.length > MAX_CONTEXT_LENGTH) {
      throw new RangeError(`Application context cannot exceed ${MAX_CONTEXT_LENGTH} characters`);
    }
    return value;
  }
  var HostIntegrationAdapter = class {
    constructor(config) {
      if (!config || typeof config !== "object" || config.version !== 1) {
        throw new TypeError("Host integration must use contract version 1");
      }
      const application = config.application;
      if (!application || typeof application.id !== "string" || !application.id.trim() || typeof application.name !== "string" || !application.name.trim()) {
        throw new TypeError("Host integration requires an application ID and name");
      }
      if (application.id.length > 100 || application.name.length > 120) {
        throw new RangeError("Host application ID and name exceed their length limits");
      }
      if (config.contextProvider !== void 0 && typeof config.contextProvider !== "function") {
        throw new TypeError("contextProvider must be a function");
      }
      if (config.getAuthHeaders !== void 0 && typeof config.getAuthHeaders !== "function") {
        throw new TypeError("getAuthHeaders must be a function");
      }
      if (config.canExecuteAction !== void 0 && typeof config.canExecuteAction !== "function") {
        throw new TypeError("canExecuteAction must be a function");
      }
      if (config.executeAction !== void 0 && typeof config.executeAction !== "function") {
        throw new TypeError("executeAction must be a function");
      }
      for (const key of ["getIdentity", "getPermissions", "getAvailableActions", "onActionProposed", "onActionResult", "onError", "subscribeContext"]) {
        if (config[key] !== void 0 && typeof config[key] !== "function") {
          throw new TypeError(`${key} must be a function`);
        }
      }
      const credentials = config.credentials || "same-origin";
      if (!["omit", "same-origin", "include"].includes(credentials)) {
        throw new TypeError("credentials must be omit, same-origin, or include");
      }
      this.application = {
        id: application.id.trim(),
        name: application.name.trim()
      };
      this.contextProvider = config.contextProvider;
      this.authHeadersProvider = config.getAuthHeaders;
      this.permissionAdapter = config.canExecuteAction;
      this.actionExecutor = config.executeAction;
      this.identityProvider = config.getIdentity;
      this.permissionsProvider = config.getPermissions;
      this.availableActionsProvider = config.getAvailableActions;
      this.actionProposalListener = config.onActionProposed;
      this.actionResultListener = config.onActionResult;
      this.errorListener = config.onError;
      this.contextSubscription = config.subscribeContext;
      this.credentials = credentials;
    }
    async getContext() {
      const provided = this.contextProvider ? await this.contextProvider() : {};
      if (provided === null || provided === void 0) {
        return serializeContext({ application: this.application });
      }
      if (typeof provided !== "object" || Array.isArray(provided)) {
        throw new TypeError("contextProvider must return an object or null");
      }
      return serializeContext({
        ...provided,
        application: this.application
      });
    }
    async getAuthHeaders() {
      const headers = this.authHeadersProvider ? await this.authHeadersProvider() : {};
      if (headers === null || headers === void 0) {
        return {};
      }
      if (typeof headers !== "object" || Array.isArray(headers)) {
        throw new TypeError("getAuthHeaders must return an object of header values");
      }
      const normalized = {};
      for (const [name, value] of Object.entries(headers)) {
        if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) {
          throw new TypeError(`Invalid host authentication header: ${name}`);
        }
        normalized[name] = value;
      }
      return normalized;
    }
    async getIdentity() {
      const identity = this.identityProvider ? await this.identityProvider() : null;
      if (identity === null || identity === void 0) return null;
      if (typeof identity !== "object" || Array.isArray(identity)) {
        throw new TypeError("getIdentity must return an object or null");
      }
      return identity;
    }
    async getPermissions() {
      const permissions = this.permissionsProvider ? await this.permissionsProvider() : [];
      if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== "string")) {
        throw new TypeError("getPermissions must return an array of strings");
      }
      return [...permissions];
    }
    async getAvailableActions() {
      const actions = this.availableActionsProvider ? await this.availableActionsProvider() : [];
      if (!Array.isArray(actions) || actions.some((action) => !action || typeof action !== "object" || typeof action.id !== "string")) {
        throw new TypeError("getAvailableActions must return an array of action objects with string IDs");
      }
      return actions;
    }
    subscribeToContextChanges(callback) {
      if (!this.contextSubscription) return () => {
      };
      const unsubscribe = this.contextSubscription(callback);
      if (typeof unsubscribe !== "function") {
        throw new TypeError("subscribeContext must return an unsubscribe function");
      }
      return unsubscribe;
    }
    notifyActionProposed(action) {
      this.actionProposalListener?.(action);
    }
    notifyActionResult(result) {
      this.actionResultListener?.(result);
    }
    notifyError(error) {
      this.errorListener?.(error);
    }
    async executeHostAction(actionId, parameters) {
      if (!this.actionExecutor) {
        throw new Error("No host action executor is configured");
      }
      if (this.permissionAdapter && !await this.permissionAdapter(actionId, parameters)) {
        throw new Error("The host application denied permission to execute this action");
      }
      return this.actionExecutor({
        application: this.application,
        actionId,
        parameters
      });
    }
  };

  // widget/src/styles.css
  var styles_default = ':host {\n  all: initial;\n  display: block;\n  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;\n  font-size: 14px;\n  line-height: 1.5;\n  color: #1f2937;\n  z-index: 2147483640;\n}\n\n*, *::before, *::after {\n  box-sizing: border-box;\n}\n\n.ai-widget-container {\n  --ai-primary: #4f46e5;\n  --ai-primary-hover: #4338ca;\n  --ai-primary-contrast: #ffffff;\n  --ai-bg: #ffffff;\n  --ai-surface: #f9fafb;\n  --ai-surface-alt: #f3f4f6;\n  --ai-border: #e5e7eb;\n  --ai-text: #111827;\n  --ai-text-muted: #6b7280;\n  --ai-user-bubble: #4f46e5;\n  --ai-user-text: #ffffff;\n  --ai-bot-bubble: #f3f4f6;\n  --ai-bot-text: #111827;\n  --ai-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);\n  --ai-radius: 16px;\n  --ai-radius-sm: 8px;\n\n  position: fixed;\n  z-index: 2147483647;\n  pointer-events: none;\n}\n\n/* Dark Theme overrides */\n.ai-widget-container[data-theme="dark"] {\n  --ai-bg: #18181b;\n  --ai-surface: #27272a;\n  --ai-surface-alt: #3f3f46;\n  --ai-border: #3f3f46;\n  --ai-text: #f4f4f5;\n  --ai-text-muted: #a1a1aa;\n  --ai-user-bubble: var(--ai-primary);\n  --ai-user-text: #ffffff;\n  --ai-bot-bubble: #27272a;\n  --ai-bot-text: #f4f4f5;\n  --ai-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);\n}\n\n/* Auto Theme Media Query */\n@media (prefers-color-scheme: dark) {\n  .ai-widget-container[data-theme="auto"] {\n    --ai-bg: #18181b;\n    --ai-surface: #27272a;\n    --ai-surface-alt: #3f3f46;\n    --ai-border: #3f3f46;\n    --ai-text: #f4f4f5;\n    --ai-text-muted: #a1a1aa;\n    --ai-user-bubble: var(--ai-primary);\n    --ai-user-text: #ffffff;\n    --ai-bot-bubble: #27272a;\n    --ai-bot-text: #f4f4f5;\n    --ai-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);\n  }\n}\n\n/* Launcher Positions */\n.pos-bottom-right { bottom: 20px; right: 20px; }\n.pos-bottom-left { bottom: 20px; left: 20px; }\n.pos-top-right { top: 20px; right: 20px; }\n.pos-top-left { top: 20px; left: 20px; }\n\n/* Floating Launcher Button */\n.ai-launcher-btn {\n  pointer-events: auto;\n  position: relative;\n  width: 56px;\n  height: 56px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  border: none;\n  cursor: pointer;\n  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s ease, box-shadow 0.2s ease;\n  outline: none;\n}\n\n.ai-launcher-btn:hover {\n  transform: scale(1.08);\n  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);\n}\n\n.ai-launcher-btn:active {\n  transform: scale(0.96);\n}\n\n.ai-launcher-btn:focus-visible {\n  outline: 3px solid var(--ai-primary);\n  outline-offset: 3px;\n}\n\n.ai-launcher-btn svg {\n  width: 26px;\n  height: 26px;\n  fill: currentColor;\n  transition: transform 0.25s ease, opacity 0.2s ease;\n}\n\n.ai-launcher-btn .icon-close {\n  display: none;\n}\n\n.ai-widget-container.is-open .ai-launcher-btn .icon-chat {\n  display: none;\n}\n\n.ai-widget-container.is-open .ai-launcher-btn .icon-close {\n  display: block;\n}\n\n/* Chat Panel */\n.ai-panel {\n  pointer-events: auto;\n  position: absolute;\n  width: 380px;\n  height: 560px;\n  max-width: calc(100vw - 32px);\n  max-height: calc(100vh - 100px);\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius);\n  box-shadow: var(--ai-shadow);\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  opacity: 0;\n  transform: scale(0.95) translateY(10px);\n  transform-origin: bottom right;\n  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);\n  visibility: hidden;\n}\n\n/* Position-based origins and anchors */\n.pos-bottom-right .ai-panel { bottom: 70px; right: 0; transform-origin: bottom right; }\n.pos-bottom-left .ai-panel { bottom: 70px; left: 0; transform-origin: bottom left; }\n.pos-top-right .ai-panel { top: 70px; right: 0; transform-origin: top right; }\n.pos-top-left .ai-panel { top: 70px; left: 0; transform-origin: top left; }\n\n.ai-widget-container.is-open .ai-panel {\n  opacity: 1;\n  transform: scale(1) translateY(0);\n  visibility: visible;\n}\n\n/* Header */\n.ai-header {\n  padding: 12px 16px;\n  background: var(--ai-bg);\n  border-bottom: 1px solid var(--ai-border);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  user-select: none;\n}\n\n.ai-header-info {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.ai-avatar {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-weight: 600;\n  font-size: 14px;\n  overflow: hidden;\n  flex-shrink: 0;\n}\n\n.ai-avatar img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.ai-header-titles {\n  display: flex;\n  flex-direction: column;\n}\n\n.ai-title {\n  font-size: 14px;\n  font-weight: 600;\n  color: var(--ai-text);\n  line-height: 1.2;\n}\n\n.ai-status {\n  font-size: 11px;\n  color: var(--ai-text-muted);\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.ai-status-dot {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: #10b981;\n}\n\n.ai-status-dot.busy {\n  background: #f59e0b;\n  animation: pulse-dot 1.5s infinite;\n}\n\n@keyframes pulse-dot {\n  0%, 100% { opacity: 1; transform: scale(1); }\n  50% { opacity: 0.5; transform: scale(1.2); }\n}\n\n.ai-header-actions {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.ai-icon-btn {\n  background: transparent;\n  border: none;\n  color: var(--ai-text-muted);\n  width: 30px;\n  height: 30px;\n  border-radius: var(--ai-radius-sm);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  transition: background-color 0.15s ease, color 0.15s ease;\n  outline: none;\n}\n\n.ai-icon-btn:hover {\n  background: var(--ai-surface-alt);\n  color: var(--ai-text);\n}\n\n.ai-icon-btn:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n.ai-icon-btn svg {\n  width: 16px;\n  height: 16px;\n  fill: currentColor;\n}\n\n/* Conversation Body */\n.ai-body {\n  flex: 1;\n  overflow-y: auto;\n  padding: 16px;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  background: var(--ai-bg);\n  scroll-behavior: smooth;\n}\n\n.ai-body::-webkit-scrollbar {\n  width: 5px;\n}\n\n.ai-body::-webkit-scrollbar-thumb {\n  background: var(--ai-border);\n  border-radius: 4px;\n}\n\n/* Welcome Box */\n.ai-welcome-box {\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius-sm);\n  padding: 14px;\n  margin-bottom: 4px;\n}\n\n.ai-welcome-greeting {\n  font-size: 13.5px;\n  color: var(--ai-text);\n  margin-bottom: 12px;\n  line-height: 1.5;\n}\n\n.ai-suggested-prompts-label {\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: var(--ai-text-muted);\n  margin-bottom: 8px;\n}\n\n.ai-prompts-list {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ai-prompt-pill {\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 14px;\n  padding: 5px 10px;\n  font-size: 12px;\n  color: var(--ai-text);\n  cursor: pointer;\n  transition: all 0.15s ease;\n  text-align: left;\n  outline: none;\n}\n\n.ai-prompt-pill:hover {\n  background: var(--ai-primary);\n  border-color: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  transform: translateY(-1px);\n}\n\n.ai-prompt-pill:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n/* Message Rows */\n.ai-message-row {\n  display: flex;\n  flex-direction: column;\n  max-width: 88%;\n  animation: fadeInMsg 0.2s ease;\n}\n\n@keyframes fadeInMsg {\n  from { opacity: 0; transform: translateY(4px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n\n.ai-message-row.user {\n  align-self: flex-end;\n}\n\n.ai-message-row.assistant {\n  align-self: flex-start;\n}\n\n.ai-bubble {\n  padding: 10px 14px;\n  border-radius: 14px;\n  font-size: 13.5px;\n  line-height: 1.55;\n  word-break: break-word;\n}\n\n.ai-message-row.user .ai-bubble {\n  background: var(--ai-user-bubble);\n  color: var(--ai-user-text);\n  border-bottom-right-radius: 4px;\n}\n\n.ai-message-row.assistant .ai-bubble {\n  background: var(--ai-bot-bubble);\n  color: var(--ai-bot-text);\n  border-bottom-left-radius: 4px;\n  border: 1px solid var(--ai-border);\n}\n\n/* Assistant Bubble Markdown elements */\n.ai-bubble p {\n  margin: 0 0 8px 0;\n}\n.ai-bubble p:last-child {\n  margin-bottom: 0;\n}\n\n.ai-bubble h2, .ai-bubble h3, .ai-bubble h4 {\n  margin: 10px 0 6px 0;\n  color: var(--ai-text);\n  font-weight: 600;\n}\n.ai-bubble h2 { font-size: 15px; }\n.ai-bubble h3 { font-size: 14px; }\n.ai-bubble h4 { font-size: 13.5px; }\n\n.ai-bubble ul, .ai-bubble ol {\n  margin: 6px 0 8px 18px;\n  padding: 0;\n}\n\n.ai-bubble li {\n  margin-bottom: 4px;\n}\n\n.ai-bubble blockquote {\n  margin: 8px 0;\n  padding: 4px 10px;\n  border-left: 3px solid var(--ai-primary);\n  background: var(--ai-surface);\n  color: var(--ai-text-muted);\n  font-style: italic;\n}\n\n.ai-bubble a {\n  color: var(--ai-primary);\n  text-decoration: underline;\n}\n\n.ai-bubble code.inline-code {\n  background: rgba(0, 0, 0, 0.08);\n  padding: 2px 5px;\n  border-radius: 4px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n  font-size: 12px;\n}\n\n[data-theme="dark"] .ai-bubble code.inline-code {\n  background: rgba(255, 255, 255, 0.12);\n}\n\n/* Code block container */\n.code-block-wrapper {\n  margin: 8px 0;\n  border-radius: 6px;\n  overflow: hidden;\n  background: #1e1e24;\n  color: #f8f8f2;\n  font-size: 12px;\n}\n\n.code-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 4px 10px;\n  background: #282a36;\n  color: #a0a0a0;\n  font-size: 11px;\n}\n\n.code-lang {\n  text-transform: uppercase;\n  font-weight: 600;\n}\n\n.copy-code-btn {\n  background: transparent;\n  border: 1px solid #44475a;\n  color: #f8f8f2;\n  border-radius: 4px;\n  padding: 2px 6px;\n  font-size: 10px;\n  cursor: pointer;\n}\n\n.copy-code-btn:hover {\n  background: #44475a;\n}\n\n.code-block-wrapper pre {\n  margin: 0;\n  padding: 10px;\n  overflow-x: auto;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n}\n\n/* Message Meta & Action Bar */\n.ai-message-actions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 4px;\n  font-size: 11px;\n  color: var(--ai-text-muted);\n}\n\n.ai-msg-action-btn {\n  background: transparent;\n  border: none;\n  color: var(--ai-text-muted);\n  font-size: 11px;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  padding: 2px 6px;\n  border-radius: 4px;\n  transition: all 0.15s ease;\n  outline: none;\n}\n\n.ai-msg-action-btn:hover {\n  background: var(--ai-surface-alt);\n  color: var(--ai-text);\n}\n\n.ai-msg-action-btn:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n/* Typing / Streaming Indicator */\n.ai-streaming-indicator {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  padding: 8px 12px;\n  border-radius: 12px;\n  background: var(--ai-bot-bubble);\n  border: 1px solid var(--ai-border);\n  width: fit-content;\n  align-self: flex-start;\n}\n\n.ai-typing-dot {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--ai-text-muted);\n  animation: typingBounce 1.4s infinite ease-in-out both;\n}\n\n.ai-typing-dot:nth-child(1) { animation-delay: -0.32s; }\n.ai-typing-dot:nth-child(2) { animation-delay: -0.16s; }\n\n@keyframes typingBounce {\n  0%, 80%, 100% { transform: scale(0); opacity: 0.4; }\n  40% { transform: scale(1); opacity: 1; }\n}\n\n/* Error Banner */\n.ai-error-banner {\n  background: #fef2f2;\n  border: 1px solid #fecaca;\n  color: #991b1b;\n  border-radius: var(--ai-radius-sm);\n  padding: 8px 12px;\n  font-size: 12px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin: 4px 0;\n}\n\n[data-theme="dark"] .ai-error-banner {\n  background: #450a0a;\n  border-color: #7f1d1d;\n  color: #fca5a5;\n}\n\n.ai-error-retry-btn {\n  background: #dc2626;\n  color: white;\n  border: none;\n  padding: 3px 8px;\n  border-radius: 4px;\n  font-size: 11px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n/* Footer / Input Area */\n.ai-footer {\n  padding: 12px 14px;\n  background: var(--ai-bg);\n  border-top: 1px solid var(--ai-border);\n}\n\n.ai-input-form {\n  display: flex;\n  align-items: flex-end;\n  gap: 8px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 18px;\n  padding: 4px 6px 4px 12px;\n  transition: border-color 0.2s ease, box-shadow 0.2s ease;\n}\n\n.ai-input-form:focus-within {\n  border-color: var(--ai-primary);\n  box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.15);\n}\n\n.ai-textarea {\n  flex: 1;\n  background: transparent;\n  border: none;\n  outline: none;\n  resize: none;\n  padding: 6px 0;\n  max-height: 120px;\n  min-height: 24px;\n  font-family: inherit;\n  font-size: 13.5px;\n  line-height: 1.4;\n  color: var(--ai-text);\n}\n\n.ai-textarea::placeholder {\n  color: var(--ai-text-muted);\n}\n\n.ai-send-btn, .ai-stop-btn {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  border: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  flex-shrink: 0;\n  transition: background-color 0.15s ease, transform 0.1s ease;\n  outline: none;\n}\n\n.ai-send-btn:hover, .ai-stop-btn:hover {\n  background: var(--ai-primary-hover);\n}\n\n.ai-send-btn:disabled {\n  background: var(--ai-border);\n  color: var(--ai-text-muted);\n  cursor: not-allowed;\n}\n\n.ai-stop-btn {\n  background: #ef4444;\n}\n\n.ai-stop-btn:hover {\n  background: #dc2626;\n}\n\n.ai-send-btn svg, .ai-stop-btn svg {\n  width: 15px;\n  height: 15px;\n  fill: currentColor;\n}\n\n.ai-footer-note {\n  font-size: 10.5px;\n  color: var(--ai-text-muted);\n  text-align: center;\n  margin-top: 6px;\n}\n\n/* Reduced Motion */\n@media (prefers-reduced-motion: reduce) {\n  .ai-launcher-btn, .ai-panel, .ai-message-row, .ai-prompt-pill {\n    transition: none !important;\n    animation: none !important;\n  }\n}\n\n/* Mobile & Small Screen Adaptability */\n@media (max-width: 640px) {\n  .ai-panel {\n    width: 100vw !important;\n    height: 100% !important;\n    max-width: 100vw !important;\n    max-height: 100vh !important;\n    top: 0 !important;\n    left: 0 !important;\n    right: 0 !important;\n    bottom: 0 !important;\n    border-radius: 0 !important;\n    position: fixed !important;\n  }\n\n  .pos-bottom-right, .pos-bottom-left, .pos-top-right, .pos-top-left {\n    bottom: 16px;\n    right: 16px;\n    left: auto;\n    top: auto;\n  }\n}\n\n/* Action Proposal Card */\n.ai-action-card {\n  margin-top: 10px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius-sm);\n  padding: 12px;\n  font-size: 12.5px;\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n[data-theme="dark"] .ai-action-card {\n  background: rgba(255, 255, 255, 0.04);\n  border-color: rgba(255, 255, 255, 0.12);\n}\n\n.ai-action-header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.ai-action-badge {\n  background: rgba(79, 70, 229, 0.12);\n  color: var(--ai-primary);\n  font-size: 10.5px;\n  font-weight: 600;\n  padding: 2px 7px;\n  border-radius: 10px;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n}\n\n[data-theme="dark"] .ai-action-badge {\n  background: rgba(99, 102, 241, 0.25);\n  color: #818cf8;\n}\n\n.ai-action-title {\n  font-weight: 600;\n  color: var(--ai-text);\n  font-size: 13px;\n  flex: 1;\n}\n\n.ai-action-explanation {\n  margin: 0;\n  color: var(--ai-text-muted);\n  line-height: 1.4;\n  font-size: 12px;\n}\n\n.ai-action-details {\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  padding: 8px 10px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n[data-theme="dark"] .ai-action-details {\n  background: rgba(0, 0, 0, 0.2);\n}\n\n.ai-action-param-row {\n  display: flex;\n  gap: 8px;\n  font-size: 11.5px;\n}\n\n.ai-action-param-key {\n  font-weight: 500;\n  color: var(--ai-text-muted);\n  min-width: 80px;\n  flex-shrink: 0;\n}\n\n.ai-action-param-val {\n  color: var(--ai-text);\n  word-break: break-word;\n  font-weight: 500;\n}\n\n.ai-action-risk {\n  border-radius: 999px;\n  font-size: 10px;\n  font-weight: 600;\n  padding: 2px 7px;\n  text-transform: uppercase;\n}\n\n.ai-action-risk.risk-read {\n  background: rgba(16, 185, 129, 0.12);\n  color: #047857;\n}\n\n.ai-action-risk.risk-write {\n  background: rgba(79, 70, 229, 0.12);\n  color: var(--ai-primary);\n}\n\n.ai-action-risk.risk-destructive {\n  background: rgba(220, 38, 38, 0.12);\n  color: #b91c1c;\n}\n\n.ai-action-acknowledgement {\n  align-items: flex-start;\n  color: var(--ai-text-muted);\n  display: flex;\n  font-size: 11px;\n  gap: 7px;\n  line-height: 1.4;\n}\n\n.ai-action-acknowledgement input {\n  margin: 1px 0 0;\n}\n\n.ai-action-controls {\n  display: flex;\n  gap: 8px;\n  margin-top: 4px;\n}\n\n.ai-btn-action-confirm, .ai-btn-action-cancel {\n  border-radius: 6px;\n  font-size: 12px;\n  font-weight: 500;\n  padding: 6px 12px;\n  cursor: pointer;\n  border: 1px solid transparent;\n  transition: all 0.15s ease;\n}\n\n.ai-btn-action-confirm {\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  flex: 1;\n}\n\n.ai-btn-action-confirm:hover:not(:disabled) {\n  background: var(--ai-primary-hover);\n}\n\n.ai-btn-action-confirm:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n\n.ai-btn-action-cancel {\n  background: transparent;\n  border-color: var(--ai-border);\n  color: var(--ai-text-muted);\n}\n\n.ai-btn-action-cancel:hover:not(:disabled) {\n  background: var(--ai-bg);\n  color: var(--ai-text);\n}\n\n.ai-action-status-msg {\n  border-radius: 6px;\n  padding: 6px 10px;\n  font-size: 11.5px;\n  font-weight: 500;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ai-action-status-msg.executing {\n  background: #eff6ff;\n  color: #1d4ed8;\n  border: 1px solid #bfdbfe;\n}\n\n.ai-action-status-msg.success {\n  background: #f0fdf4;\n  color: #15803d;\n  border: 1px solid #bbf7d0;\n}\n\n.ai-action-status-msg.error {\n  background: #fef2f2;\n  color: #b91c1c;\n  border: 1px solid #fecaca;\n}\n\n.ai-action-status-msg.cancelled {\n  background: var(--ai-bg);\n  color: var(--ai-text-muted);\n  border: 1px solid var(--ai-border);\n}\n\n[data-theme="dark"] .ai-action-status-msg.executing {\n  background: #1e3a8a;\n  color: #93c5fd;\n  border-color: #2563eb;\n}\n\n[data-theme="dark"] .ai-action-status-msg.success {\n  background: #14532d;\n  color: #86efac;\n  border-color: #16a34a;\n}\n\n[data-theme="dark"] .ai-action-status-msg.error {\n  background: #7f1d1d;\n  color: #fca5a5;\n  border-color: #dc2626;\n}\n\n/* Document Attachment Button */\n.ai-attach-btn {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: transparent;\n  color: var(--ai-text-muted);\n  border: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  flex-shrink: 0;\n  transition: all 0.15s ease;\n  outline: none;\n  margin-right: 4px;\n}\n.ai-attach-btn:hover {\n  background: var(--ai-bg);\n  color: var(--ai-primary);\n}\n.ai-attach-btn svg {\n  width: 17px;\n  height: 17px;\n  fill: currentColor;\n}\n\n.ai-processing-state {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 8px;\n  font-size: 12.5px;\n  color: var(--ai-text);\n}\n.ai-document-consent {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding: 12px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 8px;\n}\n.ai-document-consent h3,\n.ai-document-consent p {\n  margin: 0;\n}\n.ai-document-consent h3 {\n  font-size: 14px;\n  color: var(--ai-text);\n}\n.ai-document-consent p,\n.ai-document-consent-choice {\n  font-size: 12px;\n  color: var(--ai-text);\n}\n.ai-document-consent-choice {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  cursor: pointer;\n}\n.ai-document-consent-choice input {\n  flex: 0 0 auto;\n  margin-top: 3px;\n}\n.ai-document-consent-controls {\n  display: flex;\n  gap: 8px;\n}\n.ai-document-consent-controls button,\n.ai-btn-document-cancel,\n.ai-btn-document-remove {\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  padding: 6px 10px;\n  color: var(--ai-text);\n  background: var(--ai-bg);\n  font: inherit;\n  cursor: pointer;\n}\n.ai-document-consent-controls .ai-btn-document-consent-accept {\n  border-color: var(--ai-primary);\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n}\n.ai-document-consent-controls button:disabled,\n.ai-btn-document-cancel:disabled,\n.ai-btn-document-remove:disabled {\n  opacity: 0.55;\n  cursor: not-allowed;\n}\n.ai-document-cancelled {\n  color: var(--ai-text-muted);\n}\n.ai-spinner {\n  width: 16px;\n  height: 16px;\n  border: 2px solid rgba(79, 70, 229, 0.2);\n  border-top-color: var(--ai-primary);\n  border-radius: 50%;\n  animation: ai-spin 0.8s linear infinite;\n}\n@keyframes ai-spin {\n  to { transform: rotate(360deg); }\n}\n\n/* Generic Document Attachment Card */\n.ai-doc-card {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 8px;\n  padding: 10px 12px;\n  margin: 4px 0;\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);\n}\n.ai-doc-header {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n.ai-doc-icon {\n  font-size: 22px;\n  line-height: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n.ai-doc-details {\n  flex: 1;\n  min-width: 0;\n}\n.ai-doc-title {\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--ai-text);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.ai-doc-meta {\n  font-size: 11px;\n  color: var(--ai-text-muted);\n  margin-top: 2px;\n}\n.ai-doc-badge {\n  font-size: 10.5px;\n  font-weight: 500;\n  color: #059669;\n  background: rgba(16, 185, 129, 0.12);\n  padding: 3px 8px;\n  border-radius: 12px;\n  white-space: nowrap;\n}\n[data-theme="dark"] .ai-doc-badge {\n  color: #34d399;\n  background: rgba(16, 185, 129, 0.22);\n}\n.ai-doc-hint {\n  font-size: 12px;\n  color: var(--ai-text);\n  line-height: 1.4;\n  margin: 0;\n}\n';

  // widget/src/sdk.js
  var EventEmitter = class {
    constructor() {
      this.listeners = /* @__PURE__ */ new Map();
    }
    on(event, handler) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, /* @__PURE__ */ new Set());
      }
      this.listeners.get(event).add(handler);
      return () => this.off(event, handler);
    }
    off(event, handler) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).delete(handler);
      }
    }
    emit(event, ...args) {
      if (this.listeners.has(event)) {
        for (const handler of this.listeners.get(event)) {
          try {
            handler(...args);
          } catch (err) {
            console.error(`Error in event listener for "${event}":`, err);
          }
        }
      }
    }
    clear() {
      this.listeners.clear();
    }
  };
  var AssistantSDK = class {
    constructor() {
      this.version = "1.0.0";
      this.events = new EventEmitter();
      this.initialized = false;
      this.initializing = false;
      this.widgetUI = null;
      this.apiClient = null;
      this.storage = null;
      this.integration = null;
      this.config = null;
      this.integrationUnsubscribe = null;
      this.integrationHookUnsubscribes = [];
    }
    /**
     * Initialize the SDK and mount widget
     * @param {object} [options]
     * @param {string} [options.assistantId='default']
     * @param {string} [options.apiUrl=''] Base URL of the backend (default: current host origin)
     * @param {string} [options.theme='auto'] 'light' | 'dark' | 'auto'
     * @param {string} [options.primaryColor] Custom hex color
     * @param {string} [options.position='bottom-right'] 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
     * @param {string} [options.name] Display name override
     * @param {string} [options.greeting] Greeting override
     * @param {string[]} [options.suggestedPrompts] Suggested prompt list override
     * @param {object} [options.features] Feature flag overrides
     */
    async init(options = {}) {
      if (this.initialized) {
        console.warn("[AssistantSDK] SDK is already initialized. Call AssistantSDK.destroy() before reinitializing.");
        return this;
      }
      if (this.initializing) {
        return this;
      }
      const assistantId = options.assistantId || "default";
      const apiUrl = options.apiUrl || this._detectApiUrl();
      const integration = options.integration ? new HostIntegrationAdapter(options.integration) : null;
      const initialContext = serializeContext(options.context);
      const documentUpload = normalizeDocumentUploadSettings(options.documentUpload);
      this.initializing = true;
      this.integration = integration;
      this.apiClient = new AssistantApiClient(apiUrl, {
        getAuthHeaders: this.integration ? () => this.integration.getAuthHeaders() : void 0,
        credentials: this.integration?.credentials
      });
      const storageNamespace = integration ? `${integration.application.id}:${assistantId}` : assistantId;
      this.storage = new AssistantStorage(storageNamespace);
      let serverConfig = {};
      try {
        serverConfig = await this.apiClient.fetchConfig(assistantId);
      } catch (err) {
        console.warn(`[AssistantSDK] Could not fetch remote configuration for "${assistantId}", using fallback defaults.`, err.message);
      }
      this.config = {
        assistantId,
        apiUrl,
        name: options.name || serverConfig.name || "AI Assistant",
        description: options.description || serverConfig.description || "",
        avatarUrl: options.avatarUrl || serverConfig.avatarUrl || "",
        theme: options.theme || serverConfig.theme || "auto",
        primaryColor: options.primaryColor || serverConfig.primaryColor || "#4f46e5",
        position: options.position || serverConfig.position || "bottom-right",
        greeting: options.greeting || serverConfig.greeting || "Hello! How can I help you today?",
        suggestedPrompts: options.suggestedPrompts || serverConfig.suggestedPrompts || [],
        context: initialContext,
        applicationId: this.integration?.application.id || null,
        documentUpload,
        features: {
          ...serverConfig.features || {},
          ...options.features || {}
        }
      };
      if (!this.initializing) {
        return this;
      }
      this.initializing = false;
      this.widgetUI = new AssistantWidgetUI({
        ...this.config,
        integration: this.integration
      }, this.apiClient, this.storage, this.events);
      if (this.integration?.actionExecutor) {
        this.integrationUnsubscribe = this.events.on("action:execute", async (request) => {
          try {
            const result = await this.integration.executeHostAction(request.action, request.parameters);
            request.resolve(result);
          } catch (err) {
            request.reject(err);
          }
        });
      }
      if (this.integration) {
        this.integrationHookUnsubscribes.push(
          this.events.on("action:proposed", (action) => this.integration?.notifyActionProposed(action)),
          this.events.on("action:success", (result) => this.integration?.notifyActionResult({ status: "success", ...result })),
          this.events.on("action:error", (result) => this.integration?.notifyActionResult({ status: "error", ...result })),
          this.events.on("error", (error) => this.integration?.notifyError(error))
        );
        const unsubscribe = this.integration.subscribeToContextChanges(() => {
          this.refreshContext().catch((error) => {
            this.events.emit("error", error);
          });
        });
        this.integrationHookUnsubscribes.push(unsubscribe);
      }
      this.widgetUI.mount(styles_default);
      this.initialized = true;
      this.events.emit("ready", { assistantId, config: this.config });
      return this;
    }
    /**
     * Open the chat panel
     */
    open() {
      this._ensureInit();
      this.widgetUI.open();
    }
    /**
     * Close the chat panel
     */
    close() {
      this._ensureInit();
      this.widgetUI.close();
    }
    /**
     * Toggle the chat panel open/closed
     */
    toggle() {
      this._ensureInit();
      this.widgetUI.toggle();
    }
    /**
     * Programmatically send a message as the user
     * @param {string} text
     */
    async sendMessage(text) {
      this._ensureInit();
      if (!this.widgetUI.isOpen) {
        this.widgetUI.open();
      }
      return this.widgetUI.sendMessage(text);
    }
    /**
     * Standalone summarization helper
     * @param {string} text Text to summarize
     * @param {object} [options]
     * @param {'concise'|'detailed'|'bullet_points'|'key_takeaways'|'action_items'|'structured_json'} [options.style='concise']
     * @param {string} [options.focus] Specific aspect to focus on
     * @param {boolean} [options.stream=false]
     * @param {function} [options.onChunk]
     */
    async summarize(text, options = {}) {
      this._ensureInit();
      return this.apiClient.summarize({
        text,
        style: options.style || "concise",
        focus: options.focus,
        stream: !!options.stream,
        onChunk: options.onChunk
      });
    }
    /**
     * Clear active conversation history
     */
    clearConversation() {
      this._ensureInit();
      return this.widgetUI.newConversation();
    }
    /**
     * Change theme dynamically
     * @param {'light'|'dark'|'auto'} theme
     */
    setTheme(theme) {
      this._ensureInit();
      this.widgetUI.setTheme(theme);
    }
    /**
     * Change launcher position dynamically
     * @param {'bottom-right'|'bottom-left'|'top-right'|'top-left'} position
     */
    setPosition(position) {
      this._ensureInit();
      this.widgetUI.setPosition(position);
    }
    /**
     * Dynamically update host application context for subsequent conversation turns
     * @param {string|null} context Application context string, or null/empty to clear
     */
    setContext(context) {
      this._ensureInit();
      const normalized = serializeContext(context);
      this.config.context = normalized;
      if (this.widgetUI) {
        this.widgetUI.setContext(normalized);
      }
      this.events.emit("context:updated", { context: normalized });
      return this;
    }
    /**
     * Clear active host application context
     */
    clearContext() {
      this._ensureInit();
      if (!this.integration) return this.setContext(null);
      this.widgetUI.contextOverrideSet = false;
      return this.refreshContext();
    }
    async refreshContext() {
      this._ensureInit();
      if (!this.integration) return this.config.context;
      const context = await this.integration.getContext();
      if (!this.widgetUI.contextOverrideSet) {
        this.config.context = context;
        this.widgetUI.setContext(context, false);
      }
      this.events.emit("context:updated", { context });
      return context;
    }
    getHostIdentity() {
      this._ensureInit();
      return this.integration?.getIdentity() || Promise.resolve(null);
    }
    getHostPermissions() {
      this._ensureInit();
      return this.integration?.getPermissions() || Promise.resolve([]);
    }
    getAvailableActions() {
      this._ensureInit();
      return this.integration?.getAvailableActions() || Promise.resolve([]);
    }
    /**
     * Get current active host application context
     * @returns {string|null}
     */
    getContext() {
      return this.config?.context ?? null;
    }
    /**
     * Register event listener
     * Supported events: 'ready', 'open', 'close', 'message:sent', 'message:received', 'error', 'conversation:cleared', 'context:updated'
     */
    on(event, handler) {
      return this.events.on(event, handler);
    }
    /**
     * Remove event listener
     */
    off(event, handler) {
      this.events.off(event, handler);
    }
    /**
     * Get current state
     */
    getState() {
      return {
        initialized: this.initialized,
        isOpen: this.widgetUI?.isOpen || false,
        isGenerating: this.widgetUI?.isGenerating || false,
        conversationId: this.widgetUI?.activeConversationId || null,
        messageCount: this.widgetUI?.messages?.length || 0,
        context: this.config?.context ?? null,
        config: this.config ? { ...this.config } : null
      };
    }
    /**
     * Clean up widget from DOM and reset SDK state
     */
    destroy() {
      this.initializing = false;
      if (this.widgetUI) {
        this.widgetUI.unmount();
        this.widgetUI = null;
      }
      this.events.clear();
      this.integrationUnsubscribe?.();
      this.integrationUnsubscribe = null;
      for (const unsubscribe of this.integrationHookUnsubscribes) unsubscribe();
      this.integrationHookUnsubscribes = [];
      this.integration = null;
      this.storage = null;
      this.apiClient = null;
      this.config = null;
      this.initialized = false;
    }
    _ensureInit() {
      if (!this.initialized) {
        throw new Error("[AssistantSDK] SDK is not initialized. Please call AssistantSDK.init() first.");
      }
    }
    _detectApiUrl() {
      if (typeof window === "undefined") return "";
      const scripts = document.querySelectorAll('script[src*="assistant.js"]');
      if (scripts.length > 0) {
        const src = scripts[scripts.length - 1].getAttribute("src");
        try {
          const parsed = new URL(src, window.location.href);
          return parsed.origin;
        } catch {
        }
      }
      return window.location.origin;
    }
  };
  var sdkInstance = new AssistantSDK();
  if (typeof window !== "undefined") {
    let autoInitFromScriptTag = function() {
      const scripts = document.querySelectorAll('script[src*="assistant.js"]');
      if (!scripts || scripts.length === 0) return;
      const currentScript = scripts[scripts.length - 1];
      const assistantId = currentScript.getAttribute("data-assistant-id");
      const autoload = currentScript.getAttribute("data-autoload");
      const appId = currentScript.getAttribute("data-app-id");
      if (assistantId || appId || autoload === "true") {
        const options = {
          assistantId: assistantId || "default",
          apiUrl: currentScript.getAttribute("data-api-url") || void 0,
          theme: currentScript.getAttribute("data-theme") || void 0,
          primaryColor: currentScript.getAttribute("data-primary-color") || void 0,
          position: currentScript.getAttribute("data-position") || void 0,
          greeting: currentScript.getAttribute("data-greeting") || void 0,
          context: currentScript.getAttribute("data-context") || void 0,
          integration: appId ? {
            version: 1,
            application: { id: appId, name: appId }
          } : void 0
        };
        Object.keys(options).forEach((k) => options[k] === void 0 && delete options[k]);
        sdkInstance.init(options).catch((err) => {
          console.error("[AssistantSDK] Auto-initialization failed:", err);
        });
      }
    };
    window.AssistantSDK = sdkInstance;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoInitFromScriptTag);
    } else {
      autoInitFromScriptTag();
    }
  }
  var sdk_default = sdkInstance;
  return __toCommonJS(sdk_exports);
})();
//# sourceMappingURL=assistant.js.map
