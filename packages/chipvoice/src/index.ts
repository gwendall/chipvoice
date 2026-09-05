import { APU, FRAME_RATE, type Channel, type Instrument } from "./driver.js";
import { getChip, type ChipDefinition } from "./chip.js";
import { nesChip } from "./chips/nes/index.js";
import { gbChip } from "./chips/gb/index.js";
import { mdChip } from "./chips/md/index.js";
import { snesChip } from "./chips/snes/index.js";
import { c64Chip } from "./chips/c64/index.js";
import { Sequencer, type ChannelClaim, type Song } from "./sequencer.js";

export type { Channel, Instrument, NoteSink, PlayNoteOptions } from "./driver.js";
/*
 * The driver on its own, for a host that brings its own sequencer.
 *
 * `Chip` is the whole thing - driver, sequencer, arbiter - and is what a game
 * should reach for. But a game that already has a music state machine with
 * pause, hold and resume, which `Chip` does not have, wants only the part that
 * turns notes into register writes and talks to the worklet. That was the
 * situation the library was extracted from, and it kept a copy of this class
 * for a month rather than depend on the package it came from.
 */
export { APU, OfflineDriver, FRAME_RATE, FRAME_TIME } from "./driver.js";
export { renderSong, recordSong, toWav, loopSeconds } from "./render.js";
export { toVgm } from "./vgm.js";
export type { VgmOptions } from "./vgm.js";
export { validateSong } from "./validate.js";
export type { Issue, IssueLevel, Measured, ValidationResult } from "./validate.js";
export type { RenderOptions, RenderResult } from "./render.js";
export {
  chips,
  getChip,
  registerChip,
  type ChipCore,
  type ChipDefinition,
  type ChipDriver,
  type ChipSpec,
  type DigitalChip,
  type FmOperator,
  type FmPatch,
  type FrameState,
  type NoteFrame,
  type RegisterEvent,
  type Role,
  type Waveform,
  type VoiceKind,
  type VoiceSpec,
} from "./chip.js";
export { NES_2A03, nesChip } from "./chips/nes/index.js";
export { GB_DMG, gbChip } from "./chips/gb/index.js";
export { MEGA_DRIVE, mdChip } from "./chips/md/index.js";
export { Ym2612 } from "./chips/md/ym2612.js";
export { Sn76489 } from "./chips/md/sn76489.js";
export { SNES, snesChip } from "./chips/snes/index.js";
export { SDsp } from "./chips/snes/sdsp.js";
export { encodeBrr } from "./chips/snes/brr.js";
export { C64, c64Chip } from "./chips/c64/index.js";
export { Sid, SID_VOICES, RATE_COMPARE, combinedWaveform, buildWaveTables, COMBINED_6581 } from "./chips/c64/sid.js";
export type { CombinedModel } from "./chips/c64/sid.js";
export { SID_6581_PROFILE, ladderWeights } from "./chips/c64/dsp.js";
export type { SidProfile } from "./chips/c64/dsp.js";
export { c64Kit } from "./chips/c64/arranger.js";
export type { Pattern, PercussionKit, Song } from "./sequencer.js";
export { DEFAULT_KIT, NES_ROLES, softKit } from "./sequencer.js";
export { arrange, instrumentsFor, resolveIntent, INTENTS, DEFAULT_INTENT } from "./score.js";
export type { Score, Intent, Instruments, LeadIntent, ChordIntent, BassIntent, PercIntent } from "./score.js";
export { WAVEFORMS } from "./chips/gb/arranger.js";
export { noteToFreq } from "./driver.js";

/**
 * Which channel is busy, and until when.
 *
 * This is the part that makes it sound like a console rather than like a
 * synthesiser with a retro preset. The 2A03 has four voices and no more, so a
 * game's music and its gunfire compete for them: firing a shot takes pulse 2
 * away from the chord for a tenth of a second, and you hear the music dip.
 *
 * Every library that generates "8-bit" sound in a browser gives the music its
 * own tracks and the effects theirs. That is the one thing the hardware could
 * not do, and losing it is most of why those libraries sound wrong.
 */
