import { BufferPlayback } from "./playback/BufferPlayback.js";
import { WORKLET_SOURCE } from "./project-worker-inline.js";
import type { MusicProject, ProjectChip } from "./project.js";
import type { PerformanceLoss } from "./performance.js";
export interface PreparedProjectAudio {
  wav: ArrayBuffer;
  seconds: number;
  peak: number;
  engineVersion: string;
  native: boolean;
  loopStartSeconds: number;
  losses: PerformanceLoss[];
}
export interface PrepareProjectOptions {
  signal?: AbortSignal;
  sampleRate?: number;
  parts?: string[];
  onProgress?: (fraction: number) => void;
}
/** Worker preparation is disposable and cancellable, with no AudioContext required. */
export function prepareProject(
  project: MusicProject,
  options: PrepareProjectOptions = {},
): Promise<PreparedProjectAudio> {
  return runProjectWorker(
    {
      project,
      options: { sampleRate: options.sampleRate, parts: options.parts },
    },
    options,
  );
}
export function importProjectMidi(
  bytes: Uint8Array,
  options: PrepareProjectOptions & { title?: string; chip?: ProjectChip } = {},
): Promise<MusicProject> {
  return runProjectWorker(
    { midi: bytes, title: options.title, chip: options.chip },
    options,
  );
}
function runProjectWorker<T>(
  message: unknown,
  options: PrepareProjectOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("Preparation cancelled", "AbortError"));
      return;
    }
    const url = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "text/javascript" }),
    );
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      reject(error);
      return;
    }
    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
      options.signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Preparation cancelled", "AbortError"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(new Error("Preparation worker failed"));
    };
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) {
        options.onProgress?.(data.progress);
        return;
      }
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.project ?? data);
    };
    try {
      worker.postMessage(message);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
export interface ProjectPlayerOptions {
  context?: AudioContext;
  onChange?: () => void;
}
/** One audible clock and one active preparation. Loading never changes Play intent. */
export class ProjectPlayer {
  readonly context: AudioContext;
  private readonly ownsContext: boolean;
  private readonly transport: BufferPlayback;
  private job: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private url: string | null = null;
  private wanted: MusicProject | null = null;
  private wantedOptions: Omit<PrepareProjectOptions, "signal"> = {};
  private changed: () => void;
  preparing = false;
  progress = 0;
  error = "";
  prepared: PreparedProjectAudio | null = null;
  constructor(options: ProjectPlayerOptions = {}) {
    this.ownsContext = !options.context;
    this.context = options.context ?? new AudioContext();
    this.changed = options.onChange ?? (() => {});
    this.transport = new BufferPlayback(this.context, this.changed);
    this.transport.setVolume(1);
  }
  get output(): AudioNode {
    return this.transport.output;
  }
  get playing() {
    return this.transport.playing;
  }
  get audibleProject(): MusicProject | null {
    return (
      (this.transport.audibleSelection() as { project?: MusicProject } | null)
        ?.project ?? null
    );
  }
  get duration() {
    return (
      (this.transport.audibleSelection() as { seconds?: number } | null)
        ?.seconds ??
      this.prepared?.seconds ??
      0
    );
  }
  get position() {
    return this.transport.phase() * this.duration;
  }
  get loop() {
    return this.transport.loop;
  }
  set loop(value: boolean) {
    this.transport.setLoop(value);
  }
  async load(
    project: MusicProject,
    options: Omit<PrepareProjectOptions, "signal"> = {},
  ): Promise<boolean> {
    if (this.disposed) throw Error("Player is disposed");
    const generation = ++this.generation;
    this.job?.abort();
    this.transport.cancelSelection();
    const job = new AbortController();
    this.job = job;
    this.wanted = structuredClone(project);
    this.wantedOptions = { ...options, parts: options.parts?.slice() };
    this.preparing = true;
    this.progress = 0;
    this.error = "";
    this.changed();
    try {
      const prepared = await prepareProject(project, {
        ...options,
        signal: job.signal,
        onProgress: (fraction) => {
          this.progress = fraction;
          options.onProgress?.(fraction);
          this.changed();
        },
      });
      if (generation !== this.generation) return false;
      const url = URL.createObjectURL(
        new Blob([prepared.wav], { type: "audio/wav" }),
      );
      const selected = await this.transport.select(
        [
          {
            file: url,
            loopStartSeconds: prepared.loopStartSeconds,
            loopFadeSeconds: 0.003,
          },
        ],
        [1],
        { presentation: { seconds: prepared.seconds, project: this.wanted } },
      );
      if (!selected || generation !== this.generation) {
        URL.revokeObjectURL(url);
        if (!selected && generation === this.generation)
          throw Error(this.transport.error || "Audio could not load");
        return false;
      }
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = url;
      this.transport.cache.clear();
      this.prepared = prepared;
      this.preparing = false;
      this.changed();
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.preparing = false;
        if (!(error instanceof DOMException && error.name === "AbortError"))
          this.error =
            error instanceof Error ? error.message : "Preparation failed";
        this.changed();
      }
      return false;
    }
  }
  update(settings: Partial<MusicProject["settings"]>) {
    if (!this.wanted) throw Error("Load a project first");
    return this.load(
      {
        ...this.wanted,
        settings: { ...this.wanted.settings, ...settings },
      },
      this.wantedOptions,
    );
  }
  async play() {
    if (this.disposed) throw Error("Player is disposed");
    try {
      await this.context.resume();
      if (!this.transport.playing) await this.transport.toggle();
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Audio could not start";
      this.changed();
      throw error;
    }
  }
  pause() {
    this.transport.pause();
  }
  stop() {
    this.pause();
    this.restart();
  }
  restart() {
    this.transport.restart();
  }
  seek(seconds: number) {
    if (!Number.isFinite(seconds)) throw Error("Seek requires finite seconds");
    this.transport.seek(this.duration ? seconds / this.duration : 0);
  }
  setVolume(gain: number) {
    if (!Number.isFinite(gain) || gain < 0 || gain > 1)
      throw Error("Volume must be 0–1");
    this.transport.setVolume(gain);
  }
  cancel() {
    this.generation++;
    this.job?.abort();
    this.transport.cancelSelection();
    this.preparing = false;
    this.changed();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.transport.dispose();
    if (this.url) URL.revokeObjectURL(this.url);
    if (this.ownsContext) void this.context.close();
  }
}
