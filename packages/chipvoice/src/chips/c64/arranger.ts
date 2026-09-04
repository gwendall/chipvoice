import type { Instrument } from "../../driver.js";
import type { Instruments, Intent } from "../../score.js";
import type { PercussionKit } from "../../sequencer.js";

/**
 * The C64's arranger: an intent to an instrument, in the SID's idiom.
 *
 * The pulses take the same tables as the 2A03's, duty for duty: the SID's
 * pulse width is continuous and the driver picks the four the score knows.
 * The bass is where the SID is generous: a triangle, a pulse or a sawtooth
 * at the instrument's say-so, on the same voice. The kit is the SID's own -
 * a triangle falling through an octave for the kick, a pulse click into
 * noise for the snare, noise for the hats - because the noise is pitched
 * here, and a drum on a C64 was a pitch that moved. Every drum is shorter
 * than a step at any tempo the score allows, since its note off lands where
 * its duration says and the next drum shares the voice.
 */
const LEAD_VOLUME = [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8];
const LEAD_VIBRATO = { depth: 0.18, rate: 8, delay: 12 };

const LEADS: Record<Required<Intent>["lead"], Instrument> = {
  soft: { waveform: "pulse", duty: 1, volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO },
  bright: { waveform: "pulse", duty: 0, volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO },
  round: { waveform: "pulse", duty: 2, volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO },
};

const CHORDS: Record<Required<Intent>["chord"], Instrument> = {
  plucked: { waveform: "pulse", duty: 0, volume: [9, 8, 7, 7, 6], sustain: true },
  held: { waveform: "pulse", duty: 2, volume: [8, 8, 7, 7, 7, 6, 6, 6], sustain: true },
};

const BASSES: Record<Required<Intent>["bass"], Instrument> = {
  round: { waveform: "triangle", volume: [13], sustain: true },
  hollow: { waveform: "pulse", duty: 2, volume: [9], sustain: true },
  bright: { waveform: "sawtooth", volume: [11], sustain: true },
};

const scaled = (volume: number[], scale: number) => volume.map((v) => Math.round(v * scale));

/** The kit, at a scale: the tight kit at 1, the soft one at two thirds. */
export function c64Kit(scale: number): PercussionKit {
  return {
    K: { note: "A2", duration: 0.08, instrument: { waveform: "triangle", volume: scaled([15, 15, 13, 10, 6], scale), slide: -3.5 } },
    S: { note: "G6", duration: 0.08, instrument: { waveform: ["pulse", "noise"], duty: 2, volume: scaled([15, 12, 9, 6, 3], scale) } },
    H: { note: "B7", duration: 0.05, instrument: { waveform: "noise", volume: scaled([11, 6, 2], scale) } },
    O: { note: "B7", duration: 0.08, instrument: { waveform: "noise", volume: scaled([11, 10, 8, 7, 5], scale) } },
  };
}

export function c64Instruments(intent: Required<Intent>): Instruments {
  return {
    lead: LEADS[intent.lead],
    chord: CHORDS[intent.chord],
    bass: BASSES[intent.bass],
    perc: c64Kit(intent.perc === "soft" ? 0.66 : 1),
  };
}
