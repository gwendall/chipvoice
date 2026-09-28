import { createLocaleHelpers, createTranslator as sharedCreateTranslator, type Messages } from "web-kit/i18n";
import sourceTemplates from "./source-templates.json";

export type { Messages } from "web-kit/i18n";

export const locales = ["en", "ja"] as const;
export type Locale = (typeof locales)[number];

const helpers = createLocaleHelpers(locales, "en");
export const isLocale = helpers.isLocale;
export const localeOf = helpers.localeOf;
export const localePath = helpers.localePath;

/**
 * chipvoice's own `sourceTemplates` (its canonical SDK/worker source
 * messages) baked into `web-kit/i18n`'s generic `createTranslator`, unchanged
 * in shape from before this package existed.
 */
export function createTranslator(messages: Messages) {
  return sharedCreateTranslator(messages, sourceTemplates);
}
