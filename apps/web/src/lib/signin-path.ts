import { localePath, type Locale } from '@/i18n/core';
/** Restrict email redirects to real UI routes; never accept a host or API URL. */
export function signInDestination(value: unknown, locale: Locale): string {
  const fallback = localePath('/', locale);
  if (typeof value !== 'string' || value.length > 512 || !value.startsWith('/') || /[\\\r\n]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://chipvoice.dev');
    if (url.origin !== 'https://chipvoice.dev' || !/^\/(?:ja\/|en\/)?(?:create|library|connect|explore|p\/[a-zA-Z0-9]+)?\/?$/.test(url.pathname)) return fallback;
    return localePath(url.pathname, locale) + url.search + url.hash;
  } catch { return fallback; }
}
