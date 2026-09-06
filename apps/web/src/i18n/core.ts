export const locales = ['en', 'ja'] as const;
export type Locale = typeof locales[number];
export type Messages = Record<string, string>;
export const isLocale = (value: string): value is Locale => locales.includes(value as Locale);
export const localeOf = (pathname: string): Locale => /^\/ja(?:\/|$)/.test(pathname) ? 'ja' : 'en';
export function localePath(path: string, locale: Locale): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const base = path.replace(/^\/(?:en|ja)(?=\/|[?#]|$)/, '') || '/';
  return locale === 'en' ? base : `/ja${base === '/' ? '' : base.startsWith('/') ? base : `/${base}`}`;
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** English source keys keep copy searchable. Templates also translate worker
 * notices without putting language into audio state or render dependencies. */
export function createTranslator(messages: Messages) {
  const templates = Object.entries(messages).filter(([key]) => /\{\w+\}/.test(key)).map(([key, value]) => {
    const names = [...key.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    return {pattern: new RegExp(`^${key.split(/\{\w+\}/).map(escape).join('(.+?)')}$`, 's'), names, value};
  });
  const cache = new Map<string, string>();
  function t<T>(source: T, values?: Record<string, string | number>): T {
    if (typeof source !== 'string' || !source) return source;
    const leading = source.match(/^\s*/)?.[0] ?? '', trailing = source.match(/\s*$/)?.[0] ?? '';
    const key = source.trim();
    if (!key) return source;
    let result = Object.hasOwn(messages, key) ? messages[key] : cache.get(key);
    if (result === undefined) {
      for (const template of templates) {
        const match = key.match(template.pattern);
        if (match) { result = template.value.replace(/\{(\w+)\}/g, (_, name) => String(t(match[template.names.indexOf(name) + 1]))); break; }
      }
    }
    result ??= key;
    if (!Object.hasOwn(messages, key) && !cache.has(key)) {
      if (cache.size >= 512) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
    }
    if (values) result = result.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
    return (leading + result + trailing) as T;
  }
  return t;
}
