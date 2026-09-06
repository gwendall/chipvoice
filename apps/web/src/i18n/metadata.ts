import type {Metadata} from 'next';
import {createTranslator, isLocale, localePath, type Locale} from './core';
import {getMessages} from './server';
import {pages, type PageId} from './pages';
export const SITE = 'https://chipvoice.dev';
export function alternates(path: string, locale: Locale) {
 return {canonical:SITE+localePath(path,locale),languages:{en:SITE+localePath(path,'en'),ja:SITE+localePath(path,'ja'),'x-default':SITE+localePath(path,'en')}};
}
export function pageMetadata(page: PageId) {
 return async ({params}:{params:Promise<{locale:string}>}):Promise<Metadata> => {
  const {locale: value}=await params,locale=isLocale(value)?value:'en',t=createTranslator(await getMessages(locale)),entry=pages[page];
  const title=t(entry.title),description=t(entry.description);
  return {title,description,alternates:alternates(entry.path,locale),openGraph:{title,description,url:SITE+localePath(entry.path,locale),type:'website',locale:locale==='ja'?'ja_JP':'en_US',alternateLocale:locale==='ja'?'en_US':'ja_JP'},twitter:{card:'summary',title,description}};
 };
}
