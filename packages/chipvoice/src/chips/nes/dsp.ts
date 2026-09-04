/**
 * A clock-driven emulation of the Ricoh 2A03 APU.
 *
 * Web Audio's PeriodicWave is band-limited: it anti-aliases, which is precisely
 * why oscillator-based "chiptune" sounds too clean. This does what the chip did
 * instead - step 8-entry duty sequences and a 15-bit LFSR at the APU clock, mix
 * them through the hardware's non-linear DAC curves, then run the three analog
 * filters that give the NES its boxy voice.
 *
 * Register writes arrive as events stamped with the CPU cycle they land on,
 * and are applied on that cycle - not at the start of the sample around it -
 * so slides and arpeggios land on the frame they were scheduled for, and so a
 * log of writes from a real game can be replayed here and against an oracle
 * and expected to agree.
 *
 * The same module runs in two places. Node imports it. The worklet gets it
 * bundled with `worklet.ts` into one self-contained script by
 * `scripts/build-worklet.mjs`, because a blob URL has nothing to resolve an
 * import against. The sample clock is a parameter rather than a global: in a
 * worklet it is `currentFrame`, offline it is a counter. That one difference
 * is all that separates real time from a file, and it is what makes rendering
 * a pure function of the song and the sample rate.
 *
 * What is verified and what is not is on the chip's sheet, `docs/chips/2a03.md`.
 */

import type { ChipCore, RegisterEvent } from "../../chip.js";

/** The NTSC CPU clock. The APU units run at half of it, except the triangle. */
export const CPU_HZ = 1789773;

/**
 * The name the worklet registers its processor under.
 *
 * Here because the worklet and the package both import this file and neither
 * can import the other: the worklet's own module registers a processor the
 * moment it loads.
 */
export const PROCESSOR_NAME = "apu-processor";

// Duty sequences, straight from the hardware. Entry 3 is 25% inverted, which is
// why it sounds identical to entry 1.
const DUTY = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
];

// The 32-step triangle sequence: 15 down to 0, then back up.
const TRIANGLE_SEQ: number[] = [];
for (let i = 15; i >= 0; i--) TRIANGLE_SEQ.push(i);
for (let i = 0; i <= 15; i++) TRIANGLE_SEQ.push(i);

// NTSC noise periods, in CPU cycles: one shift of the register every N cycles.
// The noise timer itself is clocked at the APU rate, half the CPU clock, so a
// period is halved before it is loaded. Every entry is even, so nothing is
// lost. Index 15 gives 1789773 / 4068, which is 440 Hz almost exactly.
const NOISE_PERIODS = [
  4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068,
];

/** APU cycles per shift, for a rate index 0-15. */
const noisePeriod = (index: number): number =>
  NOISE_PERIODS[Math.max(0, Math.min(15, index | 0))] >> 1;

// The 4-step frame sequence, in CPU cycles from the start of a sequence.
// Every step clocks the envelopes and the linear counter; the second and the
// fourth also clock the length counters and the sweeps. The sequence is 29830
// cycles long, which is where the 240 Hz and 120 Hz come from.
const FRAME_STEPS = [7457, 14913, 22371, 29829];
const FRAME_PERIOD = 29830;

// Length counter table, indexed by the 5-bit load value.
const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
];

class Envelope {
  start = false;
  loop = false;
  constant = true;
  /** 0-15. Doubles as the divider's period, as on the hardware. */
  volume = 0;
  decay = 0;
  divider = 0;

  clock() {
    if (this.start) {
      this.start = false;
      this.decay = 15;
      this.divider = this.volume;
      return;
    }
    if (this.divider > 0) {
      this.divider--;
      return;
    }
    this.divider = this.volume;
    if (this.decay > 0) this.decay--;
    else if (this.loop) this.decay = 15;
  }

  output(): number {
    return this.constant ? this.volume : this.decay;
  }
}

class Pulse {
  /** 1 or 2. Affects the sweep's negate behaviour. */
  readonly channel: 1 | 2;
  enabled = false;
  duty = 0;
  step = 0;
  timer = 0;
  period = 0;
  readonly env = new Envelope();
  lengthCounter = 0;
  lengthHalt = false;
  sweepEnabled = false;
  sweepPeriod = 0;
  sweepNegate = false;
  sweepShift = 0;
  sweepDivider = 0;
  sweepReload = false;

  constructor(channel: 1 | 2) {
    this.channel = channel;
  }

  clock() {
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    this.timer = this.period;
    this.step = (this.step + 1) & 7;
  }

