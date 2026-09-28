import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { compileProject } from '../dist/project-render.js';
import { ProgressiveRenderer } from '../dist/progressive-renderer.js';
import { gbChip } from '../dist/index.js';

/**
 * ProgressivePlayback and the preview path of ProjectPlayer only had browser
 * coverage (apps/web/test-progressive-browser.mjs, test-progressive-long.mjs),
 * driven by a real AudioContext and a real Worker thread under Playwright.
 * This file pins the same scheduling behaviour in plain node, with two fakes:
 *
 *  - a fake AudioContext whose `currentTime` this file advances by hand, and
 *    whose createGain/createBuffer/createBufferSource record what was
 *    scheduled (start times, offsets, stops) instead of making sound;
 *  - a fake `Worker`, installed as a global exactly where ProgressivePlayback
 *    constructs a real one (`new Worker(URL.createObjectURL(...))`), that
 *    answers 'load'/'read'/'cancel' by calling the real `handlePreviewMessage`
 *    from dist/preview-worker.js in-process. Each fake worker gets its own
 *    module instance of preview-worker.js (a fresh dynamic import, cache-busted
 *    with a query string) so its module-level `renderer`/`revision`/`lanes`
 *    state is isolated exactly like a real worker's own global scope, and
 *    responses are routed back through AsyncLocalStorage so two fake workers
 *    answering concurrently can never deliver into each other. The one
 *    production entry point (`handlePreviewMessage`) is used unmodified.
 *
 * No test hooks were added to ProgressivePlayback, PreviewSource or
 * ProjectPlayer: all three are driven only through their normal public API
 * (plus reading "private" TypeScript fields, which are plain properties at
 * runtime - the same thing apps/web/test-playback-races.mjs already does
 * against the real worker).
 */

// ---------------------------------------------------------------------------
// Fake AudioContext
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
function makeContext() {
  const context = {
    currentTime: 0,
    destination: {},
    gains: [],
    sources: [],
    // Every block actually handed to a BufferSource, in scheduling order:
    // what schedule() copied into an AudioBuffer, and when/how it starts.
    scheduled: [],
    createGain() {
      const node = { gain: fakeParam(0), disconnected: false, connect() {}, disconnect() { node.disconnected = true; } };
      context.gains.push(node);
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
          if (source.buffer) context.scheduled.push({
            at, offset,
            left: source.buffer.getChannelData(0).slice(),
            right: source.buffer.getChannelData(1).slice(),
          });
        },
        stop(at) { source.stopped = at ?? context.currentTime; },
      };
      context.sources.push(source);
      return source;
    },
    async resume() {},
  };
  return context;
}

// ---------------------------------------------------------------------------
// Fake Worker, backed by the real preview-worker.js handler
// ---------------------------------------------------------------------------
const previewWorkerHref = new URL('../dist/preview-worker.js', import.meta.url).href;
const workerContext = new AsyncLocalStorage();
let fakeWorkerSerial = 0;
// handlePreviewMessage always calls the global `postMessage`; every fake
// worker routes through this one dispatcher and relies on AsyncLocalStorage
// (not a per-call reassignment) to reach the right instance even while two
// fake workers are answering concurrently.
globalThis.postMessage = (data) => { workerContext.getStore()?.deliver(data); };
const allWorkers = [];
class FakeWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.sent = [];
    /** Test hook: return a delay in ms for a given outgoing message, to make
     * a specific 'load'/'read' answer arrive late on purpose. */
    this.delayFor = () => 0;
    this.ready = import(`${previewWorkerHref}?fakeWorker=${++fakeWorkerSerial}`)
      .then((module) => { this.handle = module.handlePreviewMessage; });
    allWorkers.push(this);
  }
  postMessage(data) {
    this.sent.push(data);
    if (this.terminated) return;
    void (async () => {
      await this.ready;
      const ms = this.delayFor(data);
      if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
      if (this.terminated) return;
      await workerContext.run(this, () => this.handle(data));
    })();
  }
  deliver(data) {
    if (this.terminated) return;
    this.onmessage?.({ data });
  }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeWorker;

const { ProgressivePlayback } = await import('../dist/playback/ProgressivePlayback.js');
const { ProjectPlayer } = await import('../dist/project-player.js');

