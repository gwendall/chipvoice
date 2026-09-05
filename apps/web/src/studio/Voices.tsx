'use client';
import { measure } from './metrics';
import { memo, useEffect, useRef } from 'react';
import { NES_2A03, GB_DMG, MEGA_DRIVE, SNES, C64, type Role } from 'chipvoice';
import { ROLES, ROLE_NAMES, tokens, type SongDocument } from './document';
import type { EffectId } from './effects';
const specs = { '2a03': NES_2A03, dmg: GB_DMG, md: MEGA_DRIVE, snes: SNES, c64: C64 };
export const roleVoice = (song: SongDocument, role: Role) => specs[song.chip].roles[role];
export function pitch(note: string) {
  const match = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!match) return 48;
  return (Number(match[3]) + 1) * 12 + ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]] ?? 0) + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}
export const Voices = memo(function Voices({ song, position, stolen, muted, solo, onMute, onSolo, effect }: {
  song: SongDocument; position: { step: number; orderIndex: number } | null; stolen: string[];
  muted: Role[]; solo: Role | null; onMute: (role: Role) => void; onSolo: (role: Role) => void;
  effect: { id: EffectId; at: number } | null;
}) {
  const orderIndex = Math.min(position?.orderIndex ?? 0, song.order.length - 1);
  const pattern = song.patterns[song.order[orderIndex]];
  const count = tokens(pattern.bass).length;
  return <div className="voice-display" aria-label="Live musical roles">
    <div className="display-ruler"><span>THE MUSIC INSIDE</span><span>{position ? `BAR ${orderIndex + 1} / ${song.order.length}` : 'READY WHEN YOU ARE'}</span></div>
    {ROLES.map(role => {
      const line = tokens(pattern[role]);
      const pitches = line.filter(n => n !== '.' && n !== '=').map(pitch);
      const low = Math.min(...pitches); const high = Math.max(low + 7, ...pitches);
      const taken = stolen.includes(roleVoice(song, role));
      return <div key={role} className={`voice-lane ${role} ${muted.includes(role) ? 'is-muted' : ''} ${taken ? 'is-stolen' : ''}`} data-role={role} data-stolen={taken}>
        <div className="voice-name"><button onClick={() => onMute(role)} aria-pressed={muted.includes(role)} aria-label={`Mute ${ROLE_NAMES[role]}`}><i />{ROLE_NAMES[role]}</button><span>{taken ? 'SFX HAS THIS VOICE' : roleVoice(song, role)}</span></div>
        <div className="note-lane" aria-label={`${ROLE_NAMES[role]} notes`}>
          {line.map((note, i) => {
            if (note === '.' || note === '=') return null;
            let end = i + 1; while (end < line.length && line[end] === '.') end++;
            const y = role === 'perc' ? ({ K: 65, S: 38, H: 15, O: 15 }[note] ?? 40) : 15 + 60 * (high - pitch(note)) / (high - low);
            return <span key={i} className={`voice-note ${position && position.step >= i && position.step < end ? 'sounding' : ''}`} style={{ left: `${i / count * 100}%`, width: `${Math.max(0.5, (role === 'perc' ? 0.65 : end - i - 0.2) / count * 100)}%`, top: `${y}%` }} />;
          })}
          {position && <div className="playhead" style={{ left: `${position.step / count * 100}%` }} />}
          {taken && <div className="taken-label">← borrowed by a sound effect →</div>}
        </div>
        <button className="solo-button" aria-label={`Solo ${ROLE_NAMES[role]}`} aria-pressed={solo === role} onClick={() => onSolo(role)}>S</button>
      </div>;
    })}
    <div className="display-bottom"><span><i className={position ? 'status-light active' : 'status-light'} />{position ? 'PLAYING LIVE ON THE CHIP' : 'PRESS PLAY. THEN TRY AN ARCADE PAD.'}</span><div className="arcade-scene" aria-hidden="true" key={effect?.at ?? 0} data-effect={effect?.id ?? 'idle'}><span className="pixel-runner">▟</span><span className="pixel-coin">◆</span><span className="pixel-shot">━</span><span className="pixel-burst">✳</span></div></div>
  </div>;
});

/** Measured mixed output. Note lanes above show commands, not fake meters. */
export function OutputScope({ node }: { node: AudioNode | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const ctx = el.getContext('2d'); if (!ctx) return;
    const analyser = node?.context.createAnalyser();
    if (analyser && node) { analyser.fftSize = 256; node.connect(analyser); }
    const values = new Float32Array(256);
    let raf = 0;
    let heard = false;
    const draw = () => {
      if (analyser) { analyser.getFloatTimeDomainData(values); if (!heard && values.some(v => Math.abs(v) > .001)) { heard = true; measure('sound'); } }
      ctx.clearRect(0, 0, el.width, el.height); ctx.strokeStyle = '#d5aa64'; ctx.lineWidth = 2; ctx.beginPath();
      values.forEach((v, i) => { const x = i / 255 * el.width; const y = el.height / 2 - v * el.height * 0.8; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });ctx.stroke();
      raf = requestAnimationFrame(draw);
    };draw();
    return () => { cancelAnimationFrame(raf); if (analyser && node) { try { node.disconnect(analyser); } catch { /* Disposing a replaced chip already disconnects its output. */ } } analyser?.disconnect(); };
  }, [node]);
  return <canvas ref={canvas} className="output-scope" width="180" height="36" aria-label="Measured mixed audio waveform" role="img" />;
}
