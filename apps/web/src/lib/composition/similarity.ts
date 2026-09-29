/**
 * Melodic similarity to a known melody (decision 56, NEXT-21).
 *
 * Decision 39 promised that generation "declines requests to reproduce a
 * known theme". The prompt-side screen (`./moderation`'s `knownWorkInPrompt`)
 * only catches a prompt that names its source; it cannot catch a melody the
 * model reproduces without being asked to, and it refuses a prompt that
 * merely mentions a franchise without ever reproducing anything. This module
 * is the real gate: it measures the model's OUTPUT - the notes it actually
 * wrote - against `./known-melodies.ts`'s reference set, and `jobs.ts` calls
 * it once a generation's score exists, before that score is ever saved.
 *
 * The measure is transposition- and tempo-invariant by construction: a
 * melodic line is reduced to the sequence of pitch INTERVALS between
 * consecutive notes (semitones; transposing the whole line by any amount
 * leaves every interval unchanged) paired with the sequence of DURATION
 * RATIOS between consecutive inter-onset gaps (playing the same line at any
 * tempo scales every gap by the same constant, which cancels out of every
 * ratio). Two lines are compared with a bounded, windowed edit distance
 * (an alignment, the same family as DTW): every window of the candidate line
 * close in length to the reference is aligned against it, tolerating a
 * substituted note (a changed pitch or rhythm) or an inserted one (an
 * ornament) at the cost of one edit each, and the best window's normalized
 * score is the similarity. This is pure, deterministic and does not import
 * `chipvoice`, a chip or a driver, so it is exercised entirely with
 * synthetic note data in `test-known-melody-similarity.mjs`, which also
 * calibrates and pins `KNOWN_MELODY_THRESHOLD` below.
 */
import { KNOWN_MELODIES, type KnownMelody } from "./known-melodies";

export interface MelodicNoteInput {
  tick: number;
  pitch: number;
}

export interface MelodicToken {
  /** Semitones from the previous note to this one. */
  interval: number;
  /** log2(this inter-onset gap / the previous one), rounded to
   * `RHYTHM_QUANT` steps per doubling - tempo-invariant by construction
   * (see the module comment), quantized only so that a lightly re-timed
   * rhythm still lands on the same bucket as the reference. */
  rhythm: number;
}

/** Buckets per octave (doubling) of the duration-ratio. 4 steps per doubling
 * (quarter-tone-like granularity in log-duration space) tolerates ordinary
 * timing jitter and light re-timing without collapsing genuinely different
 * rhythms (a dotted note vs. a straight one, 3:2 vs 1:1) into the same
 * bucket. */
const RHYTHM_QUANT = 4;

function quantizeRhythm(ratio: number): number {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return 0;
  return Math.round(RHYTHM_QUANT * Math.log2(ratio));
}

/** Reduces a part's notes to one pitch per onset tick, sorted by tick - a
 * monophonic top-voice reduction, so a chorded "chord" part still yields a
 * melodic line (its highest note at each onset) instead of being skipped.
 * Simultaneous notes at the same tick keep only the highest pitch. */
export function melodicLine(notes: MelodicNoteInput[]): MelodicNoteInput[] {
  const byTick = new Map<number, number>();
  for (const note of notes) {
    const existing = byTick.get(note.tick);
    if (existing === undefined || note.pitch > existing) byTick.set(note.tick, note.pitch);
  }
  return [...byTick.entries()].sort(([a], [b]) => a - b).map(([tick, pitch]) => ({ tick, pitch }));
}

/** Builds joint tokens from parallel interval/duration-ratio sequences,
 * shared by `tokenize` (candidate notes) and `referenceTokens` (the
 * precomputed reference data), so both paths quantize rhythm identically and
 * can never drift apart. `durationRatios[i]` pairs with `intervals[i + 1]`
 * (see `./known-melodies.ts`'s file comment for why intervals is one longer). */
function tokensFromSequences(intervals: number[], durationRatios: number[]): MelodicToken[] {
  const tokens: MelodicToken[] = [];
  for (let i = 0; i < durationRatios.length; i++)
    tokens.push({ interval: intervals[i + 1], rhythm: quantizeRhythm(durationRatios[i]) });
  return tokens;
}

/** Tokenizes a melodic line (already reduced to one pitch per onset, e.g. by
 * `melodicLine`) into the same joint interval/rhythm sequence the reference
 * set is stored in. Fewer than 3 notes yields no tokens (an interval needs 2
 * notes, a duration ratio needs 2 gaps, i.e. 3 notes) - too little material
 * to measure, not a match or a non-match either way. */
export function tokenize(line: MelodicNoteInput[]): MelodicToken[] {
  if (line.length < 3) return [];
  const intervals: number[] = [], iois: number[] = [];
  for (let i = 1; i < line.length; i++) {
    intervals.push(line[i].pitch - line[i - 1].pitch);
    iois.push(Math.max(1, line[i].tick - line[i - 1].tick));
  }
  const durationRatios: number[] = [];
  for (let i = 1; i < iois.length; i++) durationRatios.push(iois[i] / iois[i - 1]);
  return tokensFromSequences(intervals, durationRatios);
}

export function referenceTokens(melody: KnownMelody): MelodicToken[] {
  return tokensFromSequences(melody.intervals, melody.durationRatios);
}

const tokenEqual = (a: MelodicToken, b: MelodicToken) => a.interval === b.interval && a.rhythm === b.rhythm;

/** Levenshtein edit distance over tokens (substitution/insertion/deletion,
 * each cost 1): the standard way to score an alignment tolerant of exactly
 * the variations decision 56 calibrates against - a changed note
 * (substitution) or an inserted ornament (insertion) - without requiring an
 * exact match. */
