(() => {
  const channel = 'hirepool-local-assistant-extension';
  const apiUrl = 'http://localhost:3100';
  const applicationId = 'hirepool-local-app';
  const assistantId = 'hirepool';
  let authSession = null;
  let pendingAuthSession = null;
  let integrationAttached = false;
  let nextRequestId = 0;
  const pendingRequests = new Map();

  function sendLoginRequest(continuationReference) {
    const requestId = `login-${Date.now()}-${++nextRequestId}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error('The HirePool login tab could not be opened.'));
      }, 15_000);
      pendingRequests.set(requestId, { resolve, reject, timeout });
      window.postMessage({
        channel,
        type: 'begin-login',
        requestId,
        continuationReference
      }, window.location.origin);
    });
  }

  async function loadSdk() {
    if (window.AssistantSDK) {
      const sdk = window.AssistantSDK;
      if (!sdk.initialized && !sdk.initializing) {
        await sdk.init({ assistantId, apiUrl });
      }
      return sdk;
    }
    const script = document.createElement('script');
    script.src = `${apiUrl}/sdk/assistant.js`;
    script.dataset.assistantId = assistantId;
    script.dataset.apiUrl = apiUrl;
    script.async = true;
    const loaded = new Promise((resolve, reject) => {
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error('The local Assistant SDK could not be loaded.')), {
        once: true
      });
    });
    document.head.appendChild(script);
    await loaded;
    if (!window.AssistantSDK) {
      throw new Error('The local Assistant SDK did not initialize.');
    }
    return window.AssistantSDK;
  }

  async function waitForInitialization(sdk) {
    const deadline = Date.now() + 15_000;
    while ((sdk.initializing || !sdk.initialized) && Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }
    if (!sdk.initialized) throw new Error('The local Assistant SDK did not finish initializing.');
  }

  async function boot() {
    if (integrationAttached) return;
    const sdk = await loadSdk();
    await waitForInitialization(sdk);
    const state = sdk.getState?.();
    if (state?.config?.assistantId !== assistantId) {
      throw new Error('The existing assistant is not configured for HirePool.');
    }

    await sdk.attachHostIntegration({
      version: 1,
      application: { id: applicationId, name: 'HirePool' },
      getAuthHeaders: async () => authSession
        ? { Authorization: `Bearer ${authSession.credential}` }
        : {},
      getSessionScope: async () => authSession?.sessionScope || null,
      executeAction: async ({ actionId, parameters }) => {
        if (actionId !== 'hirepool_begin_login') {
          throw new Error('This HirePool action is not supported by the local extension.');
        }
        if (!/^[A-Za-z0-9_-]{43}$/.test(parameters?.continuationReference || '')) {
          throw new Error('The login continuation is invalid. Ask the assistant to try again.');
        }
        return sendLoginRequest(parameters.continuationReference);
      }
    });
    integrationAttached = true;
    if (pendingAuthSession) {
      const session = pendingAuthSession;
      pendingAuthSession = null;
      void activateAuthenticatedSession(session);
    }
  }

  async function activateAuthenticatedSession(data) {
    if (
      typeof data.credential !== 'string' ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(data.credential) ||
      typeof data.sessionScope !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(data.sessionScope) ||
      typeof data.conversationId !== 'string' ||
      typeof data.pendingRequest !== 'string' ||
      !data.pendingRequest.trim()
    ) {
      window.AssistantSDK?.displayNotice?.('HirePool could not safely resume this request. Ask the assistant to try again.');
      return;
    }

    authSession = {
      credential: data.credential,
      sessionScope: data.sessionScope
    };
    try {
      await window.AssistantSDK.refreshSessionScope();
      await window.AssistantSDK.resumePendingMessage({
        conversationId: data.conversationId,
        message: data.pendingRequest
      });
    } catch (err) {
      // Do not revoke valid credentials or clear the authenticated session on resume notification errors.
      console.warn('[HirePool Assistant] Login verified, but pending request could not be resumed automatically:', err);
      window.AssistantSDK?.displayNotice?.('HirePool login succeeded and your account is connected. Ask the assistant to continue.');
    }
  }

  async function revokeCredential(credential) {
    try {
      const response = await fetch(`${apiUrl}/api/hirepool/session/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}` },
        credentials: 'omit',
        cache: 'no-store'
      });
      return response.ok || response.status === 401;
    } catch {
      return false;
    }
  }

  async function deactivateAuthenticatedSession() {
    const previousSession = authSession;
    authSession = null;
    if (previousSession && !(await revokeCredential(previousSession.credential))) {
      window.AssistantSDK?.displayNotice?.('The local assistant session could not be revoked; it will expire automatically.');
    }
    if (window.AssistantSDK?.initialized) {
      if (typeof window.AssistantSDK.widgetUI?._handleHirePoolLogout === 'function') {
        await window.AssistantSDK.widgetUI._handleHirePoolLogout(
          { loggedOut: true, sdkSessionRevoked: true, backendRevoked: true },
          'You have been logged out of HirePool.'
        );
      } else {
        window.AssistantSDK.clearConversationLocal();
        await window.AssistantSDK.refreshSessionScope({ preserveConversation: false });
      }
    }
  }

  window.addEventListener('message', event => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.channel !== channel
    ) {
      return;
    }

    if (event.data.type === 'login-start-result') {
      const pending = pendingRequests.get(event.data.requestId);
      if (!pending) return;
      pendingRequests.delete(event.data.requestId);
      window.clearTimeout(pending.timeout);
      if (event.data.ok) {
        pending.resolve({ message: 'HirePool login opened in a new tab. This request will resume after your identity is verified.' });
      } else {
        pending.reject(new Error(event.data.message || 'The HirePool login tab could not be opened.'));
      }
    } else if (event.data.type === 'auth-complete') {
      if (integrationAttached) {
        void activateAuthenticatedSession(event.data);
      } else {
        pendingAuthSession = event.data;
      }
    } else if (event.data.type === 'auth-error') {
      window.AssistantSDK?.displayNotice?.(event.data.message || 'HirePool could not verify this login.');
    } else if (event.data.type === 'logout') {
      void deactivateAuthenticatedSession();
    } else if (event.data.type === 'site-policy') {
      if (!event.data.allowed && window.AssistantSDK?.initialized) {
        window.AssistantSDK.destroy();
        integrationAttached = false;
      } else if (event.data.allowed && !integrationAttached) {
        void boot().catch(() => {
          window.AssistantSDK?.displayNotice?.('The local HirePool assistant could not be initialized on this page.');
        });
      }
    }
  });

  window.postMessage({ channel, type: 'page-ready' }, window.location.origin);
  void boot().catch(() => {
    window.AssistantSDK?.displayNotice?.('The local HirePool assistant could not be initialized on this page.');
  });
})();
