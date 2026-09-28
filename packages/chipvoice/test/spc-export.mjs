import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recordSong, exportSpc, importSpc, planPerformance, snesChip, SpcExportSizeError} from '../dist/index.js';

/**
 * `exportSpc`, proved against this package's own `importSpc`/SPC700 (the
 * real oracle's round trip lives in `packages/conform/src/spc/`, which also
 * plays the exports of the repo's own SNES content - this file only checks
 * what a unit test can, fast and offline): the write stream a real capture
 * makes round-trips through the exported file's own player program, in
 * order, on the registers and values that matter, within the stated timing
 * tolerance; oversized input is rejected with `SpcExportSizeError` rather
 * than a truncated file; the sample directory is compacted correctly.
 */
let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

const CYCLES_PER_TICK = 1024; // TIMER_TARGET=8 in chips/snes/spc-player.ts: 8000/8 = 1000 Hz = 1024 SPC cycles/tick

const SONG = {
  id: 'spc', bpm: 140, order: [0], gain: 1,
  patterns: [{
    bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
    lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc: 'K . H . S . H . K . H K S . H .',
  }],
  lead: {duty: 1, volume: [15, 14, 13], sustain: true},
  chord: {duty: 0, volume: [9, 8, 7], sustain: true},
  bass: {volume: [15], sustain: true},
};

/** `$F2`/`$F3` pairs resolved to `{cycle, reg, value}`, the same dispatch
 * `SnesChip.write()` and the player program both apply. */
function resolveWrites(events) {
  let selected;
  const out = [];
  for (const e of events) {
    if (e.addr === 0xf2) selected = e.value & 0xff;
    else if (e.addr === 0xf3 && selected !== undefined && selected < 0x80) out.push({cycle: e.at, reg: selected, value: e.value & 0xff});
  }
  return out;
}
const isSrcn = (reg) => (reg & 0x0f) === 0x04;
const isKon = (reg) => reg === 0x4c;

/** Which `(dir, srcn)` pairs a KON write actually latches - the same first
 * pass `exportSpc` makes over the write stream (search its source for
 * `usedKeys`) before it compacts anything. A capture's driver can (and in
 * practice does) issue a stray SRCN write a moment before the real one, at
 * the very same tick, that no KON ever plays - a distinct `(dir, srcn)`
 * pair that is not, in any sense a player can observe, a sample "the song
 * uses". This is what `canonicalizeSrcn` below and the "one entry per
 * distinct sample" check downstream both key off of, instead of every SRCN
 * write on sight. */
function usedSrcnKeys(writes) {
  let dir = 0;
  const voiceSrcn = new Array(8).fill(undefined);
  const voiceSrcnDir = new Array(8).fill(undefined);
  const used = new Set();
  for (const w of writes) {
    if (w.reg === 0x5d) dir = w.value;
    else if (isSrcn(w.reg)) {
      const voice = (w.reg >> 4) & 0x7;
      voiceSrcn[voice] = w.value;
      voiceSrcnDir[voice] = dir;
    } else if (isKon(w.reg)) {
      for (let voice = 0; voice < 8; voice++) {
        if ((w.value & (1 << voice)) === 0) continue;
        if (voiceSrcn[voice] === undefined) continue;
        used.add(`${voiceSrcnDir[voice]}:${voiceSrcn[voice]}`);
      }
    }
  }
  return used;
}

/** SRCN values name a slot in the original capture's own sample bank;
 * `exportSpc` legitimately renumbers them to a compact 0.. directory (see
 * its own doc comment), so a literal write-for-write comparison against the
 * original capture has to canonicalize SRCN the same way first: by
 * `(dir, srcn)` identity, in first-use order among only the pairs a KON
 * write actually latches, exactly as `exportSpc` does in its own pass over
 * the stream - a glitch SRCN write no KON ever references canonicalizes to
 * whichever real sample lands at index 0, same as the export itself. DIR
 * itself is canonicalized too: every DIR write in the exported stream
 * points at the one compacted table's own page, not whatever page the
 * original capture happened to use, so `dirPage` (read from a real DIR
 * write in the already-exported round trip, since a unit test has no other
 * way to know where `exportSpc` placed that table) replaces every DIR
 * write's value here the same way. */