// ---------------------------------------------------------------------------
// Fixture: a few seconds of Game Boy audio at a low sample rate, fast to
// render, so the FakeWorker's real (in-process) renders stay quick.
// ---------------------------------------------------------------------------
const RATE = 8000;
const HANDOFF_LEAD = 0.75;
const score = {
  bpm: 172, order: new Array(10).fill(0),
  patterns: [{ chordShape: [[0, 4, 7]], lead: 'C5 = E5 = G5 = C6 =', chord: 'C4 = = = F4 = = =', bass: 'C2 = C3 = F2 = F3 =', perc: 'K H S H K H S H' }],
};
const project = { version: 1, title: 'progressive playback fixture', source: { kind: 'score', score }, settings: { chip: 'dmg' } };
const project2 = { version: 1, title: 'second fixture', source: { kind: 'score', score: { ...score, bpm: 150 } }, settings: { chip: 'dmg' } };

function referenceFor(input) {
  const compiled = compileProject(input, { sampleRate: RATE });
  const renderer = () => new ProgressiveRenderer(compiled.plan, gbChip, RATE, compiled.gain);
  const frames = renderer().frames;
  const loopStartFrame = Math.round((compiled.plan.loopStartSeconds ?? 0) * RATE);
  return {
    frames, loopStartFrame,
    read(start, length) {
      const iterator = renderer().read(start, length);
      let next; do { next = iterator.next(); } while (!next.done);
      return next.value;
    },
  };
}
const reference = referenceFor(project);
const reference2 = referenceFor(project2);
// Both fixtures loop from the very start of a single repeated pattern; the
// tests below pick ranges far from frame 0 and far from the end of the file
// so schedule()'s +/-24-frame loop and end-of-file fades never apply to them.
assert.equal(reference.loopStartFrame, 0, 'fixture loops from its own start');
assert.equal(reference2.loopStartFrame, 0, 'second fixture loops from its own start');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(transport, budget = 400) {
  for (let i = 0; i < budget; i++) {
    await tick();
    if (!transport.group?.pumping) return;
  }
  throw Error('pump never settled');
}
/** seek()/setLoop() kick off their own selectSource without returning a
 * promise; wait for the `loading` flag to clear (the new group is installed)
 * before also waiting for that new group's own read-ahead fill to settle. */
async function settleLoading(transport, budget = 400) {
  for (let i = 0; i < budget && transport.loading; i++) await tick();
  assert.equal(transport.loading, false, 'loading settles');
  await settle(transport);
}
function concatChunks(chunks) {
  const left = new Float32Array(chunks.reduce((n, c) => n + c.left.length, 0));
  const right = new Float32Array(left.length);
  let offset = 0;
  for (const chunk of chunks) { left.set(chunk.left, offset); right.set(chunk.right, offset); offset += chunk.left.length; }
  return { left, right };
}
/** A fresh transport already playing `input` at `phase`, its first read-ahead
 * fill settled, with the context's fake clock left at 0. */
async function playingAt(input, phase, key) {
  const context = makeContext();
  const transport = new ProgressivePlayback(context, () => {}, RATE);
  assert.ok(await transport.load({ project: input }, { key }), 'initial load succeeds');
  transport.seek(phase);
  await transport.toggle();
  await settle(transport);
  return { context, transport };
}

// ---------------------------------------------------------------------------
// 1. Scheduled PCM equals the renderer's own output for the same range: no
//    gap, no overlap at block joins. No underrun while comfortably ahead.
// ---------------------------------------------------------------------------
{
  const startPhase = 0.3;
  const startFrame = Math.floor(startPhase * reference.frames);
  const { context, transport } = await playingAt(project, startPhase, 'steady');
  try {
    assert.ok(context.scheduled.length >= 2, 'more than the initial block was scheduled while filling the reserve');
    const got = concatChunks(context.scheduled);
    const expected = reference.read(startFrame, got.left.length);
    assert.deepEqual(got.left, expected.left, "scheduled left PCM matches the renderer's own output across block joins");
    assert.deepEqual(got.right, expected.right, "scheduled right PCM matches the renderer's own output across block joins");
    assert.equal(transport.underruns, 0, 'steady-state read-ahead never underruns');
    assert.equal(transport.source.underruns, 0);
  } finally { transport.dispose(); }
  console.log('PASS scheduled PCM equals the renderer\'s own output across block joins, no underrun in steady state');
}

