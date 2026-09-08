import {WORKLET_SOURCE} from '../project-worker-inline.js';
import type {MusicProject} from '../project.js';
import type {PerformancePlan, PerformanceLoss} from '../performance.js';
import type {MixReport} from '../mix.js';
import {Fade} from './fade.js';
import {outputTime} from './output-clock.js';
export type PreviewMetadata = {seconds: number; frames: number; loopStartSeconds: number; losses: PerformanceLoss[];
  mix: MixReport | null; native: boolean; engineVersion: string};
type Input = {project?: MusicProject; plan?: PerformancePlan; gain?: number; parts?: string[]};
type Chunk = {start: number; left: Float32Array; right: Float32Array};
type Clock = {at: number; offset: number; duration: number; loopStart: number; loop: boolean; presentation: unknown};
type Group = Clock & {source: PreviewSource; fade: Fade; nodes: Set<AudioBufferSourceNode>; nextFrame: number; nextAt: number; pumping: boolean; retiredAt?: number};
const cancelled = () => new DOMException('Preparation cancelled', 'AbortError');

class PreviewSource {
  private worker: Worker;
  private id = 0;
  private requests = new Map<number, {resolve: (value: any) => void; reject: (error: Error) => void}>();
  private chunks = new Map<string, Chunk>();
  ready!: Promise<PreviewMetadata>;
  meta!: PreviewMetadata;
  disposed = false;
  constructor(input: Input, readonly sampleRate: number) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], {type: 'text/javascript'}));
    try {this.worker = new Worker(url);} finally {URL.revokeObjectURL(url);}
    this.worker.onmessage = ({data}) => {
      const request = this.requests.get(data.id); if (!request) return;
      this.requests.delete(data.id);
      if (data.error || data.cancelled) request.reject(data.cancelled ? cancelled() : Error(data.error));
      else request.resolve(data);
    };
    this.worker.onerror = () => this.dispose(Error('Preview worker failed'));
    this.reload(input);
  }
  reload(input: Input) {
    this.chunks.clear();
    this.ready = this.request({type: 'load', ...input}).then(meta => this.meta = meta);
  }
  private request(data: object): Promise<any> {
    if (this.disposed) return Promise.reject(cancelled());
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.requests.set(id, {resolve, reject});
      try {this.worker.postMessage({id, sampleRate: this.sampleRate, ...data});}
      catch (error) {this.requests.delete(id); reject(error);}
    });
  }
  async read(start: number, frames: number, lane: 'foreground' | 'ahead' = 'foreground'): Promise<Chunk> {
    const key = `${start}:${frames}`, cached = this.chunks.get(key);
    if (cached) {this.chunks.delete(key); this.chunks.set(key, cached); return cached;}
    const chunk = await this.request({type: 'read', start, frames, lane}) as Chunk;
    this.chunks.set(key, chunk);
    // At most three seconds of Float32 stereo PCM plus the tiny first block.
    let bytes = 0; for (const value of this.chunks.values()) bytes += value.left.byteLength + value.right.byteLength;
    while (bytes > this.sampleRate * 8 * 3 && this.chunks.size > 1) {
      const key = this.chunks.keys().next().value!; const value = this.chunks.get(key)!;
      bytes -= value.left.byteLength + value.right.byteLength; this.chunks.delete(key);
    }
    return chunk;
  }
  dispose(error: Error = cancelled()) {
    if (this.disposed) return; this.disposed = true; this.worker.terminate();
    for (const request of this.requests.values()) request.reject(error);
    this.requests.clear(); this.chunks.clear();
  }
}

/** PCM is generated off the audio thread and scheduled a little ahead. There
 * is no whole-song buffer, WAV encoding or decoding on the interactive path.
 * Two sources overlap only during a handoff; one previous worker may stay warm.
 * Hardware state checkpoints live inside each source's worker. */