function canonicalizeSrcn(writes, dirPage) {
  const used = usedSrcnKeys(writes);
  let dir = 0;
  const firstUse = new Map();
  const out = [];
  for (const w of writes) {
    if (w.reg === 0x5d) dir = w.value;
    if (w.reg === 0x5d) { out.push({...w, value: dirPage}); continue; }
    if (!isSrcn(w.reg)) { out.push(w); continue; }
    const key = `${dir}:${w.value}`;
    if (!used.has(key)) { out.push({...w, value: -1}); continue; } // fixed up below
    let index = firstUse.get(key);
    if (index === undefined) { index = firstUse.size; firstUse.set(key, index); }
    out.push({...w, value: index});
  }
  return out.map((w) => (isSrcn(w.reg) && w.value === -1 ? {...w, value: 0} : w));
}

const R_FLG = 0x6c;
const R_EDL = 0x7d;
const R_EVOLL = 0x2c;
const R_EVOLR = 0x3c;
const FLG_ECHO_DISABLE = 0x20;

/** The other compaction `exportSpc` makes (see its own doc comment next to
 * `R_EVOLL`/`R_EVOLR` in spc-export.ts): a capture whose own writes set
 * EVOLL and EVOLR to zero, explicitly, and never move either off zero
 * again has its echo buffer's ARAM footprint reclaimed - every FLG write
 * gains the echo-disable bit, every EDL write becomes 0. Neither changes
 * one output sample, since echo is EVOL-scaled and EVOL never leaves zero.
 * A literal write-for-write comparison has to canonicalize the same way
 * SRCN already is, or this harmless rewrite reads as a divergence. `SONG`
 * above plays through the real driver, which does exactly this in dry
 * space (this package's own default), so the round trip below exercises
 * it for real, not only the synthetic case check-export.mjs's own copy of
 * this function also handles. */
function canonicalizeEcho(writes) {
  let evolL = 0, evolR = 0, evolLSet = false, evolRSet = false, audible = false;
  for (const w of writes) {
    if (w.reg === R_EVOLL) { evolL = w.value & 0xff; evolLSet = true; }
    else if (w.reg === R_EVOLR) { evolR = w.value & 0xff; evolRSet = true; }
    else continue;
    if (evolL !== 0 || evolR !== 0) { audible = true; break; }
  }
  if (!(evolLSet && evolRSet && !audible)) return writes;
  return writes.map((w) => {
    if (w.reg === R_FLG) return {...w, value: (w.value | FLG_ECHO_DISABLE) & 0xff};
    if (w.reg === R_EDL) return {...w, value: 0};
    return w;
  });
}

