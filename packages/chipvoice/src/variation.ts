import type { Role } from './chip.js';
import { noteToFreq } from './driver.js';
import { DEFAULT_INTENT, INTENTS, type Score } from './score.js';

export interface VariationOptions {
  kind: 'melody' | 'drums' | 'timbres';
  /** Locked roles keep both their notes and their timbre. */
  locked?: readonly Role[];
  /** Reproducible: the same score, options and seed give the same variation. */
  seed: number;
  /** Pitch classes (0=C). Omit to reuse the melody's existing pitch classes. */
  scale?: readonly number[];
}

const ROLES: Role[] = ['lead', 'chord', 'bass', 'perc'];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const GROOVES = [
  'K . H . S . H H K . H . S . H O',
  'K . H H S . H . K K H . S . H .',
  'K . . H S . H . K . H H S . . H',
  'K H . H S . H . K . . H S H H O',
].map(line => line.split(' '));
const split = (line: string) => line.trim().split(/\s+/).filter(Boolean);

/** A small musical edit, independent of playback and document history.
 * Melody keeps rhythm and changes a few pitches; drums use authored grooves.
 * Changed scores drop an explicit playback id so arrange() fingerprints them. */
export function varyScore<T extends Score>(score: T, options: VariationOptions): T {
  let seed = (options.seed | 0) || 0x6d2b79f5;
  const random = (max: number) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) % max;
  };
  const locked = new Set(options.locked);
  let next = score;
  if (options.kind === 'timbres') {
    const intent = { ...score.intent };
    for (const role of ROLES) {
      if (locked.has(role)) continue;
      const current = score.intent?.[role] ?? DEFAULT_INTENT[role];
      const alternatives = Object.keys(INTENTS[role]).filter(word => word !== current);
      Object.assign(intent, { [role]: alternatives[random(alternatives.length)] });
    }
    if (ROLES.some(role => intent[role] !== score.intent?.[role])) next = { ...score, intent };
  } else {
    const role = options.kind === 'drums' ? 'perc' : 'lead';
    if (locked.has(role)) return score;
    const patterns = score.patterns.map(pattern => {
      const line = split(pattern[role]);
      if (!line.length) return pattern;
      if (role === 'perc') {
        let groove = random(GROOVES.length);
        let replacement = line.map((_, i) => (i % ((score.stepsPerBeat ?? 4) / 4) === 0 ? GROOVES[groove][Math.floor(i / ((score.stepsPerBeat ?? 4) / 4)) % 16] : '.')).join(' ');
        if (replacement === line.join(' ')) {
          groove = (groove + 1) % GROOVES.length;
          replacement = line.map((_, i) => (i % ((score.stepsPerBeat ?? 4) / 4) === 0 ? GROOVES[groove][Math.floor(i / ((score.stepsPerBeat ?? 4) / 4)) % 16] : '.')).join(' ');
        }
        return replacement === line.join(' ') ? pattern : { ...pattern, perc: replacement };
      }
      const hits = line.flatMap((token, step) => {
        const hz = noteToFreq(token);
        return hz ? [{ step, midi: Math.round(69 + 12 * Math.log2(hz / 440)) }] : [];
      });
      const classes = [...new Set(options.scale?.filter(n => Number.isInteger(n) && n >= 0 && n < 12)
        ?? hits.map(hit => hit.midi % 12))];
      if (!hits.length) return pattern;
      if (!classes.length) classes.push(0, 2, 4, 5, 7, 9, 11);
      {
        // Prefer weak beats; retain the first note when the phrase has others.
        const candidates = hits.length > 1 ? hits.slice(1) : hits.slice();
        candidates.sort((a, b) => Number(a.step % (score.stepsPerBeat ?? 4) === 0) - Number(b.step % (score.stepsPerBeat ?? 4) === 0));
        const count = Math.max(1, Math.ceil(candidates.length / 3));
        for (let i = 0; i < count; i++) {
          const hit = candidates[i], direction = random(2) ? 1 : -1;
          let pitch = hit.midi;
          for (let distance = 1; distance <= 12; distance++) {
            const preferred = hit.midi + direction * distance, opposite = hit.midi - direction * distance;
            if (preferred >= 12 && preferred <= 119 && classes.includes(preferred % 12)) { pitch = preferred; break; }
            if (opposite >= 12 && opposite <= 119 && classes.includes(opposite % 12)) { pitch = opposite; break; }
          }
          line[hit.step] = NAMES[pitch % 12] + (Math.floor(pitch / 12) - 1);
        }
      }
      const lead = line.join(' ');
      return lead === pattern.lead ? pattern : { ...pattern, lead };
    });
    if (patterns.some((p, i) => p !== score.patterns[i])) next = { ...score, patterns };
  }
  if (next !== score) delete next.id;
  return next;
}
