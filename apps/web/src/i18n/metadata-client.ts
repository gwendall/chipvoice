import {localePath, type Locale, type createTranslator} from './core';
import {pages} from './pages';
/** Native history preserves the instrument. Update head tags from the same
 * catalogue as server metadata, so a language switch has no stale English head. */
export function syncMetadata(locale: Locale, t: ReturnType<typeof createTranslator>) {
 const path=localePath(location.pathname,'en');
 const entry=Object.values(pages).find(page=>page.path===path);
 const shared=document.querySelector<HTMLMetaElement>('meta[name="chipvoice:shared-description"]');
 if(!entry&&!shared)return;
 const title=entry?t(entry.title):document.title;
 const description=entry?t(entry.description):t.source(shared!.content);
 document.title=title;
 for(const [selector,content] of [['name="description"',description],['property="og:title"',title],['property="og:description"',description],['property="og:url"','https://chipvoice.dev'+localePath(path,locale)],['property="og:locale"',locale==='ja'?'ja_JP':'en_US'],['property="og:locale:alternate"',locale==='ja'?'en_US':'ja_JP'],['name="twitter:title"',title],['name="twitter:description"',description]]) {
  document.querySelectorAll<HTMLMetaElement>(`meta[${selector}]`).forEach(meta=>meta.content=content);
 }
 document.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]').forEach(link=>link.href='https://chipvoice.dev'+localePath(path,locale));
 for(const meta of document.querySelectorAll<HTMLMetaElement>('meta[property="og:image"], meta[name="twitter:image"]')) {
  const url=new URL(meta.content,location.origin);if(/\/s\/[^/]+\/card$/.test(url.pathname)){url.pathname=localePath(url.pathname,locale);meta.content=url.href;}
 }
}
