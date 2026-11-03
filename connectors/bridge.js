import { ActionDefinitionSchema, ActionRegistry, actionRegistry as defaultActionRegistry } from '../backend/src/actions/registry.js';
import { registry as defaultConnectorRegistry } from './registry.js';

/**
 * Assistant Action Registry Map
 * Provides registry isolation between assistants so connector or domain actions
 * for one assistant do not leak into another assistant.
 */
const assistantRegistries = new Map();

/**
 * Get or create an isolated ActionRegistry for a specific assistant ID.
 * The default registry is generic and empty; applications register their own actions explicitly.
 * @param {string} [assistantId='default']
 * @param {object} [options]
 * @returns {ActionRegistry}
 */
export function getAssistantActionRegistry(assistantId = 'default', options = {}) {
  const resolvedAssistantId = assistantId || 'default';
  if (assistantRegistries.has(resolvedAssistantId)) {
    return assistantRegistries.get(resolvedAssistantId);
  }
  if (resolvedAssistantId === 'default') {
    return defaultActionRegistry;
  }

  const isolatedRegistry = new ActionRegistry(options);
  assistantRegistries.set(resolvedAssistantId, isolatedRegistry);
  return isolatedRegistry;
}

/**
 * Explicitly register or replace an ActionRegistry for a given assistant ID
 * @param {string} assistantId
 * @param {ActionRegistry} registry
 */
export function setAssistantActionRegistry(assistantId, registry) {
  if (!assistantId) {
    throw new Error('assistantId is required');
  }
  if (!(registry instanceof ActionRegistry)) {
    throw new TypeError('registry must be an instance of ActionRegistry');
  }
  if (assistantId === 'default') {
    assistantRegistries.set(assistantId, registry);
    return;
  }
  assistantRegistries.set(assistantId, registry);
}

/**
 * Clear assistant-specific registries (useful for testing and reset)
 */
export function clearAssistantRegistries() {
  assistantRegistries.clear();
}

/**
 * Bridge a connector into an ActionRegistry.
 * Retrieves structured action definitions from the connector, checks for collisions,
 * validates against ActionDefinitionSchema, and registers them.
 *
 * @param {import('./base.js').BaseConnector} connector
 * @param {ActionRegistry} [targetRegistry=defaultActionRegistry]
 * @param {object} [options]
 * @param {boolean} [options.overrideExisting=false]
 * @returns {Array<object>} Successfully registered action definitions
 */
export function bridgeConnectorToRegistry(connector, targetRegistry = defaultActionRegistry, options = {}) {
  if (!connector || !connector.id) {
    throw new Error('A valid connector instance with an id is required');
  }

  const definitions = connector.getActionDefinitions ? connector.getActionDefinitions() : [];
  if (!Array.isArray(definitions) || definitions.length === 0) {
    return [];
  }

  const registered = [];

  for (const rawDef of definitions) {
    // Ensure connector metadata attribution
    const defWithMetadata = {
      ...rawDef,
      metadata: {
        ...(rawDef.metadata || {}),
        connectorId: connector.id,
        connectorAction: rawDef.metadata?.connectorAction || (rawDef.name.includes(':') ? rawDef.name.split(':')[1] : rawDef.name)
      }
    };

    // Validate against ActionDefinitionSchema
    const validated = ActionDefinitionSchema.parse(defWithMetadata);

    // Collision detection
    if (targetRegistry.has(validated.name)) {
      const existing = targetRegistry.get(validated.name);
      // Idempotent re-registration by the exact same connector
      if (existing?.metadata?.connectorId === connector.id &&
          existing?.metadata?.connectorAction === validated.metadata.connectorAction) {
        if (options.overrideExisting) {
          targetRegistry.unregister(validated.name);
          targetRegistry.register(validated);
          registered.push(validated);
        } else {
          registered.push(existing);
        }
        continue;
      }

      // Hard collision with an existing application or connector action
      throw new Error(
        `Action collision detected: Action '${validated.name}' is already registered and cannot be overwritten by connector '${connector.id}'.`
      );
    }

    targetRegistry.register(validated);
    registered.push(validated);
  }

  return registered;
}

/**
 * Bridge all connectors from a ConnectorRegistry into an ActionRegistry.
 * @param {import('./registry.js').ConnectorRegistry} [connectorReg=defaultConnectorRegistry]
 * @param {ActionRegistry} [targetActionReg=defaultActionRegistry]
 * @returns {Array<object>}
 */
export function syncConnectorsToRegistry(connectorReg = defaultConnectorRegistry, targetActionReg = defaultActionRegistry) {
  const allRegistered = [];
  for (const connector of connectorReg.connectors.values()) {
    const registered = bridgeConnectorToRegistry(connector, targetActionReg);
    allRegistered.push(...registered);
  }
  return allRegistered;
}

