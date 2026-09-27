import assert from 'node:assert/strict';

/** Compares our own captured DMG APU write stream (`importGbs`) against an
 * independent GBS player, Game_Music_Emu's `Gbs_Emu`, one write at a time.
 *
 * Both sides run their own power-on ceremony before a GBS's INIT ever runs
 * (ours: `gbs-import.ts`'s twelve boot-ROM register writes, all stamped at
 * cycle 0; GME's own `Gb_Apu` construction writes its own reset pattern,
 * also at time 0), and neither carries source-program information, so both
 * are dropped by cycle before matching - the same convention
 * `scores/nsf-corpus/compare.mjs` uses for the 2A03, for the same reason.
 *
 * What remains is compared positionally from the first post-ceremony write.
 * `scores/nsf-corpus/compare.mjs` found, for the 2A03, that a from-documents
 * core and GME's own driver time only their INIT-phase writes a small,
 * constant number of cycles apart, settling to exact agreement from the
 * first PLAY call on; the same slide-and-compare shape is applied here for
 * the same reason. It does not, however, hold the way it did for NSF: on the
 * one file this corpus carries so far, our SM83 - self-verified opcode by
 * opcode against Pan Docs' own M-cycle table in `test/cpu-gb.mjs` - times
 * every `LD r,n`/`LDH` pair a fixed, larger number of T-cycles than GME's own
 * `Gb_Cpu` does, and that gap persists into the PLAY-phase steady state
 * rather than closing the way NSF's did; it stays bounded and never drifts
 * across a six-second capture, but it is real, not a start-of-run artifact,
 * and the exact-cycle score below reports it plainly rather than sliding it
 * away. `valueMatched` gives the same comparison ignoring `at` entirely - the
 * two write streams still agree on every address and value, in the same
 * order, for the file's whole run - which is what actually shows the CPU
 * decoded and ran the program correctly; the cycle-exact score on top of that
 * is a stricter, and here largely unmet, timing claim. */
export function compareGbsTrace(plan, period, gmeTrace) {
  const ours = plan.events.filter(e => e.at !== 0);
  const initPhaseCount = ours.filter(e => e.at < period).length;
  const theirs = parseTrace(gmeTrace).filter(e => e.at !== 0);
  const shift = initPhaseCount > 0 && theirs.length && Math.abs(theirs[0].at - ours[0].at) <= 24 ? theirs[0].at - ours[0].at : 0;
  const total = ours.length;
  let matched = 0, valueMatched = 0, firstDivergence = null;
  for (let i = 0; i < total; i++) {
    const a = ours[i], b = theirs[i] ?? null;
    const s = i < initPhaseCount ? shift : 0;
    const sameValue = b && a.addr === b.addr && a.value === b.value;
    if (sameValue) valueMatched++;
    if (sameValue && a.at + s === b.at) { matched++; continue; }
    if (firstDivergence === null) firstDivergence = {index: i, ours: a, gme: b};
  }
  return {total, matched, valueMatched, firstDivergence, shift};
}

/** Parses `native-oracle-gbs.py`'s `<cycle> <addr decimal> <value decimal>` lines. */
export function parseTrace(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split('\n').map(line => {
    const [at, addr, value] = line.trim().split(/\s+/).map(Number);
    assert.ok(Number.isSafeInteger(at) && Number.isInteger(addr) && Number.isInteger(value), `malformed GME trace line: ${line}`);
    return {at, addr, value};
  });
}
