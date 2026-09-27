import { c64Chip } from 'chipvoice';
import { ChangeStream } from '../change-stream.mjs';

/**
 * chipvoice's C64, as the harness drives it: the digital SID alone, fed the
 * log's writes on their cycles, its six streams collected: each voice's
 * twelve-bit waveform output and eight-bit envelope counter, read before
 * the DACs as the oracle reads them. The callback pushes straight into a
 * `ChangeStream` (change-stream.mjs): no per-change object, which matters
 * once a log's sawtooths run long enough to change on nearly every cycle.
 */
/** @param {{ model?: string }} [options] */
function chipFor(options) {
  return {
    id: options?.model === '8580' ? 'c64-8580' : 'c64',
    clock: c64Chip.spec.clockHz,
    voices: ['osc1', 'osc2', 'osc3', 'env1', 'env2', 'env3'],

    /**
     * @param {{ at: number, addr: number, value: number }[]} writes
     * @param {number} cycles
     * @returns {ChangeStream}
     */
    trace(writes, cycles) {
      const chip = c64Chip.digital(options);
      chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
      const changes = new ChangeStream();
      chip.trace(cycles, (cycle, voice, value) => changes.push(cycle, voice, value));
      return changes;
    },
  };
}

export const chipC64 = chipFor();
/** The same chip, built as an 8580: the second block on the C64's sheet. */
export const chipC64_8580 = chipFor({ model: '8580' });
