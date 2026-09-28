import type { Manifest, ManifestEvent } from "./types.js";

/**
 * The runtime: `loadSounds` reads a manifest, decodes every variant once,
 * and returns a `GameSounds` a game calls `play`/`loop` on for the rest of
 * its life. No dependencies, a few KB: this is what `Chip.sfx()`'s channel
 * ownership - a voice cap, priority stealing, a cooldown - looks like
 * generalised past one chip's four voices to an arbitrary number of buses
 * and events.
 *
 * Every browser object this file touches (`AudioContext`, `AudioBufferSourceNode`,
 * `GainNode`, `AudioParam`, `fetch`) is used through the same small surface a
 * fake can implement, and every one of them can be injected
 * (`LoadOptions.context`, `.fetch`, `.random`), which is how `test/fake-audio-context.mjs`
 * exercises round-robin, jitter, cooldown, voice stealing, ducking and unlock
 * without a browser.
 */

// ------------------------------------------------------------------ sources

export type ManifestSource =
  | string
  | { manifest: Manifest; base?: string }
  | { remote: true; events: string[]; style?: string; api?: string };

export interface LoadOptions {
  /** Supply your own context to share one with the rest of your audio. Required in Node. */
  context?: AudioContext;
  /** Overrides `globalThis.fetch`, for a host with none or a test double. */
  fetch?: typeof fetch;
  /** Overrides `Math.random`, for a deterministic pitch-jitter test. Returns a value in [0, 1). */
  random?: () => number;
  /** How many voices may sound at once across every event. Default 32. */
  maxVoices?: number;
  /** Seconds a stolen or capped-out voice fades over instead of clicking off. Default 0.03. */
  stealFadeSeconds?: number;
  /** Skip decoding every file up front; decode each event's files on its first `play`/`loop`/`preload`. */
  lazy?: boolean;
}

// -------------------------------------------------------------------- play

export interface PlayOptions {
  /** Multiplies the event's own volume, 0 to 1. */
  volume?: number;
  /** -1 (left) to 1 (right). Silently ignored where `StereoPannerNode` does not exist. */
  pan?: number;
  /** Extra semitones on top of the event's pitch jitter. */
  detune?: number;
  /** Force one variant (0-based) instead of the next round-robin one. */
  variant?: number;
  /** Play through a bus other than the event's configured one. */
  bus?: string;
}

export interface StopOptions {
  /** Seconds to fade out over before actually stopping. Default 0 (stop at once). */
  fade?: number;
}

export interface PlayHandle {
  readonly event: string;
  /** Which variant (0-based) actually played, or -1 when nothing did (a missing/undecoded event). */
  readonly variant: number;
  readonly playing: boolean;
  stop(options?: StopOptions): void;
}

const NULL_HANDLE = (event: string): PlayHandle => ({
  event,
  variant: -1,
  playing: false,
  stop() {},
});

// -------------------------------------------------------------------- bus

export interface DuckOptions {
  /** Seconds to reach the ducked level. Default 0.02. */
  attack?: number;
  /** Seconds to recover from the ducked level back to the bus's own volume, starting right after the attack. Default 0.3. */
  release?: number;
}

/**
 * A named group of voices with one volume: `sfx.bus("music")` is a `GainNode`
 * a game's own music can be routed through (`.node`), so `.duck()` reaches
 * across a boundary this package does not otherwise cross - it never plays
 * music itself.
 */
export class Bus {
  readonly name: string;
  readonly node: GainNode;
  private base: number;

  constructor(name: string, node: GainNode, volume: number) {
    this.name = name;
    this.node = node;
    this.base = volume;
    node.gain.value = volume;
  }

  /** This bus's own volume, 0 to 1: what it returns to after a duck. */
  volume(value?: number): number {
    if (value !== undefined) {
      this.base = clamp01(value);
      this.node.gain.setValueAtTime(this.base, this.node.context.currentTime);
    }
    return this.base;
  }

