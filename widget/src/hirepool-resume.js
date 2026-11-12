export const HIREPOOL_RESUME_MAX_BYTES = 5 * 1024 * 1024;

export const HIREPOOL_RESUME_STATES = Object.freeze({
  IDLE: 'IDLE',
  FILE_SELECTED: 'FILE_SELECTED',
  PREPARING: 'PREPARING',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  UPLOADING: 'UPLOADING',
  UPLOAD_SUCCESS: 'UPLOAD_SUCCESS',
  UPLOAD_UNVERIFIED: 'UPLOAD_UNVERIFIED',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  CANCELLED: 'CANCELLED'
});

export function validateHirePoolResumeFile(file) {
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size)) {
    return 'Select a PDF resume to continue.';
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return 'Only PDF resumes are supported.';
  }
  const mimeType = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  const allowedMimeTypes = new Set([
    '',
    'application/pdf',
    'application/octet-stream',
    'application/x-pdf',
    'binary/octet-stream'
  ]);
  if (mimeType && !allowedMimeTypes.has(mimeType)) {
    return 'Only PDF resumes are supported.';
  }
  if (file.size < 1) return 'The selected PDF is empty.';
  if (file.size > HIREPOOL_RESUME_MAX_BYTES) return 'Resume PDFs must be 5 MB or smaller.';
  return null;
}

export function formatHirePoolResumeSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isCandidateIdentity(identity) {
  return identity?.user_type === 'candidate';
}

export class HirePoolResumeUpload {
  constructor(apiClient, onStateChange = () => {}) {
    this.apiClient = apiClient;
    this.onStateChange = onStateChange;
    this.state = HIREPOOL_RESUME_STATES.IDLE;
    this.file = null;
    this.pending = null;
    this.conversationId = null;
    this.identityKey = null;
    this.operation = null;
    this.errorMessage = null;
    this.generation = 0;
  }

  _emit(state, details = {}) {
    this.state = state;
    this.onStateChange({
      state,
      filename: this.pending?.filename || this.file?.name || null,
      fileSize: this.pending?.fileSize ?? this.file?.size ?? null,
      replacingExisting: this.pending?.replacingExisting ?? null,
      conversationId: this.conversationId,
      message: details.message || null,
      error: this.errorMessage
    });
  }

  setIdentity(identity, sessionScope = null) {
    const identityKey = isCandidateIdentity(identity) && identity.id != null
      ? `${identity.id}:${identity.user_type}:${identity.role || ''}:${sessionScope || ''}`
      : null;
    if (identityKey === this.identityKey) return false;
    this.generation += 1;
    this.identityKey = identityKey;
    this.file = null;
    this.pending = null;
    this.conversationId = null;
    this.operation = null;
    this.errorMessage = null;
    this._emit(HIREPOOL_RESUME_STATES.IDLE);
    return true;
  }

  selectFile(file, conversationId) {
    if (!this.identityKey) throw new Error('Sign in to a verified HirePool candidate account to upload a resume.');
    if (this.operation || this.state === HIREPOOL_RESUME_STATES.UPLOADING ||
        this.state === HIREPOOL_RESUME_STATES.PREPARING) {
      throw new Error('Wait for the current resume operation to finish.');
    }
    if (this.pending) throw new Error('Confirm or cancel the prepared resume before selecting another file.');
    const validationError = validateHirePoolResumeFile(file);
    if (validationError) throw new Error(validationError);
    this.file = file;
    this.conversationId = conversationId;
    this.errorMessage = null;
    this._emit(HIREPOOL_RESUME_STATES.FILE_SELECTED);
  }

  removeFile() {
    if (this.state !== HIREPOOL_RESUME_STATES.FILE_SELECTED) return false;
    this.file = null;
    this.conversationId = null;
    this._emit(HIREPOOL_RESUME_STATES.IDLE);
    return true;
  }

  reset() {
    this.generation += 1;
    this.file = null;
    this.pending = null;
    this.conversationId = null;
    this.operation = null;
    this.errorMessage = null;
    this._emit(HIREPOOL_RESUME_STATES.IDLE);
  }

