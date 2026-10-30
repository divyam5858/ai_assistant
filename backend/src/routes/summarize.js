import { Router } from 'express';
import { SummarizeRequestSchema } from '../../../config/schemas.js';
import { getAIProvider } from '../providers/factory.js';
import { sanitizePrompt } from '../middleware/security.js';

export const summarizeRouter = Router();

/**
 * POST /api/summarize
 * Summarization and extraction endpoint
 * Supports regular JSON and SSE streaming (via stream=true)
 */
summarizeRouter.post('/', async (req, res, next) => {
  const abortController = new AbortController();
  let clientDisconnected = false;

  req.on('close', () => {
    clientDisconnected = true;
    abortController.abort();
  });

  try {
    const validated = SummarizeRequestSchema.parse(req.body);
    const { text, style, focus, stream } = validated;
    const sanitizedText = sanitizePrompt(text);

    const provider = getAIProvider();

    // SSE Streaming mode
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      res.write(`data: ${JSON.stringify({ type: 'start', style })}\n\n`);

      let accumulated = '';
      const result = await provider.summarize({
        text: sanitizedText,
        style,
        focus,
        stream: true,
        signal: abortController.signal,
        onChunk: (chunk) => {
          if (!clientDisconnected) {
            accumulated += chunk;
            res.write(`data: ${JSON.stringify({ type: 'chunk', delta: chunk })}\n\n`);
          }
        }
      });

      if (!clientDisconnected) {
        res.write(`data: ${JSON.stringify({
          type: 'done',
          text: accumulated || result.text,
          model: result.model
        })}\n\n`);
        res.end();
      }
      return;
    }

    // Standard JSON response
    const result = await provider.summarize({
      text: sanitizedText,
      style,
      focus,
      stream: false,
      signal: abortController.signal
    });

    let structured = null;
    if (style === 'structured_json') {
      try {
        // Strip markdown code fences if LLM wrapped in ```json
        const cleaned = result.text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
        structured = JSON.parse(cleaned);
      } catch {
        // Fallback to text if parsing failed
      }
    }

    res.json({
      summary: result.text,
      structured,
      style,
      model: result.model,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    if (clientDisconnected || abortController.signal.aborted) {
      return;
    }
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: { message: err.message }
      })}\n\n`);
      res.end();
    } else {
      next(err);
    }
  }
});
