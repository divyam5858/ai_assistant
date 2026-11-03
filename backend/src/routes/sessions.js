import { Router } from 'express';
import { sessionManager } from '../session-manager.js';
import { authenticate } from '../middleware/auth.js';

export const sessionsRouter = Router();

sessionsRouter.use(authenticate());

/**
 * POST /api/sessions/clear
 * Clears the active conversation messages for the provided conversationId.
 * Enforces session ownership and tenant isolation.
 */
sessionsRouter.post('/clear', (req, res, next) => {
  try {
    const { conversationId } = req.body;
    if (!conversationId) {
      return res.status(400).json({
        error: {
          code: 'MISSING_CONVERSATION_ID',
          message: 'conversationId is required to clear history'
        }
      });
    }

    const authUser = req.user;
    const sessionOptions = {
      userId: authUser?.id || null,
      tenantId: authUser?.tenantId || null
    };

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
    const authUser = req.user;
    const sessionOptions = {
      userId: authUser?.id || null,
      tenantId: authUser?.tenantId || null
    };

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
