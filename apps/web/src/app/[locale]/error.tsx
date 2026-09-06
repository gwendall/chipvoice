'use client';
import {useT} from '@/i18n/react';
import {SiteHeader,SiteFooter} from '@/ui/components';
export default function ErrorPage({reset}:{reset:()=>void}){const t=useT();return <><SiteHeader/><main className="demo-main about-main"><h1>{t('Something went wrong. Please try again.')}</h1><button className="small-button" onClick={reset}>{t('Try again')}</button></main><SiteFooter/></>;}
