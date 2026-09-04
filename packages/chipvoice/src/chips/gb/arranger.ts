import type { Instrument } from "../../driver.js";
import type { Instruments, Intent } from "../../score.js";
import { DEFAULT_KIT, softKit } from "../../sequencer.js";

/**
 * The Game Boy's arranger: an intent to an instrument, in the DMG's idiom.
 *
 * The pulses take the same tables as the 2A03's, duty for duty: the two chips
 * have the same four duties, and the driver already turns a volume table into
 * retriggers. The bass is where the Game Boy differs: the wave channel plays
 * whatever is in its RAM, so an intent is a waveform here where on a NES it
 * could only be the triangle. The kit is the NES's; the driver fits each
 * drum's decay to the hardware envelope.
 */
const LEAD_VOLUME = [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8];
const LEAD_VIBRATO = { depth: 0.18, rate: 8, delay: 12 };

const LEADS: Record<Required<Intent>["lead"], Instrument> = {
  soft: { duty: 1, volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO },
  bright: { duty: 0, volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO },
  round: { duty: 2, volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO },
};

const CHORDS: Record<Required<Intent>["chord"], Instrument> = {
  plucked: { duty: 0, volume: [9, 8, 7, 7, 6], sustain: true },
  held: { duty: 2, volume: [8, 8, 7, 7, 7, 6, 6, 6], sustain: true },
};

/** Thirty-two samples, 0 to 15. */
export const WAVEFORMS = {
  triangle: Array.from({ length: 32 }, (_, i) => (i < 16 ? i : 31 - i)),
  square: Array.from({ length: 32 }, (_, i) => (i < 16 ? 15 : 0)),
  saw: Array.from({ length: 32 }, (_, i) => i >> 1),
};

const BASSES: Record<Required<Intent>["bass"], Instrument> = {
  round: { volume: [15], sustain: true, wave: WAVEFORMS.triangle },
  // A square at full level is twice as loud as a triangle; half level sits
  // where the triangle did.
  hollow: { volume: [8], sustain: true, wave: WAVEFORMS.square },
  bright: { volume: [12], sustain: true, wave: WAVEFORMS.saw },
};

export function gbInstruments(intent: Required<Intent>): Instruments {
  return {
    lead: LEADS[intent.lead],
    chord: CHORDS[intent.chord],
    bass: BASSES[intent.bass],
    perc: intent.perc === "soft" ? softKit(0.66) : DEFAULT_KIT,
  };
}
