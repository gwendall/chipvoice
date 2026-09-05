import assert from 'node:assert/strict';
import { Fifo } from '../dist/fifo.js';
import { EventQueue } from '../dist/event-queue.js';
const drain = queue => { const out = []; while (queue.size) out.push(queue.take()); return out; };
const e = (at, value, owner) => ({ at, addr: 42, value, owner });
{
  const q = new EventQueue();
  const a = [e(5, 1, 'music'), e(0, 2), e(5, 3, 'fx')];
  q.schedule(a); a.length = 0;
  q.schedule([e(5, 4), e(3, 5)]);
  assert.deepEqual(drain(q).map(v => v.value), [2, 5, 1, 3, 4]);
  assert.equal(q.nextAt, Infinity);
}
{
  // Dense captured logs can legitimately exceed the VM's argument limit.
  const q = new EventQueue(); const n = 500_000;
  const log = Array.from({ length: n }, (_, i) => e(i, i & 255));
  q.schedule(log);
  for (let i = 0; i < n; i++) { assert.equal(q.nextAt, i); assert.equal(q.take(), log[i]); }
  assert.equal(q.size, 0); assert.equal(q.nextAt, Infinity);
}
{
  const q = new EventQueue();
  q.schedule([e(0, 0, 'music'), e(2, 1, 'music'), e(3, 2, 'fx')]);
  q.schedule([e(2, 3, 'fx'), e(4, 4, 'music'), e(5, 5)]);
  assert.equal(q.take().value, 0);
  q.cancel('music', 2);
  assert.equal(q.size, 3); assert.deepEqual(drain(q).map(v => v.value), [3, 2, 5]);
  q.schedule([e(10, 7)]); q.clear(); q.schedule([e(1, 8)]);
  assert.equal(q.take().value, 8);
}
{
  // Deterministic randomized arrivals, consumption and cancellation compared
  // with a simple stable-sort model. Includes interleaved same-cycle ports.
  let seed = 7;
  const rnd = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const q = new EventQueue(); let expected = []; let serial = 0;
  for (let round = 0; round < 4000; round++) {
    const action = rnd(4);
    if (action < 2) {
      const batch = Array.from({ length: rnd(30) + 1 }, () => e(rnd(100), serial++, ['music', 'fx', undefined][rnd(3)]));
      q.schedule(batch); expected = expected.concat(batch).sort((a, b) => a.at - b.at);
    } else if (action === 2) {
      const owner = rnd(2) ? 'music' : 'fx', from = rnd(100);
      q.cancel(owner, from); expected = expected.filter(e => e.owner !== owner || e.at < from);
    } else if (expected.length) assert.equal(q.take(), expected.shift());
    assert.equal(q.size, expected.length);
    assert.equal(q.nextAt, expected[0]?.at ?? Infinity);
  }
  assert.deepEqual(drain(q), expected);
}
console.log('PASS event queue: 500k writes, stable order, interleaving, cancellation and reset');

{
  const fifo = new Fifo();
  for (let round = 0; round < 40; round++) {
    for (let i = 0; i < 1000; i++) fifo.push(round * 1000 + i);
    for (let i = 0; i < 999; i++) assert.equal(fifo.take(), round * 999 + i);
  }
  let previous = fifo.take(); while (fifo.size) { const next = fifo.take(); assert.equal(next, previous + 1); previous = next; }
  assert.equal(fifo.take(), undefined); fifo.push(1); fifo.clear(); assert.equal(fifo.size, 0);
  console.log('PASS hardware bus FIFO preserves wraparound/growth order and resets');
}
