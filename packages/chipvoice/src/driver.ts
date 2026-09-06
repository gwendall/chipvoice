/**
 * Main-thread driver: turns instruments into timestamped register writes.
 *
 * Real NES games did not "play a sound"; a driver rewrote the APU registers
 * every NMI, sixty times a second. Instruments here are the same idea, and the
 * same shape FamiTracker settled on: per-frame tables for volume, arpeggio,
 * pitch and duty. Everything is expanded into frames stamped with a cycle and
 * handed to the chip's own driver, which knows what each frame costs in bytes
 * to which addresses, and then to the chip, which applies each write on the
 * cycle it names.
 *
 * The split is the one the second chip forced. Reading a table, an arpeggio,
 * a slide, a vibrato, the frame clock: one piece of code, here. The 2A03's
 * sweep byte and the Game Boy's retrigger-on-volume: each chip's, in its own
 * `ChipDriver`. What survives across chips is the idea - an instrument is a
 * table read one frame at a time - and the frame it produces.
 */

import {
  type ChipCore,
  type ChipDefinition,
  type ChipDriver,
  type FmPatch,
  type NoteFrame,
  type RegisterEvent,
  type Waveform,
  type WorkletMessage,
} from "./chip.js";
import { nesChip } from "./chips/nes/index.js";

export const FRAME_RATE = 60;
export const FRAME_TIME = 1 / FRAME_RATE;

/**
 * A voice's id on the chip in use: `p1`, `p2`, `tri`, `noi` on the 2A03,
 * `ch1` to `ch4` on the Game Boy. `ChipSpec.voices` lists them.
 */
export type Channel = string;

const NOTE_OFFSETS: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

export function noteToFreq(note: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note.trim());
  if (!m) return 0;
  const [, letter, accidental, octave] = m;
  let semis = NOTE_OFFSETS[letter];
  if (accidental === "#") semis += 1;
  if (accidental === "b") semis -= 1;
  const midi = (Number(octave) + 1) * 12 + semis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export { freqToPulsePeriod, freqToTrianglePeriod } from "./chips/nes/driver.js";

/**
 * A per-frame instrument definition. Volume is 0-15, arpeggio is in semitones,
 * pitch is a signed period offset applied cumulatively, duty is 0-3.
 */
export interface Instrument {
  volume: number[];
  duty?: number | number[];
  arp?: number[];
  /** Added to the period each frame, cumulatively. Positive = lower pitch. */
  pitch?: number[];
  /** Semitones added per frame; simpler than a raw pitch table for slides. */
  slide?: number;
  /** Hold the last volume value instead of stopping, until note off. */
  sustain?: boolean;
  /** Loop the arpeggio table (default true) or play it once. */
  arpLoop?: boolean;
  vibrato?: { depth: number; rate: number; delay?: number };
  noiseMode?: boolean;
  /**
   * For a voice that picks a fixed waveform, which: one for the note, or one
   * per frame, the last held. The SID's kick is a triangle and its snare a
   * pulse for a frame, then noise. A chip without the choice ignores it.
   */
  waveform?: Waveform | Waveform[];
  /**
   * For a wavetable voice, the waveform: 32 samples, 0 to 15. The first
   * instrument attribute that is not a table of frames; a chip without such a
   * voice ignores it, and a wavetable voice without it plays a triangle.
   */
  wave?: number[];
  /**
   * For an FM voice, the patch: four operators, an algorithm, a feedback
   * level, in the YM2612's units. A chip without FM ignores it; an FM voice
   * without it plays the chip's default patch.
   */
  fm?: FmPatch;
  /**
   * For a sample voice, the name of a sample in the chip's bank. A chip
   * without samples ignores it; a sample voice without it plays the chip's
   * default for the role.
   */
  sample?: string;
}

/**
 * What the sequencer talks to.
 *
 * Two implementations: `APU` posts to a worklet, `OfflineDriver` writes into a
 * chip core directly. The sequencer cannot tell them apart, which is what lets
 * one piece of scheduling code serve both real time and a file.
 */
