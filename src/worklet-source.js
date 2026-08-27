/**
 * A cycle-driven emulation of the Ricoh 2A03 APU, running in an AudioWorklet.
 *
 * Web Audio's PeriodicWave is band-limited: it anti-aliases, which is precisely
 * why oscillator-based "chiptune" sounds too clean. This does what the chip did
 * instead - step 8-entry duty sequences and a 15-bit LFSR at the APU clock, mix
 * them through the hardware's non-linear DAC curves, then run the three analog
 * filters that give the NES its boxy voice.
 *
 * Register writes arrive as timestamped events and are applied sample-exactly,
 * so slides and arpeggios land on the frame they were scheduled for.
 */

const CPU_HZ = 1789773; // NTSC
const APU_HZ = CPU_HZ / 2;

// Duty sequences, straight from the hardware. Entry 3 is 25% inverted, which is
// why it sounds identical to entry 1.
const DUTY = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
];

// The 32-step triangle sequence: 15 down to 0, then back up.
const TRIANGLE_SEQ = [];
for (let i = 15; i >= 0; i--) TRIANGLE_SEQ.push(i);
for (let i = 0; i <= 15; i++) TRIANGLE_SEQ.push(i);

// NTSC noise periods, in CPU cycles.
const NOISE_PERIODS = [
  4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068,
];

// Length counter table, indexed by the 5-bit load value.
const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
];

class Envelope {
  constructor() {
    this.start = false;
    this.loop = false;
    this.constant = true;
    this.volume = 0; // doubles as the divider period
    this.decay = 0;
    this.divider = 0;
  }

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

  output() {
    return this.constant ? this.volume : this.decay;
  }
}

class Pulse {
  constructor(channel) {
    this.channel = channel; // 1 or 2; affects the sweep's negate behaviour
    this.enabled = false;
    this.duty = 0;
    this.step = 0;
    this.timer = 0;
    this.period = 0;
    this.env = new Envelope();
    this.lengthCounter = 0;
    this.lengthHalt = false;
    this.sweepEnabled = false;
    this.sweepPeriod = 0;
    this.sweepNegate = false;
    this.sweepShift = 0;
    this.sweepDivider = 0;
    this.sweepReload = false;
  }

  clock() {
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    this.timer = this.period;
    this.step = (this.step + 1) & 7;
  }

  targetPeriod() {
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

  output() {
    if (!this.enabled || this.lengthCounter === 0) return 0;
    // Periods under 8 are muted by the hardware, and so is an overflowing sweep.
    if (this.period < 8 || this.targetPeriod() > 0x7ff) return 0;
    return DUTY[this.duty][this.step] ? this.env.output() : 0;
  }
}

class Triangle {
  constructor() {
    this.enabled = false;
    this.timer = 0;
    this.period = 0;
    this.step = 0;
    this.lengthCounter = 0;
    this.lengthHalt = false;
    this.linearCounter = 0;
    this.linearReload = 0;
    this.linearReloadFlag = false;
  }

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

  output() {
    if (!this.enabled) return 0;
    return TRIANGLE_SEQ[this.step];
  }
}

class Noise {
  constructor() {
    this.enabled = false;
    this.shift = 1;
    this.mode = false;
    this.timer = 0;
    this.period = NOISE_PERIODS[0];
    this.env = new Envelope();
    this.lengthCounter = 0;
    this.lengthHalt = false;
  }

  clock() {
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    this.timer = this.period;
    // Bit 6 in short mode shortens the sequence to 93 steps: metallic, not hiss.
    const tap = this.mode ? (this.shift >> 6) & 1 : (this.shift >> 1) & 1;
    const feedback = (this.shift & 1) ^ tap;
    this.shift = (this.shift >> 1) | (feedback << 14);
  }

  output() {
    if (!this.enabled || this.lengthCounter === 0) return 0;
    return this.shift & 1 ? 0 : this.env.output();
  }
}

/** Hardware DAC curves. Both are non-linear, and both matter. */
function mixPulses(p1, p2) {
  const sum = p1 + p2;
  return sum === 0 ? 0 : 95.88 / (8128 / sum + 100);
}

function mixTND(triangle, noise, dmc) {
  const denom = triangle / 8227 + noise / 12241 + dmc / 22638;
  return denom === 0 ? 0 : 159.79 / (1 / denom + 100);
}

class APUProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pulse1 = new Pulse(1);
    this.pulse2 = new Pulse(2);
    this.triangle = new Triangle();
    this.noise = new Noise();

    this.cyclesPerSample = CPU_HZ / sampleRate;
    this.cycleAcc = 0;
    this.apuToggle = false;

    // Frame counter: quarter frames at ~240 Hz drive envelopes, half frames at
    // ~120 Hz drive length counters and sweeps.
    this.frameCycles = 0;
    this.frameStep = 0;

    // The three analog filters, as one-pole sections.
    this.hp90 = 0;
    this.hp440 = 0;
    this.lp14k = 0;
    this.hp90Coef = Math.exp((-2 * Math.PI * 90) / sampleRate);
    this.hp440Coef = Math.exp((-2 * Math.PI * 440) / sampleRate);
    this.lpCoef = 1 - Math.exp((-2 * Math.PI * 14000) / sampleRate);
    this.lastIn90 = 0;
    this.lastIn440 = 0;

    this.events = [];
    this.masterGain = 1;

    this.port.onmessage = (e) => {
      const data = e.data;
      if (data.type === "events") {
        for (const ev of data.events) this.events.push(ev);
        // Keep the queue ordered; scheduling can interleave.
        this.events.sort((a, b) => a.at - b.at);
      } else if (data.type === "gain") {
        this.masterGain = data.value;
      } else if (data.type === "reset") {
        this.events.length = 0;
        this.silence();
      }
    };
  }

  silence() {
    for (const ch of [this.pulse1, this.pulse2, this.noise]) {
      ch.lengthCounter = 0;
      ch.enabled = false;
    }
    this.triangle.enabled = false;
    this.triangle.lengthCounter = 0;
  }

  /**
   * Applies one scheduled command. These stand in for register writes; the
   * fields map one-to-one onto $4000-$400F.
   */
  applyEvent(ev) {
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
          ch.enabled = false;
          return;
        }
        ch.enabled = true;
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
        if (ev.periodIndex !== undefined) {
          ch.period = NOISE_PERIODS[Math.max(0, Math.min(15, ev.periodIndex | 0))];
        }
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

    // 4-step frame sequence at 240 Hz.
    this.frameCycles++;
    if (this.frameCycles >= 7457) {
      this.frameCycles -= 7457;
      this.frameStep = (this.frameStep + 1) & 3;
      this.clockQuarterFrame();
      if (this.frameStep === 1 || this.frameStep === 3) this.clockHalfFrame();
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out.length > 1 ? out[1] : null;
    const n = left.length;

    // currentFrame is the context-wide sample clock, so scheduling from the main
    // thread lines up exactly with ctx.currentTime.
    for (let i = 0; i < n; i++) {
      const now = currentFrame + i;

      // Apply everything scheduled for this sample.
      while (this.events.length > 0 && this.events[0].at <= now) {
        this.applyEvent(this.events.shift());
      }

      // Advance the chip, averaging over the cycles that make up this sample.
      // Plain decimation would alias harshly; the box filter keeps the grit
      // without the artefacts.
      let sum = 0;
      let count = 0;
      this.cycleAcc += this.cyclesPerSample;
      while (this.cycleAcc >= 1) {
        this.cycleAcc -= 1;
        this.clockCPU();
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

    return true;
  }
}

registerProcessor("apu-processor", APUProcessor);