// ---------------------------------------------------------------------------
// 2. A moving handoff whose first block comes back nearly spent is extended
//    so the new group starts at least HANDOFF_LEAD (0.75s) ahead. The phase
//    argument is a stateful function, exactly like the browser test's own
//    "nearly spent" trick, so the handoff is reproduced without real delays.
// ---------------------------------------------------------------------------
{
  const { context, transport } = await playingAt(project, 0.05, 'handoff-a');
  try {
    const before = transport.group;
    // Offset well clear of both the loop-start fade (frames 0-24) and the
    // end-of-file fade (the last 24 frames): schedule() fades those seams in
    // place, so raw PCM there intentionally differs from the renderer's own
    // unfaded output. 16000 is a whole-second boundary, so alignment below
    // matches the arithmetic in the comment: chunk lands on [16000, 48000).
    const positions = [16500, 31500, 38000, 42000];
    let call = 0;
    const phase = () => (positions[Math.min(call++, positions.length - 1)]) / reference2.frames;
    const scheduledBefore = context.scheduled.length;
    const selected = await transport.load({ project: project2 }, { key: 'handoff-b', phase });
    assert.ok(selected, 'the cold handoff selects successfully');
    assert.notEqual(transport.group, before, 'a new group replaced the retiring one');
    const group = transport.group;
    assert.ok(group.nextAt - group.at >= HANDOFF_LEAD - 1e-9,
      `handoff group starts with at least ${HANDOFF_LEAD}s already scheduled (got ${(group.nextAt - group.at).toFixed(4)}s)`);
    // The single joined block handed to the audio node is exactly what the
    // renderer produces for the same frame range: the new group's own first
    // block is the one a moving handoff extends, so (like scenario 7) it is
    // the only one of this load's own new entries with a non-zero in-buffer
    // offset (it starts mid-block). Not `.at(-1)`: REV-11 caches the group's
    // first post-handoff 'ahead' read before this call returns, so pump()'s
    // own fire-and-forget continuation (a cache hit, microtask-fast) can
    // schedule its own later, offset-0 block before this line runs. Not by
    // `at` either: the fake context's static clock means an unrelated
    // earlier group can share the same `at`.
    const newEntries = context.scheduled.slice(scheduledBefore);
    const scheduledForB = newEntries.find((entry) => entry.offset > 0);
    assert.ok(scheduledForB, 'the handoff block itself was scheduled, with its non-zero in-buffer offset');
    const chunkStart = Math.round(group.offset * RATE) - Math.round(scheduledForB.offset * RATE);
    const expected = reference2.read(chunkStart, scheduledForB.left.length);
    assert.deepEqual(scheduledForB.left, expected.left, 'the extended handoff block matches the renderer for the new source');
    await settle(transport);
  } finally { transport.dispose(); }
  console.log('PASS a nearly-spent handoff block is extended so the new group starts at least HANDOFF_LEAD ahead');
}

// ---------------------------------------------------------------------------
// 3. Exactly one underrun is counted, on the currently playing source, when a
//    read-ahead misses its deadline; steady-state refill afterwards counts
//    none. The clock is advanced by hand, so no real delay is needed.
// ---------------------------------------------------------------------------
{
  const { context, transport } = await playingAt(project, 0.3, 'underrun');
  try {
    const group = transport.group;
    const nextAtBefore = group.nextAt;
    context.currentTime = nextAtBefore + 10;
    await transport.pump(group);
    assert.equal(transport.underruns, 1, 'exactly one underrun is counted for the late read-ahead');
    assert.equal(group.source.underruns, 1, 'the underrun is attributed to the source that missed its deadline');
    assert.ok(group.nextAt >= context.currentTime, 'the group catches back up ahead of the clock after the miss');
    const framesAfterCatchUp = group.nextFrame;
    await transport.pump(group);
    assert.equal(transport.underruns, 1, 'a pump call with no further delay does not add another underrun');
    assert.equal(group.nextFrame, framesAfterCatchUp, 'steady state after the catch-up needs no further reads yet');
  } finally { transport.dispose(); }
  console.log('PASS exactly one underrun is counted on the playing source when a read misses its deadline, none in steady state');
}

