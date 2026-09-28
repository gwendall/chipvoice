import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { traceProcess } from '../change-stream.mjs';

/**
 * Ayumi (Peter Sovietov, MIT), built natively and driven over a pipe.
 *
 * `oracles/ayumi/main.cpp`'s own module doc comment has the full driver
 * design (the two clock layers, why it reads Ayumi's public struct fields
 * instead of calling its private generator functions, why `is_ym=1`
 * doesn't matter here). It reports chipvoice's own raw 0-31 digital index,
 * the same units as `chipAy8910` (`src/chips/ay8910.mjs`) - unlike
 * Game_Music_Emu's `Ay_Apu`, nothing here goes through a DAC curve first.
 *
 * Known limits:
 *
 * - **The noise generator's LFSR does not match this oracle's own tone,
 *   mixer or envelope generators' level of trust.** Ayumi's `update_noise`
 *   (`ayumi.c`) computes its 17-bit LFSR as `(bit0 ^ bit3) -> bit16`
 *   (Fibonacci form). Nesdev's Sunsoft 5B audio page states the real
 *   generator as "a 17-bit linear feedback shift register with taps at
 *   bits 16 and 13", and taken literally that is a Galois-form
 *   construction (XOR the feedback into both tapped bits directly), which
 *   `Ay8910`'s own noise generator (`chips/ay8910.ts`) now implements,
 *   corroborated by Game_Music_Emu's `Ay_Apu` using the identical formula
 *   independently. An exhaustive search found no relabelling of Ayumi's
 *   Fibonacci form that reproduces the Galois form's sequence, so this is
 *   a genuine disagreement between two independent, otherwise-trusted
 *   references, not a bug in either one's engineering - see
 *   `docs/chips/sunsoft5b.md`'s "where oracles disagree". Noise-bearing
 *   corpus is run against this oracle with `--report`, never gated exact;
 *   everything else (tone, mixer/gate, fixed volume, envelope) is gated
 *   exact, since none of those depend on the noise generator.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/ayumi/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'ayumi-oracle');
const SOURCES = ['main.cpp', 'ayumi.c'];
const HEADERS = ['ayumi.h'];

export const ayumi = {
  id: 'ayumi',
  name: 'Ayumi',
  voices: ['a', 'b', 'c'],
  /** Everything but noise-bearing logs; see the module doc comment above. */
  trusted: ['a', 'b', 'c'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-o', BINARY, ...SOURCES, '-lm'], {
      cwd: DIR,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`building the oracle failed:\n${result.stderr}`);
    }
  },

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {Promise<import('../change-stream.mjs').ChangeStream>}
   */
  async trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'ay8910', clock: 1789773, cycles }, writes);
    return traceProcess(BINARY, [], input);
  },
};
