import { Router } from 'express';
import { sessionManager } from '../session-manager.js';

export const sessionsRouter = Router();

/**
 * POST /api/sessions/clear
 * Clears the active conversation messages for the provided conversationId
 */
sessionsRouter.post('/clear', (req, res) => {
  const { conversationId } = req.body;
  if (!conversationId) {
    return res.status(400).json({
      error: {
        code: 'MISSING_CONVERSATION_ID',
        message: 'conversationId is required to clear history'
      }
    });
  }

  const cleared = sessionManager.clear(conversationId);
  res.json({
    success: true,
    cleared,
    conversationId,
    message: 'Conversation history cleared successfully'
  });
});

/**
 * DELETE /api/sessions/:conversationId
 * Completely destroys the session
 */
sessionsRouter.delete('/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const destroyed = sessionManager.destroy(conversationId);
  res.json({
    success: true,
    destroyed,
    conversationId
  });
});
