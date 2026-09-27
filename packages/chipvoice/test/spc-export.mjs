import assert from 'node:assert/strict';
import {recordSong, exportSpc, importSpc, SpcExportSizeError} from '../dist/index.js';

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

// ---- Round trip: capture -> exportSpc -> importSpc -> our own SPC700. ----
{
  const capture = recordSong(SONG, {seconds: 3, chip: 'snes'});
  const file = exportSpc(capture.events, capture.cycles, capture.memory, {title: 'spc-export test', artist: 'chipvoice', loopAtCycle: 0});
  check('the file is the fixed .spc size (header, 64K ARAM, DSP dump, extra RAM)', file.length === 0x101c0, `${file.length}`);

  const plan = importSpc(file, {seconds: 3});
  const roundTrip = resolveWrites(plan.events.slice(plan.restoreEvents));
  const dirPage = roundTrip.find((w) => w.reg === 0x5d)?.value;
  const original = canonicalizeSrcn(resolveWrites(capture.events), dirPage);

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
  // Half a tick (512 cycles) is the encoding's own rounding; the player's
  // polling loop (chips/snes/spc-player.ts) adds a small, bounded amount of
  // per-event instruction latency on top (reading a delta/reg/value byte
  // and issuing the write costs real cycles nothing subtracts from the next
  // wait), empirically a few ticks total across a few hundred writes, not
  // growing per write - 16 ticks (16 ms) leaves ample margin.
  check('every write lands within 16 ticks of where it was rounded to', maxCycleDiff <= 16 * CYCLES_PER_TICK, `max diff ${maxCycleDiff} cycles (${(maxCycleDiff / CYCLES_PER_TICK).toFixed(2)} ticks)`);
}

// ---- Looping: played past the captured length, playback repeats from the
// loop point instead of stopping or running off the end of the stream. ----
{
  const capture = recordSong(SONG, {seconds: 3, chip: 'snes'});
  const file = exportSpc(capture.events, capture.cycles, capture.memory, {loopAtCycle: 0});
  const plan = importSpc(file, {seconds: 7}); // more than twice the 3s capture
  const roundTrip = resolveWrites(plan.events.slice(plan.restoreEvents));
  const dirPage = roundTrip.find((w) => w.reg === 0x5d)?.value;
  const original = canonicalizeSrcn(resolveWrites(capture.events), dirPage);

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
  // resolve cleanly.
  const events = [];
  for (let i = 0; i < 40000; i++) {
    events.push({at: i, addr: 0xf2, value: i % 2 === 0 ? 0x0c : 0x1c});
    events.push({at: i, addr: 0xf3, value: i & 0xff});
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
