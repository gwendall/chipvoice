import { nesChip } from 'chipvoice';

/**
 * chipvoice's 2A03, as the harness drives it: the digital chip alone, fed the
 * log's writes on their cycles, its voices' changes collected.
 */
export const chip2a03 = {
  id: '2a03',
  clock: nesChip.spec.clockHz,
  /** In trace order. The DMC is a voice the chip does not have yet. */
  voices: ['p1', 'p2', 'tri', 'noi', 'dmc'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @param {{ address: number, bytes: Uint8Array }[]} [memory] for the DMC
   */
  trace(writes, cycles, memory = []) {
    const chip = nesChip.digital();
    for (const block of memory) chip.load(block.address, block.bytes);
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = [];
    chip.trace(cycles, (cycle, voice, value) => changes.push({ cycle, voice, value }));
    return changes;
  },
};