export interface NoteSink {
  readonly ready: boolean;
  playNote(channel: string, opts: PlayNoteOptions): void;
  stop(channel: string, at?: number): void;
}

export interface PlayNoteOptions {
  /** Note name or frequency in Hz. On a noise voice, a period index 0-15. */
  note: string | number;
  instrument: Instrument;
  /** Seconds. */
  duration: number;
  /** Absolute context time; defaults to now. */
  at?: number;
  /** Scales the instrument's volume table, 0..1. */
  gain?: number;
  /** Detune in semitones. */
  detune?: number;
}

type NoteFrames = NoteFrame[] & { end?: number };

const loadedModules = new WeakMap<AudioContext, Map<string, Promise<void>>>();

export class APU implements NoteSink {
  private node: AudioWorkletNode | null = null;
  private readonly ctx: AudioContext;
  /** The chip this drives. */
  readonly chip: ChipDefinition;
  private encoder: ChipDriver;
  private music = new Map<string, NoteFrames[]>();
  private interruptions = new Map<string, { from: number; until: number }[]>();
  private readonly noiseVoices: Set<string>;
  private queue: (RegisterEvent & { owner?: string })[] = [];
  private flushHandle: number | null = null;
  ready = false;

  /*
   * The default chip is imported, not looked up.
   *
   * It used to come from the registry, which a side-effecting import filled -
   * and the package declares `sideEffects: false`, so every bundler was free
   * to drop that import. It did: in the built studio the registry was empty,
   * `init` returned false, and `Chip.create()` resolved to null with no
   * error anywhere. The registry is still there for introspection; nothing
   * on the path that has to work depends on it.
   */
  constructor(ctx: AudioContext, chip: ChipDefinition = nesChip) {
    this.ctx = ctx;
    this.chip = chip;
    this.encoder = chip.driver();
    this.noiseVoices = new Set(chip.spec.voices.filter((v) => v.notes === "period").map((v) => v.id));
  }

