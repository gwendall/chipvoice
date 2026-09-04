import { c64Chip } from 'chipvoice';

/**
 * chipvoice's C64, as the harness drives it: the digital SID alone, fed the
 * log's writes on their cycles, its six streams collected: each voice's
 * twelve-bit waveform output and eight-bit envelope counter, read before
 * the DACs as the oracle reads them.
 */
export const chipC64 = {
  id: 'c64',
  clock: c64Chip.spec.clockHz,
  voices: ['osc1', 'osc2', 'osc3', 'env1', 'env2', 'env3'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   */
  trace(writes, cycles) {
    const chip = c64Chip.digital();
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = [];
    chip.trace(cycles, (cycle, voice, value) => changes.push({ cycle, voice, value }));
    return changes;
  },
};
