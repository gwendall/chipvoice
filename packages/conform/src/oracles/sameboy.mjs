import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { traceProcess } from '../change-stream.mjs';

/**
 * SameBoy's DMG-B APU (Lior Halphon's), built natively and driven over a
 * pipe, the same arrangement as the other oracles. Unlike Gb_Snd_Emu, its
 * `apu.samples[]` already is the DAC value chipvoice traces, 0 to 15, with
 * no folding. See `oracles/sameboy/README.md` for what is SameBoy's and what
 * is ours, the pinned commit, and the frame sequencer's phase. `trace()`
 * streams its stdout through `traceProcess` (change-stream.mjs) into a
 * `ChangeStream` rather than buffering the whole run as one string.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/sameboy/main.c', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'sameboy');
const SOURCES = ['main.c', 'shim.c', 'vendor/apu.c'];
const HEADERS = ['gb.h', 'vendor/apu.h', 'vendor/defs.h', 'vendor/model.h'];

export const sameboy = {
  id: 'sameboy',
  name: 'SameBoy (DMG-B)',
  voices: ['ch1', 'ch2', 'ch3', 'ch4'],
  /**
   * All four: it is a cycle-accurate DMG core with DACs, a power switch and
   * a divider-driven frame sequencer, the same model dsp.ts documents itself
   * against. Where it still disagrees with us is diagnosed voice by voice on
   * the sheet, not excluded here.
   */
  trusted: ['ch1', 'ch2', 'ch3', 'ch4'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    // `-std=gnu11`, not the stricter `-std=c11`: `vendor/apu.c` reaches for
    // `M_PI`, a POSIX/BSD extension to `<math.h>`, not ISO C. Apple's libc
    // exposes it either way, so this went unnoticed building locally; glibc
    // hides it under `-std=c11`'s `__STRICT_ANSI__` and fails the build on
    // Linux CI. GNU C11 is a superset of ISO C11, so this changes nothing
    // `apu.c` relies on beyond that one declaration.
    const result = spawnSync('cc', ['-O2', '-std=gnu11', '-w', '-I.', '-o', BINARY, ...SOURCES, '-lm'], {
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
  trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'dmg', clock: 4194304, cycles }, writes);
    return traceProcess(BINARY, [], input);
  },
};