  async prepare(conversationId) {
    if (this.state !== HIREPOOL_RESUME_STATES.FILE_SELECTED || !this.file) return false;
    if (this.operation) return this.operation;
    const file = this.file;
    const requestGeneration = this.generation;
    this.conversationId = conversationId || null;
    this.errorMessage = null;
    this._emit(HIREPOOL_RESUME_STATES.PREPARING);
    const operation = (async () => {
      try {
        if (typeof file.slice !== 'function') {
          throw new Error('The selected file could not be validated as a PDF.');
        }
        const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        if (new TextDecoder().decode(signature) !== '%PDF-') {
          throw new Error('The selected file is not a valid PDF.');
        }
        const result = await this.apiClient.prepareHirePoolResume(file, conversationId);
        if (requestGeneration !== this.generation) return false;
        if (result?.status !== 'requires_confirmation' ||
            typeof result.confirmationToken !== 'string' ||
            !/^[A-Za-z0-9_-]{43}$/.test(result.confirmationToken) ||
            typeof result.conversationId !== 'string' ||
            (conversationId && result.conversationId !== conversationId) ||
            typeof result.filename !== 'string' ||
            !Number.isInteger(result.fileSize) ||
            typeof result.replacingExisting !== 'boolean') {
          throw new Error('HirePool returned an unexpected resume preparation response. Select the PDF and try again.');
        }
        this.conversationId = result.conversationId;
        this.pending = {
          confirmationToken: result.confirmationToken,
          conversationId: result.conversationId,
          filename: result.filename,
          fileSize: result.fileSize,
          replacingExisting: result.replacingExisting
        };
        this.file = null;
        this.errorMessage = null;
        this._emit(HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION);
        return true;
      } catch (error) {
        if (requestGeneration !== this.generation) return false;
        this.errorMessage = error.message || 'HirePool could not prepare the resume upload.';
        this._emit(HIREPOOL_RESUME_STATES.UPLOAD_FAILED);
        return false;
      } finally {
        if (this.operation === operation) this.operation = null;
      }
    })();
    this.operation = operation;
    return operation;
  }

  async confirm() {
    if (this.operation) return this.operation;
    if (this.state !== HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION || !this.pending) return false;
    const pending = this.pending;
    const requestGeneration = this.generation;
    this._emit(HIREPOOL_RESUME_STATES.UPLOADING);
    const operation = (async () => {
      try {
        const result = await this.apiClient.confirmHirePoolResume(
          pending.confirmationToken,
          pending.conversationId
        );
        if (requestGeneration !== this.generation) return false;
        if (result?.status === 'success' && result.verified === true &&
            typeof result.message === 'string') {
          this.pending = null;
          this.errorMessage = null;
          this._emit(HIREPOOL_RESUME_STATES.UPLOAD_SUCCESS);
          return true;
        }
        throw new Error('HirePool returned an unexpected resume upload response.');
      } catch (error) {
        if (requestGeneration !== this.generation) return false;
        this.pending = null;
        this.errorMessage = error.message || 'HirePool could not confirm the resume upload.';
        if (error.responseStatus === 'uploaded_unverified') {
          this._emit(HIREPOOL_RESUME_STATES.UPLOAD_UNVERIFIED);
        } else {
          this._emit(HIREPOOL_RESUME_STATES.UPLOAD_FAILED);
        }
        return false;
      } finally {
        if (this.operation === operation) this.operation = null;
      }
    })();
    this.operation = operation;
    return operation;
  }

  async cancel() {
    if (this.operation) return this.operation;
    if (this.state !== HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION || !this.pending) return false;
    const pending = this.pending;
    const requestGeneration = this.generation;
    this._emit(HIREPOOL_RESUME_STATES.UPLOADING, { message: 'Cancelling the prepared upload...' });
    const operation = (async () => {
      try {
        const result = await this.apiClient.cancelHirePoolResume(
          pending.confirmationToken,
          pending.conversationId
        );
        if (requestGeneration !== this.generation) return false;
        if (result?.status !== 'cancelled') {
          throw new Error('HirePool did not confirm cancellation of the prepared resume.');
        }
        this.pending = null;
        this.file = null;
        this.conversationId = null;
        this.errorMessage = null;
        this._emit(HIREPOOL_RESUME_STATES.CANCELLED);
        return true;
      } catch (error) {
        if (requestGeneration !== this.generation) return false;
        this.errorMessage = error.message || 'The prepared resume could not be cancelled.';
        this._emit(HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION);
        return false;
      } finally {
        if (this.operation === operation) this.operation = null;
      }
    })();
    this.operation = operation;
    return operation;
  }
}
