/**
 * Two change streams, compared.
 *
 * A change stream is a list of `{ cycle, voice, value }` in cycle order: the
 * compact form of "the value of every voice on every cycle", which is what
 * both a digital chip and an oracle's summed deltas produce. Comparing the
 * streams is comparing the step functions they describe.
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

/**
 * @typedef {{ cycle: number, voice: number, value: number }} Change
 * @typedef {{ cycle: number, voice: number, a: number, b: number }} Divergence
 */

/**
 * @param {Change[]} a ours
 * @param {Change[]} b the oracle's
 * @param {{ cycles: number, voices: number[] }} options which voice indexes to compare, over how many cycles
 */
export function compare(a, b, { cycles, voices }) {
  const count = Math.max(0, ...voices) + 1;
  const va = new Array(count).fill(0);
  const vb = new Array(count).fill(0);
  const identicalPerVoice = new Array(count).fill(0);
  let ia = 0;
  let ib = 0;
  let cursor = 0;
  let identical = 0;
  /** @type {Divergence | null} */
  let first = null;

  while (cursor < cycles) {
    while (ia < a.length && a[ia].cycle <= cursor) { va[a[ia].voice] = a[ia].value; ia++; }
    while (ib < b.length && b[ib].cycle <= cursor) { vb[b[ib].voice] = b[ib].value; ib++; }
    const nextA = ia < a.length ? a[ia].cycle : Infinity;
    const nextB = ib < b.length ? b[ib].cycle : Infinity;
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

  const perVoice = voices.map((v) => {
    const ea = a.filter((c) => c.voice === v);
    const eb = b.filter((c) => c.voice === v);
    return { voice: v, identical: identicalPerVoice[v], ...edges(ea, eb), ...bestShift(ea, eb), runs: runs(ea, eb) };
  });
  return { cycles, identical, first, perVoice };
}

/** Edges further apart than this are in different runs: a note ended. */
const RUN_GAP = 4200;

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
 */
function runs(a, b) {
  const split = (list) => {
    const out = [];
    let current = [];
    for (const e of list) {
      if (current.length > 0 && e.cycle - current[current.length - 1].cycle > RUN_GAP) {
        out.push(current);
        current = [];
      }
      current.push(e);
    }
    if (current.length > 0) out.push(current);
    return out;
  };
  const ra = split(a);
  const rb = split(b);
  let alignedTimes = 0;
  let alignedValues = 0;
  let maxShift = 0;
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    const ours = ra[i];
    const theirs = rb[i];
    // Candidate shifts: line our first edge up with each of their first few,
    // and theirs with each of ours; keep the one that lines up the most step
    // times, position for position. Times first, values second: a sequencer
    // that started two steps away from the oracle's steps on the same cycles
    // with different values for the rest of the song, and that is worth
    // telling apart from a sequencer that steps at the wrong times.
    const candidates = new Set();
    for (let j = 0; j < Math.min(4, theirs.length); j++) candidates.add(theirs[j].cycle - ours[0].cycle);
    for (let j = 0; j < Math.min(4, ours.length); j++) candidates.add(theirs[0].cycle - ours[j].cycle);
    const n = Math.min(ours.length, theirs.length);
    let best = { shift: 0, times: -1, values: 0 };
    for (const shift of candidates) {
      let times = 0;
      let values = 0;
      for (let k = 0; k < n; k++) {
        if (ours[k].cycle + shift === theirs[k].cycle) {
          times++;
          if (ours[k].value === theirs[k].value) values++;
        }
      }
      if (times > best.times) best = { shift, times, values };
    }
    // Aligned: every edge but the run's first and last two lines up. The
    // ends are where a note's start and stop conventions differ; the middle
    // is the waveform.
    const needed = Math.max(ours.length, theirs.length) - 2;
    if (best.times >= needed) {
      alignedTimes++;
      maxShift = Math.max(maxShift, Math.abs(best.shift));
      if (best.values >= needed) alignedValues++;
    }
  }
  return { ours: ra.length, theirs: rb.length, alignedTimes, alignedValues, maxShift };
}

/**
 * Matches one voice's transitions between the two streams, in order: the
 * same value on the same cycle is exact, within one cycle is near, and a
 * transition with no partner is only in one stream.
 */
function edges(a, b) {
  let ia = 0;
  let ib = 0;
  let exact = 0;
  let near = 0;
  let onlyA = 0;
  let onlyB = 0;
  while (ia < a.length || ib < b.length) {
    const ea = a[ia];
    const eb = b[ib];
    if (ea && eb && Math.abs(ea.cycle - eb.cycle) <= 1 && ea.value === eb.value) {
      if (ea.cycle === eb.cycle) exact++;
      else near++;
      ia++;
      ib++;
    } else if (ea && (!eb || ea.cycle < eb.cycle)) {
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
 */
function bestShift(a, b) {
  const byCycle = new Map();
  for (const e of a) byCycle.set(`${e.cycle}:${e.value}`, true);
  let shift = 0;
  let aligned = 0;
  for (let s = -16; s <= 16; s++) {
    let hits = 0;
    for (const e of b) if (byCycle.has(`${e.cycle + s}:${e.value}`)) hits++;
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
  const ea = a.filter((c) => c.voice === voice);
  const eb = b.filter((c) => c.voice === voice);
  const ia = Math.max(0, ea.findIndex((c) => c.cycle >= around) - radius);
  const ib = Math.max(0, eb.findIndex((c) => c.cycle >= around) - radius);
  const lines = [];
  const rows = Math.max(0, radius * 2);
  for (let i = 0; i < rows; i++) {
    const l = ea[ia + i];
    const r = eb[ib + i];
    lines.push(
      `${l ? `${String(l.cycle).padStart(10)} -> ${String(l.value).padStart(2)}` : ' '.repeat(16)}    ${r ? `${String(r.cycle).padStart(10)} -> ${String(r.value).padStart(2)}` : ''}`,
    );
  }
  return lines.join('\n');
}
