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
function scriptLog({ name, notes, writes }) {
  const all = writes.map(([at, addr, value]) => ({ at, addr, value }));
  const last = all.reduce((m, w) => Math.max(m, w.at), 0);
  const cycles = last + GAP * 3;
  return { name, text: formatLog({ name, chip: 'vrc6', clock: CLOCK, cycles, source: 'src/corpus/generate-vrc6.mjs', notes }, all) };
}

fs.mkdirSync(OUT, { recursive: true });
for (const log of SCRIPTS.map(scriptLog)) {
  fs.writeFileSync(path.join(OUT, `${log.name}.log`), log.text);
  console.log(`${log.name}.log`);
}
