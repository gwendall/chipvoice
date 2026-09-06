import type { Instrument } from "../../driver.js";
import type { Instruments, Intent } from "../../score.js";
import type { PercussionKit } from "../../sequencer.js";

/** Original BRR instrument families: transient attack, periodic sustain and
 * the sample's hardware ADSR. Portable intents choose a family, not a game. */
const LEAD_VOLUME = [15];
const LEAD_VIBRATO = { depth: 0.10, rate: 12, delay: 16 };

const LEADS: Record<Required<Intent>["lead"], Instrument> = {
  soft: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, sample: "flute" },
  bright: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, sample: "brass" },
  round: { volume: LEAD_VOLUME, sustain: true, vibrato: LEAD_VIBRATO, sample: "mallet" },
};

const CHORDS: Record<Required<Intent>["chord"], Instrument> = {
  plucked: { volume: [10], sustain: true, sample: "harp" },
  held: { volume: [9], sustain: true, sample: "strings" },
};

const BASSES: Record<Required<Intent>["bass"], Instrument> = {
  round: { volume: [15], sustain: true, sample: "picked-bass" },
  hollow: { volume: [13], sustain: true, sample: "reed-bass" },
  bright: { volume: [13], sustain: true, sample: "synth-bass" },
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