  /**
   * Dips this bus by `amount` (0 to 1, a fraction of its own volume) and
   * recovers: a music bed ducking under an effect. `sfx.bus("music").duck(0.4)`
   * needs no matching "un-duck" call; the release ramp is scheduled here.
   */
  duck(amount: number, options: DuckOptions = {}): void {
    const attack = options.attack ?? 0.02;
    const release = options.release ?? 0.3;
    const now = this.node.context.currentTime;
    const target = this.base * (1 - clamp01(amount));
    this.node.gain.cancelScheduledValues(now);
    this.node.gain.setValueAtTime(this.node.gain.value, now);
    this.node.gain.linearRampToValueAtTime(target, now + attack);
    this.node.gain.linearRampToValueAtTime(this.base, now + attack + release);
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// -------------------------------------------------------------- event state

interface Voice {
  event: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  priority: number;
  startedAt: number;
  stop(fadeSeconds: number): void;
}

interface EventState {
  id: string;
  config: Required<Pick<ManifestEvent, "volume" | "pitchJitter" | "cooldownMs" | "maxVoices" | "priority" | "bus">>;
  loop: { start: number; end: number } | null;
  files: string[];
  fallback: string[];
  buffers: (AudioBuffer | null)[];
  decoded: boolean;
  decoding: Promise<void> | null;
  roundRobin: number;
  lastPlayedAt: number | null;
  active: Voice[];
}

const EVENT_DEFAULTS = { volume: 1, pitchJitter: 0, cooldownMs: 0, maxVoices: 4, priority: 1, bus: "sfx" } as const;

function joinPath(base: string, file: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file) || file.startsWith("/")) return file;
  const b = base.endsWith("/") ? base : `${base}/`;
  const f = file.startsWith("./") ? file.slice(2) : file;
  return b + f;
}

// -------------------------------------------------------------------- load

