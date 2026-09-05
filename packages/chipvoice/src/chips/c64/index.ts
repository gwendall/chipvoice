import { registerChip, type ChipDefinition, type ChipSpec } from "../../chip.js";
import { C64_PROCESSOR_NAME, CLOCK_HZ, SidCore } from "./dsp.js";
import { SidDriver } from "./driver.js";
import { Sid } from "./sid.js";
import { WORKLET_SOURCE } from "./worklet-inline.js";

/**
 * The Commodore 64's SID, the 6581: the fifth chip, and the first with fewer
 * voices than the score has lines. Three voices, each of which can be any
 * of four waveforms, with an envelope of its own and a filter they share.
 * Written from the documents; the harness checks it against reSID-fp.
 */
export const C64: ChipSpec = {
  id: "c64",
  name: "MOS 6581 SID",
  system: "Commodore 64",
  instruments: "table",
  nativeSampleRate: null,
  clockHz: CLOCK_HZ,
  voices: [
    { id: "v1", label: "Voice 1", kind: "pulse", notes: "pitch" },
    { id: "v2", label: "Voice 2", kind: "pulse", notes: "pitch" },
    { id: "v3", label: "Voice 3", kind: "pulse", notes: "pitch" },
  ],
  // Three voices for four lines: the lead and the bass have one each, and
  // the chord and the kit share the third, where a drum cuts the chord as
  // it did in every C64 tune with drums. The sequencer knows the rule.
  roles: { lead: "v1", chord: "v3", bass: "v2", perc: "v3" },
};

export const c64Chip: ChipDefinition = {
  spec: C64,
  create: (sampleRate: number) => new SidCore(sampleRate),
  digital: () => new Sid(),
  driver: () => new SidDriver(),
  workletSource: WORKLET_SOURCE,
  processorName: C64_PROCESSOR_NAME,
};

registerChip(c64Chip);
