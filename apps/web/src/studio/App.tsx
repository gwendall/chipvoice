'use client';
import {useErrorText, useI18n, useT} from '@/i18n/react';
import type {CSSProperties} from 'react';
import Link from '@/i18n/react';
import {localePath} from '@/i18n/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Role } from 'chipvoice';
import { useSongDocument } from './useSongDocument';
import { useDemoAudio } from './useDemoAudio';
import { MACHINES, ROLE_NAMES, ROLES, encodeDocument, type SongDocument } from './document';
import { PRESETS, ORIGINAL_PRESETS, CLASSIC_PRESETS, type Preset } from './presets';
import { EFFECTS } from './effects';
import { Voices, OutputScope } from './Voices';
import { Editor, palette } from './Editor';
import { CodePanel } from './CodePanel';
import { measure } from './metrics';
import { recordStep } from './recording';
import { CompositionControls } from './CompositionControls';
import { Variations } from './Variations';
import { publicationBody } from './publication';
import { Account } from './Account';
import { MidiInput } from './MidiInput';
import {RangeControl} from '../ui/RangeControl';
import {SiteHeader, SiteFooter, MachinePicker, PlayButton} from '../ui/components';
import '../arrangements/style.css';

export default function App({ initial, initialId, embedded=false }: { initial?: SongDocument; initialId?: string; embedded?:boolean }) {
 const t = useT();
 const errorText = useErrorText();
 const {locale} = useI18n();
  const doc = useSongDocument(initial, initialId);
  const [muted, setMuted] = useState<Role[]>([]);
  const [solo, setSolo] = useState<Role | null>(null);
  const effectiveMuted = useMemo(() => solo ? ROLES.filter(r => r !== solo) : muted, [solo, muted]);
  const [recording, setRecording] = useState(false);
  const [recordStarting, setRecordStarting] = useState(false);
  const [recorded, setRecorded] = useState(0);
  const take = useRef<string | null>(null);
  const backingSong = useRef<SongDocument | null>(null);
  const recordLocked = recording || recordStarting;
  const recordRequest = useRef(0);
  const audio = useDemoAudio(doc.song, effectiveMuted, recording);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [role, setRole] = useState<Role>('lead');
  const [chromatic, setChromatic] = useState(false);
  const [musicalKey, setMusicalKey] = useState('C');
  const [notice, setNotice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ id: string; snapshot: string } | null>(initialId ? { id: initialId, snapshot: JSON.stringify(initial) } : null);
  const sourcePreset = PRESETS.find(preset => preset.song.title === doc.song.title && preset.source);
  const matchesSource = useMemo(() => !!sourcePreset && (doc.song.stepsPerBeat ?? 4) === (sourcePreset.song.stepsPerBeat ?? 4) && JSON.stringify([doc.song.patterns, doc.song.order]) === JSON.stringify([sourcePreset.song.patterns, sourcePreset.song.order]), [sourcePreset, doc.song.patterns, doc.song.order, doc.song.stepsPerBeat]);
  const machine = MACHINES.find(m => m.id === doc.song.chip)!;
  const notes = palette(role, chromatic, musicalKey);
  const keyboard = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];
  const edit = useCallback((next: SongDocument) => { doc.edit(next); measure('edit'); }, [doc.edit]);
  const say = useCallback((message: string) => setNotice(message), []);
  const finishTake = useCallback(() => {
    recordRequest.current++;
    take.current = null;
    setRecording(false); setRecordStarting(false);
  }, []);
  const toggleRecording = async () => {
    if (take.current) { finishTake(); say('Take saved. Undo removes the whole take.'); return; }
    const request = ++recordRequest.current;
    setRecordStarting(true);
    const chip = await audio.start();
    if (request !== recordRequest.current) return;
    setRecordStarting(false);
    if (!chip) return;
    take.current = `take:${request}`;
    backingSong.current = doc.song;
    setRecorded(0); setRecording(true); setEditing(false);
    say('Tap notes or drums. Finish the take to hear your new loop.'); measure('record');
  };
  const playNote = useCallback((voice: Role, note: string) => {
    if (take.current) {
      // Capture synchronously, before audio resume work or React rendering.
      const position = audio.recordingPosition();
      if (position) {
        doc.edit(song => recordStep(song, voice, note, position), take.current);
        setRecorded(count => count + 1);
      }
    }
    void audio.preview(voice, note);
  }, [audio.preview, audio.recordingPosition, doc.edit]);
  const togglePlayback = useCallback(() => { finishTake(); void audio.toggle(); }, [finishTake, audio.toggle]);
  const undo = useCallback(() => { finishTake(); doc.undo(); }, [finishTake, doc.undo]);
  const redo = useCallback(() => { finishTake(); doc.redo(); }, [finishTake, doc.redo]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) finishTake(); };
    window.addEventListener('blur', finishTake); document.addEventListener('visibilitychange', hidden);
    return () => { recordRequest.current++; take.current = null; window.removeEventListener('blur', finishTake); document.removeEventListener('visibilitychange', hidden); };
  }, [finishTake]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.code === 'Space') { if (event.target instanceof HTMLButtonElement) return; event.preventDefault(); togglePlayback(); return; }
      const fx = EFFECTS.find(f => f.key === event.key);
      if (fx) { event.preventDefault(); void audio.fire(fx.id); return; }
      const index = keyboard.indexOf(event.key.toLowerCase());
      if (index >= 0 && notes[index]) { event.preventDefault(); playNote(role, notes[index]); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [togglePlayback, audio.fire, playNote, notes.join(','), role, undo, redo]);
  const copyDraft = async () => {
    const link = `${location.origin}${localePath('/',locale)}#${encodeDocument(doc.song)}`;
    try { await navigator.clipboard.writeText(link); say('Draft link copied. It contains your complete score.'); }
    catch { history.replaceState(null, '', `${localePath('/',locale)}#${encodeDocument(doc.song)}`); say('Your draft link is in the address bar.'); }
    measure('share');
  };
  const publish = async () => {
    if (publishing) return;
    if (published?.snapshot === JSON.stringify(doc.song)) { say('This version is already published.'); return; }
    setPublishing(true);
    try {
      const response = await fetch(published ? `/api/songs/${published.id}/fork` : '/api/songs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(publicationBody(doc.song, published ? JSON.parse(published.snapshot) : undefined)) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.issues?.[0]?.message ?? result.message ?? 'Could not publish. Your local draft is safe.');
      setPublished({ id: result.id, snapshot: JSON.stringify(doc.song) });
      say('Published. Your permanent link and MP3 are ready below.'); measure('share');
    } catch (error) { say(error instanceof Error ? error.message : 'Could not reach the server. Your draft is safe.'); }
    finally { setPublishing(false); }
  };

  const loadPreset = (preset: Preset) => {
    const next = { ...structuredClone(preset.song), chip: doc.song.chip };
    edit(next); setMuted([]); setSolo(null);
    setMusicalKey(preset.id === 'boss' ? 'E' : preset.id === 'midnight' ? 'A' : preset.id === 'zelda' ? 'Bb' : 'C');
    audio.startOnInteraction(next, []); measure('preset');
  };
  return <div className="demo-page">
    {!embedded&&<SiteHeader />}
    <main className="demo-main">
      <section className="playground-intro" aria-labelledby="intro-title">
        <div><span className="micro">{t("OPEN-SOURCE SOUND-CHIP EMULATION")}</span><h1 id="intro-title">{t("Old consoles.")}<br/><span>{t("New JavaScript.")}</span></h1></div>
        <div className="intro-copy"><p>{t("We rebuilt their sound chips in JavaScript. Hear familiar melodies come alive on different consoles, with every note generated in your browser.")}</p><Link href="/about">{t("How it works ")}<span aria-hidden="true">↗</span></Link></div>
      </section>
      <section className="console" aria-label={t("Chipvoice musical console")} onClick={event => {
        if (doc.ready && !(event.target instanceof Element && event.target.closest('a, input[type="number"], textarea, select'))) audio.startOnInteraction();
      }}>
        <div className="tune-heading"><div><span className="micro">{t("01 / PICK A MELODY")}</span><span className="start-hint">{t(audio.playing ? 'Switch sounds. Keep the melody going.' : audio.hasInteracted ? 'Press Play when you’re ready.' : 'Tap a melody or console to start the sound.')}</span></div><PlayButton playing={audio.playing} loading={audio.loading} shortcut onClick={togglePlayback}/></div>
        <div className="familiar-tunes" aria-label={t("Familiar melodies")}>{CLASSIC_PRESETS.map(preset => <button key={preset.id} className={`familiar-tune ${preset.id}`} disabled={recordLocked || !doc.ready} style={{'--tune-color':preset.color} as CSSProperties} aria-label={t(`Load ${preset.title}`)} aria-pressed={doc.song.title === preset.song.title} onClick={() => loadPreset(preset)}><span className="tune-icon" aria-hidden="true">{t(preset.id === 'mario' ? 'M' : preset.id === 'zelda' ? 'Z' : 'S')}</span><span><strong>{t(preset.id === 'mario' ? 'Mario' : preset.id === 'zelda' ? 'Zelda' : 'Sonic')}</strong><small>{t(preset.id === 'mario' ? 'Ground Theme' : preset.id === 'zelda' ? 'Overworld' : 'Green Hill Zone')}</small></span><span className="tune-play" aria-hidden="true">{t(doc.song.title === preset.song.title ? '●' : '▶')}</span></button>)}</div>
        <details className="original-tunes"><summary>{t("More to play · original loops")}</summary><div className="cartridge-list">{ORIGINAL_PRESETS.map(preset => <button key={preset.id} disabled={recordLocked || !doc.ready} className={`cartridge ${preset.id}`} aria-pressed={doc.song.title === preset.song.title} aria-label={t(`Load ${preset.title}`)} onClick={() => loadPreset(preset)}><span className="cartridge-copy"><strong>{t(preset.title)}</strong><span>{t(preset.mood)}</span></span></button>)}</div></details>
        <div className="console-top"><span className="micro">{t("02 / CHANGE THE SOUND")}</span><span className="micro hardware-label">{t("FOUR CONSOLES / ONE MELODY")}</span></div>
        <MachinePicker value={doc.song.chip} disabled={recordLocked || !doc.ready} onChange={chip => { const next = {...doc.song, chip}; edit(next); audio.startOnInteraction(next); measure('switch'); }} />
        <div className="screen-bezel"><div className="screen-title"><div><span className="screen-kicker">{t(machine.chip)}</span><h2>{doc.song.title ? (PRESETS.some(preset=>preset.song.title===doc.song.title)?t(doc.song.title):doc.song.title) : t('Untitled adventure')}</h2></div><OutputScope node={audio.output}/></div><Voices disabled={recordLocked} song={recording && backingSong.current ? backingSong.current : doc.song} position={audio.position} stolen={audio.stolen} muted={effectiveMuted} solo={solo} onMute={r => { const next = muted.includes(r) ? muted.filter(v => v !== r) : [...muted, r]; setMuted(next); audio.startOnInteraction(doc.song, solo ? effectiveMuted : next); }} onSolo={r => { const next = solo === r ? null : r; setSolo(next); audio.startOnInteraction(doc.song, next ? ROLES.filter(v => v !== next) : muted); }} effect={audio.effect}/></div>
        <div className="transport-row">
          <RangeControl id="tempo" label={t("Tempo")} unit={t("BPM")} min={40} max={300} value={doc.song.bpm} disabled={recordLocked || !doc.ready} onChange={(bpm, group) => { doc.edit(song => ({...song, bpm}), group); audio.startOnInteraction({...doc.song, bpm}); measure('edit'); }}/>
          <div className="history-controls"><button aria-label={t("Undo")} disabled={!doc.canUndo} onClick={undo}>↶</button><button aria-label={t("Redo")} disabled={!doc.canRedo} onClick={redo}>↷</button></div>
          <button className="edit-toggle" disabled={recordLocked} aria-expanded={editing} onClick={() => setEditing(!editing)}>{t(editing ? 'Close editor' : 'Edit loop')} <span aria-hidden="true">{t(editing ? '−' : '+')}</span></button>
        </div>
        <div className="arcade-header"><span className="micro">{t("A LITTLE INTERRUPTION")}</span><p>{t("Try a sound effect. Watch it borrow a voice.")}</p></div>
        <div className="arcade-pads">{EFFECTS.map(fx => <button key={fx.id} className={`arcade-pad ${fx.id}`} onClick={() => void audio.fire(fx.id)} aria-label={t(fx.name)}><span className="pad-symbol" aria-hidden="true">{t(fx.symbol)}</span><span className="pad-name">{t(fx.name)}</span><kbd>{t(fx.key)}</kbd></button>)}</div>
        <div className="console-bottom"><span>{t("EMULATED CHIPS. REAL CONSTRAINTS.")}</span><span className="screw" aria-hidden="true">⊕</span><span>{t("MADE TO BE PLAYED")}</span></div>
      </section>
      <section className="arrangement-details" aria-label={t("Arrangement sources")}>
        {sourcePreset?.source&&<details className="cartridge-source"><summary>{t("About this arrangement · credits & source")}</summary><p>{t(sourcePreset.adaptation)}</p>{sourcePreset.fidelity?.pass&&<p className="source-check">{t(matchesSource ? `${sourcePreset.fidelity.referenceNotes} source notes checked · pitches, rhythm and rests · all five machines` : 'Edited version · source checks apply to the original cartridge.')}</p>}<p>{t("Music by ")}{t(sourcePreset.composer)}{t(". Reference transcription: ")}{t(sourcePreset.source.transcriber)}. {t(sourcePreset.source.excerpt)}.</p><a href={sourcePreset.source.url} target="_blank" rel="noreferrer">{t("View the source transcription ↗")}</a></details>}
      </section>
      <CompositionControls song={doc.song} disabled={recordLocked || !doc.ready} onEdit={(song,group)=>{doc.edit(song,group);measure('edit');}}/>
      <section className="keyboard-section" aria-label={t("Play notes")}><div className="keyboard-heading"><div><span className="micro">{t("PLAY A LITTLE")}</span><h2>{t("Your turn.")}</h2></div><div className="keyboard-options"><label className="sr-only" htmlFor="audition-role">{t("Audition role")}</label><select id="audition-role" value={role} onChange={e => setRole(e.target.value as Role)}>{ROLES.map(r => <option key={r} value={r}>{t(ROLE_NAMES[r])}</option>)}</select><label className="sr-only" htmlFor="musical-key">{t("Musical key")}</label><select id="musical-key" value={musicalKey} onChange={e => setMusicalKey(e.target.value)}><option value="C">{t("C major")}</option><option value="Bb">{t("B♭ major")}</option><option value="A">{t("A minor")}</option><option value="E">{t("E minor")}</option></select><button className="small-button" aria-pressed={chromatic} onClick={() => setChromatic(!chromatic)}>{t("Chromatic")}</button></div></div><div className="recording-controls"><button className="record-button" disabled={recordStarting} aria-pressed={recording} onClick={() => void toggleRecording()}><span aria-hidden="true">{t(recording ? '■' : '●')}</span> {t(recordStarting ? 'Starting…' : recording ? 'Finish take' : 'Record notes')}</button>{!recordLocked && doc.group?.startsWith('take:') && <button className="small-button" onClick={undo}>{t("Undo take")}</button>}<span className="take-status" role="status">{t(recording ? `${t(audio.position ? `${recorded} ${recorded === 1 ? 'tap' : 'taps'} captured` : 'Waiting for the first beat…')} · 1/${(doc.song.stepsPerBeat ?? 4) * 4}` : 'Overdub notes and drums · one Undo per take')}</span></div><div className={`note-keys ${role}`}>{notes.map((note, i) => <button key={note} onPointerDown={e => { if (e.button === 0) playNote(role, note); }} onClick={e => { if (e.detail === 0) playNote(role, note); }} aria-label={t(`Play ${note}`)}><span>{t(role === 'perc' ? ({ K: 'Kick', S: 'Snare', H: 'Hat', O: 'Open' }[note]) : note)}</span>{t(keyboard[i] && <kbd>{t(keyboard[i])}</kbd>)}</button>)}</div><p className="keyboard-hint">{t(recording ? 'Taps snap to the nearest step. Finish to hear the new loop. Untouched steps stay as they were.' : 'Use the keys or tap a note. You’re playing on the same chip as the music.')}</p></section>
      <MidiInput role={role} onNote={playNote}/>
      <Variations song={doc.song} disabled={recordLocked} onEdit={edit} onNotice={say}/>
      {editing && !recordLocked && <Editor undo={undo} redo={redo} canUndo={doc.canUndo} canRedo={doc.canRedo} song={doc.song} onEdit={edit} role={role} onRole={setRole} onPreview={(r, n) => void audio.preview(r, n)} chromatic={chromatic} musicalKey={musicalKey}/>}
      <div className="takeaway"><div><h2>{t("Keep the good bits.")}</h2><p>{t(doc.recovered ? 'Your last draft is back. Keep playing.' : 'Make a little music. Put it in something you love.')}</p></div><div><button className="small-button" aria-expanded={code} onClick={() => setCode(!code)}>〈/〉 {t(code ? 'Hide code' : 'View code')}</button><button className="small-button dark" aria-expanded={sharing} onClick={() => setSharing(!sharing)}>{t("Share your tune ↗")}</button></div></div>
      {sharing && <section className="share-panel" aria-label={t("Share your tune")}><label>{t("Song title")}<input aria-label={t("Song title")} disabled={recordLocked} maxLength={80} value={doc.song.title ?? ''} onChange={e => edit({ ...doc.song, title: e.target.value || undefined })}/></label><div><button className="small-button dark" onClick={() => void copyDraft()}>{t("Copy draft link")}</button><button className="small-button" disabled={publishing || recordLocked} onClick={() => void publish()}>{t(publishing ? 'Publishing…' : published ? 'Publish a fork' : 'Publish publicly')}</button></div><p>{t("A draft link carries the score. Publishing creates a public page and downloadable audio. Anonymous publications cannot be withdrawn with an account.")}</p><Account/>{published && <div className="published-links"><a href={localePath(`/s/${published.id}`,locale)}>{t("Published page ↗")}</a><a href={`/s/${published.id}.mp3`}>{t("Download published MP3 ↓")}</a></div>}</section>}
      {code && <CodePanel song={doc.song} onNotice={say}/>}
      <div className={`notice ${audio.error ? 'error' : ''}`} role="status" aria-live="polite">{audio.error?errorText(audio.error):t(notice)}</div>
    </main>
    {!embedded&&<SiteFooter />}
  </div>;
}
