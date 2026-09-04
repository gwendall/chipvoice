import type { FmOperator, FmPatch } from "../../chip.js";
import type { Instrument } from "../../driver.js";
import type { Instruments, Intent } from "../../score.js";
import { DEFAULT_KIT, softKit } from "../../sequencer.js";

/**
 * The Mega Drive's arranger: an intent to an instrument, in the machine's
 * idiom. The lead and the bass are FM patches, four operators each, and the
 * word picks the patch: a bright lead is one modulator driving three
 * carriers hard, a round one is four carriers added like an organ. The
 * chord goes to the PSG, a square wave arpeggiated at frame rate, which is
 * what Mega Drive music did with its three thin tones. The kit is the
 * NES's, on the PSG's noise clocked by tone 3.
 *
 * The patches are written by hand, in the chip's units, and nothing verifies
 * them but ears; they are the arranger's, not the chip's.
 */
const op = (mul: number, tl: number, ar: number, dr: number, sr: number, sl: number, rr: number, dt = 0, ks = 0): FmOperator => ({
  dt,
  mul,
  tl,
  ks,
  ar,
  dr,
  sr,
  sl,
  rr,
});

const LEAD_SOFT: FmPatch = {
  algorithm: 4,
  feedback: 3,
  ops: [op(1, 38, 31, 10, 0, 2, 8), op(1, 0, 31, 12, 3, 3, 8), op(2, 44, 31, 10, 0, 3, 8), op(1, 0, 31, 12, 3, 3, 8)],
};

const LEAD_BRIGHT: FmPatch = {
  algorithm: 5,
  feedback: 6,
  ops: [op(2, 26, 31, 8, 0, 1, 8), op(1, 0, 31, 12, 4, 3, 8), op(2, 6, 31, 12, 4, 3, 8), op(3, 10, 31, 12, 4, 3, 8, 3)],
};

const LEAD_ROUND: FmPatch = {
  algorithm: 7,
  feedback: 0,
  ops: [op(1, 0, 31, 8, 2, 2, 8), op(2, 18, 31, 8, 2, 2, 8), op(3, 32, 31, 8, 2, 2, 8), op(4, 40, 31, 8, 2, 2, 8)],
};

const BASS_ROUND: FmPatch = {
  algorithm: 4,
  feedback: 2,
  ops: [op(1, 32, 31, 12, 2, 3, 10), op(1, 0, 31, 8, 2, 2, 10), op(1, 48, 31, 14, 2, 4, 10), op(1, 0, 31, 8, 2, 2, 10)],
};

const BASS_HOLLOW: FmPatch = {
  algorithm: 7,
  feedback: 0,
  ops: [op(1, 0, 31, 6, 1, 1, 10), op(2, 12, 31, 8, 2, 2, 10), op(3, 30, 31, 10, 2, 3, 10), op(5, 44, 31, 12, 2, 4, 10)],
};

const BASS_BRIGHT: FmPatch = {
  algorithm: 2,
  feedback: 7,
  ops: [op(1, 22, 31, 8, 0, 1, 10), op(3, 30, 31, 14, 2, 3, 10), op(1, 20, 31, 14, 2, 3, 10), op(1, 0, 31, 8, 2, 2, 10)],
};

const LEAD_VOLUME = [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8];
const LEAD_VIBRATO = { depth: 0.18, rate: 8, delay: 12 };

const LEADS: Record<Required<Intent>["lead"], Instrument> = {
  soft: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, fm: LEAD_SOFT },
  bright: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, fm: LEAD_BRIGHT },
  round: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, fm: LEAD_ROUND },
};

/** The chord on the PSG: its attenuator is the whole instrument. */
const CHORDS: Record<Required<Intent>["chord"], Instrument> = {
  plucked: { volume: [11, 9, 7, 6, 5], sustain: true },
  held: { volume: [9, 9, 8, 8, 8, 7, 7, 7], sustain: true },
};

const BASSES: Record<Required<Intent>["bass"], Instrument> = {
  round: { volume: [15], sustain: true, fm: BASS_ROUND },
  hollow: { volume: [15], sustain: true, fm: BASS_HOLLOW },
  bright: { volume: [15], sustain: true, fm: BASS_BRIGHT },
};

export function mdInstruments(intent: Required<Intent>): Instruments {
  return {
    lead: LEADS[intent.lead],
    chord: CHORDS[intent.chord],
    bass: BASSES[intent.bass],
    perc: intent.perc === "soft" ? softKit(0.66) : DEFAULT_KIT,
  };
}
