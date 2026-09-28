import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { traceProcess } from '../change-stream.mjs';

/**
 * Mesen 2's VRC6 audio, built natively and driven over a pipe - the second
 * oracle NEXT-14's round-2 review asked for, independent of Game_Music_Emu.
 *
 * `Core/NES/Mappers/Audio/{Vrc6Audio,Vrc6Pulse,Vrc6Saw}.h` (not
 * `Core/NES/Mappers/Konami/`: that directory holds the mapper/banking class,
 * `VRC6.h`, which only `#include`s these from `Audio/` - the audio classes
 * themselves, unchanged, are what is vendored) plus `Core/NES/APU/
 * BaseExpansionAudio.{h,cpp}`, the abstract base every expansion-audio chip
 * shares, are vendored unchanged under `oracles/mesen/vendor/NES/{APU,
 * Mappers/Audio}` at the exact commit already pinned for the plain 2A03
 * oracle, `b9fa69ddc6d0a331fb103fdb5eef6904305703c2` - see `oracles/mesen/
 * README.md`. They compile against the SAME shim (`oracles/mesen/shim`)
 * the 2A03 oracle already has: `NesTypes.h`'s `AudioChannel` enum already
 * listed `VRC6 = 7`, and `NesApu::AddExpansionAudioDelta` already forwarded
 * to the mixer, both written for a future ticket that turned out to be this
 * one. `NesSoundMixer.h`'s `deltas[]` array is grown from 5 to 8 voices to
 * hold index 7 (see its own comment); nothing vendored was touched to make
 * that or anything else here work, per "shim only what they call into."
 *
 * `main-vrc6.cpp` is ours: it reads a chipvoice register log the same way
 * `main.cpp` does, drives `Vrc6Audio` one CPU cycle at a time via its own
 * `Clock()` (not through `NesApu::ProcessCpuClock()`, which is irrelevant to
 * VRC6 - see its own header comment), and prints every change of the mixer's
 * one VRC6 "voice" as `<cycle> 0 <value>`. There is only one voice because
 * real Mesen's own `Vrc6Audio::ClockAudio` sums the two pulses and the
 * sawtooth into one number before ever handing the mixer a delta - it does
 * not expose them separately, so this oracle cannot be compared voice by
 * voice the way Game_Music_Emu's oracle is. `chips/vrc6.mjs`'s
 * `chipVrc6Combined` is the chip-side match: chipvoice's own three voices,
 * summed and scaled by 15 the same way, so both sides of the comparison are
 * the same single quantity.
 *
 * Mesen is the independent check of exactly what Game_Music_Emu's own
 * `Nes_Vrc6_Apu` cannot check, read from `Vrc6Pulse.h`/`Vrc6Saw.h`
 * themselves: `Vrc6Pulse::Clock` has no period-4-or-under guard (unlike
 * `run_square`'s `period > 4`), `Vrc6Saw::WriteReg`'s disable path explicitly
 * zeroes the accumulator (matching nesdev and chipvoice; Game_Music_Emu's
 * `run_saw` freezes it instead), and both classes are driven from a register
 * log the same way `$9003` reaches chipvoice directly (Game_Music_Emu's own
 * `main.cpp` dispatch drops it before it ever reaches `Nes_Vrc6_Apu`, since
 * `reg_count == 3`; nothing here drops it).
 *
 * It is built with the system C++ compiler the first time it is needed, or
 * whenever a source is newer than the binary. `trace()` streams its stdout
 * through `traceProcess` (change-stream.mjs) into a `ChangeStream`.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/mesen/main-vrc6.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'mesen-vrc6');
const SOURCES = [
  'main-vrc6.cpp',
  'vendor/NES/APU/NesApu.cpp',
  'vendor/NES/APU/DeltaModulationChannel.cpp',
  'vendor/NES/APU/BaseExpansionAudio.cpp',
  'shim/NES/NesCpu.cpp',
];
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
  'vendor/NES/APU/BaseExpansionAudio.h',
  'vendor/NES/Mappers/Audio/Vrc6Audio.h',
  'vendor/NES/Mappers/Audio/Vrc6Pulse.h',
  'vendor/NES/Mappers/Audio/Vrc6Saw.h',
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

export const mesenVrc6 = {
  id: 'mesen-vrc6',
  name: 'Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio',
  /** One voice: real Mesen's own mixer never separates the three. */
  voices: ['sum'],
  trusted: ['sum'],

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
   * @returns {Promise<import('../change-stream.mjs').ChangeStream>}
   */
  async trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'vrc6', clock: 1789773, cycles }, writes);
    const stream = await traceProcess(BINARY, [], input);
    for (let i = 0; i < stream.length; i++) stream.cycle[i] += CYCLE_OFFSET;
    return stream;
  },
};

/**
 * The same one-cycle labelling offset `oracles/game-music-emu.mjs` applies to
 * its own sawtooth voice (see that constant's own comment: measured on
 * `corpus/vrc6/core/saw-worked-example.log`, 8999/8999 edges at shift -1) -
 * both oracles share the same "catch the emulated CPU up to the write's
 * cycle using the OLD register state, then apply the write" convention (this
 * oracle's own `main-vrc6.cpp` implements it deliberately, to match real
 * Mesen calling `Vrc6Audio::WriteRegister` mid-frame after `ProcessCpuClock`
 * has already run).
 *
 * Unlike Game_Music_Emu's, this offset is a flat, register-independent -1
 * here, applied to every entry unconditionally: an earlier pass at this
 * ticket scoped it to sawtooth-only logs (`isSawOnly()`, since this oracle
 * reports only one summed "sum" voice - see the module comment - so a
 * pulse-driven change was assumed to need its own, unverified shift).
 * `corpus/vrc6/core/pulse-levels.log` (both pulses, mode on, no sawtooth
 * activity at all) settled it: 30/30 edges align at the same shift -1, not
 * some other value or none - so the convention is the driver's own
 * catch-up-then-write timing, which applies identically to every register
 * this oracle's `main-vrc6.cpp` writes, not a sawtooth-specific quirk. Every
 * core and edge script in the corpus (`check:vrc6-core-mesen`,
 * `check:vrc6-edge-mesen`) is 100.0000% under this unconditional shift,
 * including `edge/pulse-enable.log`, which an earlier, narrower version of
 * this function deliberately excluded.
 */
const CYCLE_OFFSET = -1;
