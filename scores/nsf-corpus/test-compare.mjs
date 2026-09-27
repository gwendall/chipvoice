import assert from 'node:assert/strict';
import {compareNsfTrace} from './compare.mjs';

const capture = {
  events: [
    {at: 0, addr: 0x4000, value: 0}, {at: 0, addr: 0x4015, value: 15}, {at: 0, addr: 0x4017, value: 0x40},
    {at: 5, addr: 0x4000, value: 15}, {at: 29780, addr: 0x4002, value: 1},
  ],
  // Event index 4 (the PLAY-phase write at cycle 29780) is where the first
  // PLAY call's own events begin; index 3 (cycle 5) is still INIT running.
  calls: [{at: 29780, first: 4, end: 5}],
};

const exact = '0 16407 0\n0 16405 0\n0 16384 16\n5 16384 15\n29780 16386 1';
assert.deepEqual(compareNsfTrace(capture, exact), {total: 2, matched: 2, firstDivergence: null, shift: 0});

const shortTrace = '0 16407 0\n5 16384 15';
const short = compareNsfTrace(capture, shortTrace);
assert.equal(short.matched, 1);
assert.deepEqual(short.firstDivergence, {index: 1, ours: {at: 29780, addr: 0x4002, value: 1}, gme: null});

const wrongValue = '0 16407 0\n5 16384 14\n29780 16386 1';
const divergent = compareNsfTrace(capture, wrongValue);
assert.equal(divergent.matched, 0);
assert.deepEqual(divergent.firstDivergence, {index: 0, ours: {at: 5, addr: 0x4000, value: 15}, gme: {at: 5, addr: 0x4000, value: 14}});

assert.deepEqual(compareNsfTrace({events: []}, ''), {total: 0, matched: 0, firstDivergence: null, shift: 0});

// Every real corpus file shows GME logging its INIT-phase writes exactly one
// cycle later than ours, and agreeing exactly from the first PLAY call on;
// a small constant gap like that is absorbed, not reported as a divergence.
const shiftedByOne = '0 16407 0\n6 16384 15\n29780 16386 1';
assert.deepEqual(compareNsfTrace(capture, shiftedByOne), {total: 2, matched: 2, firstDivergence: null, shift: 1});

// A gap wider than one 6502 instruction (8 cycles) is a real misalignment,
// not the known convention difference, so it is never silently absorbed.
const farOff = '0 16407 0\n50 16384 15\n29804 16386 1';
const misaligned = compareNsfTrace(capture, farOff);
assert.equal(misaligned.shift, 0);
assert.equal(misaligned.matched, 0);

// `corpus.mjs` renders GME a second longer than our own frame-bounded
// capture on purpose; GME's trace running on past ours is expected padding,
// not a missing command on our side, so it must not count as a divergence.
const longerGme = '0 16407 0\n5 16384 15\n29780 16386 1\n59560 16388 9';
assert.deepEqual(compareNsfTrace(capture, longerGme), {total: 2, matched: 2, firstDivergence: null, shift: 0});
console.log('PASS ceremony writes at cycle 0 are dropped from both traces; a small constant startup gap is absorbed; GME running on past our own frame budget is not a divergence; remaining commands compare positionally and report the first divergence');
