import { registerChip, type ChipDefinition, type ChipSpec } from "../../chip.js";
import { SNES_PROCESSOR_NAME, SPC_HZ, SnesChip, SnesCore } from "./dsp.js";
import { SnesDriver } from "./driver.js";
import { WORKLET_SOURCE } from "./worklet-inline.js";

/**
 * The SNES: the S-DSP and its 64 KB, the fourth chip and the first whose
 * every instrument is a sample. Eight voices; the digital output is a
 * stereo stream at 32000 Hz, and that stream is the pair of voices the
 * harness compares.
 */
export const SNES: ChipSpec = {
  id: "snes",
  name: "S-DSP",
  system: "Super Nintendo / Super Famicom",
  instruments: "sample",
  nativeSampleRate: 32000,
  clockHz: SPC_HZ,
  voices: [
    { id: "v0", label: "Voice 0", kind: "sample", notes: "pitch" },
    { id: "v1", label: "Voice 1", kind: "sample", notes: "pitch" },
    { id: "v2", label: "Voice 2", kind: "sample", notes: "pitch" },
    { id: "v3", label: "Voice 3", kind: "sample", notes: "period" },
    { id: "v4", label: "Voice 4", kind: "sample", notes: "pitch" },
    { id: "v5", label: "Voice 5", kind: "sample", notes: "pitch" },
    { id: "v6", label: "Voice 6", kind: "sample", notes: "pitch" },
    { id: "v7", label: "Voice 7", kind: "sample", notes: "pitch" },
  ],
  roles: { lead: "v0", chord: "v1", bass: "v2", perc: "v3" },
};

export const snesChip: ChipDefinition = {
  spec: SNES,
  create: (sampleRate: number) => new SnesCore(sampleRate),
  digital: () => new SnesChip(),
  driver: () => new SnesDriver(),
  workletSource: WORKLET_SOURCE,
  processorName: SNES_PROCESSOR_NAME,
};

registerChip(snesChip);
