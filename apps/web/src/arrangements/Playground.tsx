'use client';
import {useI18n, useT} from '@/i18n/react';
import {localePath} from '@/i18n/core';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import Arrangements,{type Report} from './Arrangements';
import type {Overview} from './Transport';
import {SiteHeader,SiteFooter} from '../ui/components';
function ComposerLoading(){
 const t = useT();return <p role="status" className="demo-main">{t("Opening the composer…")}</p>;}
const Studio=dynamic(()=>import('../studio/App'),{loading:ComposerLoading});

export default function Playground({catalogue,initialOverview}:{catalogue:Report;initialOverview:Overview}){
 const t = useT();
 const {locale} = useI18n();
 const [compose,setCompose]=useState(false);
 useEffect(()=>{const restore=()=>setCompose(new URLSearchParams(location.search).get('mode')==='compose'||location.hash.length>1);restore();window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore);return()=>{window.removeEventListener('popstate',restore);window.removeEventListener('hashchange',restore);};},[]);
 const select=(next:boolean)=>{setCompose(next);history.replaceState(null,'',localePath(next?'/?mode=compose':'/',locale));};
 return <><SiteHeader/><nav className="playground-modes demo-main" aria-label={t("Playground mode")}><button aria-pressed={!compose} onClick={()=>select(false)}>{t("Listen & explore")}</button><button aria-pressed={compose} onClick={()=>select(true)}>{t("Make a loop ")}<span aria-hidden="true">＋</span></button><span>{t(compose?'Your own score · pads, recording & code':'Full arrangements · four consoles · your MIDI')}</span></nav>
  <div hidden={compose}><Arrangements catalogue={catalogue} initialOverview={initialOverview} active={!compose} embedded/></div>
  {compose&&<Studio embedded/>}<SiteFooter/></>;
}
