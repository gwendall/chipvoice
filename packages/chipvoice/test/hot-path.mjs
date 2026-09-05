import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GbOutputStage } from '../dist/chips/gb/dsp.js';
import { MdOutputStage, MD1_PROFILE } from '../dist/chips/md/dsp.js';
import { SnesOutputStage, SNES_PROFILE } from '../dist/chips/snes/dsp.js';
import { encodeBrr } from '../dist/chips/snes/brr.js';
import { Sequencer } from '../dist/sequencer.js';
import { arrange } from '../dist/index.js';

// Scratch ownership must not change the numeric result or alias old snapshots.
for (const [Stage, profile] of [[GbOutputStage], [MdOutputStage, MD1_PROFILE], [SnesOutputStage, SNES_PROFILE]]) {
  const a = new Stage(44100, profile), b = new Stage(44100, profile);
  const scratch = [0, 0], snapshots = [];
  for (let i = 0; i < 128; i++) {
    for (const stage of [a, b]) {
      if (Stage === SnesOutputStage) stage.hold(i * 5, -i * 7);
      else {
        stage.begin();
        if (Stage === GbOutputStage) stage.add([i & 15, 3, 5, 7], [true, true, true, true], 0x77, 0xf3);
        else stage.add(i * 5, -i * 7, [3, 5, 7, 9]);
      }
    }
    const snapshot = a.end(.7);
    assert.equal(b.end(.7, scratch), scratch);
    assert.deepEqual(scratch, snapshot);
    snapshots.push([snapshot, [...snapshot]]);
  }
  for (const [snapshot, copy] of snapshots) assert.deepEqual(snapshot, copy);
}
console.log('PASS stereo scratch storage matches independent snapshots without aliasing');

{
  let now = 0;
  const seq = new Sequencer({ stop() {}, playNote() {} }, { canPlay: () => true }, () => now, { live: false });
  seq.play(arrange({ bpm: 120, order: [0], patterns: [{ bass: 'C2 . . .', lead: 'C4 . . .', chord: 'C3 . . .', chordShape: [[0,4,7]], perc: 'K . H .' }] }));
  const into = { step: 99, orderIndex: 99 };
  assert.equal(seq.positionAt(0, into), null);
  assert.deepEqual(into, { step: 99, orderIndex: 99 });
  const first = seq.positionAt(.1);
  assert.deepEqual(first, { step: 0, orderIndex: 0 });
  now = .3; seq.pump();
  assert.equal(seq.positionAt(now, into), into);
  assert.deepEqual(into, { step: 1, orderIndex: 0 });
  assert.deepEqual(first, { step: 0, orderIndex: 0 });
  into.step = 99;
  assert.equal(seq.positionAt(now).step, 1, 'caller storage cannot mutate the timeline');
  now = 30; seq.pump();
  assert.ok(seq.timeline.length < 10, 'timeline expires even without a position reader');
  seq.stop(); assert.equal(seq.positionAt(now, into), null);
}
console.log('PASS reusable position polling preserves snapshots, timeline ownership and expiry');

// Frozen before the refactor: empty, partial blocks, extremes, seeded noise,
// multiple predictors/blocks, both loop flags. Scratch buffers never escape.
const hashes = ['a536aa3cede6ea3c','dc4c8669df128318','d353c3edaf8ee6c8','cc16d446ca73dc96','28fd17dc2b8bf3e8','b1191035d9753a0c','fa19a474c66e088a','9c436351eef4b8c2','9718f3829d82a977','b01ea45104008b5e'];
let seed = 7, test = 0;
const outputs = [];
for (const length of [0, 1, 16, 37, 256]) {
  const pcm = Int16Array.from({ length }, (_, i) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return length === 16 ? (i % 2 ? 32767 : -32768) : seed & 65535; });
  for (const loop of [false, true]) outputs.push([encodeBrr(pcm, loop), hashes[test++]]);
}
for (const [bytes, expected] of outputs) assert.equal(createHash('sha256').update(bytes).digest('hex').slice(0, 16), expected);
console.log('PASS BRR bytes unchanged across repeated calls and scratch-buffer reuse');
