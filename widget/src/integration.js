const MAX_CONTEXT_LENGTH = 30000;

export function serializeContext(context) {
  if (context === null || context === undefined || context === '') {
    return null;
  }
  if (typeof context === 'string') {
    const value = context.trim();
    if (value.length > MAX_CONTEXT_LENGTH) {
      throw new RangeError(`Application context cannot exceed ${MAX_CONTEXT_LENGTH} characters`);
    }
    return value || null;
  }
  if (typeof context !== 'object' || Array.isArray(context)) {
    throw new TypeError('Application context must be a string or a plain object');
  }

  const value = JSON.stringify(context);
  if (value.length > MAX_CONTEXT_LENGTH) {
    throw new RangeError(`Application context cannot exceed ${MAX_CONTEXT_LENGTH} characters`);
  }
  return value;
}

export class HostIntegrationAdapter {
  constructor(config) {
    if (!config || typeof config !== 'object' || config.version !== 1) {
      throw new TypeError('Host integration must use contract version 1');
    }

    const application = config.application;
    if (!application || typeof application.id !== 'string' || !application.id.trim() ||
        typeof application.name !== 'string' || !application.name.trim()) {
      throw new TypeError('Host integration requires an application ID and name');
    }
    if (application.id.length > 100 || application.name.length > 120) {
      throw new RangeError('Host application ID and name exceed their length limits');
    }
    if (config.contextProvider !== undefined && typeof config.contextProvider !== 'function') {
      throw new TypeError('contextProvider must be a function');
    }
    if (config.getAuthHeaders !== undefined && typeof config.getAuthHeaders !== 'function') {
      throw new TypeError('getAuthHeaders must be a function');
    }
    if (config.canExecuteAction !== undefined && typeof config.canExecuteAction !== 'function') {
      throw new TypeError('canExecuteAction must be a function');
    }
    if (config.executeAction !== undefined && typeof config.executeAction !== 'function') {
      throw new TypeError('executeAction must be a function');
    }
    for (const key of ['getIdentity', 'getPermissions', 'getAvailableActions', 'onActionProposed', 'onActionResult', 'onError', 'subscribeContext']) {
      if (config[key] !== undefined && typeof config[key] !== 'function') {
        throw new TypeError(`${key} must be a function`);
      }
    }
    const credentials = config.credentials || 'same-origin';
    if (!['omit', 'same-origin', 'include'].includes(credentials)) {
      throw new TypeError('credentials must be omit, same-origin, or include');
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
    if (provided === null || provided === undefined) {
      return serializeContext({ application: this.application });
    }
    if (typeof provided !== 'object' || Array.isArray(provided)) {
      throw new TypeError('contextProvider must return an object or null');
    }
    return serializeContext({
      ...provided,
      application: this.application
    });
  }

  async getAuthHeaders() {
    const headers = this.authHeadersProvider ? await this.authHeadersProvider() : {};
    if (headers === null || headers === undefined) {
      return {};
    }
    if (typeof headers !== 'object' || Array.isArray(headers)) {
      throw new TypeError('getAuthHeaders must return an object of header values');
    }

    const normalized = {};
    for (const [name, value] of Object.entries(headers)) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
          typeof value !== 'string' ||
          /[\r\n]/.test(value)) {
        throw new TypeError(`Invalid host authentication header: ${name}`);
      }
      normalized[name] = value;
    }
    return normalized;
  }

  async getIdentity() {
    const identity = this.identityProvider ? await this.identityProvider() : null;
    if (identity === null || identity === undefined) return null;
    if (typeof identity !== 'object' || Array.isArray(identity)) {
      throw new TypeError('getIdentity must return an object or null');
    }
    return identity;
  }

  async getPermissions() {
    const permissions = this.permissionsProvider ? await this.permissionsProvider() : [];
    if (!Array.isArray(permissions) || permissions.some(permission => typeof permission !== 'string')) {
      throw new TypeError('getPermissions must return an array of strings');
    }
    return [...permissions];
  }

  async getAvailableActions() {
    const actions = this.availableActionsProvider ? await this.availableActionsProvider() : [];
    if (!Array.isArray(actions) || actions.some(action => !action || typeof action !== 'object' || typeof action.id !== 'string')) {
      throw new TypeError('getAvailableActions must return an array of action objects with string IDs');
    }
    return actions;
  }

  subscribeToContextChanges(callback) {
    if (!this.contextSubscription) return () => {};
    const unsubscribe = this.contextSubscription(callback);
    if (typeof unsubscribe !== 'function') {
      throw new TypeError('subscribeContext must return an unsubscribe function');
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
      throw new Error('No host action executor is configured');
    }
    if (this.permissionAdapter && !(await this.permissionAdapter(actionId, parameters))) {
      throw new Error('The host application denied permission to execute this action');
    }
    return this.actionExecutor({
      application: this.application,
      actionId,
      parameters
    });
  }
}
