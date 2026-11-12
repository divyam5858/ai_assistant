import {
  HIREPOOL_LOCAL_LOGIN_URL,
  HIREPOOL_PRODUCTION_LOGIN_URL,
  HIREPOOL_PUBLIC_SITE_ORIGIN,
  isHirePoolPublicSiteUrl
} from '../../config/hirepool-site-policy.js';

export const HIREPOOL_LOGIN_ACTION = 'hirepool_login';
export const HIREPOOL_SIGNUP_ACTION = 'hirepool_signup';

let activeAccountWindow = null;

export function getHirePoolAccountUrl(currentUrl, action = HIREPOOL_LOGIN_ACTION) {
  let pageUrl;
  try {
    pageUrl = new URL(currentUrl);
  } catch {
    throw new TypeError('The current page URL is invalid');
  }
  if (!isHirePoolPublicSiteUrl(pageUrl.href)) {
    throw new Error('HirePool account actions can only be opened from an approved public website page');
  }

  const isSignup = action === HIREPOOL_SIGNUP_ACTION;
  if (!isSignup && action !== HIREPOOL_LOGIN_ACTION) {
    throw new TypeError('Unsupported HirePool account action');
  }
  const route = isSignup ? '/register' : '/login';
  if (pageUrl.origin === HIREPOOL_PUBLIC_SITE_ORIGIN) {
    return new URL(route, HIREPOOL_PRODUCTION_LOGIN_URL).href;
  }
  const accountUrl = new URL(route, HIREPOOL_LOCAL_LOGIN_URL);
  accountUrl.searchParams.set('assistant_origin', pageUrl.origin);
  return accountUrl.href;
}

export function getHirePoolLoginUrl(currentUrl) {
  return getHirePoolAccountUrl(currentUrl, HIREPOOL_LOGIN_ACTION);
}

export function openHirePoolAccount({ currentUrl, openWindow, action = HIREPOOL_LOGIN_ACTION }) {
  if (typeof openWindow !== 'function') {
    throw new TypeError('A browser window opener is required');
  }

  const accountUrl = getHirePoolAccountUrl(currentUrl, action);
  let accountWindow;
  try {
    accountWindow = openWindow('about:blank', '_blank');
    if (!accountWindow) {
      throw new Error('The HirePool account window was blocked by the browser');
    }
    accountWindow.location.replace(accountUrl);
    activeAccountWindow = accountWindow;
    return {
      message: action === HIREPOOL_SIGNUP_ACTION
        ? 'HirePool signup opened in a new tab. Complete the existing registration and email verification steps, then return to this assistant.'
        : 'HirePool login opened in a new tab. Return to this assistant afterward; this conversation will remain open.'
    };
  } catch (error) {
    accountWindow?.close?.();
    throw new Error(
      error instanceof Error ? error.message : 'HirePool login could not be opened'
    );
  }
}

export function openHirePoolLogin(options) {
  return openHirePoolAccount({ ...options, action: HIREPOOL_LOGIN_ACTION });
}

export function openHirePoolSignup(options) {
  return openHirePoolAccount({ ...options, action: HIREPOOL_SIGNUP_ACTION });
}

export function isHirePoolAccountWindow(source) {
  return Boolean(activeAccountWindow && source === activeAccountWindow);
}

export function clearHirePoolAccountWindow(source) {
  if (source && source !== activeAccountWindow) return false;
  activeAccountWindow = null;
  return true;
}
