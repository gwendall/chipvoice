'use client';
import {createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type ComponentProps} from 'react';
import NextLink from 'next/link';
import {createTranslator, localeOf, localePath, type Locale, type Messages} from './core';
import {syncMetadata} from './metadata-client';

const Context = createContext<{locale: Locale; t: ReturnType<typeof createTranslator>; switchLocale: (locale: Locale) => void; busy: boolean} | null>(null);
export function I18nProvider({locale: initialLocale, messages, children}: {locale: Locale; messages: Messages; children: ReactNode}) {
  const [state, setState] = useState({locale: initialLocale, messages}), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const t = useMemo(() => createTranslator(state.messages), [state.messages]);
  const switchLocale = async (locale: Locale, navigation = true) => {
    const ticket = ++generation.current;
    setBusy(true);
    try {
      const next = (await (locale === 'ja' ? import('./messages/ja.json') : import('./messages/en.json'))).default;
      if (ticket !== generation.current) return;
      if (navigation) history.pushState(null, '', localePath(location.pathname, locale) + location.search + location.hash);
      setState({locale, messages: next});
    } catch { if (ticket === generation.current) location.assign(localePath(location.pathname, locale) + location.search + location.hash); }
    finally { if (ticket === generation.current) setBusy(false); }
  };
  useEffect(() => {
    const restore = () => { void switchLocale(localeOf(location.pathname), false); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => { setState({locale: initialLocale, messages}); }, [initialLocale, messages]);
  useEffect(() => { document.documentElement.lang = state.locale; syncMetadata(state.locale, t); }, [state.locale, t]);
  return <Context.Provider value={{locale: state.locale, t, switchLocale, busy}}>{children}</Context.Provider>;
}
export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error('I18nProvider is missing');
  return value;
}
export const useT = () => useI18n().t;
/** Browser/network exception wording is outside our catalogue. Keep it useful
 * in English; never leak an untranslated platform exception into Japanese UI. */
export function useErrorText() {
  const {locale, t} = useI18n();
  return (source: string) => {
    const translated = t(source);
    return locale === 'ja' && source && translated === source ? t('Something went wrong. Please try again.') : translated;
  };
}
export function LanguageSelector() {
  const {locale, t, switchLocale, busy} = useI18n();
  return <label className="language-selector"><span className="sr-only">{t('Language')}</span><select aria-label={t('Language')} value={locale} disabled={busy} aria-busy={busy} onChange={event => switchLocale(event.target.value as Locale)}><option value="en" lang="en">English</option><option value="ja" lang="ja">日本語</option></select></label>;
}
export default function Link({href, ...props}: ComponentProps<typeof NextLink>) {
  const {locale} = useI18n();
  return <NextLink {...props} href={typeof href === 'string' ? localePath(href, locale) : href}/>;
}
