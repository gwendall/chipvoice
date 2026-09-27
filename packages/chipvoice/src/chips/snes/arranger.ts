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
  plucked: { volume: [15], sustain: true, sample: "harp" },
  held: { volume: [15], sustain: true, sample: "strings" },
};

const BASSES: Record<Required<Intent>["bass"], Instrument> = {
  round: { volume: [15], sustain: true, sample: "picked-bass" },
  hollow: { volume: [13], sustain: true, sample: "reed-bass" },
  bright: { volume: [13], sustain: true, sample: "synth-bass" },
};

// The kick and the snare keep their BRR transients: a real drum's attack
// reads better than the DSP's noise alone. The hats route to the DSP's own
// noise generator instead - `noiseMode`, the same word the NES, Game Boy,
// Mega Drive and C64 kits use for their own hardware noise - since a real
// SNES hi-hat is broadband hiss shaped by envelope, not a fixed sample; the
// `sample` name stays as the BRR fallback a caller gets by setting
// `noiseMode: false` explicitly. See the driver for the noise clock and the
// `NON` register this reaches.
const KIT: PercussionKit = {
  K: { note: 6, instrument: { volume: [15, 15, 14, 13, 12, 11, 10, 9, 8], sample: "kick" }, duration: 0.15 },
  S: { note: 9, instrument: { volume: [14, 13, 12, 10, 8, 6, 4], sample: "snare" }, duration: 0.12 },
  H: { note: 13, instrument: { volume: [10, 7, 4], sample: "hat", noiseMode: true }, duration: 0.05 },
  O: { note: 12, instrument: { volume: [10, 9, 8, 7, 6, 5, 4, 3], sample: "ohat", noiseMode: true }, duration: 0.14 },
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
