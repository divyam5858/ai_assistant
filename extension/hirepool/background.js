import { isHirePoolLocalPublicSiteUrl } from './site-policy.js';

const API_ORIGIN = 'http://localhost:8000';
const SDK_ORIGIN = 'http://localhost:3100';
const AUTH_ORIGIN = 'http://localhost:5173';
const LOGIN_URL = `${AUTH_ORIGIN}/login`;
const PENDING_PREFIX = 'pending-site:';
const ACTIVE_PREFIX = 'active-site:';
const MAX_PENDING_LOGINS = 10;
const PENDING_TTL_MS = 10 * 60 * 1000;
const IDENTITY_PATHS = new Set([
  '/api/v1/auth/me',
  '/api/v1/candidates/profile',
  '/api/v1/clients/profile',
  '/api/v1/clients/me',
  '/api/v1/consultancies/profile',
  '/api/v1/consultancies/me'
]);

function isValidSenderSite(sender) {
  return sender.frameId === 0 &&
    Number.isInteger(sender.tab?.id) &&
    isHirePoolLocalPublicSiteUrl(sender.tab.url || '');
}

function pendingKey(siteTabId) {
  return `${PENDING_PREFIX}${siteTabId}`;
}

async function getPendingForAuthTab(authTabId) {
  const entries = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(entries)) {
    if (
      key.startsWith(PENDING_PREFIX) &&
      value?.authTabId === authTabId &&
      value.expiresAt > Date.now()
    ) {
      return { key, value };
    }
  }
  return null;
}

async function notifySite(siteTabId, message) {
  try {
    await chrome.tabs.sendMessage(siteTabId, message);
  } catch {
    console.warn('[HirePool Assistant] Could not notify the public website tab.');
  }
}

async function initializeSite(sender) {
  if (!isValidSenderSite(sender)) return { ok: false };
  await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [0] },
    world: 'MAIN',
    files: ['page-entry.js']
  });
  return { ok: true };
}

async function beginLogin(sender, continuationReference) {
  if (!isValidSenderSite(sender)) {
    return { ok: false, message: 'HirePool login can only start from an approved public website page.' };
  }
  if (typeof continuationReference !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(continuationReference)) {
    return { ok: false, message: 'The login continuation is invalid. Ask the assistant to try again.' };
  }

  const siteTabId = sender.tab.id;
  const key = pendingKey(siteTabId);
  const existing = (await chrome.storage.session.get(key))[key];
  if (existing?.expiresAt > Date.now()) {
    return { ok: false, message: 'A HirePool login is already pending for this conversation.' };
  }

  const allEntries = await chrome.storage.session.get(null);
  const activePending = Object.entries(allEntries)
    .filter(([entryKey, value]) => entryKey.startsWith(PENDING_PREFIX) && value?.expiresAt > Date.now());
  if (activePending.length >= MAX_PENDING_LOGINS) {
    return { ok: false, message: 'Too many HirePool login requests are active. Please try again later.' };
  }

  const loginTab = await chrome.tabs.create({ url: LOGIN_URL, active: true });
  await chrome.storage.session.set({
    [key]: {
      siteTabId,
      authTabId: loginTab.id,
      continuationReference,
      expiresAt: Date.now() + PENDING_TTL_MS
    }
  });
  return { ok: true };
}

function getBearerToken(requestHeaders = []) {
  const header = requestHeaders.find(item => item.name.toLowerCase() === 'authorization');
  if (typeof header?.value !== 'string') return null;
  const match = header.value.match(/^Bearer\s+([A-Za-z0-9._~-]{16,8192})$/i);
  return match?.[1] || null;
}

