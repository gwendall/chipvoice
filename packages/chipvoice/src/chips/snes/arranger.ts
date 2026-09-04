import type { Instrument } from "../../driver.js";
import type { Instruments, Intent } from "../../score.js";
import type { PercussionKit } from "../../sequencer.js";

/**
 * The SNES's arranger: an intent to an instrument, in the machine's idiom,
 * which is that everything is a sample. The words pick waveforms from the
 * driver's bank - a triangle for a soft lead, a sawtooth for a bright one,
 * a sine for a round one - and the kit is four drums the driver synthesised.
 * The echo the driver turns on is the rest of the idiom.
 */
const LEAD_VOLUME = [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8];
const LEAD_VIBRATO = { depth: 0.18, rate: 8, delay: 12 };

const LEADS: Record<Required<Intent>["lead"], Instrument> = {
  soft: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, sample: "tri" },
  bright: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, sample: "saw" },
  round: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, sample: "sine" },
};

const CHORDS: Record<Required<Intent>["chord"], Instrument> = {
  plucked: { volume: [9, 8, 7, 7, 6], sustain: true, sample: "square" },
  held: { volume: [8, 8, 7, 7, 7, 6, 6, 6], sustain: true, sample: "tri" },
};

const BASSES: Record<Required<Intent>["bass"], Instrument> = {
  round: { volume: [15], sustain: true, sample: "sine64" },
  hollow: { volume: [13], sustain: true, sample: "square64" },
  bright: { volume: [13], sustain: true, sample: "saw64" },
};

const KIT: PercussionKit = {
  K: { note: 6, instrument: { volume: [15, 15, 14, 13, 12, 11, 10, 9, 8], sample: "kick" }, duration: 0.15 },
  S: { note: 9, instrument: { volume: [14, 13, 12, 10, 8, 6, 4], sample: "snare" }, duration: 0.12 },
  H: { note: 13, instrument: { volume: [10, 7, 4], sample: "hat" }, duration: 0.05 },
  O: { note: 12, instrument: { volume: [10, 9, 8, 7, 6, 5, 4, 3], sample: "ohat" }, duration: 0.14 },
};

function quieter(kit: PercussionKit, scale: number): PercussionKit {
  const q = (i: Instrument): Instrument => ({ ...i, volume: i.volume.map((v) => Math.max(0, Math.round(v * scale))) });
  return {
    K: { ...kit.K, instrument: q(kit.K.instrument) },
    S: { ...kit.S, instrument: q(kit.S.instrument) },
    H: { ...kit.H, instrument: q(kit.H.instrument) },
    O: { ...kit.O, instrument: q(kit.O.instrument) },
  };
}

export function snesInstruments(intent: Required<Intent>): Instruments {
  return {
    lead: LEADS[intent.lead],
    chord: CHORDS[intent.chord],
    bass: BASSES[intent.bass],
    perc: intent.perc === "soft" ? quieter(KIT, 0.66) : KIT,
  };
}
