import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * The AY-3-8910/YM2149 corpus, generated.
 *
 * Hand-written register scripts, not songs through a driver: this chip has
 * no arranger/driver integration yet (NEXT-15's scope), only the Sunsoft 5B
 * host, so there is no native voice-compiler to record from. Every write is
 * a chip register index 0-15 (`Ay8910.write`'s own addressing, not a CPU
 * address - the 5B's own $C000/$E000 port pair is exercised separately, by
 * `packages/chipvoice/test/sunsoft5b.mjs`), and every log's clock is the
 * NES's own 1789773 Hz, since the only host this ticket adds rides that bus.
 *
 * `docs/DECISIONS.md`'s decision 47 records why the corpus below is split
 * into `core/` and `edge/` on a stricter line than VRC6's own duty/period
 * split: `core/` is DAC-mode only (every channel's mixer bits 0-2 AND 3-5
 * both set, tone and noise generators both bypassed - `Ay8910.outputs`'s own
 * gate formula forces `gate = 1` unconditionally in that state, so a
 * channel's output is its volume register alone, sampled once a prescaled
 * tick), the one category measured exact and with no settling against both
 * oracles with zero offset. `edge/` is everything with a tone or noise
 * generator actually running - gated exact against Ayumi where it has no
 * known disagreement, `--report` everywhere the oracle's own timing model or
 * the AY_AMP_TABLE.map (`chips/ay8910.mjs`'s own comment) makes an exact
 * claim meaningless rather than false.
 */
const CLOCK = 1789773;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus', 'ay8910');

/** Comfortably past `compare.mjs`'s `RUN_GAP` (4200). */
const GAP = 6000;

const second = (s) => Math.round(s * CLOCK);

/**
 * A register writer with a cursor, starting at cycle 0 - not VRC6's usual
 * `second(0)` PREROLL. Unlike VRC6 (silent until $9000/$A000/$B000's E bit
 * is set), `Ay8910`'s own unwritten reset state has `regs[7] = 0` - bit 0,
 * "0 = enabled" (nesdev's own naming), not the disabled state a channel's
 * `regs[7]` bits use everywhere else in this file - so the tone and noise
 * generators are both live from the chip's very first prescaled tick
 * (`tick()`'s own comment: fires every 16 raw clocks, first at cycle 15) if
 * nothing has silenced them yet. A setup write at `second(0)` (~17898
 * cycles in) would leave that whole prelude to run on default period-1
 * generators, uncontrolled by anything this script wrote and free to land on
 * a different phase in each oracle's own reset convention - not a real
 * property of either implementation, just noise from not having said
 * anything yet. Landing every script's first write at cycle 0 instead means
 * it is in effect before the cycle-15 tick ever reads `regs`, so nothing
 * about the four-figure prelude the previous version of this file left
 * unaccounted for is left to chance.
 */
function writer() {
  const writes = [];
  let t = 0;
  return {
    writes,
    at(time) { t = time; },
    write(reg, value) { writes.push([t, reg, value & 0xff]); },
    advance(cycles) { t += cycles; },
  };
}

const REG = {
  toneALo: 0, toneAHi: 1, toneBLo: 2, toneBHi: 3, toneCLo: 4, toneCHi: 5,
  noise: 6, mixer: 7, volA: 8, volB: 9, volC: 10, envLo: 11, envHi: 12, envShape: 13,
};

/** R7's bit layout: 0 disables tone A/B/C is wrong - 0 means ENABLED, 1
 * means disabled, bits 0-2 tone, bits 3-5 noise, per nesdev's naming and
 * `chips/ay8910.ts`'s own `TONE_DISABLE_SHIFT`/`NOISE_DISABLE_SHIFT`. */
function mixer({ toneA = false, toneB = false, toneC = false, noiseA = false, noiseB = false, noiseC = false }) {
  return (toneA ? 0 : 1) | ((toneB ? 0 : 1) << 1) | ((toneC ? 0 : 1) << 2) |
    (noiseA ? 0 : 1 << 3) | (noiseB ? 0 : 1 << 4) | (noiseC ? 0 : 1 << 5);
}
/** All six generator bits disabled: every channel forced into DAC mode. */
const DAC_ALL = mixer({});

function volReg(fixedVolume, envelopeOn = false) {
  return (envelopeOn ? 0x10 : 0) | (fixedVolume & 0x0f);
}
function periodWrites(w, lo, hi, period) {
  w.write(lo, period & 0xff);
  w.write(hi, (period >> 8) & 0x0f);
}

function scriptLog({ name, notes, writes }) {
  const all = writes.map(([at, addr, value]) => ({ at, addr, value }));
  const last = all.reduce((m, w) => Math.max(m, w.at), 0);
  const cycles = last + GAP * 3;
  return { name, text: formatLog({ name, chip: 'ay8910', clock: CLOCK, cycles, source: 'src/corpus/generate-ay8910.mjs', notes }, all) };
}

/**
 * `core/` - DAC mode only, gated exact against both oracles with no
 * settling: `mixer` is written `DAC_ALL` once per script and never touched
 * again, so every channel's gate is `1` for the log's whole duration and its
 * output is its own volume register, sampled every prescaled tick - nothing
 * here depends on the tone divider's phase, the noise LFSR's form (Galois
 * vs Fibonacci, decision 47), or either oracle's own timing model.
 */
const CORE_SCRIPTS = [
  {
    name: 'channel-a',
    notes: 'Mixer forced to DAC mode once; channel A ramps through every 4-bit volume level up and back down while B and C hold a fixed level, proving a single channel\'s DAC path exactly.',
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, DAC_ALL);
      w.write(REG.volB, volReg(5));
      w.write(REG.volC, volReg(9));
      for (const v of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 12, 8, 4, 0]) {
        w.write(REG.volA, volReg(v));
        w.advance(200);
      }
      return w.writes;
    })(),
  },
  {
    name: 'channel-b',
    notes: 'The same volume ramp as channel-a, on channel B this time.',
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, DAC_ALL);
      w.write(REG.volA, volReg(3));
      w.write(REG.volC, volReg(12));
      for (const v of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 12, 8, 4, 0]) {
        w.write(REG.volB, volReg(v));
        w.advance(200);
      }
      return w.writes;
    })(),
  },
  {
    name: 'channel-c',
    notes: 'The same volume ramp as channel-a, on channel C this time.',
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, DAC_ALL);
      w.write(REG.volA, volReg(7));
      w.write(REG.volB, volReg(1));
      for (const v of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 12, 8, 4, 0]) {
        w.write(REG.volC, volReg(v));
        w.advance(200);
      }
      return w.writes;
    })(),
  },
  {
    name: 'all-three-independent',
    notes: 'All three channels in DAC mode at once, each stepping through its own, differently-timed volume sequence - proving there is no crosstalk between channels sharing the same prescaled tick.',
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, DAC_ALL);
      const seqA = [0, 4, 8, 12, 15, 12, 8, 4, 0];
      const seqB = [15, 10, 5, 0, 5, 10, 15];
      const seqC = [2, 6, 10, 14, 10, 6, 2, 6, 10, 14];
      for (let i = 0; i < 30; i++) {
        if (i < seqA.length) w.write(REG.volA, volReg(seqA[i]));
        if (i < seqB.length) w.write(REG.volB, volReg(seqB[i]));
        if (i < seqC.length) w.write(REG.volC, volReg(seqC[i]));
        w.advance(157);
      }
      return w.writes;
    })(),
  },
  {
    name: 'mixer-upper-bits',
    notes: 'The mixer register rewritten several times with its unused upper two bits (I/O port direction - the 5B exposes no AY I/O pins, `chips/ay8910.ts`\'s own comment) varying, the six gate bits always left at DAC-all - proving those two bits truly play no part in the gate formula.',
    writes: (() => {
      const w = writer();
      w.write(REG.volA, volReg(11));
      w.write(REG.volB, volReg(3));
      w.write(REG.volC, volReg(15));
      for (const upper of [0x00, 0x40, 0x80, 0xc0]) {
        w.write(REG.mixer, DAC_ALL | upper);
        w.advance(500);
      }
      return w.writes;
    })(),
  },
];

