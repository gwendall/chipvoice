import assert from 'node:assert/strict';

/**
 * Compares chipvoice's own `importPsid(...).events` against an independent
 * libsidplayfp render of the same PSID/RSID (`native-oracle.mjs`), one SID
 * write at a time. Mirrors `../nsf-corpus/compare.mjs`'s own two-phase
 * shift-and-match design; the details differ because a PSID environment's
 * own ceremony and timing quirks are not the NSF ones.
 *
 * libsidplayfp's own reference driver (`psiddrv.a65`'s `cold:` routine)
 * unconditionally sets the SID's volume register to maximum ($D418=$0F)
 * once, before it ever calls INIT - real driver ceremony, not anything the
 * tune itself authored, and always the oracle trace's very first line.
 * Dropped here the same way `../nsf-corpus/compare.mjs` drops GME's own
 * reset writes.
 *
 * What is left is two clean phases, INIT then PLAY, and each needs its own
 * cycle alignment:
 *
 * INIT phase: `psid-import.ts`'s own environment starts running INIT at
 * cycle 0. libsidplayfp's `cold:` routine spends many thousands of cycles
 * first - clearing pending IRQs, priming the CIA and, distinctively,
 * deliberately waiting for a specific raster line (311) before it ever
 * calls INIT, so that a real player's audio timing does not depend on how
 * long INIT itself takes to run. That whole prelude is a constant, one-time
 * offset with no bearing on either side's own conformance; it is measured
 * from the first INIT-authored write both sides agree on (`initShift`) and
 * subtracted back out. Once removed, every INIT-phase write these two
 * fixtures produce lands on the exact same cycle - confirmed empirically
 * (see `docs/chips/c64.md`), so INIT-phase events are matched with zero
 * further tolerance.
 *
 * PLAY phase: the first real IRQ after INIT does not land at the same
 * phase-within-frame on both sides either (chipvoice's own raster model
 * counts frames from cycle 0, not from "whenever INIT happened to
 * return"), so PLAY-phase events get their own, separately measured shift
 * (`playShift`), taken from the first PLAY-phase write. From there, the two
 * sides' average frame period agrees exactly (`PAL_FRAME_CYCLES` in
 * `psid-import.ts` is exactly libsidplayfp's own raster IRQ's average
 * period), but libsidplayfp's real per-line VIC-II/CIA emulation has a
 * small, bounded per-frame wobble around that average that this
 * environment's own once-a-frame raster pulse does not reproduce cycle for
 * cycle. Rather than fold that wobble into "matched" itself (which used to
 * make a value-correct, merely-late write look identical to a real content
 * divergence, and stopped the whole scan at the first one either kind
 * produced), address/value content and PLAY-phase cycle position are now
 * two separate, independently reported measurements:
 *
 * - `matched`/`total` is content only: does this write carry the exact
 *   address and value the oracle's own trace carries, at this position in
 *   the sequence? INIT-phase writes are additionally required to land
 *   exactly on the shifted cycle (confirmed cycle-exact on every fixture
 *   measured so far), so an INIT-phase write that is right in content but
 *   off in cycle still counts against `matched` - PLAY-phase cycle position
 *   never does.
 * - `maxCycleDeviation`/`deviatingEvents`/`playTotal` describe PLAY-phase
 *   cycle position on its own, over every content-correct PLAY-phase write
 *   in the trace, regardless of how large the deviation: `gt2-dojo.sid` and
 *   `gt2-hyperspace-alt.sid` (VBI-timed) measure a maximum of a few cycles;
 *   `gt2-sanction-cia.sid` and `gt2-consultant-alt-cia.sid` (CIA-timed)
 *   measure up to 128 - a real, understood, and bounded divergence (every
 *   gap an integer multiple of one VIC-II badline's own 43-cycle DMA steal,
 *   `BADLINE_STEAL_CYCLES` in `psid-import.ts`; see `docs/chips/c64.md`'s
 *   "Known limits" and `corpus.mjs`'s own per-fixture bounds), never zero
 *   content or address mismatches either way. Callers (`corpus.mjs`) apply
 *   whatever bound suits each fixture; `compare.mjs` itself stays purely
 *   mechanical and gates nothing.
 *
 * The scan always runs to completion - it no longer stops at the first
 * divergence of either kind - so `matched`/`total` and the cycle-deviation
 * fields always describe the whole trace, not "whatever came before the
 * first problem". `firstDivergence`, when present, still names the first
 * genuine content mismatch (wrong address/value, an INIT-phase write off
 * cycle, or one side running out of writes) for a human to read.
 *
 * A probe fixture that deliberately reads out an undefined CPU register
 * (`convention-probe.sid`'s own `X`/`Y`) is not testing whether the two
 * engines agree - by design, and by both the file format spec's silence and
 * libsidplayfp's own driver's own leftover values, there is no defined
 * answer to agree on. `options.ignoreAddrs` names the SID register offsets
 * (0-31) such a fixture's INIT writes those undefined values to; a write
 * there is skipped entirely during the INIT phase only (counted separately
 * as `ignored`, never as `matched` or as a divergence), and the scan
 * carries on to the events after it instead of stopping - so a fixture with
 * one expected, spec-undefined write in its INIT no longer hides whether
 * everything else, INIT's own remaining writes and the whole PLAY phase
 * alike, actually matches.
 */
