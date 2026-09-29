import { OfflineDriver, snesChip } from '../dist/index.js';
import { EventQueue } from '../dist/event-queue.js';
import { SnesDriver } from '../dist/chips/snes/driver.js';

/**
 * P6-11: the dry space's pre-key-off release taper. Pins the exact ADSR2
 * write `noteOff` now emits before its own existing fast-GAIN-decrease
 * pair, for a note held long enough to reach sustain; and pins that a
 * short note (below `TAPER_FLOOR_MS`) and a `room`-space note (decision 53's
 * echo tail already covers the ear cue this taper exists for - see the
 * doc comment above `TAPER_TARGET_RATIO` in driver.ts) both keep today's
 * byte-identical two-write release, unaffected.
 *
 * The expected taper register byte is computed here independently from the
 * same public formula the doc comment above `TAPER_TARGET_RATIO` documents
 * and cites (SPC_DSP.cpp's `env -= 1 + (env >> 8)` decay step, ticked on
 * `counter_rates`) - not imported from driver.ts - so a change to the
 * driver's own numbers has to be deliberate and re-derived here too, the
 * same discipline check:snes's own independent oracle uses.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

function recorder(options) {
  const writes = [];
  const core = { schedule: (events) => writes.push(...events), load: () => {}, render() {}, setGain() {}, reset() {} };
  const driver = new OfflineDriver(core, snesChip, () => 0, options);
  return { driver, writes, flush: () => driver.flush() };
}

/** DSP register writes as `{reg, value, at}`, time-ordered, decoding the shared $F2/$F3 latch pair. */
function regs(writes) {
  const out = [];
  let selected = -1;
  for (const w of [...writes].sort((a, b) => a.at - b.at)) {
    if (w.addr === 0xf2) selected = w.value;
    else if (w.addr === 0xf3) out.push({ reg: selected, value: w.value, at: w.at });
  }
  return out;
}

/**
 * The last 3 register-pairs at or after the voice's own fast-GAIN-decrease
 * select (`base + 0x07`, `noteOff`'s own first write, unconditional on
 * every note this driver ever ends) - found by searching the actual write
 * stream, not by predicting `noteOff`'s cycle from `duration` (frame
 * quantization inside `frames()` means the real key-off cycle is not
 * simply `duration * CLOCK_HZ`).
 */
function releaseTail(writes, voice) {
  const base = voice * 0x10;
  const all = regs(writes);
  // 0xbf: GAIN mode 5 (exponential decrease) at the fastest rate (0x1f) -
  // noteOff's own unconditional release value, distinct from power-on's
  // unrelated writes to the same register address at a different value.
  const koffIndex = all.findIndex((r) => r.reg === base + 0x07 && r.value === 0xbf);
  if (koffIndex < 0) throw new Error('noteOff\'s own fast-GAIN-decrease write never appeared');
  // Include one write before the release pair only when it is this voice's
  // own taper write (`base + 0x06`), so an unrelated write from elsewhere in
  // the stream (power-on, another voice, this note's own attack) can never
  // be mistaken for a taper that did not happen.
  const before = all[koffIndex - 1];
  const from = before && before.reg === base + 0x06 ? koffIndex - 1 : koffIndex;
  return all.slice(from, koffIndex + 2);
}

// The hardware envelope-decay step every rate in SPC_DSP.cpp's rate table
// runs (both ADSR's own sustain-phase decay and GAIN mode 5 use it) -
// reimplemented from the cited formula, not imported.
const RATE_MS = [
  30721, 2048, 1536, 1280, 1024, 768, 640, 512, 384, 320, 256, 192, 160, 128, 96, 80, 64, 48, 40, 32, 24, 20, 16, 12, 10, 8, 6, 5, 4, 3, 2, 1,
].map((counter) => counter / 32);
function stepsToReach(env0, target) {
  let env = env0, steps = 0;
  while (env > target && steps < 100000) {
    env -= 1 + (env >> 8);
    steps++;
  }
  return steps;
}
function expectedTaperByte(adsr2, taperMs) {
  const sustainLevel = adsr2 & 0xe0;
  const sustainEnv = sustainLevel === 0xe0 ? 0x7ff : (sustainLevel << 3) + 0xff;
  const steps = stepsToReach(sustainEnv, Math.floor(sustainEnv * (1 / 8)));
  let best = 1, bestError = Infinity;
  for (let rate = 1; rate <= 0x1f; rate++) {
    const error = Math.abs(steps * RATE_MS[rate] - taperMs);
    if (error < bestError) { bestError = error; best = rate; }
  }
  return sustainLevel | best;
}

