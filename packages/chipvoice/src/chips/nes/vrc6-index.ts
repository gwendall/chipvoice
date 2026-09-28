import { registerChip, type ChipDefinition, type ChipDriver } from "../../chip.js";
import { NesDriver } from "./driver.js";
import { NES_VRC6, Vrc6NesCore, Vrc6NesDigital, VRC6_PROCESSOR_NAME } from "./vrc6-core.js";
import { WORKLET_SOURCE as VRC6_WORKLET_SOURCE } from "./vrc6-worklet-inline.js";

/**
 * Assembles `nesVrc6Chip` and registers it.
 *
 * Split from `vrc6-core.ts` for one reason: this file imports the generated
 * `vrc6-worklet-inline.ts`, and `vrc6-worklet.ts` (the source that generates
 * it) imports `Vrc6NesCore` from `vrc6-core.ts`. If the assembly lived in
 * `vrc6-core.ts`, the worklet's own bundle would pull in its own previous
 * output as a string literal, growing without bound across rebuilds - which
 * is exactly what happened before this file existed. Keeping the
 * `ChipDefinition` here, one hop away from `vrc6-core.ts`, is what breaks
 * that cycle. `nes/index.ts` has the same two-file shape for the same
 * reason, one level removed.
 */

/** The chip's own driver, reused unmodified: it dispatches by voice id
 * (`p1`, `p2`, `tri`, `noi`) and already returns no writes for an id it
 * does not know, so it is safe for the three VRC6 voice ids too - they are
 * simply not driven by note frames yet, per decision 38. */
function vrc6NesDriver(): ChipDriver {
  return new NesDriver();
}

export const nesVrc6Chip: ChipDefinition = {
  spec: NES_VRC6,
  create: (sampleRate: number) => new Vrc6NesCore(sampleRate),
  digital: () => new Vrc6NesDigital(),
  driver: vrc6NesDriver,
  workletSource: VRC6_WORKLET_SOURCE,
  processorName: VRC6_PROCESSOR_NAME,
};

registerChip(nesVrc6Chip);
