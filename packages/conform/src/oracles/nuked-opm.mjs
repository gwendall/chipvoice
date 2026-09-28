import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { traceProcess } from '../change-stream.mjs';

/**
 * Nuked-OPM, built natively and driven over a pipe: the die-derived core the
 * chip's YM2151 is ported from. Parity with it on its two voices - the L and
 * R DAC pins, the only outputs this chip has - is parity with the silicon,
 * to the internal cycle. See `oracles/nuked-opm/README.md`. `trace()`
 * streams its stdout through `traceProcess` (change-stream.mjs) into a
 * `ChangeStream` rather than buffering the whole run as one string.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/nuked-opm/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'nuked-opm');
const SOURCES = ['main.cpp', 'opm.c'];
const HEADERS = ['opm.h'];

export const nukedOpm = {
  id: 'nuked-opm',
  name: 'Nuked-OPM 1.0 (Nuke.YKT)',
  voices: ['l', 'r'],
  /** Both: the only two outputs this chip has. */
  trusted: ['l', 'r'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const c = spawnSync('cc', ['-O2', '-w', '-c', 'opm.c', '-o', 'build/opm.o'], { cwd: DIR, encoding: 'utf8' });
    if (c.status !== 0) throw new Error(`building the oracle failed:\n${c.stderr}`);
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-o', BINARY, 'main.cpp', 'build/opm.o'], { cwd: DIR, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`building the oracle failed:\n${result.stderr}`);
  },

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {Promise<import('../change-stream.mjs').ChangeStream>}
   */
  trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'ym2151', clock: 3579545, cycles }, writes);
    return traceProcess(BINARY, [], input);
  },
};
