import { z } from 'zod';

/**
 * Zod schema defining the contract for an action registration.
 */
export const ActionDefinitionSchema = z.object({
  name: z.string().trim().min(1, 'Action name cannot be empty').max(100)
    .regex(/^[a-zA-Z0-9_:-]+$/, 'Action name must contain only alphanumeric characters, underscores, colons, or hyphens'),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1, 'Action description is required').max(1000),
  parameters: z.record(z.any()).optional().default({}),
  permissions: z.array(z.string().trim().min(1).max(100)).max(50).optional().default([]),
  risk: z.enum(['read', 'write', 'destructive']).optional().default('write'),
  parameterSchema: z.custom((val) => {
    if (val === undefined || val === null) return true;
    return typeof val === 'object' && (typeof val.parse === 'function' || typeof val.safeParse === 'function');
  }, { message: 'parameterSchema must be a valid schema instance with a parse or safeParse method' }).optional(),
  promptGuideline: z.string().max(2000).optional(),
  promptable: z.boolean().optional().default(true),
  requiresConfirmation: z.boolean().optional().default(true),
  metadata: z.record(z.any()).optional().default({})
});

/**
 * Extensible Action Registry managing application-specific action definitions,
 * validation schemas, and prompt generation.
 */
export class ActionRegistry {
  /**
   * @param {object} [options]
   * @param {string} [options.tag='action'] Code fence tag for action blocks
   * @param {Array<object>} [options.actions] Initial application action definitions
   */
  constructor(options = {}) {
    if (options.loadDefaults === true) {
      throw new Error('The loadDefaults option is not supported; pass action definitions via options.actions.');
    }
    this.tag = options.tag || 'action';
    this.actions = new Map();

    if (options.actions !== undefined) {
      this.registerMany(options.actions);
    }
  }

  /**
   * Register a single action definition
   * @param {object} rawDefinition
   * @returns {object} validated definition
   */
  register(rawDefinition) {
    const validated = ActionDefinitionSchema.parse(rawDefinition);

    if (this.actions.has(validated.name)) {
      throw new Error(`Duplicate action registration: Action '${validated.name}' is already registered.`);
    }

    this.actions.set(validated.name, validated);
    return validated;
  }

  /**
   * Register multiple action definitions atomically.
   * If any definition is invalid or causes a collision, no actions are registered.
   * @param {Array<object>} definitions
   * @returns {Array<object>}
   */
  registerMany(definitions) {
    if (!Array.isArray(definitions)) {
      throw new TypeError('registerMany expects an array of action definitions');
    }
    // Step 1: Validate all definitions first
    const validatedList = definitions.map(def => ActionDefinitionSchema.parse(def));

    // Step 2: Check for collisions within the batch and with existing actions
    const batchNames = new Set();
    for (const val of validatedList) {
      if (batchNames.has(val.name)) {
        throw new Error(`Duplicate action registration in batch: Action '${val.name}' is specified more than once.`);
      }
      batchNames.add(val.name);

      if (this.actions.has(val.name)) {
        throw new Error(`Duplicate action registration: Action '${val.name}' is already registered.`);
      }
    }

    // Step 3: All passed; commit atomically to registry
    for (const val of validatedList) {
      this.actions.set(val.name, val);
    }
    return validatedList.map(a => ({ ...a }));
  }

  /**
   * Unregister an action by name
   * @param {string} name
   * @returns {boolean}
   */
  unregister(name) {
    return this.actions.delete(name);
  }

  /**
   * Get an action definition by name (returns shallow copy to prevent state corruption)
   * @param {string} name
   * @returns {object|undefined}
   */
  get(name) {
    const act = this.actions.get(name);
    return act ? { ...act } : undefined;
  }

  /**
   * Check if an action is registered
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this.actions.has(name);
  }

  /**
   * List all registered action definitions (returns shallow copies)
   * @returns {Array<object>}
   */
  list() {
    return Array.from(this.actions.values()).map(a => ({ ...a }));
  }

