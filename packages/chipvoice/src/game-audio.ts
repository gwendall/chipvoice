import type { RegisterEvent } from "./chip.js";
import { MD1_PROFILE, MdCore, type MdOutputProfile } from "./chips/md/dsp.js";
import type { RenderResult } from "./render.js";

/**
 * From register writes to the audio a game ships: render, trim, level, pack
 * the effects into one sprite, measure where each sound starts.
 *
 * A game that plays pre-rendered audio (the cores stay in its build script,
 * the player only plays files) needs the same few steps around the render
 * every time. They live here so each game does not keep its own copy.
 * Encoding is left to the caller: `toWav` writes the WAV any encoder takes.
 *
 * Every helper returns a new `RenderResult` and leaves its input alone.
 */

/**
 * The Model 1 output stage opened up to 12 kHz. `MD1_PROFILE` low-passes at
 * 2.8 kHz, as the first units did, and dulls every hat and every hiss; this is
 * the same stage with the top left in, nearer a later unit and what an
 * emulator plays.
 */
export const MD_BRIGHT_PROFILE: MdOutputProfile = { ...MD1_PROFILE, name: "bright", lowPassHz: 12000 };

export interface RenderMdEventsOptions {
  /** How long to render. */
  seconds: number;
  sampleRate?: number;
  /** The output stage. Default `MD1_PROFILE`. */
  profile?: MdOutputProfile;
  /** The chip's master gain, 0 to 1. Default 0.78, as `renderSong`. */
  gain?: number;
}

/** Plays register writes on a fresh Mega Drive, stereo, as `compileMdVoices` or `recordSong` made them. */
export function renderMdEvents(events: RegisterEvent[], options: RenderMdEventsOptions): RenderResult {
  const sampleRate = options.sampleRate ?? 44100;
  if (!Number.isFinite(options.seconds) || options.seconds <= 0) throw new Error("renderMdEvents: seconds must be positive");
  const core = new MdCore(sampleRate, options.profile ?? MD1_PROFILE);
  core.setGain(options.gain ?? 0.78);
  core.schedule(events);
  const total = Math.round(options.seconds * sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (let offset = 0; offset < total; offset += 4096) core.render(left.subarray(offset, offset + 4096), right.subarray(offset, offset + 4096), offset);
  return result(sampleRate, left, right);
}

function peakOf(left: Float32Array, right: Float32Array | null): number {
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), right ? Math.abs(right[i]) : 0);
  return peak;
}
function result(sampleRate: number, left: Float32Array, right: Float32Array | null): RenderResult {
  return { sampleRate, left, right, seconds: left.length / sampleRate, peak: peakOf(left, right) };
}

/** Every sample times `k`. */
export function scaleRender(r: RenderResult, k: number): RenderResult {
  const left = new Float32Array(r.left.length);
  const right = r.right ? new Float32Array(r.right.length) : null;
  for (let i = 0; i < left.length; i++) left[i] = r.left[i] * k;
  if (right) for (let i = 0; i < right.length; i++) right[i] = r.right![i] * k;
  return result(r.sampleRate, left, right);
}

export interface TrimOptions {
  /** Where the sound has died away, in dB under its peak. Default -60. */
  floorDb?: number;
  /** A fade over the last of it, so the cut does not click. Default 0.005. */
  fadeSeconds?: number;
}

/** Cuts a render where it has died away, with a short fade: a jingle or an effect ends when it is silent. */
export function trimRender(r: RenderResult, options: TrimOptions = {}): RenderResult {
  const floor = peakOf(r.left, r.right) * 10 ** ((options.floorDb ?? -60) / 20);
  const L = r.left;
  const R = r.right;
  let end = L.length;
  while (end > 1 && Math.abs(L[end - 1]) < floor && (!R || Math.abs(R[end - 1]) < floor)) end--;
  const fade = Math.round((options.fadeSeconds ?? 0.005) * r.sampleRate);
  const left = L.slice(0, end + fade);
  const right = R ? R.slice(0, end + fade) : null;
  for (let i = 0; i < fade && i < left.length; i++) {
    left[left.length - 1 - i] *= i / fade;
    if (right) right[right.length - 1 - i] *= i / fade;
  }
  return result(r.sampleRate, left, right);
}