/**
 * `edge/` - a tone or noise generator actually runs. Gated exact against
 * Ayumi except where noted; `--report` against Game_Music_Emu's `Ay_Apu`
 * throughout (decision 47: its own tone/noise timing carries a settle-
 * dependent offset this ticket declined to bake in as a correction, and its
 * amplitude-table comparison - `chips/ay8910.mjs`'s `ay8910-gme-amp` - has
 * no envelope curve at all, so an envelope-bearing script's numbers against
 * it are expected to be poor; that is recorded, not hidden).
 */
const CORE_OUT = path.join(OUT, 'core');
const EDGE_OUT = path.join(OUT, 'edge');

const EDGE_SCRIPTS = [
  {
    name: 'tone-sweep',
    notes: "Channel A's tone generator alone (noise off on A, B and C fully DAC-silenced at volume 0) through seven periods spanning the 12-bit range, each its own run past the gap - Ayumi's `update_tone` restarts a fresh phase at every reset the same discrete way this core's own `toneCounter` does, so this is gated exact against it; Game_Music_Emu's `Ay_Apu` carries a delta forward from its own reset default instead (decision 47), so this is `--report` only against it.",
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, mixer({ toneA: true }));
      w.write(REG.volA, volReg(15));
      w.write(REG.volB, volReg(0));
      w.write(REG.volC, volReg(0));
      for (const period of [1, 2, 15, 99, 500, 2000, 4095]) {
        periodWrites(w, REG.toneALo, REG.toneAHi, period);
        w.advance(Math.max(32 * period * 12, GAP - 200) + 200);
      }
      return w.writes;
    })(),
  },
  {
    name: 'noise-sweep',
    notes: "Channel A's noise generator alone (tone off on A, B and C fully DAC-silenced) through ten periods, including the small values (1-3) where the 17-bit LFSR's Galois-vs-Fibonacci choice (decision 47) is most visible cycle to cycle. Ayumi's own noise generator uses the Fibonacci form and disagrees with this core's Galois form by construction (`oracles/ayumi.mjs`'s own \"known limits\"), so noise-bearing logs are `--report` against BOTH oracles, never gated exact against either - there is no oracle here trusted for this one generator.",
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, mixer({ noiseA: true }));
      w.write(REG.volA, volReg(15));
      w.write(REG.volB, volReg(0));
      w.write(REG.volC, volReg(0));
      for (const period of [1, 2, 3, 5, 7, 11, 16, 17, 25, 31]) {
        w.write(REG.noise, period);
        w.advance(Math.max(32 * period * 12, GAP - 200) + 200);
      }
      return w.writes;
    })(),
  },
  {
    name: 'tone-noise-mixed',
    notes: "Channel A with both its tone and noise generators running together (mixer's AND-gate combining them), B and C DAC-silenced - the one combination this ticket's own investigation found breaks length-for-length against Game_Music_Emu even under the tone-only and noise-only offsets' own settle convention (see decision 47), and inherits Ayumi's noise-form disagreement besides, so this is `--report` against both.",
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, mixer({ toneA: true, noiseA: true }));
      w.write(REG.volA, volReg(15));
      w.write(REG.volB, volReg(0));
      w.write(REG.volC, volReg(0));
      const cases = [[40, 3], [200, 11], [12, 25]];
      for (const [tonePeriod, noisePeriod] of cases) {
        periodWrites(w, REG.toneALo, REG.toneAHi, tonePeriod);
        w.write(REG.noise, noisePeriod);
        w.advance(second(0.05));
      }
      return w.writes;
    })(),
  },
  {
    name: 'gate-toggle',
    notes: "Channel A's mixer bits cycled through all four tone/noise-enabled combinations (both off, tone alone, noise alone, both on) with the period registers held fixed throughout - exercising `outputs`'s AND-gate formula across every state it can be in, one state per run.",
    writes: (() => {
      const w = writer();
      w.write(REG.volA, volReg(13));
      w.write(REG.volB, volReg(0));
      w.write(REG.volC, volReg(0));
      periodWrites(w, REG.toneALo, REG.toneAHi, 60);
      w.write(REG.noise, 9);
      const states = [
        {}, // both off: DAC mode
        { toneA: true },
        { noiseA: true },
        { toneA: true, noiseA: true },
      ];
      for (const s of states) {
        w.write(REG.mixer, mixer({ ...s, toneB: false, toneC: false, noiseB: false, noiseC: false }));
        w.advance(second(0.02));
      }
      return w.writes;
    })(),
  },
  {
    name: 'envelope-shapes',
    notes: "Channel A held in DAC mode (gate always 1, so the envelope's own 0-31 curve is visible with no tone/noise generator in the way) with its volume register's envelope bit set, cycling through all 16 of R13's shapes at a short, fixed envelope period - a shape write resets the envelope to segment 0 (`Ay8910.write`'s own comment on R13), so each shape is its own clean run. `chips/ay8910.ts`'s envelope table was cross-checked against Ayumi's own independent `Envelopes[16][2]`/`reset_segment` (its own class doc comment) before being written, so this is gated exact against Ayumi; it is `--report` only against Game_Music_Emu's amplitude-table comparison, which has no envelope curve at all (`chips/ay8910.mjs`'s own comment on `ay8910-gme-amp`).",
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, DAC_ALL);
      w.write(REG.volB, volReg(0));
      w.write(REG.volC, volReg(0));
      const envPeriod = 3;
      periodWrites(w, REG.envLo, REG.envHi, envPeriod);
      const stepCycles = 16 * envPeriod;
      for (let shape = 0; shape < 16; shape++) {
        w.write(REG.volA, volReg(0, true));
        w.write(REG.envShape, shape);
        w.advance(stepCycles * 32 * 2 + 500);
      }
      return w.writes;
    })(),
  },
  {
    name: 'envelope-periods',
    notes: 'A single shape (14, the up/down triangle) at six envelope periods spanning small to large - the envelope divider runs at `Clock / (16 * 32 * Period)` per full cycle (nesdev, and this core\'s own `tick()` comment), so period alone is worth sweeping independently of shape.',
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, DAC_ALL);
      w.write(REG.volB, volReg(0));
      w.write(REG.volC, volReg(0));
      w.write(REG.volA, volReg(0, true));
      for (const period of [1, 4, 16, 64, 256, 1000]) {
        periodWrites(w, REG.envLo, REG.envHi, period);
        w.write(REG.envShape, 14);
        w.advance(Math.min(16 * period * 32 * 2, second(0.3)) + 500);
      }
      return w.writes;
    })(),
  },
  {
    name: 'envelope-and-tone',
    notes: "Channel A with its tone generator running AND its envelope enabled together - the realistic combined case a driver would actually use - B and C DAC-silenced. `--report` against both oracles: it inherits Game_Music_Emu's tone-timing offset (decision 47) on top of its amplitude table having no envelope curve, and Ayumi's own tone/envelope generators are independently trusted but this combination is not separately proven exact here, only each half is (`tone-sweep`, `envelope-shapes`).",
    writes: (() => {
      const w = writer();
      w.write(REG.mixer, mixer({ toneA: true }));
      w.write(REG.volB, volReg(0));
      w.write(REG.volC, volReg(0));
      periodWrites(w, REG.toneALo, REG.toneAHi, 80);
      periodWrites(w, REG.envLo, REG.envHi, 6);
      w.write(REG.volA, volReg(0, true));
      w.write(REG.envShape, 10);
      w.advance(second(0.05));
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
