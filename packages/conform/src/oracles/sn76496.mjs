import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * MAME's sn76496, built natively and driven over a pipe, configured as
 * `segapsg_device` - the Sega VDP PSG the Mega Drive/Genesis actually
 * instantiates. See `oracles/sn76496/README.md` for the pinned commit, the
 * constructor parameters and their file:line citations, and the value
 * mapping. This is the PSG's second oracle, beside the documents nuked-opn2
 * is compared against for the FM half of this chip.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/sn76496/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'sn76496');
const SOURCES = ['main.cpp', 'sn76496.cpp'];
const HEADERS = ['emu.h', 'sn76496.h'];

export const sn76496 = {
  id: 'sn76496',
  name: 'MAME sn76496 (Sega VDP PSG), pinned at 76c7d197',
  voices: ['psg1', 'psg2', 'psg3', 'noise'],
  /** All four PSG voices: this oracle does not see the YM2612 at all. */
  trusted: ['psg1', 'psg2', 'psg3', 'noise'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-o', BINARY, 'main.cpp', 'sn76496.cpp'], { cwd: DIR, encoding: 'utf8' });
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
