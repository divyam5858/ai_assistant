import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import request from 'supertest';
import {
  clearDynamicApiIntegrations,
  createRequestActionRegistry,
  executeDynamicApiRead
} from '../backend/src/dynamic-api/catalog.js';
import { createHirePoolResumeRouter, cleanupExpiredHirePoolResumeUploads } from '../backend/src/routes/hirepool-resume.js';
import { hirePoolAuthRouter } from '../backend/src/local-integrations/hirepool-auth.js';
import { registerHirePoolLocalDevelopmentIntegration } from '../integrations/hirepool/local-development.js';
import {
  findHirePoolContextBySdkCredential,
  storeHirePoolSession
} from '../backend/src/local-integrations/hirepool-session-store.js';
import { ActionRegistry } from '../backend/src/actions/registry.js';

const ENV_KEYS = [
  'NODE_ENV',
  'VERCEL_ENV',
  'AUTH_MODE',
  'AUTH_REQUIRED',
  'JWT_SECRET',
  'DYNAMIC_API_DISCOVERY_ENABLED',
  'API_DISCOVERY_ALLOWED_HOSTS',
  'ENABLE_HIREPOOL_LOCAL_BRIDGE',
  'HIREPOOL_LOCAL_API_BASE_URL',
  'HIREPOOL_LOCAL_OPENAPI_URL',
  'HIREPOOL_LOCAL_ALLOWED_ORIGINS'
];
const originalEnv = new Map(ENV_KEYS.map(key => [key, process.env[key]]));

function configureLocalIntegration() {
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.AUTH_MODE = 'jwt';
  process.env.AUTH_REQUIRED = 'true';
  process.env.JWT_SECRET = 'test-only-hirepool-resume-secret';
  process.env.DYNAMIC_API_DISCOVERY_ENABLED = 'true';
  process.env.API_DISCOVERY_ALLOWED_HOSTS = 'localhost';
  process.env.ENABLE_HIREPOOL_LOCAL_BRIDGE = 'true';
  process.env.HIREPOOL_LOCAL_API_BASE_URL = 'http://localhost:8000/';
  process.env.HIREPOOL_LOCAL_OPENAPI_URL = 'http://localhost:8000/api/openapi.json';
  process.env.HIREPOOL_LOCAL_ALLOWED_ORIGINS = 'http://localhost:3001';
}

function createCandidate(userId, role = 'candidate') {
  const session = storeHirePoolSession(`host-access-${userId}-${Date.now()}-${Math.random()}`, {
    id: userId,
    email: `${userId}@example.test`,
    userType: role
  });
  return session;
}

function createApp(requestHandler, { now } = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/hirepool', hirePoolAuthRouter);
  app.use('/api/hirepool/resume', createHirePoolResumeRouter({ request: requestHandler, now }));
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      error: { code: error.code || 'ERROR', message: error.message }
    });
  });
  return app;
}

function makeRequestHandler({
  profile = { id: 'profile-id', resume_url: null },
  afterUploadProfile = { id: 'profile-id', resume_url: 'https://storage.example.test/resumes/new.pdf?signature=hidden' },
  beforeUpload,
  onUpload
} = {}) {
  const calls = [];
  let uploaded = false;
  const handler = async (url, options) => {
    calls.push({ url: String(url), ...options });
    if (options.method === 'GET') {
      if (beforeUpload) await beforeUpload({ url: String(url), options, calls });
      return uploaded ? afterUploadProfile : profile;
    }
    if (options.method === 'POST') {
      onUpload?.({ url: String(url), ...options, calls });
      uploaded = true;
      return {
        message: 'Resume uploaded successfully',
        resume_url: 'https://storage.example.test/resumes/accepted.pdf?signature=private'
      };
    }
    throw new Error(`Unexpected request method ${options.method}`);
  };
  handler.calls = calls;
  return handler;
}

