export type Messages = Record<string, string>;

/**
 * Locale routing and the translator, generalized over an app's own locale
 * list. An app with locales `["en", "ja"]` and default `"en"` gets back
 * exactly chipvoice's original `isLocale`/`localeOf`/`localePath` behaviour;
 * a third locale, or a different default, changes only the arithmetic, not
 * the shape of any of these functions.
 */
export function createLocaleHelpers<L extends string>(locales: readonly L[], defaultLocale: L) {
  const isLocale = (value: string): value is L => (locales as readonly string[]).includes(value);
  const localeOf = (pathname: string): L => {
    for (const locale of locales) {
      if (locale === defaultLocale) continue;
      if (new RegExp(`^/${locale}(?:/|$)`).test(pathname)) return locale;
    }
    return defaultLocale;
  };
  const localePath = (path: string, locale: L): string => {
    if (!path.startsWith("/") || path.startsWith("//")) return path;
    const alternation = locales.join("|");
    const stripped = path.replace(new RegExp(`^/(?:${alternation})(?=/|[?#]|$)`), "") || "/";
    const base = stripped.startsWith("/") ? stripped : `/${stripped}`;
    return locale === defaultLocale ? base : `/${locale}${base === "/" ? "" : base.replace(/^\/(?=[?#])/, "")}`;
  };
  return { isLocale, localeOf, localePath };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const interpolate = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));

/**
 * UI copy uses exact keys and explicit placeholders. `sourceTemplates` is an
 * app-specific list of canonical SDK/worker source messages (chipvoice's own
 * live in `apps/web/src/i18n/source-templates.json`); only they use source
 * matching, so a UI phrase such as "{elapsed} of {duration}" can never
 * accidentally match a technical error.
 */
export function createTranslator(messages: Messages, sourceTemplates: string[] = []) {
  const templates = sourceTemplates.map((key) => ({
    pattern: new RegExp(`^${key.split(/\{\w+\}/).map(escape).join("(.+?)")}$`, "s"),
    names: [...key.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!),
    value: messages[key] ?? key,
  }));
  const cache = new Map<string, string>();
  function t<T>(source: T, values?: Record<string, string | number>): T {
    if (typeof source !== "string" || !source.trim()) return source;
    const key = source.trim(),
      value = Object.hasOwn(messages, key) ? messages[key]! : key;
    return (source.match(/^\s*/)?.[0] + (values ? interpolate(value, values) : value) + source.match(/\s*$/)?.[0]) as T;
  }
  function fromSource(source: string): string {
    if (!source.trim() || Object.hasOwn(messages, source.trim())) return t(source);
    if (cache.has(source)) return cache.get(source)!;
    let result = source;
    for (const template of templates) {
      const match = source.trim().match(template.pattern);
      if (!match) continue;
      result = interpolate(
        template.value,
        Object.fromEntries(template.names.map((name, index) => [name, fromSource(match[index + 1]!)])),
      );
      break;
    }
    if (cache.size >= 512) cache.delete(cache.keys().next().value!);
    cache.set(source, result);
    return result;
  }
  return Object.assign(t, { source: fromSource });
}
export type Translator = ReturnType<typeof createTranslator>;
