import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * Nes_Snd_Emu, blargg's reference, built natively and driven over a pipe.
 *
 * The sources are vendored under `oracles/nes-snd-emu` with a recording sink
 * in place of Blip_Buffer; see the README there for what is his, what is
 * ours, and what the oracle is trusted for. It is built with the system C++
 * compiler the first time it is needed, or whenever a source is newer than
 * the binary.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/nes-snd-emu/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'nes-snd-emu');
const SOURCES = ['main.cpp', 'nes_apu/Nes_Apu.cpp', 'nes_apu/Nes_Oscs.cpp'];
const HEADERS = ['nes_apu/Nes_Apu.h', 'nes_apu/Nes_Oscs.h', 'nes_apu/Blip_Buffer.h', 'nes_apu/blargg_common.h', 'nes_apu/blargg_source.h'];

export const nesSndEmu = {
  id: 'nes-snd-emu',
  name: 'Nes_Snd_Emu 0.1.7 (blargg)',
  voices: ['p1', 'p2', 'tri', 'noi', 'dmc'],
  /**
   * The voices it is the oracle for. The noise's register starts elsewhere,
   * runs with the opposite polarity and is not clocked exactly while muted,
   * so its bit pattern cannot match; the DMC is not built on our side.
   */
  trusted: ['p1', 'p2', 'tri'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-o', BINARY, ...SOURCES], {
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
   */
  trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: '2a03', clock: 1789773, cycles }, writes);
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
