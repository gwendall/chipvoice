import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * The VRC6 corpus, generated.
 *
 * Scripts of hand-written writes, not songs through a driver: VRC6 has no
 * arranger/driver integration yet (NEXT-14's scope explicitly leaves the
 * studio picker and the arranger out - see `docs/BACKLOG.md`), so there is
 * no native voice-compiler to record from the way `generate-md.mjs` records
 * `compileMdVoices`'s own output. Every log here is $9000-$9002 (pulse 1),
 * $A000-$A002 (pulse 2) and $B000-$B002 (saw) writes only - never $9003: the
 * oracle drops that register entirely (see `oracles/game-music-emu/README.md`),
 * so a log that halts or 16x/256x-shifts the divider would only be
 * measuring the oracle's silence, not this core. $9003 is exercised instead
 * by `packages/chipvoice/test/vrc6.mjs`'s own unit tests, against nesdev's
 * text directly.
 *
 * Every distinct state (a duty, a period, a rate) is separated from its
 * neighbour by a disable held past `compare.mjs`'s `RUN_GAP` (4200 cycles):
 * that is what turns a script into a sequence of separately-shiftable
 * "runs" rather than one long one, which matters here specifically, because
 * `Nes_Vrc6_Apu`'s duty phase starts at an arbitrary constant nesdev's text
 * never mentions (see the oracle's README) - a per-run shift is the only way
 * to tell "the same waveform, just out of phase" from "a different
 * waveform" once that is true, and it is what `status-data.mjs`'s own
 * `parity()` reads for the board (`runs.alignedTimes / runs.ours`, not the
 * raw identical-cycle count, which an unrelated phase convention floors at
 * whatever it floors at regardless of correctness).
 *
 * A log is in CPU cycles, matching the NES's own 1789773 Hz - the same clock
 * `corpus/2a03` uses, since VRC6 rides the same cartridge bus.
 */
const CLOCK = 1789773;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus', 'vrc6');

/** Comfortably past `compare.mjs`'s `RUN_GAP` (4200), so a disable this long always starts a fresh run. */
const GAP = 6000;

const PREROLL = 0.01;
const second = (s) => Math.round((PREROLL + s) * CLOCK);

/** A register writer with a cursor. */
function writer() {
  const writes = [];
  let t = second(0);
  return {
    writes,
    at(time) { t = time; },
    write(addr, value) { writes.push([t, addr, value & 0xff]); },
    advance(cycles) { t += cycles; },
  };
}

const P1 = { control: 0x9000, lo: 0x9001, hi: 0x9002 };
const P2 = { control: 0xa000, lo: 0xa001, hi: 0xa002 };
const SAW = { rate: 0xb000, lo: 0xb001, hi: 0xb002 };

/** volume 0-15, duty 0-7, mode false unless given. */
function pulseControl(volume, duty, mode = false) {
  return (mode ? 0x80 : 0) | ((duty & 7) << 4) | (volume & 15);
}
function periodWrites(w, regs, period, enabled) {
  w.write(regs.lo, period & 0xff);
  w.write(regs.hi, ((period >> 8) & 0x0f) | (enabled ? 0x80 : 0));
}

const SCRIPTS = [
  {
    name: 'script-duty',
    notes: 'Pulse 1 through all eight duty widths at a fixed period, volume 15, each disabled and freshly re-enabled - its own run - so a per-run shift can tell the phase convention from the waveform.',
    writes: (() => {
      const w = writer();
      const period = 40;
      const holdCycles = 16 * (period + 1) * 20;
      for (let duty = 0; duty < 8; duty++) {
        w.write(P1.control, pulseControl(15, duty));
        periodWrites(w, P1, period, true);
        w.advance(holdCycles);
        periodWrites(w, P1, period, false);
        w.advance(GAP);
      }
      return w.writes;
    })(),
  },
  {
    name: 'script-pulse-periods',
    notes: 'Pulse 2, duty 4, at seven periods spanning the 12-bit range, each its own run; the mode bit at the end, ignoring duty entirely.',
    writes: (() => {
      const w = writer();
      w.write(P2.control, pulseControl(12, 4));
      for (const period of [0, 1, 15, 99, 500, 2000, 4095]) {
        periodWrites(w, P2, period, true);
        w.advance(Math.max(16 * (period + 1) * 12, GAP - 200) + 200);
        periodWrites(w, P2, period, false);
        w.advance(GAP);
      }
      w.write(P2.control, pulseControl(12, 4, true));
      periodWrites(w, P2, 100, true);
      w.advance(4000);
      w.write(P2.control, pulseControl(0, 0));
      return w.writes;
    })(),
  },
  {
    name: 'script-pulse-enable',
    notes: 'Pulse 1 disabled and re-enabled six times at a settled period, each a clean run past the gap: proves re-enabling always resets to the start of the sweep (nesdev\'s "resume from the beginning"), where the oracle instead resumes wherever its own phase happened to freeze - a drifting, not constant, per-run shift, which is exactly what the per-run search is for.',
    writes: (() => {
      const w = writer();
      const period = 60;
      w.write(P1.control, pulseControl(15, 3));
      for (let i = 0; i < 6; i++) {
        periodWrites(w, P1, period, true);
        w.advance(16 * (period + 1) + 37);
        periodWrites(w, P1, period, false);
        w.advance(GAP + i * 97);
      }
      return w.writes;
    })(),
  },
  {
    name: 'script-pulse-both',
    notes: 'Both pulses at once, different duties and periods, each combination its own run on both channels - two independent oscillators sharing nothing but the clock.',
    writes: (() => {
      const w = writer();
      const cases = [
        [10, 2, 80, 6, 6, 133],
        [15, 5, 80, 2, 6, 133],
        [11, 6, 45, 14, 2, 210],
      ];
      for (const [v1, d1, p1, v2, d2, p2] of cases) {
        w.write(P1.control, pulseControl(v1, d1));
        periodWrites(w, P1, p1, true);
        w.write(P2.control, pulseControl(v2, d2));
        periodWrites(w, P2, p2, true);
        w.advance(second(0.4));
        periodWrites(w, P1, p1, false);
        periodWrites(w, P2, p2, false);
        w.advance(GAP);
      }
      return w.writes;
    })(),
  },
  {
    name: 'script-saw-worked-example',
    notes: "Nesdev's own worked example: rate $08, period 0 - the accumulator's top five bits should read 1,2,3,4,5,6,0 repeating.",
    writes: (() => {
      const w = writer();
      w.write(SAW.rate, 0x08);
      periodWrites(w, SAW, 0, true);
      return w.writes;
    })(),
  },
  {
    name: 'script-saw-rates',
    notes: 'The sawtooth at several rates below the overflow point (42) and two above it (distorted, non-monotonic ramps), each disabled and re-enabled - its own run - a few full seven-step cycles long.',
    writes: (() => {
      const w = writer();
      const period = 20;
      for (const rate of [1, 8, 21, 42, 48, 63]) {
        w.write(SAW.rate, rate);
        periodWrites(w, SAW, period, true);
        w.advance(2 * 7 * (period + 1) * 20);
        periodWrites(w, SAW, period, false);
        w.advance(GAP);
      }
      return w.writes;
    })(),
  },
  {
    name: 'script-saw-enable',
    notes: 'The sawtooth disabled and re-enabled five times, a running accumulator each time - known to diverge from the oracle right at each disable (see the README: Game_Music_Emu freezes the accumulator there, nesdev says it zeroes), measured here rather than hidden from the corpus. Each cycle is its own run past the gap.',
    writes: (() => {
      const w = writer();
      const period = 15;
      w.write(SAW.rate, 0x08);
      for (let i = 0; i < 5; i++) {
        periodWrites(w, SAW, period, true);
        w.advance(2 * 7 * (period + 1) + 11);
        periodWrites(w, SAW, period, false);
        w.advance(GAP + i * 53);
      }
      return w.writes;
    })(),
  },
  {
    name: 'script-all-three',
    notes: 'Both pulses and the sawtooth active together, three combinations of independent periods and duties, each its own run on every voice - the closest this corpus comes to a real tune, all on the same clock, none of them sharing a divider.',
    writes: (() => {
      const w = writer();
      const cases = [
        [11, 1, 90, 9, 4, 60, 0x10, 45],
        [11, 6, 90, 14, 2, 120, 0x2a, 45],
        [6, 3, 150, 5, 5, 75, 0x08, 30],
      ];
      for (const [v1, d1, p1, v2, d2, p2, rate, ps] of cases) {
        w.write(P1.control, pulseControl(v1, d1));
        periodWrites(w, P1, p1, true);
        w.write(P2.control, pulseControl(v2, d2));
        periodWrites(w, P2, p2, true);
        w.write(SAW.rate, rate);
        periodWrites(w, SAW, ps, true);
        w.advance(second(0.4));
        periodWrites(w, P1, p1, false);
        periodWrites(w, P2, p2, false);
        periodWrites(w, SAW, ps, false);
        w.advance(GAP);
      }
      return w.writes;
    })(),
  },
];

/**
 * `cycles` is derived from the writes themselves, not hand-typed: every
 * script above grew its hold times to give `compare.mjs`'s per-run shift
 * search enough of each waveform to work with, and a hand-typed guess would
 * only go stale again the next time one of those changed and silently
 * truncate the log (the oracle drops any write at or past `cycles`, same as
 * chipvoice's own `trace()`).
 */
function scriptLog({ name, notes, writes, tailPad = 0 }) {
  const all = writes.map(([at, addr, value]) => ({ at, addr, value }));
  const last = all.reduce((m, w) => Math.max(m, w.at), 0);
  // `tailPad`, on top of the usual GAP * 3: a script whose sawtooth is still
  // running (never disabled) right up to the log's own cutoff needs a little
  // more than the usual margin, or Game_Music_Emu's own `end_frame(cycles)` -
  // which, like `run_saw`, processes up to but not including `cycles` - has
  // nowhere to place the one-firing-ahead edge that
  // `oracles/game-music-emu.mjs`'s per-period correction (see its own
  // comment) shifts back into what would otherwise be this log's very last
  // cycle: that oracle's edges land exactly `2 * (period + 1)` cycles apart,
  // all at one parity of `cycle - lastWrite`, so raising `tailPad` by a
  // magnitude alone is not enough - it has to also change on which side of
  // that spacing chipvoice's own last edge falls relative to `cycles`, or the
  // very same edge just keeps landing one cycle short of the boundary
  // (measured directly on `saw-worked-example`: `tailPad` 4, 6, 8, 10 all
  // still clipped the last edge; 5, 7, 9, 11 all did not - the fix is the
  // pad's parity, not its size). `core/saw-worked-example.log` and
  // `core/saw-rates.log` need this; scripts that settle into silence or a
  // disable well before the cutoff (everything else here) do not.
  const cycles = last + GAP * 3 + tailPad;
  return { name, text: formatLog({ name, chip: 'vrc6', clock: CLOCK, cycles, source: 'src/corpus/generate-vrc6.mjs', notes }, all) };
}

fs.mkdirSync(OUT, { recursive: true });
for (const log of SCRIPTS.map(scriptLog)) {
  fs.writeFileSync(path.join(OUT, `${log.name}.log`), log.text);
  console.log(`${log.name}.log`);
}

/**
 * `core/` and `edge/` - the round-2 corpus split (decision 38's own review of
 * this ticket), gated exactly rather than by baseline.
 *
 * `core/` never disables a channel after its first enable, never writes
 * $9003, and never runs a pulse's duty generator (the two pulses are always
 * mode-on here) at a period of 4 or less - the three things this ticket's
 * review named as needing an exact, not baseline, gate. It is checked exact
 * (no `--baseline`, no `--report`) against BOTH oracles: Game_Music_Emu
 * (three voices) and, via `vrc6-combined`, Mesen 2 (its one summed voice).
 *
 * A pulse's duty-generator waveform itself - which absolute cycle its
 * high/low edge falls on for a given duty width - is deliberately kept out
 * of `core/` even though duty and period are two of the five things this
 * ticket's review asked `core/` to cover: `chipvoice`'s `Vrc6Pulse.step`
 * counts DOWN from 15 (nesdev's literal text, `vrc6.ts`'s own doc comment),
 * so its high window's LEFT edge falls at a point that depends on the duty
 * width `D`, while its RIGHT edge is anchored at the divider's wrap event,
 * independent of `D`. Both Game_Music_Emu's `run_square` and Mesen's
 * `Vrc6Pulse::Clock` count UP instead (`phase++`/`_step = (_step+1) & 0x0F`),
 * so THEIR high window's LEFT edge is the one anchored at the wrap event,
 * independent of `D`, and the RIGHT edge is the one that depends on `D` -
 * the mirror image. Lining the two windows up as sets requires the wrap
 * event's own tick-index, a fixed constant for each engine set only by its
 * own enable-time convention, to differ by exactly `D` - which cannot hold
 * for more than one accidental value of `D` at once, and does not hold for
 * any of the eight duty widths in `corpus/vrc6/script-duty.log` today (that
 * baseline log's own per-run shift search finds only 1 or 2 of 8 aligned).
 * This is a real, sourced, three-way structural difference, not a phase
 * convention a shift or a tolerance could paper over - `core/pulse-levels`
 * below proves volume and the mode bit exactly instead (both bypass the duty
 * generator entirely: `output()`/`GetVolume()` all return `volume`
 * unconditionally when mode/`_ignoreDuty` is set), and the duty generator's
 * own waveform stays where it already was, tracked by baseline
 * (`script-duty.log`, `script-pulse-periods.log`) and proven correct against
 * nesdev's text directly by `packages/chipvoice/test/vrc6.mjs`'s own unit
 * tests, never against either oracle.
 *
 * `edge/` is exactly the opposite: disable/re-enable, $9003, and periods of
 * 4 or less - the things Game_Music_Emu's own known gaps (see its README)
 * make it unable to check at all (it never resets a duty phase on re-enable,
 * it drops $9003 outright, and `run_square` never even steps a duty phase at
 * period <= 4). Mesen has none of those three gaps (`Vrc6Pulse::Clock` has
 * no period guard, `Vrc6Audio::WriteRegister` wires up $9003, and
 * `Vrc6Saw::WriteReg` zeroes the accumulator on disable, matching nesdev),
 * so `edge/` is gated exactly against Mesen and only reported against
 * Game_Music_Emu, the gap stated as a rule rather than loosened into a
 * passing tolerance - see `docs/chips/vrc6.md`'s "Known deviations" table
 * for the numbers.
 *
 * Every `edge/` script still avoids the pulse duty-generator mismatch above
 * by keeping its pulse work mode-on (disable/enable toggles the E bit, which
 * both engines gate `GetVolume()`/`output()` on directly, mode or not - so
 * this is exact regardless of the duty-direction issue) and by keeping its
 * sawtooth work in the one register the saw's own documented behaviour
 * (`Vrc6Saw::Clock` in both chipvoice and Mesen, `run_saw` in Game_Music_Emu)
 * has no up/down-counter asymmetry to trip over.
 *
 * `edge/saw-enable.log`'s disable spans are each an exact multiple of the
 * sawtooth divider's own full period, `2 * (period + 1)` (one firing toggles
 * `subPhase`; two firings, `2 * (period + 1)` cycles, return it to the same
 * value) - not an arbitrary gap. `Vrc6Saw.clockDivider` (`vrc6.ts`) does not
 * gate on `enabled` (nesdev, saw section: "clearing E does not reset the
 * frequency divider"), so chipvoice's own timer/subPhase keep ticking all the
 * way through a disable and land back on the exact value they held at the
 * moment of disable once a whole multiple of that period has passed;
 * Mesen's `Vrc6Saw::Clock` gates its own `_timer`/`_step` on `_enabled` (an
 * undocumented difference from nesdev's text, noted in the oracle's README),
 * freezing them at that same moment instead - two different mechanisms that
 * this specific choice of span makes land on the identical value, so the
 * waveform from the re-enable cycle onward is exactly the same either way.
 * A disable span that were not a multiple of the period would make the two
 * engines' internal phase disagree at re-enable even though both correctly
 * force the accumulator to zero throughout (nesdev, saw section) - a real
 * but separate effect this choice of span deliberately keeps out of view so
 * the corpus tests one thing at a time; `corpus/vrc6/script-saw-enable.log`
 * (the pre-existing baseline log, arbitrary spans) is where that interaction
 * is left visible.
 */
const CORE_OUT = path.join(OUT, 'core');
const EDGE_OUT = path.join(OUT, 'edge');

const CORE_SCRIPTS = [
  {
    name: 'saw-worked-example',
    notes: "Nesdev's own worked example (rate $08, period 0), one continuous run, never disabled: the accumulator's top five bits read 1,2,3,4,5,6,0 repeating. This is the log `oracles/game-music-emu.mjs`'s and `oracles/mesen-vrc6.mjs`'s sawtooth cycle correction comments measure their period-0 case (offset -1) on: 8999/8999 edges align exactly under it against both oracles.",
    tailPad: 5,
    writes: (() => {
      const w = writer();
      w.write(SAW.rate, 0x08);
      periodWrites(w, SAW, 0, true);
      return w.writes;
    })(),
  },
  {
    name: 'saw-rates',
    notes: "The sawtooth enabled once at period 20 and never disabled or re-perioded again: several rates below the overflow point (42) and two above it, all live - proving the accumulator behaves correctly across a rate change with no disable/re-enable anywhere in the file. The period is deliberately never rewritten here (`core/saw-periods.log` covers other fixed periods, each in its own file): Game_Music_Emu's own phase runs exactly one divider firing ahead of chipvoice's at all times (see `oracles/game-music-emu.mjs`'s own comment on this), which a period rewrite mid-run - even to the SAME channel, not a disable - lands right on top of for the single edge straddling that write, before the next span's constant correction takes back over; keeping the period fixed for the file's whole duration keeps that one-edge seam out of a script this ticket gates exactly. `tailPad` gives the file's own tail enough runway that its last transition's Game_Music_Emu-side edge (reported `period + 1` = 21 cycles later than chipvoice's own, see the same comment) still lands strictly before `scriptLog`'s `cycles` cutoff rather than being clipped by it (same reasoning as `saw-worked-example`'s own `tailPad`).",
    tailPad: 25,
    writes: (() => {
      const w = writer();
      const cycle = 2 * 7 * (20 + 1) * 3;
      w.write(SAW.rate, 1);
      periodWrites(w, SAW, 20, true);
      w.advance(cycle);
      w.write(SAW.rate, 8);
      w.advance(cycle);
      w.write(SAW.rate, 21);
      w.advance(cycle);
      w.write(SAW.rate, 42); // overflow boundary (floor(255/6))
      w.advance(cycle);
      w.write(SAW.rate, 63); // overflows, non-monotonic ramp
      w.advance(cycle);
      return w.writes;
    })(),
  },
  {
    name: 'saw-periods',
    notes: "The sawtooth held at the 12-bit period's maximum, 4095 (the value most likely to expose an off-by-one in either implementation's mask/shift), enabled once and never disabled or re-perioded: two rates, both well under the overflow point.",
    writes: (() => {
      const w = writer();
      w.write(SAW.rate, 12);
      periodWrites(w, SAW, 4095, true);
      w.advance(2 * 7 * (4095 + 1) * 2);
      w.write(SAW.rate, 40); // rate change only, period still fixed - proven safe by core/saw-rates.log
      w.advance(2 * 7 * (4095 + 1) * 2);
      return w.writes;
    })(),
  },
  {
    name: 'pulse-levels',
    notes: 'Both pulses, mode bit set throughout (duty ignored - see this file\'s own header comment for why the duty generator itself is excluded from the exact gate), enabled once and never disabled: every volume 1-15 on each channel, the duty register written alongside each one to prove it is ignored, and a period change on each channel while already enabled.',
    writes: (() => {
      const w = writer();
      w.write(P1.control, pulseControl(0, 0, true));
      periodWrites(w, P1, 100, true);
      w.advance(500);
      for (let volume = 1; volume <= 15; volume++) {
        w.write(P1.control, pulseControl(volume, volume % 8, true));
        w.advance(300);
      }
      periodWrites(w, P1, 250, true); // period change, still enabled
      w.advance(500);
      w.write(P2.control, pulseControl(0, 0, true));
      periodWrites(w, P2, 80, true);
      w.advance(500);
      for (let volume = 1; volume <= 15; volume++) {
        w.write(P2.control, pulseControl(volume, (volume + 3) % 8, true));
        w.advance(300);
      }
      periodWrites(w, P2, 333, true); // period change, still enabled
      w.advance(500);
      return w.writes;
    })(),
  },
  {
    name: 'multi-voice',
    notes: "Both pulses (mode on, a fixed level set once and never changed again) and the sawtooth (rate varying live, period fixed at 30 throughout - see `core/saw-rates.log`'s own note on why a period rewrite mid-run stays out of every exact-gated script) all enabled together, none of them ever disabled - proving the three oscillators run independently off the same clock with no crosstalk.",
    writes: (() => {
      const w = writer();
      w.write(P1.control, pulseControl(9, 0, true));
      periodWrites(w, P1, 120, true); // set once, never touched again
      w.write(P2.control, pulseControl(5, 0, true));
      periodWrites(w, P2, 200, true); // set once, never touched again
      const cycle = 2 * 7 * (30 + 1) * 3;
      w.write(SAW.rate, 10);
      periodWrites(w, SAW, 30, true);
      w.advance(cycle);
      w.write(SAW.rate, 25);
      w.advance(cycle);
      w.write(SAW.rate, 50); // overflow
      w.advance(cycle);
      return w.writes;
    })(),
  },
];

const EDGE_SCRIPTS = [
  {
    name: 'pulse-enable',
    notes: 'Pulse 1, mode bit set (so the duty generator, excluded from any exact claim - see this file\'s own header comment - is never in play), disabled and re-enabled six times: proves the E bit alone gates output to and from zero exactly, on both oracles, since `output()`/`GetVolume()` return 0 on `!enabled` unconditionally of the mode bit in chipvoice, Game_Music_Emu and Mesen alike.',
    writes: (() => {
      const w = writer();
      w.write(P1.control, pulseControl(13, 0, true));
      for (let i = 0; i < 6; i++) {
        periodWrites(w, P1, 50, true);
        w.advance(800 + i * 37);
        periodWrites(w, P1, 50, false);
        w.advance(GAP + i * 53);
      }
      return w.writes;
    })(),
  },
  {
    name: 'saw-enable',
    notes: "The sawtooth disabled and re-enabled five times at a fixed period (20), each disable span an exact multiple of the divider's own full period (2 * 21 = 42 cycles) - see this file's own header comment for why that specific choice, not an arbitrary gap, is what makes chipvoice's continuously-ticking divider (nesdev: disabling the saw \"does not reset the frequency divider\") and Mesen's frozen one (an undocumented difference from that same text) land on the same phase at every re-enable.",
    writes: (() => {
      const w = writer();
      const period = 20;
      const fullPeriod = 2 * (period + 1);
      w.write(SAW.rate, 8);
      for (let i = 0; i < 5; i++) {
        periodWrites(w, SAW, period, true);
        w.advance(2 * 7 * (period + 1) * 2);
        periodWrites(w, SAW, period, false);
        w.advance(fullPeriod * 150); // 6300 cycles: an exact multiple of fullPeriod, comfortably past compare.mjs's RUN_GAP
      }
      return w.writes;
    })(),
  },
  {
    name: 'register-9003',
    notes: "$9003's halt bit and both frequency-shift bits, on the sawtooth only (see this file's own header comment for why the pulses' duty generator stays out of every edge script): halt freezes `Vrc6Audio::ClockAudio`'s three `Clock()` calls in Mesen and `clockCPU`'s three `clockDivider` calls in chipvoice identically, so nothing moves in either engine while it is set; the 16x and 256x shifts just rescale the divider's own reload value the same way in both (`periodReg >> shift`), taking effect at the next reload exactly like a plain rate/period change. Game_Music_Emu drops every write here (`reg_count == 3`) and keeps running unshifted forever - reported, not gated, against it.",
    writes: (() => {
      const w = writer();
      const period = 30;
      const cycle = (p) => 2 * 7 * (p + 1) * 3;
      w.write(SAW.rate, 12);
      periodWrites(w, SAW, period, true);
      w.advance(cycle(period));
      w.write(0x9003, 0x01); // halt
      w.advance(3000);
      w.write(0x9003, 0x00); // resume
      w.advance(cycle(period));
      w.write(0x9003, 0x02); // 16x frequency shift
      w.advance(2000);
      w.write(0x9003, 0x04); // 256x, overrides 16x
      w.advance(2000);
      w.write(0x9003, 0x00); // back to normal
      w.advance(cycle(period));
      return w.writes;
    })(),
  },
];

for (const [dir, scripts] of [[CORE_OUT, CORE_SCRIPTS], [EDGE_OUT, EDGE_SCRIPTS]]) {
  fs.mkdirSync(dir, { recursive: true });
  for (const log of scripts.map(scriptLog)) {
    fs.writeFileSync(path.join(dir, `${log.name}.log`), log.text);
    console.log(path.join(path.basename(dir), `${log.name}.log`));
  }
}
