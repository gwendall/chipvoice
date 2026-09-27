import type { FmOperator, FmPatch } from "../../chip.js";
import type { Instrument } from "../../driver.js";
import type { Instruments, Intent } from "../../score.js";
import type { PercussionKit } from "../../sequencer.js";
import { DEFAULT_KIT, softKit } from "../../sequencer.js";

/**
 * The Mega Drive's arranger: an intent to an instrument, in the machine's
 * idiom. The lead and the bass are FM patches, four operators each, and the
 * word picks the patch: a bright lead is one modulator driving three
 * carriers hard, a round one is four carriers added like an organ. The
 * chord goes to the PSG, a square wave arpeggiated at frame rate, which is
 * what Mega Drive music did with its three thin tones.
 *
 * The kit defaults to the NES's, on the PSG's noise clocked by tone 3: it
 * reads the same on every chip that has one, and it is quiet enough to sit
 * under a piece that should not celebrate (`perc: "soft"`). `perc: "punchy"`
 * plays the same four letters as FM patches on channel 6 instead - the
 * chip's own drums, not a sample and not a generic substitute - for a piece
 * that wants the FM chip to carry its own rhythm section too. It is not the
 * default because the noise kit already covers most of what a kit needs to
 * do here (a steady pulse under a lead) at no cost to the other five roles,
 * and because it is what every other chip's kit already sounds like, which
 * keeps a score portable in fact as well as in name.
 *
 * The patches are written by hand, in the chip's units, and nothing verifies
 * them but ears; they are the arranger's, not the chip's.
 */
const op = (mul: number, tl: number, ar: number, dr: number, sr: number, sl: number, rr: number, dt = 0, ks = 0, am = false): FmOperator => ({
  dt,
  mul,
  tl,
  ks,
  ar,
  dr,
  sr,
  sl,
  rr,
  am,
});

const LEAD_SOFT: FmPatch = {
  algorithm: 4,
  feedback: 3,
  ops: [op(1, 38, 31, 10, 0, 2, 8), op(1, 0, 31, 12, 3, 3, 8), op(2, 44, 31, 10, 0, 3, 8), op(1, 0, 31, 12, 3, 3, 8)],
};

// Its pitch LFO stands in for the shared software vibrato below (`pms: 3`,
// the chip's own rate 4, about 9.2 Hz): a hardware wobble on the one lead
// that has no delay to hide a discontinuity, so the values a patch has
// carried since before the LFO was wired up finally do something.
const LEAD_BRIGHT: FmPatch = {
  algorithm: 5,
  feedback: 6,
  ops: [op(2, 26, 31, 8, 0, 1, 8), op(1, 0, 31, 12, 4, 3, 8), op(2, 6, 31, 12, 4, 3, 8), op(3, 10, 31, 12, 4, 3, 8, 3)],
  pms: 3,
  lfoFrequency: 4,
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

// ── FM drums for channel 6 (`perc: "punchy"`), the manual's own techniques:
// a fast pitch envelope from frequency writes (the kick) and a noise-like
// timbre from a hard-fed-back, detuned chain (the snare and the hats) -
// nothing sampled, nothing borrowed from the noise kit's shape.

// The kick: one carrier, the manual's pitch-envelope trick done with the
// driver's own `slide` (see FM_KIT.K below), not a second oscillator.
const DRUM_KICK: FmPatch = {
  algorithm: 7,
  feedback: 0,
  ops: [op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15), op(1, 0, 31, 3, 0, 0, 8)],
};

// The snare: a fully serial chain (algorithm 0), each link detuned further
// than the last, so the feedback that would otherwise buzz on one pitch
// turns inharmonic - the chip's own noise, not the PSG's.
const DRUM_SNARE: FmPatch = {
  algorithm: 0,
  feedback: 7,
  ops: [op(1, 22, 31, 10, 4, 4, 10), op(1, 26, 31, 10, 4, 4, 10, 3), op(1, 24, 31, 10, 4, 4, 10, 5), op(1, 0, 31, 8, 3, 3, 9, 7)],
};

// The closed hat: the same trick at a higher, shorter pitch, with the
// carrier's `am` on and the patch's own LFO for a shimmer instead of a
// steady buzz - what the arranger's `punchy` word promises.
const DRUM_HAT: FmPatch = {
  algorithm: 0,
  feedback: 7,
  ops: [op(1, 28, 31, 12, 6, 4, 13), op(1, 30, 31, 12, 6, 4, 13, 3), op(1, 32, 31, 12, 6, 4, 13, 5), op(1, 0, 31, 10, 6, 2, 13, 3, 0, true)],
  ams: 3,
  lfoFrequency: 6,
};

// The open hat: the same chain, released slower and held longer (FM_KIT.O's duration).
const DRUM_HAT_OPEN: FmPatch = {
  algorithm: 0,
  feedback: 7,
  ops: [op(1, 28, 31, 12, 6, 4, 13), op(1, 30, 31, 12, 6, 4, 13, 3), op(1, 32, 31, 12, 6, 4, 13, 5), op(1, 0, 31, 6, 4, 6, 7, 3, 0, true)],
  ams: 3,
  lfoFrequency: 6,
};

/**
 * The FM kit: the same four letters as `DEFAULT_KIT`, on channel 6 instead
 * of the noise. `note` is still a period index 0 to 15 - the noise kit's own
 * unit - but here it is the FM drum's own pitch map (see `MdDriver`'s
 * redirect on the noise voice), not a noise rate; the kick's `slide` walks
 * it down fast, the manual's pitch-envelope trick.
 */
const FM_KIT: PercussionKit = {
  K: { note: 15, instrument: { volume: [14, 12, 9, 6, 3, 1], slide: -6, fm: DRUM_KICK }, duration: 0.11 },
  S: { note: 9, instrument: { volume: [13, 11, 8, 5, 3, 1], fm: DRUM_SNARE }, duration: 0.11 },
  H: { note: 13, instrument: { volume: [8, 5, 3, 1], fm: DRUM_HAT }, duration: 0.06 },
  O: { note: 13, instrument: { volume: [9, 8, 7, 6, 5, 4, 3, 2, 1], fm: DRUM_HAT_OPEN }, duration: 0.16 },
};

const LEAD_VOLUME = [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8];
const LEAD_VIBRATO = { depth: 0.18, rate: 8, delay: 12 };

const LEADS: Record<Required<Intent>["lead"], Instrument> = {
  soft: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, fm: LEAD_SOFT },
  // The chip's own LFO carries bright's wobble now (see LEAD_BRIGHT); adding
  // the software vibrato on top would double it.
  bright: { volume: LEAD_VOLUME, sustain: true, fm: LEAD_BRIGHT },
  round: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, fm: LEAD_ROUND },
  // The YM2612 has no filter to sweep; its brightest existing patch stands
  // in, honestly: no simulated substitute.
  sweep: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, fm: LEAD_BRIGHT },
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
  // No filter here either; the hollow patch's own narrowed timbre is the
  // nearest thing this chip has to a resonant low end, reused honestly.
  resonant: { volume: [15], sustain: true, fm: BASS_HOLLOW },
};

export function mdInstruments(intent: Required<Intent>): Instruments {
  return {
    lead: LEADS[intent.lead],
    chord: CHORDS[intent.chord],
    bass: BASSES[intent.bass],
    perc: intent.perc === "punchy" ? FM_KIT : intent.perc === "soft" ? softKit(0.66) : DEFAULT_KIT,
  };
}
