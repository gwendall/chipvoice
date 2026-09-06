'use client';
import {useErrorText, useT} from '@/i18n/react';
import {useEffect,useRef,useState} from 'react';
import Link from '@/i18n/react';
import type {Performance,PerformanceLoss,PerformancePlan} from 'chipvoice';
import {SiteHeader,SiteFooter,MachinePicker,PlayButton,Button,DisplayPanel} from '../ui/components';
import {RangeControl} from '../ui/RangeControl';
import {BufferPlayback} from '../audio/BufferPlayback.mjs';
import {DEMO_MACHINES,type ChipId} from '../studio/document';
import {Transport,type Overview} from './Transport';
import './style.css';

type Asset={file:string;sha256?:string;metrics:{rmsDbFS:number;samplePeakDbFS:number;envelope:number[]}};
type Entry=Asset&{loopStartSeconds?:number;loopFadeSeconds?:number};
type Case={omitted?:number;chip:ChipId;seconds:number;loopStartSeconds:number;mode:string;notes:number;losses:PerformanceLoss[];asset:Asset};
type Piece={id:string;title:string;source:NonNullable<Performance['source']>;notices:string[];parts:{id:string;name:string;role:string;notes:number}[];cases:Case[];reference?:{title:string;asset:Asset}};
type Loaded={title:string;chip:string;part:string;pieceId:string;overview:Overview;omitted?:number;seconds:number;losses:PerformanceLoss[];entries:Entry[]};
export type Report={pieces:Piece[]};
type Preparation={title:string;chip?:ChipId;phase:'importing'|'planning'|'rendering'|'encoding'|'decoding';startedAt:number;percent?:number;seconds?:number};
const phaseLabels={importing:'Importing MIDI',planning:'Arranging instruments',rendering:'Rendering audio',encoding:'Encoding audio',decoding:'Preparing playback'};

const levels=(entries:Entry[])=>{const target=Math.min(...entries.map(e=>e.metrics.rmsDbFS));return entries.map(e=>Math.min(1,10**((target-e.metrics.rmsDbFS)/20)));};