function prepare(app, credential, conversationId = `resume-${Date.now()}-${Math.random()}`) {
  return request(app)
    .post('/api/hirepool/resume/prepare')
    .set('Authorization', `Bearer ${credential}`)
    .attach('file', Buffer.from('%PDF-1.7\nresume text'), 'resume.pdf')
    .field('conversationId', conversationId);
}

afterEach(() => {
  clearDynamicApiIntegrations();
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('resume routes require an authenticated candidate principal', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const app = createApp(async () => ({ id: 'profile-id', resume_url: null }));

  await request(app)
    .post('/api/hirepool/resume/prepare')
    .attach('file', Buffer.from('%PDF-1.7\nresume'), 'resume.pdf')
    .expect(401);

  const client = createCandidate('resume-client', 'client');
  await prepare(app, client.credential).expect(403);
});

test('resume preparation rejects invalid and oversized PDFs', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-validation-candidate');
  const app = createApp(async () => ({ id: 'profile-id', resume_url: null }));

  const invalid = await request(app)
    .post('/api/hirepool/resume/prepare')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .attach('file', Buffer.from('not a PDF'), 'resume.pdf')
    .expect(400);
  assert.equal(invalid.body.error.code, 'INVALID_PDF');

  const oversized = await request(app)
    .post('/api/hirepool/resume/prepare')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .attach('file', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024)]), 'large.pdf')
    .expect(413);
  assert.equal(oversized.body.error.code, 'FILE_TOO_LARGE');
});

test('server-side profile reads use the authenticated self-profile API without exposing signed resume data', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-projection-candidate');
  const fixture = await readFile(new URL('./fixtures/hirepool-openapi.json', import.meta.url), 'utf8');
  const principal = {
    id: 'resume-projection-candidate',
    role: 'candidate',
    assistantId: 'hirepool',
    applicationId: 'hirepool-local-app',
    integrationSessionId: findHirePoolContextBySdkCredential(candidate.credential).sessionId
  };
  const registry = await createRequestActionRegistry(
    'hirepool',
    principal,
    new ActionRegistry({ actions: [] }),
    { fetchSpec: async () => fixture }
  );
  const action = registry.list().find(item =>
    item.metadata?.dynamicApi?.operationId === 'get_my_profile_api_v1_candidates_profile_get'
  );
  assert.ok(action);
  assert.equal(action.metadata.dynamicApi.responseFields.includes('resume_url'), false);
  assert.equal(action.metadata.dynamicApi.responseFields.includes('resume_parsed_data'), false);

  const projected = await executeDynamicApiRead(action, {}, principal, {
    request: async () => ({
      id: 'profile-id',
      first_name: 'Candidate',
      resume_url: 'https://storage.example.test/private.pdf?signature=secret',
      resume_parsed_data: { email: 'private@example.test' }
    })
  });
  assert.equal(projected.first_name, 'Candidate');
  assert.equal(Object.hasOwn(projected, 'resume_url'), false);
  assert.equal(Object.hasOwn(projected, 'resume_parsed_data'), false);
});

test('resume upload confirmation is one-time, authenticated, and verifies the updated profile', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-confirm-candidate');
  const handler = makeRequestHandler({
    profile: {
      id: 'profile-id',
      resume_url: 'https://storage.example.test/resumes/old.pdf?signature=rotates'
    }
  });
  const app = createApp(handler);
  const prepared = await prepare(app, candidate.credential).expect(200);
  assert.equal(prepared.body.status, 'requires_confirmation');
  assert.equal(prepared.body.replacingExisting, true);
  assert.equal(prepared.body.filename, 'resume.pdf');
  assert.doesNotMatch(JSON.stringify(prepared.body), /signature|storage\.example/);
  const profileRead = handler.calls.find(call => call.method === 'GET');
  assert.equal(profileRead.url, 'http://localhost:8000/api/v1/candidates/profile');
  assert.match(profileRead.headers.Authorization, /^Bearer /);

  const confirmed = await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(200);
  assert.equal(confirmed.body.status, 'success');
  assert.equal(confirmed.body.verified, true);
  assert.equal(Object.hasOwn(confirmed.body, 'resume_url'), false);
  assert.equal(handler.calls.filter(call => call.method === 'POST').length, 1);
  const upload = handler.calls.find(call => call.method === 'POST');
  assert.equal(upload.url, 'http://localhost:8000/api/v1/candidates/profile/resume');
  assert.equal(upload.rawBody, true);
  assert.match(upload.contentType, /^multipart\/form-data; boundary=/);
  assert.ok(upload.body.includes(Buffer.from('name="file"')));
  assert.ok(upload.body.includes(Buffer.from('%PDF-1.7')));

  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(410);
});

