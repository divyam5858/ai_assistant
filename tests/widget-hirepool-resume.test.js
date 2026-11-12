import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantApiClient } from '../widget/src/api-client.js';
import { AssistantWidgetUI } from '../widget/src/widget.js';
import {
  formatHirePoolResumeSize,
  HIREPOOL_RESUME_MAX_BYTES,
  HIREPOOL_RESUME_STATES,
  HirePoolResumeUpload,
  validateHirePoolResumeFile
} from '../widget/src/hirepool-resume.js';

const candidate = { id: 'candidate-1', user_type: 'candidate', role: null };
const confirmationToken = 'A'.repeat(43);

function makePdf(name = 'resume.pdf', mimeType = 'application/pdf') {
  const blob = new Blob(['%PDF-1.7\nresume contents']);
  Object.defineProperties(blob, {
    name: { value: name },
    type: { value: mimeType }
  });
  return blob;
}

function createUploader(apiClient, events = []) {
  const upload = new HirePoolResumeUpload(apiClient, event => events.push(event));
  upload.setIdentity(candidate, 'session-1');
  return upload;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.parentNode = null;
    this.disabled = false;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) {
    children.forEach(child => this.appendChild(child));
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
  }
  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }
  get textContent() {
    return `${this._textContent || ''}${this.children.map(child => child.textContent).join('')}`;
  }
}

function findButtons(element) {
  return [
    ...(element.tagName === 'button' ? [element] : []),
    ...element.children.flatMap(findButtons)
  ];
}

test('HirePool resume file selection accepts PDFs and rejects invalid, empty, and oversized files', () => {
  assert.equal(validateHirePoolResumeFile(makePdf()), null);
  assert.equal(validateHirePoolResumeFile(makePdf('resume.pdf', 'application/octet-stream')), null);
  assert.equal(validateHirePoolResumeFile(makePdf('resume.pdf', '')), null);
  assert.match(validateHirePoolResumeFile(makePdf('resume.docx')), /Only PDF/);
  assert.match(validateHirePoolResumeFile({
    name: 'empty.pdf',
    type: 'application/pdf',
    size: 0
  }), /empty/);
  assert.match(validateHirePoolResumeFile({
    name: 'large.pdf',
    type: 'application/pdf',
    size: HIREPOOL_RESUME_MAX_BYTES + 1
  }), /5 MB/);
  assert.equal(formatHirePoolResumeSize(1024 * 1024), '1.00 MB');
});

