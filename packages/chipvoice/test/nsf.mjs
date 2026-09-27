import { recordSong, exportNsf, NsfExportError } from '../dist/index.js';
import { captureNsf } from '../../../scores/capture-nsf.mjs';
import { compareFrameWrites } from '../../../scores/nsf-export/corpus.mjs';

/**
 * The NSF file, read back two ways: by its own header grammar (like
 * `vgm.mjs` parses `toVgm`'s output), and by actually running the player's
 * 6502 bytes through `scores/capture-nsf.mjs`'s offline CPU - the same tool
 * `scores/nsf-export/corpus.mjs` hands to the pinned GME oracle. Executing
 * the assembled opcodes here catches an assembler mistake immediately,
 * offline, instead of only once CI reaches the network-dependent oracle.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

const CPU_HZ = 1789773;
const PERIOD = (262 * 341 * 4 - 2) / 12;
const SONG = {
  id: 'nsf', bpm: 152, order: [0], gain: 1,
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

const { events, cycles } = recordSong(SONG, { seconds: 2 });
const frameCount = Math.ceil(cycles / PERIOD);
const loopAtCycle = CPU_HZ; // loop at the one-second mark

const file = exportNsf(events, cycles, { title: 'nsf test', author: 'the test', copyright: '2026 test', loopAtCycle });
const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
const ascii = (at, n) => String.fromCharCode(...file.subarray(at, at + n)).replace(/\0+$/, '');

// -- Header, read back by its own field layout.
check('the file starts with the NSF magic', ascii(0, 5) === 'NESM\x1a');
check('it is version 1', file[5] === 1);
check('one song, starting at song 1', file[6] === 1 && file[7] === 1);
check('the load address is $8000', view.getUint16(8, true) === 0x8000);
const initAddr = view.getUint16(10, true), playAddr = view.getUint16(12, true);
check('init and play addresses are in ROM', initAddr >= 0x8000 && initAddr < 0x9000 && playAddr >= 0x8000 && playAddr < 0x9000 && initAddr !== playAddr, `init=$${initAddr.toString(16)} play=$${playAddr.toString(16)}`);
check('the title, author and copyright round-trip', ascii(14, 32) === 'nsf test' && ascii(46, 32) === 'the test' && ascii(78, 32) === '2026 test');
check('the NTSC speed is the standard $411a rate', view.getUint16(110, true) === 16666);
check('NTSC only, no expansion sound chip', file[122] === 0 && file[123] === 0);
check('bank register 1 starts on the first data page, the rest on the code page', file[112 + 1] === 1 && [0, 2, 3, 4, 5, 6, 7].every((r) => file[112 + r] === 0));
check('the file is a whole number of 4 KiB banks after the header', (file.length - 128) % 4096 === 0);

// -- Actually run it: our own offline 6502, the same tool the oracle proof uses.
const played = captureNsf(file, { frames: frameCount + 5, track: 0 });
const commands = played.events.filter((e) => e.at !== 0);
check('the player runs without crashing or exceeding a frame budget', commands.length > 0, `${commands.length} commands over ${played.calls.length} PLAY calls`);
check('every replayed write is a real 2A03 register', commands.every((e) => e.addr >= 0x4000 && e.addr <= 0x4017));

// The source capture's own writes, per frame, the same way exportNsf buckets them.
const originalFrames = Array.from({ length: frameCount }, () => []);
for (const e of events) {
  if (e.addr < 0x4000 || e.addr > 0x4017) continue;
  let f = 0;
  while (f + 1 < frameCount && Math.round((f + 1) * PERIOD) <= e.at) f++;
  originalFrames[f].push({ addr: e.addr, value: e.value & 0xff });
}
const replayedFrames = played.calls.map((c) => played.events.slice(c.first, c.end).map((e) => ({ addr: e.addr, value: e.value })));

let firstMismatch = -1;
for (let f = 0; f < frameCount; f++) {
  const a = originalFrames[f], b = replayedFrames[f] ?? [];
  const same = a.length === b.length && a.every((w, i) => w.addr === b[i].addr && w.value === b[i].value);
  if (!same) { firstMismatch = f; break; }
}
check('every frame up to the export replays the source capture\'s own writes, in order', firstMismatch === -1, `first mismatch at frame ${firstMismatch}`);

// The same exact-match gate `nsf-export:check` runs against GME's trace
// (round 3): here it runs against our own offline replay instead, so this
// stays a fast unit test (no network, no GME build) while still exercising
// the real `compareFrameWrites` from `scores/nsf-export/corpus.mjs`, not a
// hand-rolled stand-in for it.
const gate = compareFrameWrites(events, played.events, cycles);
check('compareFrameWrites (the same function nsf-export:check gates CI with) matches every comparable frame exactly', gate.matched === gate.total, `${gate.matched}/${gate.total}${gate.excludedFrames ? `, ${gate.excludedFrames} excluded past the loop wrap` : ''}`);

// Negative check (round 3 item 4): a clean pass alone does not prove the
// gate would catch a real defect. Corrupt a single write in the replay -
// the same shape of corruption a wrong opcode or a bad table byte in the
// assembled player would produce - and confirm compareFrameWrites reports
// exactly that one frame as a mismatch, not a silent pass.
const corruptedCallIndex = played.calls.findIndex((c) => c.end > c.first);
const corruptedWriteIndex = played.calls[corruptedCallIndex].first;
const corruptedEvents = played.events.map((e, i) => (i === corruptedWriteIndex ? { ...e, value: (e.value + 1) & 0xff } : e));
const corruptedGate = compareFrameWrites(events, corruptedEvents, cycles);
check('compareFrameWrites catches a single corrupted write as exactly one mismatched frame', corruptedGate.total === gate.total && corruptedGate.matched === gate.total - 1 && corruptedGate.mismatchedFrames.length === 1, `${corruptedGate.matched}/${corruptedGate.total}, mismatched frames ${corruptedGate.mismatchedFrames.join(', ')}`);

// Looping: frames past the source's own length must repeat from the loop point.
const loopFrame = (() => {
  for (let f = 0; f < frameCount; f++) {
    const start = Math.round(f * PERIOD), end = Math.round((f + 1) * PERIOD);
    if (loopAtCycle >= start && loopAtCycle < end) return f;
  }
  return frameCount - 1;
})();
let loopOk = true, loopDetail = '';
for (let k = 0; k < 5; k++) {
  const after = replayedFrames[frameCount + k] ?? [];
  const expected = replayedFrames[loopFrame + k] ?? [];
  const same = after.length === expected.length && after.every((w, i) => w.addr === expected[i].addr && w.value === expected[i].value);
  if (!same) { loopOk = false; loopDetail = `frame ${frameCount + k}`; break; }
}
check('past the end, playback repeats from the loop point forever', loopOk, loopDetail);

// -- Guard rails: named errors, never a silent approximation.

// DMC/DPCM sample playback is autonomous hardware DMA: the player does not
// need to do anything mid-frame for it, only the sample bytes physically
// present where the DMA will read them. Reads a byte back through the
// file's own header bank table, generically - not nsf.ts's internal
// register/page choices - the same way a real NSF player would.
const readDmcAddr = (file, addr) => file[128 + file[112 + ((addr - 0x8000) >> 12)] * 4096 + (addr & 0xfff)];

const dmcEvents = [...events, { at: cycles / 2, addr: 0x4015, value: 0x1f }];
let dmcError = null;
try { exportNsf(dmcEvents, cycles, {}); } catch (error) { dmcError = error; }
check('enabling DMC via $4015 without sample memory is rejected loudly, not silently dropped', dmcError instanceof NsfExportError && dmcError.code === 'dmc_sample_missing', dmcError?.message);

const harmlessDmcClear = [...events, { at: cycles / 2, addr: 0x4010, value: 0 }, { at: cycles / 2, addr: 0x4011, value: 0 }, { at: cycles / 2, addr: 0x4012, value: 0 }, { at: cycles / 2, addr: 0x4013, value: 0 }];
let harmlessError = null;
try { exportNsf(harmlessDmcClear, cycles, {}); } catch (error) { harmlessError = error; }
check('clearing $4010-$4013 without enabling DMC is not DMC playback and exports cleanly', harmlessError === null, harmlessError?.message);

// A capture that carries its DMC sample memory exports normally: the bytes
// land at their real address in the fixed upper bank, readable through the
// file's own header exactly like the player's DMA read would find them.
const dmcSample = new Uint8Array(48).map((_, i) => (i * 7 + 3) & 0xff);
const dmcFile = exportNsf(dmcEvents, cycles, { memory: [{ address: 0xc100, bytes: dmcSample }] });
let sampleRoundTrips = true, sampleMismatch = -1;
for (let i = 0; i < dmcSample.length; i++) {
  if (readDmcAddr(dmcFile, 0xc100 + i) !== dmcSample[i]) { sampleRoundTrips = false; sampleMismatch = i; break; }
}
check('DMC sample memory is embedded at its real address in a fixed upper bank', sampleRoundTrips, `first mismatch at offset ${sampleMismatch}`);
check('the fixed upper bank is zero outside the supplied sample bytes', readDmcAddr(dmcFile, 0xffff) === 0 && readDmcAddr(dmcFile, 0xc000) === 0);

let streamError = null;
const streamingEvents = [...events];
for (let i = 0; i < 10; i++) streamingEvents.push({ at: i * 10, addr: 0x4011, value: i * 8 });
try { exportNsf(streamingEvents, cycles, {}); } catch (error) { streamError = error; }
check('raw $4011 PCM streaming within a frame is rejected by name, not exported as a slow-motion approximation', streamError instanceof NsfExportError && streamError.code === 'dmc_unsupported' && streamError.measured === 10 && streamError.limit === 4, streamError?.message);

let rangeError = null;
try { exportNsf(events, cycles, { memory: [{ address: 0xb000, bytes: new Uint8Array(16) }] }); } catch (error) { rangeError = error; }
check('DMC sample memory outside $C000-$FFFF is rejected, not silently relocated', rangeError instanceof NsfExportError && rangeError.code === 'dmc_unsupported' && rangeError.measured === 0xb000 && rangeError.limit === 0xc000, rangeError?.message);

let loopError = null;
try { exportNsf(events, cycles, { loopAtCycle: cycles }); } catch (error) { loopError = error; }
check('a loop point at or past the capture length is rejected', loopError instanceof NsfExportError && loopError.code === 'invalid_loop_point' && loopError.limit === cycles);

let longTitleError = null;
try { exportNsf(events, cycles, { title: 'x'.repeat(32) }); } catch (error) { longTitleError = error; }
check('a title that does not leave room for the terminator is rejected', longTitleError instanceof NsfExportError && longTitleError.code === 'metadata_too_long' && longTitleError.limit === 31);

let nonAsciiError = null;
try { exportNsf(events, cycles, { title: 'café' }); } catch (error) { nonAsciiError = error; }
check('non-ASCII metadata is rejected rather than mis-encoded', nonAsciiError instanceof NsfExportError && nonAsciiError.code === 'metadata_not_ascii');

// A frame with more than 254 writes cannot be addressed by the one-byte pair count.
const overflowEvents = [];
for (let i = 0; i < 255; i++) overflowEvents.push({ at: 0, addr: 0x4000 + (i % 4), value: i & 0xff });
let overflowError = null;
try { exportNsf(overflowEvents, PERIOD * 2, {}); } catch (error) { overflowError = error; }
check('a frame with more than 254 writes is rejected, not truncated', overflowError instanceof NsfExportError && overflowError.code === 'frame_overflow' && overflowError.limit === 254, overflowError?.message);

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