test('expired and cancelled confirmations are invalidated', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-expiry-candidate');
  let clock = 1_000;
  const app = createApp(async () => ({ id: 'profile-id', resume_url: null }), { now: () => clock });

  const expired = await prepare(app, candidate.credential).expect(200);
  clock += 2 * 60 * 1000 + 1;
  cleanupExpiredHirePoolResumeUploads(clock);
  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: expired.body.conversationId,
      confirmationToken: expired.body.confirmationToken
    })
    .expect(410);

  const cancelled = await prepare(
    app,
    candidate.credential,
    `cancel-${Date.now()}-${Math.random()}`
  ).expect(200);
  await request(app)
    .post('/api/hirepool/resume/cancel')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: cancelled.body.conversationId,
      confirmationToken: cancelled.body.confirmationToken
    })
    .expect(200);
  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: cancelled.body.conversationId,
      confirmationToken: cancelled.body.confirmationToken
    })
    .expect(410);
});

test('confirmation is bound to the candidate session and conversation', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const first = createCandidate('resume-owner-candidate');
  const second = createCandidate('resume-other-candidate');
  const handler = makeRequestHandler();
  const app = createApp(handler);
  const prepared = await prepare(app, first.credential, 'owner-conversation').expect(200);

  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${second.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(403);
  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${first.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(410);

  const secondPrepared = await prepare(app, first.credential, `conversation-${Date.now()}-${Math.random()}`)
    .expect(200);
  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${first.credential}`)
    .send({
      conversationId: 'different-conversation',
      confirmationToken: secondPrepared.body.confirmationToken
    })
    .expect(403);
  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${first.credential}`)
    .send({
      conversationId: secondPrepared.body.conversationId,
      confirmationToken: secondPrepared.body.confirmationToken
    })
    .expect(410);
  assert.equal(handler.calls.filter(call => call.method === 'POST').length, 0);
});

test('logout invalidates pending resume confirmations', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-logout-candidate');
  const second = createCandidate('resume-after-logout-candidate');
  const app = createApp(async () => ({ id: 'profile-id', resume_url: null }));
  const prepared = await prepare(app, candidate.credential).expect(200);

  await request(app)
    .post('/api/hirepool/session/revoke')
    .set('Origin', 'http://localhost:3001')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .expect(204);

  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${second.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(410);
});

test('readback failure and ambiguous upload failures are reported as unverified, without retrying', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-readback-candidate');
  let uploadAccepted = false;
  let postCount = 0;
  const app = createApp(async (_url, options) => {
    if (options.method === 'GET') {
      return {
        id: 'profile-id',
        resume_url: uploadAccepted
          ? 'https://storage.example.test/resumes/new.pdf?signature=new'
          : null
      };
    }
    postCount++;
    uploadAccepted = true;
    return { message: 'Resume uploaded successfully', resume_url: 'https://storage.example.test/resumes/new.pdf?signature=private' };
  });
  const prepared = await prepare(app, candidate.credential).expect(200);
  const result = await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(200);
  assert.equal(result.body.status, 'success');
  assert.equal(postCount, 1);

  const readbackApp = createApp(async (_url, options) => {
    if (options.method === 'GET') {
      if (postCount > 1) throw new Error('simulated readback failure');
      return { id: 'profile-id', resume_url: null };
    }
    postCount++;
    return { message: 'Resume uploaded successfully', resume_url: 'https://storage.example.test/resumes/accepted.pdf?signature=private' };
  });
  const next = await prepare(readbackApp, candidate.credential, 'readback-failure-conversation').expect(200);
  const unverified = await request(readbackApp)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: next.body.conversationId,
      confirmationToken: next.body.confirmationToken
    })
    .expect(502);
  assert.equal(unverified.body.status, 'uploaded_unverified');
  assert.equal(unverified.body.error.code, 'RESUME_READBACK_FAILED');
  assert.doesNotMatch(JSON.stringify(unverified.body), /signature|storage\.example/);
  assert.equal(postCount, 2);
});

