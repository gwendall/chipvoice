import {
  planPerformance,
  renderPerformance,
  nesChip,
  gbChip,
  mdChip,
  snesChip,
  type Performance,
} from 'chipvoice';

// Current demo consoles. This measures preparation, not a playback scheduler.
const chips = {'2a03': nesChip, dmg: gbChip, md: mdChip, snes: snesChip};
onmessage = ({data}: MessageEvent<Performance>) => {
  const results = [];
  for (const [id, chip] of Object.entries(chips)) {
    const started = performance.now();
    const plan = planPerformance(data, chip, {allowLoss: true, tempoScale: 1.25});
    const planned = performance.now();
    const core = chip.create(44100);
    core.setGain(.6);
    for (const block of plan.memory) core.load(block.address, block.bytes);
    core.schedule(plan.events);
    const initialized = performance.now();
    const length = 4096;
    const left = new Float32Array(length), right = new Float32Array(length);
    // Exercise different block boundaries on a persistent core, including
    // register events that occur between calls. No WAV round trip is involved.
    for (let offset = 0; offset < length; offset += 128) {
      core.render(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128), offset);
    }
    const first = performance.now();
    const expected = renderPerformance({...plan, seconds: length / 44100}, chip);
    if (!expected.right) throw Error('Expected a stereo reference');
    let maxError = 0;
    for (let i = 0; i < length; i++) {
      maxError = Math.max(maxError, Math.abs(left[i] - expected.left[i]), Math.abs(right[i] - expected.right[i]));
    }
    results.push({
      chip: id,
      songSeconds: plan.seconds,
      planningMs: planned - started,
      initializationMs: initialized - planned,
      firstBlockMs: first - initialized,
      totalFirstBlockMs: first - started,
      bufferSeconds: length / 44100,
      maxError,
    });
  }
  postMessage(results);
};
