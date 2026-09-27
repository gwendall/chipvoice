import { Vrc6Apu, NES_VRC6 } from 'chipvoice';
import { ChangeStream } from '../change-stream.mjs';

/**
 * chipvoice's VRC6, as the harness drives it: the digital chip alone
 * (`Vrc6Apu`, `packages/chipvoice/src/chips/nes/vrc6.ts`), fed the log's
 * writes on their cycles, its three voices' changes collected straight into
 * a `ChangeStream` (change-stream.mjs) rather than one object per change.
 *
 * This is the standalone chip, not the combined `2a03-vrc6` cartridge chip
 * (`vrc6-core.ts`): the harness compares one expansion audio chip's own
 * register-in, value-out behaviour against Game_Music_Emu's own isolated
 * `Nes_Vrc6_Apu`, the same split the 2A03/VRC6 mixing stage makes in
 * `vrc6-core.ts` for the same reason - mixing is not this chip's job.
 */
export const chipVrc6 = {
  id: 'vrc6',
  clock: NES_VRC6.clockHz,
  /** In trace order: the two pulses, then the sawtooth. */
  voices: ['vp1', 'vp2', 'vsaw'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {ChangeStream}
   */
  trace(writes, cycles) {
    const chip = new Vrc6Apu();
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = new ChangeStream();
    chip.trace(cycles, (cycle, voice, value) => changes.push(cycle, voice, value));
    return changes;
  },
};
