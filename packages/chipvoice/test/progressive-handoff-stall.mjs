import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { compileProject } from '../dist/project-render.js';
import { ProgressiveRenderer } from '../dist/progressive-renderer.js';
import { gbChip } from '../dist/index.js';

/**
 * REV-11: pins the fix for the exact race REV-10 (docs/BACKLOG.md) proved
 * with an uncommitted browser harness that delayed only the worker's reply to
 * a real ProgressivePlayback's first post-handoff 'ahead'-lane read, by
 * patching `Worker.prototype.postMessage` from the test page. That harness
 * found the underrun threshold sits exactly at the old fixed `HANDOFF_LEAD`
 * (0.75s): 0 underruns at up to 600ms of injected delay, underruns at 750ms
 * and above, in two independent sweeps.
 *
 * This file reproduces the same race entirely in Node, deterministically and
 * on a committed schedule: a real `ProgressivePlayback` (not a mock of it),
 * a real `AudioContext.currentTime` clock (a getter over `performance.now()`,
 * not a value the test steps by hand, since the race is about real wall-clock
 * time racing a real elapsed delay), and a real worker message round trip
 * (the actual `handlePreviewMessage` from dist/preview-worker.js, run
 * in-process through a fake `Worker` whose `postMessage` can delay one
 * chosen reply by a real `setTimeout`, exactly like the deleted harness did
 * by patching the real `Worker.prototype.postMessage`). No test hooks were
 * added to ProgressivePlayback, PreviewSource or the worker.
 *
 * Before REV-11's fix, this failed at 900ms of injected delay (past the old
 * 750ms cliff) with a nonzero `underruns` count. After the fix, the delayed
 * read is fetched and cached before the handoff group goes live (see the
 * comment beside `selectSource`'s prefetch in
 * packages/chipvoice/src/playback/ProgressivePlayback.ts), so pump()'s own
 * first post-handoff read is a cache hit: there is no deadline left to miss,
 * at any of the delays exercised below, including one far past anything
 * REV-10's sweep tried.
 */

// ---------------------------------------------------------------------------
// A fake AudioContext whose `currentTime` is real elapsed wall-clock time,
// not a value this file steps by hand (contrast test/progressive-playback.mjs,
// whose static clock is right for that file's own scenarios but cannot
// reproduce a race against real elapsed delay).
// ---------------------------------------------------------------------------
function fakeParam(initial = 0) {
  return {
    value: initial,
    cancelScheduledValues() {},
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
  };
}
function makeRealtimeContext() {
  const startedAt = performance.now();
  const context = {
    get currentTime() { return (performance.now() - startedAt) / 1000; },
    destination: {},
    scheduled: [],
    createGain() {
      const node = { gain: fakeParam(0), disconnected: false, connect() {}, disconnect() { node.disconnected = true; } };
      return node;
    },
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        length, sampleRate, numberOfChannels: channels,
        copyToChannel(source, channel) { data[channel].set(source); },
        getChannelData(channel) { return data[channel]; },
      };
    },
    createBufferSource() {
      const source = {
        buffer: null, onended: null, started: null, offset: null, stopped: null, disconnected: false,
        connect() {}, disconnect() { source.disconnected = true; },
        start(at, offset = 0) {
          source.started = at; source.offset = offset;
          if (source.buffer) context.scheduled.push({ at, offset, length: source.buffer.getChannelData(0).length });
        },
        stop(at) { source.stopped = at ?? context.currentTime; },
      };
      return source;
    },
    async resume() {},
  };
  return context;
}

// ---------------------------------------------------------------------------
// Fake Worker, backed by the real preview-worker.js handler (same technique
// as test/progressive-playback.mjs), with a per-worker `delayFor` hook that
// can hold one reply back by a real `setTimeout` before it is delivered.
// ---------------------------------------------------------------------------
const previewWorkerHref = new URL('../dist/preview-worker.js', import.meta.url).href;
const workerContext = new AsyncLocalStorage();
let fakeWorkerSerial = 0;
globalThis.postMessage = (data) => { workerContext.getStore()?.deliver(data); };
class FakeWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    /** Test hook: return a delay in ms for a given outgoing message, to make
     * a specific 'load'/'read' answer arrive late on purpose. */
    this.delayFor = () => 0;
    this.ready = import(`${previewWorkerHref}?fakeWorker=${++fakeWorkerSerial}`)
      .then((module) => { this.handle = module.handlePreviewMessage; });
  }
  postMessage(data) {
    if (this.terminated) return;
    void (async () => {
      await this.ready;
      const ms = this.delayFor(data);
      if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
      if (this.terminated) return;
      await workerContext.run(this, () => this.handle(data));
    })();
  }
  deliver(data) { if (this.terminated) return; this.onmessage?.({ data }); }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;

