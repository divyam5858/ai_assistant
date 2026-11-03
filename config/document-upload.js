export const DOCUMENT_PROCESSING_CONSENT_VERSION = '1';

const SUPPORTED_EXTENSIONS = Object.freeze([
  '.pdf',
  '.docx',
  '.txt',
  '.text',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.log'
]);

export const DEFAULT_DOCUMENT_UPLOAD_SETTINGS = Object.freeze({
  enabled: true,
  maxSizeBytes: 10 * 1024 * 1024,
  allowedExtensions: SUPPORTED_EXTENSIONS,
  consent: Object.freeze({
    title: 'Before processing this document',
    description: 'If you continue, the SDK sends this file to the assistant backend for text extraction. Extracted text is held temporarily with this conversation and may be sent to the configured AI provider when you ask questions.',
    checkboxLabel: 'I agree to process this document for this conversation.',
    hostDescription: 'If you continue, this file is passed to the host application’s registered file handler. The host may process or transmit it under its own privacy terms. The SDK document backend is not used in this flow.',
    hostCheckboxLabel: 'I agree to let the host application process this document.'
  })
});

export function normalizeDocumentUploadSettings(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('documentUpload settings must be an object');
  }

  const maxSizeBytes = settings.maxSizeBytes ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.maxSizeBytes;
  if (!Number.isInteger(maxSizeBytes) || maxSizeBytes < 1 || maxSizeBytes > 10 * 1024 * 1024) {
    throw new RangeError('documentUpload.maxSizeBytes must be an integer between 1 and 10485760');
  }

  const allowedExtensions = settings.allowedExtensions ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.allowedExtensions;
  if (!Array.isArray(allowedExtensions) || allowedExtensions.length === 0 ||
      allowedExtensions.some(extension => !SUPPORTED_EXTENSIONS.includes(extension))) {
    throw new TypeError(`documentUpload.allowedExtensions must contain supported extensions: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  const consent = settings.consent ?? {};
  if (!consent || typeof consent !== 'object' || Array.isArray(consent)) {
    throw new TypeError('documentUpload.consent must be an object');
  }

  const defaults = DEFAULT_DOCUMENT_UPLOAD_SETTINGS.consent;
  const normalizedConsent = {};
  for (const key of Object.keys(defaults)) {
    const value = consent[key] ?? defaults[key];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1000) {
      throw new TypeError(`documentUpload.consent.${key} must be a non-empty string of at most 1000 characters`);
    }
    normalizedConsent[key] = value.trim();
  }

  const enabled = settings.enabled ?? DEFAULT_DOCUMENT_UPLOAD_SETTINGS.enabled;
  if (typeof enabled !== 'boolean') {
    throw new TypeError('documentUpload.enabled must be a boolean');
  }

  return {
    enabled,
    maxSizeBytes,
    allowedExtensions: [...new Set(allowedExtensions)],
    consent: normalizedConsent
  };
}
