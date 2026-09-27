import { splitByVoice } from './change-stream.mjs';

/**
 * Two change streams, compared.
 *
 * A change stream is a `ChangeStream` (see `change-stream.mjs`): the value
 * of every voice on every cycle, but only where it changed, in cycle order -
 * the compact form of "the value of every voice on every cycle", which is
 * what both a digital chip and an oracle's summed deltas produce. Comparing
 * the streams is comparing the step functions they describe. Everything
 * below works on the compact columns directly, index by index, rather than
 * on one `{ cycle, voice, value }` object per change: a dense waveform can
 * hold tens of millions of changes per voice, and an object per change (plus,
 * in `bestShift`'s case, a string built from each one) was what a corpus of
 * them ran out of memory (P7-11).
 *
 * Three things come out. *Identical cycles* is the count of cycles on which
 * every compared voice has the same value in both, the sheet's headline, and
 * the same per voice. *Edges* is per voice: how many of one stream's
 * transitions the other has on the same cycle, within one cycle, or not at
 * all. And *shift* is the constant offset, within sixteen cycles, at which
 * the most edges line up exactly - which is what tells a phase convention
 * ("the oracle clocks its frames two cycles later") from a real bug, and is
 * what a person looks at first when the headline is not 100.
 */

/** @typedef {{ cycle: number, voice: number, a: number, b: number }} Divergence */
/** @typedef {{ cycle: Float64Array, value: Int32Array, length: number }} VoiceColumn */

/**
 * @param {import('./change-stream.mjs').ChangeStream} a ours
 * @param {import('./change-stream.mjs').ChangeStream} b the oracle's
 * @param {{ cycles: number, voices: number[] }} options which voice indexes to compare, over how many cycles
 */
export function compare(a, b, { cycles, voices }) {
  const count = Math.max(0, ...voices) + 1;
  const va = new Array(count).fill(0);
  const vb = new Array(count).fill(0);
  const identicalPerVoice = new Array(count).fill(0);
  const aCycle = a.cycle, aVoice = a.voice, aValue = a.value, aLen = a.length;
  const bCycle = b.cycle, bVoice = b.voice, bValue = b.value, bLen = b.length;
  let ia = 0;
  let ib = 0;
  let cursor = 0;
  let identical = 0;
  /** @type {Divergence | null} */
  let first = null;

  while (cursor < cycles) {
    while (ia < aLen && aCycle[ia] <= cursor) { va[aVoice[ia]] = aValue[ia]; ia++; }
    while (ib < bLen && bCycle[ib] <= cursor) { vb[bVoice[ib]] = bValue[ib]; ib++; }
    const nextA = ia < aLen ? aCycle[ia] : Infinity;
    const nextB = ib < bLen ? bCycle[ib] : Infinity;
    const next = Math.min(nextA, nextB, cycles);
    const span = next - cursor;

    let same = true;
    for (const v of voices) {
      if (va[v] === vb[v]) {
        identicalPerVoice[v] += span;
      } else {
        same = false;
        if (!first) first = { cycle: cursor, voice: v, a: va[v], b: vb[v] };
      }
    }
    if (same) identical += span;
    cursor = next;
  }

  const columnsA = splitByVoice(a, voices);
  const columnsB = splitByVoice(b, voices);
  const perVoice = voices.map((v) => {
    const ea = columnsA.get(v);
    const eb = columnsB.get(v);
    return { voice: v, identical: identicalPerVoice[v], ...edges(ea, eb), ...bestShift(ea, eb), runs: runs(ea, eb) };
  });
  return { cycles, identical, first, perVoice };
}

/** Edges further apart than this are in different runs: a note ended. */
const RUN_GAP = 4200;

/**
 * A voice column's changes, split at every gap wider than `RUN_GAP`, as
 * `[start, end)` index pairs into its own `cycle`/`value` arrays rather than
 * copies of them.
 *
 * @param {VoiceColumn} column
 * @returns {[number, number][]}
 */
function splitRuns(column) {
  const { cycle, length } = column;
  const out = [];
  let start = 0;
  for (let i = 1; i < length; i++) {
    if (cycle[i] - cycle[i - 1] > RUN_GAP) {
      out.push([start, i]);
      start = i;
    }
  }
  if (length > 0) out.push([start, length]);
  return out;
}

