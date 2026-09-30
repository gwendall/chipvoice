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
 * to measure, not a match or a non-match either way.
 *
 * Pitches are rounded to the nearest semitone before differencing. A
 * generated score's pitches are already integers (`score.ts`), so this is a
 * no-op in production, but a captured performance's are not (an NSF
 * capture's pitch comes from the channel's frequency, e.g. 68.81), and a
 * fractional interval can never equal a reference's integer one: every
 * window would score 0 however close the melody. */
export function tokenize(line: MelodicNoteInput[]): MelodicToken[] {
  if (line.length < 3) return [];
  const intervals: number[] = [], iois: number[] = [];
  for (let i = 1; i < line.length; i++) {
    intervals.push(Math.round(line[i].pitch) - Math.round(line[i - 1].pitch));
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

interface AlignmentResult {
  /** Levenshtein edit distance (substitution/insertion/deletion, each cost
   * 1) - the standard way to score an alignment tolerant of exactly the
   * variations decision 56 calibrates against: a changed note
   * (substitution) or an inserted ornament (insertion), without requiring
   * an exact match. */
  distance: number;
  /** How many of the REFERENCE's own moving-pitch tokens (`interval !== 0`)
   * this window matches in PITCH, in order (rhythm ignored - see the
   * function body for why) - the count `MIN_MATCHED_MOTION` below checks,
   * computed as the largest such count reachable by any correspondence
   * between the window and the reference, i.e. the most generous reading
   * towards the candidate: if even that reading cannot find the
   * reference's own melodic movement, no plausible alignment could
   * either. */
  matchedMotion: number;
}

/** Same alignment `bestMatch` scores (`distance`), plus how much of the
 * REFERENCE's actual melodic movement the window contains at all
 * (`matchedMotion`), from a second, independent pass. A plain edit
 * distance cannot tell a real quote from a candidate that only
 * coincidentally shares a reference's most common token: decision 56's
 * real-corpus recalibration found that `{interval:0, rhythm:0}` (repeat
 * the last note, no rhythm change) is common enough, in both a chiptune
 * bassline's held notes and a short repetitive reference (Beethoven's
 * Fifth, Zelda's fanfare), that a distance-only score can clear
 * `KNOWN_MELODY_THRESHOLD` on those free matches alone, with the window's
 * one or two other tokens picked from thin air rather than genuinely
 * resembling the reference. `MIN_MATCHED_MOTION` uses `matchedMotion` to
 * require the window to actually contain most of the reference's real
 * melodic content, not just its filler. */
function alignmentDetail(a: MelodicToken[], b: MelodicToken[]): AlignmentResult {
  const rows = a.length + 1, cols = b.length + 1;
  let prevDist = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const curDist = new Array<number>(cols);
    curDist[0] = i;
    for (let j = 1; j < cols; j++) {
      curDist[j] = tokenEqual(a[i - 1], b[j - 1])
        ? prevDist[j - 1]
        : 1 + Math.min(prevDist[j - 1], prevDist[j], curDist[j - 1]);
    }
    prevDist = curDist;
  }
  // A second, independent alignment, scored by PITCH MOTION alone (interval
  // equality only, rhythm ignored) rather than `distance`'s exact joint
  // token match: an inserted ornament shifts the quantized rhythm bucket of
  // its neighbours (their inter-onset gaps changed) without touching their
  // pitch, so a joint-equality count would wrongly dock a candidate for a
  // pitch it never changed. `matchedMotion` below only ever gates on
  // `MIN_MATCHED_MOTION`, never contributes to `distance` or the reported
  // similarity, so relaxing it to pitch-only does not loosen the score
  // itself - only how much genuine melodic shape a window must show before
  // its distance-based score is trusted at all.
  const intervalEqual = (x: MelodicToken, y: MelodicToken) => x.interval === y.interval;
  let prevMotion = new Array<number>(cols).fill(0);
  for (let i = 1; i < rows; i++) {
    const curMotion = new Array<number>(cols);
    curMotion[0] = 0;
    for (let j = 1; j < cols; j++) {
      if (intervalEqual(a[i - 1], b[j - 1])) {
        curMotion[j] = prevMotion[j - 1] + (b[j - 1].interval !== 0 ? 1 : 0);
      } else {
        curMotion[j] = Math.max(prevMotion[j - 1], prevMotion[j], curMotion[j - 1]);
      }
    }
    prevMotion = curMotion;
  }
  return { distance: prevDist[cols - 1], matchedMotion: prevMotion[cols - 1] };
}

/** How many tokens LONGER than the reference a candidate window may be and
 * still be compared - covers one or two inserted ornaments without letting
 * the window grow so loose that it can absorb unrelated material. There is
 * no equivalent SHORTER tolerance: decision 3's calibrated variations
 * (`vary()` in `test-known-melody-similarity.mjs`) only ever substitute a
 * note or insert one, never delete one, so a window shorter than the
 * reference was pure unearned headroom - and decision 56's real-corpus
 * recalibration found it exploited: a short run from a held or
 * re-triggered note could align against only PART of a short, repetitive
 * reference (e.g. Beethoven's Fifth's "G G G Eb" motif) and clear
 * `KNOWN_MELODY_THRESHOLD` on structural coincidence, never having to
 * account for the reference's other tokens at all. Requiring the window to
 * cover the reference's full length removes that gap; see also
 * `MIN_DISTINCT_INTERVALS` below for the second, independent guard the same
 * review added. */
const WINDOW_TOLERANCE = 3;

/** A window whose notes never move in PITCH - every token has the same
 * interval, most often 0 (a single held or re-triggered note) - carries no
 * melodic information to match against anything, however many distinct
 * rhythms it has. Cheap to check before the real (`alignmentDetail`-based)
 * guard below runs the full alignment; kept as a second, independent floor
 * since it costs nothing extra. */
const MIN_DISTINCT_INTERVALS = 2;

/** The minimum fraction of a REFERENCE's own moving-pitch tokens
 * (`interval !== 0`) that a window's best alignment must actually match,
 * out of `alignmentDetail`'s `matchedMotion` (see its comment for why a
 * plain edit distance cannot tell this apart from a coincidence). A
 * genuine quote, even lightly varied (`vary()` in
 * `test-known-melody-similarity.mjs` changes at most a note or two),
 * still matches most of the reference's real movement: even
 * `beethoven-5th-motif`, the sparsest reference at only 3 moving tokens,
 * survives one changed note at 2/3 (67%). Decision 56's real-corpus
 * recalibration's degenerate windows - a chiptune bassline's held or
 * re-triggered note, dressed up with one or two unrelated blips to clear
 * `MIN_DISTINCT_INTERVALS` - matched NONE of the reference's real movement
 * (their blips were free-floating pitch jumps, not the reference's actual
 * intervals), so 0.5 sits with a full margin under every genuine quote. */
const MIN_MATCHED_MOTION = 0.5;

/** The best (highest) similarity between a candidate token sequence and one
 * reference: every window of the candidate close in length to the reference
 * is aligned against it with `alignmentDetail`, normalized to
 * `1 - distance / max(windowLength, referenceLength)` (0 = nothing alike, 1 =
 * identical), and the best window wins. This is a local alignment - it finds
 * a known melody quoted anywhere inside a longer generated part, not only
 * when the part IS the known melody start to end. A window with fewer than
 * `MIN_DISTINCT_INTERVALS` distinct pitch-interval values, or whose best
 * alignment matches less than `MIN_MATCHED_MOTION` of the reference's own
 * moving-pitch tokens (see both comments), is skipped: neither a pitch-flat
 * window nor one that only coincidentally shares the reference's held notes
 * has real melodic content in common with it. */
export function bestMatch(candidateTokens: MelodicToken[], referenceTokens: MelodicToken[]): number {
  const refLen = referenceTokens.length;
  if (refLen === 0 || candidateTokens.length === 0) return 0;
  const referenceMotion = referenceTokens.filter((t) => t.interval !== 0).length;
  const minLen = Math.min(refLen, candidateTokens.length);
  const maxLen = Math.min(candidateTokens.length, refLen + WINDOW_TOLERANCE);
  let best = 0;
  for (let len = minLen; len <= maxLen; len++) {
    for (let start = 0; start + len <= candidateTokens.length; start++) {
      const window = candidateTokens.slice(start, start + len);
      if (new Set(window.map((t) => t.interval)).size < MIN_DISTINCT_INTERVALS) continue;
      const { distance, matchedMotion } = alignmentDetail(window, referenceTokens);
      if (referenceMotion > 0 && matchedMotion / referenceMotion < MIN_MATCHED_MOTION) continue;
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
 * Set from real generations (decision 56, recalibration): the generation
 * benchmark's 188 rendered generations, every one from a prompt asking for
 * original music, are the negatives that matter, because a false positive
 * refuses a real user's generation AFTER the paid model call. Odd prompt
 * numbers were the calibration half, even numbers the held-out half, and
 * the rule was fixed before either was scored: the lowest 0.05 step at
 * least 0.05 above the calibration half's highest match. The calibration
 * max was 0.571 (a chord part's two-note oscillation against
 * `twinkle-twinkle`), so 0.65; the held-out half's max was also 0.571, so
 * 0/94 flagged. The first threshold, 0.40, flags 15/188 (8%) even with the
 * corrected references, and flagged 59/188 with the references as first
 * shipped (`./known-melodies.ts`'s file comment).
 *
 * Also measured at 0.65: 0/8 real NSF-corpus chiptunes (max 0.467) and 0/46
 * synthetic negatives (the repository's own original fixtures and
 * seeded-random tunes, max 0.286). Recall on the synthetic positives (each
 * reference transposed, re-timed and varied, then embedded in unrelated
 * material; `test-known-melody-similarity.mjs`) is 29/48 and 33/48: every
 * copy with one changed note and no ornament is caught, a transposed and
 * re-timed exact copy always measures 1.0, and what gets through is mostly
 * the heaviest paraphrase (two changed notes and an inserted ornament) and
 * the shortest reference (`beethoven-5th-motif`, six tokens, where one
 * change is a sixth of the motif). The gate is for a reproduced melody,
 * not a loose paraphrase, and refusing an original one is the costlier
 * error. The full numbers are in decision 56 (DECISIONS.md).
 */
export const KNOWN_MELODY_THRESHOLD = 0.65;

/** Refuses (returns the match) when the strongest match reaches
 * `KNOWN_MELODY_THRESHOLD`, otherwise null. Called once per generation, on
 * its output, after the score exists and before it is saved (`jobs.ts`). */
export function isKnownMelody(parts: MelodicPart[], references: KnownMelody[] = KNOWN_MELODIES): SimilarityMatch | null {
  const match = knownMelodySimilarity(parts, references);
  return match && match.similarity >= KNOWN_MELODY_THRESHOLD ? match : null;
}
