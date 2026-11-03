import { hasActionPermissions } from './registry.js';

/**
 * ActionRegistry to Native AI Tool Converter
 *
 * Converts ActionRegistry action definitions into provider-compatible native tool schemas (e.g. OpenAI function tools).
 * Maintains ActionRegistry as the single source of truth without coupling core schemas to OpenAI SDK types.
 */

/**
 * Encode an ActionRegistry action name to satisfy OpenAI's function name constraints:
 * OpenAI pattern: ^[a-zA-Z0-9_-]{1,64}$
 * Replaces colons ':' with double underscores '__'.
 *
 * @param {string} actionName
 * @returns {string}
 */
export function encodeToolName(actionName) {
  if (!actionName || typeof actionName !== 'string') {
    throw new TypeError('actionName must be a non-empty string');
  }
  return actionName.replaceAll(':', '__');
}

/**
 * Decode an OpenAI tool function name back to ActionRegistry action name.
 * Converts double underscores '__' back to colons ':'.
 *
 * @param {string} toolName
 * @returns {string}
 */
export function decodeToolName(toolName) {
  if (!toolName || typeof toolName !== 'string') {
    return toolName || '';
  }
  return toolName.replaceAll('__', ':');
}

/**
 * Convert a Zod schema or parameters definition object into standard JSON Schema for tool parameters.
 *
 * @param {object} actionDef Action definition
 * @returns {object} JSON Schema
 */
export function parametersToJsonSchema(actionDef) {
  const properties = {};
  const required = [];

  // 1. If a parameterSchema (e.g. Zod schema) is present, introspect its shape
  if (actionDef?.parameterSchema) {
    const schema = actionDef.parameterSchema;
    // Check if it's a ZodObject
    const shape = typeof schema.shape === 'function'
      ? schema.shape()
      : (schema._def?.shape || schema.shape || null);

    if (shape && typeof shape === 'object') {
      for (const [key, field] of Object.entries(shape)) {
        let current = field;
        let isOptional = false;

        // Unwrap ZodEffects, ZodOptional, ZodDefault, ZodNullable
        while (current?._def) {
          const typeName = current._def.typeName;
          if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
            isOptional = true;
            current = current._def.innerType;
          } else if (typeName === 'ZodNullable') {
            current = current._def.innerType;
          } else if (typeName === 'ZodEffects') {
            current = current._def.schema;
          } else {
            break;
          }
        }

        const typeName = current?._def?.typeName;
        let propSchema = { type: 'string' };

        if (typeName === 'ZodNumber') {
          propSchema = { type: 'number' };
        } else if (typeName === 'ZodBoolean') {
          propSchema = { type: 'boolean' };
        } else if (typeName === 'ZodArray') {
          propSchema = { type: 'array', items: { type: 'string' } };
        } else if (typeName === 'ZodEnum') {
          propSchema = { type: 'string', enum: current._def.values };
        } else if (typeName === 'ZodRecord' || typeName === 'ZodObject') {
          propSchema = { type: 'object' };
        }

        // Add description if defined
        if (field.description) {
          propSchema.description = field.description;
        } else if (actionDef.parameters && actionDef.parameters[key]) {
          const rawVal = String(actionDef.parameters[key]);
          propSchema.description = rawVal.replace(/[<>]/g, '');
        }

        properties[key] = propSchema;
        if (!isOptional) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required,
        additionalProperties: false
      };
    }
  }

  // 2. Fallback: derive properties from the parameters template object
  if (actionDef?.parameters && typeof actionDef.parameters === 'object') {
    for (const [key, val] of Object.entries(actionDef.parameters)) {
      let propType = 'string';
      let isOptional = false;

      if (typeof val === 'number') {
        propType = 'number';
      } else if (typeof val === 'boolean') {
        propType = 'boolean';
      } else if (Array.isArray(val)) {
        propType = 'array';
      } else if (typeof val === 'string') {
        if (val.toLowerCase().includes('optional')) {
          isOptional = true;
        }
      }

      const cleanDesc = typeof val === 'string' ? val.replace(/[<>]/g, '') : `Value for ${key}`;
      properties[key] = {
        type: propType,
        description: cleanDesc
      };

      if (!isOptional) {
        required.push(key);
      }
    }
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

/**
 * Convert a single ActionRegistry definition into an OpenAI-compatible native function tool definition.
 *
 * @param {object} actionDef
 * @returns {object} OpenAI function tool definition
 */
export function actionDefinitionToOpenAITool(actionDef) {
  if (!actionDef || !actionDef.name) {
    throw new Error('Invalid action definition: name is required');
  }

  const encodedName = encodeToolName(actionDef.name);
  if (encodedName.length > 64) {
    throw new Error(`Tool name '${encodedName}' exceeds OpenAI maximum allowed length of 64 characters`);
  }

  const jsonSchema = parametersToJsonSchema(actionDef);

  return {
    type: 'function',
    function: {
      name: encodedName,
      description: actionDef.description || actionDef.title || actionDef.name,
      parameters: jsonSchema
    }
  };
}

/**
 * Convert all promptable actions in an ActionRegistry into OpenAI-compatible native function tool definitions.
 * Excludes actions where `promptable === false` (e.g. internal review batch actions).
 *
 * @param {import('./registry.js').ActionRegistry} registry
 * @returns {Array<object>} List of OpenAI function tool objects
 */
export function registryToOpenAITools(registry, permissions = []) {
  if (!registry || typeof registry.list !== 'function') {
    return [];
  }

  const actions = registry.list().filter(a =>
    a.promptable !== false && hasActionPermissions(a, permissions)
  );
  return actions.map(a => actionDefinitionToOpenAITool(a));
}
