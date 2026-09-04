/**
 * Main-thread driver: turns instruments into timestamped register writes.
 *
 * Real NES games did not "play a sound"; a driver rewrote the APU registers
 * every NMI, sixty times a second. Instruments here are the same idea, and the
 * same shape FamiTracker settled on: per-frame tables for volume, arpeggio,
 * pitch and duty. Everything is expanded into writes stamped with a CPU cycle
 * and handed to a chip, which applies each one on the cycle it names.
 *
 * This layer is 2A03-shaped and will move when a second chip arrives: `duty`
 * and the two period formulas below are pulse-and-triangle facts, not facts
 * about chips. What survives is the idea - an instrument is a table read one
 * frame at a time.
 */

import { type ChipCore, type RegisterEvent, type WorkletMessage } from "./chip.js";
import { CPU_HZ } from "./chips/nes/dsp.js";
import { nesChip } from "./chips/nes/index.js";

export const FRAME_RATE = 60;
export const FRAME_TIME = 1 / FRAME_RATE;

export type Channel = "p1" | "p2" | "tri" | "noi";

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

/** Pulse and noise: f = CPU / (16 * (t + 1)). */
export function freqToPulsePeriod(freq: number): number {
  if (freq <= 0) return 0x7ff;
  return Math.max(0, Math.min(0x7ff, Math.round(CPU_HZ / (16 * freq) - 1)));
}

/** The triangle divides by 32, which is why it sounds an octave lower. */
export function freqToTrianglePeriod(freq: number): number {
  if (freq <= 0) return 0x7ff;
  return Math.max(0, Math.min(0x7ff, Math.round(CPU_HZ / (32 * freq) - 1)));
}

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
  /** Note name or frequency in Hz. On the noise channel, a period index 0-15. */
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

