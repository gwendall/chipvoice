import { registerChip, type ChipDefinition, type ChipSpec } from "../../chip.js";
import { CLOCK_HZ, GB_PROCESSOR_NAME, GbApu, GbApuCore } from "./dsp.js";
import { WORKLET_SOURCE } from "./worklet-inline.js";

/**
 * The Game Boy's APU, as the DMG had it: the second chip, and the one the
 * abstraction was waiting for. Same shape as the 2A03 - four voices, tables
 * per frame - with one difference that matters: the third voice plays a
 * waveform out of RAM rather than a fixed shape, which is the first
 * instrument that is not a table of frame values.
 *
 * The chip is here in full and the harness verifies it; the driver does not
 * reach it yet. That is ticket P3-2, and it is the rewrite of the driver's
 * instrument model against two real chips that the roadmap asked for.
 */
export const GB_DMG: ChipSpec = {
  id: "dmg",
  name: "DMG APU",
  system: "Game Boy",
  instruments: "table",
  nativeSampleRate: null,
  clockHz: CLOCK_HZ,
  voices: [
    { id: "ch1", label: "Pulse 1", kind: "pulse", notes: "pitch" },
    { id: "ch2", label: "Pulse 2", kind: "pulse", notes: "pitch" },
    { id: "ch3", label: "Wave", kind: "wavetable", notes: "pitch" },
    // The noise takes a divisor and a shift rather than a note, 8 by 16 of
    // them, and the driver will map a period index onto them as it does the
    // 2A03's sixteen.
    { id: "ch4", label: "Noise", kind: "noise", notes: "period" },
  ],
};

export const gbChip: ChipDefinition = {
  spec: GB_DMG,
  create: (sampleRate: number) => new GbApuCore(sampleRate),
  digital: () => new GbApu(),
  workletSource: WORKLET_SOURCE,
  processorName: GB_PROCESSOR_NAME,
};

registerChip(gbChip);
