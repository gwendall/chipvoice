import type { Instrument } from "../../driver.js";
import type { Instruments, Intent } from "../../score.js";
import { DEFAULT_KIT, softKit } from "../../sequencer.js";

/**
 * The 2A03's arranger: an intent to an instrument, in the NES's idiom.
 *
 * A lead is a pulse whose duty is its timbre, and its decay and vibrato are
 * the ones every song has had since the first: those are the defaults, kept
 * to the number, so nothing published changes. A chord is one pulse
 * arpeggiated at frame rate. The bass is the triangle whatever is asked of
 * it: the triangle has one waveform and no volume, and that is the NES.
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

const BASS: Instrument = { volume: [15], sustain: true };

export function nesInstruments(intent: Required<Intent>): Instruments {
  return {
    lead: LEADS[intent.lead],
    chord: CHORDS[intent.chord],
    bass: BASS,
    perc: intent.perc === "soft" ? softKit(0.66) : DEFAULT_KIT,
  };
}
