export const HIREPOOL_PUBLIC_SITE_ORIGIN = 'https://hirepool.ai';
export const HIREPOOL_PRODUCTION_LOGIN_URL = 'https://app.hirepool.ai/login';
export const HIREPOOL_LOCAL_LOGIN_URL = 'http://localhost:5173/login';

export const HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001'
]);

export const HIREPOOL_LOCAL_PUBLIC_SITE_PATHS = Object.freeze([
  '/',
  '/features',
  '/enterprise',
  '/pricing',
  '/partners',
  '/women',
  '/terms',
  '/privacy',
  '/contact'
]);

export const HIREPOOL_LOCAL_DASHBOARD_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173'
]);

const localOrigins = new Set(HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS);
const publicOrigins = new Set([...HIREPOOL_LOCAL_PUBLIC_SITE_ORIGINS, HIREPOOL_PUBLIC_SITE_ORIGIN]);
const publicPaths = new Set(HIREPOOL_LOCAL_PUBLIC_SITE_PATHS);

function isApprovedPublicSiteUrl(value, origins) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (!origins.has(url.origin) || url.username || url.password) {
    return false;
  }

  const pathname = url.pathname.length > 1
    ? url.pathname.replace(/\/+$/, '')
    : url.pathname;
  return publicPaths.has(pathname);
}

export function isHirePoolLocalPublicSiteUrl(value) {
  return isApprovedPublicSiteUrl(value, localOrigins);
}

export function isHirePoolPublicSiteUrl(value) {
  return isApprovedPublicSiteUrl(value, publicOrigins);
}
