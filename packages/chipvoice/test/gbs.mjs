import { recordSong, exportGbs, importGbs, GbsExportError } from '../dist/index.js';
import { compareFrameWrites } from '../../../scores/gbs-export/corpus.mjs';

/**
 * The GBS file, read back two ways: by its own header grammar (like
 * `gbs-import.mjs` parses a real file), and by actually running the
 * player's SM83 bytes through `importGbs` - the same tool
 * `scores/gbs-export/corpus.mjs` compares against the pinned GME oracle for
 * proof #1. Replaying the assembled opcodes here catches an assembler
 * mistake immediately, offline, instead of only once CI reaches the
 * network-dependent oracle.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

const CLOCK_HZ = 4194304;
const VBLANK_PERIOD = 70224;
const SONG = {
  id: 'gbs', bpm: 152, order: [0], gain: 1,
  patterns: [{
    bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
    lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc: 'K . H . S . H . K . H K S . H .',
  }],
  lead: { duty: 1, volume: [15, 14, 13], sustain: true },
  chord: { duty: 0, volume: [9, 8, 7], sustain: true },
  bass: { volume: [15], sustain: true },
};

const { events, cycles } = recordSong(SONG, { seconds: 2, chip: 'dmg' });
const frameCount = Math.ceil(cycles / VBLANK_PERIOD);
const loopAtCycle = CLOCK_HZ; // loop at the one-second mark

const file = exportGbs(events, cycles, { title: 'gbs test', author: 'the test', copyright: '2026 test', loopAtCycle });
const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
const ascii = (at, n) => String.fromCharCode(...file.subarray(at, at + n)).replace(/\0+$/, '');

// -- Header, read back by its own field layout.
check('the file starts with the GBS magic', ascii(0, 3) === 'GBS');
check('it is version 1', file[3] === 1);
check('one song, starting at song 1', file[4] === 1 && file[5] === 1);
check('the load address is $400', view.getUint16(6, true) === 0x400);
const initAddr = view.getUint16(8, true), playAddr = view.getUint16(10, true);
check('init and play addresses are in the fixed low bank', initAddr >= 0x400 && initAddr < 0x4000 && playAddr >= 0x400 && playAddr < 0x4000 && initAddr !== playAddr, `init=$${initAddr.toString(16)} play=$${playAddr.toString(16)}`);
check('the stack pointer is the standard post-boot-ROM default', view.getUint16(12, true) === 0xfffe);
check('the timer is disabled, so PLAY is paced by VBlank', (file[15] & 0x04) === 0);
check('the title, author and copyright round-trip', ascii(0x10, 32) === 'gbs test' && ascii(0x30, 32) === 'the test' && ascii(0x50, 32) === '2026 test');
check('the switchable data banks are a whole number of 16 KiB after the fixed low bank', (file.length - 112 - (0x4000 - 0x400)) % 0x4000 === 0);

// -- Actually run it: our own offline SM83, the same tool the oracle proof uses.
const seconds = Math.ceil(cycles / CLOCK_HZ) + 2;
const plan = importGbs(file, { seconds });
const commands = plan.events.filter((e) => e.at !== 0);
check('the player runs without crashing or exceeding a frame budget', commands.length > 0, `${commands.length} writes over ${plan.seconds.toFixed(1)}s`);
check('every replayed write is a real DMG APU register', commands.every((e) => e.addr >= 0xff10 && e.addr <= 0xff3f));

// The same exact-match gate `gbs-export:check` runs against GME's trace: here
// it runs against our own offline replay instead, so this stays a fast unit
// test (no network, no GME build) while still exercising the real
// `compareFrameWrites` from `scores/gbs-export/corpus.mjs`, not a hand-rolled
// stand-in for it.
const gate = compareFrameWrites(events, plan.events, cycles);
check('compareFrameWrites (the same function gbs-export:check gates CI with) matches every comparable frame exactly', gate.matched === gate.total, `${gate.matched}/${gate.total}${gate.excludedFrames ? `, ${gate.excludedFrames} excluded past the loop wrap` : ''}`);

// Negative check: a clean pass alone does not prove the gate would catch a
// real defect. Corrupt a single write in the replay - the same shape of
// corruption a wrong opcode or a bad table byte in the assembled player
// would produce - and confirm compareFrameWrites reports exactly that one
// frame as a mismatch, not a silent pass.
// The first frame's real (non-INIT-ceremony) writes only start once the
// exported player's first PLAY call runs, one VBlank after INIT - picking
// an index before that would corrupt INIT's own hardcoded power-on write,
// which no source frame is ever compared against.
const corruptedIndex = plan.events.findIndex((e) => e.at >= VBLANK_PERIOD && e.addr >= 0xff10 && e.addr <= 0xff3f);
const corruptedEvents = plan.events.map((e, i) => (i === corruptedIndex ? { ...e, value: (e.value + 1) & 0xff } : e));
const corruptedGate = compareFrameWrites(events, corruptedEvents, cycles);
check('compareFrameWrites catches a single corrupted write as exactly one mismatched frame', corruptedGate.total === gate.total && corruptedGate.matched === gate.total - 1 && corruptedGate.mismatchedFrames.length === 1, `${corruptedGate.matched}/${corruptedGate.total}, mismatched frames ${corruptedGate.mismatchedFrames.join(', ')}`);

// Looping: frames past the source's own length must repeat from the loop
// point. Bucketed here directly from the replay (not through PLAY-call
// boundaries the way `test/nsf.mjs` uses `captureNsf`'s own `calls`, since
// `importGbs` does not expose that breakdown), using the same
// `Math.floor(at / VBLANK_PERIOD)` grid `compareFrameWrites` uses.
const byFrame = (evs) => {
  const buckets = Array.from({ length: Math.ceil((seconds * CLOCK_HZ) / VBLANK_PERIOD) + 1 }, () => []);
  for (const e of evs) {
    if (e.addr < 0xff10 || e.addr > 0xff3f) continue;
    const f = Math.floor(e.at / VBLANK_PERIOD);
    if (f < buckets.length) buckets[f].push({ addr: e.addr, value: e.value });
  }
  return buckets;
};
const replayedFrames = byFrame(plan.events);
const loopFrame = (() => {
  for (let f = 0; f < frameCount; f++) {
    const start = Math.round(f * VBLANK_PERIOD), end = Math.round((f + 1) * VBLANK_PERIOD);
    if (loopAtCycle >= start && loopAtCycle < end) return f;
  }
  return frameCount - 1;
})();
// The exported player's own PLAY calls start one VBlank after INIT (the
// player is called the way `importGbs`'s own harness calls it), so the
// replay's frame index runs one ahead of `quantizeToFrames`'s (`gbs.ts`)
// source-side frame numbering - the same offset `compareFrameWrites`'s
// search recovers above; matched directly here since the harness's own
// timing is exact, not searched.
const latency = 1;
let loopOk = true, loopDetail = '';
for (let k = 0; k < 5; k++) {
  const after = replayedFrames[frameCount + latency + k] ?? [];
  const expected = replayedFrames[loopFrame + latency + k] ?? [];
  const same = after.length === expected.length && after.every((w, i) => w.addr === expected[i].addr && w.value === expected[i].value);
  if (!same) { loopOk = false; loopDetail = `frame ${frameCount + latency + k}`; break; }
}
check('past the end, playback repeats from the loop point forever', loopOk, loopDetail);

// -- Guard rails: named errors, never a silent approximation.

let loopError = null;
try { exportGbs(events, cycles, { loopAtCycle: cycles }); } catch (error) { loopError = error; }
check('a loop point at or past the capture length is rejected', loopError instanceof GbsExportError && loopError.code === 'invalid_loop_point' && loopError.limit === cycles);

let longTitleError = null;
try { exportGbs(events, cycles, { title: 'x'.repeat(32) }); } catch (error) { longTitleError = error; }
check('a title that does not leave room for the terminator is rejected', longTitleError instanceof GbsExportError && longTitleError.code === 'metadata_too_long' && longTitleError.limit === 31);

let nonAsciiError = null;
try { exportGbs(events, cycles, { title: 'café' }); } catch (error) { nonAsciiError = error; }
check('non-ASCII metadata is rejected rather than mis-encoded', nonAsciiError instanceof GbsExportError && nonAsciiError.code === 'metadata_not_ascii');

// A frame with more than 254 writes cannot be addressed by the one-byte pair count.
const overflowEvents = [];
for (let i = 0; i < 255; i++) overflowEvents.push({ at: 0, addr: 0xff10 + (i % 4), value: i & 0xff });
let overflowError = null;
try { exportGbs(overflowEvents, VBLANK_PERIOD * 2, {}); } catch (error) { overflowError = error; }
check('a frame with more than 254 writes is rejected, not truncated', overflowError instanceof GbsExportError && overflowError.code === 'frame_overflow' && overflowError.limit === 254, overflowError?.message);

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