class Arbiter implements ChannelClaim {
  private busy = new Map<Channel, { from: number; until: number }[]>();

  claim(channel: Channel, from: number, until: number, now: number) {
    const previous = (this.busy.get(channel) ?? []).filter(i => i.until > now && i.from < from).map(i => ({ ...i, until: Math.min(i.until, from) }));
    this.busy.set(channel, [...previous, { from, until }]);
  }

  canPlay(channel: Channel, at: number) {
    const intervals = this.busy.get(channel);
    if (intervals) for (const interval of intervals) if (at >= interval.from && at < interval.until) return false;
    return true;
  }

  clear() {
    this.busy.clear();
  }
}

/**
 * The chip for an id. The two this build ships are imported by name, so a
 * bundler cannot drop them; anything else comes from the registry, which a
 * caller filled.
 */
export function chipFor(id: string): ChipDefinition | null {
  if (id === "2a03") return nesChip;
  if (id === "dmg") return gbChip;
  if (id === "md") return mdChip;
  if (id === "snes") return snesChip;
  if (id === "c64") return c64Chip;
  return getChip(id);
}

export interface ChipOptions {
  /** Which chip: `"2a03"` (the default) or `"dmg"`. `chips()` lists them. */
  chip?: string;
  /** Supply your own context to share one with the rest of your audio. */
  context?: AudioContext;
  /** 0 to 1. Default 0.78, which leaves headroom for the chip's own mixing. */
  gain?: number;
}

export interface SfxOptions {
  /** Note name (`"A4"`, `"F#3"`) or, on the noise channel, a period index 0-15. */
  note: string | number;
  instrument: Instrument;
  /** Seconds. */
  duration: number;
  /** Seconds from now. Default 0. */
  delay?: number;
  /** Scales the instrument's volume table, 0 to 1. */
  gain?: number;
  /** Semitones. */
  detune?: number;
}

/**
 * A sound chip, and a driver for it: a 2A03 unless asked for another.
 *
 * ```ts
 * const chip = await Chip.create();
 * chip.play(THEME);
 * chip.sfx("p2", { note: "B6", instrument: LASER, duration: 0.1 });
 * ```
 *
 * The same song plays on a Game Boy with `Chip.create({ chip: "dmg" })`: each
 * chip maps the song's four lines onto its own voices, and its own driver
 * writes its registers in its own idiom.
 *
 * `create` must be called from a user gesture, because that is when a browser
 * will let an AudioContext start. Everything after that is free.
 */
export class Chip {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly apu: APU;
  private readonly arbiter = new Arbiter();
  private readonly sequencer: Sequencer;
  private readonly ownsContext: boolean;
  private level: number;

  private constructor(
    ctx: AudioContext,
    apu: APU,
    master: GainNode,
    gain: number,
    owns: boolean,
  ) {
    this.ctx = ctx;
    this.apu = apu;
    this.master = master;
    this.ownsContext = owns;
    this.level = gain;
    this.sequencer = new Sequencer(apu, { canPlay: () => true }, () => ctx.currentTime, { roles: apu.chip.spec.roles });
  }

  /**
   * Starts the chip. Resolves to null when the browser has no AudioWorklet, so
   * a caller can degrade rather than crash - `chip?.sfx(...)` is a valid game.
   */
  static async create(options: ChipOptions = {}): Promise<Chip | null> {
    const Ctor =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!Ctor) return null;

    const definition = chipFor(options.chip ?? "2a03");
    if (!definition) throw new Error(`unknown chip: ${options.chip}`);

    const owns = !options.context;
    const ctx = options.context ?? new Ctor();
    const gain = options.gain ?? 0.78;

    const master = ctx.createGain();
    master.gain.value = gain;
    master.connect(ctx.destination);