const { ProgressivePlayback } = await import('../dist/playback/ProgressivePlayback.js');

// ---------------------------------------------------------------------------
// Fixture: two cheap, distinct scores on the same fast chip. The race under
// test is about PreviewSource *identity* (a genuinely different, cold
// worker, like switching from one console to another mid-song), not about
// which chip is slowest to render: REV-10's own real-world case happened to
// be 2A03-to-Mega-Drive, but nothing about the scheduling race is
// chip-specific, and the actual per-chip render cost (this file's fake
// worker runs in-process, on this same thread, with none of a real Worker's
// parallelism) is measured separately, with real Worker threads in a real
// browser, for the switch-latency numbers in docs/BACKLOG.md's REV-11 entry.
// ---------------------------------------------------------------------------
const RATE = 8000;
// Same fixture and bpms as test/progressive-playback.mjs's own project/project2
// (scenario 2), deliberately: that file's `positions` array below is chosen
// against this exact score/rate/bpm pair to land the target's first block
// "nearly spent" - extended by selectSource() to just barely cover the old
// fixed HANDOFF_LEAD margin (0.75s) - which is the real-world precondition
// for the race this file reproduces (see that scenario's comment for how the
// numbers were picked).
const score = {
  bpm: 172, order: new Array(10).fill(0),
  patterns: [{ chordShape: [[0, 4, 7]], lead: 'C5 = E5 = G5 = C6 =', chord: 'C4 = = = F4 = = =', bass: 'C2 = C3 = F2 = F3 =', perc: 'K H S H K H S H' }],
};
const sourceProject = { version: 1, title: 'handoff-stall source', source: { kind: 'score', score }, settings: { chip: 'dmg' } };
const targetProject = { version: 1, title: 'handoff-stall target', source: { kind: 'score', score: { ...score, bpm: 150 } }, settings: { chip: 'dmg' } };
const targetFrames = (() => {
  const compiled = compileProject(targetProject, { sampleRate: RATE });
  return new ProgressiveRenderer(compiled.plan, gbChip, RATE, compiled.gain).frames;
})();
/** A stateful phase function, not a real-time value: forces the exact same
 * "nearly spent" first block as progressive-playback.mjs's scenario 2, so the
 * handoff group starts with a tight, known margin (right at HANDOFF_LEAD)
 * regardless of how fast or slow this machine renders the fixture. Only the
 * delay injected below on the read that follows is real time. */
function nearlySpentPhase() {
  const positions = [16500, 31500, 38000, 42000];
  let call = 0;
  return () => positions[Math.min(call++, positions.length - 1)] / targetFrames;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
/** Waits in real time (not simulated ticks: the clock above is real too)
 * until the audible group's own read-ahead loop is idle, or throws. */
async function settleRealtime(transport, timeoutMs = 4000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (!transport.group?.pumping) return;
    await tick();
  }
  throw Error(`pump never settled within ${timeoutMs}ms`);
}

/** A fresh transport already playing `project` at `phase`, its first
 * read-ahead fill settled. */
async function playingAt(project, phase, key) {
  const context = makeRealtimeContext();
  const transport = new ProgressivePlayback(context, () => {}, RATE);
  assert.ok(await transport.load({ project }, { key }), 'initial load succeeds');
  transport.seek(phase);
  await transport.toggle();
  await settleRealtime(transport);
  return { context, transport };
}

/** Runs one moving handoff from `sourceProject` to `targetProject`, delaying
 * the target's first 'ahead'-lane read by `delayMs` of real time (0 for a
 * baseline run with no injected stall). Returns the observed switch latency
 * (`load()`'s own resolution time) and the underrun counts once settled. */
