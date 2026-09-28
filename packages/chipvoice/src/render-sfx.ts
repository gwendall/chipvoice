import { getChip, type ChipDefinition } from "./chip.js";
import { nesChip } from "./chips/nes/index.js";
import { gbChip } from "./chips/gb/index.js";
import { mdChip } from "./chips/md/index.js";
import { snesChip } from "./chips/snes/index.js";
import { c64Chip } from "./chips/c64/index.js";
import { OfflineDriver, type Channel, type Instrument } from "./driver.js";
import type { RenderResult } from "./render.js";

/**
 * One shot, not a song: a chip, a voice, a note and an instrument, rendered
 * once with no browser, no sequencer and no `Song`. `renderSong` plays a
 * document's four lines over time; this plays a single `Chip.sfx()` call and
 * hands back the samples, in the same `RenderResult` shape `renderSong`
 * returns - `trimRender`, `levelRender`, `packSprite`, `renderOnset` and
 * `toWav` all just work on it.
 *
 * Kept in its own module on purpose, not in `render.ts`: `evaluate.mjs`,
 * `scores/mixing/calibrate.mjs`, `scores/instruments/generate.mjs` and
 * `scores/render-parity/inputs.mjs` each hash only what their own entry
 * point's bundle actually reaches (`scores/arrangements/engine.mjs`'s
 * `engineModules`), so a game-effects helper nothing in those entry points
 * imports never moves a golden render, a calibration or a fixture hash that
 * exists to catch drift in music.
 */

function chipFor(id: string): ChipDefinition {
  const chip =
    id === "2a03" ? nesChip
    : id === "dmg" ? gbChip
    : id === "md" ? mdChip
    : id === "snes" ? snesChip
    : id === "c64" ? c64Chip
    : getChip(id);
  if (!chip) throw new Error(`renderSfx: unknown chip: ${id}`);
  return chip;
}

/**
 * One effect: everything `Chip.sfx()` takes, plus the voice it plays on
 * (`Chip.sfx(channel, options)` takes the voice as a separate argument;
 * here it travels with the rest, since there is no live call to split it
 * from). `chip.spec.voices` and `chip.spec.roles` list valid channels.
 */
export interface SfxSpec {
  channel: Channel;
  /** Note name (`"A4"`, `"F#3"`) or, on a noise voice, a period index 0-15. */
  note: string | number;
  instrument: Instrument;
  /** Seconds the note holds before release. */
  duration: number;
  /** Seconds from the start of the render before the note begins. Default 0. */
  delay?: number;
  /** Scales the instrument's volume table, 0 to 1. */
  gain?: number;
  /** Semitones. */
  detune?: number;
  /**
   * Total seconds to render, tail included. Default `delay + duration + 0.5`.
   * Generous on purpose: `trimRender` cuts the silence a shorter envelope
   * leaves, while a decay table cut short before it reaches the floor is a
   * click, not a shorter sound. Raise it for a long release (a big
   * explosion, a SID filter sweep); lower it to render less silence.
   */
  seconds?: number;
}

/**
 * A `SfxSpec` with the chip attached, so the whole thing is one JSON value: a
 * catalogue's `Sound.recipe`, round-tripped through `renderSfx(recipe.chip,
 * recipe)` to render the exact same sound again, or with one field changed
 * for a variant.
 */
export interface SfxRecipe extends SfxSpec {
  /** Which chip: `"2a03"`, `"dmg"`, `"md"`, `"snes"` or `"c64"`. */
  chip: string;
  /** For the few chips with more than one model: the C64's `"6581"` (the default) or `"8580"`. */
  model?: string;
}

export interface RenderSfxOptions {
  sampleRate?: number;
  /** The chip's master gain, 0 to 1. Default 0.78, as `renderSong`. */
  gain?: number;
  /** Render both channels. A chip whose output is mono duplicates. */
  stereo?: boolean;
}

/**
 * Renders one effect on a fresh chip: `Chip.sfx()`'s offline half.
 *
 * ```ts
 * const boom = renderSfx("2a03", {
 *   channel: "noi", note: 8, duration: 0.3,
 *   instrument: { volume: [15, 14, 12, 10, 8, 6, 4, 2, 1, 0], noiseMode: true },
 * });
 * writeFileSync("boom.wav", toWav(trimRender(boom)));
 * ```
 *
 * The second argument accepts a bare `SfxSpec` (this call's own channel and
 * note) or a whole `SfxRecipe` (which also carries its own `chip`/`model` -
 * `renderSfx(recipe.chip, recipe)` renders one back from a catalogue). The
 * first argument always wins: a recipe made for one chip renders on another
 * by changing only the first argument, not the recipe.
 */
export function renderSfx(chip: string, spec: SfxSpec, options: RenderSfxOptions = {}): RenderResult {
  const sampleRate = options.sampleRate ?? 44100;
  if (!Number.isFinite(spec.duration) || spec.duration <= 0) throw new Error("renderSfx: duration must be positive");
  const definition = chipFor(chip);
  if (!definition.spec.voices.some((voice) => voice.id === spec.channel)) {
    throw new Error(`renderSfx: ${chip} has no voice "${spec.channel}" (has ${definition.spec.voices.map((v) => v.id).join(", ")})`);
  }
  const model = (spec as SfxRecipe).model;
  const core = definition.create(sampleRate, model === undefined ? undefined : { model });
  core.setGain(options.gain ?? 0.78);

  const driver = new OfflineDriver(core, definition, () => 0);
  const delay = spec.delay ?? 0;
  const seconds = spec.seconds ?? delay + spec.duration + 0.5;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("renderSfx: seconds must be positive");
  const total = Math.max(1, Math.round(seconds * sampleRate));

  driver.playEffect(spec.channel, {
    note: spec.note,
    instrument: spec.instrument,
    duration: spec.duration,
    at: delay,
    gain: spec.gain,
    detune: spec.detune,
  });

  const left = new Float32Array(total);
  const right = options.stereo ? new Float32Array(total) : null;
  const BLOCK = 4096;
  for (let offset = 0; offset < total; offset += BLOCK) {
    const size = Math.min(BLOCK, total - offset);
    core.render(left.subarray(offset, offset + size), right ? right.subarray(offset, offset + size) : null, offset);
  }

  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), right ? Math.abs(right[i]) : 0);

  return { sampleRate, left, right, seconds: total / sampleRate, peak };
}
