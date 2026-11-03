import { createRequire } from 'module';
import mammoth from 'mammoth';

const require = createRequire(import.meta.url);

let pdfParsePromise;

function getPDFParse() {
  if (!pdfParsePromise) {
    pdfParsePromise = (async () => {
      // Load the PDF runtime only for PDF uploads so other API routes remain available if it is mispackaged.
      require('@napi-rs/canvas');
      const { PDFParse } = require('pdf-parse');
      const { getData: getPdfWorkerData } = await import('pdf-parse/worker');
      PDFParse.setWorker(getPdfWorkerData());
      return PDFParse;
    })().catch((error) => {
      pdfParsePromise = null;
      console.error('[Document Parser] PDF parser initialization failed:', error);
      throw new DocumentProcessingError(
        'PDF document processing is temporarily unavailable.',
        503,
        'PDF_PROCESSOR_UNAVAILABLE'
      );
    });
  }

  return pdfParsePromise;
}

function isMissingPdfWorkerError(error) {
  return error?.code === 'ERR_MODULE_NOT_FOUND' && /pdf\.worker\.mjs/i.test(error.message || '');
}

export class DocumentProcessingError extends Error {
  constructor(message, statusCode = 400, code = 'DOCUMENT_PROCESSING_ERROR') {
    super(message);
    this.name = 'DocumentProcessingError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class UnsupportedDocumentError extends DocumentProcessingError {
  constructor(message = 'Unsupported document format. Allowed formats: PDF, DOCX, TXT') {
    super(message, 400, 'UNSUPPORTED_DOCUMENT_FORMAT');
    this.name = 'UnsupportedDocumentError';
  }
}

export class EmptyDocumentError extends DocumentProcessingError {
  constructor(message = 'Document is empty or contains no readable text') {
    super(message, 400, 'EMPTY_DOCUMENT');
    this.name = 'EmptyDocumentError';
  }
}

export class CorruptDocumentError extends DocumentProcessingError {
  constructor(message = 'Failed to parse document: file appears corrupt or unreadable') {
    super(message, 422, 'CORRUPT_DOCUMENT');
    this.name = 'CorruptDocumentError';
  }
}

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_EXTRACTED_CHARS = 100000; // ~25,000 tokens

/**
 * Detect format from filename, mimetype, and magic bytes
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} [mimetype]
 * @returns {'pdf' | 'docx' | 'txt'}
 */
export function detectDocumentFormat(buffer, filename = '', mimetype = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  // 1. PDF detection: magic bytes %PDF- (0x25 0x50 0x44 0x46 0x2d) or extension/mime
  if (
    (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) ||
    ext === 'pdf' ||
    mimetype === 'application/pdf'
  ) {
    return 'pdf';
  }

  // 2. DOCX is supported by mammoth; legacy binary .doc files are not.
  if (
    ext === 'docx' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }

  // 3. Plain text detection: .txt, .text, .md, .csv or text/* mimetype
  if (
    ['txt', 'text', 'md', 'markdown', 'csv', 'json', 'log'].includes(ext) ||
    (mimetype && mimetype.startsWith('text/'))
  ) {
    return 'txt';
  }

  throw new UnsupportedDocumentError(`File "${filename || 'unknown'}" has unsupported format. Supported formats: PDF, DOCX, and text-based files`);
}

/**
 * Clean and normalize extracted document text
 * @param {string} text
 * @returns {string}
 */
export function cleanExtractedText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    // Replace null bytes and non-printable control characters except \r, \n, \t
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize Windows/Mac line breaks to \n
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive empty lines (more than 2 consecutive newlines)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Safely parse a document buffer into structured plain text and metadata.
 *
 * @param {Buffer|Uint8Array} buffer Document binary data
 * @param {string} filename Original filename
 * @param {string} [mimetype] MIME type if provided by client/multer
 * @param {object} [options]
 * @param {number} [options.maxSize=10485760] Max size in bytes
 * @param {number} [options.maxChars=100000] Max characters to extract
 * @returns {Promise<{ text: string, charCount: number, wordCount: number, pageCount?: number, format: 'pdf'|'docx'|'txt', filename: string, fileSize: number }>}
 */
export async function parseDocument(buffer, filename = 'document', mimetype = '', options = {}) {
  const maxSize = options.maxSize || MAX_DOCUMENT_SIZE_BYTES;
  const maxChars = options.maxChars || MAX_EXTRACTED_CHARS;

  if (!buffer || buffer.length === 0) {
    throw new EmptyDocumentError(`Document "${filename}" is empty (0 bytes)`);
  }

  if (buffer.length > maxSize) {
    throw new DocumentProcessingError(
      `File "${filename}" (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds the maximum allowed size of ${(maxSize / (1024 * 1024)).toFixed(0)} MB`,
      400,
      'DOCUMENT_TOO_LARGE'
    );
  }

  const format = detectDocumentFormat(buffer, filename, mimetype);
  let rawText = '';
  let pageCount;

  try {
    if (format === 'pdf') {
      const PDFParse = await getPDFParse();
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        rawText = result.text || '';
        pageCount = result.total || 1;
      } finally {
        await parser.destroy();
      }
    } else if (format === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value || '';
    } else if (format === 'txt') {
      rawText = buffer.toString('utf-8');
    }
  } catch (err) {
    if (err instanceof DocumentProcessingError) {
      throw err;
    }
    if (format === 'pdf' && isMissingPdfWorkerError(err)) {
      console.error('[Document Parser] PDF worker asset could not be resolved:', err);
      throw new DocumentProcessingError(
        'PDF document processing is temporarily unavailable.',
        503,
        'PDF_PROCESSOR_UNAVAILABLE'
      );
    }
    throw new CorruptDocumentError(`Could not parse ${format.toUpperCase()} document "${filename}": ${err.message}`);
  }

  const cleanedText = cleanExtractedText(rawText);

  if (!cleanedText || cleanedText.length === 0) {
    throw new EmptyDocumentError(`Document "${filename}" contains no readable text`);
  }

  // Handle truncation if document text exceeds maxChars
  let finalText = cleanedText;
  let truncated = false;
  if (finalText.length > maxChars) {
    finalText = finalText.slice(0, maxChars) + '\n\n[... Remaining document text truncated due to length limits ...]';
    truncated = true;
  }

  const words = finalText.split(/\s+/).filter(Boolean);

  return {
    filename,
    fileSize: buffer.length,
    format,
    text: finalText,
    charCount: finalText.length,
    wordCount: words.length,
    pageCount,
    truncated
  };
}