  targetPeriod(): number {
    const change = this.period >> this.sweepShift;
    if (this.sweepNegate) {
      // Pulse 1 negates with an extra -1; that off-by-one is real hardware.
      return this.period - change - (this.channel === 1 ? 1 : 0);
    }
    return this.period + change;
  }

  clockSweep() {
    const target = this.targetPeriod();
    if (this.sweepDivider === 0 && this.sweepEnabled && this.sweepShift > 0) {
      if (this.period >= 8 && target <= 0x7ff) this.period = target;
    }
    if (this.sweepDivider === 0 || this.sweepReload) {
      this.sweepDivider = this.sweepPeriod;
      this.sweepReload = false;
    } else {
      this.sweepDivider--;
    }
  }

  output(): number {
    if (!this.enabled || this.lengthCounter === 0) return 0;
    // Periods under 8 are muted by the hardware, and so is an overflowing sweep.
    if (this.period < 8 || this.targetPeriod() > 0x7ff) return 0;
    return DUTY[this.duty][this.step] ? this.env.output() : 0;
  }
}

class Triangle {
  timer = 0;
  period = 0;
  /**
   * Step 15 outputs 0. The hardware powers on at step 0, which outputs 15 and
   * holds it until the first note - and a held 15 is a DC step through the
   * high-pass filters, which is a click at the head of every render. A
   * deliberate deviation, listed on the sheet.
   */
  step = 15;
  lengthCounter = 0;
  lengthHalt = false;
  linearCounter = 0;
  linearReload = 0;
  linearReloadFlag = false;

  /** Runs at the full CPU rate, which is why the triangle is an octave down. */
  clock() {
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    this.timer = this.period;
    if (this.lengthCounter > 0 && this.linearCounter > 0 && this.period >= 2) {
      this.step = (this.step + 1) & 31;
    }
  }

  clockLinear() {
    if (this.linearReloadFlag) this.linearCounter = this.linearReload;
    else if (this.linearCounter > 0) this.linearCounter--;
    if (!this.lengthHalt) this.linearReloadFlag = false;
  }

  /**
   * Always the current step. When the length or linear counter reaches zero
   * the sequencer stops clocking and the output holds where it was; it does
   * not drop to zero. An earlier version returned 0 the moment a note ended,
   * which is a step of up to 15 into the mixer and a click at every note off.
   */
  output(): number {
    return TRIANGLE_SEQ[this.step];
  }
}

class Noise {
  enabled = false;
  shift = 1;
  mode = false;
  timer = 0;
  /** In APU cycles per shift. */
  period = noisePeriod(0);
  readonly env = new Envelope();
  lengthCounter = 0;
  lengthHalt = false;

  clock() {
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    // Reloaded one short, so a shift lands every `period` clocks rather than
    // every `period + 1`. The pulse timer counts (t + 1) by design; this one
    // is a plain divider.
    this.timer = this.period - 1;
    // Bit 6 in short mode shortens the sequence to 93 steps: metallic, not hiss.
    const tap = this.mode ? (this.shift >> 6) & 1 : (this.shift >> 1) & 1;
    const feedback = (this.shift & 1) ^ tap;
    this.shift = (this.shift >> 1) | (feedback << 14);
  }

  output(): number {
    if (!this.enabled || this.lengthCounter === 0) return 0;
    return this.shift & 1 ? 0 : this.env.output();
  }
}

/** Hardware DAC curves. Both are non-linear, and both matter. */
function mixPulses(p1: number, p2: number): number {
  const sum = p1 + p2;
  return sum === 0 ? 0 : 95.88 / (8128 / sum + 100);
}

function mixTND(triangle: number, noise: number, dmc: number): number {
  const denom = triangle / 8227 + noise / 12241 + dmc / 22638;
  return denom === 0 ? 0 : 159.79 / (1 / denom + 100);
}

/**
 * The chip.
 *
 * The four voices and the three clock methods are public for `test/clock.mjs`,
 * which drives the clocks directly and counts what the timers do. They are
 * not API: the package exposes a core through `ChipCore`, and nothing else.
 */
export class NesApuCore implements ChipCore {
  readonly sampleRate: number;
  readonly pulse1 = new Pulse(1);
  readonly pulse2 = new Pulse(2);
  readonly triangle = new Triangle();
  readonly noise = new Noise();

  private apuToggle = false;

