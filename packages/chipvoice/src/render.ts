import { getChip, type ChipCore, type ChipDefinition, type RegisterEvent } from "./chip.js";
import { nesChip } from "./chips/nes/index.js";
import { gbChip } from "./chips/gb/index.js";
import { Sequencer, type Song } from "./sequencer.js";
import { OfflineDriver } from "./driver.js";

/**
 * Renders a song to samples, without a browser.
 *
 * This is the same chip and the same driver the live path uses, with a counter
 * where the audio clock was. That single substitution is what makes rendering a
 * pure function: the same song and sample rate always produce the same bytes,
 * byte for byte, which is what lets a server compute an MP3 on demand and cache
 * it forever rather than storing one.
 *
 * It is also how the engine gets tested at all without a browser in the loop.
 */
export interface RenderOptions {
  /** How long to render. Defaults to two times round the song's loop. */
  seconds?: number;
  sampleRate?: number;
  /** Which chip: `"2a03"` (the default) or `"dmg"`. */
  chip?: string;
  /** 0 to 1, applied by the chip's own output stage. */
  gain?: number;
  /** Render both channels. The 2A03 is mono, so this duplicates; the Game Boy is stereo. */
  stereo?: boolean;
}

export interface RenderResult {
  sampleRate: number;
  /** Mono, or the left channel when `stereo` was asked for. */
  left: Float32Array;
  right: Float32Array | null;
  seconds: number;
  /** Loudest absolute sample, for a caller that wants to normalise. */
  peak: number;
}

/**
 * How long one time round the song takes, at its own tempo.
 *
 * Pattern length comes from the bass line's token count - which is what makes a
 * bar in five possible - so this counts tokens rather than assuming sixteen.
 */
export function loopSeconds(song: Song): number {
  const stepTime = 60 / song.bpm / 4;
  const steps = song.order.reduce((sum, index) => {
    const pattern = song.patterns[index];
    return sum + (pattern ? pattern.bass.trim().split(/\s+/).length : 0);
  }, 0);
  return steps * stepTime;
}

/**
 * The chip for an id. Same reason as the driver: the two shipped chips are
 * imported so a bundler cannot drop them; anything else goes through the
 * registry, which a caller filled.
 */
function chipFor(id: string): ChipDefinition {
  const chip = id === "2a03" ? nesChip : id === "dmg" ? gbChip : getChip(id);
  if (!chip) throw new Error(`unknown chip: ${id}`);
  return chip;
}

export function renderSong(song: Song, options: RenderOptions = {}): RenderResult {
  const sampleRate = options.sampleRate ?? 44100;
  const chip = chipFor(options.chip ?? "2a03");

  const seconds = options.seconds ?? Math.min(300, loopSeconds(song) * 2);
  const total = Math.max(1, Math.round(seconds * sampleRate));

  const core = chip.create(sampleRate);
  core.setGain(options.gain ?? 0.78);

  /*
   * The driver and sequencer are the live ones, driven by a clock we advance.
   *
   * The sequencer schedules up to 200ms ahead of "now", so the loop moves the
   * clock forward in blocks, lets the sequencer fill the queue, then renders
   * that block. Rendering the whole thing in one call would leave the sequencer
   * with nothing scheduled past the first fifth of a second.
   */
  const driver = new OfflineDriver(core, chip);
  let clock = 0;
  const sequencer = new Sequencer(driver, { canPlay: () => true }, () => clock, { live: false, roles: chip.spec.roles });
  sequencer.play(song);

  const left = new Float32Array(total);
  const right = options.stereo ? new Float32Array(total) : null;

  const BLOCK = 4096;
  for (let offset = 0; offset < total; offset += BLOCK) {
    const size = Math.min(BLOCK, total - offset);
    clock = offset / sampleRate;
    // Fill the queue for the block about to be rendered, then flush the
    // driver's batching - live it waits for a frame, here nothing ever paints.
    sequencer.pump();
    driver.flush();
    core.render(
      left.subarray(offset, offset + size),
      right ? right.subarray(offset, offset + size) : null,
      offset,
    );
  }
  sequencer.stop();

  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]));

  return { sampleRate, left, right, seconds: total / sampleRate, peak };
}

/**
 * The register writes a song makes, without rendering a sample.
 *
 * The same driver and sequencer as `renderSong`, driven by the same clock,
 * with a core that keeps what it is given instead of playing it. This is what
 * `toVgm` wants, what the conformance corpus is built from, and the most
 * honest description of a song there is: every byte a NES would have seen.
 */
export function recordSong(
  song: Song,
  options: { seconds?: number; chip?: string } = {},
): { events: RegisterEvent[]; cycles: number } {
  const chip = chipFor(options.chip ?? "2a03");
  const seconds = options.seconds ?? Math.min(300, loopSeconds(song) * 2);
  const cycles = Math.round(seconds * chip.spec.clockHz);
  const events: RegisterEvent[] = [];
  const core: ChipCore = {
    schedule: (batch) => {
      for (const e of batch) events.push(e);
    },
    load() {},
    render() {},
    setGain() {},
    reset() {},
  };
  const driver = new OfflineDriver(core, chip);
  let clock = 0;
  const sequencer = new Sequencer(driver, { canPlay: () => true }, () => clock, { live: false, roles: chip.spec.roles });
  sequencer.play(song);
  // The renderer's block, so a song records the way it renders.
  const block = 4096 / 44100;
  for (let t = 0; t < seconds; t += block) {
    clock = t;
    sequencer.pump();
    driver.flush();
  }
  sequencer.stop();
  driver.flush();
  return {
    events: events.filter((e) => e.at < cycles).sort((a, b) => a.at - b.at),
    cycles,
  };
}

/**
 * A 16-bit PCM WAV, which every player and every encoder accepts.
 *
 * Written here rather than pulled in as a dependency: the header is 44 bytes
 * and a dependency for 44 bytes is a dependency to keep up to date forever.
 */
export function toWav(result: RenderResult): Uint8Array {
  const channels = result.right ? 2 : 1;
  const frames = result.left.length;
  const bytes = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, result.sampleRate, true);
  view.setUint32(28, result.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, bytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const source = c === 0 ? result.left : result.right!;
      const clamped = Math.max(-1, Math.min(1, source[i]));
      view.setInt16(offset, Math.round(clamped * 32767), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}