export interface LevelOptions {
  /** The loudest a sample may get, linear. */
  peak: number;
  /** The loudness to reach, RMS in dB over the whole render, both channels. Without it, the peak is the target. */
  rmsDb?: number;
}

/**
 * Levels a render: to `rmsDb` if given, never past `peak`. Effects levelled by
 * loudness sit together in a mix the way a peak normalisation does not: a
 * short click and a long blast at the same peak are not the same loudness.
 */
export function levelRender(r: RenderResult, options: LevelOptions): RenderResult {
  const peak = peakOf(r.left, r.right);
  if (peak === 0) return scaleRender(r, 1);
  let k = options.peak / peak;
  if (options.rmsDb !== undefined) {
    const L = r.left;
    const R = r.right;
    let e = 0;
    if (R) for (let i = 0; i < L.length; i++) e += L[i] ** 2 + R[i] ** 2;
    else for (let i = 0; i < L.length; i++) e += L[i] ** 2;
    k = Math.min(10 ** (options.rmsDb / 20) / Math.sqrt(e / ((R ? 2 : 1) * L.length)), k);
  }
  return scaleRender(r, k);
}

export interface SpriteOptions {
  /** Silence before, between and after the sounds: room for a decoder that shifts the audio. Default 0.15. */
  gapSeconds?: number;
}

export interface Sprite {
  render: RenderResult;
  /** Where each sound is in the sprite, in seconds. */
  sprites: Record<string, { start: number; duration: number }>;
}

/**
 * Lays sounds end to end in one render, a gap before, between and after, so a
 * game loads one file for every effect and plays a slice of it.
 */
export function packSprite(parts: Iterable<[name: string, render: RenderResult]>, options: SpriteOptions = {}): Sprite {
  const list = [...parts];
  if (!list.length) throw new Error("packSprite: nothing to pack");
  const sampleRate = list[0][1].sampleRate;
  const stereo = list.some(([, r]) => r.right);
  for (const [name, r] of list) if (r.sampleRate !== sampleRate) throw new Error(`packSprite: ${name} is at ${r.sampleRate} Hz, the first at ${sampleRate}`);
  const gap = Math.round((options.gapSeconds ?? 0.15) * sampleRate);
  const total = list.reduce((s, [, r]) => s + r.left.length + gap, gap);
  const left = new Float32Array(total);
  const right = stereo ? new Float32Array(total) : null;
  const sprites: Sprite["sprites"] = {};
  let o = gap;
  for (const [name, r] of list) {
    if (name in sprites) throw new Error(`packSprite: ${name} is given twice`);
    left.set(r.left, o);
    if (right) right.set(r.right ?? r.left, o);
    sprites[name] = { start: o / sampleRate, duration: r.left.length / sampleRate };
    o += r.left.length + gap;
  }
  return { render: result(sampleRate, left, right), sprites };
}

export interface OnsetOptions {
  /** How much of the opening to look at. Default 0.3 seconds. */
  windowSeconds?: number;
  /** The level that counts as the start, as a fraction of the opening's peak. Default 0.25. */
  fraction?: number;
}

/**
 * Where the sound starts, in seconds: the first sample at a fraction of the
 * opening's peak. Measure the render, then the decoded file the same way:
 * the difference is the decoder's shift (an MP3's encoder delay, when the
 * decoder ignores its header), to add to every offset into the file.
 */
export function renderOnset(r: Pick<RenderResult, "left" | "right" | "sampleRate">, options: OnsetOptions = {}): number {
  const L = r.left;
  const R = r.right;
  const n = Math.min(L.length, Math.round((options.windowSeconds ?? 0.3) * r.sampleRate));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), R ? Math.abs(R[i]) : 0);
  const at = peak * (options.fraction ?? 0.25);
  for (let i = 0; i < n; i++) if (Math.abs(L[i]) >= at || (R && Math.abs(R[i]) >= at)) return i / r.sampleRate;
  return 0;
}