  /**
   * Where the cycle clock stands against the sample clock, in integers.
   *
   * `cycle` is the absolute CPU cycle about to be clocked, counted from sample
   * 0. Events are stamped on the same clock, so it is what decides when a
   * write lands. `remainder` is how far the sample clock has got into that
   * cycle, in units of one sample rate: each sample adds CPU_HZ to it and
   * clocks a cycle for every whole sample rate it holds. Exact arithmetic, so
   * the two clocks cannot drift apart over a long render the way a floating
   * accumulator would let them.
   *
   * `nextSample` is where the last block ended. When a caller renders from
   * somewhere else - the first block, or a worklet that came up with the
   * context already running - both are re-derived from the sample position
   * rather than carried on from a place the chip never was.
   */
  private cycle = 0;
  private remainder = 0;
  private nextSample = -1;

  // Frame counter: quarter frames at 240 Hz drive envelopes, half frames at
  // 120 Hz drive length counters and sweeps.
  private frameCycles = 0;
  private frameStep = 0;

  // The three analog filters, as one-pole sections.
  private hp90 = 0;
  private hp440 = 0;
  private lp14k = 0;
  private readonly hp90Coef: number;
  private readonly hp440Coef: number;
  private readonly lpCoef: number;
  private lastIn90 = 0;
  private lastIn440 = 0;

