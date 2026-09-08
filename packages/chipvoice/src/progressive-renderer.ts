import type {ChipCore, ChipDefinition} from './chip.js';
import type {PerformancePlan} from './performance.js';

type Checkpoint = {sample: number; event: number; core: ChipCore};
/** A seekable, bounded renderer. Checkpoints include the whole DSP, not merely
 * its registers. Only the commands needed by a block enter the core's queue,
 * keeping snapshots small even for large native captures. */
export class ProgressiveRenderer {
  private core: ChipCore;
  private sample = 0;
  private event = 0;
  private checkpoints: Checkpoint[] = [];
  private recent: Checkpoint[] = [];
  private readonly scratchL = new Float32Array(4096);
  private readonly scratchR = new Float32Array(4096);
  private readonly interval: number;
  readonly frames: number;
  constructor(readonly plan: PerformancePlan, readonly chip: ChipDefinition, readonly sampleRate = 44100, private gain = .6) {
    if (plan.chip !== chip.spec.id) throw Error('Plan/chip mismatch');
    this.frames = Math.round(plan.seconds * sampleRate);
    this.interval = Math.max(sampleRate, Math.ceil(this.frames / 24 / sampleRate) * sampleRate);
    this.core = this.fresh();
  }
  /** Independent cursors share only immutable checkpoints and the source plan. */
  branch() {
    const next = new ProgressiveRenderer(this.plan, this.chip, this.sampleRate, this.gain);
    if (this.core.fork) {next.core = this.core.fork(); next.sample = this.sample; next.event = this.event;}
    next.checkpoints = this.checkpoints.slice(); next.recent = this.recent.slice();
    return next;
  }
  adopt(next: ProgressiveRenderer) {
    this.core = next.core; this.sample = next.sample; this.event = next.event;
    for (const point of next.checkpoints) if (!this.checkpoints.some(p => p.sample === point.sample)) this.checkpoints.push(point);
    this.checkpoints.sort((a,b) => a.sample - b.sample);
    while (this.checkpoints.length > 25) this.checkpoints.shift();
    this.recent = [...this.recent, ...next.recent].slice(-4);
  }
  private fresh() {
    const core = this.chip.create(this.sampleRate); core.setGain(this.gain);
    for (const block of this.plan.memory) core.load(block.address, block.bytes);
    return core;
  }
  private checkpoint() {
    if (!this.core.fork) return;
    const checkpoint = {sample: this.sample, event: this.event, core: this.core.fork()};
    if (this.sample % this.interval === 0 && !this.checkpoints.some(p => p.sample === this.sample)) {
      this.checkpoints.push(checkpoint);
      if (this.checkpoints.length > 25) this.checkpoints.shift();
    } else {
      this.recent.push(checkpoint);
      if (this.recent.length > 4) this.recent.shift();
    }
  }
  private block(left: Float32Array, right: Float32Array) {
    const until = Math.ceil((this.sample + left.length) / this.sampleRate * this.chip.spec.clockHz);
    const begin = this.event;
    while (this.event < this.plan.events.length && this.plan.events[this.event].at < until) this.event++;
    if (this.event > begin) this.core.schedule(this.plan.events.slice(begin, this.event));
    this.core.render(left, right, this.sample);
    this.sample += left.length;
  }
  /** Caller may yield between these steps during a long cold seek. */
  *read(start: number, frames: number): Generator<void, {left: Float32Array; right: Float32Array}, void> {
    if (!Number.isInteger(start) || !Number.isInteger(frames) || start < 0 || frames < 1 || frames > this.sampleRate * 4 || start >= this.frames)
      throw Error('Invalid progressive audio range');
    if (start !== this.sample) {
      let nearest: Checkpoint | undefined;
      for (const point of [...this.checkpoints, ...this.recent]) {
        if (point.sample <= start && (!nearest || point.sample > nearest.sample)) nearest = point;
      }
      if (!(this.sample <= start && (!nearest || this.sample >= nearest.sample))) {
        this.core = nearest ? nearest.core.fork!() : this.fresh();
        this.sample = nearest?.sample ?? 0; this.event = nearest?.event ?? 0;
      }
      while (this.sample < start) {
        if (this.sample % this.interval === 0) this.checkpoint();
        const size = Math.min(4096, start - this.sample, this.interval - this.sample % this.interval);
        this.block(this.scratchL.subarray(0, size), this.scratchR.subarray(0, size)); yield;
      }
    }
    this.checkpoint();
    const size = Math.min(frames, this.frames - start), left = new Float32Array(size), right = new Float32Array(size);
    for (let offset = 0; offset < size;) {
      const count = Math.min(4096, size - offset, this.interval - this.sample % this.interval);
      this.block(left.subarray(offset, offset + count), right.subarray(offset, offset + count));
      offset += count;
      if (this.sample % this.interval === 0) this.checkpoint();
      yield;
    }
    return {left, right};
  }
}