// ---------------------------------------------------------------------------
// 4. The read-ahead reserve is 3s while `selecting`, 1.5s otherwise.
// ---------------------------------------------------------------------------
{
  const { context, transport } = await playingAt(project, 0.3, 'reserve');
  try {
    const group = transport.group;
    group.nextAt = context.currentTime + 2; // inside [1.5, 3): reserve-dependent
    const frameBefore = group.nextFrame;
    transport.selecting = false;
    await transport.pump(group);
    assert.equal(group.nextFrame, frameBefore, '1.5s reserve: 2s of lead is already enough, no read happens');
    transport.selecting = true;
    await transport.pump(group);
    assert.notEqual(group.nextFrame, frameBefore, '3s reserve while selecting: the same 2s of lead is not enough, a read happens');
  } finally { transport.dispose(); }
  console.log('PASS the read-ahead reserve is 3s while selecting and 1.5s otherwise');
}

// ---------------------------------------------------------------------------
// 5. Seeking while playing lands on the requested position.
// ---------------------------------------------------------------------------
{
  const { context, transport } = await playingAt(project, 0.1, 'seek-setup');
  try {
    const target = 0.6;
    transport.seek(target);
    await settleLoading(transport);
    // The fake clock never advances on its own; move it just past the new
    // group's start time so phase() resolves the latest history entry
    // instead of falling back to the one before the seek.
    context.currentTime = transport.group.at + 1e-6;
    const tolerance = 2 / reference.frames;
    assert.ok(Math.abs(transport.phase() - target) < tolerance, `seek lands within one frame of phase ${target} (got ${transport.phase()})`);
    assert.ok(transport.playing, 'still playing after a seek');
  } finally { transport.dispose(); }
  console.log('PASS seeking while playing lands on the requested position');
}

// ---------------------------------------------------------------------------
// 6. Pause during a load wins: the load still completes (metadata/offset are
//    updated) but never resumes or schedules audio once paused.
// ---------------------------------------------------------------------------
{
  const { context, transport } = await playingAt(project, 0.2, 'pause-wins-a');
  try {
    const scheduledBefore = context.scheduled.length;
    const pending = transport.load({ project: project2 }, { key: 'pause-wins-b' });
    assert.equal(transport.playing, true, 'still playing right after starting the load, before pause runs');
    transport.pause();
    assert.equal(transport.playing, false, 'pause takes effect immediately');
    assert.equal(transport.group, null, 'pause immediately clears the audible group');
    const selected = await pending;
    assert.equal(selected, true, 'the load still finishes and reports success');
    assert.equal(transport.playing, false, 'pause outcome is not overwritten once the load observes it');
    assert.equal(transport.group, null, 'no new group is created once paused');
    assert.equal(context.scheduled.length, scheduledBefore, 'no audio is scheduled for a load that lands after pause');
  } finally { transport.dispose(); }
  console.log('PASS pause during a load wins: the load completes but never resumes or schedules audio');
}

// ---------------------------------------------------------------------------
// 7. Rapid successive loads keep only the latest; cancelled reads never
//    schedule audio.
// ---------------------------------------------------------------------------
{
  const context = makeContext();
  const transport = new ProgressivePlayback(context, () => {}, RATE);
  try {
    assert.ok(await transport.load({ project }, { key: 'rapid-base' }));
    transport.seek(0.3);
    await transport.toggle();
    await settle(transport);
    const scheduledBefore = context.scheduled.length;
    const first = transport.load({ project: project2 }, { key: 'rapid-1' });
    const second = transport.load({ project: project2 }, { key: 'rapid-2' });
    const third = transport.load({ project: project2 }, { key: 'rapid-3' });
    const [r1, r2, r3] = await Promise.all([first, second, third]);
    assert.equal(r1, false, 'the first superseded load is cancelled');
    assert.equal(r2, false, 'the second superseded load is cancelled');
    assert.equal(r3, true, 'only the latest load is selected');
    await settle(transport);
    assert.ok(context.scheduled.length > scheduledBefore, 'the winning load schedules audio');
    assert.equal(transport.metadata.frames, reference2.frames, 'the surviving metadata belongs to the latest load');
    // A cancelled selectSource returns before ever calling schedule(), so
    // rapid-1 and rapid-2 leave no trace of their own. But while all three
    // loads were in flight, `selecting` was true, which widens the *old*
    // group's own reserve to 3s (see scenario 4) - so the real interval
    // timer can legitimately keep that old group's read-ahead going for a
    // few more blocks (always offset 0) until the handoff lands. The new
    // group's own first block is the one moving handoff gets right: a
    // non-zero in-buffer offset (it starts mid-block, see scenario 2).
    // Everything from there on must be one contiguous, uncorrupted range out
    // of the winning project's own renderer.
    const newBlocks = context.scheduled.slice(scheduledBefore);
    const handoffIndex = newBlocks.findIndex((block) => block.offset > 0);
    assert.ok(handoffIndex >= 0, 'the winning group schedules a moving-handoff block with a non-zero in-buffer offset');
    const winning = newBlocks.slice(handoffIndex);
    const startFrame = Math.round(transport.group.offset * RATE) - Math.round(winning[0].offset * RATE);
    const got = concatChunks(winning);
    const expected = reference2.read(startFrame, got.left.length);
    assert.deepEqual(got.left, expected.left, 'no cancelled read leaked into the scheduled PCM for the winning load');
  } finally { transport.dispose(); }
  console.log('PASS rapid successive loads keep only the latest; cancelled reads never schedule audio');
}

