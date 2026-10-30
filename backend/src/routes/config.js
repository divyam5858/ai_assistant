import { Router } from 'express';
import { getAssistantConfig } from '../../../config/assistant-presets.js';
import { AssistantConfigSchema } from '../../../config/schemas.js';

export const configRouter = Router();

/**
 * GET /api/config/:assistantId
 * Returns public widget configuration.
 * Strips sensitive server-side configurations (e.g., system instructions).
 */
configRouter.get('/:assistantId', (req, res, next) => {
  try {
    const { assistantId } = req.params;
    const rawConfig = getAssistantConfig(assistantId);

    // Validate and sanitize config
    const validated = AssistantConfigSchema.parse(rawConfig);

    // Explicitly omit internal server-only fields
    const { systemInstruction, ...publicConfig } = validated;

    res.json({
      assistant: publicConfig
    });
  } catch (err) {
    next(err);
  }
});
