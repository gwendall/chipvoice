'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Role } from 'chipvoice';
import { useSongDocument } from './useSongDocument';
import { useDemoAudio } from './useDemoAudio';
import { MACHINES, ROLE_NAMES, ROLES, encodeDocument, type SongDocument } from './document';
import { PRESETS } from './presets';
import { EFFECTS } from './effects';
import { Voices, OutputScope } from './Voices';
import { Editor, palette } from './Editor';
import { CodePanel } from './CodePanel';
import { measure } from './metrics';

export default function App({ initial, initialId }: { initial?: SongDocument; initialId?: string }) {
  const doc = useSongDocument(initial, initialId);
  const [muted, setMuted] = useState<Role[]>([]);
  const [solo, setSolo] = useState<Role | null>(null);
  const effectiveMuted = useMemo(() => solo ? ROLES.filter(r => r !== solo) : muted, [solo, muted]);
  const audio = useDemoAudio(doc.song, effectiveMuted);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [role, setRole] = useState<Role>('lead');
  const [chromatic, setChromatic] = useState(false);
  const [musicalKey, setMusicalKey] = useState('C');
  const [notice, setNotice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ id: string; snapshot: string } | null>(initialId ? { id: initialId, snapshot: JSON.stringify(initial) } : null);
  const machine = MACHINES.find(m => m.id === doc.song.chip)!;
  const notes = palette(role, chromatic, musicalKey);
  const keyboard = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];
  const edit = useCallback((next: SongDocument) => { doc.edit(next); measure('edit'); }, [doc.edit]);
  const say = useCallback((message: string) => setNotice(message), []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) doc.redo(); else doc.undo(); return; }
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (event.code === 'Space') { if (event.target instanceof HTMLButtonElement) return; event.preventDefault(); void audio.toggle(); return; }
      const fx = EFFECTS.find(f => f.key === event.key);
      if (fx) { event.preventDefault(); void audio.fire(fx.id); return; }
      const index = keyboard.indexOf(event.key.toLowerCase());
      if (index >= 0 && notes[index]) { event.preventDefault(); void audio.preview(role, notes[index]); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [audio.toggle, audio.fire, audio.preview, notes.join(','), role, doc.undo, doc.redo]);
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
      let key: string | null = null; try { key = localStorage.getItem('chipvoice.key'); } catch {}
      const response = await fetch(published ? `/api/songs/${published.id}/fork` : '/api/songs', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(doc.song) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.issues?.[0]?.message ?? result.message ?? 'Could not publish. Your local draft is safe.');
      setPublished({ id: result.id, snapshot: JSON.stringify(doc.song) });
      say('Published. Your permanent link and MP3 are ready below.'); measure('share');
    } catch (error) { say(error instanceof Error ? error.message : 'Could not reach the server. Your draft is safe.'); }
    finally { setPublishing(false); }
  };

  return <div className="demo-page">
    <header className="site-header"><a href="/" className="wordmark" aria-label="chipvoice home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>chipvoice</a><span className="header-tag">OLD CHIPS. NEW TRICKS.</span><nav aria-label="Project"><a href="https://github.com/gwendall/chipvoice#readme">Docs ↗</a><a href="https://github.com/gwendall/chipvoice">GitHub ↗</a></nav></header>
    <main className="demo-main">
      <div className="intro-line"><p>Five machines. <span>Your soundtrack.</span></p><span className="micro">A PLAYABLE AUDIO LIBRARY</span></div>
      <section className="console" aria-label="Chipvoice musical console">
        <div className="console-top"><span className="micro">CHOOSE YOUR MACHINE</span><span className="micro hardware-label">CV–05 / POCKET SOUND SYSTEM</span></div>
        <div className="machines" aria-label="Sound machine">{MACHINES.map(m => <button key={m.id} aria-pressed={doc.song.chip === m.id} onClick={() => { edit({ ...doc.song, chip: m.id }); measure('switch'); }}><span className="machine-logo" style={{ maskImage: `url(${m.logo})`, WebkitMaskImage: `url(${m.logo})` }} aria-hidden="true"/><strong><span className="machine-led"/>{m.name}</strong></button>)}</div>
        <div className="screen-bezel"><div className="screen-title"><div><span className="screen-kicker">{machine.chip}</span><h1>{doc.song.title || 'Untitled adventure'}</h1></div><OutputScope node={audio.output}/></div><Voices song={doc.song} position={audio.position} stolen={audio.stolen} muted={effectiveMuted} solo={solo} onMute={r => setMuted(previous => previous.includes(r) ? previous.filter(v => v !== r) : [...previous, r])} onSolo={r => setSolo(previous => previous === r ? null : r)} effect={audio.effect}/></div>
        <div className="transport-row">
          <button className={`play-button ${audio.playing ? 'playing' : ''}`} aria-label={audio.playing ? 'Stop' : 'Play'} onClick={() => void audio.toggle()}><span aria-hidden="true">{audio.playing ? '■' : '▶'}</span>{audio.loading ? 'Loading' : audio.playing ? 'Stop' : 'Play'}<kbd>space</kbd></button>
          <div className="tempo-control"><label htmlFor="tempo">TEMPO</label><button aria-label="Slower" onClick={() => edit({ ...doc.song, bpm: Math.max(40, doc.song.bpm - 4) })}>−</button><input id="tempo" aria-label="Tempo" type="number" min={40} max={300} value={doc.song.bpm} onChange={e => { const value = Number(e.target.value); if (value >= 40 && value <= 300) edit({ ...doc.song, bpm: Math.round(value) }); }}/><button aria-label="Faster" onClick={() => edit({ ...doc.song, bpm: Math.min(300, doc.song.bpm + 4) })}>+</button></div>
          <div className="history-controls"><button aria-label="Undo" disabled={!doc.canUndo} onClick={doc.undo}>↶</button><button aria-label="Redo" disabled={!doc.canRedo} onClick={doc.redo}>↷</button></div>
          <button className="edit-toggle" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? 'Close editor' : 'Edit loop'} <span aria-hidden="true">{editing ? '−' : '+'}</span></button>
        </div>
        <div className="arcade-header"><span className="micro">A LITTLE INTERRUPTION</span><p>Try a sound effect. Watch it borrow a voice.</p></div>
        <div className="arcade-pads">{EFFECTS.map(fx => <button key={fx.id} className={`arcade-pad ${fx.id}`} onClick={() => void audio.fire(fx.id)} aria-label={fx.name}><span className="pad-symbol" aria-hidden="true">{fx.symbol}</span><span className="pad-name">{fx.name}</span><kbd>{fx.key}</kbd></button>)}</div>
        <div className="console-bottom"><span>EMULATED CHIPS. REAL CONSTRAINTS.</span><span className="screw" aria-hidden="true">⊕</span><span>MADE TO BE PLAYED</span></div>
      </section>
      <section className="cartridges" aria-label="Music cartridges"><div className="section-heading"><div><span className="micro">CHANGE THE SCENERY</span><h2>Pick a cartridge.</h2></div><p>One song. Five different personalities.</p></div><div className="cartridge-list">{PRESETS.map((preset, index) => <button key={preset.id} className={`cartridge ${preset.id}`} onClick={() => { edit({ ...structuredClone(preset.song), chip: doc.song.chip }); setMuted([]); setSolo(null); setMusicalKey(preset.id === 'boss' ? 'E' : preset.id === 'midnight' ? 'A' : 'C'); measure('preset'); }} aria-label={`Load ${preset.title}`}><span className="cartridge-art" aria-hidden="true"><i/><i/><i/><i/><i/></span><span className="cartridge-copy"><strong>{preset.title}</strong><span>{preset.mood}</span></span><span className="cartridge-number">0{index + 1} ↗</span></button>)}</div></section>
      <section className="keyboard-section" aria-label="Play notes"><div className="keyboard-heading"><div><span className="micro">PLAY A LITTLE</span><h2>Your turn.</h2></div><div className="keyboard-options"><label className="sr-only" htmlFor="audition-role">Audition role</label><select id="audition-role" value={role} onChange={e => setRole(e.target.value as Role)}>{ROLES.map(r => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select><label className="sr-only" htmlFor="musical-key">Musical key</label><select id="musical-key" value={musicalKey} onChange={e => setMusicalKey(e.target.value)}><option value="C">C major</option><option value="A">A minor</option><option value="E">E minor</option></select><button className="small-button" aria-pressed={chromatic} onClick={() => setChromatic(!chromatic)}>Chromatic</button></div></div><div className={`note-keys ${role}`}>{notes.map((note, i) => <button key={note} onClick={() => void audio.preview(role, note)} aria-label={`Play ${note}`}><span>{role === 'perc' ? ({ K: 'Kick', S: 'Snare', H: 'Hat', O: 'Open' }[note]) : note}</span>{keyboard[i] && <kbd>{keyboard[i]}</kbd>}</button>)}</div><p className="keyboard-hint">Use the keys or tap a note. You’re playing on the same chip as the music.</p></section>
      {editing && <Editor undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} song={doc.song} onEdit={edit} role={role} onRole={setRole} onPreview={(r, n) => void audio.preview(r, n)} chromatic={chromatic} musicalKey={musicalKey}/>}
      <div className="takeaway"><div><h2>Keep the good bits.</h2><p>{doc.recovered ? 'Your last draft is back. Keep playing.' : 'Make a little music. Put it in something you love.'}</p></div><div><button className="small-button" aria-expanded={code} onClick={() => setCode(!code)}>〈/〉 {code ? 'Hide code' : 'View code'}</button><button className="small-button dark" aria-expanded={sharing} onClick={() => setSharing(!sharing)}>Share your tune ↗</button></div></div>
      {sharing && <section className="share-panel" aria-label="Share your tune"><label>Song title<input aria-label="Song title" maxLength={80} value={doc.song.title ?? ''} onChange={e => edit({ ...doc.song, title: e.target.value || undefined })}/></label><div><button className="small-button dark" onClick={() => void copyDraft()}>Copy draft link</button><button className="small-button" disabled={publishing} onClick={() => void publish()}>{publishing ? 'Publishing…' : published ? 'Publish a fork' : 'Publish publicly'}</button></div><p>A draft link carries the score. Publishing creates a public page and downloadable audio. Anonymous publications cannot be withdrawn with an account.</p>{published && <div className="published-links"><a href={`/s/${published.id}`}>Published page ↗</a><a href={`/s/${published.id}.mp3`}>Download published MP3 ↓</a></div>}</section>}
      {code && <CodePanel song={doc.song} onNotice={say}/>}
      <div className={`notice ${audio.error ? 'error' : ''}`} role="status" aria-live="polite">{audio.error || notice}</div>
    </main>
    <footer className="site-footer"><span>chipvoice · A love letter to little sound chips.</span><div><a href="https://github.com/HVR88/Monochrome-Gaming-Logos">Console logos ↗</a><a href="/skill.md">For agents ↗</a><a href="https://github.com/gwendall/chipvoice/tree/main/docs">Inside the chips ↗</a></div></footer>
  </div>;
}
