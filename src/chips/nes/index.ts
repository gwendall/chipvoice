import { registerChip, type ChipDefinition, type ChipSpec } from "../../chip.js";
import { NesApuCore } from "./dsp.generated.js";
import { WORKLET_SOURCE } from "./worklet-inline.js";

/**
 * The Ricoh 2A03, as the NES and Famicom had it.
 *
 * Four voices and no more, which is the constraint the whole library is built
 * around: music and effects compete for them, and that competition is most of
 * what makes it sound like a console rather than like a synthesiser.
 */
export const NES_2A03: ChipSpec = {
  id: "2a03",
  name: "Ricoh 2A03",
  system: "NES / Famicom",
  instruments: "table",
  // The chip runs from the CPU clock and resamples to whatever the host uses,
  // so there is no rate it prefers.
  nativeSampleRate: null,
  voices: [
    { id: "p1", label: "Pulse 1", kind: "pulse", notes: "pitch" },
    { id: "p2", label: "Pulse 2", kind: "pulse", notes: "pitch" },
    { id: "tri", label: "Triangle", kind: "triangle", notes: "pitch" },
    // Sixteen periods rather than pitches: the noise channel has no notion of
    // a note, and handing it "A4" is a mistake a validator should catch.
    { id: "noi", label: "Noise", kind: "noise", notes: "period" },
  ],
};

export const nesChip: ChipDefinition = {
  spec: NES_2A03,
  create: (sampleRate: number) => new NesApuCore(sampleRate),
  workletSource: WORKLET_SOURCE,
  processorName: "apu-processor",
};

registerChip(nesChip);