  private events: RegisterEvent[] = [];
  private masterGain = 1;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.hp90Coef = Math.exp((-2 * Math.PI * 90) / sampleRate);
    this.hp440Coef = Math.exp((-2 * Math.PI * 440) / sampleRate);
    this.lpCoef = 1 - Math.exp((-2 * Math.PI * 14000) / sampleRate);
  }

  silence() {
    for (const ch of [this.pulse1, this.pulse2, this.noise]) {
      ch.lengthCounter = 0;
      ch.enabled = false;
    }
    this.triangle.lengthCounter = 0;
  }

  /**
   * Applies one scheduled command. These stand in for register writes; the
   * fields map one-to-one onto $4000-$400F.
   */
  applyEvent(ev: RegisterEvent) {
    switch (ev.ch) {
      case "p1":
      case "p2": {
        const ch = ev.ch === "p1" ? this.pulse1 : this.pulse2;
        if (ev.stop) {
          ch.lengthCounter = 0;
          ch.enabled = false;
          return;
        }
        ch.enabled = true;
        if (ev.duty !== undefined) ch.duty = ev.duty & 3;
        if (ev.period !== undefined) ch.period = Math.max(0, Math.min(0x7ff, ev.period | 0));
        if (ev.volume !== undefined) {
          ch.env.volume = Math.max(0, Math.min(15, ev.volume | 0));
        }
        if (ev.constant !== undefined) ch.env.constant = !!ev.constant;
        if (ev.loop !== undefined) {
          ch.env.loop = !!ev.loop;
          ch.lengthHalt = !!ev.loop;
        }
        if (ev.sweep) {
          ch.sweepEnabled = true;
          ch.sweepPeriod = ev.sweep.period | 0;
          ch.sweepNegate = !!ev.sweep.negate;
          ch.sweepShift = ev.sweep.shift | 0;
          ch.sweepReload = true;
        } else if (ev.sweep === null) {
          ch.sweepEnabled = false;
        }
        if (ev.length !== undefined) {
          ch.lengthCounter = LENGTH_TABLE[ev.length & 31];
        }
        if (ev.trigger) {
          ch.env.start = true;
          ch.step = 0;
        }
        return;
      }
      case "tri": {
        const ch = this.triangle;
        if (ev.stop) {
          ch.lengthCounter = 0;
          ch.linearCounter = 0;
          return;
        }
        if (ev.period !== undefined) ch.period = Math.max(0, Math.min(0x7ff, ev.period | 0));
        if (ev.length !== undefined) ch.lengthCounter = LENGTH_TABLE[ev.length & 31];
        if (ev.linear !== undefined) {
          ch.linearReload = Math.max(0, Math.min(127, ev.linear | 0));
        }
        if (ev.loop !== undefined) ch.lengthHalt = !!ev.loop;
        if (ev.trigger) ch.linearReloadFlag = true;
        return;
      }
      case "noi": {
        const ch = this.noise;
        if (ev.stop) {
          ch.lengthCounter = 0;
          ch.enabled = false;
          return;
        }
        ch.enabled = true;
        if (ev.periodIndex !== undefined) ch.period = noisePeriod(ev.periodIndex);
        if (ev.volume !== undefined) {
          ch.env.volume = Math.max(0, Math.min(15, ev.volume | 0));
        }
        if (ev.constant !== undefined) ch.env.constant = !!ev.constant;
        if (ev.loop !== undefined) {
          ch.env.loop = !!ev.loop;
          ch.lengthHalt = !!ev.loop;
        }
        if (ev.mode !== undefined) ch.mode = !!ev.mode;
        if (ev.length !== undefined) ch.lengthCounter = LENGTH_TABLE[ev.length & 31];
        if (ev.trigger) ch.env.start = true;
        return;
      }
    }
  }

  clockQuarterFrame() {
    this.pulse1.env.clock();
    this.pulse2.env.clock();
    this.noise.env.clock();
    this.triangle.clockLinear();
  }

  clockHalfFrame() {
    for (const ch of [this.pulse1, this.pulse2, this.noise, this.triangle]) {
      if (!ch.lengthHalt && ch.lengthCounter > 0) ch.lengthCounter--;
    }
    this.pulse1.clockSweep();
    this.pulse2.clockSweep();
  }

  /** One CPU cycle. The APU units run at half that, except the triangle. */
  clockCPU() {
    this.triangle.clock();
    this.apuToggle = !this.apuToggle;
    if (this.apuToggle) {
      this.pulse1.clock();
      this.pulse2.clock();
      this.noise.clock();
    }

    // The 4-step frame sequence. Half frames on the second and fourth steps:
    // an earlier version fired them on the first and third, which put every
    // length counter and sweep a quarter frame early.
    this.frameCycles++;
    if (this.frameStep < 4 && this.frameCycles === FRAME_STEPS[this.frameStep]) {
      this.clockQuarterFrame();
      if (this.frameStep === 1 || this.frameStep === 3) this.clockHalfFrame();
      this.frameStep++;
    }
    if (this.frameCycles >= FRAME_PERIOD) {
      this.frameCycles = 0;
      this.frameStep = 0;
    }
  }

  /**
   * Fills a buffer, advancing the chip one sample at a time.
   *
   * `startSample` is the absolute position of `left[0]` on the sample clock.
   * The cycle clock is derived from it, and a scheduled write lands on the
   * cycle it was stamped with, wherever that falls inside a sample. Pass null
   * for `right` to render mono.
   */
  render(left: Float32Array, right: Float32Array | null, startSample: number) {
    const n = left.length;
    if (startSample !== this.nextSample) this.seek(startSample);

    for (let i = 0; i < n; i++) {
      // Advance the chip, averaging over the cycles that make up this sample.
      // Plain decimation would alias harshly; the box filter keeps the grit
      // without the artefacts.
      let sum = 0;
      let count = 0;
      this.remainder += CPU_HZ;
      while (this.remainder >= this.sampleRate) {
        this.remainder -= this.sampleRate;
        // A write lands on its cycle, before that cycle is clocked.
        while (this.events.length > 0 && this.events[0].at <= this.cycle) {
          const ev = this.events[0];
          this.events.shift();
          this.applyEvent(ev);
        }
        this.clockCPU();
        this.cycle++;
        sum +=
          mixPulses(this.pulse1.output(), this.pulse2.output()) +
          mixTND(this.triangle.output(), this.noise.output(), 0);
        count++;
      }
      let sample = count > 0 ? sum / count : 0;

      // Analog output stage: two high-pass sections and one low-pass.
      const hp90Out = this.hp90Coef * (this.hp90 + sample - this.lastIn90);
      this.lastIn90 = sample;
      this.hp90 = hp90Out;
      sample = hp90Out;

      const hp440Out = this.hp440Coef * (this.hp440 + sample - this.lastIn440);
      this.lastIn440 = sample;
      this.hp440 = hp440Out;
      sample = hp440Out;

      this.lp14k += this.lpCoef * (sample - this.lp14k);
      sample = this.lp14k;

      // The mixer tops out near 0.63 and the two high-pass sections eat a lot of
      // low end, so normalise back up with headroom left for peaks.
      const v = Math.max(-1, Math.min(1, sample * this.masterGain * 2.9));
      left[i] = v;
      if (right) right[i] = v;
    }
    this.nextSample = startSample + n;
  }

  /**
   * Re-derives the cycle clock from a sample position: the whole cycles that
   * fit before it, and how far into the next one the sample clock has got.
   * `sample * CPU_HZ` is an exact integer, so one second of samples lands on
   * exactly CPU_HZ cycles rather than a float's idea of it.
   */
  private seek(sample: number) {
    const scaled = sample * CPU_HZ;
    this.cycle = Math.floor(scaled / this.sampleRate);
    this.remainder = scaled - this.cycle * this.sampleRate;
  }

  /** Queues register writes. Each one is applied at the sample it names. */
  schedule(events: RegisterEvent[]) {
    for (const ev of events) this.events.push(ev);
    // Keep the queue ordered; scheduling can interleave.
    this.events.sort((a, b) => a.at - b.at);
  }

  setGain(value: number) {
    this.masterGain = value;
  }

  /** Silences every voice and drops anything still queued. */
  reset() {
    this.events.length = 0;
    this.silence();
  }
}
