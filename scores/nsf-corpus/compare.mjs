import assert from 'node:assert/strict';

/** Compares our own captured 2A03 command stream against an independent
 * GME render of the same NSF, one command at a time.
 *
 * Every NSF player performs its own power-on ceremony before the source's
 * INIT routine ever runs, and ours disagrees with GME's in its exact shape:
 * `capture-nsf.mjs` seeds $4000-$4013=0 once plus $4015=15, $4017=0x40;
 * GME's `Nes_Apu::reset` writes $4017=0, $4015=0, then $4000/$4004/$4008/
 * $400C/$4010=0x10 and the rest of $4000-$4013=0, and Game_Music_Emu calls
 * that reset twice (once from `Classic_Emu::start_track_`, once from
 * `Nsf_Emu::start_track_` itself). Neither ceremony carries source-program
 * information, so both are dropped by cycle (every ceremony write lands at
 * cycle 0; no real 6502 store can complete that fast) before matching.
 *
 * What remains is the source driver's own command stream, in order. Unlike
 * ../arrangements/compare-native.mjs, this does not resynchronize on a
 * driver-specific marker byte (that script's Mario-only `$4017===255`
 * write does not generalize to other drivers); commands are compared
 * positionally from the first post-ceremony write in each trace.
 *
 * That first comparison is not made at face value, though. Running this
 * comparator against eight real, independently authored NSFs (two drivers,
 * FamiTracker and Pently) turned up a small, exactly constant, universal
 * gap: every write GME logs while INIT is still running lands exactly one
 * cycle later than ours, every single time, on every file; from the first
 * PLAY call onward the two sides agree to the exact cycle with zero gap,
 * because `capture-nsf.mjs` recomputes each PLAY call's timestamp from its
 * own post-INIT origin and the shared NTSC frame period, independent of
 * GME's own INIT-phase count. GME's countdown-based 6502 core (`Nes_Cpu.cpp`,
 * `s_time`/`s.base`) times a register write's cycle differently at the very
 * start of a run than `cpu6502.mjs` does; that is a fixed difference in
 * where each side's clock calls "cycle zero" for a fresh track, not a
 * missing or extra command, and Mario's and Zelda's own cycle-exact proof
 * (decision 29) never has to name it because its marker-relative comparison
 * cancels any constant offset automatically. This comparator does the same
 * thing deliberately instead of by accident: it measures the gap between
 * the very first command each side reports and slides GME's cycles by that
 * amount, but only for the events `capture-nsf.mjs` recorded while INIT was
 * still running (`capture.calls[0].first` marks where the first PLAY call's
 * own events begin) - PLAY-phase events already agree with a zero gap, and
 * shifting them too would turn an exact match into a manufactured one. A
 * gap wider than one 6502 instruction (8 cycles) is not this convention -
 * it is a real misalignment - so it is left unadjusted and reported as a
 * divergence like any other.
 *
 * `corpus.mjs` asks GME to render a little longer than our own capture's
 * fixed `frames` budget (a whole extra second of margin, so rounding never
 * cuts GME's trace short of ours); that means GME's trace legitimately runs
 * on past the point where our own, frame-bounded capture stops. That is not
 * a divergence either, so `total` is our own command count, not the longer
 * of the two - only a GME trace that runs dry *before* ours does is a real
 * problem, and still ends the comparison right there. */
export function compareNsfTrace(capture, gmeTrace) {
  const playStartsAt = capture.calls?.[0]?.first ?? Infinity;
  const ours = capture.events.filter(e => e.at !== 0);
  const initPhaseCount = capture.events.filter((e, index) => e.at !== 0 && index < playStartsAt).length;
  const theirs = parseTrace(gmeTrace).filter(e => e.at !== 0);
  const shift = initPhaseCount > 0 && theirs.length && Math.abs(theirs[0].at - ours[0].at) <= 8 ? theirs[0].at - ours[0].at : 0;
  const total = ours.length;
  let matched = 0, firstDivergence = null;
  for (let i = 0; i < total; i++) {
    const a = ours[i], b = theirs[i] ?? null;
    const s = i < initPhaseCount ? shift : 0;
    if (b && a.at + s === b.at && a.addr === b.addr && a.value === b.value) { matched++; continue; }
    firstDivergence = {index: i, ours: a, gme: b};
    break;
  }
  return {total, matched, firstDivergence, shift};
}

/** Parses `native-oracle.py`'s `<cycle> <addr decimal> <value decimal>` lines. */
export function parseTrace(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split('\n').map(line => {
    const [at, addr, value] = line.trim().split(/\s+/).map(Number);
    assert.ok(Number.isSafeInteger(at) && Number.isInteger(addr) && Number.isInteger(value), `malformed GME trace line: ${line}`);
    return {at, addr, value};
  });
}
