import {redirect} from 'next/navigation';
import {localePath,isLocale} from '@/i18n/core';
export default async function Page({params}:{params:Promise<{locale:string}>}){const {locale}=await params;redirect(localePath('/',isLocale(locale)?locale:'en'));}
