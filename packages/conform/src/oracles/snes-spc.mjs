import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * snes_spc's S-DSP, blargg's "highly accurate" one, built natively and driven
 * over a pipe: the core the chip's S-DSP is ported from, written against the
 * hardware's own output. Parity with it on the output stream is parity with
 * the DSP, sample for sample. See `oracles/snes-spc/README.md`.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/snes-spc/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'snes-spc');
const SOURCES = ['main.cpp'];
const HEADERS = ['snes_spc/SPC_DSP.cpp', 'snes_spc/SPC_DSP.h', 'snes_spc/blargg_common.h', 'snes_spc/blargg_config.h', 'snes_spc/blargg_endian.h', 'snes_spc/blargg_source.h'];

export const snesSpc = {
  id: 'snes-spc',
  name: 'snes_spc 0.9.0 (blargg)',
  voices: ['left', 'right'],
  trusted: ['left', 'right'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-o', BINARY, ...SOURCES], { cwd: DIR, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`building the oracle failed:\n${result.stderr}`);
  },

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @param {{ address: number, bytes: Uint8Array }[]} [memory] the samples
   */
  trace(writes, cycles, memory = []) {
    this.build();
    const input = formatLog({ chip: 'snes', clock: 1024000, cycles, memory }, writes);
    const result = spawnSync(BINARY, [], { input, encoding: 'utf8', maxBuffer: 1 << 30 });
    if (result.status !== 0) throw new Error(`the oracle failed: ${result.stderr}`);
    const changes = [];
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      const [cycle, voice, value] = line.split(' ').map(Number);
      changes.push({ cycle, voice, value });
    }
    return changes;
  },
};
