import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { traceProcess } from '../change-stream.mjs';

/**
 * Game_Music_Emu's `Ay_Apu`, built natively and driven over a pipe.
 *
 * The sources are vendored under `oracles/game-music-emu` alongside
 * `Nes_Vrc6_Apu` (same repository, same pinned revision - see the README);
 * `main-ay.cpp` is the one new file, register-index addressed (`Ay_Apu`'s
 * own `write(time, addr, data)` takes the chip's 0-15 register index
 * directly, unlike `Nes_Vrc6_Apu`'s CPU-address decode). `trace()` streams
 * its stdout through `traceProcess` into a `ChangeStream`.
 *
 * `Ay_Apu` reports its own internal `amp_table` byte, not chipvoice's raw
 * 0-31 index (see `main-ay.cpp`'s own comment for why: the index is private
 * state with no public accessor). `chipAy8910Gme` (`src/chips/ay8910.mjs`)
 * is this oracle's chip-side counterpart: it passes chipvoice's own volume
 * register through the identical table (copied verbatim from
 * `Ay_Apu.cpp`'s own comment) before comparing, so the two sides speak the
 * same units. That table only covers a fixed (non-envelope) volume; see
 * this oracle's own "known limits" below for what that means for envelope
 * corpus.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/game-music-emu/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'game-music-emu-ay');
const SOURCES = ['main-ay.cpp', 'gme/Ay_Apu.cpp'];
const HEADERS = ['gme/Ay_Apu.h', 'gme/Blip_Buffer.h', 'gme/blargg_common.h', 'gme/blargg_source.h', 'gme/blargg_config.h'];

export const gameMusicEmuAy = {
  id: 'game-music-emu-ay',
  name: 'Game_Music_Emu (Ay_Apu)',
  voices: ['a', 'b', 'c'],
  /**
   * All three channels, on fixed (non-envelope) volume corpus only.
   *
   * Known limits, read directly from `gme/Ay_Apu.cpp`:
   *
   * - **The envelope generator is the classic AY-3-8910's own coarser one,
   *   not the YM2149's finer one the 5B actually has.** `env.wave` is built
   *   from a 16-step up/down ramp (`Ay_Apu`'s constructor), each step held
   *   for `env_period_factor` = `period_factor * 2` = 32 raw clocks - double
   *   nesdev's documented `16 * Period` per YM2149 step
   *   (`docs/chips/sunsoft5b.md`'s "Envelope" section). Same total ramp
   *   frequency for a given period register (16 steps of 32 clocks is the
   *   same duration as 32 steps of 16 clocks - `512 * Period` either way),
   *   different resolution and different intermediate values - not a bug in
   *   either implementation, the documented AY-3-8910/YM2149 envelope
   *   difference itself. Ayumi (`oracles/ayumi`) has no such gap: its own
   *   envelope is the YM2149's 32-step one regardless of `is_ym`, since
   *   `is_ym` only ever selects a DAC table there. Envelope-active corpus is
   *   run against this oracle with `--report`, never gated exact.
   * - **The reported value is a DAC-curved byte, not chipvoice's raw
   *   digital index.** See this oracle's own module doc comment above.
   */
  trusted: ['a', 'b', 'c'],

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
   * @returns {Promise<import('../change-stream.mjs').ChangeStream>}
   */
  async trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'ay8910', clock: 1789773, cycles }, writes);
    return traceProcess(BINARY, [], input);
  },
};