async function createBridgeSession(accessToken) {
  const response = await fetch(`${SDK_ORIGIN}/api/hirepool/session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: '{}',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error'
  });
  if (!response.ok) return null;

  const session = await response.json();
  if (
    typeof session?.credential !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(session.credential) ||
    typeof session?.sessionScope !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(session.sessionScope) ||
    !Number.isInteger(session.expiresIn) ||
    session.expiresIn <= 0
  ) {
    throw new Error('The local identity bridge returned an invalid session.');
  }
  return session;
}

async function consumeContinuation(credential, continuationReference) {
  const response = await fetch(`${SDK_ORIGIN}/api/hirepool/continuation/consume`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ continuationReference }),
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error'
  });
  if (!response.ok) return null;

  const continuation = await response.json();
  if (
    typeof continuation?.conversationId !== 'string' ||
    typeof continuation?.pendingRequest !== 'string' ||
    !continuation.pendingRequest.trim()
  ) {
    throw new Error('The local login continuation returned invalid data.');
  }
  return continuation;
}

async function observeIdentityRequest(details) {
  if (
    details.method !== 'GET' ||
    details.initiator !== AUTH_ORIGIN ||
    details.tabId < 0
  ) {
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(details.url);
  } catch {
    return;
  }
  if (requestUrl.origin !== API_ORIGIN || requestUrl.search || !IDENTITY_PATHS.has(requestUrl.pathname)) {
    return;
  }

  const pending = await getPendingForAuthTab(details.tabId);
  if (!pending) return;
  const accessToken = getBearerToken(details.requestHeaders);
  if (!accessToken) return;

  const { siteTabId, continuationReference } = pending.value;
  try {
    const bridgeSession = await createBridgeSession(accessToken);
    if (!bridgeSession) {
      await chrome.storage.session.remove(pending.key);
      await notifySite(siteTabId, {
        type: 'auth-error',
        message: 'HirePool could not verify this account for assistant access. Confirm the account is active and try again.'
      });
      return;
    }

    const continuation = await consumeContinuation(bridgeSession.credential, continuationReference);
    if (!continuation) {
      await chrome.storage.session.remove(pending.key);
      await notifySite(siteTabId, {
        type: 'auth-error',
        message: 'This login request expired. Ask the assistant to start the request again.'
      });
      return;
    }

    const siteTab = await chrome.tabs.get(siteTabId);
    if (!isHirePoolLocalPublicSiteUrl(siteTab.url || '')) {
      await chrome.storage.session.remove(pending.key);
      return;
    }

    await chrome.storage.session.set({
      [`${ACTIVE_PREFIX}${siteTabId}`]: { siteTabId }
    });
    await chrome.storage.session.remove(pending.key);
    await chrome.tabs.sendMessage(siteTabId, {
      type: 'auth-complete',
      session: {
        credential: bridgeSession.credential,
        sessionScope: bridgeSession.sessionScope,
        conversationId: continuation.conversationId,
        pendingRequest: continuation.pendingRequest
      }
    });
    await chrome.tabs.update(siteTabId, { active: true });
  } catch {
    console.error('[HirePool Assistant] Local login handoff failed.');
    await notifySite(siteTabId, {
      type: 'auth-error',
      message: 'HirePool login completed, but the assistant could not resume the request. Ask the assistant to try again.'
    });
  }
}

async function broadcastLogout() {
  const entries = await chrome.storage.session.get(null);
  const activeKeys = [];
  for (const [key, active] of Object.entries(entries)) {
    if (key.startsWith(ACTIVE_PREFIX)) {
      activeKeys.push(key);
      await notifySite(active.siteTabId, { type: 'logout' });
    }
  }
  if (activeKeys.length) await chrome.storage.session.remove(activeKeys);
}

function handleNavigation(details) {
  if (details.frameId !== 0) return;
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return;
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (
    url.origin === AUTH_ORIGIN &&
    (normalizedPath === '/logout' || normalizedPath === '/login')
  ) {
    void (async () => {
      const pending = await getPendingForAuthTab(details.tabId);
      if (pending) {
        // This tab was opened specifically for a pending login; do not treat as logout
        return;
      }
      await broadcastLogout();
    })();
    return;
  }

  if (
    url.origin === 'http://localhost:3000' ||
    url.origin === 'http://127.0.0.1:3000' ||
    url.origin === 'http://localhost:3001' ||
    url.origin === 'http://127.0.0.1:3001'
  ) {
    void notifySite(details.tabId, {
      type: 'site-policy',
      allowed: isHirePoolLocalPublicSiteUrl(details.url)
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let operation;
  if (message?.type === 'initialize-site') {
    operation = initializeSite(sender);
  } else if (message?.type === 'begin-login') {
    operation = beginLogin(sender, message.continuationReference);
  } else {
    return;
  }

  operation
    .then(sendResponse)
    .catch(() => sendResponse({
      ok: false,
      message: 'The local HirePool assistant extension could not complete this request.'
    }));
  return true;
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    let requestUrl;
    try {
      requestUrl = new URL(details.url);
    } catch {
      return;
    }
    if (requestUrl.pathname === '/api/v1/auth/logout') {
      void broadcastLogout().catch(() => {});
      return;
    }
    void observeIdentityRequest(details).catch(() => {
      console.error('[HirePool Assistant] Could not process a verified identity request.');
    });
  },
  {
    urls: [
      `${API_ORIGIN}/api/v1/auth/me`,
      `${API_ORIGIN}/api/v1/auth/logout`,
      `${API_ORIGIN}/api/v1/candidates/profile`,
      `${API_ORIGIN}/api/v1/clients/profile`,
      `${API_ORIGIN}/api/v1/clients/me`,
      `${API_ORIGIN}/api/v1/consultancies/profile`,
      `${API_ORIGIN}/api/v1/consultancies/me`
    ],
    types: ['xmlhttprequest']
  },
  ['requestHeaders', 'extraHeaders']
);

chrome.webNavigation.onHistoryStateUpdated.addListener(handleNavigation);
chrome.webNavigation.onCommitted.addListener(handleNavigation);

chrome.tabs.onRemoved.addListener(tabId => {
  void chrome.storage.session.get(null).then(async entries => {
    const removals = [];
    for (const [key, value] of Object.entries(entries)) {
      if (
        (key.startsWith(PENDING_PREFIX) && (value?.siteTabId === tabId || value?.authTabId === tabId)) ||
        (key.startsWith(ACTIVE_PREFIX) && value?.siteTabId === tabId)
      ) {
        removals.push(key);
      }
    }
    if (removals.length) await chrome.storage.session.remove(removals);
  });
});