test('HirePool prepare sends the file and conversation ID through the authenticated route', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'requires_confirmation',
        conversationId: 'conversation-1',
        filename: 'resume.pdf',
        fileSize: 24,
        replacingExisting: true,
        confirmationToken
      })
    };
  };
  try {
    const client = new AssistantApiClient('/sdk', {
      getAuthHeaders: async () => ({ Authorization: 'Bearer test-credential' })
    });
    const file = makePdf();
    const result = await client.prepareHirePoolResume(file, 'conversation-1');
    assert.equal(captured.url, '/sdk/api/hirepool/resume/prepare');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.headers.Authorization, 'Bearer test-credential');
    assert.equal(captured.options.body.get('conversationId'), 'conversation-1');
    assert.equal(captured.options.body.get('file').name, 'resume.pdf');
    assert.equal(result.confirmationToken, confirmationToken);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('confirm and cancel use the verified JSON endpoint contracts', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => url.endsWith('/confirm')
        ? { status: 'success', verified: true, filename: 'resume.pdf', message: 'Uploaded' }
        : { status: 'cancelled' }
    };
  };
  try {
    const client = new AssistantApiClient('/sdk', {
      getAuthHeaders: async () => ({})
    });
    await client.confirmHirePoolResume(confirmationToken, 'conversation-1');
    await client.cancelHirePoolResume(confirmationToken, 'conversation-1');
    assert.deepEqual(requests.map(({ url }) => url), [
      '/sdk/api/hirepool/resume/confirm',
      '/sdk/api/hirepool/resume/cancel'
    ]);
    assert.deepEqual(requests.map(({ options }) => JSON.parse(options.body)), [
      { confirmationToken, conversationId: 'conversation-1' },
      { confirmationToken, conversationId: 'conversation-1' }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('candidate-only workflow prepares, confirms once, and exposes no confirmation token in state', async () => {
  let confirmCalls = 0;
  const stateEvents = [];
  const upload = createUploader({
    prepareHirePoolResume: async (_file, conversationId) => ({
      status: 'requires_confirmation',
      conversationId,
      filename: 'resume.pdf',
      fileSize: 24,
      replacingExisting: true,
      confirmationToken
    }),
    confirmHirePoolResume: async () => {
      confirmCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { status: 'success', verified: true, message: 'Resume was uploaded.' };
    }
  }, stateEvents);
  upload.selectFile(makePdf(), 'conversation-1');
  assert.equal(await upload.prepare('conversation-1'), true);
  assert.equal(upload.state, HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION);
  assert.equal(await Promise.all([upload.confirm(), upload.confirm()]).then(values => values[0]), true);
  assert.equal(confirmCalls, 1);
  assert.equal(upload.state, HIREPOOL_RESUME_STATES.UPLOAD_SUCCESS);
  assert.equal(JSON.stringify(stateEvents).includes(confirmationToken), false);
  assert.equal(JSON.stringify(stateEvents).includes('resume_url'), false);
});

test('invalid PDF signatures never call prepare and duplicate preparation is prevented', async () => {
  let prepareCalls = 0;
  const upload = createUploader({
    prepareHirePoolResume: async () => {
      prepareCalls += 1;
      return {
        status: 'requires_confirmation',
        conversationId: 'conversation-1',
        filename: 'resume.pdf',
        fileSize: 1,
        replacingExisting: false,
        confirmationToken
      };
    }
  });
  const invalidPdf = new Blob(['not a PDF'], { type: 'application/pdf' });
  Object.defineProperty(invalidPdf, 'name', { value: 'not-a-resume.pdf' });
  upload.selectFile(invalidPdf, 'conversation-1');
  assert.equal(await upload.prepare('conversation-1'), false);
  assert.equal(prepareCalls, 0);

  upload.selectFile(makePdf(), 'conversation-1');
  let release;
  upload.apiClient.prepareHirePoolResume = () => new Promise(resolve => {
    prepareCalls += 1;
    release = () => resolve({
      status: 'requires_confirmation',
      conversationId: 'conversation-1',
      filename: 'resume.pdf',
      fileSize: 24,
      replacingExisting: false,
      confirmationToken
    });
  });
  const first = upload.prepare('conversation-1');
  await new Promise(resolve => setImmediate(resolve));
  const second = upload.prepare('conversation-1');
  assert.equal(typeof release, 'function');
  assert.equal(await second, false);
  release();
  await first;
  assert.equal(prepareCalls, 1);
});

test('cancellation is confirmed by the endpoint before the UI enters CANCELLED', async () => {
  let releaseCancel;
  const upload = createUploader({
    prepareHirePoolResume: async (_file, conversationId) => ({
      status: 'requires_confirmation',
      conversationId,
      filename: 'resume.pdf',
      fileSize: 24,
      replacingExisting: false,
      confirmationToken
    }),
    cancelHirePoolResume: () => new Promise(resolve => {
      releaseCancel = resolve;
    })
  });
  upload.selectFile(makePdf(), 'conversation-1');
  await upload.prepare('conversation-1');
  const cancellation = upload.cancel();
  assert.notEqual(upload.state, HIREPOOL_RESUME_STATES.CANCELLED);
  releaseCancel({ status: 'cancelled' });
  assert.equal(await cancellation, true);
  assert.equal(upload.state, HIREPOOL_RESUME_STATES.CANCELLED);
});

test('uploaded-but-unverified responses are distinct and never retried', async () => {
  let confirmCalls = 0;
  const upload = createUploader({
    prepareHirePoolResume: async (_file, conversationId) => ({
      status: 'requires_confirmation',
      conversationId,
      filename: 'resume.pdf',
      fileSize: 24,
      replacingExisting: false,
      confirmationToken
    }),
    confirmHirePoolResume: async () => {
      confirmCalls += 1;
      const error = new Error('Check your HirePool profile before preparing another upload.');
      error.responseStatus = 'uploaded_unverified';
      throw error;
    }
  });
  upload.selectFile(makePdf(), 'conversation-1');
  await upload.prepare('conversation-1');
  assert.equal(await upload.confirm(), false);
  assert.equal(upload.state, HIREPOOL_RESUME_STATES.UPLOAD_UNVERIFIED);
  assert.equal(await upload.confirm(), false);
  assert.equal(confirmCalls, 1);
});

test('confirmation, verified success, and unverified outcomes render safe chat UI', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const ui = Object.create(AssistantWidgetUI.prototype);
    ui.options = { assistantId: 'hirepool', applicationId: 'hirepool-local-app' };
    ui.apiClient = { prepareHirePoolResume() {} };
    ui.attachBtn = new FakeElement('button');
    ui.messagesList = new FakeElement('div');
    ui.body = { scrollHeight: 0 };
    ui.activeConversationId = 'conversation-1';
    ui._scrollToBottom = () => {};
    ui._persistState = () => {};

    ui._renderHirePoolResumeState({
      state: HIREPOOL_RESUME_STATES.AWAITING_CONFIRMATION,
      filename: 'resume.pdf',
      fileSize: 1024,
      replacingExisting: true,
      conversationId: 'conversation-1'
    });
    assert.match(ui.hirePoolResumeCard.textContent, /resume\.pdf/);
    assert.match(ui.hirePoolResumeCard.textContent, /replace the resume currently stored/);
    assert.deepEqual(findButtons(ui.hirePoolResumeCard).map(button => button.textContent), [
      'Confirm upload',
      'Cancel'
    ]);

    ui._renderHirePoolResumeState({ state: HIREPOOL_RESUME_STATES.UPLOAD_SUCCESS });
    assert.match(ui.hirePoolResumeCard.textContent, /uploaded and verified/);
    ui._renderHirePoolResumeState({ state: HIREPOOL_RESUME_STATES.UPLOAD_UNVERIFIED });
    assert.match(ui.hirePoolResumeCard.textContent, /Check your HirePool profile/);
    assert.equal(ui.hirePoolResumeCard.textContent.includes(confirmationToken), false);
    assert.equal(ui.hirePoolResumeCard.textContent.includes('resume_url'), false);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('logout, role change, account change, and session-scope change clear pending confirmations', async () => {
  const upload = createUploader({
    prepareHirePoolResume: async (_file, conversationId) => ({
      status: 'requires_confirmation',
      conversationId,
      filename: 'resume.pdf',
      fileSize: 24,
      replacingExisting: false,
      confirmationToken
    })
  });
  upload.selectFile(makePdf(), 'conversation-1');
  await upload.prepare('conversation-1');
  upload.setIdentity({ id: 'client-2', user_type: 'client', role: null }, 'session-2');
  assert.equal(upload.state, HIREPOOL_RESUME_STATES.IDLE);
  assert.equal(upload.pending, null);
  assert.throws(() => upload.selectFile(makePdf(), 'conversation-1'), /Sign in/);
  upload.setIdentity(candidate, 'session-3');
  assert.equal(upload.state, HIREPOOL_RESUME_STATES.IDLE);
  upload.setIdentity(null, null);
  assert.equal(upload.identityKey, null);
});

test('401 expiry and backend errors are surfaced without treating them as success', async () => {
  const upload = createUploader({
    prepareHirePoolResume: async () => {
      const error = new Error('Your HirePool session expired. Sign in again.');
      error.status = 401;
      throw error;
    }
  });
  upload.selectFile(makePdf(), null);
  assert.equal(await upload.prepare(null), false);
  assert.equal(upload.state, HIREPOOL_RESUME_STATES.UPLOAD_FAILED);
  assert.match(upload.errorMessage, /session expired/i);
});
