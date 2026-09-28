'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type ComponentProps } from 'react';
import NextLink from 'next/link';
import type { Messages, Translator } from './core.js';

export interface I18nReactConfig<L extends string> {
  defaultLocale: L;
  /** Wraps `createTranslator` with the app's own `sourceTemplates` baked in. */
  createTranslator: (messages: Messages) => Translator;
  localeOf: (pathname: string) => L;
  localePath: (path: string, locale: L) => string;
  /** Loads one locale's message dictionary, e.g. by dynamic import. */
  loadMessages: (locale: L) => Promise<Messages>;
  /** Runs after a locale switch, once the new translator is in place; updates
   * anything outside React's tree (head tags, in chipvoice's case). */
  onLocaleChange?: (locale: L, t: Translator) => void;
  /** Shown, translated, when `loadMessages` rejects mid-switch. */
  loadErrorMessage?: string;
  /** Shown, translated, by `useErrorText` for an untranslated platform
   * exception surfaced in a non-default locale. */
  genericErrorMessage?: string;
}

/**
 * Builds one app's `I18nProvider`/`useT`/`Link` set. An app configures this
 * once (see apps/web/src/i18n/react.tsx) and every component imports the
 * result from that one local module, unchanged in shape from before this
 * package existed.
 */
export function createI18nReact<L extends string>(config: I18nReactConfig<L>) {
  const loadErrorMessage = config.loadErrorMessage ?? 'Language could not load. Check your connection and try again.';
  const genericErrorMessage = config.genericErrorMessage ?? 'Something went wrong. Please try again.';

  const Context = createContext<{
    locale: L;
    t: Translator;
    switchLocale: (locale: L) => void;
    busy: boolean;
    error: string;
  } | null>(null);

  function I18nProvider({ locale: initialLocale, messages, children }: { locale: L; messages: Messages; children: ReactNode }) {
    const [state, setState] = useState({ locale: initialLocale, messages }),
      [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const generation = useRef(0);
    const t = useMemo(() => config.createTranslator(state.messages), [state.messages]);
    const switchLocale = async (locale: L, navigation = true) => {
      const ticket = ++generation.current;
      setError('');
      setBusy(true);
      try {
        const next = await config.loadMessages(locale);
        if (ticket !== generation.current) return;
        if (navigation) history.pushState(null, '', config.localePath(location.pathname, locale) + location.search + location.hash);
        setState({ locale, messages: next });
      } catch {
        if (ticket === generation.current) {
          if (!navigation)
            history.replaceState(null, '', config.localePath(location.pathname, state.locale) + location.search + location.hash);
          setError(loadErrorMessage);
        }
      } finally {
        if (ticket === generation.current) setBusy(false);
      }
    };
    useEffect(() => {
      const restore = () => {
        void switchLocale(config.localeOf(location.pathname), false);
      };
      window.addEventListener('popstate', restore);
      return () => window.removeEventListener('popstate', restore);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.locale]);
    useEffect(() => {
      setState({ locale: initialLocale, messages });
    }, [initialLocale, messages]);
    useEffect(() => {
      document.documentElement.lang = state.locale;
      config.onLocaleChange?.(state.locale, t);
    }, [state.locale, t]);
    return <Context.Provider value={{ locale: state.locale, t, switchLocale, busy, error }}>{children}</Context.Provider>;
  }

  function useI18n() {
    const value = useContext(Context);
    if (!value) throw new Error('I18nProvider is missing');
    return value;
  }
  const useT = () => useI18n().t;
  /** Browser/network exception wording is outside the catalogue. Keep it useful
   * in the default locale; never leak an untranslated platform exception into
   * a non-default one. */
  function useErrorText() {
    const { locale, t } = useI18n();
    return (source: string) => {
      const translated = t.source(source);
      return locale !== config.defaultLocale && source && translated === source ? t(genericErrorMessage) : translated;
    };
  }
  function LanguageSelector({ locales }: { locales: readonly { value: L; label: string; lang: string }[] }) {
    const { locale, t, switchLocale, busy, error } = useI18n();
    return (
      <div className="language-selector">
        <label>
          <span className="sr-only">{t('Language')}</span>
          <select
            aria-label={t('Language')}
            value={locale}
            disabled={busy}
            aria-busy={busy}
            onChange={(event) => switchLocale(event.target.value as L)}
          >
            {locales.map((option) => (
              <option key={option.value} value={option.value} lang={option.lang}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <span className="language-error" role="alert">
            {t(error)}
          </span>
        )}
      </div>
    );
  }
  function Link({ href, ...props }: ComponentProps<typeof NextLink>) {
    const { locale } = useI18n();
    return <NextLink {...props} href={typeof href === 'string' ? config.localePath(href, locale) : href} />;
  }

  return { I18nProvider, useI18n, useT, useErrorText, LanguageSelector, Link };
}
