import { AssistantWidgetUI } from './widget.js';
import { AssistantApiClient } from './api-client.js';
import { AssistantStorage } from './storage.js';
import { HostIntegrationAdapter, serializeContext } from './integration.js';
import cssText from './styles.css';
import { normalizeDocumentUploadSettings } from '../../config/document-upload.js';

/**
 * Event emitter for SDK lifecycle and conversation events
 */
class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
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
}

/**
 * Main SDK Class
 */
class AssistantSDK {
  constructor() {
    this.version = '1.0.0';
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
      console.warn('[AssistantSDK] SDK is already initialized. Call AssistantSDK.destroy() before reinitializing.');
      return this;
    }
    if (this.initializing) {
      return this;
    }

    const assistantId = options.assistantId || 'default';
    const apiUrl = options.apiUrl || this._detectApiUrl();
    const integration = options.integration
      ? new HostIntegrationAdapter(options.integration)
      : null;
    const initialContext = serializeContext(options.context);
    const documentUpload = normalizeDocumentUploadSettings(options.documentUpload);
    this.initializing = true;

    this.integration = integration;
    this.apiClient = new AssistantApiClient(apiUrl, {
      assistantId,
      getAuthHeaders: this.integration
        ? () => this.integration.getAuthHeaders()
        : undefined,
      credentials: this.integration?.credentials
    });
    const storageNamespace = integration
      ? `${integration.application.id}:${assistantId}`
      : assistantId;
    this.storage = new AssistantStorage(storageNamespace);

    // Fetch server-side public configuration for this assistant
    let serverConfig = {};
    try {
      serverConfig = await this.apiClient.fetchConfig(assistantId);
    } catch (err) {
      console.warn(`[AssistantSDK] Could not fetch remote configuration for "${assistantId}", using fallback defaults.`, err.message);
    }

    // Merge configurations (server configuration merged with client runtime overrides)
    this.config = {
      assistantId,
      apiUrl,
      name: options.name || serverConfig.name || 'AI Assistant',
      description: options.description || serverConfig.description || '',
      avatarUrl: options.avatarUrl || serverConfig.avatarUrl || '',
      theme: options.theme || serverConfig.theme || 'auto',
      primaryColor: options.primaryColor || serverConfig.primaryColor || '#4f46e5',
      position: options.position || serverConfig.position || 'bottom-right',
      greeting: options.greeting || serverConfig.greeting || 'Hello! How can I help you today?',
      suggestedPrompts: options.suggestedPrompts || serverConfig.suggestedPrompts || [],
      context: initialContext,
      applicationId: this.integration?.application.id || null,
      documentUpload,
      features: {
        ...(serverConfig.features || {}),
        ...(options.features || {})
      }
    };

    if (!this.initializing) {
      return this;
    }
    this.initializing = false;

    // Instantiate and mount widget UI
    this.widgetUI = new AssistantWidgetUI({
      ...this.config,
      integration: this.integration
    }, this.apiClient, this.storage, this.events);
    if (this.integration?.actionExecutor) {
      this.integrationUnsubscribe = this.events.on('action:execute', async (request) => {
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
        this.events.on('action:proposed', action => this.integration?.notifyActionProposed(action)),
        this.events.on('action:success', result => this.integration?.notifyActionResult({ status: 'success', ...result })),
        this.events.on('action:error', result => this.integration?.notifyActionResult({ status: 'error', ...result })),
        this.events.on('error', error => this.integration?.notifyError(error))
      );
      const unsubscribe = this.integration.subscribeToContextChanges(() => {
        this.refreshContext().catch(error => {
          this.events.emit('error', error);
        });
      });
      this.integrationHookUnsubscribes.push(unsubscribe);
    }
    this.widgetUI.mount(cssText);

    this.initialized = true;
    this.events.emit('ready', { assistantId, config: this.config });

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
      style: options.style || 'concise',
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
    this.events.emit('context:updated', { context: normalized });
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
    this.events.emit('context:updated', { context });
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
      throw new Error('[AssistantSDK] SDK is not initialized. Please call AssistantSDK.init() first.');
    }
  }

  _detectApiUrl() {
    if (typeof window === 'undefined') return '';
    // If the script was loaded from a URL like http://localhost:3000/sdk/assistant.js,
    // detect that origin automatically
    const scripts = document.querySelectorAll('script[src*="assistant.js"]');
    if (scripts.length > 0) {
      const src = scripts[scripts.length - 1].getAttribute('src');
      try {
        const parsed = new URL(src, window.location.href);
        return parsed.origin;
      } catch {}
    }
    return window.location.origin;
  }
}

// Global instance
const sdkInstance = new AssistantSDK();

// Auto-initialize if script element includes data-assistant-id or data-autoload="true"
if (typeof window !== 'undefined') {
  window.AssistantSDK = sdkInstance;

  function autoInitFromScriptTag() {
    const scripts = document.querySelectorAll('script[src*="assistant.js"]');
    if (!scripts || scripts.length === 0) return;

    const currentScript = scripts[scripts.length - 1];
    const assistantId = currentScript.getAttribute('data-assistant-id');
    const autoload = currentScript.getAttribute('data-autoload');

    const appId = currentScript.getAttribute('data-app-id');
    if (assistantId || appId || autoload === 'true') {
      const options = {
        assistantId: assistantId || 'default',
        apiUrl: currentScript.getAttribute('data-api-url') || undefined,
        theme: currentScript.getAttribute('data-theme') || undefined,
        primaryColor: currentScript.getAttribute('data-primary-color') || undefined,
        position: currentScript.getAttribute('data-position') || undefined,
        greeting: currentScript.getAttribute('data-greeting') || undefined,
        context: currentScript.getAttribute('data-context') || undefined,
        integration: appId ? {
          version: 1,
          application: { id: appId, name: appId }
        } : undefined
      };

      // Remove undefined keys
      Object.keys(options).forEach(k => options[k] === undefined && delete options[k]);

      sdkInstance.init(options).catch(err => {
        console.error('[AssistantSDK] Auto-initialization failed:', err);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitFromScriptTag);
  } else {
    autoInitFromScriptTag();
  }
}

export default sdkInstance;
