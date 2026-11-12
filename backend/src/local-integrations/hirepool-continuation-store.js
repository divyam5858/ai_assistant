import { createHash, randomBytes } from 'node:crypto';

const continuationsByReferenceDigest = new Map();
const CONTINUATION_TTL_MS = 10 * 60 * 1000;
const MAX_CONTINUATIONS = 1000;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function cleanupExpired(now = Date.now()) {
  for (const [referenceDigest, continuation] of continuationsByReferenceDigest) {
    if (continuation.expiresAt <= now) {
      continuationsByReferenceDigest.delete(referenceDigest);
    }
  }
}

const cleanupTimer = setInterval(cleanupExpired, 30_000);
cleanupTimer.unref?.();

export function createHirePoolContinuation({ conversationId, pendingRequest }, now = Date.now()) {
  cleanupExpired(now);
  if (continuationsByReferenceDigest.size >= MAX_CONTINUATIONS) {
    throw new Error('The local HirePool login continuation capacity has been reached');
  }
  if (
    typeof conversationId !== 'string' ||
    !conversationId.trim() ||
    conversationId.length > 128 ||
    typeof pendingRequest !== 'string' ||
    !pendingRequest.trim() ||
    pendingRequest.length > 10_000
  ) {
    throw new TypeError('A valid conversation and pending request are required');
  }

  const reference = randomBytes(32).toString('base64url');
  continuationsByReferenceDigest.set(digest(reference), {
    conversationId: conversationId.trim(),
    pendingRequest: pendingRequest.trim(),
    expiresAt: now + CONTINUATION_TTL_MS
  });
  return reference;
}

export function getHirePoolContinuation(reference, now = Date.now()) {
  cleanupExpired(now);
  if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(reference)) {
    return null;
  }
  const continuation = continuationsByReferenceDigest.get(digest(reference));
  return continuation
    ? { conversationId: continuation.conversationId, pendingRequest: continuation.pendingRequest }
    : null;
}

export function consumeHirePoolContinuation(reference, now = Date.now()) {
  cleanupExpired(now);
  if (typeof reference !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(reference)) {
    return null;
  }
  const referenceDigest = digest(reference);
  const continuation = continuationsByReferenceDigest.get(referenceDigest);
  if (!continuation) return null;
  continuationsByReferenceDigest.delete(referenceDigest);
  return {
    conversationId: continuation.conversationId,
    pendingRequest: continuation.pendingRequest
  };
}
