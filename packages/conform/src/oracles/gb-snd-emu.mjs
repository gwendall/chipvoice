import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * Gb_Snd_Emu, blargg's Game Boy APU from 2005, built natively and driven
 * over a pipe: the same arrangement as the 2A03's oracle, with the same
 * recording sink in place of Blip_Buffer. See `oracles/gb-snd-emu/README.md`
 * for what is his, what is ours, and what it is trusted for.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/gb-snd-emu/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'gb-snd-emu');
const SOURCES = ['main.cpp', 'gb_apu/Gb_Apu.cpp', 'gb_apu/Gb_Oscs.cpp'];
const HEADERS = ['gb_apu/Gb_Apu.h', 'gb_apu/Gb_Oscs.h', 'gb_apu/Blip_Buffer.h', 'gb_apu/blargg_common.h', 'gb_apu/blargg_source.h'];

export const gbSndEmu = {
  id: 'gb-snd-emu',
  name: 'Gb_Snd_Emu 0.1.4 (blargg)',
  voices: ['ch1', 'ch2', 'ch3', 'ch4'],
  /**
   * The voices it is the oracle for. Its frame sequencer is not the
   * divider's: lengths and the sweep run half a step from the hardware's,
   * and its sweep applies a frequency one period late. Its envelopes, its
   * duty timing, its wave sequence and its noise register are sound, and
   * that is what it is compared on; the sheet says what diverges and why.
   */
  trusted: ['ch1', 'ch2', 'ch3', 'ch4'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-Igb_apu', '-o', BINARY, ...SOURCES], {
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
    const input = formatLog({ chip: 'dmg', clock: 4194304, cycles }, writes);
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
