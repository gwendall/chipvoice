import { createLocaleHelpers, createTranslator as sharedCreateTranslator, type Messages } from "web-kit/i18n";

export type { Messages } from "web-kit/i18n";

export const locales = ["en", "ja"] as const;
export type Locale = (typeof locales)[number];

const helpers = createLocaleHelpers(locales, "en");
export const isLocale = helpers.isLocale;
export const localeOf = helpers.localeOf;
export const localePath = helpers.localePath;

/**
 * gamesounds.ai has no SDK/worker source-text errors to match (that pattern
 * is chipvoice's, for its render pipeline's own exception text); every
 * string here is a plain UI key, so this is `web-kit/i18n`'s generic
 * `createTranslator` with an empty template list, kept as its own function
 * so call sites read the same as apps/web's `createTranslator`.
 */
export function createTranslator(messages: Messages) {
  return sharedCreateTranslator(messages, []);
}
