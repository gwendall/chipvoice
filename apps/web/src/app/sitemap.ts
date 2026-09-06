import type {MetadataRoute} from 'next';
import {locales,localePath} from '@/i18n/core';
import {SITE} from '@/i18n/metadata';
export default function sitemap():MetadataRoute.Sitemap{return ['/','/about','/lab','/lab/components'].flatMap(path=>locales.map(locale=>({url:SITE+localePath(path,locale),alternates:{languages:{en:SITE+localePath(path,'en'),ja:SITE+localePath(path,'ja')}}})));}