  /**
   * Find all actions associated with a specific connector ID
   * @param {string} connectorId
   * @returns {Array<object>}
   */
  findByConnector(connectorId) {
    return Array.from(this.actions.values())
      .filter(a => a.metadata?.connectorId === connectorId)
      .map(a => ({ ...a }));
  }

  /**
   * Unregister all actions associated with a specific connector ID
   * @param {string} connectorId
   * @returns {number} count of removed actions
   */
  unregisterByConnector(connectorId) {
    let count = 0;
    for (const [name, def] of this.actions.entries()) {
      if (def.metadata?.connectorId === connectorId) {
        this.actions.delete(name);
        count++;
      }
    }
    return count;
  }

  /**
   * Get all registered action names
   * @returns {string[]}
   */
  getAllowedActionNames() {
    return Array.from(this.actions.keys());
  }

  /**
   * Clear all registered actions
   */
  clear() {
    this.actions.clear();
  }

  /**
   * Format prompt guidelines for all promptable registered actions
   * @param {string} [customTag]
   * @returns {string}
   */
  formatPromptGuidelines(customTag, permissions = []) {
    const tag = customTag || this.tag || 'action';
    const promptableActions = Array.from(this.actions.values()).filter(a =>
      a.promptable !== false && hasActionPermissions(a, permissions)
    );

    if (promptableActions.length === 0) {
      return '';
    }

    const actionLines = promptableActions.map((a, idx) => {
      if (a.promptGuideline) {
        return `${idx + 1}. "${a.name}": ${a.promptGuideline}`;
      }
      const paramsFormatted = a.parameters && Object.keys(a.parameters).length > 0
        ? `\n   Parameters: ${JSON.stringify(a.parameters)}`
        : '';
      return `${idx + 1}. "${a.name}": ${a.description}${paramsFormatted}`;
    }).join('\n');

    return `[STRUCTURED ACTION PROPOSALS]
When the user explicitly asks to perform one of the following operations, provide a clear explanation and propose the action using a fenced code block with tag '${tag}':
Allowed Actions:
${actionLines}

Format requirement:
\`\`\`${tag}
{
  "id": "act_123456",
  "action": "<one of the allowed actions>",
  "title": "<short human readable title>",
  "explanation": "<brief summary of what will be submitted>",
  "parameters": { ... }
}
\`\`\`
If the user is not requesting an action, answer in normal helpful text without any action block.`;
  }

  /**
   * Validate an action proposal against registered actions
   * @param {object} proposal
   * @returns {{ success: boolean, data?: object, error?: any }}
   */
  validateProposal(proposal) {
    const ProposalSchema = createActionProposalSchema(this);
    const result = ProposalSchema.safeParse(proposal);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const actionDef = this.actions.get(result.data.action);
    if (actionDef?.parameterSchema) {
      const paramResult = actionDef.parameterSchema.safeParse(result.data.parameters);
      if (!paramResult.success) {
        return { success: false, error: paramResult.error };
      }
    }

    return { success: true, data: result.data };
  }
}

/**
 * Check whether a trusted permission set satisfies an action definition.
 * @param {object} actionDefinition
 * @param {string[]} [permissions]
 * @returns {boolean}
 */
export function hasActionPermissions(actionDefinition, permissions = []) {
  const granted = new Set(Array.isArray(permissions) ? permissions : []);
  return (actionDefinition.permissions || []).every(permission => granted.has(permission));
}

/**
 * Factory function creating an ActionProposalSchema bound to a registry instance
 * @param {ActionRegistry} registry
 */
export function createActionProposalSchema(registry = actionRegistry) {
  return z.object({
    id: z.string().min(1).max(64),
    action: z.string().min(1).max(100).refine(
      (actionName) => registry.has(actionName),
      { message: 'Action is not registered or allowed' }
    ),
    title: z.string().min(1).max(120),
    explanation: z.string().max(1000).optional().default(''),
    parameters: z.record(z.any()).default({})
  });
}

// The generic singleton starts empty; integrations register their own actions.
export const actionRegistry = new ActionRegistry();
