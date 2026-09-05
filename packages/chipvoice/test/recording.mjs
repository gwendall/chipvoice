import assert from 'node:assert/strict';
import { Sequencer } from '../dist/sequencer.js';
import { arrange } from '../dist/index.js';

const pattern = n => ({ bass: ['C2', ...Array(n - 1).fill('.')].join(' '), lead: Array(n).fill('.').join(' '), chord: Array(n).fill('.').join(' '), perc: Array(n).fill('.').join(' '), chordShape: [[0,4,7]] });
const song = arrange({ bpm: 120, patterns: [pattern(4), pattern(6)], order: [0,1,0] });
const make = () => {
  let now = 0;
  const seq = new Sequencer({ stop() {}, playNote() {} }, { canPlay: () => true }, () => now, { live: false });
  seq.play(song);
  return { seq, clock: t => { now = t; seq.pump(); } };
};
{
  const { seq, clock } = make();
  assert.equal(seq.quantizedPosition(0), null);
  for (const [time, expected] of [
    [.1, {step:0,orderIndex:0}], [.162499, {step:0,orderIndex:0}], [.1625, {step:1,orderIndex:0}],
    [.5375, {step:0,orderIndex:1}], [1.2875, {step:0,orderIndex:2}], [1.7875, {step:0,orderIndex:0}],
  ]) {
    clock(time); assert.deepEqual(seq.quantizedPosition(time), expected, `nearest grid at ${time}`);
  }
  clock(10); assert.equal(seq.quantizedPosition(10), null, 'timer suspension gap must not paint a stale step');
  clock(10.051); assert.ok(seq.quantizedPosition(10.051));
  seq.stop(); assert.equal(seq.quantizedPosition(11), null);
}
{
  const { seq, clock } = make();
  const lengths = [4,6,4], duration = .125;
  for (let i = 0; i < 700; i++) {
    const time = .101 + i * .004;
    clock(time);
    let step = Math.round((time - .1) / duration) % 14, orderIndex = 0;
    while (step >= lengths[orderIndex]) step -= lengths[orderIndex++];
    assert.deepEqual(seq.quantizedPosition(time), {step,orderIndex});
  }
}
console.log('PASS nearest-sixteenth capture: input clock, half steps, unequal/repeated patterns, loop wrap and suspension');
