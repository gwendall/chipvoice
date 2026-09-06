'use client';
import {useErrorText, useT} from '@/i18n/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import Link from '@/i18n/react';
import {SiteHeader, SiteFooter, MachinePicker, PlayButton, Button, DisplayPanel} from '../ui/components';
import {BufferPlayback} from '../audio/BufferPlayback.mjs';
import {listeningLevels} from '../../../../packages/conform/src/listening/levels.mjs';
import type {ChipId} from '../studio/document';
import type {Asset, Case, Report} from './types';
import './style.css';
import '../arrangements/style.css';

const roles: Record<string,string> = {mix:'Full mix',lead:'Melody',chord:'Chords',bass:'Bass',perc:'Drums'};
const number = (value: number | null | undefined) => Number.isFinite(value) ? value!.toFixed(1) : '—';
type Selection = {row: Case; role: string; reference: string; entries: (Asset & {title: string})[]};
export default function Lab() {
 const t = useT();
 const errorText = useErrorText();
 const [report,setReport]=useState<Report|null>(null),[reportError,setReportError]=useState('');
 const [caseId,setCaseId]=useState('mario-snes'),[role,setRole]=useState('mix'),[reference,setReference]=useState('none');
 const [audio,setAudio]=useState({playing:false,loading:false,error:''});
 const [loaded,setLoaded]=useState<Selection|null>(null),[volume,setVolume]=useState(.7);
 const [mapping,setMapping]=useState([0,1]),[side,setSide]=useState(0),[hidden,setHidden]=useState(false);
 const [notes,setNotes]=useState(''),[preference,setPreference]=useState('unsure'),[observations,setObservations]=useState<object[]>([]);
 const player=useRef<BufferPlayback|null>(null);
 const alive=useRef(true);
 useEffect(()=>{
  const abort=new AbortController();alive.current=true;
  fetch('/lab-data/report.json',{signal:abort.signal}).then(response=>{if(!response.ok)throw new Error('The listening collection could not load. Reload to try again.');return response.json();}).then(setReport).catch(error=>{if(!abort.signal.aborted)setReportError(error.message);});
  return()=>{alive.current=false;abort.abort();const active=player.current;player.current=null;active?.dispose();void active?.context.close();};
 },[]);
 const selection=useMemo<Selection|null>(()=>{
  const row=report?.cases.find(item=>item.id===caseId)??report?.cases[0];if(!row)return null;
  const selectedRole=row.assets[role]&&(!row.fidelity||role==='mix'||role==='lead')?role:'mix';
  const selectedReference=reference==='native'&&selectedRole==='mix'&&row.assets.native?'native':reference==='baseline'&&row.baseline?.[selectedRole]?'baseline':'none';
  const entries=[{...row.assets[selectedRole],title:'Current version'}];
  if(selectedReference==='baseline')entries.push({...row.baseline![selectedRole],title:'Previous version'});
  if(selectedReference==='native')entries.push({...row.assets.native,title:'Native SNES DSP'});
  return {row,role:selectedRole,reference:selectedReference,entries};
 },[report,caseId,role,reference]);
 const load=async (next: Selection, transport: BufferPlayback)=>{
  const levels=listeningLevels(next.entries);
  if(await transport.select(next.entries,levels.gains)){
   if(!alive.current)return;
   setLoaded(next);setMapping([0,1]);setSide(0);setHidden(false);transport.setSide(0);
  }
 };
 useEffect(()=>{if(selection&&player.current)void load(selection,player.current);},[selection]);
 const toggle=()=>{
  if(!selection)return;
  if(!player.current){
   const context=new AudioContext();
   const transport=new BufferPlayback(context,()=>{if(alive.current)setAudio({playing:transport.playing,loading:transport.loading,error:transport.error});});
   transport.setVolume(volume);player.current=transport;void load(selection,transport);
  }
  if(player.current.error&&!player.current.playing)void load(selection,player.current);
  void player.current.toggle();
 };
 const display=loaded??selection;
 const switchSide=(next: number)=>{setSide(next);player.current?.setSide(mapping[next]);};
 const blind=()=>{const next=crypto.getRandomValues(new Uint8Array(1))[0]&1?[1,0]:[0,1];setMapping(next);setHidden(true);setSide(0);player.current?.setSide(next[0]);};
 const exportNotes=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(observations,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='chipvoice-listening-notes.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const pending=audio.loading || !!loaded&&selection!==loaded&&!audio.error;
 const save=()=>{
  if(!display||!report||pending)return;
  setObservations(items=>[...items,{at:new Date().toISOString(),revision:report.revision,engineSha256:report.engineSha256,case:display.row.id,role:display.role,reference:display.reference,blind:hidden,mapping:mapping.slice(0,display.entries.length).map(index=>({file:display.entries[index].file,sha256:display.entries[index].sha256})),level:listeningLevels(display.entries),preference,notes}]);setNotes('');setPreference('unsure');
 };
 return <><SiteHeader active="lab"/><main className="demo-main lab-main">
  <div className="lab-intro"><div><span className="micro">{t("THE LISTENING ROOM")}</span><h1>{t("Same notes.")}<br/><span>{t("Different machines.")}</span></h1><p>{t("Compare familiar melodies on emulated sound chips. These lossless recordings let you isolate parts and hear precisely what changes.")}</p></div><div className="lab-intro-note"><span className="status-light active"/>{t(" FOUR CONSOLES / ONE SCORE")}<br/><span>{t("Press play once. Keep exploring.")}</span></div></div>
  <Link href="/" className="full-arrangement-link"><span><strong>{t("The whole arrangement, with every source part.")}</strong>{t("Mario’s native reference, complete MIDI transcriptions and console portages.")}</span><span aria-hidden="true">↗</span></Link>
  {t(reportError&&<p className="ui-status ui-error" role="alert">{errorText(reportError)}</p>)}
  {!selection&&!reportError&&<p role="status">{t("Loading the listening collection…")}</p>}
  {selection&&display&&<>
   <section className="console lab-console" aria-label={t("Listening lab")}>
    <div className="console-top"><span className="micro">{t("CHIPVOICE / COMPARISON DECK")}</span><span className="hardware-label">{t("LISTEN · ISOLATE · COMPARE")}</span></div>
    <MachinePicker value={selection.row.chip as ChipId} onChange={chip=>setCaseId(report!.cases.find(item=>item.chip===chip&&item.preset===selection.row.preset)!.id)}/>
    <div className="lab-filters"><label className="ui-select">{t("COMPOSITION")}<select aria-label={t("Composition")} value={selection.row.preset} onChange={event=>setCaseId(report!.cases.find(item=>item.preset===event.target.value&&item.chip===selection.row.chip)!.id)}>{report!.cases.filter(item=>item.chip===selection.row.chip).sort((a,b)=>Number(!!b.fidelity)-Number(!!a.fidelity)).map(item=><option key={item.preset} value={item.preset}>{t(item.title)}</option>)}</select></label><label className="ui-select">{t("LISTEN TO")}<select aria-label={t("Part")} value={selection.role} onChange={event=>setRole(event.target.value)}>{Object.keys(roles).filter(key=>selection.row.assets[key]&&(!selection.row.fidelity||key==='mix'||key==='lead')).map(key=><option key={key} value={key}>{t(roles[key])}</option>)}</select></label><label className="ui-select">{t("COMPARE WITH")}<select aria-label={t("Reference")} value={selection.reference} onChange={event=>setReference(event.target.value)}><option value="none">{t("Current version only")}</option>{selection.row.baseline?.[selection.role]&&<option value="baseline">{t("Previous version")}</option>}{selection.role==='mix'&&selection.row.assets.native&&<option value="native">{t("Native SNES DSP")}</option>}</select></label></div>
    <DisplayPanel className="lab-display"><div className="screen-title"><div><span className="screen-kicker">{t(hidden?'IDENTITIES HIDDEN':`${display.row.chip.toUpperCase()} / ${t(roles[display.role]).toUpperCase()}`)}</span><h2>{t(display.row.title)}</h2></div><span className="lab-loop">{t(display.row.seconds.toFixed(2))}{t(" SEC LOOP")}</span></div>
     <div className="lab-wave" aria-hidden="true">{!hidden&&display.entries[0].metrics.envelope.map((value,index)=><i key={index} style={{height:`${Math.max(2,value*100)}%`}}/>)}</div>
     <div className="lab-identities">{t(hidden?'Identities hidden. Listen before you reveal.':mapping.slice(0,display.entries.length).map((index,i)=>`${i?'B':'A'} · ${t(display.entries[index].title)}`).join('   /   '))}</div>
    </DisplayPanel>
    <div className="transport-row lab-transport"><PlayButton playing={audio.playing} loading={audio.loading} onClick={toggle}/><div className="lab-sides" aria-label={t("Audible version")}><Button aria-label={t("Listen to A")} aria-pressed={side===0} onClick={()=>switchSide(0)} disabled={!loaded||pending}>{t("A")}</Button><Button aria-label={t("Listen to B")} aria-pressed={side===1} onClick={()=>switchSide(1)} disabled={!loaded||pending||display.entries.length<2}>{t("B")}</Button></div><label className="lab-volume">{t("VOLUME")}<input aria-label={t("Listening volume")} type="range" min="0" max="1" step=".01" value={volume} onChange={event=>{const next=Number(event.target.value);setVolume(next);player.current?.setVolume(next);}}/></label><Button disabled={!loaded||pending||display.entries.length<2} onClick={hidden?()=>setHidden(false):blind}>{t(hidden?'Reveal identities':'Hide & shuffle')}</Button></div>
    <p className={`ui-status ${audio.error?'ui-error':''}`} role="status">{audio.error?errorText(audio.error):t((audio.loading?(audio.playing?'Preparing the next sound. Playback continues.':'Preparing the next sound…'):audio.playing?'Playing continuously · levels matched for comparison.':'Ready when you are. No audio starts until you press Play.'))}</p>
    {t(audio.error&&<Button onClick={()=>{if(player.current)void load(selection,player.current);}}>{t("Retry loading")}</Button>)}
    <div className="console-bottom"><span>{t("SYNCHRONIZED A/B · LOSSLESS AUDIO")}</span><span>{t("TRUST YOUR EARS")}</span></div>
   </section>
   {display.row.source&&<details className="cartridge-source"><summary>{t("About this arrangement · credits & source")}</summary><p>{t(display.row.adaptation)}</p>{display.row.fidelity?.pass&&<p className="source-check">{display.row.fidelity.referenceNotes}{t(" source notes checked · melody only · no added backing parts")}</p>}<p>{t("Music by ")}{t(display.row.composer)}{t(". Reference: ")}{t(display.row.source.transcriber)}. {t(display.row.source.excerpt)}.</p><a href={display.row.source.url} target="_blank" rel="noreferrer">{t("View the source transcription ↗")}</a></details>}
   <div className="lab-below"><section className="lab-notes" aria-labelledby="notes-heading"><span className="micro">{t("YOUR LISTENING NOTES")}</span><h2 id="notes-heading">{t("What do you hear?")}</h2><p>{t("Describe an instrument, a moment, or a feeling. Your notes stay in this tab until you download them.")}</p><label htmlFor="listening-notes" className="sr-only">{t("Listening notes")}</label><textarea id="listening-notes" value={notes} onChange={event=>setNotes(event.target.value)} placeholder={t("The bass feels warmer. The attack at 1.2 seconds sounds sharper…")}/><div className="lab-note-actions"><label className="ui-select">{t("PREFERENCE")}<select aria-label={t("Preference")} value={preference} onChange={event=>setPreference(event.target.value)}><option value="unsure">{t("Undecided")}</option><option>{t("A")}</option><option>{t("B")}</option><option value="same">{t("No difference heard")}</option></select></label><Button onClick={save} disabled={pending||!notes.trim()}>{t("Save note")}</Button><Button onClick={exportNotes} disabled={!observations.length}>{t('Download notes ({count})',{count:observations.length})}</Button></div></section>
    <section className="lab-evidence" aria-labelledby="evidence-heading"><span className="micro">{t("BEHIND THE SOUND")}</span><h2 id="evidence-heading">{t("Measured. Then heard.")}</h2><p>{t("These recordings are a versioned evaluation snapshot. A technical pass checks the engine; it cannot tell you which music you prefer.")}</p><div className="lab-checks"><span>{t("Register replay ")}<strong>{t(display.row.replay.ok?'Exact':'Difference')}</strong></span>{display.row.oracle&&<><span>{t("Native SNES DSP ")}<strong>{t(display.row.oracle.ok?'Exact':'Difference')}</strong></span><span>{t("Dry / echo-input clipping ")}<strong>{display.row.oracle.mixer.mainClampedAdditions} / {display.row.oracle.mixer.echoClampedAdditions}</strong></span></>}</div>
    {!hidden&&<div className="lab-table-wrap"><table><caption className="sr-only">{t("Raw recording measurements and downloads")}</caption><thead><tr><th>{t("Recording")}</th><th>{t("LUFS")}</th><th>{t("Peak dBTP")}</th><th>{t("Audio")}</th></tr></thead><tbody>{display.entries.map(entry=><tr key={entry.title}><th>{t(entry.title)}</th><td>{t(number(entry.loudness?.integratedLUFS))}</td><td>{t(number(entry.loudness?.truePeakDbTP))}</td><td><a href={entry.file} download>{t("FLAC ↓")}</a></td></tr>)}</tbody></table></div>}
    <p className="lab-fine">{t("Listening levels are matched; downloads preserve the original audio. The native reference uses the same score and samples at 32 kHz, before our output filter. It is not a game soundtrack or a physical console recording.")}</p><div className="lab-provenance"><a href="/lab-data/report.json" download>{t("Full evidence & checksums ↓")}</a><a href={`https://github.com/gwendall/chipvoice/tree/${report!.revision}`}>{t("Engine ")}{t(report!.revision.slice(0,7))} ↗</a></div></section></div>
   <div className="lab-next"><p>{t("Found your favourite machine? Make something with it.")}</p><Link href="/" className="small-button">{t("Open the playground →")}</Link><Link href="/lab/components">{t("Shared components")}</Link></div>
  </>}
 </main><SiteFooter/></>;
}
