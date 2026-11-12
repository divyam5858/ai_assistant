(() => {
  const channel = 'hirepool-local-assistant-extension';
  let pageReady = false;
  const pendingPageMessages = [];

  function postToPage(message) {
    if (!pageReady) {
      pendingPageMessages.push(message);
      return;
    }
    window.postMessage({ channel, ...message }, window.location.origin);
  }

  window.addEventListener('message', event => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.channel !== channel ||
      event.data?.type !== 'page-ready'
    ) {
      return;
    }
    pageReady = true;
    for (const message of pendingPageMessages.splice(0)) postToPage(message);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'site-policy') {
      postToPage({ type: 'site-policy', allowed: message.allowed === true });
    } else if (message.type === 'auth-complete') {
      postToPage({ type: 'auth-complete', ...message.session });
    } else if (message.type === 'auth-error') {
      postToPage({ type: 'auth-error', message: message.message });
    } else if (message.type === 'logout') {
      postToPage({ type: 'logout' });
    }
    sendResponse({ ok: true });
  });

  window.addEventListener('message', async event => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.channel !== channel ||
      event.data?.type !== 'begin-login' ||
      typeof event.data.requestId !== 'string' ||
      typeof event.data.continuationReference !== 'string'
    ) {
      return;
    }

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'begin-login',
        continuationReference: event.data.continuationReference
      });
      postToPage({
        type: 'login-start-result',
        requestId: event.data.requestId,
        ok: result?.ok === true,
        message: result?.message
      });
    } catch {
      postToPage({
        type: 'login-start-result',
        requestId: event.data.requestId,
        ok: false,
        message: 'The HirePool login tab could not be opened.'
      });
    }
  });

  chrome.runtime.sendMessage({ type: 'initialize-site' }).catch(() => {});
})();
