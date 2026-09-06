import type {ReactNode} from 'react';
import {notFound} from 'next/navigation';
import {isLocale,locales} from '@/i18n/core';
import {getMessages} from '@/i18n/server';
import {I18nProvider} from '@/i18n/react';
import '../globals.css';
import '@/ui/tokens.css';
import '@/ui/style.css';
import '@/studio/style.css';
export function generateStaticParams(){return locales.map(locale=>({locale}));}
export default async function RootLayout({children,params}:{children:ReactNode;params:Promise<{locale:string}>}){
 const {locale}=await params;if(!isLocale(locale))notFound();
 return <html lang={locale}><body><I18nProvider locale={locale} messages={await getMessages(locale)}>{children}</I18nProvider></body></html>;
}
