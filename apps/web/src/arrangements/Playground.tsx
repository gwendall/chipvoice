'use client';
import {useEffect,useState} from 'react';
import dynamic from 'next/dynamic';
import Arrangements,{type Report} from './Arrangements';
import type {Overview} from './Transport';
import {SiteHeader,SiteFooter} from '../ui/components';
const Studio=dynamic(()=>import('../studio/App'),{loading:()=> <p role="status" className="demo-main">Opening the composer…</p>});

export default function Playground({catalogue,initialOverview}:{catalogue:Report;initialOverview:Overview}){
 const [compose,setCompose]=useState(false);
 useEffect(()=>{const restore=()=>setCompose(new URLSearchParams(location.search).get('mode')==='compose'||location.hash.length>1);restore();window.addEventListener('popstate',restore);window.addEventListener('hashchange',restore);return()=>{window.removeEventListener('popstate',restore);window.removeEventListener('hashchange',restore);};},[]);
 const select=(next:boolean)=>{setCompose(next);history.replaceState(null,'',next?'/?mode=compose':'/');};
 return <><SiteHeader/><nav className="playground-modes demo-main" aria-label="Playground mode"><button aria-pressed={!compose} onClick={()=>select(false)}>Listen & explore</button><button aria-pressed={compose} onClick={()=>select(true)}>Make a loop <span aria-hidden="true">＋</span></button><span>{compose?'Your own score · pads, recording & code':'Full arrangements · four consoles · your MIDI'}</span></nav>
  <div hidden={compose}><Arrangements catalogue={catalogue} initialOverview={initialOverview} active={!compose} embedded/></div>
  {compose&&<Studio embedded/>}<SiteFooter/></>;
}
