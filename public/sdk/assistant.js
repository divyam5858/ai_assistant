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
    const textWithoutAction = text.replace(/```(?:action:hirepool|action)\s*\n[\s\S]*?\n```/gi, "").trim();
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
      this.messages = [];
      this.activeConversationId = null;
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
      this.messagesList = panel.querySelector(".ai-messages-list");
      this.streamingIndicator = panel.querySelector(".ai-streaming-indicator");
      this.statusDot = panel.querySelector(".ai-status-dot");
      this.statusText = panel.querySelector(".ai-status-text");
      this.textarea = panel.querySelector(".ai-textarea");
      this.sendBtn = panel.querySelector(".ai-send-btn");
      this.stopBtn = panel.querySelector(".ai-stop-btn");
      this.attachBtn = panel.querySelector(".ai-attach-btn");
      this.fileInput = panel.querySelector(".ai-file-input");
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
      const savedConvoId = this.storage.get("conversation_id", null);
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
      this.storage.set("conversation_id", this.activeConversationId);
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
    setContext(context) {
      this.options.context = typeof context === "string" && context.trim().length > 0 ? context.trim() : null;
    }
    newConversation() {
      this.cancelGeneration();
      this.activeConversationId = null;
      this.messages = [];
      this.messagesList.innerHTML = "";
      this.storage.clear();
      this._persistState();
      this._setGenerating(false);
      this.events.emit("conversation:cleared");
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
      const match = text.match(/```(?:action:hirepool|action)\s*\n([\s\S]*?)\n```/i);
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
      const badgeLabel = action.action.startsWith("candidate:") ? "Candidate Action" : action.action.startsWith("consultancy:") ? "Agency Action" : action.action.startsWith("client:") ? "Client Action" : "Action";
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
        <span class="ai-action-title">${escapeHtml(action.title || "Proposed Action")}</span>
      </div>
      ${action.explanation ? `<p class="ai-action-explanation">${escapeHtml(action.explanation)}</p>` : ""}
      ${paramRowsHtml ? `<div class="ai-action-details">${paramRowsHtml}</div>` : ""}
      <div class="ai-action-status-msg" style="display: none;"></div>
      <div class="ai-action-controls">
        <button type="button" class="ai-btn-action-confirm">Confirm &amp; Execute</button>
        <button type="button" class="ai-btn-action-cancel">Cancel</button>
      </div>
    `;
      const btnConfirm = card.querySelector(".ai-btn-action-confirm");
      const btnCancel = card.querySelector(".ai-btn-action-cancel");
      const statusMsg = card.querySelector(".ai-action-status-msg");
      const controls = card.querySelector(".ai-action-controls");
      let executing = false;
      btnConfirm.addEventListener("click", () => {
        if (executing) return;
        executing = true;
        btnConfirm.disabled = true;
        btnCancel.disabled = true;
        statusMsg.style.display = "flex";
        statusMsg.className = "ai-action-status-msg executing";
        statusMsg.innerHTML = "Executing action in Hirepool...";
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
      const ext = "." + file.name.split(".").pop().toLowerCase();
      const allowed = [".pdf", ".docx", ".doc"];
      if (!allowed.includes(ext)) {
        this._renderMessageBubble("assistant", "\u26A0\uFE0F Unsupported file type. Please upload a PDF or DOCX document.");
        return;
      }
      const MAX_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        this._renderMessageBubble("assistant", "\u26A0\uFE0F File exceeds 10MB limit. Please upload a smaller document.");
        return;
      }
      const sizeFormatted = (file.size / 1024).toFixed(0) + " KB";
      this.messages.push({ role: "user", content: `\u{1F4CE} Uploaded document: ${file.name} (${sizeFormatted})` });
      this._renderMessageBubble("user", `\u{1F4CE} Uploaded document: ${file.name} (${sizeFormatted})`);
      this._persistState();
      const row = document.createElement("div");
      row.className = "ai-message-row assistant";
      const bubble = document.createElement("div");
      bubble.className = "ai-bubble";
      bubble.innerHTML = `
      <div class="ai-processing-state">
        <span class="ai-spinner"></span>
        <span>Processing <strong>${escapeHtml(file.name)}</strong>... Extracting candidates and validating details.</span>
      </div>
    `;
      row.appendChild(bubble);
      this.messagesList.appendChild(row);
      this._scrollToBottom();
      let handled = false;
      this.events.emit("file:upload", {
        file,
        filename: file.name,
        fileSize: file.size,
        fileType: file.type,
        resolve: (data) => {
          handled = true;
          bubble.innerHTML = "";
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
            \u26A0\uFE0F ${escapeHtml(err?.message || "Failed to process document")}
          </div>
        `;
          this._scrollToBottom();
        }
      });
      setTimeout(() => {
        if (!handled) {
          bubble.innerHTML = `
          <div class="ai-action-status-msg error">
            \u26A0\uFE0F Document processing timed out. Please ensure you are logged into an authorized agency account.
          </div>
        `;
          this._scrollToBottom();
        }
      }, 45e3);
    }
    _renderCandidateReviewCard(bubble, data) {
      const candidates = JSON.parse(JSON.stringify(data.candidates || []));
      const filename = data.filename || "Uploaded Document";
      const card = document.createElement("div");
      card.className = "ai-candidate-review-card";
      let consentConfirmed = true;
      const selectedIndices = /* @__PURE__ */ new Set();
      candidates.forEach((cand, idx) => {
        if (cand.eligible_for_creation) {
          selectedIndices.add(idx);
        }
      });
      const updateSummary = () => {
        const countEl = card.querySelector(".ai-sel-count");
        if (countEl) countEl.textContent = selectedIndices.size;
        const confirmBtn = card.querySelector(".ai-btn-confirm-candidates");
        if (confirmBtn) {
          confirmBtn.disabled = selectedIndices.size === 0 || !consentConfirmed;
        }
      };
      let itemsHtml = "";
      candidates.forEach((cand, idx) => {
        const isChecked = selectedIndices.has(idx) ? "checked" : "";
        const dupBadge = cand.is_duplicate ? cand.duplicate_scope === "agency" ? `<span class="ai-dup-badge agency" title="${escapeHtml(cand.duplicate_message || "")}">\u26A0\uFE0F In Agency Pool</span>` : `<span class="ai-dup-badge global" title="${escapeHtml(cand.duplicate_message || "")}">\u26D4 Platform Duplicate</span>` : "";
        const missingBadge = cand.missing_fields && cand.missing_fields.length > 0 ? `<span class="ai-warn-badge">Missing: ${escapeHtml(cand.missing_fields.join(", "))}</span>` : "";
        const validBadge = cand.is_valid && !cand.is_duplicate ? `<span class="ai-valid-badge">\u2713 Ready</span>` : "";
        const skillsFormatted = Array.isArray(cand.skills) ? cand.skills.join(", ") : cand.skills || "";
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
          ${cand.duplicate_message ? `<div class="ai-cand-dup-note">${escapeHtml(cand.duplicate_message)}</div>` : ""}
          <div class="ai-card-input-grid">
            <div class="ai-input-group">
              <label>First Name *</label>
              <input type="text" class="ai-card-input" data-field="first_name" data-idx="${idx}" value="${escapeHtml(cand.first_name || "")}" placeholder="First Name" />
            </div>
            <div class="ai-input-group">
              <label>Last Name *</label>
              <input type="text" class="ai-card-input" data-field="last_name" data-idx="${idx}" value="${escapeHtml(cand.last_name || "")}" placeholder="Last Name" />
            </div>
            <div class="ai-input-group">
              <label>Email *</label>
              <input type="email" class="ai-card-input" data-field="email" data-idx="${idx}" value="${escapeHtml(cand.email || "")}" placeholder="Email" />
            </div>
            <div class="ai-input-group">
              <label>Phone</label>
              <input type="text" class="ai-card-input" data-field="phone" data-idx="${idx}" value="${escapeHtml(cand.phone || "")}" placeholder="Phone" />
            </div>
            <div class="ai-input-group">
              <label>Job Title</label>
              <input type="text" class="ai-card-input" data-field="job_title" data-idx="${idx}" value="${escapeHtml(cand.job_title || "")}" placeholder="e.g. Developer" />
            </div>
            <div class="ai-input-group">
              <label>Location</label>
              <input type="text" class="ai-card-input" data-field="current_location" data-idx="${idx}" value="${escapeHtml(cand.current_location || "")}" placeholder="Location" />
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
          <button type="button" class="ai-btn-confirm-candidates" ${selectedIndices.size === 0 ? "disabled" : ""}>Confirm &amp; Create Selected</button>
          <button type="button" class="ai-btn-cancel-candidates">Cancel</button>
        </div>
      </div>
    `;
      card.querySelectorAll(".ai-cand-chk").forEach((chk) => {
        chk.addEventListener("change", (e) => {
          const idx = parseInt(e.target.getAttribute("data-idx"), 10);
          if (e.target.checked) {
            selectedIndices.add(idx);
          } else {
            selectedIndices.delete(idx);
          }
          updateSummary();
        });
      });
      card.querySelectorAll(".ai-card-input").forEach((input) => {
        input.addEventListener("input", (e) => {
          const idx = parseInt(e.target.getAttribute("data-idx"), 10);
          const field = e.target.getAttribute("data-field");
          const val = e.target.value.trim();
          if (candidates[idx]) {
            if (field === "skills") {
              candidates[idx].skills = val.split(",").map((s) => s.trim()).filter(Boolean);
            } else {
              candidates[idx][field] = val;
            }
          }
        });
      });
      const consentChk = card.querySelector(".ai-consent-checkbox");
      consentChk.addEventListener("change", (e) => {
        consentConfirmed = e.target.checked;
        updateSummary();
      });
      const btnConfirm = card.querySelector(".ai-btn-confirm-candidates");
      const btnCancel = card.querySelector(".ai-btn-cancel-candidates");
      const statusMsg = card.querySelector(".ai-review-status-msg");
      const controls = card.querySelector(".ai-review-controls");
      let executing = false;
      btnConfirm.addEventListener("click", () => {
        if (executing || selectedIndices.size === 0 || !consentConfirmed) return;
        executing = true;
        btnConfirm.disabled = true;
        btnCancel.disabled = true;
        const candidatesToCreate = [];
        selectedIndices.forEach((idx) => {
          const c = candidates[idx];
          if (c) {
            candidatesToCreate.push({
              first_name: c.first_name,
              last_name: c.last_name,
              email: c.email,
              phone: c.phone || void 0,
              current_location: c.current_location || void 0,
              job_title: c.job_title || void 0,
              professional_summary: c.professional_summary || void 0,
              years_of_experience: c.years_of_experience,
              skills: Array.isArray(c.skills) && c.skills.length > 0 ? c.skills : ["General"],
              education: c.education || [],
              work_experience: c.work_experience || [],
              certifications: c.certifications || [],
              candidate_consent: true,
              exclusivity_agreement: false
            });
          }
        });
        statusMsg.style.display = "flex";
        statusMsg.className = "ai-action-status-msg executing";
        statusMsg.innerHTML = `Creating ${candidatesToCreate.length} candidate(s) in your pool...`;
        this.events.emit("action:execute", {
          action: "consultancy:create_candidates_batch",
          parameters: { candidates: candidatesToCreate },
          resolve: (result) => {
            executing = false;
            statusMsg.style.display = "flex";
            statusMsg.className = "ai-action-status-msg success";
            statusMsg.innerHTML = `${ICONS.check} ${escapeHtml(result?.message || "Candidates created successfully!")}`;
            controls.style.display = "none";
            this._scrollToBottom();
          },
          reject: (err) => {
            executing = false;
            statusMsg.style.display = "flex";
            statusMsg.className = "ai-action-status-msg error";
            statusMsg.innerHTML = `\u26A0\uFE0F ${escapeHtml(err?.message || "Creation failed")}`;
            btnConfirm.disabled = false;
            btnCancel.disabled = false;
            this._scrollToBottom();
          }
        });
      });
      btnCancel.addEventListener("click", () => {
        if (executing) return;
        controls.style.display = "none";
        statusMsg.style.display = "flex";
        statusMsg.className = "ai-action-status-msg cancelled";
        statusMsg.textContent = "Candidate creation cancelled.";
        this._scrollToBottom();
      });
      bubble.appendChild(card);
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
    async sendMessage(text) {
      const trimmed = (text || "").trim();
      if (!trimmed || this.isGenerating) return;
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
        await this.apiClient.sendMessage({
          assistantId: this.options.assistantId || "default",
          message: trimmed,
          context: typeof this.options.context === "string" && this.options.context.trim().length > 0 ? this.options.context.trim() : void 0,
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

  // widget/src/api-client.js
  var AssistantApiClient = class {
    /**
     * @param {string} baseUrl
     */
    constructor(baseUrl = "") {
      this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
    }
    /**
     * Fetch public assistant configuration
     */
    async fetchConfig(assistantId = "default") {
      const url = `${this.baseUrl}/api/config/${encodeURIComponent(assistantId)}`;
      const res = await fetch(url);
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let accumulatedText = "";
        let activeConversationId = conversationId;
        let actionProposal = null;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const jsonStr = trimmed.slice(6).trim();
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "start") {
                activeConversationId = event.conversationId || activeConversationId;
                if (onStart) onStart(event);
              } else if (event.type === "chunk") {
                accumulatedText += event.delta;
                if (onChunk) onChunk(event.delta, accumulatedText);
              } else if (event.type === "action") {
                actionProposal = event.action;
                if (onAction) onAction(event.action);
              } else if (event.type === "done") {
                if (onDone) onDone({
                  text: event.text || accumulatedText,
                  action: event.action || actionProposal,
                  conversationId: event.conversationId || activeConversationId,
                  model: event.model
                });
              } else if (event.type === "error") {
                throw new Error(event.error?.message || "Streaming error occurred");
              }
            } catch (err) {
              if (err.message && err.message.includes("Streaming error occurred")) {
                throw err;
              }
            }
          }
        }
        return {
          text: accumulatedText,
          conversationId: activeConversationId
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, style, focus, stream }),
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
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let accumulated = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const jsonStr = trimmed.slice(6).trim();
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === "chunk") {
                accumulated += event.delta;
                if (onChunk) onChunk(event.delta, accumulated);
              } else if (event.type === "done") {
                if (onDone) onDone({ text: accumulated, model: event.model });
              } else if (event.type === "error") {
                throw new Error(event.error?.message || "Stream error in summarization");
              }
            } catch (err) {
              if (err.message && err.message.includes("Stream error")) throw err;
            }
          }
        }
        return { text: accumulated };
      } catch (err) {
        if (err.name === "AbortError") return;
        if (onError) onError(err);
        throw err;
      }
    }
    /**
     * Clear session on the server
     */
    async clearSession(conversationId) {
      if (!conversationId) return;
      try {
        await fetch(`${this.baseUrl}/api/sessions/clear`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId })
        });
      } catch (err) {
        console.warn("Failed to clear session on backend:", err);
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
    clear() {
      try {
        this.remove("conversation_id");
        this.remove("messages");
        this.remove("is_open");
      } catch {
      }
    }
  };

  // widget/src/styles.css
  var styles_default = ':host {\n  all: initial;\n  display: block;\n  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;\n  font-size: 14px;\n  line-height: 1.5;\n  color: #1f2937;\n  z-index: 2147483640;\n}\n\n*, *::before, *::after {\n  box-sizing: border-box;\n}\n\n.ai-widget-container {\n  --ai-primary: #4f46e5;\n  --ai-primary-hover: #4338ca;\n  --ai-primary-contrast: #ffffff;\n  --ai-bg: #ffffff;\n  --ai-surface: #f9fafb;\n  --ai-surface-alt: #f3f4f6;\n  --ai-border: #e5e7eb;\n  --ai-text: #111827;\n  --ai-text-muted: #6b7280;\n  --ai-user-bubble: #4f46e5;\n  --ai-user-text: #ffffff;\n  --ai-bot-bubble: #f3f4f6;\n  --ai-bot-text: #111827;\n  --ai-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);\n  --ai-radius: 16px;\n  --ai-radius-sm: 8px;\n\n  position: fixed;\n  z-index: 2147483647;\n  pointer-events: none;\n}\n\n/* Dark Theme overrides */\n.ai-widget-container[data-theme="dark"] {\n  --ai-bg: #18181b;\n  --ai-surface: #27272a;\n  --ai-surface-alt: #3f3f46;\n  --ai-border: #3f3f46;\n  --ai-text: #f4f4f5;\n  --ai-text-muted: #a1a1aa;\n  --ai-user-bubble: var(--ai-primary);\n  --ai-user-text: #ffffff;\n  --ai-bot-bubble: #27272a;\n  --ai-bot-text: #f4f4f5;\n  --ai-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);\n}\n\n/* Auto Theme Media Query */\n@media (prefers-color-scheme: dark) {\n  .ai-widget-container[data-theme="auto"] {\n    --ai-bg: #18181b;\n    --ai-surface: #27272a;\n    --ai-surface-alt: #3f3f46;\n    --ai-border: #3f3f46;\n    --ai-text: #f4f4f5;\n    --ai-text-muted: #a1a1aa;\n    --ai-user-bubble: var(--ai-primary);\n    --ai-user-text: #ffffff;\n    --ai-bot-bubble: #27272a;\n    --ai-bot-text: #f4f4f5;\n    --ai-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);\n  }\n}\n\n/* Launcher Positions */\n.pos-bottom-right { bottom: 20px; right: 20px; }\n.pos-bottom-left { bottom: 20px; left: 20px; }\n.pos-top-right { top: 20px; right: 20px; }\n.pos-top-left { top: 20px; left: 20px; }\n\n/* Floating Launcher Button */\n.ai-launcher-btn {\n  pointer-events: auto;\n  position: relative;\n  width: 56px;\n  height: 56px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  border: none;\n  cursor: pointer;\n  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.2s ease, box-shadow 0.2s ease;\n  outline: none;\n}\n\n.ai-launcher-btn:hover {\n  transform: scale(1.08);\n  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);\n}\n\n.ai-launcher-btn:active {\n  transform: scale(0.96);\n}\n\n.ai-launcher-btn:focus-visible {\n  outline: 3px solid var(--ai-primary);\n  outline-offset: 3px;\n}\n\n.ai-launcher-btn svg {\n  width: 26px;\n  height: 26px;\n  fill: currentColor;\n  transition: transform 0.25s ease, opacity 0.2s ease;\n}\n\n.ai-launcher-btn .icon-close {\n  display: none;\n}\n\n.ai-widget-container.is-open .ai-launcher-btn .icon-chat {\n  display: none;\n}\n\n.ai-widget-container.is-open .ai-launcher-btn .icon-close {\n  display: block;\n}\n\n/* Chat Panel */\n.ai-panel {\n  pointer-events: auto;\n  position: absolute;\n  width: 380px;\n  height: 560px;\n  max-width: calc(100vw - 32px);\n  max-height: calc(100vh - 100px);\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius);\n  box-shadow: var(--ai-shadow);\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  opacity: 0;\n  transform: scale(0.95) translateY(10px);\n  transform-origin: bottom right;\n  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);\n  visibility: hidden;\n}\n\n/* Position-based origins and anchors */\n.pos-bottom-right .ai-panel { bottom: 70px; right: 0; transform-origin: bottom right; }\n.pos-bottom-left .ai-panel { bottom: 70px; left: 0; transform-origin: bottom left; }\n.pos-top-right .ai-panel { top: 70px; right: 0; transform-origin: top right; }\n.pos-top-left .ai-panel { top: 70px; left: 0; transform-origin: top left; }\n\n.ai-widget-container.is-open .ai-panel {\n  opacity: 1;\n  transform: scale(1) translateY(0);\n  visibility: visible;\n}\n\n/* Header */\n.ai-header {\n  padding: 12px 16px;\n  background: var(--ai-bg);\n  border-bottom: 1px solid var(--ai-border);\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  user-select: none;\n}\n\n.ai-header-info {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.ai-avatar {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  font-weight: 600;\n  font-size: 14px;\n  overflow: hidden;\n  flex-shrink: 0;\n}\n\n.ai-avatar img {\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n\n.ai-header-titles {\n  display: flex;\n  flex-direction: column;\n}\n\n.ai-title {\n  font-size: 14px;\n  font-weight: 600;\n  color: var(--ai-text);\n  line-height: 1.2;\n}\n\n.ai-status {\n  font-size: 11px;\n  color: var(--ai-text-muted);\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.ai-status-dot {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: #10b981;\n}\n\n.ai-status-dot.busy {\n  background: #f59e0b;\n  animation: pulse-dot 1.5s infinite;\n}\n\n@keyframes pulse-dot {\n  0%, 100% { opacity: 1; transform: scale(1); }\n  50% { opacity: 0.5; transform: scale(1.2); }\n}\n\n.ai-header-actions {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.ai-icon-btn {\n  background: transparent;\n  border: none;\n  color: var(--ai-text-muted);\n  width: 30px;\n  height: 30px;\n  border-radius: var(--ai-radius-sm);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  transition: background-color 0.15s ease, color 0.15s ease;\n  outline: none;\n}\n\n.ai-icon-btn:hover {\n  background: var(--ai-surface-alt);\n  color: var(--ai-text);\n}\n\n.ai-icon-btn:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n.ai-icon-btn svg {\n  width: 16px;\n  height: 16px;\n  fill: currentColor;\n}\n\n/* Conversation Body */\n.ai-body {\n  flex: 1;\n  overflow-y: auto;\n  padding: 16px;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  background: var(--ai-bg);\n  scroll-behavior: smooth;\n}\n\n.ai-body::-webkit-scrollbar {\n  width: 5px;\n}\n\n.ai-body::-webkit-scrollbar-thumb {\n  background: var(--ai-border);\n  border-radius: 4px;\n}\n\n/* Welcome Box */\n.ai-welcome-box {\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius-sm);\n  padding: 14px;\n  margin-bottom: 4px;\n}\n\n.ai-welcome-greeting {\n  font-size: 13.5px;\n  color: var(--ai-text);\n  margin-bottom: 12px;\n  line-height: 1.5;\n}\n\n.ai-suggested-prompts-label {\n  font-size: 11px;\n  font-weight: 600;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n  color: var(--ai-text-muted);\n  margin-bottom: 8px;\n}\n\n.ai-prompts-list {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n\n.ai-prompt-pill {\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 14px;\n  padding: 5px 10px;\n  font-size: 12px;\n  color: var(--ai-text);\n  cursor: pointer;\n  transition: all 0.15s ease;\n  text-align: left;\n  outline: none;\n}\n\n.ai-prompt-pill:hover {\n  background: var(--ai-primary);\n  border-color: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  transform: translateY(-1px);\n}\n\n.ai-prompt-pill:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n/* Message Rows */\n.ai-message-row {\n  display: flex;\n  flex-direction: column;\n  max-width: 88%;\n  animation: fadeInMsg 0.2s ease;\n}\n\n@keyframes fadeInMsg {\n  from { opacity: 0; transform: translateY(4px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n\n.ai-message-row.user {\n  align-self: flex-end;\n}\n\n.ai-message-row.assistant {\n  align-self: flex-start;\n}\n\n.ai-bubble {\n  padding: 10px 14px;\n  border-radius: 14px;\n  font-size: 13.5px;\n  line-height: 1.55;\n  word-break: break-word;\n}\n\n.ai-message-row.user .ai-bubble {\n  background: var(--ai-user-bubble);\n  color: var(--ai-user-text);\n  border-bottom-right-radius: 4px;\n}\n\n.ai-message-row.assistant .ai-bubble {\n  background: var(--ai-bot-bubble);\n  color: var(--ai-bot-text);\n  border-bottom-left-radius: 4px;\n  border: 1px solid var(--ai-border);\n}\n\n/* Assistant Bubble Markdown elements */\n.ai-bubble p {\n  margin: 0 0 8px 0;\n}\n.ai-bubble p:last-child {\n  margin-bottom: 0;\n}\n\n.ai-bubble h2, .ai-bubble h3, .ai-bubble h4 {\n  margin: 10px 0 6px 0;\n  color: var(--ai-text);\n  font-weight: 600;\n}\n.ai-bubble h2 { font-size: 15px; }\n.ai-bubble h3 { font-size: 14px; }\n.ai-bubble h4 { font-size: 13.5px; }\n\n.ai-bubble ul, .ai-bubble ol {\n  margin: 6px 0 8px 18px;\n  padding: 0;\n}\n\n.ai-bubble li {\n  margin-bottom: 4px;\n}\n\n.ai-bubble blockquote {\n  margin: 8px 0;\n  padding: 4px 10px;\n  border-left: 3px solid var(--ai-primary);\n  background: var(--ai-surface);\n  color: var(--ai-text-muted);\n  font-style: italic;\n}\n\n.ai-bubble a {\n  color: var(--ai-primary);\n  text-decoration: underline;\n}\n\n.ai-bubble code.inline-code {\n  background: rgba(0, 0, 0, 0.08);\n  padding: 2px 5px;\n  border-radius: 4px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n  font-size: 12px;\n}\n\n[data-theme="dark"] .ai-bubble code.inline-code {\n  background: rgba(255, 255, 255, 0.12);\n}\n\n/* Code block container */\n.code-block-wrapper {\n  margin: 8px 0;\n  border-radius: 6px;\n  overflow: hidden;\n  background: #1e1e24;\n  color: #f8f8f2;\n  font-size: 12px;\n}\n\n.code-header {\n  display: flex;\n  justify-content: space-between;\n  align-items: center;\n  padding: 4px 10px;\n  background: #282a36;\n  color: #a0a0a0;\n  font-size: 11px;\n}\n\n.code-lang {\n  text-transform: uppercase;\n  font-weight: 600;\n}\n\n.copy-code-btn {\n  background: transparent;\n  border: 1px solid #44475a;\n  color: #f8f8f2;\n  border-radius: 4px;\n  padding: 2px 6px;\n  font-size: 10px;\n  cursor: pointer;\n}\n\n.copy-code-btn:hover {\n  background: #44475a;\n}\n\n.code-block-wrapper pre {\n  margin: 0;\n  padding: 10px;\n  overflow-x: auto;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n}\n\n/* Message Meta & Action Bar */\n.ai-message-actions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 4px;\n  font-size: 11px;\n  color: var(--ai-text-muted);\n}\n\n.ai-msg-action-btn {\n  background: transparent;\n  border: none;\n  color: var(--ai-text-muted);\n  font-size: 11px;\n  cursor: pointer;\n  display: inline-flex;\n  align-items: center;\n  gap: 3px;\n  padding: 2px 6px;\n  border-radius: 4px;\n  transition: all 0.15s ease;\n  outline: none;\n}\n\n.ai-msg-action-btn:hover {\n  background: var(--ai-surface-alt);\n  color: var(--ai-text);\n}\n\n.ai-msg-action-btn:focus-visible {\n  outline: 2px solid var(--ai-primary);\n}\n\n/* Typing / Streaming Indicator */\n.ai-streaming-indicator {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  padding: 8px 12px;\n  border-radius: 12px;\n  background: var(--ai-bot-bubble);\n  border: 1px solid var(--ai-border);\n  width: fit-content;\n  align-self: flex-start;\n}\n\n.ai-typing-dot {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--ai-text-muted);\n  animation: typingBounce 1.4s infinite ease-in-out both;\n}\n\n.ai-typing-dot:nth-child(1) { animation-delay: -0.32s; }\n.ai-typing-dot:nth-child(2) { animation-delay: -0.16s; }\n\n@keyframes typingBounce {\n  0%, 80%, 100% { transform: scale(0); opacity: 0.4; }\n  40% { transform: scale(1); opacity: 1; }\n}\n\n/* Error Banner */\n.ai-error-banner {\n  background: #fef2f2;\n  border: 1px solid #fecaca;\n  color: #991b1b;\n  border-radius: var(--ai-radius-sm);\n  padding: 8px 12px;\n  font-size: 12px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  margin: 4px 0;\n}\n\n[data-theme="dark"] .ai-error-banner {\n  background: #450a0a;\n  border-color: #7f1d1d;\n  color: #fca5a5;\n}\n\n.ai-error-retry-btn {\n  background: #dc2626;\n  color: white;\n  border: none;\n  padding: 3px 8px;\n  border-radius: 4px;\n  font-size: 11px;\n  font-weight: 500;\n  cursor: pointer;\n}\n\n/* Footer / Input Area */\n.ai-footer {\n  padding: 12px 14px;\n  background: var(--ai-bg);\n  border-top: 1px solid var(--ai-border);\n}\n\n.ai-input-form {\n  display: flex;\n  align-items: flex-end;\n  gap: 8px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 18px;\n  padding: 4px 6px 4px 12px;\n  transition: border-color 0.2s ease, box-shadow 0.2s ease;\n}\n\n.ai-input-form:focus-within {\n  border-color: var(--ai-primary);\n  box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.15);\n}\n\n.ai-textarea {\n  flex: 1;\n  background: transparent;\n  border: none;\n  outline: none;\n  resize: none;\n  padding: 6px 0;\n  max-height: 120px;\n  min-height: 24px;\n  font-family: inherit;\n  font-size: 13.5px;\n  line-height: 1.4;\n  color: var(--ai-text);\n}\n\n.ai-textarea::placeholder {\n  color: var(--ai-text-muted);\n}\n\n.ai-send-btn, .ai-stop-btn {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  border: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  flex-shrink: 0;\n  transition: background-color 0.15s ease, transform 0.1s ease;\n  outline: none;\n}\n\n.ai-send-btn:hover, .ai-stop-btn:hover {\n  background: var(--ai-primary-hover);\n}\n\n.ai-send-btn:disabled {\n  background: var(--ai-border);\n  color: var(--ai-text-muted);\n  cursor: not-allowed;\n}\n\n.ai-stop-btn {\n  background: #ef4444;\n}\n\n.ai-stop-btn:hover {\n  background: #dc2626;\n}\n\n.ai-send-btn svg, .ai-stop-btn svg {\n  width: 15px;\n  height: 15px;\n  fill: currentColor;\n}\n\n.ai-footer-note {\n  font-size: 10.5px;\n  color: var(--ai-text-muted);\n  text-align: center;\n  margin-top: 6px;\n}\n\n/* Reduced Motion */\n@media (prefers-reduced-motion: reduce) {\n  .ai-launcher-btn, .ai-panel, .ai-message-row, .ai-prompt-pill {\n    transition: none !important;\n    animation: none !important;\n  }\n}\n\n/* Mobile & Small Screen Adaptability */\n@media (max-width: 640px) {\n  .ai-panel {\n    width: 100vw !important;\n    height: 100% !important;\n    max-width: 100vw !important;\n    max-height: 100vh !important;\n    top: 0 !important;\n    left: 0 !important;\n    right: 0 !important;\n    bottom: 0 !important;\n    border-radius: 0 !important;\n    position: fixed !important;\n  }\n\n  .pos-bottom-right, .pos-bottom-left, .pos-top-right, .pos-top-left {\n    bottom: 16px;\n    right: 16px;\n    left: auto;\n    top: auto;\n  }\n}\n\n/* Action Proposal Card */\n.ai-action-card {\n  margin-top: 10px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius-sm);\n  padding: 12px;\n  font-size: 12.5px;\n  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n\n[data-theme="dark"] .ai-action-card {\n  background: rgba(255, 255, 255, 0.04);\n  border-color: rgba(255, 255, 255, 0.12);\n}\n\n.ai-action-header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.ai-action-badge {\n  background: rgba(79, 70, 229, 0.12);\n  color: var(--ai-primary);\n  font-size: 10.5px;\n  font-weight: 600;\n  padding: 2px 7px;\n  border-radius: 10px;\n  text-transform: uppercase;\n  letter-spacing: 0.5px;\n}\n\n[data-theme="dark"] .ai-action-badge {\n  background: rgba(99, 102, 241, 0.25);\n  color: #818cf8;\n}\n\n.ai-action-title {\n  font-weight: 600;\n  color: var(--ai-text);\n  font-size: 13px;\n  flex: 1;\n}\n\n.ai-action-explanation {\n  margin: 0;\n  color: var(--ai-text-muted);\n  line-height: 1.4;\n  font-size: 12px;\n}\n\n.ai-action-details {\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  padding: 8px 10px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n\n[data-theme="dark"] .ai-action-details {\n  background: rgba(0, 0, 0, 0.2);\n}\n\n.ai-action-param-row {\n  display: flex;\n  gap: 8px;\n  font-size: 11.5px;\n}\n\n.ai-action-param-key {\n  font-weight: 500;\n  color: var(--ai-text-muted);\n  min-width: 80px;\n  flex-shrink: 0;\n}\n\n.ai-action-param-val {\n  color: var(--ai-text);\n  word-break: break-word;\n  font-weight: 500;\n}\n\n.ai-action-controls {\n  display: flex;\n  gap: 8px;\n  margin-top: 4px;\n}\n\n.ai-btn-action-confirm, .ai-btn-action-cancel {\n  border-radius: 6px;\n  font-size: 12px;\n  font-weight: 500;\n  padding: 6px 12px;\n  cursor: pointer;\n  border: 1px solid transparent;\n  transition: all 0.15s ease;\n}\n\n.ai-btn-action-confirm {\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  flex: 1;\n}\n\n.ai-btn-action-confirm:hover:not(:disabled) {\n  background: var(--ai-primary-hover);\n}\n\n.ai-btn-action-confirm:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n\n.ai-btn-action-cancel {\n  background: transparent;\n  border-color: var(--ai-border);\n  color: var(--ai-text-muted);\n}\n\n.ai-btn-action-cancel:hover:not(:disabled) {\n  background: var(--ai-bg);\n  color: var(--ai-text);\n}\n\n.ai-action-status-msg {\n  border-radius: 6px;\n  padding: 6px 10px;\n  font-size: 11.5px;\n  font-weight: 500;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.ai-action-status-msg.executing {\n  background: #eff6ff;\n  color: #1d4ed8;\n  border: 1px solid #bfdbfe;\n}\n\n.ai-action-status-msg.success {\n  background: #f0fdf4;\n  color: #15803d;\n  border: 1px solid #bbf7d0;\n}\n\n.ai-action-status-msg.error {\n  background: #fef2f2;\n  color: #b91c1c;\n  border: 1px solid #fecaca;\n}\n\n.ai-action-status-msg.cancelled {\n  background: var(--ai-bg);\n  color: var(--ai-text-muted);\n  border: 1px solid var(--ai-border);\n}\n\n[data-theme="dark"] .ai-action-status-msg.executing {\n  background: #1e3a8a;\n  color: #93c5fd;\n  border-color: #2563eb;\n}\n\n[data-theme="dark"] .ai-action-status-msg.success {\n  background: #14532d;\n  color: #86efac;\n  border-color: #16a34a;\n}\n\n[data-theme="dark"] .ai-action-status-msg.error {\n  background: #7f1d1d;\n  color: #fca5a5;\n  border-color: #dc2626;\n}\n\n/* Document Attachment Button */\n.ai-attach-btn {\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  background: transparent;\n  color: var(--ai-text-muted);\n  border: none;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  flex-shrink: 0;\n  transition: all 0.15s ease;\n  outline: none;\n  margin-right: 4px;\n}\n.ai-attach-btn:hover {\n  background: var(--ai-bg);\n  color: var(--ai-primary);\n}\n.ai-attach-btn svg {\n  width: 17px;\n  height: 17px;\n  fill: currentColor;\n}\n\n/* Candidate Review Card */\n.ai-candidate-review-card {\n  margin-top: 8px;\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: var(--ai-radius-sm);\n  padding: 12px;\n  font-size: 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n.ai-review-header {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.ai-review-instructions {\n  margin: 0;\n  color: var(--ai-text-muted);\n  font-size: 11.5px;\n  line-height: 1.4;\n}\n.ai-candidate-list-scroll {\n  max-height: 280px;\n  overflow-y: auto;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  padding-right: 4px;\n}\n.ai-candidate-item {\n  background: var(--ai-bg);\n  border: 1px solid var(--ai-border);\n  border-radius: 6px;\n  padding: 10px;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.ai-candidate-item-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n.ai-candidate-select-label {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  cursor: pointer;\n}\n.ai-cand-title {\n  color: var(--ai-text);\n  font-size: 12.5px;\n}\n.ai-cand-badges {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  flex-wrap: wrap;\n}\n.ai-dup-badge, .ai-warn-badge, .ai-valid-badge {\n  font-size: 10px;\n  font-weight: 600;\n  padding: 2px 6px;\n  border-radius: 8px;\n}\n.ai-dup-badge.agency {\n  background: #fef3c7;\n  color: #92400e;\n}\n.ai-dup-badge.global {\n  background: #fee2e2;\n  color: #991b1b;\n}\n.ai-warn-badge {\n  background: #fffbeb;\n  color: #b45309;\n}\n.ai-valid-badge {\n  background: #ecfdf5;\n  color: #065f46;\n}\n[data-theme="dark"] .ai-dup-badge.agency {\n  background: #78350f;\n  color: #fde68a;\n}\n[data-theme="dark"] .ai-dup-badge.global {\n  background: #7f1d1d;\n  color: #fca5a5;\n}\n[data-theme="dark"] .ai-valid-badge {\n  background: #064e3b;\n  color: #a7f3d0;\n}\n.ai-cand-dup-note {\n  font-size: 11px;\n  color: #b91c1c;\n  background: rgba(239, 68, 68, 0.08);\n  padding: 4px 8px;\n  border-radius: 4px;\n}\n.ai-card-input-grid {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 6px;\n}\n.ai-input-group {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n}\n.ai-input-group.full-width {\n  grid-column: 1 / -1;\n}\n.ai-input-group label {\n  font-size: 10px;\n  color: var(--ai-text-muted);\n  font-weight: 500;\n}\n.ai-card-input {\n  background: var(--ai-surface);\n  border: 1px solid var(--ai-border);\n  border-radius: 4px;\n  padding: 4px 6px;\n  font-size: 11.5px;\n  color: var(--ai-text);\n  outline: none;\n  font-family: inherit;\n}\n.ai-card-input:focus {\n  border-color: var(--ai-primary);\n}\n.ai-review-footer {\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding-top: 6px;\n  border-top: 1px solid var(--ai-border);\n}\n.ai-consent-row {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 11px;\n  color: var(--ai-text-muted);\n  cursor: pointer;\n}\n.ai-selection-summary {\n  font-size: 11.5px;\n  color: var(--ai-text);\n}\n.ai-review-controls {\n  display: flex;\n  gap: 8px;\n}\n.ai-btn-confirm-candidates, .ai-btn-cancel-candidates {\n  border-radius: 6px;\n  font-size: 12px;\n  font-weight: 500;\n  padding: 6px 12px;\n  cursor: pointer;\n  border: 1px solid transparent;\n  transition: all 0.15s ease;\n}\n.ai-btn-confirm-candidates {\n  background: var(--ai-primary);\n  color: var(--ai-primary-contrast);\n  flex: 1;\n}\n.ai-btn-confirm-candidates:hover:not(:disabled) {\n  background: var(--ai-primary-hover);\n}\n.ai-btn-confirm-candidates:disabled {\n  opacity: 0.6;\n  cursor: not-allowed;\n}\n.ai-btn-cancel-candidates {\n  background: transparent;\n  border-color: var(--ai-border);\n  color: var(--ai-text-muted);\n}\n.ai-btn-cancel-candidates:hover:not(:disabled) {\n  background: var(--ai-bg);\n  color: var(--ai-text);\n}\n.ai-processing-state {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 12.5px;\n  color: var(--ai-text);\n}\n.ai-spinner {\n  width: 16px;\n  height: 16px;\n  border: 2px solid rgba(79, 70, 229, 0.2);\n  border-top-color: var(--ai-primary);\n  border-radius: 50%;\n  animation: ai-spin 0.8s linear infinite;\n}\n@keyframes ai-spin {\n  to { transform: rotate(360deg); }\n}\n';

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
      this.config = null;
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
      this.initializing = true;
      const assistantId = options.assistantId || "default";
      const apiUrl = options.apiUrl || this._detectApiUrl();
      this.apiClient = new AssistantApiClient(apiUrl);
      this.storage = new AssistantStorage(assistantId);
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
        context: typeof options.context === "string" && options.context.trim().length > 0 ? options.context.trim() : null,
        features: {
          ...serverConfig.features || {},
          ...options.features || {}
        }
      };
      if (!this.initializing) {
        return this;
      }
      this.initializing = false;
      this.widgetUI = new AssistantWidgetUI(this.config, this.apiClient, this.storage, this.events);
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
      this.widgetUI.newConversation();
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
      const normalized = typeof context === "string" && context.trim().length > 0 ? context.trim() : null;
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
      return this.setContext(null);
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
      if (assistantId || autoload === "true") {
        const options = {
          assistantId: assistantId || "default",
          apiUrl: currentScript.getAttribute("data-api-url") || void 0,
          theme: currentScript.getAttribute("data-theme") || void 0,
          primaryColor: currentScript.getAttribute("data-primary-color") || void 0,
          position: currentScript.getAttribute("data-position") || void 0,
          greeting: currentScript.getAttribute("data-greeting") || void 0,
          context: currentScript.getAttribute("data-context") || void 0
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