function editDistance(a: MelodicToken[], b: MelodicToken[]): number {
  const rows = a.length + 1, cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const current = new Array<number>(cols);
    current[0] = i;
    for (let j = 1; j < cols; j++) {
      current[j] = tokenEqual(a[i - 1], b[j - 1])
        ? previous[j - 1]
        : 1 + Math.min(previous[j - 1], previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[cols - 1];
}

/** How many tokens a candidate window may differ in length from the
 * reference and still be compared - covers "a changed note or two" and one
 * or two inserted ornaments without letting the window grow so loose that it
 * can absorb unrelated material. */
const WINDOW_TOLERANCE = 3;

/** The best (highest) similarity between a candidate token sequence and one
 * reference: every window of the candidate close in length to the reference
 * is aligned against it with `editDistance`, normalized to
 * `1 - distance / max(windowLength, referenceLength)` (0 = nothing alike, 1 =
 * identical), and the best window wins. This is a local alignment - it finds
 * a known melody quoted anywhere inside a longer generated part, not only
 * when the part IS the known melody start to end. */
export function bestMatch(candidateTokens: MelodicToken[], referenceTokens: MelodicToken[]): number {
  const refLen = referenceTokens.length;
  if (refLen === 0 || candidateTokens.length === 0) return 0;
  const minLen = Math.max(1, refLen - WINDOW_TOLERANCE);
  const maxLen = Math.min(candidateTokens.length, refLen + WINDOW_TOLERANCE);
  let best = 0;
  for (let len = minLen; len <= maxLen; len++) {
    for (let start = 0; start + len <= candidateTokens.length; start++) {
      const distance = editDistance(candidateTokens.slice(start, start + len), referenceTokens);
      const similarity = 1 - distance / Math.max(len, refLen);
      if (similarity > best) best = similarity;
    }
  }
  return best;
}

export interface MelodicPart {
  id: string;
  role: string;
  notes: { tick: number; pitch: number; drum?: number | null }[];
}

export interface SimilarityMatch {
  referenceId: string;
  title: string;
  /** The generated part this reference matched best. */
  part: string;
  /** 0..1, see `bestMatch`. */
  similarity: number;
}

/** The strongest match between any melodic part of a generation and any
 * reference melody, or null when there is not enough melodic material to
 * measure (every part too short, or no non-percussion part at all).
 * Percussion notes and parts (`role: "perc"`, or a note carrying `drum`) are
 * excluded: they have no pitched melodic content for this measure to apply
 * to. Precomputing each reference's tokens once, outside the loop, keeps a
 * generation with several parts and several references fast (see the module
 * comment: this must stay cheap enough to run on every generation). */
export function knownMelodySimilarity(parts: MelodicPart[], references: KnownMelody[] = KNOWN_MELODIES): SimilarityMatch | null {
  const referenceTokenSets = references.map((reference) => ({ reference, tokens: referenceTokens(reference) }));
  let best: SimilarityMatch | null = null;
  for (const part of parts) {
    if (part.role === "perc") continue;
    const line = melodicLine(part.notes.filter((note) => note.drum == null).map((note) => ({ tick: note.tick, pitch: note.pitch })));
    const candidateTokens = tokenize(line);
    if (!candidateTokens.length) continue;
    for (const { reference, tokens } of referenceTokenSets) {
      const similarity = bestMatch(candidateTokens, tokens);
      if (!best || similarity > best.similarity) best = { referenceId: reference.id, title: reference.title, part: part.id, similarity };
    }
  }
  return best;
}

/**
 * Calibrated in `test-known-melody-similarity.mjs` (decision 56): positives
 * are the reference melodies themselves transposed, re-timed and lightly
 * varied (a transposed+retimed copy always measures 1.0, since both
 * invariances are exact by construction; the varied copies - an inserted
 * ornament, a changed note or two - are what actually sets the threshold),
 * negatives are the repository's own original fixtures (the starter
 * project's melody, the generation benchmark's synthetic mock score, the
 * composition test server's fixture score) and seeded-random tunes.
 *
 * On a calibration set (48 positives: 8 references x 6 varied/transposed/
 * retimed copies each; 23 negatives: 3 repo fixtures + 20 random tunes),
 * chosen BEFORE looking at a held-out set of the same shape: 0.40 clears
 * every negative in the calibration set (max negative similarity 0.333, a
 * margin of 0.067) while catching 44/48 positives (92%; the 4 misses are all
 * heavily varied copies of the two shortest, most repetitive references,
 * `fur-elise` and `beethoven-5th-motif`, where "a changed note or two" is a
 * larger fraction of a 6-7-token incipit than of a longer one). Verified,
 * without changing the threshold, against a held-out set built the same way
 * from different seeds: 45/48 positives caught (94%), 0/23 negatives flagged
 * (max held-out negative similarity was also 0.333). The full confusion
 * matrices for both sets are recorded in decision 56 (DECISIONS.md).
 */
export const KNOWN_MELODY_THRESHOLD = 0.4;

/** Refuses (returns the match) when the strongest match reaches
 * `KNOWN_MELODY_THRESHOLD`, otherwise null. Called once per generation, on
 * its output, after the score exists and before it is saved (`jobs.ts`). */
export function isKnownMelody(parts: MelodicPart[], references: KnownMelody[] = KNOWN_MELODIES): SimilarityMatch | null {
  const match = knownMelodySimilarity(parts, references);
  return match && match.similarity >= KNOWN_MELODY_THRESHOLD ? match : null;
}