/**
 * The times a run's sequencer stepped, with the steps its edges hide put
 * back.
 *
 * A change stream only shows a step when the value changed, and the
 * triangle's sequence holds its value twice at each end - 15, 15 and 0, 0 -
 * so two of its thirty-two steps leave no edge. A run whose sequencer began
 * two steps away from the oracle's has those silent steps at different
 * places, and its edge times cannot line up position for position even
 * though every step landed on the same cycle. The period is the run's most
 * common gap; a gap of two periods is one hidden step, and it is put back
 * where it was.
 *
 * @param {Float64Array} cycle a voice column's cycles
 * @param {number} start
 * @param {number} end
 * @returns {number[]}
 */
function stepTimes(cycle, start, end) {
  const n = end - start;
  if (n < 3) {
    const times = [];
    for (let i = start; i < end; i++) times.push(cycle[i]);
    return times;
  }
  const gaps = new Map();
  for (let i = start + 1; i < end; i++) {
    const g = cycle[i] - cycle[i - 1];
    gaps.set(g, (gaps.get(g) ?? 0) + 1);
  }
  let period = 0;
  let best = 0;
  for (const [g, n2] of gaps) if (n2 > best) { best = n2; period = g; }
  const times = [cycle[start]];
  for (let i = start + 1; i < end; i++) {
    const gap = cycle[i] - cycle[i - 1];
    const steps = Math.max(1, Math.round(gap / period));
    for (let k = 1; k < steps; k++) times.push(cycle[i - 1] + Math.round((gap * k) / steps));
    times.push(cycle[i]);
  }
  return times;
}

/**
 * The same comparison, one run of edges at a time, each run allowed its own
 * shift.
 *
 * A voice that restarts at every note - the triangle, whose oracle steps at
 * once when its counters reload where the hardware waits for the timer -
 * matches nowhere on the absolute clock and everywhere once each note is
 * lined up on its first edge. That is a phase convention per note, and this
 * says so: how many runs there are, how many line up edge for edge under one
 * shift each, and the largest shift it took.
 *
 * @param {VoiceColumn} a
 * @param {VoiceColumn} b
 */
function runs(a, b) {
  const ra = splitRuns(a);
  const rb = splitRuns(b);
  let alignedTimes = 0;
  let alignedValues = 0;
  let maxShift = 0;
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    const [aStart, aEnd] = ra[i];
    const [bStart, bEnd] = rb[i];
    // Candidate shifts: line our first edge up with each of their first few,
    // and theirs with each of ours; keep the one that lines up the most step
    // times, position for position. Times first, values second: a sequencer
    // that started two steps away from the oracle's steps on the same cycles
    // with different values for the rest of the song, and that is worth
    // telling apart from a sequencer that steps at the wrong times.
    const stepsA = stepTimes(a.cycle, aStart, aEnd);
    const stepsB = stepTimes(b.cycle, bStart, bEnd);
    const candidates = new Set();
    for (let j = 0; j < Math.min(4, stepsB.length); j++) candidates.add(stepsB[j] - stepsA[0]);
    for (let j = 0; j < Math.min(4, stepsA.length); j++) candidates.add(stepsB[0] - stepsA[j]);
    const n = Math.min(stepsA.length, stepsB.length);
    let best = { shift: 0, times: -1 };
    for (const shift of candidates) {
      let times = 0;
      for (let k = 0; k < n; k++) if (stepsA[k] + shift === stepsB[k]) times++;
      if (times > best.times) best = { shift, times };
    }
    // Values, at the shift that lined the steps up: the edges themselves,
    // position for position. A sequencer two steps away from the oracle's
    // lines every step up and no value.
    let values = 0;
    const runLenA = aEnd - aStart;
    const runLenB = bEnd - bStart;
    const m = Math.min(runLenA, runLenB);
    for (let k = 0; k < m; k++) {
      if (a.cycle[aStart + k] + best.shift === b.cycle[bStart + k] && a.value[aStart + k] === b.value[bStart + k]) values++;
    }
    // Aligned: every step but the run's first and last two lines up. The
    // ends are where a note's start and stop conventions differ; the middle
    // is the waveform.
    if (best.times >= Math.max(stepsA.length, stepsB.length) - 2) {
      alignedTimes++;
      maxShift = Math.max(maxShift, Math.abs(best.shift));
      if (values >= Math.max(runLenA, runLenB) - 2) alignedValues++;
    }
  }
  return { ours: ra.length, theirs: rb.length, alignedTimes, alignedValues, maxShift };
}

