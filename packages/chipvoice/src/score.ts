import type { Instrument } from "./driver.js";
import type { PercussionKit, Song } from "./sequencer.js";
import { nesInstruments } from "./chips/nes/arranger.js";
import { gbInstruments } from "./chips/gb/arranger.js";
import { mdInstruments } from "./chips/md/arranger.js";
import { snesInstruments } from "./chips/snes/arranger.js";
import { c64Instruments } from "./chips/c64/arranger.js";

/**
 * The score: what the music is, before any chip has done anything with it.
 *
 * Four lines of tokens in four roles, a tempo, an order, and for each role an
 * *intent*: a word for what it should sound like, which names no waveform.
 * "A bright lead" is a 12.5 percent pulse on a 2A03 and on a Game Boy; on a
 * YM2612 it will be a patch with a high modulator level, on a SNES a sample.
 * Each chip's arranger maps the word onto an instrument in its own idiom, and
 * the words are the same on every chip, which is what makes a score portable.
 *
 * `arrange` turns a score into a `Song` for one chip: the same lines, the
 * chip's instruments. A `Song` with its instruments spelled out still works,
 * for a host that wants a timbre of its own; the score is the wire format,
 * the thing an agent writes and the API stores.
 */

/** Every intent, per role, with what it means. The catalogue the docs are written from. */
export const INTENTS = {
  lead: {
    soft: "the default: a 25 % pulse with a slow decay and a late vibrato",
    bright: "a thin 12.5 % pulse that cuts through; the classic NES lead",
    round: "a 50 % pulse, fuller and hollower",
  },
  chord: {
    plucked: "the default: a short 12.5 % pluck on every step of the arpeggio",
    held: "a softer 50 % pulse that sustains under the lead",
  },
  bass: {
    round: "the default: the triangle on a NES, a triangle wave on a Game Boy or a C64",
    hollow: "a square wave on the Game Boy's wave channel or a SID voice; a NES has only the triangle",
    bright: "a sawtooth on the Game Boy's wave channel or a SID voice; a NES has only the triangle",
  },
  perc: {
    tight: "the default kit: a kick, a snare, a closed and an open hat",
    soft: "the same kit at two thirds, for a piece that should not celebrate",
  },
} as const;

export type LeadIntent = keyof typeof INTENTS.lead;
export type ChordIntent = keyof typeof INTENTS.chord;
export type BassIntent = keyof typeof INTENTS.bass;
export type PercIntent = keyof typeof INTENTS.perc;

export interface Intent {
  lead?: LeadIntent;
  chord?: ChordIntent;
  bass?: BassIntent;
  perc?: PercIntent;
}

/** What every role gets from an arranger: the chip's instruments. */
export interface Instruments {
  lead: Instrument;
  chord: Instrument;
  bass: Instrument;
  perc: PercussionKit;
}

/** The intent with every role filled in: what "no intent" means. */
export const DEFAULT_INTENT: Required<Intent> = { lead: "soft", chord: "plucked", bass: "round", perc: "tight" };

export interface Score {
  /** Stable name; `arrange` makes one from the content when absent. */
  id?: string;
  bpm: number;
  patterns: Song["patterns"];
  order: number[];
  /** 0 to 1. Default 1. */
  gain?: number;
  /** Which chip, when the score is stored for one: `"2a03"`, `"dmg"`, `"md"`, `"snes"` or `"c64"`. */
  chip?: string;
  intent?: Intent;
}

export function resolveIntent(intent: Intent | undefined): Required<Intent> {
  return { ...DEFAULT_INTENT, ...(intent ?? {}) };
}

/** A chip's instruments for an intent. Unknown chips get the 2A03's. */
export function instrumentsFor(chipId: string, intent: Intent | undefined): Instruments {
  const resolved = resolveIntent(intent);
  if (chipId === "dmg") return gbInstruments(resolved);
  if (chipId === "md") return mdInstruments(resolved);
  if (chipId === "snes") return snesInstruments(resolved);
  if (chipId === "c64") return c64Instruments(resolved);
  return nesInstruments(resolved);
}

/**
 * A score, arranged for a chip: the same four lines with that chip's
 * instruments. What the driver plays and the renderer renders.
 */
export function arrange(score: Score, chipId = score.chip ?? "2a03"): Song {
  const instruments = instrumentsFor(chipId, score.intent);
  return {
    id: score.id ?? `score:${chipId}:${fingerprint(score)}`,
    bpm: score.bpm,
    patterns: score.patterns,
    order: score.order,
    gain: score.gain ?? 1,
    lead: instruments.lead,
    chord: instruments.chord,
    bass: instruments.bass,
    perc: instruments.perc,
  };
}

/** A short hash of the content, so the same score arranged twice plays as one song. */
function fingerprint(score: Score): string {
  const text = JSON.stringify([score.bpm, score.order, score.patterns, score.intent ?? null]);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
