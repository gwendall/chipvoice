"use client";
import { createI18nReact } from "web-kit/i18n/react";
import { createTranslator, localeOf, localePath, type Locale } from "./core";

/**
 * gamesounds.ai's own configuration of `web-kit/i18n/react`'s
 * `createI18nReact`: two-locale dynamic message imports, no head-tag sync
 * (this app has no per-page metadata catalogue like chipvoice.dev's
 * `syncMetadata` yet - Phase 1 pages share one static description). Every
 * component in this app imports from this one module.
 */
const shared = createI18nReact<Locale>({
  defaultLocale: "en",
  createTranslator,
  localeOf,
  localePath,
  loadMessages: async (locale) =>
    (locale === "ja" ? await import("./messages/ja.json") : await import("./messages/en.json")).default,
});

export const I18nProvider = shared.I18nProvider;
export const useI18n = shared.useI18n;
export const useT = shared.useT;
export const useErrorText = shared.useErrorText;

const LANGUAGE_OPTIONS = [
  { value: "en" as Locale, label: "English", lang: "en" },
  { value: "ja" as Locale, label: "日本語", lang: "ja" },
];
export function LanguageSelector() {
  return <shared.LanguageSelector locales={LANGUAGE_OPTIONS} />;
}

export default shared.Link;
