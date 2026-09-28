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

/** Voice index of the sawtooth in this oracle's (and chipvoice's) trace order. */
const SAW_VOICE = 2;
const SAW_PERIOD_LOW = 0xb001;
const SAW_PERIOD_HIGH = 0xb002;

/**
 * A sawtooth-only cycle correction, applied here rather than left to
 * `compare.mjs`'s per-run shift search (whose window is +-16 cycles, too
 * narrow for the periods below).
 *
 * `Nes_Vrc6_Apu`'s own `phase` (`gme/Nes_Vrc6_Apu.h`) starts at 1
 * (`reset()`) and `run_saw`'s loop (`gme/Nes_Vrc6_Apu.cpp`) decrements it
 * every firing, folding what nesdev's text and chipvoice's own `Vrc6Saw`
 * (`vrc6.ts`) model as two separate firings (a toggle, then - every other
 * toggle - an add) into one: each of `run_saw`'s iterations both steps the
 * phase AND unconditionally adds the rate, `period * 2` cycles apart. A
 * `phase` of 1 decrementing to 0 is what its code treats as the wrap
 * (`accumulator` reset then immediately re-added-to); chipvoice's `subPhase`
 * starts `true`, so its own first firing after an enable is the toggle-only
 * one, and the first one that actually adds anything is a whole firing (one
 * `period + 1` cycles) later. Net effect, confirmed by direct comparison
 * against this oracle's own raw (pre-correction) cycles on
 * `corpus/vrc6/core/saw-rates.log`: `Nes_Vrc6_Apu`'s phase runs exactly one
 * firing ahead of chipvoice's at all times, which - since a firing is
 * `period + 1` cycles - shows up as this oracle reporting every sawtooth
 * edge exactly `period + 1` cycles later than chipvoice does, where `period`
 * is the 12-bit value ($B001/$B002, unshifted by $9003 - see the oracle's
 * own "known limits" on that register) most recently written at or before
 * that edge's own (uncorrected) cycle. Measured directly:
 * `saw-rates.log` writes period 20, then (mid-run, no disable) 5, then 100,
 * and the raw gap between this oracle's cycle and chipvoice's own is exactly
 * 21, then 6, then 101 for the edges in each of those three spans - `period
 * + 1`, tracking the write, every time. `saw-worked-example.log` (nesdev's
 * own A=$08, period-0 worked example) is the special case `period = 0` makes
 * of this: offset `-1`, which is what an earlier pass at this ticket found
 * and, not yet having tested a script with a nonzero or changing period
 * against this specific oracle, mistook for a period-independent constant.
 *
 * `sawPeriodSteps()` below rebuilds the same step function of "period in
 * effect from this write's cycle onward" `Nes_Vrc6_Apu`'s own `regs[]`
 * holds, from the log's own writes; `trace()` looks up, for each raw
 * sawtooth entry, the period active at its own cycle and subtracts
 * `period + 1` from it. `Vrc6Apu`'s two pulses get no correction at all:
 * Game_Music_Emu resets their duty phase to its own arbitrary constant on
 * the very first enable (see the oracle's own README, "duty-phase
 * freeze/no-reset"), a different absolute phase, not a shifted copy of the
 * same one - and, separately, chipvoice's own down-counting duty generator
 * is structurally unshiftable against this oracle's up-counting one
 * regardless (see `generate-vrc6.mjs`'s own header comment on `core/`).
 */
function sawPeriodSteps(writes) {
  const steps = [];
  let lo = 0;
  let hi = 0;
  for (const w of writes) {
    if (w.addr === SAW_PERIOD_LOW) lo = w.value & 0xff;
    else if (w.addr === SAW_PERIOD_HIGH) hi = w.value & 0x0f;
    else continue;
    steps.push({ at: w.at, period: (hi << 8) | lo });
  }
  return steps;
}
function periodAt(steps, cycle) {
  let period = 0;
  for (const s of steps) {
    if (s.at > cycle) break;
    period = s.period;
  }
  return period;
}

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
  async trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'vrc6', clock: 1789773, cycles }, writes);
    const stream = await traceProcess(BINARY, [], input);
    // Apply the sawtooth-only, period-dependent correction (see
    // sawPeriodSteps's own comment above) in place, cycle by cycle: the two
    // pulses get no correction at all, and shifting a mutable ChangeStream in
    // place, rather than rebuilding it, keeps this the same one-pass cost
    // `traceProcess` already paid.
    const steps = sawPeriodSteps(writes);
    for (let i = 0; i < stream.length; i++) {
      if (stream.voice[i] !== SAW_VOICE) continue;
      const period = periodAt(steps, stream.cycle[i]);
      stream.cycle[i] -= period + 1;
    }
    return stream;
  },
};
