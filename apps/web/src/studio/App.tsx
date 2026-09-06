'use client';
import type {CSSProperties} from 'react';
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

export default function App({ initial, initialId }: { initial?: SongDocument; initialId?: string }) {
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
    const link = `${location.origin}/#${encodeDocument(doc.song)}`;
    try { await navigator.clipboard.writeText(link); say('Draft link copied. It contains your complete score.'); }
    catch { history.replaceState(null, '', `/#${encodeDocument(doc.song)}`); say('Your draft link is in the address bar.'); }
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

  return <div className="demo-page">
    <SiteHeader />
    <main className="demo-main">
      <div className="intro-line"><p>Five machines. <span>Your soundtrack.</span></p><span className="micro">A PLAYABLE AUDIO LIBRARY</span></div>
      <section className="console" aria-label="Chipvoice musical console">
        <div className="console-top"><span className="micro">CHOOSE YOUR MACHINE</span><span className="micro hardware-label">CV–05 / POCKET SOUND SYSTEM</span></div>
        <MachinePicker value={doc.song.chip} disabled={recordLocked} onChange={chip => { edit({...doc.song, chip}); measure('switch'); }} />
        <div className="screen-bezel"><div className="screen-title"><div><span className="screen-kicker">{machine.chip}</span><h1>{doc.song.title || 'Untitled adventure'}</h1></div><OutputScope node={audio.output}/></div><Voices disabled={recordLocked} song={recording && backingSong.current ? backingSong.current : doc.song} position={audio.position} stolen={audio.stolen} muted={effectiveMuted} solo={solo} onMute={r => setMuted(previous => previous.includes(r) ? previous.filter(v => v !== r) : [...previous, r])} onSolo={r => setSolo(previous => previous === r ? null : r)} effect={audio.effect}/></div>
        <div className="transport-row">
          <PlayButton playing={audio.playing} loading={audio.loading} shortcut onClick={togglePlayback}/>
          <RangeControl id="tempo" label="Tempo" unit="BPM" min={40} max={300} value={doc.song.bpm} disabled={recordLocked || !doc.ready} onChange={(bpm, group) => { doc.edit(song => ({...song, bpm}), group); measure('edit'); }}/>
          <div className="history-controls"><button aria-label="Undo" disabled={!doc.canUndo} onClick={undo}>↶</button><button aria-label="Redo" disabled={!doc.canRedo} onClick={redo}>↷</button></div>
          <button className="edit-toggle" disabled={recordLocked} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? 'Close editor' : 'Edit loop'} <span aria-hidden="true">{editing ? '−' : '+'}</span></button>
        </div>
        <div className="arcade-header"><span className="micro">A LITTLE INTERRUPTION</span><p>Try a sound effect. Watch it borrow a voice.</p></div>
        <div className="arcade-pads">{EFFECTS.map(fx => <button key={fx.id} className={`arcade-pad ${fx.id}`} onClick={() => void audio.fire(fx.id)} aria-label={fx.name}><span className="pad-symbol" aria-hidden="true">{fx.symbol}</span><span className="pad-name">{fx.name}</span><kbd>{fx.key}</kbd></button>)}</div>
        <div className="console-bottom"><span>EMULATED CHIPS. REAL CONSTRAINTS.</span><span className="screw" aria-hidden="true">⊕</span><span>MADE TO BE PLAYED</span></div>
      </section>
      <section className="cartridges" aria-label="Music cartridges"><div className="section-heading"><div><span className="micro">CHANGE THE SCENERY</span><h2>Pick a cartridge.</h2></div><p>One song. Five different personalities.</p></div>
        {[{title:'Original loops',presets:ORIGINAL_PRESETS},{title:'Familiar melodies',presets:CLASSIC_PRESETS}].map(group=><div className="cartridge-group" key={group.title}><h3>{group.title}</h3><div className="cartridge-list">{group.presets.map((preset: Preset, index) => <button key={preset.id} disabled={recordLocked} className={`cartridge ${preset.id}`} style={{'--cartridge-color':preset.color} as CSSProperties} aria-pressed={doc.song.title===preset.song.title} onClick={() => { edit({ ...structuredClone(preset.song), chip: doc.song.chip }); setMuted([]); setSolo(null); setMusicalKey(preset.id === 'boss' ? 'E' : preset.id === 'midnight' ? 'A' : preset.id === 'zelda' ? 'Bb' : 'C'); measure('preset'); }} aria-label={`Load ${preset.title}`}><span className="cartridge-art" aria-hidden="true"><i/><i/><i/><i/><i/></span><span className="cartridge-copy"><strong>{preset.title}</strong><span>{preset.mood}</span>{preset.composer&&<small>{preset.composer} · {preset.coverage}</small>}</span><span className="cartridge-number">0{index + 1} ↗</span></button>)}</div></div>)}
        <p className="keyboard-hint">Follow a complete musical phrase. These source melodies have no added backing parts. Switch machines to compare their sound.</p>
        {sourcePreset?.source&&<details className="cartridge-source"><summary>About this arrangement · credits & source</summary><p>{sourcePreset.adaptation}</p>{sourcePreset.fidelity?.pass&&<p className="source-check">{matchesSource ? `${sourcePreset.fidelity.referenceNotes} source notes checked · pitches, rhythm and rests · all five machines` : 'Edited version · source checks apply to the original cartridge.'}</p>}<p>Music by {sourcePreset.composer}. Reference transcription: {sourcePreset.source.transcriber}. {sourcePreset.source.excerpt}.</p><a href={sourcePreset.source.url} target="_blank" rel="noreferrer">View the source transcription ↗</a></details>}
      </section>
      <CompositionControls song={doc.song} disabled={recordLocked || !doc.ready} onEdit={(song,group)=>{doc.edit(song,group);measure('edit');}}/>
      <section className="keyboard-section" aria-label="Play notes"><div className="keyboard-heading"><div><span className="micro">PLAY A LITTLE</span><h2>Your turn.</h2></div><div className="keyboard-options"><label className="sr-only" htmlFor="audition-role">Audition role</label><select id="audition-role" value={role} onChange={e => setRole(e.target.value as Role)}>{ROLES.map(r => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select><label className="sr-only" htmlFor="musical-key">Musical key</label><select id="musical-key" value={musicalKey} onChange={e => setMusicalKey(e.target.value)}><option value="C">C major</option><option value="Bb">B♭ major</option><option value="A">A minor</option><option value="E">E minor</option></select><button className="small-button" aria-pressed={chromatic} onClick={() => setChromatic(!chromatic)}>Chromatic</button></div></div><div className="recording-controls"><button className="record-button" disabled={recordStarting} aria-pressed={recording} onClick={() => void toggleRecording()}><span aria-hidden="true">{recording ? '■' : '●'}</span> {recordStarting ? 'Starting…' : recording ? 'Finish take' : 'Record notes'}</button>{!recordLocked && doc.group?.startsWith('take:') && <button className="small-button" onClick={undo}>Undo take</button>}<span className="take-status" role="status">{recording ? `${audio.position ? `${recorded} ${recorded === 1 ? 'tap' : 'taps'} captured` : 'Waiting for the first beat…'} · 1/${(doc.song.stepsPerBeat ?? 4) * 4}` : 'Overdub notes and drums · one Undo per take'}</span></div><div className={`note-keys ${role}`}>{notes.map((note, i) => <button key={note} onPointerDown={e => { if (e.button === 0) playNote(role, note); }} onClick={e => { if (e.detail === 0) playNote(role, note); }} aria-label={`Play ${note}`}><span>{role === 'perc' ? ({ K: 'Kick', S: 'Snare', H: 'Hat', O: 'Open' }[note]) : note}</span>{keyboard[i] && <kbd>{keyboard[i]}</kbd>}</button>)}</div><p className="keyboard-hint">{recording ? 'Taps snap to the nearest step. Finish to hear the new loop. Untouched steps stay as they were.' : 'Use the keys or tap a note. You’re playing on the same chip as the music.'}</p></section>
      <MidiInput role={role} onNote={playNote}/>
      <Variations song={doc.song} disabled={recordLocked} onEdit={edit} onNotice={say}/>
      {editing && !recordLocked && <Editor undo={undo} redo={redo} canUndo={doc.canUndo} canRedo={doc.canRedo} song={doc.song} onEdit={edit} role={role} onRole={setRole} onPreview={(r, n) => void audio.preview(r, n)} chromatic={chromatic} musicalKey={musicalKey}/>}
      <div className="takeaway"><div><h2>Keep the good bits.</h2><p>{doc.recovered ? 'Your last draft is back. Keep playing.' : 'Make a little music. Put it in something you love.'}</p></div><div><button className="small-button" aria-expanded={code} onClick={() => setCode(!code)}>〈/〉 {code ? 'Hide code' : 'View code'}</button><button className="small-button dark" aria-expanded={sharing} onClick={() => setSharing(!sharing)}>Share your tune ↗</button></div></div>
      {sharing && <section className="share-panel" aria-label="Share your tune"><label>Song title<input aria-label="Song title" disabled={recordLocked} maxLength={80} value={doc.song.title ?? ''} onChange={e => edit({ ...doc.song, title: e.target.value || undefined })}/></label><div><button className="small-button dark" onClick={() => void copyDraft()}>Copy draft link</button><button className="small-button" disabled={publishing || recordLocked} onClick={() => void publish()}>{publishing ? 'Publishing…' : published ? 'Publish a fork' : 'Publish publicly'}</button></div><p>A draft link carries the score. Publishing creates a public page and downloadable audio. Anonymous publications cannot be withdrawn with an account.</p><Account/>{published && <div className="published-links"><a href={`/s/${published.id}`}>Published page ↗</a><a href={`/s/${published.id}.mp3`}>Download published MP3 ↓</a></div>}</section>}
      {code && <CodePanel song={doc.song} onNotice={say}/>}
      <div className={`notice ${audio.error ? 'error' : ''}`} role="status" aria-live="polite">{audio.error || notice}</div>
    </main>
    <SiteFooter />
  </div>;
}