// ---- Round trip: capture -> exportSpc -> importSpc -> our own SPC700. ----
{
  const capture = recordSong(SONG, {seconds: 3, chip: 'snes'});
  const file = exportSpc(capture.events, capture.cycles, capture.memory, {title: 'spc-export test', artist: 'chipvoice', loopAtCycle: 0});
  check('the file is the fixed .spc size (header, 64K ARAM, DSP dump, extra RAM)', file.length === 0x101c0, `${file.length}`);

  const plan = importSpc(file, {seconds: 3});
  const roundTrip = resolveWrites(plan.events.slice(plan.restoreEvents));
  const dirPage = roundTrip.find((w) => w.reg === 0x5d)?.value;
  const original = canonicalizeEcho(canonicalizeSrcn(resolveWrites(capture.events), dirPage));

  check('every write survives the round trip, none dropped or invented', roundTrip.length === original.length, `${roundTrip.length} of ${original.length}`);
  const n = Math.min(original.length, roundTrip.length);
  let sequenceOk = true;
  let maxCycleDiff = 0;
  for (let i = 0; i < n; i++) {
    if (original[i].reg !== roundTrip[i].reg || original[i].value !== roundTrip[i].value) { sequenceOk = false; break; }
    const target = Math.round(original[i].cycle / CYCLES_PER_TICK) * CYCLES_PER_TICK;
    maxCycleDiff = Math.max(maxCycleDiff, Math.abs(roundTrip[i].cycle - target));
  }
  check('same registers and values, in the same order', sequenceOk);
  // Half a tick (512 cycles) is the encoding's own rounding, unavoidable at
  // a 1 kHz tick: two writes on the same real hardware cycle that round to
  // different ticks are, by definition, at most half a tick from where
  // they landed. On top of that, `chips/snes/spc-player.ts`'s burst loop
  // (`L_BURST_LOOP`) spends real SPC700 cycles per write it dispatches
  // (read reg, write $F2, read value, write $F3, loop) - about 38 cycles
  // each, measured directly against this test's own exported stream. A
  // dense run of same-tick writes (many voices retriggering at once - an
  // 8-voice chord change is the realistic ceiling) can only be dispatched
  // as fast as that loop runs, one at a time; there is no faster way to
  // issue N register writes on a single, real, non-DMA CPU. This is why
  // this file's own synthetic song front-loads ~80 setup writes into its
  // first few ticks (deliberately: it is the worst case a real song's own
  // instrument setup or chord change can produce, not a contrived one) -
  // and, empirically, on both this song and the two full real arrangements
  // `check:spc-export` covers (mario, zelda - see that script's own numbers
  // for the third, sonic), the worst single write's drift lands at the
  // same ceiling either way: essentially 2 ticks, never more, regardless of
  // song length (mario's is 24092 writes over 88 s; zelda's is 12665 over
  // 39 s; both peak within a few cycles of each other, at ~1.95 ticks) -
  // one real all-voice retrigger's own dispatch cost, not a cost that grows
  // with how many such moments a song has. A single tick is arithmetically
  // out of reach for this case regardless of how tightly `L_BURST_LOOP` is
  // hand-tuned: even a theoretical 12-cycle-per-write loop (well under what
  // four real memory operations cost on this CPU) would still need
  // 12 * 80 = 960 of the 1024 cycles in one tick just for the burst itself,
  // leaving no room for the half-tick rounding on either side of it. Three
  // ticks is not this file's rounding error given a pass - it is a bound
  // with real margin over the measured, structural ~2-tick ceiling above.
  check('every write lands within 3 ticks of where it was rounded to', maxCycleDiff <= 3 * CYCLES_PER_TICK, `max diff ${maxCycleDiff} cycles (${(maxCycleDiff / CYCLES_PER_TICK).toFixed(2)} ticks)`);
}

// ---- Looping: played past the captured length, playback repeats from the
// loop point instead of stopping or running off the end of the stream. ----
{
  const capture = recordSong(SONG, {seconds: 3, chip: 'snes'});
  const file = exportSpc(capture.events, capture.cycles, capture.memory, {loopAtCycle: 0});
  const plan = importSpc(file, {seconds: 7}); // more than twice the 3s capture
  const roundTrip = resolveWrites(plan.events.slice(plan.restoreEvents));
  const dirPage = roundTrip.find((w) => w.reg === 0x5d)?.value;
  const original = canonicalizeEcho(canonicalizeSrcn(resolveWrites(capture.events), dirPage));

  check('playback continues well past the first pass instead of stopping', roundTrip.length > original.length, `${roundTrip.length} writes over 7s vs ${original.length} in the first 3s`);
  const secondPass = roundTrip.slice(original.length, original.length + original.length);
  const loopOk = secondPass.length === original.length && secondPass.every((w, i) => w.reg === original[i].reg && w.value === original[i].value);
  check('the loop replays the same register/value sequence from the top', loopOk, `${secondPass.length} writes in the second pass`);
}

// ---- Oversized input is rejected loudly, never truncated. ----
{
  // A dense, entirely synthetic write stream (no samples involved): enough
  // $0C (MVOLL)/$1C (MVOLR) writes, one per SPC cycle, to blow past the
  // ~64K ceiling on its own. Registers alternate so DSPADDR/DSPDATA pairs
  // resolve cleanly. Values come from a small deterministic hash of `i`
  // (not `i` itself, and not `i & 0xff`) so no run of writes is ever
  // byte-identical to an earlier one - the exporter's own back-reference
  // compaction (see spc-export.ts pass 2b) cannot fold this stream down,
  // the same way a real, mechanically-repetitive test pattern could. A
  // genuinely oversized song must still be rejected once it no longer
  // compresses away, which is the only thing this check is for.
  const events = [];
  const hash = (n) => {
    let h = (n * 2654435761) >>> 0;
    h ^= h >>> 15;
    return h & 0xff;
  };
  for (let i = 0; i < 40000; i++) {
    events.push({at: i, addr: 0xf2, value: i % 2 === 0 ? 0x0c : 0x1c});
    events.push({at: i, addr: 0xf3, value: hash(i)});
  }
  let error;
  try {
    exportSpc(events, 40000, [], {loopAtCycle: 0});
  } catch (e) {
    error = e;
  }
  check('a song that cannot fit in ARAM throws SpcExportSizeError, not a truncated file', error instanceof SpcExportSizeError, error?.constructor?.name);
  check('the error names how much was needed and the limit', typeof error?.measured === 'number' && typeof error?.limit === 'number' && error.measured > error.limit, `measured ${error?.measured} limit ${error?.limit}`);
}

