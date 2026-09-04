import { mdChip } from 'chipvoice';

/**
 * chipvoice's Mega Drive, as the harness drives it: the digital pair alone,
 * fed the log's writes on their master cycles, its ten voices' changes
 * collected. The FM voices are the YM2612's nine-bit channel outputs, the
 * PSG's are its four-bit levels.
 */
export const chipMd = {
  id: 'md',
  clock: mdChip.spec.clockHz,
  voices: ['fm1', 'fm2', 'fm3', 'fm4', 'fm5', 'fm6', 'psg1', 'psg2', 'psg3', 'noise'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   */
  trace(writes, cycles) {
    const chip = mdChip.digital();
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = [];
    chip.trace(cycles, (cycle, voice, value) => changes.push({ cycle, voice, value }));
    return changes;
  },
};