// ---------------------------------------------------------------------------
// 8. At most 3 preview workers are ever alive at once, even across many
//    distinct cache keys; spare sources are reloaded in place instead of
//    growing the pool.
// ---------------------------------------------------------------------------
{
  const context = makeContext();
  const transport = new ProgressivePlayback(context, () => {}, RATE);
  try {
    const before = allWorkers.length;
    for (let i = 0; i < 6; i++) {
      assert.ok(await transport.load({ project }, { key: `worker-cap-${i}` }));
      assert.ok(transport.sources.size <= 3, `at most 3 cached sources (got ${transport.sources.size})`);
      const live = allWorkers.slice(before).filter((worker) => !worker.terminated).length;
      assert.ok(live <= 3, `at most 3 live preview workers (got ${live})`);
    }
  } finally { transport.dispose(); }
  console.log('PASS at most 3 preview workers stay alive across many distinct cache keys');
}

// ---------------------------------------------------------------------------
// 9. dispose() terminates every cached worker and stops every scheduled node.
// ---------------------------------------------------------------------------
{
  const { context, transport } = await playingAt(project, 0.3, 'dispose-a');
  try {
    await transport.load({ project: project2 }, { key: 'dispose-b' });
    await transport.load({ project }, { key: 'dispose-c' });
    const sources = [...transport.sources.values()];
    assert.ok(sources.length >= 2, 'more than one preview source is cached before dispose');
    const nodesBefore = context.sources.slice();
    transport.dispose();
    for (const source of sources) {
      assert.equal(source.disposed, true, 'every cached preview source is disposed');
      assert.equal(source.worker.terminated, true, 'every cached preview source terminates its worker');
    }
    for (const node of nodesBefore) {
      assert.notEqual(node.stopped, null, 'every scheduled buffer node is stopped on dispose');
    }
    assert.equal(transport.output.disconnected, true, 'the output node is disconnected on dispose');
  } finally { transport.dispose(); }
  console.log('PASS dispose terminates every cached worker and stops every scheduled node');
}

// ---------------------------------------------------------------------------
// 10. ProjectPlayer({preview:true}) drives the same load/play/pause/seek path
//     through ProgressivePlayback with the same fakes.
// ---------------------------------------------------------------------------
{
  const context = makeContext();
  const player = new ProjectPlayer({ context, preview: true });
  try {
    const loaded = await player.load(project);
    assert.equal(loaded, true, 'ProjectPlayer.load succeeds against the fake worker');
    assert.ok(player.duration > 0, 'duration is populated from preview metadata');
    await player.play();
    assert.equal(player.playing, true, 'ProjectPlayer.play starts the preview transport');
    await settle(player.transport);
    const updated = await player.update({ chip: 'dmg' });
    assert.equal(updated, true, 'update() reloads and keeps playing');
    assert.equal(player.playing, true);
    await settle(player.transport);
    player.pause();
    assert.equal(player.playing, false, 'ProjectPlayer.pause stops playback');
    await player.play();
    player.seek(player.duration * 0.4);
    await settleLoading(player.transport);
    // See the matching comment in scenario 5: advance the fake clock past
    // the new group's start so position() resolves it instead of an older
    // history entry that also has the fake context's frozen `at` timestamp.
    context.currentTime = player.transport.group.at + 1e-6;
    assert.ok(Math.abs(player.position - player.duration * 0.4) < 0.05, 'seek lands close to the requested position');
  } finally { player.dispose(); }
  console.log('PASS ProjectPlayer({preview:true}) load/play/update/pause/seek against the fake worker');
}

process.exitCode = 0;
