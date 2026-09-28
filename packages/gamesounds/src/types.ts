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

/** Where a sound came from: hand-picked, rendered by chipvoice, or (phase 2) generated. */
export type Origin = "curated" | "chipvoice" | "generated";

/** SPDX id. The launch catalogue is `"CC0-1.0"` only; the type stays open for later. */
export type License = "CC0-1.0" | string;

/** One take of a sound: its files, content hash and precomputed waveform. */
export interface Variant {
  /** 1-based position among the sound's variants. */
  n: number;
  /** SHA-256 of the canonical (WAV) source this variant was encoded from. */
  sha256: string;
  duration: number;
  /** Content-addressed, immutable paths: `/f/<sha256>.<ext>`. */
  files: { ogg: string; mp3: string; wav: string };
  /** 96 points, 0 to 1, for an instant waveform before any audio loads. */
  peaks: number[];
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
   * instrument, duration, ... }` recipe for `origin: "chipvoice"`, `undefined`
   * otherwise. Left untyped here so this package never depends on chipvoice;
   * the catalogue build imports chipvoice's own `SfxRecipe` type to write it.
   */
  recipe?: unknown;
  loop: { start: number; end: number } | null;
  /** 1 to 8 takes of the same idea. */
  variants: Variant[];
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