test('a rejected upload does not issue deletion or discard the prior server-side resume reference', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-rejected-candidate');
  const priorResume = 'https://storage.example.test/resumes/existing.pdf?signature=rotates';
  const calls = [];
  const app = createApp(async (url, options) => {
    calls.push({ url: String(url), ...options });
    if (options.method === 'GET') return { id: 'profile-id', resume_url: priorResume };
    const error = new Error('Rejected by HirePool');
    error.statusCode = 400;
    throw error;
  });
  const prepared = await prepare(app, candidate.credential).expect(200);
  const response = await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(400);

  assert.equal(response.body.error.code, 'RESUME_UPLOAD_FAILED');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'POST']);
  assert.equal(calls.some(call => call.method === 'DELETE'), false);
  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(410);
});

test('ambiguous upload transport failure is reported as unverified and is never retried', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-ambiguous-candidate');
  let postCount = 0;
  const app = createApp(async (_url, options) => {
    if (options.method === 'GET') return { id: 'profile-id', resume_url: null };
    postCount++;
    throw new Error('simulated timeout after request dispatch');
  });
  const prepared = await prepare(app, candidate.credential).expect(200);
  const response = await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(502);

  assert.equal(response.body.status, 'uploaded_unverified');
  assert.equal(response.body.error.code, 'UPLOAD_OUTCOME_UNVERIFIED');
  assert.equal(postCount, 1);
  assert.doesNotMatch(JSON.stringify(response.body), /signature|storage\.example/);
  await request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    })
    .expect(410);
  assert.equal(postCount, 1);
});

test('expired cleanup does not zero or delete an executing upload', async () => {
  configureLocalIntegration();
  registerHirePoolLocalDevelopmentIntegration();
  const candidate = createCandidate('resume-cleanup-candidate');
  let clock = 10_000;
  let releaseProfileRead;
  let profileReadStarted;
  const started = new Promise(resolve => { profileReadStarted = resolve; });
  const delayedProfile = new Promise(resolve => { releaseProfileRead = resolve; });
  let profileReads = 0;
  let uploaded = false;
  const app = createApp(async (_url, options) => {
    if (options.method === 'GET') {
      profileReads++;
      if (profileReads === 1) return { id: 'profile-id', resume_url: null };
      if (profileReads === 2) {
        profileReadStarted();
        return delayedProfile;
      }
      return { id: 'profile-id', resume_url: uploaded ? 'https://storage.example.test/resumes/final.pdf?sig=x' : null };
    }
    uploaded = true;
    return { message: 'Resume uploaded successfully', resume_url: 'https://storage.example.test/resumes/final.pdf?sig=private' };
  }, { now: () => clock });
  const prepared = await prepare(
    app,
    candidate.credential,
    `cleanup-${Date.now()}-${Math.random()}`
  ).expect(200);
  const confirmation = request(app)
    .post('/api/hirepool/resume/confirm')
    .set('Authorization', `Bearer ${candidate.credential}`)
    .send({
      conversationId: prepared.body.conversationId,
      confirmationToken: prepared.body.confirmationToken
    });
  const confirmationPromise = confirmation.then(response => response);
  await started;
  clock += 10 * 60 * 1000;
  cleanupExpiredHirePoolResumeUploads(clock);
  releaseProfileRead({ id: 'profile-id', resume_url: null });
  const response = await confirmationPromise;
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'success');
});
