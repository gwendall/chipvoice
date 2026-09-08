import {ProgressivePlayback, type PerformancePlan} from 'chipvoice';
import {BufferPlayback} from './BufferPlayback.mjs';
import {outputTime} from './output-clock.mjs';

/** Recordings and editable command streams expose one timeline to the page.
 * Source ownership stays here; switching representation never stops Play. */
export class ArrangementPlayback {
  readonly output: GainNode;
  private recording: BufferPlayback;
  private preview: ProgressivePlayback;
  private current: BufferPlayback | ProgressivePlayback;
  private incoming: BufferPlayback | ProgressivePlayback | null = null;
  private previous: {player: BufferPlayback | ProgressivePlayback; at: number} | null = null;
  private gains: Map<BufferPlayback | ProgressivePlayback, GainNode>;
  private generation = 0;
  private pending = false;
  private failure = '';
  private timer: ReturnType<typeof setInterval>;
  playing = false;
  constructor(readonly context: AudioContext, private changed: () => void) {
    this.output = context.createGain(); this.output.connect(context.destination);
    this.recording = new BufferPlayback(context, changed);
    this.preview = new ProgressivePlayback(context, changed);
    this.preview.setVolume(.7);
    this.current = this.recording;
    this.gains = new Map([this.recording, this.preview].map(player => {
      const gain = context.createGain(); gain.gain.value = player === this.current ? 1 : 0;
      player.output.disconnect(); player.output.connect(gain); gain.connect(this.output);
      return [player, gain];
    }));
    this.timer = setInterval(() => {
      if (this.previous && outputTime(context) >= this.previous.at) {
        if (this.previous.player !== this.current) this.previous.player.pause();
        this.previous = null;
      }
      if (!this.pending && this.playing && !this.current.playing) {this.playing = false; changed();}
    }, 20);
  }
  private audible() {return this.previous && outputTime(this.context) < this.previous.at ? this.previous.player : this.current;}
  get loading() {return this.pending || this.current.loading;}
  get error() {return this.failure || this.current.error;}
  get presentation() {return this.current.presentation;}
  get side() {return this.current === this.recording ? this.recording.side : 0;}
  get buffers() {return this.current === this.recording ? this.recording.buffers : this.preview.metadata ? [this.preview.metadata] : [];}
  get loop() {return this.current.loop;}
  phase(at?: number) {return this.audible().phase(at);}
  audibleSelection() {return this.audible().audibleSelection();}
  private async selectWith(target: BufferPlayback | ProgressivePlayback, load: () => Promise<boolean>) {
    if (this.incoming && this.incoming !== this.current && this.incoming !== target) this.incoming.pause();
    const ticket = ++this.generation; this.incoming = target; this.pending = true; this.failure = ''; this.changed();
    target.setLoop(this.current.loop);
    if (target !== this.current && this.playing && !target.playing) void target.toggle();
    const selected = await load();
    if (ticket !== this.generation) return false;
    // Play/Pause may have changed while the source was preparing.
    if (selected && this.playing && !target.playing) await target.toggle();
    if (ticket !== this.generation) return false;
    this.pending = false; this.incoming = null;
    if (!selected) {this.failure = target.error; if (target !== this.current) target.pause(); this.changed(); return false;}
    if (target !== this.current) {
      const old = this.current, at = this.context.currentTime + .025;
      this.current = target;
      for (const [player, gain] of this.gains) {
        gain.gain.cancelScheduledValues(this.context.currentTime);
        gain.gain.setTargetAtTime(player === target ? 1 : 0, at, .008);
      }
      this.previous = this.playing ? {player: old, at} : null;
      if (!this.playing) old.pause();
    }
    if (!this.playing) target.pause();
    this.changed(); return true;
  }
  select(...args: Parameters<BufferPlayback['select']>) {
    const [entries, levels, options = {}] = args;
    return this.selectWith(this.recording, () => this.recording.select(entries, levels, {...options,
      phase: this.current === this.recording ? undefined : () => this.current.phase(this.context.currentTime + .025)}));
  }
  selectPlan(plan: PerformancePlan, presentation: unknown, key: string, restart = false) {
    // Carry the normalized beat into the first selection of the other engine.
    if (this.current !== this.preview) this.preview.seek(restart ? 0 : this.phase(this.context.currentTime));
    return this.selectWith(this.preview, () => this.preview.load({plan}, {key, presentation, restart, phase: () => this.current.phase(this.context.currentTime + .025)}));
  }
  selectSide(side: number) {return this.recording.selectSide(side);}
  setSide(side: number) {this.recording.setSide(side);}
  cancelSelection() {
    this.generation++; this.pending = false;
    if (this.incoming && this.incoming !== this.current) this.incoming.pause();
    this.incoming = null; this.recording.cancelSelection(); this.preview.cancelSelection();
  }
  async toggle() {
    if (this.playing) {this.pause(); return;}
    this.playing = true; this.changed();
    const starts: Promise<void>[] = [];
    if (!this.current.playing) starts.push(this.current.toggle());
    if (this.incoming && this.incoming !== this.current && !this.incoming.playing) starts.push(this.incoming.toggle());
    await Promise.all(starts);
  }
  pause() {this.playing = false; this.recording.pause(); this.preview.pause(); this.changed();}
  seek(phase: number) {this.current.seek(phase);}
  restart() {this.current.restart();}
  setLoop(loop: boolean) {this.recording.setLoop(loop); this.preview.setLoop(loop);}
  setVolume(value: number) {this.output.gain.setTargetAtTime(value, this.context.currentTime, .008);}
  dispose() {clearInterval(this.timer); this.recording.dispose(); this.preview.dispose(); for (const gain of this.gains.values()) gain.disconnect(); this.output.disconnect();}
}
