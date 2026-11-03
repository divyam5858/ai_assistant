import { Router } from 'express';
import multer from 'multer';
import { parseDocument, DocumentProcessingError } from '../services/document-parser.js';
import { sessionManager } from '../session-manager.js';
import { authenticate } from '../middleware/auth.js';
import { DOCUMENT_PROCESSING_CONSENT_VERSION } from '../../../config/document-upload.js';

export const documentsRouter = Router();

// Configure multer for memory storage with 10MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// Optional authentication: accepts authenticated user or public session
documentsRouter.use(authenticate());

/**
 * Handle file upload error from multer
 */
function handleMulterUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: {
            code: 'FILE_TOO_LARGE',
            message: 'Uploaded file exceeds the maximum allowed size of 10MB'
          }
        });
      }
      return res.status(400).json({
        error: {
          code: 'UPLOAD_ERROR',
          message: err.message || 'File upload failed'
        }
      });
    }
    next();
  });
}

function requireDocumentProcessingConsent(req, res, next) {
  if (req.get('X-Document-Processing-Consent') !== 'accepted') {
    return res.status(400).json({
      error: {
        code: 'DOCUMENT_CONSENT_REQUIRED',
        message: 'Review and accept the current document-processing notice before uploading.'
      }
    });
  }
  if (req.get('X-Document-Consent-Version') !== DOCUMENT_PROCESSING_CONSENT_VERSION) {
    return res.status(400).json({
      error: {
        code: 'DOCUMENT_CONSENT_VERSION_INVALID',
        message: 'The document-processing consent notice is outdated. Review and accept the current notice.'
      }
    });
  }
  next();
}

/**
 * POST /api/documents/upload
 * Generic endpoint to upload, parse, and attach a document to a conversation session.
 */
documentsRouter.post('/upload', requireDocumentProcessingConsent, handleMulterUpload, async (req, res, next) => {
  try {
    let fileBuffer;
    let base64Content;
    let filename;
    let mimetype = '';

    const conversationId = req.body.conversationId || req.query.conversationId || null;
    const assistantId = req.body.assistantId || req.query.assistantId || 'default';

    const authUser = req.user;
    const sessionOptions = {
      userId: authUser?.id || null,
      tenantId: authUser?.tenantId || null
    };

    if (req.file) {
      fileBuffer = req.file.buffer;
      filename = req.file.originalname;
      mimetype = req.file.mimetype;
    } else if (req.body.base64Content) {
      base64Content = req.body.base64Content;
      filename = req.body.filename || 'document';
      mimetype = req.body.mimetype || '';
    } else {
      return res.status(400).json({
        error: {
          code: 'MISSING_FILE',
          message: 'No file provided. Upload a file using multipart form-data (field "file") or JSON (field "base64Content")'
        }
      });
    }

    if (req.body.consentAccepted !== true && req.body.consentAccepted !== 'true') {
      return res.status(400).json({
        error: {
          code: 'DOCUMENT_CONSENT_REQUIRED',
          message: 'Explicit document-processing consent is required before processing.'
        }
      });
    }
    if (req.body.consentVersion !== DOCUMENT_PROCESSING_CONSENT_VERSION) {
      return res.status(400).json({
        error: {
          code: 'DOCUMENT_CONSENT_VERSION_INVALID',
          message: 'The document-processing consent notice is outdated. Review and accept the current notice.'
        }
      });
    }

    if (base64Content) {
      fileBuffer = Buffer.from(base64Content, 'base64');
    }

    // Parse and extract text safely
    const parsed = await parseDocument(fileBuffer, filename, mimetype);

    if (req.aborted || res.destroyed) return;

    // Get or initialize conversation session
    const session = sessionManager.getOrCreate(conversationId, assistantId, sessionOptions);

    // Attach document to session
    const attachedDoc = sessionManager.addDocument(session.id, {
      ...parsed,
      consentVersion: DOCUMENT_PROCESSING_CONSENT_VERSION,
      consentAcceptedAt: Date.now()
    }, sessionOptions);

    res.status(200).json({
      status: 'success',
      conversationId: session.id,
      document: {
        id: attachedDoc.id,
        filename: attachedDoc.filename,
        fileType: attachedDoc.fileType,
        fileSize: attachedDoc.fileSize,
        textLength: attachedDoc.charCount,
        wordCount: attachedDoc.wordCount,
        pageCount: attachedDoc.pageCount,
        truncated: parsed.truncated || false,
        consentVersion: attachedDoc.consentVersion,
        uploadedAt: attachedDoc.uploadedAt
      },
        consentVersion: DOCUMENT_PROCESSING_CONSENT_VERSION,
        message: `Document "${attachedDoc.filename}" processed successfully and attached to session.`
    });
  } catch (err) {
    if (err instanceof DocumentProcessingError) {
      return res.status(err.statusCode || 400).json({
        error: {
          code: err.code || 'DOCUMENT_PROCESSING_ERROR',
          message: err.message
        }
      });
    }
    next(err);
  }
});

/**
 * GET /api/documents/:conversationId
 * Retrieve list of attached documents for a session
 */
documentsRouter.get('/:conversationId', (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const authUser = req.user;
    const sessionOptions = {
      userId: authUser?.id || null,
      tenantId: authUser?.tenantId || null
    };

    const documents = sessionManager.getDocuments(conversationId, sessionOptions);
    res.json({
      conversationId,
      documents: documents.map(d => ({
        id: d.id,
        filename: d.filename,
        fileType: d.fileType,
        fileSize: d.fileSize,
        textLength: d.charCount,
        wordCount: d.wordCount,
        pageCount: d.pageCount,
        uploadedAt: d.uploadedAt
      }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/documents/:conversationId/:documentId
 * Delete a specific document from a conversation session
 */
documentsRouter.delete('/:conversationId/:documentId', (req, res, next) => {
  try {
    const { conversationId, documentId } = req.params;
    const authUser = req.user;
    const sessionOptions = {
      userId: authUser?.id || null,
      tenantId: authUser?.tenantId || null
    };

    const removed = sessionManager.removeDocument(conversationId, documentId, sessionOptions);
    if (!removed) {
      return res.status(404).json({
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: `Document "${documentId}" not found in session "${conversationId}"`
        }
      });
    }

    res.json({
      success: true,
      conversationId,
      documentId,
      message: 'Document removed from session'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/documents/:conversationId
 * Clear all documents from a conversation session
 */
documentsRouter.delete('/:conversationId', (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const authUser = req.user;
    const sessionOptions = {
      userId: authUser?.id || null,
      tenantId: authUser?.tenantId || null
    };

    const cleared = sessionManager.clearDocuments(conversationId, sessionOptions);
    res.json({
      success: true,
      cleared,
      conversationId,
      message: 'All documents removed from session'
    });
  } catch (err) {
    next(err);
  }
});