  /**
   * Loads the processor and connects it.
   *
   * The worklet is inlined and handed over as a blob URL rather than fetched
   * from a path. A library that ships it as a file makes every consumer copy it
   * into their own public directory and keep that copy in step with the
   * package - and the failure mode is silence with no error, because
   * `addModule` on a 404 rejects into a catch nobody reads.
   */
  async init(destination: AudioNode): Promise<boolean> {
    if (!this.ctx.audioWorklet) return false;
    const chip = this.chip;
    let modules = loadedModules.get(this.ctx);
    if (!modules) { modules = new Map(); loadedModules.set(this.ctx, modules); }
    let loading = modules.get(chip.processorName);
    if (!loading) {
      const url = URL.createObjectURL(new Blob([chip.workletSource], { type: "application/javascript" }));
      loading = this.ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
      modules.set(chip.processorName, loading);
    }
    try { await loading; } catch { modules.delete(chip.processorName); return false; }
    this.node = new AudioWorkletNode(this.ctx, chip.processorName, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.connect(destination);
    this.ready = true;
    this.powerOn();
    return true;
  }

  /** The one place a message crosses to the worklet, so it is typed once. */
  private post(message: WorkletMessage) {
    this.node?.port.postMessage(message);
  }

  setGain(value: number) {
    this.post({ type: "gain", value });
  }

  /**
   * Puts sample data where the DMC reads it: the CPU's address space, from
   * `$8000` up, and in practice `$C000` up, which is where `$4012` can point.
   * The bytes are copied; the caller keeps its own.
   */
  load(address: number, bytes: Uint8Array) {
    this.post({ type: "memory", address, bytes }); // postMessage copies the bytes; no transfer
  }

  reset() {
    this.music.clear();
    this.interruptions.clear();
    this.encoder = this.chip.driver();
    this.queue.length = 0;
    this.resetCore();
    this.powerOn();
  }

  /**
   * Where a register write goes.
   *
   * Overridable because it is the one line that differs between playing and
   * rendering: live it batches a frame's worth into one postMessage, offline it
   * collects them for the next block. Everything above - the whole expansion of
   * an instrument into writes - is shared by construction rather than copied,
   * because a copy drifts, and a slide that drifts is a file that does not
   * match what the player heard.
   */
  protected enqueue(event: RegisterEvent & { owner?: string }) {
    this.queue.push(event);
    if (this.flushHandle === null) {
      this.flushHandle = requestAnimationFrame(() => this.flush());
    }
  }

  protected resetCore() { this.post({ type: "reset" }); }

  /** Release expired commands independently of which voice plays next. */
  protected prune() {
    const now = this.cycleAt(this.ctx.currentTime);
    for (const [voice, notes] of this.music) {
      let kept = 0;
      for (const note of notes) if ((note.end ?? note[note.length - 1].at) > now) notes[kept++] = note;
      notes.length = kept;
      if (!kept) this.music.delete(voice);
    }
    for (const [voice, intervals] of this.interruptions) {
      let kept = 0;
      for (const interval of intervals) if (interval.until > now) intervals[kept++] = interval;
      intervals.length = kept;
      if (!kept) this.interruptions.delete(voice);
    }
  }

  protected flush() {
    this.prune();
    if (this.flushHandle !== null) cancelAnimationFrame(this.flushHandle);
    this.flushHandle = null;
    if (!this.node || this.queue.length === 0) return;
    this.post({ type: "events", events: this.queue });
    this.queue = [];
  }

  /**
   * Seconds on the context clock to cycles on the chip's, which is what a
   * `RegisterEvent` is stamped with. Both count from the same origin - the
   * context's frame 0 is the chip's cycle 0 - and neither involves the sample
   * rate, which is why the offline driver needs no override here.
   */
  protected cycleAt(time: number) {
    return Math.max(0, Math.round(time * this.chip.spec.clockHz));
  }

  /**
   * Expands an instrument into frames, and the frames into the chip's writes.
   */
  private frames(channel: Channel, opts: PlayNoteOptions): NoteFrames {
    if (!this.ready) return [];
    const inst = opts.instrument;
    const start = opts.at ?? this.ctx.currentTime;
    const isNoise = this.noiseVoices.has(channel);
    // On a noise voice `note` is a period index 0-15, not a pitch.
    const baseFreq = isNoise
      ? 0
      : typeof opts.note === "string"
        ? noteToFreq(opts.note)
        : opts.note;
    const noiseBase = isNoise ? Number(opts.note) : 0;
    if (!isNoise && !baseFreq) return [];

    const frames = Math.max(1, Math.round(opts.duration * FRAME_RATE));
    const gain = opts.gain ?? 1;
    // SNES has finer hardware volume steps; preserve shared chord gain until
    // its register encoder. Keep legacy frame quantization on other chips.
    const fractionalVolume = this.chip.spec.id === "snes";
    const detune = opts.detune ?? 0;
    const wave = inst.wave ?? null;
    const waveforms = inst.waveform === undefined ? null : Array.isArray(inst.waveform) ? inst.waveform : [inst.waveform];
    const fm = inst.fm ?? null;
    const sample = inst.sample ?? null;
    let pitchAcc = 0;

    const states: NoteFrames = [];
    for (let f = 0; f < frames; f++) {
      const at = this.cycleAt(start + f * FRAME_TIME);

      // Volume table, held at its last value when the instrument sustains.
      let vol: number;
      if (f < inst.volume.length) vol = inst.volume[f];
      else if (inst.sustain) vol = inst.volume[inst.volume.length - 1];
      else vol = 0;
      vol *= gain;
      vol = Math.max(0, Math.min(15, fractionalVolume ? vol : Math.round(vol)));

      // Arpeggio, slide and vibrato all act on the note, not the period, so
      // they stay musical across octaves.
      let semis = detune;
      if (inst.arp && inst.arp.length > 0) {
        const loop = inst.arpLoop !== false;
        const idx = loop ? f % inst.arp.length : Math.min(f, inst.arp.length - 1);
        semis += inst.arp[idx];
      }
      if (inst.slide) semis += inst.slide * f;
      if (inst.vibrato) {
        const delay = inst.vibrato.delay ?? 0;
        if (f >= delay) {
          semis +=
            Math.sin(((f - delay) / inst.vibrato.rate) * Math.PI * 2) *
            inst.vibrato.depth;
        }
      }

      if (inst.pitch && inst.pitch.length > 0) {
        pitchAcc += inst.pitch[Math.min(f, inst.pitch.length - 1)];
      }

      const duty = Array.isArray(inst.duty)
        ? inst.duty[f % inst.duty.length]
        : (inst.duty ?? 2);

      states.push({
        at,
        volume: vol,
        freq: isNoise ? 0 : baseFreq * Math.pow(2, semis / 12),
        // Noise has periods rather than a frequency, so arpeggio and slide
        // walk the index instead of transposing.
        period: isNoise ? Math.max(0, Math.min(15, Math.round(noiseBase + semis))) : 0,
        duty,
        noiseMode: inst.noiseMode === true,
        pitchOffset: pitchAcc,
        waveform: waveforms ? waveforms[Math.min(f, waveforms.length - 1)] : null,
        wave,
        fm,
        sample,
      });
    }

    states.end = this.cycleAt(start + frames * FRAME_TIME);
    return states;
  }

  private writeFrames(channel: string, frames: NoteFrames, owner = channel, release = true) {
    if (!frames.length) return;
    for (const e of this.encoder.note(channel, frames)) this.enqueue({ ...e, owner });
    if (release) this.silence(channel, frames.end ?? frames[frames.length - 1].at + this.cycleAt(FRAME_TIME), owner);
  }

  /** Keep the musical command until its last frame, so an effect can release
   * the voice back to the correct envelope/pitch, including a held note. */
  playNote(channel: Channel, opts: PlayNoteOptions) {
    const frames = this.frames(channel, opts);
    if (!frames.length) return;
    const now = this.cycleAt(this.ctx.currentTime);
    const notes = (this.music.get(channel) ?? []).filter(n => n[n.length - 1].at + this.cycleAt(FRAME_TIME) > now);
    notes.push(frames);
    this.music.set(channel, notes);
    let remaining = frames;
    for (const interruption of this.interruptions.get(channel) ?? []) {
      if (!remaining.length) break;
      if ((remaining.end ?? remaining.at(-1)!.at) <= interruption.from) break;
      if (remaining[0].at >= interruption.until) continue;
      this.writeFrames(channel, remaining.filter(f => f.at < interruption.from), channel, false);
      remaining = this.tail(remaining, interruption.until);
      this.encoder = this.chip.driver();
    }
    this.writeFrames(channel, remaining);
  }

  private tail(frames: NoteFrames, at: number): NoteFrames {
    const end = frames.end ?? frames[frames.length - 1].at + this.cycleAt(FRAME_TIME);
    if (end <= at) return [];
    if (frames[0].at >= at) return frames;
    const previous = frames.filter(f => f.at <= at).at(-1)!;
    return Object.assign([{ ...previous, at }, ...frames.filter(f => f.at > at)], { end });
  }

  /** Effect ownership is separate from musical ownership, even when both
   * produce writes to a shared hardware register such as a select/data port. */
  playEffect(channel: Channel, opts: PlayNoteOptions) {
    const from = this.cycleAt(opts.at ?? this.ctx.currentTime);
    const until = from + this.cycleAt(Math.max(FRAME_TIME, Math.round(opts.duration * FRAME_RATE) * FRAME_TIME));
    this.cancel(channel, from);
    this.cancel(`fx:${channel}`, from);
    const now = this.cycleAt(this.ctx.currentTime);
    const preceding = (this.interruptions.get(channel) ?? []).filter(i => i.until > now && i.from < from).map(i => ({ ...i, until: Math.min(i.until, from) }));
    this.interruptions.set(channel, [...preceding, { from, until }]);
    this.encoder = this.chip.driver();
    this.writeFrames(channel, this.frames(channel, opts), `fx:${channel}`);
    // Re-encode full register state at release, not just the differences the
    // old note would have written assuming it still owned the voice.
    const notes = (this.music.get(channel) ?? []).filter(n => n[n.length - 1].at + this.cycleAt(FRAME_TIME) > from);
    for (const frames of notes.sort((a, b) => a[0].at - b[0].at)) {
      this.encoder = this.chip.driver();
      this.writeFrames(channel, this.tail(frames, until));
    }
    this.encoder = this.chip.driver();
    this.flush();
  }

  protected cancel(owner: string, from: number) {
    this.queue = this.queue.filter(e => e.owner !== owner || e.at < from);
    this.post({ type: "cancel", owner, from });
  }

  stop(channel: Channel, at?: number) {
    if (!this.ready) return;
    const cycle = this.cycleAt(at ?? this.ctx.currentTime);
    this.cancel(channel, cycle);
    this.encoder = this.chip.driver();
    this.music.set(channel, (this.music.get(channel) ?? []).map(n => Object.assign(n.filter(f => f.at < cycle), { end: Math.min(n.end ?? cycle, cycle) })).filter(n => n.length > 0));
    const taken = (this.interruptions.get(channel) ?? []).some(i => cycle >= i.from && cycle < i.until);
    if (!taken) this.silence(channel, cycle);
  }

  dispose() {
    if (this.flushHandle !== null) cancelAnimationFrame(this.flushHandle);
    this.queue = [];
    this.music.clear();
    this.post({ type: "dispose" });
    this.node?.disconnect();
    this.node?.port.close();
    this.node = null;
    this.ready = false;
  }

  /** What a program did first: its samples into memory, then the chip's own driver's writes. */
  protected powerOn() {
    const origin = this.cycleAt(this.ctx.currentTime);
    for (const block of this.encoder.memory?.() ?? []) this.load(block.address, block.bytes);
    // Driver startup offsets are relative to this engine's creation, while the
    // worklet clock belongs to the shared (possibly already running) context.
    for (const e of this.encoder.powerOn()) this.enqueue({ ...e, at: origin + e.at });
  }

  private silence(channel: Channel, at: number, owner = channel) {
    for (const e of this.encoder.noteOff(channel, at)) this.enqueue({ ...e, owner });
  }
}


/**
 * The same driver, writing into a chip core instead of a worklet.
 *
 * Everything above expands an instrument into register writes and then posts
 * them. This does the expansion identically and hands the writes straight to
 * the chip, which is the whole of the difference between playing and rendering.
 *
 * It reuses `APU`'s expansion by construction rather than by copy: the class
 * below extends it and replaces only the two methods that touch the browser.
 * A second copy of that loop would drift, and a slide that drifts is a file
 * that does not match what the player heard.
 */
export class OfflineDriver extends APU implements NoteSink {
  private readonly core: ChipCore;
  private pending: (RegisterEvent & { owner?: string })[] = [];

  constructor(core: ChipCore, chip: ChipDefinition = nesChip, currentTime: () => number = () => 0) {
    // The host owns the offline clock; expiry follows rendered time.
    super({ get currentTime() { return currentTime(); } } as AudioContext, chip);
    this.core = core;
    this.ready = true;
    this.powerOn();
  }

  protected override enqueue(event: RegisterEvent & { owner?: string }) {
    this.pending.push(event);
  }

  protected override cancel(owner: string, from: number) {
    this.pending = this.pending.filter(e => e.owner !== owner || e.at < from);
    this.core.cancel?.(owner, from);
  }

  /** Hands everything queued to the chip. Called once per rendered block. */
  override flush() {
    this.prune();
    if (this.pending.length === 0) return;
    this.core.schedule(this.pending);
    this.pending = [];
  }

  override setGain(value: number) {
    this.core.setGain(value);
  }

  override load(address: number, bytes: Uint8Array) {
    this.core.load(address, bytes);
  }

  protected override resetCore() {
    this.pending.length = 0;
    this.core.reset();
  }
}
