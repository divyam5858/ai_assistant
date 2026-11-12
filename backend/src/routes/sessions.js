import { Router } from 'express';
import { sessionManager } from '../session-manager.js';
import { authenticate } from '../middleware/auth.js';
import { createSessionOptions } from '../session-scope.js';

export const sessionsRouter = Router();

sessionsRouter.use(authenticate());

/**
 * POST /api/sessions/clear
 * Clears the active conversation messages for the provided conversationId.
 * Enforces session ownership and tenant isolation.
 */
sessionsRouter.post('/clear', (req, res, next) => {
  try {
    const { conversationId, assistantId = 'default' } = req.body;
    if (!conversationId) {
      return res.status(400).json({
        error: {
          code: 'MISSING_CONVERSATION_ID',
          message: 'conversationId is required to clear history'
        }
      });
    }

    const sessionOptions = createSessionOptions(req.user, assistantId);

    const cleared = sessionManager.clear(conversationId, sessionOptions);
    res.json({
      success: true,
      cleared,
      conversationId,
      message: 'Conversation history cleared successfully'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/sessions/:conversationId
 * Completely destroys the session.
 * Enforces session ownership and tenant isolation.
 */
sessionsRouter.delete('/:conversationId', (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const assistantId = req.query.assistantId || 'default';
    const sessionOptions = createSessionOptions(req.user, assistantId);

    const destroyed = sessionManager.destroy(conversationId, sessionOptions);
    res.json({
      success: true,
      destroyed,
      conversationId
    });
  } catch (err) {
    next(err);
  }
});