/**
 * Matches one voice's transitions between the two streams, in order: the
 * same value on the same cycle is exact, within one cycle is near, and a
 * transition with no partner is only in one stream.
 *
 * @param {VoiceColumn} a
 * @param {VoiceColumn} b
 */
function edges(a, b) {
  let ia = 0;
  let ib = 0;
  let exact = 0;
  let near = 0;
  let onlyA = 0;
  let onlyB = 0;
  while (ia < a.length || ib < b.length) {
    const hasA = ia < a.length;
    const hasB = ib < b.length;
    if (hasA && hasB && Math.abs(a.cycle[ia] - b.cycle[ib]) <= 1 && a.value[ia] === b.value[ib]) {
      if (a.cycle[ia] === b.cycle[ib]) exact++;
      else near++;
      ia++;
      ib++;
    } else if (hasA && (!hasB || a.cycle[ia] < b.cycle[ib])) {
      onlyA++;
      ia++;
    } else {
      onlyB++;
      ib++;
    }
  }
  return { a: a.length, b: b.length, exact, near, onlyA, onlyB };
}

/**
 * The constant shift of the oracle's edges, within sixteen cycles either way,
 * that lines up the most of them exactly with ours - and how many that is.
 * A voice whose edges all line up at a shift of two has a two-cycle phase
 * convention, not two thousand bugs.
 *
 * The lookup used to be a `Map` keyed on a template string per edge
 * (`` `${cycle}:${value}` ``); at millions of edges the strings alone were
 * the harness's biggest allocation. It is a `Map<cycle, value>` now - a
 * numeric key needs no string, and the rare cycle with more than one value
 * (two changes of the same voice landing on the same cycle) falls back to a
 * short array only there.
 *
 * @param {VoiceColumn} a
 * @param {VoiceColumn} b
 */
function bestShift(a, b) {
  const byCycle = new Map();
  for (let i = 0; i < a.length; i++) {
    const c = a.cycle[i];
    const v = a.value[i];
    const existing = byCycle.get(c);
    if (existing === undefined) byCycle.set(c, v);
    else if (Array.isArray(existing)) { if (!existing.includes(v)) existing.push(v); }
    else if (existing !== v) byCycle.set(c, [existing, v]);
  }
  const has = (cycle, value) => {
    const existing = byCycle.get(cycle);
    if (existing === undefined) return false;
    return Array.isArray(existing) ? existing.includes(value) : existing === value;
  };
  let shift = 0;
  let aligned = 0;
  for (let s = -16; s <= 16; s++) {
    let hits = 0;
    for (let i = 0; i < b.length; i++) if (has(b.cycle[i] + s, b.value[i])) hits++;
    if (hits > aligned) {
      aligned = hits;
      shift = s;
    }
  }
  return { shift, aligned };
}

/**
 * The edges of one voice from both streams around a cycle, side by side, for
 * a person to read. Ours on the left, the oracle's on the right.
 */
export function dump(a, b, voice, around, radius = 12) {
  const ea = splitByVoice(a, [voice]).get(voice);
  const eb = splitByVoice(b, [voice]).get(voice);
  const findFirst = (column, cycle) => {
    for (let i = 0; i < column.length; i++) if (column.cycle[i] >= cycle) return i;
    return -1;
  };
  const ia = Math.max(0, findFirst(ea, around) - radius);
  const ib = Math.max(0, findFirst(eb, around) - radius);
  const lines = [];
  const rows = Math.max(0, radius * 2);
  for (let i = 0; i < rows; i++) {
    const li = ia + i;
    const ri = ib + i;
    const l = li < ea.length ? `${String(ea.cycle[li]).padStart(10)} -> ${String(ea.value[li]).padStart(2)}` : ' '.repeat(16);
    const r = ri < eb.length ? `${String(eb.cycle[ri]).padStart(10)} -> ${String(eb.value[ri]).padStart(2)}` : '';
    lines.push(`${l}    ${r}`);
  }
  return lines.join('\n');
}
