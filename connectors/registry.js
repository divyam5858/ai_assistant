import { MockConnector } from './mock-connector.js';

class ConnectorRegistry {
  constructor() {
    this.connectors = new Map();
    // Register default mock connector
    this.register(new MockConnector());
  }

  /**
   * Register a connector instance
   * @param {import('./base.js').BaseConnector} connector
   */
  register(connector) {
    if (!connector.id) {
      throw new Error('Connector must have an id');
    }
    this.connectors.set(connector.id, connector);
  }

  /**
   * Get connector by id
   * @param {string} id
   * @returns {import('./base.js').BaseConnector|undefined}
   */
  get(id) {
    return this.connectors.get(id);
  }

  /**
   * List all registered connector metadata
   */
  list() {
    return Array.from(this.connectors.values()).map(c => c.getMetadata());
  }
}

export const registry = new ConnectorRegistry();