{
  // 'flute' (v0's default lead sample, scripts/snes-bank-source.ts's own
  // RECIPES): adsr2 = 0xc0. A 500ms hold is well past every factory
  // instrument's decay-to-sustain time, so `stepsToReach`/rate math runs on
  // this note's own sustain level, and 500ms * TAPER_FRACTION (0.5) clamps
  // to TAPER_MAX_MS (100ms) - independently recomputed above as register
  // byte 0xd9 (sustainLevel 0xc0 | rate 0x19).
  const { driver, writes, flush } = recorder();
  driver.playNote('v0', { note: 'A4', instrument: { volume: [15], sample: 'flute' }, duration: 0.5, at: 0 });
  flush();
  const tail = releaseTail(writes, 0);
  check('a long dry note writes exactly one taper ADSR2 write, then the existing fast-GAIN-decrease pair', tail.length === 3 && tail[0].reg === 0x06 && tail[1].reg === 0x07 && tail[1].value === 0xbf && tail[2].reg === 0x05 && tail[2].value === 0x7f, JSON.stringify(tail));
  check('the taper ADSR2 write is the independently-recomputed byte 0xd9 (sustain level 0xc0 | rate 0x19)', tail[0]?.value === expectedTaperByte(0xc0, 100) && tail[0]?.value === 0xd9, `got 0x${(tail[0]?.value ?? 0).toString(16)}, expected 0xd9`);
  check('the taper write lands strictly before the fast-GAIN-decrease pair', tail[0].at < tail[1].at, `taper@${tail[0].at} gain@${tail[1].at}`);
}

{
  // A short note (30ms, under TAPER_FLOOR_MS = 40ms) keeps today's exact
  // two-write release, byte for byte - the taper never fires below the
  // floor documented above TAPER_FLOOR_MS in driver.ts.
  const { driver, writes, flush } = recorder();
  driver.playNote('v0', { note: 'A4', instrument: { volume: [15], sample: 'flute' }, duration: 0.03, at: 0 });
  flush();
  const tail = releaseTail(writes, 0);
  check('a short dry note (under the taper floor) gets no taper write: just the existing two-write release', tail.length === 2 && tail[0].reg === 0x07 && tail[0].value === 0xbf && tail[1].reg === 0x05 && tail[1].value === 0x7f, JSON.stringify(tail));
}

{
  // Scope decision (P6-11): `room` keeps today's release untouched even on
  // a long, otherwise-tapering note - its echo tail is the space's own
  // decaying return after key-off (decision 53).
  const { driver, writes, flush } = recorder({ space: 'room' });
  driver.playNote('v0', { note: 'A4', instrument: { volume: [15], sample: 'flute' }, duration: 0.5, at: 0 });
  flush();
  const tail = releaseTail(writes, 0);
  check('a long note in the room space is unaffected: no taper write, same two-write release', tail.length === 2 && tail[0].reg === 0x07 && tail[0].value === 0xbf && tail[1].reg === 0x05 && tail[1].value === 0x7f, JSON.stringify(tail));
}

{
  // Two notes back to back on the same voice: the second note-off's taper
  // must be relative to the SECOND note's own start, not the first's.
  const { driver, writes, flush } = recorder();
  driver.playNote('v0', { note: 'A4', instrument: { volume: [15], sample: 'flute' }, duration: 0.05, at: 0 });
  driver.playNote('v0', { note: 'C5', instrument: { volume: [15], sample: 'flute' }, duration: 0.5, at: 0.1 });
  flush();
  const all = regs(writes);
  const koffIndices = all.reduce((acc, r, i) => (r.reg === 0x07 && r.value === 0xbf ? [...acc, i] : acc), []);
  check('two notes on the same voice each end with their own fast-GAIN-decrease write', koffIndices.length === 2, `${koffIndices.length}`);
  const secondTail = all.slice(koffIndices[1] - 1, koffIndices[1] + 2);
  check('a second, longer note on a reused voice tapers from its own start, not the first note\'s', secondTail.length === 3 && secondTail[0].reg === 0x06 && secondTail[0].value === 0xd9, JSON.stringify(secondTail));
}

