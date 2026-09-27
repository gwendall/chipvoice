import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { traceProcess } from '../change-stream.mjs';

/**
 * Game_Music_Emu's `Nes_Vrc6_Apu`, built natively and driven over a pipe.
 *
 * The sources are vendored under `oracles/game-music-emu` with a recording
 * sink in place of Blip_Buffer; see the README there for what is theirs,
 * what is ours, and - unlike `nes-snd-emu`'s README, which is mostly a
 * licence and a build note - a longer "known limits" section, because this
 * oracle diverges from chipvoice's own VRC6 core in three ways that are
 * facts about Game_Music_Emu's own implementation, not bugs on either side:
 * it drops every write to $9003/$A003/$B003 (halt/16x/256x) rather than
 * modelling them, it never steps a pulse's duty phase while its period is 4
 * or less, and it freezes rather than zeroes the sawtooth's accumulator
 * while disabled. It is built with the system C++ compiler the first time
 * it is needed, or whenever a source is newer than the binary. `trace()`
 * streams its stdout through `traceProcess` (change-stream.mjs) into a
 * `ChangeStream` rather than buffering the whole run as one string.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/game-music-emu/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'game-music-emu');
const SOURCES = ['main.cpp', 'gme/Nes_Vrc6_Apu.cpp'];
const HEADERS = ['gme/Nes_Vrc6_Apu.h', 'gme/Blip_Buffer.h', 'gme/blargg_common.h', 'gme/blargg_source.h', 'gme/blargg_config.h'];

export const gameMusicEmu = {
  id: 'game-music-emu',
  name: 'Game_Music_Emu (Nes_Vrc6_Apu)',
  voices: ['vp1', 'vp2', 'vsaw'],
  /**
   * All three voices, because all three are worth measuring - but see the
   * sheet and the oracle's README for what each one's identical-cycle count
   * actually means here. The sawtooth is trusted closely (it matches the
   * worked example and every other log to the cycle, aside from a documented
   * one-cycle frame-phase convention `compare.mjs`'s own shift absorbs, and
   * the freeze-not-zero disable case the corpus keeps out of the compared
   * window). The two pulses are not: Game_Music_Emu resets its duty phase to
   * an arbitrary constant (1) that no register write ever touches, where
   * this core resumes from step 15 per nesdev's literal "resume from the
   * beginning" - a permanent, unavoidable absolute-phase mismatch from any
   * cold enable that no corpus design fixes, so their identical-cycle counts
   * here are expected to be low. They stay in `trusted` anyway, the same way
   * `nes-snd-emu`'s own triangle does (that oracle's own README): the
   * per-voice `identical` count is not the only thing the baseline gates on
   * - `edges`/`shift`/`runs` (`compare.mjs`) show duty width and period are
   * still right even when absolute phase is not, and CI still catches a
   * regression in those.
   */
  trusted: ['vp1', 'vp2', 'vsaw'],

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
  trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'vrc6', clock: 1789773, cycles }, writes);
    return traceProcess(BINARY, [], input);
  },
};
