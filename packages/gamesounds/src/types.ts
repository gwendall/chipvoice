/**
 * The catalogue's data model, as `docs/GAMESOUNDS.md` specifies it: a sound
 * answers a game event, carries its licence as data, and comes as 1 to 8
 * variants of the same idea. This file is types only - no runtime code, no
 * dependency on how a catalogue is built or served - so both the CLI/runtime
 * here and the site's server code import the same shapes.
 */

/** One leaf or branch of the taxonomy: a game event, at most two levels deep. */
export interface Category {
  /** Stable id, slash-separated: `"movement/jump"`, `"ui"`. */
  id: string;
  title: string;
  /** Other words that mean the same event, for search. */
  aliases: string[];
  /** The parent category's id, or `null` at the top level. */
  parent: string | null;
}

/** One of the ten style facets a sound is filed under. */
export type Style =
  | "8bit"
  | "16bit"
  | "arcade"
  | "cartoon"
  | "realistic"
  | "scifi"
  | "fantasy"
  | "horror"
  | "cozy"
  | "minimal-ui";

export const STYLES: readonly Style[] = [
  "8bit", "16bit", "arcade", "cartoon", "realistic", "scifi", "fantasy", "horror", "cozy", "minimal-ui",
];

/**
 * Where a sound came from. `"chipvoice"` is rendered by chipvoice's own
 * `renderSfx` (real chip emulation). `"generated"` is rendered by
 * `packages/sfx-engine`, gamesounds' own deterministic procedural synthesis
 * engine (a recipe plus a seed - GS-02, decision 52; wired into the
 * catalogue by GS-03, decision 54). Both are entirely our own DSP: no
 * third-party sounds and no external generation API, ever - see
 * docs/DECISIONS.md.
 */
export type Origin = "chipvoice" | "generated";

/** SPDX id. The launch catalogue is `"CC0-1.0"` only; the type stays open for later. */
export type License = "CC0-1.0" | string;

/**
 * One shipped file of a variant: named by its OWN bytes' SHA-256, not
 * borrowed from a sibling format - an ogg, an mp3 and a wav encoded from the
 * same source render each compress to different bytes, so each gets its own
 * hash, its own byte count and its own `/f/<sha256>.<ext>` URL. This is what
 * lets a CLI or a build check verify exactly the bytes it actually has for a
 * given format, instead of only ever being able to verify the WAV.
 */
export interface AudioFile {
  sha256: string;
  bytes: number;
  /** Content-addressed, immutable path: `/f/<sha256>.<ext>`. */
  url: string;
}

/** One take of a sound: its files, content hash and precomputed waveform. */
export interface Variant {
  /** 1-based position among the sound's variants. */
  n: number;
  /**
   * SHA-256 of the canonical PCM/WAV render this variant was encoded from -
   * the variant's own identity, shared by every format encoded from it
   * (equal to `files.wav.sha256`, since the wav IS that canonical render).
   * Kept as its own field because it is what "the same take, re-encoded"
   * means, independent of which formats happen to exist.
   */
  sha256: string;
  duration: number;
  files: { ogg: AudioFile; mp3: AudioFile; wav: AudioFile };
  /** Loudness and level, as measured on this variant's own shipped wav. */
  measure: Measure;
  /** 96 points, 0 to 1, for an instant waveform before any audio loads. */
  peaks: number[];
  /**
   * How to render THIS variant again: each generated variant carries its own
   * recipe (same shape as `Sound.recipe`, but with this variant's own seed -
   * that is the whole difference between one variant and the next). Present
   * on every `origin: "generated"` variant; chipvoice-origin variants leave
   * this unset and rely on `Sound.recipe` instead (chipvoice's own seed
   * ladder is not itself part of the recipe shape - see
   * apps/sounds/catalog/chipvoice-recipes.mjs).
   */
  recipe?: unknown;
}

/** Loudness and level, as measured on the built file, not a target. */
export interface Measure {
  lufs: number;
  peakDb: number;
  duration: number;
}

