/**
 * Base interface for external application connectors.
 * Connectors allow the AI assistant to query data or trigger actions in external systems.
 * All protected actions MUST validate authorization server-side.
 */
export class BaseConnector {
  /**
   * @param {string} id Unique identifier for the connector
   * @param {string} name Human-readable name
   * @param {string} description Overview of what this connector provides
   * @param {string[]} actions List of supported action names
   */
  constructor(id, name, description, actions = []) {
    if (new.target === BaseConnector) {
      throw new TypeError('Cannot construct BaseConnector instances directly');
    }
    this.id = id;
    this.name = name;
    this.description = description;
    this.actions = actions;
  }

  /**
   * Initialize connector with server-side credentials/options
   * @param {object} config
   */
  async initialize(config = {}) {
    // Override in subclass if needed
    return true;
  }

  /**
   * Get public metadata about connector capabilities
   * Does NOT reveal any secrets or internal endpoint URLs
   */
  getMetadata() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      actions: [...this.actions]
    };
  }

  /**
   * Enforce authorization server-side.
   * Connectors must never trust arbitrary client claims.
   * @param {string} [authToken]
   * @param {object} [context]
   * @returns {Promise<boolean|object>} Returns user/auth context on success, throws on failure
   */
  async validateAuthorization(authToken, context = {}) {
    throw new Error('validateAuthorization must be implemented by connector');
  }

  /**
   * Execute a connector action.
   * @param {string} action
   * @param {object} parameters
   * @param {object} authContext
   * @returns {Promise<any>}
   */
  async execute(action, parameters = {}, authContext = {}) {
    throw new Error(`execute() not implemented for action: ${action}`);
  }
}
