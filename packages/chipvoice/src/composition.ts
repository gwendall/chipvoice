import {noteToFreq} from './driver.js';
import type {Score} from './score.js';
const pitched = ['lead', 'chord', 'bass'] as const;
const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const split = (line: string) => line.trim().split(/\s+/);
function midi(token: string) { const hz = noteToFreq(token); return hz ? Math.round(69 + 12 * Math.log2(hz / 440)) : null; }

/** Bounds avoid silently folding or clipping notes when moving a score. */
export function transposeBounds(score: Score): {min: number; max: number} {
  let low = 119, high = 12;
  for (const pattern of score.patterns) for (const role of pitched) {
    const top = role === 'chord' ? Math.max(0, ...pattern.chordShape.flat()) : 0;
    const bottom = role === 'chord' ? Math.min(0, ...pattern.chordShape.flat()) : 0;
    for (const token of split(pattern[role])) { const n = midi(token); if (n !== null) { low = Math.min(low, n + bottom); high = Math.max(high, n + top); } }
  }
  return {min: Math.max(-12, 12 - low), max: Math.min(12, 119 - high)};
}

/** Bake pitch and drum activity into ordinary score tokens. Apply each preview
 * to the same source score so going back to zero/100 restores it exactly. */
export function shapeScore<T extends Score>(source: T, {transpose = 0, drums = 100}: {transpose?: number; drums?: number}): T {
  const bounds = transposeBounds(source);
  if (!Number.isInteger(transpose) || (transpose !== 0 && (transpose < bounds.min || transpose > bounds.max))) throw new RangeError('Transposition exceeds the score range');
  if (!Number.isInteger(drums) || drums < 0 || drums > 100) throw new RangeError('Drum activity must be 0–100');
  if (transpose === 0 && drums === 100) return source;
  const patterns = source.patterns.map(pattern => {
    const next = {...pattern};
    if (transpose) for (const role of pitched) next[role] = split(pattern[role]).map(token => {
      const n = midi(token); if (n === null) return token;
      const value = n + transpose; return names[value % 12] + (Math.floor(value / 12) - 1);
    }).join(' ');
    if (drums < 100) {
      const line = split(pattern.perc);
      const hits = line.flatMap((token, step) => /^[KSHO]$/.test(token) ? [{step, priority: (token === 'K' || token === 'S' ? 0 : 2) + (step % (source.stepsPerBeat ?? 4) === 0 ? 0 : 1)}] : []);
      hits.sort((a,b) => a.priority - b.priority || a.step - b.step);
      const keep = new Set(hits.slice(0, Math.round(hits.length * drums / 100)).map(hit => hit.step));
      next.perc = line.map((token, step) => /^[KSHO]$/.test(token) && !keep.has(step) ? '.' : token).join(' ');
    }
    return next;
  });
  const next = {...source, patterns}; delete next.id; return next;
}