export class APU implements NoteSink {
  private node: AudioWorkletNode | null = null;
  private readonly ctx: AudioContext;
  private queue: RegisterEvent[] = [];
  private flushHandle: number | null = null;
  ready = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
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
    /*
     * The chip is imported, not looked up.
     *
     * It used to come from the registry, which a side-effecting import filled -
     * and the package declares `sideEffects: false`, so every bundler was free
     * to drop that import. It did: in the built studio the registry was empty,
     * `init` returned false, and `Chip.create()` resolved to null with no
     * error anywhere. The registry is still there for introspection; nothing
     * on the path that has to work depends on it.
     */
    const chip = nesChip;
    const url = URL.createObjectURL(
      new Blob([chip.workletSource], { type: "application/javascript" }),
    );
    try {
      await this.ctx.audioWorklet.addModule(url);
    } catch {
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
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

  reset() {
    this.queue.length = 0;
    this.post({ type: "reset" });
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
  protected enqueue(event: RegisterEvent) {
    this.queue.push(event);
    if (this.flushHandle === null) {
      this.flushHandle = requestAnimationFrame(() => this.flush());
    }
  }

  protected flush() {
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
    return Math.max(0, Math.round(time * CPU_HZ));
  }

  /**
   * Expands an instrument into per-frame register writes. Only actual changes
   * are emitted, so a flat sustained note costs one write.
   */
  playNote(channel: Channel, opts: PlayNoteOptions) {
    if (!this.ready) return;
    const inst = opts.instrument;
    const start = opts.at ?? this.ctx.currentTime;
    const isNoiseChannel = channel === "noi";
    // On the noise channel `note` is a period index 0-15, not a pitch.
    const baseFreq = isNoiseChannel
      ? 0
      : typeof opts.note === "string"
        ? noteToFreq(opts.note)
        : opts.note;
    const noiseBase = isNoiseChannel ? Number(opts.note) : 0;
    if (!isNoiseChannel && !baseFreq) return;

    const frames = Math.max(1, Math.round(opts.duration * FRAME_RATE));
    const gain = opts.gain ?? 1;
    const detune = opts.detune ?? 0;
    const isTriangle = channel === "tri";
    const isNoise = isNoiseChannel;

    // The channel's register block, and what this note last wrote to it, so
    // a held note costs nothing after its first frame.
    const base =
      channel === "p1" ? 0x4000 : channel === "p2" ? 0x4004 : channel === "tri" ? 0x4008 : 0x400c;
    let lastControl = -1;
    let lastLo = -1;
    let lastHi = -1;
    let pitchAcc = 0;

    for (let f = 0; f < frames; f++) {
      const at = this.cycleAt(start + f * FRAME_TIME);

      // Volume table, held at its last value when the instrument sustains.
      let vol: number;
      if (f < inst.volume.length) vol = inst.volume[f];
      else if (inst.sustain) vol = inst.volume[inst.volume.length - 1];
      else vol = 0;
      vol = Math.max(0, Math.min(15, Math.round(vol * gain)));

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

      const freq = isNoise ? 0 : baseFreq * Math.pow(2, semis / 12);
      let period = isNoise
        ? 0
        : isTriangle
          ? freqToTrianglePeriod(freq)
          : freqToPulsePeriod(freq);
      if (inst.pitch && inst.pitch.length > 0) {
        pitchAcc += inst.pitch[Math.min(f, inst.pitch.length - 1)];
        period = Math.max(0, Math.min(0x7ff, period + Math.round(pitchAcc)));
      }

      if (isNoise) {
        // Noise has 16 periods rather than a frequency, so arpeggio and slide
        // walk the period index instead of transposing.
        const idx = Math.max(0, Math.min(15, Math.round(noiseBase + semis)));
        const control = 0x30 | vol; // halted, constant volume
        const mode = (inst.noiseMode ? 0x80 : 0) | idx;
        if (f === 0) {
          this.enqueue({ at, addr: 0x400c, value: control });
          this.enqueue({ at, addr: 0x400e, value: mode });
          // Length 31, halted above, and the envelope restarted.
          this.enqueue({ at, addr: 0x400f, value: 31 << 3 });
        } else {
          if (control !== lastControl) this.enqueue({ at, addr: 0x400c, value: control });
          if (mode !== lastLo) this.enqueue({ at, addr: 0x400e, value: mode });
        }
        lastControl = control;
        lastLo = mode;
        continue;
      }

      const lo = period & 0xff;
      const hi = period >> 8;
      if (isTriangle) {
        if (f === 0) {
          // Control flag set and the linear counter at its longest: the
          // triangle plays until told otherwise, and the driver ends notes
          // itself.
          this.enqueue({ at, addr: 0x4008, value: 0xff });
          this.enqueue({ at, addr: 0x400a, value: lo });
          this.enqueue({ at, addr: 0x400b, value: (31 << 3) | hi });
        } else {
          if (lo !== lastLo) this.enqueue({ at, addr: 0x400a, value: lo });
          if (hi !== lastHi) this.enqueue({ at, addr: 0x400b, value: (31 << 3) | hi });
        }
        this.triangleHi = hi;
      } else {
        const duty = Array.isArray(inst.duty)
          ? inst.duty[f % inst.duty.length]
          : (inst.duty ?? 2);
        const control = (duty << 6) | 0x30 | vol; // halted, constant volume
        if (f === 0) {
          this.enqueue({ at, addr: base, value: control });
          // Sweep off, negate set. With negate clear the sweep's target is
          // twice the period, and anything at $400 or above - G#2 and below -
          // is muted. Every driver on the hardware wrote this byte.
          this.enqueue({ at, addr: base + 1, value: 0x08 });
          this.enqueue({ at, addr: base + 2, value: lo });
          // Length 31, halted above; the phase and the envelope restart.
          this.enqueue({ at, addr: base + 3, value: (31 << 3) | hi });
        } else {
          if (control !== lastControl) this.enqueue({ at, addr: base, value: control });
          if (lo !== lastLo) this.enqueue({ at, addr: base + 2, value: lo });
          // The only road to the high bits, and it restarts the phase. A
          // slide or a vibrato across the boundary clicks here, as on a NES.
          if (hi !== lastHi) this.enqueue({ at, addr: base + 3, value: (31 << 3) | hi });
        }
        lastControl = control;
      }
      lastLo = lo;
      lastHi = hi;
    }

    // Explicit note off, the way a driver would.
    this.silence(channel, this.cycleAt(start + frames * FRAME_TIME));
  }

  /** Silences one channel immediately, or at `at`. */
  stop(channel: Channel, at?: number) {
    if (!this.ready) return;
    this.silence(channel, this.cycleAt(at ?? this.ctx.currentTime));
  }

  /** The triangle's last period high bits, for silencing it without a blip. */
  private triangleHi = 0;

  /**
   * What a program did first: enable the four voices.
   *
   * `$4015` is written once here and never again. It sets every enable at
   * once, and a driver that schedules notes two hundred milliseconds ahead
   * cannot know what the other channels will be doing on the cycle a write
   * lands: an effect stopping pulse 2 now would carry a lead that ends later,
   * or miss one that starts later. Silence goes through each channel's own
   * registers instead.
   */
  protected powerOn() {
    this.enqueue({ at: 0, addr: 0x4015, value: 0x0f });
  }

  /**
   * Quiet, through the channel's own registers.
   *
   * A pulse or the noise goes quiet with a constant volume of 0. The triangle
   * has no volume, so its linear counter is told to reload with 0, which the
   * next quarter frame does - at most four milliseconds away - and the
   * sequencer stops where it is. `$400B` carries the period high bits, hence
   * the copy kept above: zeros there would pitch the last milliseconds up an
   * octave or more.
   */
  private silence(channel: Channel, at: number) {
    switch (channel) {
      case "p1":
        this.enqueue({ at, addr: 0x4000, value: 0x30 });
        return;
      case "p2":
        this.enqueue({ at, addr: 0x4004, value: 0x30 });
        return;
      case "noi":
        this.enqueue({ at, addr: 0x400c, value: 0x30 });
        return;
      case "tri":
        this.enqueue({ at, addr: 0x4008, value: 0x00 });
        this.enqueue({ at, addr: 0x400b, value: this.triangleHi });
        return;
    }
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
  private pending: RegisterEvent[] = [];

  constructor(core: ChipCore) {
    // The base class reads one thing from the context: `currentTime`, as the
    // default start of a note. Offline, that is the origin.
    super({ currentTime: 0 } as unknown as AudioContext);
    this.core = core;
    this.ready = true;
    this.powerOn();
  }

  protected override enqueue(event: RegisterEvent) {
    this.pending.push(event);
  }

  /** Hands everything queued to the chip. Called once per rendered block. */
  override flush() {
    if (this.pending.length === 0) return;
    this.core.schedule(this.pending);
    this.pending = [];
  }

  override setGain(value: number) {
    this.core.setGain(value);
  }

  override reset() {
    this.pending.length = 0;
    this.core.reset();
    this.powerOn();
  }
}
