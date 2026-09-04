import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * Nuked-OPN2, built natively and driven over a pipe: the die-derived YM3438
 * core the chip's YM2612 is ported from, in YM2612 mode. Parity with it on
 * the six FM voices is parity with the silicon, to the internal cycle. The
 * PSG is not this oracle's; see `oracles/nuked-opn2/README.md`.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/nuked-opn2/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'nuked-opn2');
const SOURCES = ['main.cpp', 'ym3438.c'];
const HEADERS = ['ym3438.h'];

export const nukedOpn2 = {
  id: 'nuked-opn2',
  name: 'Nuked-OPN2 1.0.12 (Nuke.YKT)',
  voices: ['fm1', 'fm2', 'fm3', 'fm4', 'fm5', 'fm6', 'psg1', 'psg2', 'psg3', 'noise'],
  /** The six FM channels: the PSG is another chip, from the documents. */
  trusted: ['fm1', 'fm2', 'fm3', 'fm4', 'fm5', 'fm6'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const c = spawnSync('cc', ['-O2', '-w', '-c', 'ym3438.c', '-o', 'build/ym3438.o'], { cwd: DIR, encoding: 'utf8' });
    if (c.status !== 0) throw new Error(`building the oracle failed:\n${c.stderr}`);
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-o', BINARY, 'main.cpp', 'build/ym3438.o'], { cwd: DIR, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`building the oracle failed:\n${result.stderr}`);
  },

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   */
  trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'md', clock: 53693175, cycles }, writes);
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
