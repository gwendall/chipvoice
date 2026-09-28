import { registerChip, type ChipDefinition, type ChipDriver } from "../../chip.js";
import { NesDriver } from "./driver.js";
import { NES_SUNSOFT5B, Sunsoft5bNesCore, Sunsoft5bNesDigital, SUNSOFT5B_PROCESSOR_NAME } from "./sunsoft5b-core.js";
import { WORKLET_SOURCE as SUNSOFT5B_WORKLET_SOURCE } from "./sunsoft5b-worklet-inline.js";

/**
 * Assembles `nesSunsoft5bChip` and registers it.
 *
 * Split from `sunsoft5b-core.ts` for the same reason `vrc6-index.ts` is
 * split from `vrc6-core.ts`: this file imports the generated
 * `sunsoft5b-worklet-inline.ts`, and `sunsoft5b-worklet.ts` (the source that
 * generates it) imports `Sunsoft5bNesCore` from `sunsoft5b-core.ts`. Keeping
 * the `ChipDefinition` here, one hop away, is what keeps the worklet's own
 * bundle from embedding each previous build's output inside the next one.
 */

/** The chip's own driver, reused unmodified: it dispatches by voice id
 * (`p1`, `p2`, `tri`, `noi`) and already returns no writes for an id it
 * does not know, so it is safe for the three 5B voice ids too - they are
 * simply not driven by note frames yet, per decision 38. */
function sunsoft5bNesDriver(): ChipDriver {
  return new NesDriver();
}

export const nesSunsoft5bChip: ChipDefinition = {
  spec: NES_SUNSOFT5B,
  create: (sampleRate: number) => new Sunsoft5bNesCore(sampleRate),
  digital: () => new Sunsoft5bNesDigital(),
  driver: sunsoft5bNesDriver,
  workletSource: SUNSOFT5B_WORKLET_SOURCE,
  processorName: SUNSOFT5B_PROCESSOR_NAME,
};

registerChip(nesSunsoft5bChip);
