import { Ym2151 } from 'chipvoice';
import { ChangeStream } from '../change-stream.mjs';

/**
 * chipvoice's YM2151 (`Ym2151`, `packages/chipvoice/src/chips/ym2151.ts`),
 * fed the log's writes on their cycles - the chip's own input clock, `addr`
 * 0 the address port and 1 the data port, matching `Ym2151.write`'s own two
 * ports - and its two DAC pins' changes collected into a `ChangeStream`.
 *
 * There is no `DigitalChip`/`schedule()` wrapper here, unlike `Ay8910` or
 * `Vrc6Apu`: this chip has no driver or arranger role yet (see
 * `docs/DECISIONS.md`'s decision 38 and decision 51) - `Ym2151` is only the
 * bare core, and this file drives it the same way `oracles/nuked-opm/main.cpp`
 * drives the reference, one `clock()` call every two of the log's cycles
 * (this chip's internal state machine runs at half its input clock).
 */
export const chipYm2151 = {
  id: 'ym2151',
  clock: 3579545,
  /** In trace order: the left DAC pin, then the right. */
  voices: ['l', 'r'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {ChangeStream}
   */
  trace(writes, cycles) {
    const chip = new Ym2151();
    const sorted = [...writes].sort((a, b) => a.at - b.at);
    const changes = new ChangeStream();
    const last = [0, 0];
    let next = 0;
    const step = 2;
    for (let cycle = 0; cycle < cycles; cycle += step) {
      while (next < sorted.length && sorted[next].at <= cycle) {
        chip.write(sorted[next].addr & 1, sorted[next].value & 0xff);
        next++;
      }
      chip.clock();
      for (let v = 0; v < 2; v++) {
        const value = chip.dac_output[v];
        if (value !== last[v]) {
          last[v] = value;
          changes.push(cycle, v, value);
        }
      }
    }
    return changes;
  },
};
