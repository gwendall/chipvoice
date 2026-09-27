import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * Mesen 2's NES APU, built natively and driven over a pipe.
 *
 * The APU proper is vendored unchanged under `oracles/mesen/vendor`; the
 * console, CPU, memory manager, sound mixer and serializer it needs are
 * minimal shims of our own under `oracles/mesen/shim`. See the README there
 * for what is Mesen's, what is ours, the pinned commit, and the voice-value
 * mapping. It is built with the system C++ compiler the first time it is
 * needed, or whenever a source is newer than the binary.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/mesen/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'mesen');
const SOURCES = ['main.cpp', 'vendor/NES/APU/NesApu.cpp', 'vendor/NES/APU/DeltaModulationChannel.cpp', 'shim/NES/NesCpu.cpp'];
const HEADERS = [
  'vendor/NES/INesMemoryHandler.h',
  'vendor/NES/NesConstants.h',
  'vendor/NES/APU/ApuEnvelope.h',
  'vendor/NES/APU/ApuFrameCounter.h',
  'vendor/NES/APU/ApuLengthCounter.h',
  'vendor/NES/APU/ApuTimer.h',
  'vendor/NES/APU/NesApu.h',
  'vendor/NES/APU/NoiseChannel.h',
  'vendor/NES/APU/SquareChannel.h',
  'vendor/NES/APU/TriangleChannel.h',
  'vendor/NES/APU/DeltaModulationChannel.h',
  'shim/pch.h',
  'shim/NES/NesConsole.h',
  'shim/NES/NesCpu.h',
  'shim/NES/NesMemoryManager.h',
  'shim/NES/NesSoundMixer.h',
  'shim/NES/NesTypes.h',
  'shim/Shared/SettingTypes.h',
  'shim/Shared/Emulator.h',
  'shim/Utilities/ISerializable.h',
  'shim/Utilities/Serializer.h',
];

export const mesen = {
  id: 'mesen',
  name: 'Mesen 2 (b9fa69d, 2026-06-04)',
  voices: ['p1', 'p2', 'tri', 'noi', 'dmc'],
  /**
   * The voices it is the oracle for. All five: unlike Nes_Snd_Emu, Mesen's
   * noise shift register starts at the same value, runs with the same
   * polarity and is clocked exactly, so its bit pattern is checked too. See
   * the README's "Known limits of this oracle" for the one place it still
   * cannot settle a question by itself (the triangle's very first output,
   * before any write).
   */
  trusted: ['p1', 'p2', 'tri', 'noi', 'dmc'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-Ishim', '-Ivendor', '-o', BINARY, ...SOURCES], {
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
   * @param {{ address: number, bytes: Uint8Array }[]} [memory] for the DMC
   */
  trace(writes, cycles, memory = []) {
    this.build();
    const input = formatLog({ chip: '2a03', clock: 1789773, cycles, memory }, writes);
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
