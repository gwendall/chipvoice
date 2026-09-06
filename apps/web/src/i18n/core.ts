import sourceTemplates from './source-templates.json';
export const locales = ['en', 'ja'] as const;
export type Locale = typeof locales[number];
export type Messages = Record<string, string>;
export const isLocale = (value: string): value is Locale => locales.includes(value as Locale);
export const localeOf = (pathname: string): Locale => /^\/ja(?:\/|$)/.test(pathname) ? 'ja' : 'en';
export function localePath(path: string, locale: Locale): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const stripped = path.replace(/^\/(?:en|ja)(?=\/|[?#]|$)/, '') || '/';
  const base = stripped.startsWith('/') ? stripped : `/${stripped}`;
  return locale === 'en' ? base : `/ja${base === '/' ? '' : base.replace(/^\/(?=[?#])/, '')}`;
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const interpolate = (text: string, values: Record<string,string|number>) => text.replace(/\{(\w+)\}/g, (_,name)=>String(values[name]??`{${name}}`));
/** UI copy uses exact keys and explicit placeholders. Only the enumerated
 * canonical SDK/worker messages use source matching; UI phrases such as
 * "{elapsed} of {duration}" can never accidentally match a technical error. */
export function createTranslator(messages: Messages) {
  const templates = sourceTemplates.map(key => ({
    pattern: new RegExp(`^${key.split(/\{\w+\}/).map(escape).join('(.+?)')}$`, 's'),
    names: [...key.matchAll(/\{(\w+)\}/g)].map(match=>match[1]),
    value: messages[key] ?? key,
  }));
  const cache = new Map<string,string>();
  function t<T>(source: T, values?: Record<string,string|number>): T {
    if(typeof source!=='string'||!source.trim())return source;
    const key=source.trim(),value=Object.hasOwn(messages,key)?messages[key]:key;
    return (source.match(/^\s*/)?.[0]+(values?interpolate(value,values):value)+source.match(/\s*$/)?.[0]) as T;
  }
  function fromSource(source: string): string {
    if(!source.trim()||Object.hasOwn(messages,source.trim()))return t(source);
    if(cache.has(source))return cache.get(source)!;
    let result=source;
    for(const template of templates){const match=source.trim().match(template.pattern);if(!match)continue;
      result=interpolate(template.value,Object.fromEntries(template.names.map((name,index)=>[name,fromSource(match[index+1])])));break;
    }
    if(cache.size>=512)cache.delete(cache.keys().next().value!);
    cache.set(source,result);return result;
  }
  return Object.assign(t,{source:fromSource});
}
