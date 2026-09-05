import type { Role } from 'chipvoice';
import { tokens, type SongDocument } from './document';

/** One grid overdub. A repeated order entry deliberately edits its shared
 * pattern, just like the editor. Other patterns, roles and metadata survive. */
export function recordStep(song: SongDocument, role: Role, note: string, position: { step: number; orderIndex: number }): SongDocument {
  const { step, orderIndex } = position;
  if (!Number.isInteger(orderIndex) || !Number.isInteger(step) || step < 0) return song;
  const index = song.order[orderIndex], pattern = song.patterns[index];
  if (!pattern) return song;
  const line = tokens(pattern[role]);
  if (step >= line.length || line[step] === note) return song;
  let chordShape = pattern.chordShape;
  if (role === 'chord') {
    // Shapes are indexed by chord occurrence, not step. Inserting a new chord
    // must not move the voicings belonging to the existing later chords.
    const shapes = new Map<number, number[]>();
    let slot = 0, held = chordShape[0];
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '.' && line[i] !== '=') {
        const shape = chordShape[slot++ % chordShape.length];
        shapes.set(i, shape);
        if (i <= step) held = shape;
      }
    }
    shapes.set(step, shapes.get(step) ?? held);
    chordShape = [...shapes].sort((a, b) => a[0] - b[0]).map(([, shape]) => shape).concat(chordShape.slice(slot));
  }
  line[step] = note;
  return { ...song, patterns: song.patterns.map((p, i) => i === index ? { ...p, [role]: line.join(' '), chordShape } : p) };
}