async function handoffWithDelay(delayMs) {
  const { context, transport } = await playingAt(sourceProject, 0.05, `stall-source-${delayMs}`);
  try {
    const before = transport.group;
    // A stateful phase, not a real-time-tracking one: forces the same
    // "nearly spent" first block as progressive-playback.mjs's scenario 2, so
    // the handoff group starts with a tight, known margin (right at
    // HANDOFF_LEAD) before any delay is injected below - reproducing REV-10's
    // actual precondition instead of an incidental, machine-speed-dependent
    // one (a static phase like 0.5 banks up to a full 2s of margin for free
    // from the initial block's own second-aligned read, which no realistic
    // injected delay would ever catch).
    const pending = transport.load({ project: targetProject }, { key: `stall-target-${delayMs}`, phase: nearlySpentPhase() });
    // `load()` runs synchronously up to its first await (source.ready), so
    // `transport.incoming` is already the freshly created, cold target
    // source by the time `load()` returns its pending promise.
    const incoming = transport.incoming;
    assert.ok(incoming, 'the incoming target source is set synchronously');
    assert.notEqual(incoming, before?.source, 'the target is a genuinely different (cold) source, like switching console');
    let armed = delayMs > 0;
    incoming.worker.delayFor = (data) => {
      if (armed && data.type === 'read' && data.lane === 'ahead') { armed = false; return delayMs; }
      return 0;
    };
    const startedAt = performance.now();
    const selected = await pending;
    const readyMs = performance.now() - startedAt;
    assert.equal(selected, true, `the handoff still selects successfully with ${delayMs}ms injected on its first ahead read`);
    assert.notEqual(transport.group, before, 'a new group replaced the retiring one');
    // Not a margin assertion here (transport.group.nextAt - .at, read right
    // after load() resolves, is not the margin the handoff actually started
    // with once the fix is in place: pump()'s own first 'ahead' read is now a
    // cache hit and can race ahead of this very continuation - the same
    // reason progressive-playback.mjs's scenario 2 stopped reading its own
    // result by array position. nearlySpentPhase()'s own positions are what
    // pins the pre-fix margin to HANDOFF_LEAD; that is checked structurally
    // there, not re-derived here from state the fix's own prefetch disturbs.
    assert.equal(armed, false, 'the injected delay was actually exercised on the read it targets');
    await settleRealtime(transport);
    return { readyMs, underruns: transport.underruns, sourceUnderruns: transport.group.source.underruns };
  } finally { transport.dispose(); }
}

// ---------------------------------------------------------------------------
// 1. No injected delay: the fix must not introduce spurious underruns, and
//    its baseline switch latency is the reference the delayed runs below are
//    compared against.
// ---------------------------------------------------------------------------
{
  const { readyMs, underruns, sourceUnderruns } = await handoffWithDelay(0);
  assert.equal(underruns, 0, 'no underrun on an undelayed cross-chip handoff');
  assert.equal(sourceUnderruns, 0);
  console.log(`PASS undelayed cross-chip handoff: 0 underruns, ${readyMs.toFixed(1)}ms switch latency`);
}

// ---------------------------------------------------------------------------
// 2. 900ms injected on the first post-handoff 'ahead' read: past REV-10's
//    proven old cliff (the fixed HANDOFF_LEAD, 750ms) sat exactly there, so
//    this delay reproduces a real underrun on unpatched main (verified by
//    hand: see docs/BACKLOG.md's REV-11 entry for the exact number). After
//    the fix, the prefetch absorbs it entirely: the handoff simply takes
//    longer to complete, not an audible gap.
// ---------------------------------------------------------------------------
{
  const { readyMs, underruns, sourceUnderruns } = await handoffWithDelay(900);
  assert.ok(readyMs >= 900, `the switch waited out the injected delay instead of racing it (got ${readyMs.toFixed(1)}ms)`);
  assert.equal(underruns, 0, `no underrun with 900ms injected on the first post-handoff read (got ${underruns})`);
  assert.equal(sourceUnderruns, 0);
  console.log(`PASS 900ms stall on the first post-handoff read (past the old 750ms HANDOFF_LEAD cliff): 0 underruns, ${readyMs.toFixed(1)}ms switch latency`);
}

// ---------------------------------------------------------------------------
// 3. A stall far past anything REV-10's own sweep tried (0/300/600/750/900/
//    1200/2000ms): the fix has no margin to exceed for this specific read, so
//    it is not a bigger constant that a long enough stall could still beat,
//    the way REV-11's own proposed adaptive margin (max(HANDOFF_LEAD,
//    2*lastReadMs)) still would be. Bounded here at 5s only to keep the test
//    itself fast; nothing in the fix depends on that number.
// ---------------------------------------------------------------------------
{
  const { readyMs, underruns, sourceUnderruns } = await handoffWithDelay(5000);
  assert.ok(readyMs >= 5000, `the switch waited out the injected delay instead of racing it (got ${readyMs.toFixed(1)}ms)`);
  assert.equal(underruns, 0, `no underrun with a 5s stall on the first post-handoff read (got ${underruns})`);
  assert.equal(sourceUnderruns, 0);
  console.log(`PASS 5s stall on the first post-handoff read: 0 underruns, ${readyMs.toFixed(1)}ms switch latency`);
}

process.exitCode = 0;
