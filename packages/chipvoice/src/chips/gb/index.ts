import { registerChip, type ChipDefinition, type ChipSpec } from "../../chip.js";
import { CLOCK_HZ, GB_PROCESSOR_NAME, GbApu, GbApuCore } from "./dsp.js";
import { GbDriver } from "./driver.js";
import { WORKLET_SOURCE } from "./worklet-inline.js";

/**
 * The Game Boy's APU, as the DMG had it: the second chip, and the one the
 * abstraction was waiting for. Same shape as the 2A03 - four voices, tables
 * per frame - with one difference that matters: the third voice plays a
 * waveform out of RAM rather than a fixed shape, which is the first
 * instrument that is not a table of frame values.
 *
 * The chip is here in full and the harness verifies it; `GbDriver` is how a
 * song reaches it, with the bass on the wave channel.
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
  // The bass on the wave channel, where Game Boy music put it: it reaches
  // an octave below the pulses and its waveform is the song's to choose.
  roles: { lead: "ch1", chord: "ch2", bass: "ch3", perc: "ch4" },
};

export const gbChip: ChipDefinition = {
  spec: GB_DMG,
  create: (sampleRate: number) => new GbApuCore(sampleRate),
  digital: () => new GbApu(),
  driver: () => new GbDriver(),
  workletSource: WORKLET_SOURCE,
  processorName: GB_PROCESSOR_NAME,
};

registerChip(gbChip);