// ---- The echo buffer overlapping the player/data region is also caught,
// distinctly from the plain size check above. ----
{
  const events = [
    // FLG ($6C): clear the echo-disable bit ($20) so the echo region below
    // is actually live, the same condition `echo_write` and the real
    // oracle's `clear_echo()` both gate on.
    {at: 0, addr: 0xf2, value: 0x6c}, {at: 1, addr: 0xf3, value: 0x00},
    // ESA ($6D) = $00: an echo window starting at ARAM's very first byte,
    // guaranteed to collide with the player program placed there.
    {at: 2, addr: 0xf2, value: 0x6d}, {at: 3, addr: 0xf3, value: 0x00},
    // EDL ($7D): a few KB of echo length.
    {at: 4, addr: 0xf2, value: 0x7d}, {at: 5, addr: 0xf3, value: 0x04},
  ];
  let error;
  try {
    exportSpc(events, 1000, [], {loopAtCycle: 0});
  } catch (e) {
    error = e;
  }
  check('an echo window over the player/data region throws SpcExportSizeError', error instanceof SpcExportSizeError, error?.message);
}

// ---- NEXT-24: `mario`'s real arrangement, exported in the default dry
// space, must fit. The richer factory bank's samples alone pushed its
// write-stream past the echo buffer's old, fixed $E000 reservation -
// throwing SpcExportSizeError where the previous, smaller bank fit, a
// regression, not a tradeoff. `echoNeverAudible` (see its own doc comment
// next to R_EVOLL/R_EVOLR in spc-export.ts) is what reclaims that
// reservation once a capture can never make the echo buffer's contents
// reach a listener, and mario's own dry capture - EVOLL/EVOLR written to 0
// and never moved off it, same as every dry capture - qualifies. Its round
// trip must still match the plan it was built from, the same way the
// synthetic SONG above already does; `canonicalizeEcho` is what keeps that
// comparison honest once the fix has rewritten FLG/EDL in the export. ----
{
  const score = JSON.parse(readFileSync('../../scores/arrangements/mario.json', 'utf8'));
  const plan = planPerformance(score, snesChip, {allowLoss: true});
  const cycles = Math.round(plan.seconds * snesChip.spec.clockHz);
  const loopAtCycle = Math.round(plan.loopStartSeconds * snesChip.spec.clockHz);
  let file, error;
  try {
    file = exportSpc(plan.events, cycles, plan.memory, {title: 'mario', loopAtCycle});
  } catch (e) {
    error = e;
  }
  check('mario exports in the default dry space without throwing (NEXT-24)', file !== undefined, error?.message);

  const imported = importSpc(file, {seconds: plan.seconds});
  const roundTrip = resolveWrites(imported.events.slice(imported.restoreEvents));
  const dirPage = roundTrip.find((w) => w.reg === 0x5d)?.value;
  const original = canonicalizeEcho(canonicalizeSrcn(resolveWrites(plan.events).filter((w) => w.cycle < cycles), dirPage));
  check('mario: every write survives the round trip, none dropped or invented', roundTrip.length === original.length, `${roundTrip.length} of ${original.length}`);
  const n = Math.min(original.length, roundTrip.length);
  let sequenceOk = true;
  let maxCycleDiff = 0;
  for (let i = 0; i < n; i++) {
    if (original[i].reg !== roundTrip[i].reg || original[i].value !== roundTrip[i].value) { sequenceOk = false; break; }
    const target = Math.round(original[i].cycle / CYCLES_PER_TICK) * CYCLES_PER_TICK;
    maxCycleDiff = Math.max(maxCycleDiff, Math.abs(roundTrip[i].cycle - target));
  }
  check('mario: same registers and values, in the same order (plays back identical to the direct plan)', sequenceOk);
  // Same 3-tick bound as the synthetic SONG's own round trip above - see
  // that check's doc comment for the derivation; a real, longer song does
  // not change the ceiling, only how often it is approached (see that
  // comment's own mario/zelda numbers, unaffected by this fix).
  check('mario: every write lands within 3 ticks of where it was rounded to', maxCycleDiff <= 3 * CYCLES_PER_TICK, `max diff ${maxCycleDiff} cycles (${(maxCycleDiff / CYCLES_PER_TICK).toFixed(2)} ticks)`);
}

