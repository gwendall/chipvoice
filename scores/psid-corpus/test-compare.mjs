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
// follow it, matched with zero further tolerance, and a `playShift` of 1344
// (21000 - 19656) for the PLAY-phase writes that follow those. Every write
// here is both content-correct and cycle-exact after its own phase's shift,
// so `matched` covers the whole trace and PLAY-phase cycle deviation is
// zero throughout.
const exact = '1000 24 15\n1100 0 10\n1104 1 20\n21000 4 1\n40656 4 2';
assert.deepEqual(comparePsidTrace(performance, exact), {
  total: 4, matched: 4, ignored: 0, firstDivergence: null,
  initShift: 1100, playShift: 1344,
  maxCycleDeviation: 0, deviatingEvents: 0, playTotal: 2,
});

// INIT-phase writes are matched with zero cycle tolerance: real hardware's
// own cold-start ceremony ends at a fixed point, and both engines' INIT code
// runs from there at an identical cycle cadence (confirmed empirically
// against convention-probe.sid; see docs/chips/c64.md) - even a one-cycle
// INIT-phase gap beyond the measured `initShift` is a real divergence, and
// costs that write its place in `matched`. Critically, the scan does not
// stop there: both PLAY-phase writes that follow are still content-correct
// and cycle-exact, and are still counted - this is what "stop reporting
// matched before first divergence" (the bug this full-scan design fixes)
// used to hide.
const initOffByOne = '1000 24 15\n1100 0 10\n1105 1 20\n21000 4 1\n40656 4 2';
const initDivergence = comparePsidTrace(performance, initOffByOne);
assert.deepEqual(initDivergence, {
  total: 4, matched: 3, ignored: 0,
  firstDivergence: {index: 1, phase: 'init', ours: {at: 4, addr: 0xd401, value: 20}, oracle: {at: 1105, addr: 1, value: 20}, shift: 1100},
  initShift: 1100, playShift: 1344,
  maxCycleDeviation: 0, deviatingEvents: 0, playTotal: 2,
});

// PLAY-phase writes get no cycle tolerance from `compare.mjs` itself either
// - but unlike an INIT-phase cycle gap, a PLAY-phase one is never a
// divergence and never costs the write its place in `matched`: content
// (address and value) is the only thing PLAY-phase matching cares about.
// Cycle position is instead reported on its own, in `maxCycleDeviation` and
// `deviatingEvents`, for a caller (`corpus.mjs`) to gate against whatever
// bound suits that fixture - here a lone write 43 cycles late (one VIC-II
// badline's own DMA steal, the real, understood source of exactly this
// divergence on the corpus's two CIA-timed fixtures; see docs/chips/c64.md).
const playCycleOff = '1000 24 15\n1100 0 10\n1104 1 20\n21000 4 1\n40699 4 2';
assert.deepEqual(comparePsidTrace(performance, playCycleOff), {
  total: 4, matched: 4, ignored: 0, firstDivergence: null,
  initShift: 1100, playShift: 1344,
  maxCycleDeviation: 43, deviatingEvents: 1, playTotal: 2,
});

// A value mismatch is always a real divergence, cycle notwithstanding - the
// same shape convention-probe.sid's own X register produces against the
// real oracle (a genuinely undefined, leftover value; see docs). Again, the
// scan carries on past it: the two PLAY-phase writes that follow are still
// counted.
const valueMismatch = '1000 24 15\n1100 0 10\n1104 1 21\n21000 4 1\n40656 4 2';
const mismatch = comparePsidTrace(performance, valueMismatch);
assert.deepEqual(mismatch, {
  total: 4, matched: 3, ignored: 0,
  firstDivergence: {index: 1, phase: 'init', ours: {at: 4, addr: 0xd401, value: 20}, oracle: {at: 1104, addr: 1, value: 21}, shift: 1100},
  initShift: 1100, playShift: 1344,
  maxCycleDeviation: 0, deviatingEvents: 0, playTotal: 2,
});

// `ignoreAddrs` skips a spec-undefined register's own INIT write entirely,
// past a value mismatch that would otherwise be a divergence: `ignored`
// counts it, `matched`/`total` never see it, and the scan carries on to find
// that everything after it - INIT's own remaining write and the whole PLAY
// phase - genuinely matches, the shape `convention-probe.sid`'s own `X`
// register produces against the real oracle.
const ignoredMismatch = comparePsidTrace(performance, valueMismatch, {ignoreAddrs: new Set([1])});
assert.deepEqual(ignoredMismatch, {
  total: 3, matched: 3, ignored: 1, firstDivergence: null,
  initShift: 1100, playShift: 1344,
  maxCycleDeviation: 0, deviatingEvents: 0, playTotal: 2,
});

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
// offset 1, but PLAY phase) is a real value mismatch and is not skipped.
const playNotIgnored = comparePsidTrace(playPerf, playTrace, {ignoreAddrs: new Set([1])});
assert.deepEqual(playNotIgnored, {
  total: 2, matched: 1, ignored: 1,
  firstDivergence: {index: 2, phase: 'play', ours: {at: 19656, addr: 0xd401, value: 1}, oracle: {at: 21000, addr: 1, value: 99}, shift: 1344},
  initShift: 1100, playShift: 1344,
  maxCycleDeviation: 0, deviatingEvents: 0, playTotal: 0,
});

// The oracle trace running dry before ours does is a real divergence too
// (unlike nsf-corpus's GME margin, which only ever runs *past* ours -
// corpus.mjs gives the oracle a whole extra second of cycles for the same
// reason, so this should never happen for a properly budgeted run). Both
// events past the oracle's own last line are scanned, not just the first -
// neither ever has an oracle write to compare against, so neither is ever
// matched, but the scan does not stop or throw.
const short = '1000 24 15\n1100 0 10\n1104 1 20';
const shortResult = comparePsidTrace(performance, short);
assert.deepEqual(shortResult, {
  total: 4, matched: 2, ignored: 0,
  firstDivergence: {index: 2, phase: 'play', ours: {at: 19656, addr: 0xd404, value: 1}, oracle: null, shift: 0},
  initShift: 1100, playShift: 0,
  maxCycleDeviation: 0, deviatingEvents: 0, playTotal: 0,
});

// A missing or wrong ceremony line is refused outright, not silently
// misread as a tune-authored write.
assert.throws(() => comparePsidTrace(performance, '1100 0 10\n1104 1 20'), /ceremony/);
assert.throws(() => comparePsidTrace(performance, ''), /ceremony/);

console.log('PASS the oracle\'s own pre-INIT ceremony write is dropped; the scan always runs to completion rather than stopping at the first divergence; INIT-phase writes match content and cycle position at zero tolerance past their own shift; PLAY-phase writes match on content alone, with cycle position reported separately (maxCycleDeviation/deviatingEvents/playTotal) rather than gated here; a value mismatch, an INIT-phase cycle gap, or a trace running dry all count as divergences without halting the scan; ignoreAddrs skips a spec-undefined INIT write without halting the scan, and never applies to PLAY');