export class ProgressivePlayback {
  readonly output: GainNode;
  playing = false;
  loading = false;
  error = '';
  loop = true;
  presentation: unknown = null;
  metadata: PreviewMetadata | null = null;
  underruns = 0;
  private source: PreviewSource | null = null;
  private group: Group | null = null;
  private history: Clock[] = [];
  private offset = 0;
  private generation = 0;
  private disposed = false;
  private sources = new Map<string, PreviewSource>();
  private timer: ReturnType<typeof setInterval>;
  private retiring = new Set<Group>();
  constructor(readonly context: AudioContext, private changed: () => void = () => {}, readonly sampleRate = 44100) {
    this.output = context.createGain(); this.output.connect(context.destination);
    this.timer = setInterval(() => {
      for (const group of this.retiring) if (this.context.currentTime >= group.retiredAt!) {
        for (const node of group.nodes) {node.onended = null; node.disconnect();}
        group.nodes.clear(); group.fade.disconnect(); this.retiring.delete(group);
      }
      if (this.group && this.playing) {
        const clock = this.clock(outputTime(this.context));
        if (clock && !clock.loop && outputTime(this.context) >= clock.at + clock.duration - clock.offset) {
          this.pause(); this.offset = 1; this.changed();
        } else void this.pump(this.group);
      }
    }, 40);
  }
  private clock(at: number): Clock | null {
    let clock: Clock | null = null;
    for (const next of this.history) {if (next.at > at) break; clock = next;}
    return clock ?? this.history[0] ?? null;
  }
  private remember(group: Clock) {
    this.history.push({at: group.at, offset: group.offset, duration: group.duration, loopStart: group.loopStart, loop: group.loop, presentation: group.presentation});
    const audible = outputTime(this.context);
    while (this.history.length > 1 && this.history[1].at <= audible) this.history.shift();
    while (this.history.length > 64) this.history.shift();
  }
  audibleSelection() {return this.clock(outputTime(this.context))?.presentation ?? this.presentation;}
  get duration() {return this.clock(outputTime(this.context))?.duration ?? this.metadata?.seconds ?? 0;}
  phase(at = outputTime(this.context)) {
    const clock = this.clock(at);
    if (!this.playing || !clock) return this.offset;
    let seconds = clock.offset + Math.max(0, at - clock.at);
    if (seconds >= clock.duration) seconds = clock.loop
      ? clock.loopStart + (seconds - clock.loopStart) % (clock.duration - clock.loopStart) : clock.duration;
    return seconds / clock.duration;
  }
  async load(input: Input, options: {key?: string; restart?: boolean; presentation?: unknown; phase?: () => number} = {}) {
    if (this.disposed) throw Error('Player is disposed');
    const ticket = ++this.generation;
    this.loading = true; this.error = ''; this.changed();
    const key = options.key ?? JSON.stringify(input);
    let source = this.sources.get(key);
    if (!source || source.disposed) {
      const spare = this.sources.size >= 3 ? [...this.sources].find(([, value]) => value !== this.source && !value.disposed) : undefined;
      if (spare) {this.sources.delete(spare[0]); source = spare[1]; source.reload(input);}
      else source = new PreviewSource(input, this.sampleRate);
      this.sources.set(key, source);
    }
    else {this.sources.delete(key); this.sources.set(key, source);}
    // Cancel obsolete incoming preparation without ever terminating the audible
    // source. The current source and one recent variant are the only warm ones.
    for (const [oldKey, old] of this.sources) {
      if (this.sources.size <= 3) break;
      if (old !== this.source && old !== source) {old.dispose(); this.sources.delete(oldKey);}
    }
    try {
      await source.ready;
      if (ticket !== this.generation) return false;
      const presentation = options.presentation ?? source.meta;
      const selected = await this.selectSource(source, presentation, ticket, options.restart ? 0 : options.phase);
      if (selected) {this.loading = false; this.changed();}
      return selected;
    } catch (error) {
      if (ticket === this.generation && !this.disposed) {
        this.loading = false;
        if (!(error instanceof DOMException && error.name === 'AbortError')) this.error = error instanceof Error ? error.message : 'Preview failed';
        this.changed();
      }
      return false;
    }
  }
  private async selectSource(source: PreviewSource, presentation: unknown, ticket: number, phase?: number | (() => number)) {
    const meta = source.meta;
    const desired = () => Math.min(meta.frames - 1, Math.max(0, Math.floor((typeof phase === 'function' ? phase() : phase ?? this.phase(this.context.currentTime + .025)) * meta.frames)));
    let chunk: Chunk, position: number;
    for (;;) {
      position = desired();
      const start = this.playing && (this.group || typeof phase === 'function') ? Math.floor(position / this.sampleRate) * this.sampleRate : position;
      // Initial playback gets a short prefix. A moving handoff includes enough
      // future audio to keep the beat while a cold target is catching up.
      const size = this.playing && (this.group || typeof phase === 'function') ? this.sampleRate * 2 : Math.round(this.sampleRate * .25);
      chunk = await source.read(start, Math.min(size, meta.frames - start));
      if (ticket !== this.generation || this.disposed) return false;
      position = desired();
      if (position >= chunk.start && position < chunk.start + chunk.left.length) break;
    }
    if (ticket !== this.generation || this.disposed) return false;
    this.source = source; this.metadata = meta; this.presentation = presentation;
    if (!this.playing) {this.offset = position / meta.frames; this.history = []; return true;}
    const at = this.context.currentTime + .025, previous = this.group;
    const group: Group = {at, offset: position / this.sampleRate, duration: meta.seconds, loopStart: meta.loopStartSeconds,
      loop: this.loop, presentation, source, fade: new Fade(this.context, this.output), nodes: new Set(),
      nextFrame: chunk.start + chunk.left.length, nextAt: at + (chunk.start + chunk.left.length - position) / this.sampleRate, pumping: false};
    this.group = group; this.remember(group);
    this.schedule(group, chunk, at, (position - chunk.start) / this.sampleRate);
    group.fade.toValue(1, at, .015);
    if (previous) this.retire(previous, at);
    void this.pump(group);
    return true;
  }
  private schedule(group: Group, chunk: Chunk, at: number, offset = 0) {
    const buffer = this.context.createBuffer(2, chunk.left.length, this.sampleRate);
    buffer.copyToChannel(chunk.left as Float32Array<ArrayBuffer>, 0); buffer.copyToChannel(chunk.right as Float32Array<ArrayBuffer>, 1);
    const fade = Math.round(.003 * this.sampleRate), loopStart = Math.round(group.loopStart * this.sampleRate), end = group.source.meta.frames;
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = Math.max(0, loopStart - chunk.start); i < Math.min(data.length, loopStart + fade - chunk.start); i++) data[i] *= (chunk.start + i - loopStart) / (fade - 1);
      for (let i = Math.max(0, end - fade - chunk.start); i < data.length; i++) data[i] *= Math.max(0, (end - 1 - chunk.start - i) / (fade - 1));
    }
    const node = this.context.createBufferSource(); node.buffer = buffer; node.connect(group.fade.node); group.nodes.add(node);
    node.onended = () => {node.disconnect(); group.nodes.delete(node); if (!group.nodes.size && this.retiring.has(group)) {group.fade.disconnect(); this.retiring.delete(group);}};
    node.start(at, offset);
  }
  private async pump(group: Group) {
    if (group.pumping || group !== this.group || !this.playing || this.disposed) return;
    group.pumping = true;
    try {
      while (group === this.group && this.playing && group.nextAt < this.context.currentTime + 1.5) {
        if (group.nextFrame >= group.source.meta.frames) {
          if (!group.loop) break;
          group.nextFrame = Math.min(group.source.meta.frames - 1, Math.round(group.loopStart * this.sampleRate));
        }
        const chunk = await group.source.read(group.nextFrame, Math.min(Math.round(this.sampleRate * .5), group.source.meta.frames - group.nextFrame), 'ahead');
        if (group !== this.group || !this.playing || this.disposed) break;
        if (group.nextAt < this.context.currentTime) {
          this.underruns++;
          group.nextAt = this.context.currentTime + .025;
          group.at = group.nextAt; group.offset = group.nextFrame / this.sampleRate; this.remember(group);
        }
        this.schedule(group, chunk, group.nextAt);
        group.nextFrame += chunk.left.length; group.nextAt += chunk.left.length / this.sampleRate;
      }
    } catch (error) {
      if (group === this.group && !this.disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
        this.error = error instanceof Error ? error.message : 'Preview failed'; this.changed();
      }
    } finally {group.pumping = false;}
  }
  private retire(group: Group, at = this.context.currentTime) {
    group.fade.toValue(0, at, .015); group.retiredAt = at + .025; this.retiring.add(group);
    for (const node of group.nodes) {try {node.stop(at + .02);} catch {}}
    if (!group.nodes.size) {group.fade.disconnect(); this.retiring.delete(group);}
  }
  async toggle() {
    if (this.playing) {this.pause(); return;}
    this.playing = true; this.changed();
    if (this.offset >= 1) this.offset = 0;
    await this.context.resume();
    if (this.disposed || !this.playing) return;
    if (this.source && !this.group && !this.loading) {
      const ticket = ++this.generation;
      this.loading = true; this.changed();
      try {await this.selectSource(this.source, this.presentation, ticket, this.offset);}
      catch (error) {if (ticket === this.generation) this.error = error instanceof Error ? error.message : 'Preview failed';}
      if (ticket === this.generation) {this.loading = false; this.changed();}
    }
  }
  pause() {
    this.offset = this.phase(); this.playing = false;
    const group = this.group; this.group = null;
    this.presentation = this.audibleSelection(); this.history = [];
    if (group) this.retire(group);
    // Loading can finish, but it observes the paused intent before committing.
    this.changed();
  }
  seek(phase: number) {
    if (!Number.isFinite(phase) || this.disposed) return;
    const next = Math.max(0, Math.min(1, phase));
    if (!this.playing || !this.source) {this.offset = next; this.changed(); return;}
    const ticket = ++this.generation; this.loading = true; this.changed();
    void this.selectSource(this.source, this.presentation, ticket, next).then(() => {
      if (ticket === this.generation) {this.loading = false; this.changed();}
    }).catch(error => {if (ticket === this.generation) {this.loading = false; this.error = error.message; this.changed();}});
  }
  restart() {this.seek(0);}
  setLoop(loop: boolean) {if (loop === this.loop) return; this.loop = loop; if (this.playing) this.seek(this.phase(this.context.currentTime)); this.changed();}
  setVolume(volume: number) {this.output.gain.setTargetAtTime(volume, this.context.currentTime, .008);}
  cancelSelection() {this.generation++; this.loading = false; this.changed();}
  dispose() {
    if (this.disposed) return; this.pause(); this.disposed = true; this.generation++; clearInterval(this.timer);
    for (const source of this.sources.values()) source.dispose(); this.sources.clear();
    for (const group of this.retiring) {for (const node of group.nodes) {node.onended = null; try {node.stop();} catch {} node.disconnect();} group.fade.disconnect();}
    this.retiring.clear(); this.output.disconnect();
  }
}