// ---- Negative control, same arrangement: `mario` in "room" space has
// genuinely audible echo (EVOLL/EVOLR both nonzero - see SPACES.room in
// chips/snes/driver.ts), so `echoNeverAudible` never fires for it and the
// old, tighter, echo-reserved ceiling stays in force. Same song, same
// samples, same everything but the space option - dry fits (just proved
// above) and room still throws, which is what proves the ceiling was kept
// because the echo is audible, not because this particular capture merely
// grew. ----
{
  const score = JSON.parse(readFileSync('../../scores/arrangements/mario.json', 'utf8'));
  const plan = planPerformance(score, snesChip, {allowLoss: true, space: 'room'});
  const cycles = Math.round(plan.seconds * snesChip.spec.clockHz);
  const loopAtCycle = Math.round(plan.loopStartSeconds * snesChip.spec.clockHz);
  let error;
  try {
    exportSpc(plan.events, cycles, plan.memory, {title: 'mario (room)', loopAtCycle});
  } catch (e) {
    error = e;
  }
  check('mario in "room" space (genuinely audible echo) still throws SpcExportSizeError', error instanceof SpcExportSizeError, error?.message);
  // 57344 ($E000, ESA's own declared page) is the pre-fix ceiling every
  // song was held to; dry's reclaimed ceiling above is $FFC0 (65472). A
  // limit at or below the old ceiling is direct evidence the echo window
  // was kept, not just that this capture happens to be oversized (dry,
  // built from the identical score, is only 2 bytes smaller and fits).
  check('the kept ceiling is the old, echo-reserved one, not the reclaimed $FFC0 dry gets', error?.limit <= 57344, `limit ${error?.limit}`);
}

// ---- The sample directory is compacted: a sample referenced by more than
// one SRCN write is only copied into ARAM once - and a glitch SRCN write no
// KON ever latches does not get a bogus entry of its own. This SONG's own
// capture happens to exercise that glitch for real (this driver briefly
// writes a stray SRCN value to a voice a moment before the real one, at the
// same tick, that no KON ever plays), which is exactly what makes this a
// meaningful regression check rather than a synthetic one. ----
{
  const capture = recordSong(SONG, {seconds: 3, chip: 'snes'});
  const file = exportSpc(capture.events, capture.cycles, capture.memory, {loopAtCycle: 0});
  const original = resolveWrites(capture.events);
  let dir = 0;
  const rawDistinctOriginal = new Set();
  for (const w of original) {
    if (w.reg === 0x5d) dir = w.value;
    if (isSrcn(w.reg)) rawDistinctOriginal.add(`${dir}:${w.value}`);
  }
  const distinctOriginal = usedSrcnKeys(original);
  check('this capture exercises a glitch SRCN write no KON ever latches (proving the check below means something)', rawDistinctOriginal.size > distinctOriginal.size, `${rawDistinctOriginal.size} raw (dir,srcn) pairs, ${distinctOriginal.size} a KON ever references`);

  const plan = importSpc(file, {seconds: 3});
  const roundTrip = resolveWrites(plan.events.slice(plan.restoreEvents));
  const distinctExported = new Set(roundTrip.filter((w) => isSrcn(w.reg)).map((w) => w.value));
  check('the exported directory has exactly one entry per distinct sample the song uses', distinctExported.size === distinctOriginal.size, `${distinctExported.size} exported vs ${distinctOriginal.size} distinct (dir,srcn) pairs a KON references in the original`);
}

console.log(failures === 0 ? 'PASS  spc-export: round-trips the write stream, loops, and rejects oversized/overlapping input' : `FAIL  spc-export: ${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;
