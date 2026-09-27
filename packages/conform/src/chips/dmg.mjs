import { gbChip } from 'chipvoice';
import { ChangeStream } from '../change-stream.mjs';

/**
 * chipvoice's DMG APU, as the harness drives it: the digital chip alone, fed
 * the log's writes on their cycles, its voices' changes collected straight
 * into a `ChangeStream` (change-stream.mjs) rather than one object per
 * change. Each value is what the voice's DAC is given, 0 to 15, before the
 * master volume and the stereo routing, which the digital trace does not see.
 */
export const chipDmg = {
  id: 'dmg',
  clock: gbChip.spec.clockHz,
  voices: ['ch1', 'ch2', 'ch3', 'ch4'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {ChangeStream}
   */
  trace(writes, cycles) {
    const chip = gbChip.digital();
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = new ChangeStream();
    chip.trace(cycles, (cycle, voice, value) => changes.push(cycle, voice, value));
    return changes;
  },
};
