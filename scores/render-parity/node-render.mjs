import { renderPerformance, nesChip, gbChip, mdChip, snesChip, c64Chip } from '../../packages/chipvoice/dist/index.js';
import { pcmSha256 } from './pcm.mjs';

export const CHIPS = { '2a03': nesChip, dmg: gbChip, md: mdChip, snes: snesChip, c64: c64Chip };

/** Node's own reference render for one fixed input: the same `renderPerformance`
 * call every browser environment makes, on the same plan. */
export function renderInputNode(input) {
  const chip = CHIPS[input.chip];
  if (!chip) throw new Error(`unknown chip: ${input.chip}`);
  const audio = renderPerformance(input.plan, chip);
  return { audio, sha256: pcmSha256(audio), peak: audio.peak };
}
