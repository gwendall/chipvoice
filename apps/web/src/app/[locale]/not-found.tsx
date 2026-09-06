'use client';
import Link,{useT} from '@/i18n/react';
import {SiteHeader,SiteFooter} from '@/ui/components';
export default function NotFound(){const t=useT();return <><title>{t('Page not found · chipvoice')}</title><meta name="description" content={t('This page could not be found. Return to the playground to make some music.')}/><SiteHeader/><main className="demo-main about-main"><h1>404</h1><p>{t('This page could not be found. Return to the playground to make some music.')}</p><Link href="/" className="small-button">{t('Back to the playground')}</Link></main><SiteFooter/></>;}