/**
 * Remove all actions associated with a connector from an ActionRegistry
 * @param {string} connectorId
 * @param {ActionRegistry} [targetActionReg=defaultActionRegistry]
 * @returns {number} count of actions removed
 */
export function removeConnectorFromRegistry(connectorId, targetActionReg = defaultActionRegistry) {
  if (!connectorId) return 0;
  return targetActionReg.unregisterByConnector(connectorId);
}

/**
 * Safe connector execution dispatcher.
 * Distinguishes between:
 *  A. Host actions: Returned for client-side confirmation and host application execution.
 *  B. Backend connector actions: Validated, authorized, and executed server-side.
 *
 * @param {object|null} actionProposal Extracted action proposal from LLM output
 * @param {object} context Execution context
 * @param {ActionRegistry} [context.actionRegistry=defaultActionRegistry]
 * @param {import('./registry.js').ConnectorRegistry} [context.connectorRegistry=defaultConnectorRegistry]
 * @param {Record<string, string>} [context.connectorAuth={}]
 * @returns {Promise<{ isConnectorAction: boolean, hostAction: object|null, connectorResult: object|null }>}
 */
export async function dispatchActionProposal(actionProposal, context = {}) {
  if (!actionProposal || !actionProposal.action) {
    return {
      isConnectorAction: false,
      hostAction: null,
      connectorResult: null
    };
  }

  const actionReg = context.actionRegistry || defaultActionRegistry;
  const connectorReg = context.connectorRegistry || defaultConnectorRegistry;
  const connectorAuthMap = context.connectorAuth || {};

  const actionDef = actionReg.get(actionProposal.action);

  // Host application APIs remain responsible for authoritative authorization and execution.
  if (!actionDef?.metadata?.connectorId) {
    return {
      isConnectorAction: false,
      hostAction: actionProposal,
      connectorResult: null
    };
  }

  // It is a backend connector action
  const connectorId = actionDef.metadata.connectorId;
  const connectorAction = actionDef.metadata.connectorAction;

  // 1. Confirm connector is registered
  const connector = connectorReg.get(connectorId);
  if (!connector) {
    return {
      isConnectorAction: true,
      hostAction: null,
      connectorResult: {
        success: false,
        connectorId,
        action: connectorAction,
        error: {
          code: 'CONNECTOR_NOT_FOUND',
          message: `Connector '${connectorId}' is not registered`
        }
      }
    };
  }

  // 2. Confirm action is supported by connector
  if (!connector.actions.includes(connectorAction)) {
    return {
      isConnectorAction: true,
      hostAction: null,
      connectorResult: {
        success: false,
        connectorId,
        action: connectorAction,
        error: {
          code: 'UNSUPPORTED_ACTION',
          message: `Action '${connectorAction}' is not supported by connector '${connectorId}'`
        }
      }
    };
  }

  // 3. Validate action parameters against parameter schema
  if (actionDef.parameterSchema) {
    const paramValidation = actionDef.parameterSchema.safeParse(actionProposal.parameters || {});
    if (!paramValidation.success) {
      return {
        isConnectorAction: true,
        hostAction: null,
        connectorResult: {
          success: false,
          connectorId,
          action: connectorAction,
          error: {
            code: 'INVALID_PARAMETERS',
            message: 'Invalid action parameters for connector execution',
            details: paramValidation.error.format()
          }
        }
      };
    }
  }

  // 4. Resolve authorization token from server-side trusted context
  // The token cannot be manufactured by the LLM
  const authToken = connectorAuthMap[connectorId] || context.authToken;

  // 5. Enforce server-side authorization and execute action
  try {
    const authContext = await connector.validateAuthorization(authToken, {
      action: connectorAction,
      parameters: actionProposal.parameters
    });

    const executionData = await connector.execute(connectorAction, actionProposal.parameters, authContext);

    return {
      isConnectorAction: true,
      hostAction: null,
      connectorResult: {
        success: true,
        connectorId,
        action: connectorAction,
        data: executionData
      }
    };
  } catch (err) {
    // Sanitize error without exposing server secrets
    const isUnauthorized = err.statusCode === 401 ||
      (typeof err.message === 'string' && err.message.toLowerCase().includes('unauthorized'));

    return {
      isConnectorAction: true,
      hostAction: null,
      connectorResult: {
        success: false,
        connectorId,
        action: connectorAction,
        error: {
          code: isUnauthorized ? 'UNAUTHORIZED' : (err.code || 'EXECUTION_FAILED'),
          message: err.message || 'Connector execution failed'
        }
      }
    };
  }
}
