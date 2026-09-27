import assert from 'node:assert/strict';
import {comparePsidTrace} from './compare.mjs';

// A tiny synthetic INIT (2 writes) then PLAY (2 frames, one write each),
// shaped like `comparePsidTrace` expects: `performance.events` in
// `psid-import.ts`'s own {at, addr, value} shape (`addr` a full $D4xx
// address), `initEventCount` marking where PLAY's own events begin.
const performance = {
  initEventCount: 2,
  events: [
    {at: 0, addr: 0xd400, value: 10},
    {at: 4, addr: 0xd401, value: 20},
    {at: 19656, addr: 0xd404, value: 1},
    {at: 39312, addr: 0xd404, value: 2},
  ],
};

// The oracle's own $D418=$0F ceremony always comes first, at whatever
// absolute cycle its cold-start routine happens to reach it - here 1000,
// giving an `initShift` of 1100 (1100 - 0) for the INIT-phase writes that
// follow it, matched with zero further tolerance.
const exact = '1000 24 15\n1100 0 10\n1104 1 20\n21000 4 1\n40660 4 2';
assert.deepEqual(comparePsidTrace(performance, exact), {total: 4, matched: 4, ignored: 0, firstDivergence: null, initShift: 1100, playShift: 1344});

// INIT-phase writes are matched with zero tolerance: real hardware's own
// cold-start ceremony ends at a fixed point, and both engines' INIT code
// runs from there at an identical cycle cadence (confirmed empirically
// against convention-probe.sid; see docs/chips/c64.md) - even a one-cycle
// INIT-phase gap beyond the measured `initShift` is a real divergence.
const initOffByOne = '1000 24 15\n1100 0 10\n1105 1 20\n21000 4 1\n40660 4 2';
const initDivergence = comparePsidTrace(performance, initOffByOne);
assert.equal(initDivergence.matched, 1);
assert.deepEqual(initDivergence.firstDivergence, {index: 1, phase: 'init', ours: {at: 4, addr: 0xd401, value: 20}, oracle: {at: 1105, addr: 1, value: 20}, shift: 1100});

// PLAY-phase writes get a small cycle tolerance instead: chipvoice's own
// once-a-frame raster pulse is a fixed period, but a real, per-line VIC-II
// has a small, bounded wobble around that same average (a three-frame
// +1/+1/-2 pattern was measured against convention-probe.sid) that this
// environment's simpler model does not reproduce. A gap within that
// tolerance is not a divergence; a gap past it is.
const playWithinTolerance = '1000 24 15\n1100 0 10\n1104 1 20\n21000 4 1\n40664 4 2'; // +4 past playShift, within PLAY_TOLERANCE (8)
assert.deepEqual(comparePsidTrace(performance, playWithinTolerance).firstDivergence, null);

const playPastTolerance = '1000 24 15\n1100 0 10\n1104 1 20\n21000 4 1\n40672 4 2'; // +12 past playShift, past PLAY_TOLERANCE
const playDivergence = comparePsidTrace(performance, playPastTolerance);
assert.equal(playDivergence.matched, 3);
assert.deepEqual(playDivergence.firstDivergence, {index: 3, phase: 'play', ours: {at: 39312, addr: 0xd404, value: 2}, oracle: {at: 40672, addr: 4, value: 2}, shift: 1344});

// A value mismatch is always a real divergence, cycle notwithstanding - the
// same shape convention-probe.sid's own X register produces against the
// real oracle (a genuinely undefined, leftover value; see docs).
const valueMismatch = '1000 24 15\n1100 0 10\n1104 1 21\n21000 4 1\n40660 4 2';
const mismatch = comparePsidTrace(performance, valueMismatch);
assert.equal(mismatch.matched, 1);
assert.deepEqual(mismatch.firstDivergence, {index: 1, phase: 'init', ours: {at: 4, addr: 0xd401, value: 20}, oracle: {at: 1104, addr: 1, value: 21}, shift: 1100});

// `ignoreAddrs` skips a spec-undefined register's own INIT write entirely,
// past a value mismatch that would otherwise halt the scan: `ignored`
// counts it, `matched`/`total` never see it, and the scan carries on to
// find that everything after it - INIT's own remaining write and the whole
// PLAY phase - genuinely matches, the shape `convention-probe.sid`'s own
// `X` register produces against the real oracle.
const ignoredMismatch = comparePsidTrace(performance, valueMismatch, {ignoreAddrs: new Set([1])});
assert.deepEqual(ignoredMismatch, {total: 3, matched: 3, ignored: 1, firstDivergence: null, initShift: 1100, playShift: 1344});

// Only within the INIT phase: a PLAY-phase write to the same register
// offset is a different question (a real tune, not the calling convention)
// and is never silently skipped, ignoreAddrs notwithstanding.
const playPerf = {
  initEventCount: 2,
  events: [
    {at: 0, addr: 0xd400, value: 10},
    {at: 4, addr: 0xd401, value: 20},
    {at: 19656, addr: 0xd401, value: 1},
  ],
};
const playTrace = '1000 24 15\n1100 0 10\n1104 1 20\n21000 1 99';
// ignoreAddrs still skips index 1 (offset 1, INIT phase); index 2 (the same
// offset 1, but PLAY phase) is a real mismatch and is not skipped.
const playNotIgnored = comparePsidTrace(playPerf, playTrace, {ignoreAddrs: new Set([1])});
assert.deepEqual(playNotIgnored, {
  total: 2, matched: 1, ignored: 1,
  firstDivergence: {index: 2, phase: 'play', ours: {at: 19656, addr: 0xd401, value: 1}, oracle: {at: 21000, addr: 1, value: 99}, shift: 1344},
  initShift: 1100, playShift: 1344,
});

// The oracle trace running dry before ours does is a real divergence too
// (unlike nsf-corpus's GME margin, which only ever runs *past* ours -
// corpus.mjs gives the oracle a whole extra second of cycles for the same
// reason, so this should never happen for a properly budgeted run).
const short = '1000 24 15\n1100 0 10\n1104 1 20';
const shortResult = comparePsidTrace(performance, short);
assert.equal(shortResult.matched, 2);
assert.deepEqual(shortResult.firstDivergence, {index: 2, phase: 'play', ours: {at: 19656, addr: 0xd404, value: 1}, oracle: null, shift: 0});

// A missing or wrong ceremony line is refused outright, not silently
// misread as a tune-authored write.
assert.throws(() => comparePsidTrace(performance, '1100 0 10\n1104 1 20'), /ceremony/);
assert.throws(() => comparePsidTrace(performance, ''), /ceremony/);

console.log('PASS the oracle\'s own pre-INIT ceremony write is dropped; INIT-phase writes match at zero tolerance past their own shift; PLAY-phase writes tolerate the real VIC-II\'s small per-frame wobble; a value mismatch or a trace running dry is always a real divergence; ignoreAddrs skips a spec-undefined INIT write without halting the scan, and never applies to PLAY');
