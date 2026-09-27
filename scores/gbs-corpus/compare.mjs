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
 * one file this corpus carries so far, every write is an `LDH (n),A`
 * (opcode `$E0`) and our SM83 - self-verified opcode by opcode against Pan
 * Docs' own M-cycle table in `test/cpu-gb.mjs` - disagrees with GME's own
 * `Gb_Cpu` on when each one lands, by an amount that grows and resets rather
 * than sitting at one offset: at a single fixed PC, the measured delta
 * (ours minus GME) takes four different values (21, 22, 23 and 24 T-cycles)
 * across different frames of the same six-second capture, ruling out "same
 * instruction length, different point in it stamped" as the explanation -
 * that theory predicts one constant per opcode, not four. Reading GME's own
 * `Gb_Cpu.cpp` (revision `fe8da4b6d3876d7542c2fb69d94487e19836d678`, cited
 * by revision and not vendored, per decision 41 and the same convention
 * `native-oracle-gbs.py` already uses to fetch it) shows why: its dispatch
 * loop charges a flat `clocks_per_instr = 4` T-cycles per complete
 * instruction, once, at the top of the loop before that instruction's own
 * body runs - for every opcode, undocumented-CB included, regardless of its
 * real Pan Docs M-cycle length. A `LD r,n` (8T on real hardware) and a `JP`
 * (16T) cost GME's clock the same 4T. That is a genuine difference in timing
 * model, not a convention this file could adjust for: because the error per
 * instruction depends on which instructions ran, not on which opcode is
 * doing the writing, the accumulated gap at any one `$E0` depends on the
 * frame's control flow since the last point the two clocks agreed, so no
 * single per-opcode or per-address offset closes it. `matched` below is
 * reported raw, with no such adjustment attempted; `instr_timing`, run
 * against real Game Boy hardware behaviour in
 * `packages/conform/src/roms/cpu-instrs.mjs` (see `docs/chips/dmg.md`'s Test
 * ROMs section), is what actually settles whether our own timing is
 * correct, independently of GME. `valueMatched` gives the same comparison
 * ignoring `at` entirely - the two write streams still agree on every
 * address and value, in the same order, for the file's whole run - which is
 * what actually shows the CPU decoded and ran the program correctly; the
 * cycle-exact score on top of that is a stricter, and here largely unmet,
 * timing claim against an oracle whose own timing model this finding shows
 * is not the right target for it. */
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