    const apu = new APU(ctx, definition);
    const ok = await apu.init(master);
    if (!ok) {
      master.disconnect();
      if (owns) void ctx.close();
      return null;
    }
    return new Chip(ctx, apu, master, gain, owns);
  }

  /** The context, for sharing it with the rest of your audio. */
  get audioContext() {
    return this.ctx;
  }

  /** Which chip this is: its id, voices and roles. */
  get spec() {
    return this.apu.chip.spec;
  }

  /** The node everything runs through, for taps, analysers and recording. */
  get output(): AudioNode {
    return this.master;
  }

  get currentTime() {
    return this.ctx.currentTime;
  }

  /** Browsers suspend contexts on their own; call this from a gesture. */
  resume() {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** 0 to 1. Ramped rather than set, because a step is a click. */
  setGain(value: number) {
    this.level = value;
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  getGain() {
    return this.level;
  }

  // ------------------------------------------------------------------- music

  /**
   * Starts a song, or does nothing if that song is already playing.
   *
   * Songs are matched by `id`, not by identity: a variant built at call time -
   * a spread to change one field, which is the obvious way to derive one -
   * fails an identity check and restarts the piece on every call.
   */
  play(song: Song, position?: { step: number; orderIndex: number }) {
    this.sequencer.play(song, position);
  }

  stop() {
    this.sequencer.stop();
    this.arbiter.clear();
    this.apu.reset();
  }

  get playing() {
    return this.sequencer.isPlaying;
  }

  /** Which song is loaded and scheduling, by id. */
  get songId() {
    return this.sequencer.songId;
  }

  // --------------------------------------------------------------------- sfx

  /**
   * Plays an effect, taking the channel from the music for as long as it lasts.
   *
   * Pick `p2` for most things: drivers claimed pulse 2 first because the lead
   * usually lives on pulse 1, and losing the lead is more noticeable than
   * losing the chord.
   */
  sfx(channel: Channel, options: SfxOptions) {
    const at = this.ctx.currentTime + (options.delay ?? 0);
    this.arbiter.claim(channel, at, at + Math.max(1, Math.round(options.duration * FRAME_RATE)) / FRAME_RATE, this.ctx.currentTime);
    this.apu.playEffect(channel, {
      note: options.note,
      instrument: options.instrument,
      duration: options.duration,
      at,
      gain: options.gain,
      detune: options.detune,
    });
  }

  /**
   * Which step is sounding right now, or null when nothing is playing.
   *
   * Read this from a rAF loop to draw a playhead. It is deliberately the
   * *audible* position rather than the scheduled one: the sequencer queues up
   * to 200ms ahead, and a playhead drawn from the queue leads the sound by a
   * fifth of a second, which reads as a broken display rather than as latency.
   * Pass caller-owned `into` storage to reuse it in an animation loop. Without
   * it each call returns an independent snapshot; null leaves `into` untouched.
   */
  position(into?: { step: number; orderIndex: number }): { step: number; orderIndex: number } | null {
    return this.sequencer.positionAt(this.ctx.currentTime, into);
  }

  /**
   * Is this channel free at that moment?
   *
   * Useful for the second-tier effects: a UI blip is worth skipping if it would
   * cut the lead, where a gunshot never is. It is also the only way to observe
   * that channel stealing is happening at all, which is the thing this library
   * is built on and the thing no other one does.
   */
  canPlay(channel: Channel, at = this.ctx.currentTime): boolean {
    return this.arbiter.canPlay(channel, at);
  }

  /**
   * The next eighth-note boundary, or null when no music is playing.
   *
   * Rez's cheapest trick: snap a player's own sounds to the grid and somebody
   * with no rhythm still sounds like a musician. Never do it to the gun - a
   * shot that arrives an eighth late reads as a mushy trigger, and that is the
   * one thing a shooter cannot afford.
   */
  nextEighth(from = this.ctx.currentTime): number | null {
    return this.sequencer.nextEighth(from);
  }

  /**
   * How long to wait for the next eighth, capped.
   *
   * Past the cap it returns 0 and the sound plays now, because being on time
   * matters more than being in time.
   */
  beatDelay(maxWait = 0.12): number {
    const beat = this.nextEighth();
    if (beat === null) return 0;
    const wait = Math.max(0, beat - this.ctx.currentTime);
    return wait <= maxWait ? wait : 0;
  }

  /** Frees the worklet and, unless you supplied the context, closes it. */
  dispose() {
    this.sequencer.stop();
    this.apu.dispose();
    this.master.disconnect();
    if (this.ownsContext) void this.ctx.close();
  }
}