{
  // Live-path safety. The song-rendering paths (`planPerformance`'s
  // `RegisterTransactions`, `mix-calibration.ts`, the progressive preview
  // worker built on a `planPerformance` plan, and `renderSong`/`renderSfx`'s
  // own pump-then-render loop) all either collect a whole song's events and
  // sort once before any rendering starts, or `pump()` strictly before
  // `core.render()` for the same block - the taper's own backdated write
  // just lands in its correct sorted slot before anything plays. None of
  // that machinery is exercised here.
  //
  // The studio's LIVE playback/preview engine is different: `APU.enqueue()`
  // (packages/chipvoice/src/driver.ts) pushes each `note()`/`noteOff()`
  // call's own events into an in-memory queue with no sort of its own,
  // flushed roughly once per animation frame to the worklet's `EventQueue`
  // (packages/chipvoice/src/event-queue.ts), which drains it one DSP cycle
  // at a time. A live "stop" issued with little or no scheduling lookahead
  // (worst case: `Sequencer.stop()`, called with no `at`, defaults to
  // `ctx.currentTime` - zero lookahead) can dispatch `noteOff()`'s taper
  // write already behind the worklet's current cycle by the time it
  // actually arrives. This reproduces that with the driver's own real
  // `noteOff()` output (not a synthetic array), fed through the real
  // `EventQueue`, to confirm the one property that matters: a backdated
  // batch is applied harmlessly - not dropped, not thrown on, and never
  // reordering another voice's own pending write - even though its intended
  // pre-fade window has, in this worst case, already elapsed by delivery.
  const frame = (at) => ({ at, volume: 15, freq: 440, period: 0, duty: 0, noiseMode: false, pitchOffset: 0, waveform: null, wave: null, fm: null, sample: 'flute' });
  const encoder = new SnesDriver();
  const CLOCK_HZ = 1024000;
  const koffAt = Math.round(0.5 * CLOCK_HZ); // 500ms hold: well past the taper floor
  encoder.note('v0', [frame(0)]);
  const lateEvents = encoder.noteOff('v0', koffAt); // the taper write is somewhere inside this array, backdated
  check('the scenario actually produced a tapered noteOff (6 events, not 4) - otherwise this test would not exercise the taper at all', lateEvents.length === 6, `${lateEvents.length}`);

  const queue = new EventQueue();
  // A different voice's own already-pending, correctly-timed write, sitting
  // in the ~100ms gap between the taper's pair and noteOff's own key-off
  // pair - present in the queue BEFORE the late batch below arrives, same
  // as any other voice's live note would be.
  const otherVoiceEvent = { at: lateEvents[1].at + 1500, addr: 0xf2, value: 0x99, owner: 'v5' };
  queue.schedule([otherVoiceEvent]);

  // The worklet has already advanced past every timestamp in `lateEvents`
  // (including the taper's own) before this batch is even scheduled -
  // modelling dispatch latency (rAF + postMessage + worklet block) that can
  // exceed the pre-fade's own backdating in the worst case above.
  const drained = [];
  const drainUpTo = (limit) => { while (queue.size && queue.nextAt <= limit) drained.push(queue.take()); };
  const cycle = lateEvents[lateEvents.length - 1].at + 50000;
  drainUpTo(cycle);
  check('a pending event already behind the simulated cycle position is still delivered once scheduled, not silently skipped (sanity check on the harness itself)', drained.length === 1 && drained[0] === otherVoiceEvent, `${drained.length}`);

  queue.schedule(lateEvents);
  check('scheduling a fully backdated batch does not throw and does not drop any of its events', queue.size === lateEvents.length, `${queue.size}`);
  drainUpTo(cycle);
  check('every event in the backdated batch is delivered on the very next drain - applied immediately (the taper collapses toward instantaneous in this worst case), never dropped or stuck', drained.length === 1 + lateEvents.length, `${drained.length}`);
  check('the backdated batch is delivered in its own internal order, taper pair first then the unchanged key-off pair - never reordered against itself', JSON.stringify(drained.slice(1)) === JSON.stringify(lateEvents), 'order preserved');
  check('the queue is left empty: nothing stuck or leaked', queue.size === 0, `${queue.size}`);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