const CEREMONY = {addr: 0x18, value: 0x0f}; // `psiddrv.a65`'s own `lda #$0f / sta $d418`, before every INIT call.

export function comparePsidTrace(performance, oracleTrace, options = {}) {
  const ignoreAddrs = options.ignoreAddrs ?? new Set();
  const theirsAll = parseTrace(oracleTrace);
  if (!theirsAll.length || theirsAll[0].addr !== CEREMONY.addr || theirsAll[0].value !== CEREMONY.value) {
    throw new Error(`expected libsidplayfp's own pre-INIT $D418=$0F ceremony write as the oracle trace's first line, got ${JSON.stringify(theirsAll[0] ?? null)}`);
  }
  const theirs = theirsAll.slice(1);
  const ours = performance.events;
  const initCount = performance.initEventCount;
  const rawTotal = ours.length;

  // Measured from the first write either side reports past its own
  // ceremony, the same convention `../nsf-corpus/compare.mjs` uses: both
  // sides run the tune's own INIT/PLAY code identically, so the number of
  // cycles from INIT's own entry to its first SID write is the same on
  // both sides, making "first write" and "INIT's own entry" the same shift.
  const initShift = theirs.length && ours.length ? theirs[0].at - ours[0].at : 0;
  const playShift = theirs.length > initCount && ours.length > initCount ? theirs[initCount].at - ours[initCount].at : 0;

  let matched = 0, ignored = 0, firstDivergence = null;
  let maxCycleDeviation = 0, deviatingEvents = 0, playTotal = 0;
  for (let i = 0; i < rawTotal; i++) {
    const a = ours[i], b = theirs[i] ?? null;
    const inInit = i < initCount;
    const shift = inInit ? initShift : playShift;
    if (inInit && ignoreAddrs.has(a.addr & 0x1f)) { ignored++; continue; }
    // `a.addr` is `psid-import.ts`'s own full `$D400`-`$D7FF` address; the
    // oracle trace logs libsidplayfp's `sidemu::write`'s own 0-31 register
    // offset (`sidplayfp-harness.cpp`'s `TraceSid`). Both mirror the same
    // 32-register block, so `& 0x1f` compares like with like.
    const contentMatch = b && (a.addr & 0x1f) === b.addr && a.value === b.value;
    if (!contentMatch) {
      // A content mismatch (or the oracle running out of writes) never
      // stops the scan; it is recorded as the first one seen (if not
      // already) and counted against `matched`, but later events - which
      // may well still be content-correct - are still measured.
      if (!firstDivergence) firstDivergence = {index: i, phase: inInit ? 'init' : 'play', ours: a, oracle: b, shift};
      continue;
    }
    // `a.at + shift` (not the raw `a.at`) is what should be compared by eye
    // against `b.at`: reporting the raw, unshifted cycle here would make an
    // aligned, content-only divergence look like a huge cycle gap it is not.
    const deviation = Math.abs(a.at + shift - b.at);
    if (inInit) {
      if (deviation === 0) { matched++; continue; }
      if (!firstDivergence) firstDivergence = {index: i, phase: 'init', ours: a, oracle: b, shift};
      continue;
    }
    matched++;
    playTotal++;
    if (deviation > maxCycleDeviation) maxCycleDeviation = deviation;
    if (deviation > 0) deviatingEvents++;
  }
  return {total: rawTotal - ignored, matched, ignored, firstDivergence, initShift, playShift, maxCycleDeviation, deviatingEvents, playTotal};
}

/** Parses `sidplayfp-harness`' own `<cycle> <addr decimal> <value decimal>` lines - the same shape `../nsf-corpus/compare.mjs`'s `parseTrace` reads from `native-oracle.py`. */
export function parseTrace(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split('\n').map((line) => {
    const [at, addr, value] = line.trim().split(/\s+/).map(Number);
    assert.ok(Number.isSafeInteger(at) && Number.isInteger(addr) && Number.isInteger(value), `malformed oracle trace line: ${line}`);
    return {at, addr, value};
  });
}
