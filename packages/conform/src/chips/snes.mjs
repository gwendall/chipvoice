import { snesChip } from 'chipvoice';

/**
 * chipvoice's SNES, as the harness drives it: the S-DSP with the log's
 * samples in its RAM, fed the writes on their cycles, its output stream
 * collected as two voices, left and right.
 */
export const chipSnes = {
  id: 'snes',
  clock: snesChip.spec.clockHz,
  voices: ['left', 'right'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @param {{ address: number, bytes: Uint8Array }[]} [memory]
   */
  trace(writes, cycles, memory = []) {
    const chip = snesChip.digital();
    for (const block of memory) chip.load(block.address, block.bytes);
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = [];
    chip.trace(cycles, (cycle, voice, value) => changes.push({ cycle, voice, value }));
    return changes;
  },
};
