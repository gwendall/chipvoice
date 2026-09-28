import assert from 'node:assert/strict';
import {PLAY_TOLERANCE, CIA_CYCLE_BOUND, cycleBoundFor} from './corpus.mjs';

/**
 * `corpus.mjs`'s two PLAY-phase cycle-position gates, checked without a live
 * oracle run: `test-compare.mjs` already covers `compare.mjs`'s own
 * measurement logic with synthetic traces, so this file only needs the two
 * constants and frozen, previously-measured numbers to prove the tightened
 * gates actually reject the old, pre-`PAL_INIT_RASTER_PHASE` behaviour
 * (`rasterCycle`/`cycleInFrame` both starting at cycle 0) - not just today's.
 * See docs/BACKLOG.md's NEXT-09 follow-up for the fix itself.
 */

// Today's measurements (see corpus.mjs's own comments above these
// constants): every fixture is at or under its own bound.
const today = {
  'convention-probe': 2, 'frame-rate-probe': 2,
  'gt2-dojo': 3, 'gt2-hyperspace-alt': 3,
  'gt2-sanction-cia': 43, 'gt2-consultant-alt-cia': 42,
};
for (const [id, deviation] of Object.entries(today)) {
  assert.ok(deviation <= cycleBoundFor(id), `${id}: ${deviation} should be within its own bound (${cycleBoundFor(id)})`);
}

// The old behaviour (rasterCycle and cycleInFrame both starting at 0,
// instead of PAL_INIT_RASTER_PHASE) measured against this same oracle
// revision before this fix: gt2-hyperspace-alt.sid at 5 cycles (the worst of
// the four PLAY_TOLERANCE fixtures back then) and both CIA-timed fixtures at
// 128 cycles. PLAY_TOLERANCE tightened from 5 to 3 catches the first;
// CIA_CYCLE_BOUND tightened from 134 to 89 catches the second - neither
// gate would have caught these numbers before this ticket, and both catch
// them now, so a regression back to the old phase is a real, immediate
// corpus failure rather than a silent pass.
const oldBehaviour = {
  'convention-probe': 2, 'frame-rate-probe': 2,
  'gt2-dojo': 3, 'gt2-hyperspace-alt': 5,
  'gt2-sanction-cia': 128, 'gt2-consultant-alt-cia': 128,
};
const caughtByTightenedGate = Object.entries(oldBehaviour).filter(([id, deviation]) => deviation > cycleBoundFor(id));
assert.deepEqual(caughtByTightenedGate.map(([id]) => id).sort(), ['gt2-consultant-alt-cia', 'gt2-hyperspace-alt', 'gt2-sanction-cia'].sort());

// Sanity: the two constants themselves are the tightened values this test's
// own name promises, not stale ones a future edit forgot to update here.
assert.equal(PLAY_TOLERANCE, 3);
assert.equal(CIA_CYCLE_BOUND, 89);

console.log('PASS PLAY_TOLERANCE (5 to 3) and CIA_CYCLE_BOUND (134 to 89) both reject the old, pre-PAL_INIT_RASTER_PHASE measurements (5 cycles on gt2-hyperspace-alt.sid, 128 cycles on both CIA-timed fixtures) while still passing every fixture\'s current measurement');
