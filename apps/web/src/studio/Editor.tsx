'use client';
import { useEffect, useRef, useState } from 'react';
import { INTENTS, arrange, validateSong, type Role } from 'chipvoice';
import { pitch } from './Voices';
import { ROLES, ROLE_NAMES, tokens, lengthOf, type SongDocument } from './document';

export function palette(role: Role, chromatic = false, key = 'C') {
  if (role === 'perc') return ['K', 'S', 'H', 'O'];
  const octave = role === 'bass' ? 2 : role === 'chord' ? 3 : 4;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const root = key === 'A' ? 9 : key === 'E' ? 4 : 0;
  const intervals = chromatic ? Array.from({ length: 13 }, (_, i) => i) : key === 'C' ? [0,2,4,5,7,9,11,12] : [0,2,3,5,7,8,10,12];
  return intervals.map(n => names[(n + root) % 12] + (octave + Math.floor((n + root) / 12)));
}
export function Editor({ song, onEdit, role, onRole, onPreview, chromatic, musicalKey, undo, redo, canUndo, canRedo }: {
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  song: SongDocument; onEdit: (song: SongDocument) => void; role: Role; onRole: (role: Role) => void;
  onPreview: (role: Role, token: string) => void; chromatic: boolean; musicalKey: string;
}) {
  const [patternIndex, setPatternIndex] = useState(0);
  const [bar, setBar] = useState(0);
  const [textMode, setTextMode] = useState(false);
  const [raw, setRaw] = useState('');
  const [issue, setIssue] = useState('');
  const drag = useRef(false);
  const mouseClick = useRef(false);
  const selected = Math.min(patternIndex, song.patterns.length - 1);
  const pattern = song.patterns[selected];
  const existing = tokens(pattern[role]).filter(n => n !== '.' && n !== '=');
  const base = palette(role, chromatic, musicalKey);
  // Keep every existing pitch editable, even outside the assisted scale.
  const notes = role === 'perc' ? base : [...new Set([...base, ...existing])].sort((a, b) => pitch(a) - pitch(b));
  const count = lengthOf(pattern);
  const page = Math.min(bar, Math.ceil(count / 16) - 1);
  const columns = Math.min(16, count - page * 16);
  useEffect(() => { const up = () => { drag.current = false; }; window.addEventListener('pointerup', up); return () => window.removeEventListener('pointerup', up); }, []);
  const changeCell = (index: number, note: string, toggle = true) => {
    const line = tokens(pattern[role]);
    line[index] = toggle && line[index] === note ? '.' : note;
    onEdit({ ...song, patterns: song.patterns.map((p, i) => i === selected ? { ...p, [role]: line.join(' ') } : p) });
    if (line[index] !== '.' && line[index] !== '=') onPreview(role, note);
  };
  const editText = () => { setRaw(pattern[role]); setIssue(''); setTextMode(!textMode); };
  const apply = () => {
    const next = { ...song, patterns: song.patterns.map((p, i) => i === selected ? { ...p, [role]: raw } : p) };
    const validation = validateSong(arrange(next));
    if (!validation.ok) { setIssue(validation.issues.find(i => i.level === 'error')?.message ?? 'Check the notes.'); return; }
    onEdit(next); setTextMode(false); setIssue('');
  };
  return <section className="editor" aria-label="Loop editor">
    <div className="section-heading"><div><span className="micro">MAKE IT YOURS</span><h2>A few notes can change everything.</h2></div><button className="small-button" onClick={editText}>{textMode ? 'Back to grid' : 'Edit as text'}</button></div>
    <div className="editor-toolbar"><button className="small-button" aria-label="Undo edit" disabled={!canUndo} onClick={undo}>↶ Undo</button><button className="small-button" aria-label="Redo edit" disabled={!canRedo} onClick={redo}>↷ Redo</button>
      <label>Pattern<select value={selected} onChange={e => { setPatternIndex(Number(e.target.value)); setBar(0); setTextMode(false); }}>{song.patterns.map((_, i) => <option key={i} value={i}>Pattern {i + 1}</option>)}</select></label>
      <span className="order-readout">Sequence {song.order.map(i => i + 1).join(' → ')}</span>
      <div className="role-tabs" aria-label="Edit musical role">{ROLES.map(r => <button key={r} className={r} aria-pressed={role === r} onClick={() => { onRole(r); setTextMode(false); }}>{ROLE_NAMES[r]}</button>)}</div>
      <label>Timbre<select aria-label={`${ROLE_NAMES[role]} timbre`} value={song.intent?.[role] ?? ({ lead: 'soft', chord: 'plucked', bass: 'round', perc: 'tight' }[role])} onChange={e => onEdit({ ...song, intent: { ...song.intent, [role]: e.target.value } })}>{Object.keys(INTENTS[role]).map(word => <option key={word} value={word}>{word}</option>)}</select></label>
    </div>
    {textMode ? <div className="text-editor"><label htmlFor="raw-notes">{ROLE_NAMES[role]} · one token per step, . holds, = cuts</label><textarea id="raw-notes" value={raw} onChange={e => setRaw(e.target.value)} spellCheck={false} rows={4} /><div><button className="small-button dark" onClick={apply}>Apply notes</button><span className="field-error" role="status">{issue}</span></div></div> : <>
      <div className="grid-scroll"><div className={`piano-grid ${role}`} role="group" aria-label={`${ROLE_NAMES[role]} note grid`} style={{ gridTemplateColumns: `44px repeat(${columns}, minmax(38px, 1fr))` }}>
        {[...notes].reverse().map(note => <div className="piano-row" key={note}><button className="pitch-label" onClick={() => onPreview(role, note)} aria-label={`Preview ${note}`}>{role === 'perc' ? ({ K: 'Kick', S: 'Snare', H: 'Hat', O: 'Open' }[note]) : note}</button>{Array.from({ length: columns }, (_, offset) => {
          const index = page * 16 + offset; const active = tokens(pattern[role])[index] === note;
          return <button key={index} className={`grid-cell ${active ? 'filled' : ''} ${offset % 4 === 0 ? 'beat-start' : ''}`} aria-label={`${ROLE_NAMES[role]} step ${index + 1} ${note}`} aria-pressed={active}
            onPointerDown={e => { mouseClick.current = e.pointerType === 'mouse'; if (e.pointerType === 'mouse' && e.button === 0) { drag.current = true; changeCell(index, note); } }}
            onPointerEnter={e => { if (drag.current && e.pointerType === 'mouse' && e.buttons === 1) changeCell(index, note, false); }}
            onClick={e => { if (e.detail === 0 || !mouseClick.current) changeCell(index, note); mouseClick.current = false; }}
            onKeyDown={e => { const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns + 1, ArrowUp: -columns - 1 }; if (!(e.key in offsets)) return; e.preventDefault(); const buttons = Array.from(e.currentTarget.closest('.piano-grid')!.querySelectorAll('button')); const target = buttons[buttons.indexOf(e.currentTarget) + offsets[e.key]]; target?.focus(); }} />;
        })}</div>)}
        <span />{Array.from({ length: columns }, (_, i) => <span key={i} className="step-number">{page * 16 + i + 1}</span>)}
      </div></div>
      <div className="editor-bottom"><span>Tap to place. Tap again to remove. Drag with a mouse.</span><div><button className="small-button" disabled={page === 0} onClick={() => setBar(page - 1)} aria-label="Previous bar">←</button><span>Bar {page + 1} / {Math.ceil(count / 16)}</span><button className="small-button" disabled={(page + 1) * 16 >= count} onClick={() => setBar(page + 1)} aria-label="Next bar">→</button></div></div>
    </>}
  </section>;
}