export default function Arrangements({catalogue,initialOverview,active=true,embedded=false}:{catalogue?:Report;initialOverview?:Overview;active?:boolean;embedded?:boolean}){
 const t = useT();
 const errorText = useErrorText();
 const [report,setReport]=useState<Report|null>(catalogue??null),[pieceId,setPieceId]=useState('mario'),[chip,setChip]=useState<ChipId>('2a03');
 const [part,setPart]=useState('mix'),[tempo,setTempo]=useState(100),[transpose,setTranspose]=useState(0),[side,setSide]=useState(0);
 const [audio,setAudio]=useState({playing:false,loading:false,error:''}),[preparing,setPreparing]=useState(false),[error,setError]=useState(''),[session,setSession]=useState(0);
 const [imported,setImported]=useState<Performance|null>(null),[loaded,setLoaded]=useState<Loaded|null>(null);
 const player=useRef<BufferPlayback|null>(null),worker=useRef<Worker|null>(null),generation=useRef(0),urls=useRef<string[]>([]),documents=useRef(new Map<string,Performance|PerformancePlan>());
 const interacted=useRef(false),alive=useRef(true);
 const [overview,setOverview]=useState<Overview|null>(initialOverview??null);
 const views=useRef(new Map<string,Overview>(initialOverview?[['mario:2a03',initialOverview]]:[]));
 const selectionId=useRef('mario');
 const importer=useRef<Worker|null>(null),importGeneration=useRef(0);
 const [importing,setImporting]=useState(false),[importError,setImportError]=useState('');
 const [preparation,setPreparation]=useState<Preparation|null>(null),[now,setNow]=useState(Date.now);
 const pending=preparing||audio.loading||!!player.current?.presentation&&loaded!==player.current.presentation;
 useEffect(()=>{if(!pending)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[pending]);

 useEffect(()=>{
  alive.current=true;const abort=new AbortController();
  if(!catalogue)fetch('/arrangement-data/report.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('The arrangement collection could not load.');return r.json();}).then(setReport).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
  return()=>{alive.current=false;abort.abort();generation.current++;worker.current?.terminate();importer.current?.terminate();const p=player.current;p?.dispose();void p?.context.close();for(const url of urls.current)URL.revokeObjectURL(url);};
 },[]);
 useEffect(()=>{if(!active)player.current?.pause();},[active]);
 useEffect(()=>{if(!active)return;let raf=0,last:Loaded|null=null;const tick=()=>{const next=player.current?.audibleSelection() as Loaded|null;if(next&&next!==last){last=next;setLoaded(next);setSide(player.current!.side);}raf=requestAnimationFrame(tick);};tick();return()=>cancelAnimationFrame(raf);},[active]);
 useEffect(()=>{if(views.current.has(`${pieceId}:${chip}`)){setOverview(views.current.get(`${pieceId}:${chip}`)!);return;}if(pieceId==='imported')return;const abort=new AbortController();fetch(`/arrangement-data/${pieceId}-${chip}-view.json`,{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('Score view unavailable');return r.json();}).then(view=>{views.current.set(`${pieceId}:${chip}`,view);setOverview(view);}).catch(()=>{});return()=>abort.abort();},[pieceId,chip]);
 const piece=pieceId==='imported'&&imported?{id:'imported',title:imported.title,source:imported.source!,notices:imported.notices,parts:imported.parts.map(p=>({...p,notes:p.notes.length})),cases:[]} as Piece:report?.pieces.find(p=>p.id===pieceId);
 const current=piece?.cases.find(row=>row.chip===chip);
 const ensure=()=>{
  if(!player.current){const context=new AudioContext(),transport=new BufferPlayback(context,()=>{if(alive.current)setAudio({playing:transport.playing,loading:transport.loading,error:transport.error});});player.current=transport;setSession(s=>s+1);}
  return player.current;
 };
 const interact=()=>{const transport=ensure();if(!interacted.current){interacted.current=true;void transport.toggle();}};
 const toggle=()=>{interacted.current=true;void ensure().toggle();};
 useEffect(()=>{if(!active)return;const key=(e:KeyboardEvent)=>{if(e.code==='Space'&&!e.repeat&&!(e.target instanceof Element&&e.target.closest('input,textarea,select,button,a,summary,[contenteditable]'))){e.preventDefault();toggle();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[active]);
 const change=(edit:()=>void)=>{
  generation.current++;worker.current?.terminate();player.current?.cancelSelection();
  importGeneration.current++;importer.current?.terminate();
  setImporting(false);setImportError('');edit();setSession(s=>s+1);
 };
 useEffect(()=>{
  if(!piece||!player.current||importing)return;
  const ticket=++generation.current,abort=new AbortController();worker.current?.terminate();worker.current=null;
  player.current.cancelSelection();
  setPreparing(true);setError('');setPreparation({title:piece.title,chip,phase:'planning',startedAt:Date.now()});
  const timer=setTimeout(()=>{void(async()=>{
   let row=current,entries:Entry[],view=views.current.get(`${pieceId}:${chip}`);
   if(row&&part==='mix'&&tempo===100&&transpose===0){
    entries=[{...row.asset,loopStartSeconds:row.loopStartSeconds}];
    if(piece.reference)entries.push({...piece.reference.asset,loopStartSeconds:row.loopStartSeconds});
   }else{
    const document=async(id:string)=>{if(documents.current.has(id))return documents.current.get(id)!;const response=await fetch(`/arrangement-data/${id}.json`,{signal:abort.signal});if(!response.ok)throw Error('Source arrangement unavailable');const doc=await response.json();documents.current.set(id,doc);return doc;};
    const score=pieceId==='imported'?imported!:await document(pieceId) as Performance;
    const native=pieceId==='mario'&&chip==='2a03'&&tempo===100&&transpose===0?await document('mario-native') as PerformancePlan:undefined;
    if(ticket!==generation.current)return;
    const active=new Worker('/arrangement-render.js');worker.current=active;
    const result=await new Promise<{overview:Overview;wav:ArrayBuffer;seconds:number;loopStartSeconds:number;losses:PerformanceLoss[];peak:number} >((resolve,reject)=>{
     active.onerror=()=>reject(Error('The audio renderer failed. Try a shorter MIDI.'));
     active.onmessage=({data})=>{
      if(ticket!==generation.current)return;
      if(data.type==='progress'){setPreparation(previous=>({...previous!,phase:data.phase,percent:data.percent,seconds:data.seconds}));return;}
      data.error?reject(Error(data.error)):resolve(data);
     };
     active.postMessage({id:ticket,score,native,chip,tempo,transpose,part});
    });
    active.terminate();if(ticket!==generation.current)return;view=result.overview;views.current.set(`${pieceId}:${chip}`,view);
    const file=URL.createObjectURL(new Blob([result.wav],{type:'audio/wav'}));urls.current.push(file);
    // Keep the current recording and a few recent variants; the transport has
    // decoded older buffers already. URLs never grow with slider movements.
    while(urls.current.length>8)URL.revokeObjectURL(urls.current.shift()!);
    entries=[{file,loopStartSeconds:result.loopStartSeconds,metrics:{rmsDbFS:0,samplePeakDbFS:0,envelope:[]}}];
    row={chip,seconds:result.seconds,loopStartSeconds:result.loopStartSeconds,losses:result.losses,mode:'adaptation',notes:0,asset:entries[0]};
   }
   if(!view){const response=await fetch(`/arrangement-data/${pieceId}-${chip}-view.json`,{signal:abort.signal});if(!response.ok)throw Error('Score view unavailable');view=await response.json();views.current.set(`${pieceId}:${chip}`,view!);}
   if(ticket!==generation.current)return;
   entries=entries.map(entry=>({...entry,loopFadeSeconds:.003}));
   setPreparation(previous=>({...previous!,phase:'decoding',percent:undefined}));
   const transport=player.current!;
   const presentation:Loaded={title:piece.title,chip,part,pieceId,overview:view!,omitted:row!.omitted,seconds:row!.seconds,losses:row!.losses,entries};
   if(await transport.select(entries,levels(entries),{restart:selectionId.current!==pieceId,side:0,presentation})&&ticket===generation.current){selectionId.current=pieceId;setOverview(view!);setPreparing(false);}
   else if(ticket===generation.current)setPreparing(false);
  })().catch(e=>{if(ticket===generation.current&&!abort.signal.aborted){setError(e.message);setPreparing(false);}});},180);
  return()=>{clearTimeout(timer);abort.abort();generation.current++;worker.current?.terminate();player.current?.cancelSelection();};
 },[pieceId,chip,part,tempo,transpose,session,report,imported,importing]); // Source changes commit together; the old audio keeps playing during preparation.
 const upload=async(file:File)=>{
  setImportError('');
  if(file.size>8*1024*1024){setImportError('Choose a MIDI smaller than 8 MiB.');return;}
  const ticket=++importGeneration.current;importer.current?.terminate();
  generation.current++;worker.current?.terminate();player.current?.cancelSelection();
  setImporting(true);setPreparing(true);setPreparation({title:file.name,phase:'importing',startedAt:Date.now()});interact();
  try{
   const midi=await file.arrayBuffer();if(ticket!==importGeneration.current||!alive.current)return;
   const active=new Worker('/arrangement-render.js');importer.current=active;
   const score=await new Promise<Performance>((resolve,reject)=>{active.onerror=()=>reject(Error('MIDI import failed'));active.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.score);active.postMessage({id:ticket,importOnly:true,midi,title:file.name.replace(/\.midi?$/i,'')},[midi]);});
   active.terminate();if(ticket!==importGeneration.current||!alive.current)return;
   change(()=>{selectionId.current='new-import';setImported(score);setPieceId('imported');setPart('mix');setTempo(100);setTranspose(0);});interact();
  }catch(e){if(ticket===importGeneration.current&&alive.current){importer.current?.terminate();setImporting(false);setPreparing(false);if(!loaded)player.current?.pause();setImportError(e instanceof Error?e.message:String(e));}}
 };
 const losses=loaded?.losses??current?.losses??[],omitted=loaded?(loaded.omitted??losses.filter(l=>l.kind==='voice-omitted').length):(current?.omitted??losses.filter(l=>l.kind==='voice-omitted').length);
 return <>{!embedded&&<SiteHeader/>}<main className="demo-main arrangements-main">
  <section className="arrangement-intro"><div><span className="micro">{t("OPEN-SOURCE SOUND-CHIP EMULATION")}</span><h1>{t("Old consoles.")}<br/><span>{t("New JavaScript.")}</span></h1></div><p>{t("We rebuilt their sound chips in JavaScript. Hear Mario, Zelda and Sonic with all their source parts. Switch consoles, follow the score, or bring your own MIDI.")}</p></section>
  {!piece&&!error&&<p role="status">{t("Loading complete arrangements…")}</p>}
  {piece&&<section className="console arrangement-deck" aria-label={t("Complete arrangement player")}>
   <div className="console-top"><span className="micro">{t("CHIPVOICE / FULL ARRANGEMENTS")}</span></div>
   <div className="arrangement-choices" aria-label={t("Complete compositions")}>{report?.pieces.map(p=><button key={p.id} aria-pressed={pieceId===p.id} onClick={()=>{change(()=>{setPieceId(p.id);setPart('mix');setTempo(100);setTranspose(0);});interact();}}>{t(p.title.split(' · ')[0])}<span>{p.parts.length}{t(" parts")}</span></button>)}<label className="arrangement-upload">{t("Import MIDI")}<input aria-label={t("Import MIDI")} type="file" accept=".mid,.midi,audio/midi" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/></label></div>
   <MachinePicker value={chip} onChange={next=>{change(()=>setChip(next));interact();}}/>
   <DisplayPanel><div className="screen-title"><div><span className="screen-kicker">{t(loaded?.chip.toUpperCase()??chip.toUpperCase())} / {t(loaded?.part==='mix'||!loaded?'FULL MIX':'ISOLATED PART')}</span><h2>{(loaded?.pieceId??pieceId)==='imported'?(loaded?.title??piece.title):t(loaded?.title??piece.title)}</h2></div><span>{t(loaded||current||preparation?.seconds?`${(loaded?.seconds??current?.seconds??preparation!.seconds!).toFixed(1)} SEC`:'AUDIO PENDING')}</span></div>
    <Transport translateParts={(loaded?.pieceId??pieceId)!=='imported'} playControl={<PlayButton pause playing={audio.playing} loading={pending} onClick={toggle}/>} player={player.current} overview={loaded?.overview??overview} seconds={loaded?.seconds??current?.seconds??overview?.seconds??0} part={loaded?.part??'mix'} pending={pending} active={active} onLoop={loop=>{ensure().setLoop(loop);interact();}}/>
    {pending&&preparation?<section className="arrangement-preparation" aria-label={t("Audio preparation")} aria-busy="true">
     <p role="status">{t(phaseLabels[preparation.phase])}{t(preparation.chip&&` · ${t(DEMO_MACHINES.find(m=>m.id===preparation.chip)?.name)}`)}<strong>{preparation.phase==='importing'||pieceId==='imported'?preparation.title:t(preparation.title)}</strong></p>
     <div className={`render-progress ${preparation.percent===undefined?'indeterminate':''}`} role="progressbar" aria-label={t("Audio rendering progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={preparation.percent}><span style={preparation.percent===undefined?undefined:{width:`${preparation.percent}%`}}/></div>
     <div className="render-progress-caption"><span>{t(preparation.percent===undefined?'Working…':`${preparation.percent}% rendered`)}</span><span>{Math.max(0,Math.floor((now-preparation.startedAt)/1000))}{t(" s elapsed")}</span></div>
     <p>{t(loaded&&audio.playing?'The current music keeps playing.':audio.playing?'Playback starts automatically when ready.':'Playback is paused. Press Play to listen when ready.')}</p>
    </section>:<p>{t(audio.playing?'Playing continuously · explore another sound.':'Press Play or tap a console to start.')}</p>}

   </DisplayPanel>
   <div className="arrangement-controls"><RangeControl id="arrangement-tempo" label={t("Tempo")} unit="%" min={40} max={200} value={tempo} onChange={value=>{change(()=>setTempo(value));interact();}}/><RangeControl id="arrangement-transpose" label={t("Transpose")} unit={t("st")} min={-24} max={24} value={transpose} onChange={value=>{change(()=>setTranspose(value));interact();}}/></div>
   <div className="arrangement-versions" aria-label={t("Compare recordings")}><Button disabled={!loaded||pending} aria-pressed={side===0} onClick={()=>{setSide(0);player.current?.setSide(0);}}>{t("Our ")}{t(chip==='2a03'&&pieceId==='mario'&&tempo===100&&transpose===0?'native rendering':'adaptation')}</Button><Button disabled={!loaded||loaded.entries.length<2||pending} aria-pressed={side===1} onClick={()=>{setSide(1);player.current?.setSide(1);}}>{t("Independent original reference")}</Button>{loaded&&<a href={loaded.entries[side]?.file} download>{t("Download audio ↓")}</a>}</div>
   <div className="arrangement-parts" aria-label={t("Isolate instruments")}><button aria-pressed={part==='mix'} onClick={()=>{change(()=>setPart('mix'));interact();}}>{t("Full mix")}</button>{piece.parts.filter(p=>p.notes>0).map(p=><button key={p.id} aria-pressed={part===p.id} onClick={()=>{change(()=>setPart(p.id));interact();}}><strong>{pieceId==='imported'?p.name:t(p.name)}</strong><span>{t(p.id.match(/-ch-(\d+)$/)?`Ch. ${p.id.match(/-ch-(\d+)$/)![1]} · `:'')}{p.notes}{t(" source notes")}</span></button>)}</div>
  </section>}
  {t(importError&&<p className="ui-status ui-error" role="alert">{errorText(importError)}{t(" Choose another MIDI file to try again.")}</p>)}
  {t((error||audio.error)&&<p className="ui-status ui-error" role="alert">{errorText(error||audio.error)} <Button onClick={()=>setSession(s=>s+1)}>{t("Retry rendering")}</Button></p>)}
  {piece&&<div className="arrangement-evidence"><section><span className="micro">{t("WHAT IS VERIFIED?")}</span><h2>{t(piece.source.kind==='native'?'The original commands.':'Every source part.')}</h2><p>{t(piece.source.kind==='native'?'Mario’s 41,999 music commands match an independent NSF emulator, including their exact cycle timing. The native Famicom rendering keeps the game’s settings. Other consoles use adapted instruments.':'Notes, velocities, programs and exact MIDI timing are preserved in the source arrangement. This is a complete transcription; its instruments have not been verified against the original game.')}</p><p>{t(piece.source.description??'Your MIDI stays in this browser. No file is uploaded.')}</p>{t(piece.source.url&&<a href={piece.source.url} target="_blank" rel="noreferrer">{t("Source & credits ↗")}</a>)}</section>
   <section><span className="micro">{t("THE COST OF A PORT")}</span><h2>{t(pending?'Checking this adaptation…':omitted?`${omitted} notes omitted.`:'No voice omissions.')}</h2><p>{t(pending?'Voice limits and instrument choices will appear when preparation finishes.':omitted?'This console has fewer available voices. Higher-priority melody and bass parts reserve them first. The source is kept intact; the omissions belong to this adaptation.':'No extra bass, chords or drums are invented. Only parts present in the source are played.')}</p>{!pending&&<details><summary>{t("Instrument choices & limitations")}</summary><ul>{[...new Set(losses.filter(l=>l.kind!=='voice-omitted').map(l=>l.detail)),...piece.notices].map(text=><li key={text}>{t(text)}</li>)}</ul></details>}<p>{t("Recordings compare at matched levels. MIDI imports and edits render locally in a worker. Audio comparisons are listening evidence, not a universal fidelity score.")}</p></section>
  </div>}
  <div className="arrangement-links"><Link href="/lab">{t("Engine listening tests →")}</Link>{pieceId!=='imported'&&<a href={`/arrangement-data/${pieceId}.json`} download>{t("Source arrangement JSON ↓")}</a>}<a href="/arrangement-data/report.json" download>{t("Evidence & porting reports ↓")}</a><a href="https://github.com/gwendall/chipvoice/blob/main/scores/arrangements/README.md">{t("Reproduce the method ↗")}</a></div>
 </main>{!embedded&&<SiteFooter/>}</>;
}