export async function loadSounds(source: ManifestSource, options: LoadOptions = {}): Promise<GameSounds> {
  const doFetch = options.fetch ?? (globalThis.fetch as typeof fetch | undefined);
  let manifest: Manifest;
  let base: string;

  if (typeof source === "string") {
    if (!doFetch) throw new Error("loadSounds: no fetch available; pass { fetch } or run in a browser");
    const response = await doFetch(source);
    if (!response.ok) throw new Error(`loadSounds: ${source} answered ${response.status}`);
    manifest = (await response.json()) as Manifest;
    base = manifest.base ?? "./";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base) && !base.startsWith("/")) {
      // Relative to the manifest itself, not to the page, so sounds.json can move.
      base = joinPath(source.slice(0, source.lastIndexOf("/") + 1) || "./", base);
    }
  } else if ("manifest" in source) {
    // Narrowing on "manifest" (present only on this branch of the union),
    // not "remote", so the remaining else is provably the remote variant -
    // `"remote" in source && source.remote` left TypeScript unable to prove
    // that of the final else branch, since a false `&&` does not say which
    // side of it was false.
    manifest = source.manifest;
    base = source.base ?? manifest.base ?? "./";
  } else {
    if (!doFetch) throw new Error("loadSounds: no fetch available; pass { fetch } or run in a browser");
    const api = source.api ?? "https://gamesounds.ai";
    const response = await doFetch(`${api}/api/v1/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: source.events, style: source.style }),
    });
    if (!response.ok) throw new Error(`loadSounds: ${api}/api/v1/resolve answered ${response.status}`);
    const resolved = (await response.json()) as { manifest: Manifest };
    manifest = resolved.manifest;
    base = manifest.base ?? api;
  }

  const context = options.context ?? (globalThis as { AudioContext?: new () => AudioContext }).AudioContext
    ? (options.context ?? new (globalThis as unknown as { AudioContext: new () => AudioContext }).AudioContext())
    : undefined;
  if (!context) throw new Error("loadSounds: no AudioContext available; pass { context }");

  const random = options.random ?? Math.random;
  const events = new Map<string, EventState>();
  for (const [id, event] of Object.entries(manifest.events)) {
    events.set(id, {
      id,
      config: {
        volume: event.volume ?? EVENT_DEFAULTS.volume,
        pitchJitter: event.pitchJitter ?? EVENT_DEFAULTS.pitchJitter,
        cooldownMs: event.cooldownMs ?? EVENT_DEFAULTS.cooldownMs,
        maxVoices: event.maxVoices ?? EVENT_DEFAULTS.maxVoices,
        priority: event.priority ?? EVENT_DEFAULTS.priority,
        bus: event.bus ?? EVENT_DEFAULTS.bus,
      },
      loop: event.loop ?? null,
      files: event.files.map((f) => joinPath(base, f)),
      fallback: (event.fallback ?? []).map((f) => joinPath(base, f)),
      buffers: new Array(event.files.length).fill(null),
      decoded: false,
      decoding: null,
      roundRobin: 0,
      lastPlayedAt: null,
      active: [],
    });
  }

  const sounds = new GameSounds(context, events, {
    fetch: doFetch,
    random,
    maxVoices: options.maxVoices ?? 32,
    stealFadeSeconds: options.stealFadeSeconds ?? 0.03,
  });

  if (!options.lazy) await Promise.all([...events.keys()].map((id) => sounds.preload(id)));
  return sounds;
}

// --------------------------------------------------------------- the class

interface Internal {
  fetch?: typeof fetch;
  random: () => number;
  maxVoices: number;
  stealFadeSeconds: number;
}

export class GameSounds {
  private readonly ctx: AudioContext;
  private readonly events: Map<string, EventState>;
  private readonly buses = new Map<string, Bus>();
  private readonly master: GainNode;
  private readonly opts: Internal;
  private globalActive: Voice[] = [];
  private unlocked = false;

  constructor(ctx: AudioContext, events: Map<string, EventState>, opts: Internal) {
    this.ctx = ctx;
    this.events = events;
    this.opts = opts;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
  }

  /** Every event id the loaded manifest names. */
  get eventIds(): string[] {
    return [...this.events.keys()];
  }

  has(event: string): boolean {
    return this.events.has(event);
  }

  /** Decodes an event's files now, instead of waiting for its first play. Safe to call more than once. */
  async preload(event: string): Promise<void> {
    const state = this.events.get(event);
    if (!state || state.decoded) return;
    if (state.decoding) return state.decoding;
    state.decoding = this.decode(state);
    await state.decoding;
  }

  private async decode(state: EventState): Promise<void> {
    const fetchFn = this.opts.fetch;
    if (!fetchFn) throw new Error(`loadSounds: no fetch available to load "${state.id}"`);
    await Promise.all(
      state.files.map(async (file, i) => {
        for (const candidate of [file, state.fallback[i]].filter((x): x is string => !!x)) {
          try {
            const response = await fetchFn(candidate);
            if (!response.ok) continue;
            const bytes = await response.arrayBuffer();
            state.buffers[i] = await this.ctx.decodeAudioData(bytes);
            return;
          } catch {
            // try the next candidate format
          }
        }
        console.warn(`gamesounds: "${state.id}" variant ${i + 1} could not be loaded (${file})`);
      }),
    );
    state.decoded = true;
  }

  /** A bus by name, creating it (at volume 1) the first time it is asked for. */
  bus(name: string): Bus {
    let bus = this.buses.get(name);
    if (!bus) {
      const node = this.ctx.createGain();
      node.connect(this.master);
      bus = new Bus(name, node, 1);
      this.buses.set(name, bus);
    }
    return bus;
  }

  /** Shorthand for `bus(name).volume(value)`. */
  volume(name: string, value: number): void {
    this.bus(name).volume(value);
  }

  /**
   * Unlocks audio on iOS/Safari: call this from the first tap or click.
   * Resumes a suspended context and starts one silent buffer, both required
   * inside the same user gesture on iOS. Safe to call more than once or on a
   * platform that never needed it.
   */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (typeof this.ctx.createBuffer !== "function") return;
    const buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate || 44100);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(0);
  }

  play(event: string, options: PlayOptions = {}): PlayHandle {
    return this.trigger(event, options, false);
  }

  /** Like `play`, but loops until `stop()`. Uses the manifest's own loop points when it has them. */
  loop(event: string, options: PlayOptions = {}): PlayHandle {
    return this.trigger(event, options, true);
  }

  private trigger(event: string, options: PlayOptions, loop: boolean): PlayHandle {
    const state = this.events.get(event);
    if (!state) {
      console.warn(`gamesounds: unknown event "${event}"`);
      return NULL_HANDLE(event);
    }
    if (!state.decoded && !state.decoding) void this.preload(event);
    const buffers = state.buffers.filter((b): b is AudioBuffer => b !== null);
    if (buffers.length === 0) return NULL_HANDLE(event);

    const now = this.ctx.currentTime;
    if (state.lastPlayedAt !== null && (now - state.lastPlayedAt) * 1000 < state.config.cooldownMs) {
      return NULL_HANDLE(event);
    }

    const priority = state.config.priority;
    if (!this.reserve(state, priority)) return NULL_HANDLE(event);
    state.lastPlayedAt = now;

    const variantIndex = options.variant !== undefined ? Math.max(0, Math.min(options.variant, state.buffers.length - 1)) : state.roundRobin;
    if (options.variant === undefined) state.roundRobin = (state.roundRobin + 1) % state.buffers.length;
    const buffer = state.buffers[variantIndex] ?? buffers[0];

    const bus = this.bus(options.bus ?? state.config.bus);
    const gain = this.ctx.createGain();
    gain.gain.value = clamp01((options.volume ?? 1) * state.config.volume);
    gain.connect(bus.node);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const jitter = state.config.pitchJitter;
    const jitterOffset = jitter > 0 ? (this.opts.random() * 2 - 1) * jitter : 0;
    // detune is semitones (PlayOptions' own doc comment): a playback-rate
    // multiplier is exponential in pitch, not linear, so +12 must double the
    // rate and -12 must halve it, not add/subtract 0.12 - see docs/DECISIONS.md.
    const semitones = options.detune ?? 0;
    source.playbackRate.value = Math.max(0.01, (1 + jitterOffset) * 2 ** (semitones / 12));
    if (loop) {
      source.loop = true;
      if (state.loop) {
        source.loopStart = state.loop.start;
        source.loopEnd = state.loop.end;
      }
    }
    if (options.pan !== undefined && typeof this.ctx.createStereoPanner === "function") {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan));
      source.connect(panner);
      panner.connect(gain);
    } else {
      source.connect(gain);
    }

    const voice: Voice = {
      event,
      source,
      gain,
      priority,
      startedAt: now,
      stop: (fadeSeconds: number) => stopVoice(this.ctx, source, gain, fadeSeconds),
    };
    state.active.push(voice);
    this.globalActive.push(voice);
    const remove = () => {
      state.active = state.active.filter((v) => v !== voice);
      this.globalActive = this.globalActive.filter((v) => v !== voice);
    };
    source.onended = remove;

    source.start(now);

    return {
      event,
      variant: variantIndex,
      get playing() {
        return state.active.includes(voice);
      },
      stop: (stopOptions: StopOptions = {}) => {
        voice.stop(stopOptions.fade ?? 0);
        remove();
      },
    };
  }

  /** Per-event and global voice caps, stealing the oldest lowest-priority voice when both are full. */
  private reserve(state: EventState, priority: number): boolean {
    if (state.active.length >= state.config.maxVoices) {
      const victim = weakestVoice(state.active, priority);
      if (!victim) return false;
      this.steal(victim);
    }
    if (this.globalActive.length >= this.opts.maxVoices) {
      const victim = weakestVoice(this.globalActive, priority);
      if (!victim) return false;
      this.steal(victim);
    }
    return true;
  }

  /**
   * Stops a voice and drops it from both the global list and its OWN
   * event's list - not the triggering event's list, which the global-cap
   * steal path used to filter by mistake. A voice stolen across events (the
   * global cap, not the per-event one) belongs to some other event than the
   * one that triggered the steal, so filtering only the triggering event's
   * `active` array left the victim's own event believing it was still
   * playing after its source had already been stopped.
   */
  private steal(victim: Voice): void {
    victim.stop(this.opts.stealFadeSeconds);
    const owner = this.events.get(victim.event);
    if (owner) owner.active = owner.active.filter((v) => v !== victim);
    this.globalActive = this.globalActive.filter((v) => v !== victim);
  }
}

/** The oldest voice at the lowest priority strictly under `priority`, or null when nothing may be stolen. */
function weakestVoice(voices: Voice[], priority: number): Voice | null {
  let weakest: Voice | null = null;
  for (const voice of voices) {
    if (voice.priority >= priority) continue;
    if (!weakest || voice.priority < weakest.priority || (voice.priority === weakest.priority && voice.startedAt < weakest.startedAt)) {
      weakest = voice;
    }
  }
  if (weakest) return weakest;
  // Nothing strictly weaker: fall back to the oldest at the same priority,
  // so a full bus of equal-priority effects still turns over.
  let oldest: Voice | null = null;
  for (const voice of voices) {
    if (voice.priority > priority) continue;
    if (!oldest || voice.startedAt < oldest.startedAt) oldest = voice;
  }
  return oldest;
}

function stopVoice(ctx: AudioContext, source: AudioBufferSourceNode, gain: GainNode, fadeSeconds: number): void {
  const now = ctx.currentTime;
  if (fadeSeconds > 0) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
    try {
      source.stop(now + fadeSeconds);
    } catch {
      // already stopped
    }
  } else {
    try {
      source.stop(now);
    } catch {
      // already stopped
    }
  }
}