/** Votes and usage feed ranking in phase 2; phase 1 always writes zeros. */
export interface Rank {
  score: number;
  votes: number;
  auditions: number;
  kept: number;
  replaced: number;
}

export interface SoundSource {
  name: string;
  url: string;
  author: string;
  pack?: string;
}

/** One sound: an event, its variants, and everything an agent needs to use it without asking a person. */
export interface Sound {
  /** Stable slug, e.g. `"jump-8bit-soft-hop"`. */
  id: string;
  /** A category id: `"movement/jump"`. */
  category: string;
  style: Style;
  tags: string[];
  title: string;
  description: string;
  license: License;
  /** Required attribution text, or `null` when the licence needs none (every CC0-1.0 sound). */
  attribution: string | null;
  source: SoundSource;
  origin: Origin;
  /**
   * How to render this sound again: a chipvoice `{ chip, channel, note,
   * instrument, duration, ... }` recipe for `origin: "chipvoice"`; an
   * sfx-engine `{ engine: "sfx-engine@1", model, params, seed, sampleRate }`
   * recipe (its first variant's own seed) for `origin: "generated"` (GS-03,
   * decision 54). Left untyped here so this package never depends on
   * chipvoice or sfx-engine; the catalogue build imports each engine's own
   * recipe type to write it. Every generated variant also carries its OWN
   * recipe on `Variant.recipe`, with that variant's own seed - this field is
   * the sound's first take, not a substitute for a variant's own.
   */
  recipe?: unknown;
  loop: { start: number; end: number } | null;
  /** 1 to 8 takes of the same idea; every variant carries its own `measure`
   * too (checked individually - see docs/GAMESOUNDS.md's loudness section). */
  variants: Variant[];
  /** The first variant's measure, kept at sound level for a quick summary
   * (list views, sorting) without reaching into `variants[0]` - the binding
   * check is per variant, not this field. */
  measure: Measure;
  rank: Rank;
}

/** One event's entry in a written `sounds.json`: what the runtime needs to play it, nothing more. */
export interface ManifestEvent {
  /** The sound id this event currently resolves to. */
  sound: string;
  /** Primary files (relative to the manifest's `base`), one per variant, in order. */
  files: string[];
  /** A fallback format for a browser that cannot decode the primary one, same order. */
  fallback?: string[];
  /** 0 to 1. Default 1. */
  volume?: number;
  /** Random playback-rate offset per play, as a fraction of 1.0. Default 0. */
  pitchJitter?: number;
  /** The minimum time between two triggers of this event. Default 0. */
  cooldownMs?: number;
  /** How many voices this event may hold at once. Default 4. */
  maxVoices?: number;
  /** Higher steals a voice from lower when a cap is hit. Default 1. */
  priority?: number;
  /** Which bus this event's voices play through. Default `"sfx"`. */
  bus?: string;
  /** Present when the event's sound loops; where the seamless loop point is, in seconds. */
  loop?: { start: number; end: number };
}

export interface ManifestCredit {
  sound: string;
  license: License;
  author: string;
  source: string;
  attribution?: string | null;
}

/** `sounds.json`: written by the CLI, read by `loadSounds`. */
export interface Manifest {
  $schema: "https://gamesounds.ai/schema/manifest-1.json";
  version: 1;
  /** Where `files`/`fallback` paths are relative to. Default `"./"`. */
  base: string;
  events: Record<string, ManifestEvent>;
  credits: ManifestCredit[];
}

export const MANIFEST_SCHEMA_URL = "https://gamesounds.ai/schema/manifest-1.json";
export const MANIFEST_VERSION = 1;

/** The three formats the catalogue always encodes: browser-first, universal fallback, canonical source. */
export type AudioFormat = "ogg" | "mp3" | "wav";
export const AUDIO_FORMATS: readonly AudioFormat[] = ["ogg", "mp3", "wav"];
