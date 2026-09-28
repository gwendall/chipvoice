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
 * No known limits: this is the fully-trusted oracle for every generator,
 * including the noise LFSR. Ayumi's `update_noise` (`ayumi.c`) computes its
 * 17-bit LFSR as `(bit0 ^ bit3) -> bit16` (Fibonacci form), and `Ay8910`'s
 * own noise generator (`chips/ay8910.ts`'s `tick()`) now implements the same
 * construction - MAME's own `noise_rng_tick()` states it was "verified on
 * AY-3-8910 and YM2149 chips", the one source this project found that
 * claims a hardware check on this generator, and Ayumi's independent
 * implementation matches it exactly (`docs/DECISIONS.md`'s decision 48).
 * An earlier version of `Ay8910` instead read nesdev's "taps at bits 16 and
 * 13" as a Galois-form construction and disagreed with this oracle's noise
 * sequence entirely; that reading turned out to be wrong on review, not a
 * genuine disagreement between two otherwise-trusted references - see
 * `docs/chips/sunsoft5b.md`'s "where oracles disagree" for the full account.
 * The entire corpus, including every noise-bearing script, is gated exact
 * against this oracle now.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/ayumi/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'ayumi-oracle');
const SOURCES = ['main.cpp', 'ayumi.c'];
const HEADERS = ['ayumi.h'];

export const ayumi = {
  id: 'ayumi',
  name: 'Ayumi',
  voices: ['a', 'b', 'c'],
  /** Every voice, every generator; see the module doc comment above. */
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
