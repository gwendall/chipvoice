/**
 * A clock-driven emulation of the Ricoh 2A03 APU.
 *
 * Web Audio's PeriodicWave is band-limited: it anti-aliases, which is precisely
 * why oscillator-based "chiptune" sounds too clean. This does what the chip did
 * instead - step 8-entry duty sequences and a 15-bit LFSR at the APU clock, mix
 * them through the hardware's non-linear DAC curves, then run the three analog
 * filters that give the NES its boxy voice.
 *
 * Two stages, kept apart because only one of them has a truth to match:
 *
 *  - `Nes2A03` is the digital chip. Byte writes to `$4000-$4017` in, stamped
 *    with the CPU cycle they land on; the value of each voice out, cycle by
 *    cycle. It is a finite state machine, and its output can be compared bit
 *    for bit with a netlist simulation, a logic capture or another emulator.
 *    That comparison is what `trace` is for.
 *  - `NesOutputStage` is everything after: the DAC's mixing curves, the
 *    averaging down to a sample rate, the three filters, the gain. Two real
 *    consoles disagree here, so it is a named profile with a tolerance, not a
 *    truth.
 *
 * `NesApuCore` composes the two behind `ChipCore`. The same module runs in
 * two places: Node imports it, and the worklet gets it bundled with
 * `worklet.ts` into one self-contained script by `scripts/build-worklet.mjs`.
 * The sample clock is a parameter rather than a global: in a worklet it is
 * `currentFrame`, offline it is a counter. That one difference is all that
 * separates real time from a file.
 *
 * What is verified and what is not is on the chip's sheet, `docs/chips/2a03.md`.
 */

import type { ChipCore, DigitalChip, RegisterEvent } from "../../chip.js";

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

/**
 * The two frame sequences, in CPU cycles from the start of a sequence.
 *
 * Every step clocks the envelopes and the linear counter; a `half` step also
 * clocks the length counters and the sweeps. The 4-step sequence is 29830
 * cycles long, which is where 240 Hz and 120 Hz come from; the 5-step one adds
 * a silent step at 29829 and ends at 37282. Both from nesdev.
 */
const FRAME_SEQUENCES = [
  { steps: [7457, 14913, 22371, 29829], half: [false, true, false, true], period: 29830 },
  { steps: [7457, 14913, 22371, 37281], half: [false, true, false, true], period: 37282 },
];

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

/**
 * What a length counter does at the end of a cycle, after the frame counter
 * has had its say.
 *
 * Two of blargg's 2005 measurements: a change to the halt flag written on
 * the same cycle as a length clock takes effect after that clock, not
 * before; and a length reload written on the same cycle as a length clock
 * is ignored when the counter was not zero. So a write to the halt bit or a
 * length load is held here and settled by `settleLength` once the cycle's
 * clocking is done, and `lengthClocked` says whether the clock counted.
 */
interface LengthCounted {
  lengthCounter: number;
  lengthHalt: boolean;
  haltPending: boolean | null;
  lengthPending: number | null;
  lengthClocked: boolean;
}

function settleLength(ch: LengthCounted) {
  if (ch.lengthPending !== null) {
    if (!ch.lengthClocked) ch.lengthCounter = ch.lengthPending;
    ch.lengthPending = null;
  }
  if (ch.haltPending !== null) {
    ch.lengthHalt = ch.haltPending;
    ch.haltPending = null;
  }
  ch.lengthClocked = false;
}

class Pulse implements LengthCounted {
  /** 1 or 2. Affects the sweep's negate behaviour. */
  readonly channel: 1 | 2;
  /** The `$4015` bit. Off, the length counter is 0 and stays 0. */
  enabled = false;
  duty = 0;
  step = 0;
  timer = 0;
  period = 0;
  readonly env = new Envelope();
  lengthCounter = 0;
  lengthHalt = false;
  haltPending: boolean | null = null;
  lengthPending: number | null = null;
  lengthClocked = false;
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

  /**
   * Muted by a length counter at 0, a period under 8, and a sweep target past
   * `$7FF`. The last one is the trap every driver on the hardware learned:
   * with the negate flag clear and no shift, the target is twice the period,
   * so any note at `$400` or above - about G#2 and below - is silent until
   * `$4001` has been written with `$08`.
   */
  output(): number {
    if (!this.enabled || this.lengthCounter === 0) return 0;
    if (this.period < 8 || this.targetPeriod() > 0x7ff) return 0;
    return DUTY[this.duty][this.step] ? this.env.output() : 0;
  }
}

class Triangle implements LengthCounted {
  enabled = false;
  timer = 0;
  period = 0;
  haltPending: boolean | null = null;
  lengthPending: number | null = null;
  lengthClocked = false;
  /**
   * Step 0, which outputs 15, as the hardware powers on. It held 15 until the
   * first note, and a version of this core started at step 15, which outputs
   * 0, to spare every render a DC step through the high-pass filters. Then
   * blargg's mixer test showed why the hardware's position matters: the test
   * walks the triangle from power-on to the sequence's zero and leaves it
   * there, and from the wrong start it lands on 15 instead, which detunes the
   * whole mixing table. The step is the hardware's; the click is the output
   * stage's problem, and it settles its filters on the first sample.
   */
  step = 0;
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

class Noise implements LengthCounted {
  enabled = false;
  shift = 1;
  mode = false;
  timer = 0;
  /** In APU cycles per shift. */
  period = noisePeriod(0);
  readonly env = new Envelope();
  lengthCounter = 0;
  lengthHalt = false;
  haltPending: boolean | null = null;
  lengthPending: number | null = null;
  lengthClocked = false;

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

// DMC rates, NTSC: CPU cycles between output bits, indexed by the 4-bit rate.
const DMC_RATES = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];

/**
 * The delta modulation channel: a 7-bit level that a stream of bits nudges
 * up or down by two, at one of sixteen rates, from bytes it reads out of
 * memory at `$C000` and up. It is what a NES used for drums and speech,
 * and it is the voice this core lacked longest.
 *
 * Two halves, as on the chip. The reader fetches a byte whenever its buffer
 * is empty and bytes remain, restarting the sample if it loops. The output
 * unit takes the buffer as a shift register at the start of each eight-bit
 * cycle, or goes silent for that cycle if there was nothing to take - and
 * silent means the level holds, not that it drops. The level also takes a
 * direct write through `$4011`, which is how a game played PCM through it.
 */
class Dmc {
  irqEnabled = false;
  loop = false;
  /** CPU cycles per output bit. */
  period = DMC_RATES[0];
  timer = 0;
  /** The 7-bit output, which is the voice's value. */
  level = 0;
  sampleAddress = 0xc000;
  sampleLength = 1;
  address = 0;
  bytesRemaining = 0;
  buffer = 0;
  bufferEmpty = true;
  shift = 0;
  bitsRemaining = 8;
  silence = true;
  irq = false;
  readonly memory: Uint8Array;

  constructor(memory: Uint8Array) {
    this.memory = memory;
  }

  /** `$4015` bit 4 set with nothing left to play: the sample starts over. */
  start() {
    this.address = this.sampleAddress;
    this.bytesRemaining = this.sampleLength;
    this.fetch();
  }

  /** The reader: one byte into the buffer, when it is empty and bytes remain. */
  fetch() {
    if (!this.bufferEmpty || this.bytesRemaining === 0) return;
    this.buffer = this.memory[this.address];
    this.address = this.address === 0xffff ? 0x8000 : this.address + 1;
    this.bufferEmpty = false;
    this.bytesRemaining--;
    if (this.bytesRemaining === 0) {
      if (this.loop) {
        this.address = this.sampleAddress;
        this.bytesRemaining = this.sampleLength;
      } else if (this.irqEnabled) {
        this.irq = true;
      }
    }
  }

  /** Runs at the CPU rate; the period is the rate table's, in CPU cycles. */
  clock() {
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    this.timer = this.period - 1;
    if (!this.silence) {
      if (this.shift & 1) {
        if (this.level <= 125) this.level += 2;
      } else if (this.level >= 2) {
        this.level -= 2;
      }
    }
    this.shift >>= 1;
    if (--this.bitsRemaining === 0) {
      this.bitsRemaining = 8;
      if (this.bufferEmpty) {
        this.silence = true;
      } else {
        this.silence = false;
        this.shift = this.buffer;
        this.bufferEmpty = true;
        this.fetch();
      }
    }
  }

  output(): number {
    return this.level;
  }
}

/** The order `trace` reports voices in. */
export const NES_VOICES = ["p1", "p2", "tri", "noi", "dmc"] as const;

/**
 * The digital chip: what can be right or wrong, cycle by cycle.
 *
 * Register writes go in through `write`, or scheduled through `schedule` and
 * applied on their cycle by `step`. The output is the value of each voice,
 * a 4-bit number for the first four and 7 bits for the DMC, read through
 * `outputs`. There is no sample rate here and no analog anywhere: that is
 * `NesOutputStage`'s business, and keeping it out is what lets this be
 * compared with an oracle.
 *
 * The five voices, `write` and the three clock methods are public for the
 * tests, which drive the chip directly and count what the timers do. They are
 * not API.
 */
export class Nes2A03 implements DigitalChip {
  readonly voices = NES_VOICES;
  /**
   * The CPU's address space, as the DMC sees it: 64 KiB, of which the DMC
   * reads `$8000` and up. A cartridge's sample data goes in with `load`.
   * Kept across `reset`, as a cartridge is.
   */
  readonly memory = new Uint8Array(0x10000);
  pulse1 = new Pulse(1);
  pulse2 = new Pulse(2);
  triangle = new Triangle();
  noise = new Noise();
  dmc = new Dmc(this.memory);

  private apuToggle = false;

  /**
   * The absolute CPU cycle about to be clocked. Events are stamped on this
   * clock, so it is what decides when a write lands. The core sets it from the
   * sample clock; a harness just lets it run from 0.
   */
  cycle = 0;

  // The frame counter: which sequence, where in it, and a pending reset from
  // a `$4017` write, which lands 3 or 4 cycles after the write. The IRQ flag
  // is set on the last three cycles of the 4-step sequence unless inhibited,
  // and read back and cleared through `$4015`.
  private frameMode = 0;
  private frameCycles = 0;
  private frameStep = 0;
  private frameResetIn = 0;
  private frameIrqInhibit = false;
  frameIrq = false;
  /** What `$4017` last took: a reset button writes it again. */
  lastFrameWrite = 0;

  private events: RegisterEvent[] = [];

  /**
   * A register write, `$4000` to `$4017`, as the CPU would make it.
   *
   * This is the chip's whole interface. Every field of every unit is set from
   * here and nowhere else, so what the driver can do is exactly what a program
   * on the hardware could do - including the things it could not: a pulse's
   * period high bits change only through `$4003`, which restarts the phase.
   * Reads do not exist; there is no CPU to read.
   */
  write(addr: number, value: number) {
    const v = value & 0xff;
    switch (addr) {
      case 0x4000:
      case 0x4004: {
        const ch = addr === 0x4000 ? this.pulse1 : this.pulse2;
        ch.duty = v >> 6;
        ch.haltPending = (v & 0x20) !== 0;
        ch.env.loop = (v & 0x20) !== 0;
        ch.env.constant = (v & 0x10) !== 0;
        ch.env.volume = v & 15;
        return;
      }
      case 0x4001:
      case 0x4005: {
        const ch = addr === 0x4001 ? this.pulse1 : this.pulse2;
        ch.sweepEnabled = (v & 0x80) !== 0;
        ch.sweepPeriod = (v >> 4) & 7;
        ch.sweepNegate = (v & 0x08) !== 0;
        ch.sweepShift = v & 7;
        ch.sweepReload = true;
        return;
      }
      case 0x4002:
      case 0x4006: {
        const ch = addr === 0x4002 ? this.pulse1 : this.pulse2;
        ch.period = (ch.period & 0x700) | v;
        return;
      }
      case 0x4003:
      case 0x4007: {
        const ch = addr === 0x4003 ? this.pulse1 : this.pulse2;
        ch.period = (ch.period & 0xff) | ((v & 7) << 8);
        if (ch.enabled) ch.lengthPending = LENGTH_TABLE[v >> 3];
        ch.env.start = true;
        // The sequencer restarts at the first step of its duty sequence. The
        // timer is not touched: that is the hardware, and the click it makes.
        ch.step = 0;
        return;
      }
      case 0x4008: {
        this.triangle.haltPending = (v & 0x80) !== 0;
        this.triangle.linearReload = v & 0x7f;
        return;
      }
      case 0x400a: {
        this.triangle.period = (this.triangle.period & 0x700) | v;
        return;
      }
      case 0x400b: {
        const ch = this.triangle;
        ch.period = (ch.period & 0xff) | ((v & 7) << 8);
        if (ch.enabled) ch.lengthPending = LENGTH_TABLE[v >> 3];
        ch.linearReloadFlag = true;
        return;
      }
      case 0x400c: {
        const ch = this.noise;
        ch.haltPending = (v & 0x20) !== 0;
        ch.env.loop = (v & 0x20) !== 0;
        ch.env.constant = (v & 0x10) !== 0;
        ch.env.volume = v & 15;
        return;
      }
      case 0x400e: {
        this.noise.mode = (v & 0x80) !== 0;
        this.noise.period = noisePeriod(v & 15);
        return;
      }
      case 0x400f: {
        const ch = this.noise;
        if (ch.enabled) ch.lengthPending = LENGTH_TABLE[v >> 3];
        ch.env.start = true;
        return;
      }
      case 0x4010: {
        const dmc = this.dmc;
        dmc.irqEnabled = (v & 0x80) !== 0;
        dmc.loop = (v & 0x40) !== 0;
        dmc.period = DMC_RATES[v & 15];
        if (!dmc.irqEnabled) dmc.irq = false;
        return;
      }
      case 0x4011:
        this.dmc.level = v & 0x7f;
        return;
      case 0x4012:
        this.dmc.sampleAddress = 0xc000 + v * 64;
        return;
      case 0x4013:
        this.dmc.sampleLength = v * 16 + 1;
        return;
      case 0x4015: {
        // Enable bits. A cleared bit forces that length counter to 0, and it
        // stays there: loads are ignored until the bit is set again. The DMC's
        // bit restarts its sample when nothing is left to play, and clearing
        // it drops what is left; the byte already in the shift register plays
        // out.
        const units = [this.pulse1, this.pulse2, this.triangle, this.noise];
        for (let i = 0; i < units.length; i++) {
          const on = ((v >> i) & 1) !== 0;
          units[i].enabled = on;
          if (!on) {
            units[i].lengthCounter = 0;
            units[i].lengthPending = null;
          }
        }
        this.dmc.irq = false;
        if ((v & 0x10) !== 0) {
          if (this.dmc.bytesRemaining === 0) this.dmc.start();
        } else {
          this.dmc.bytesRemaining = 0;
        }
        return;
      }
      case 0x4017: {
        // Bit 7 picks the sequence. The reset lands 3 cycles after the write
        // when it fell on an APU cycle and 4 when it fell between two, and in
        // 5-step mode the sequencer is clocked once as it lands. Bit 6
        // inhibits the frame IRQ and clears its flag at once.
        this.lastFrameWrite = v;
        this.frameMode = v >> 7;
        this.frameIrqInhibit = (v & 0x40) !== 0;
        if (this.frameIrqInhibit) this.frameIrq = false;
        this.frameResetIn = this.apuToggle ? 3 : 4;
        return;
      }
      default:
        return;
    }
  }

  /**
   * `$4015` read back: which length counters are running, whether the DMC
   * has bytes left, and the two interrupt flags. Reading clears the frame
   * flag - unless it is being set on this very cycle, which the caller
   * arranges by reading before the cycle is clocked.
   */
  readStatus(): number {
    let v = 0;
    if (this.pulse1.lengthCounter > 0) v |= 0x01;
    if (this.pulse2.lengthCounter > 0) v |= 0x02;
    if (this.triangle.lengthCounter > 0) v |= 0x04;
    if (this.noise.lengthCounter > 0) v |= 0x08;
    if (this.dmc.bytesRemaining > 0) v |= 0x10;
    if (this.frameIrq) v |= 0x40;
    if (this.dmc.irq) v |= 0x80;
    this.frameIrq = false;
    return v;
  }

  /** The interrupt line to a CPU, when there is one: level, from two flags. */
  irqLine(): boolean {
    return (this.frameIrq && !this.frameIrqInhibit) || this.dmc.irq;
  }

  /**
   * The console's reset button, as blargg measured what it does to the APU
   * and his `apu_reset` ROMs check: `$4015` cleared, so every length counter
   * stops; `$4017` written again with what it last had, which restarts the
   * frame sequence; both interrupt flags cleared; and the length counter
   * halt bits of the pulses and the noise cleared - the triangle's control
   * flag is left alone. Registers, memory and the triangle's phase survive.
   */
  resetButton() {
    this.write(0x4015, 0x00);
    this.write(0x4017, this.lastFrameWrite);
    this.frameIrq = false;
    this.dmc.irq = false;
    for (const ch of [this.pulse1, this.pulse2, this.noise]) {
      ch.lengthHalt = false;
      ch.haltPending = null;
      ch.env.loop = false;
    }
  }

  /** Applies a scheduled write. `step`'s one entry into `write`. */
  applyEvent(ev: RegisterEvent) {
    this.write(ev.addr, ev.value);
  }

  clockQuarterFrame() {
    this.pulse1.env.clock();
    this.pulse2.env.clock();
    this.noise.env.clock();
    this.triangle.clockLinear();
  }

  clockHalfFrame() {
    for (const ch of [this.pulse1, this.pulse2, this.noise, this.triangle]) {
      if (!ch.lengthHalt && ch.lengthCounter > 0) {
        ch.lengthCounter--;
        ch.lengthClocked = true;
      }
    }
    this.pulse1.clockSweep();
    this.pulse2.clockSweep();
  }

  /** One CPU cycle. The APU units run at half that, except the triangle and the DMC. */
  clockCPU() {
    this.triangle.clock();
    this.dmc.clock();
    this.apuToggle = !this.apuToggle;
    if (this.apuToggle) {
      this.pulse1.clock();
      this.pulse2.clock();
      this.noise.clock();
    }

    if (this.frameResetIn > 0 && --this.frameResetIn === 0) {
      this.frameCycles = 0;
      this.frameStep = 0;
      if (this.frameMode === 1) {
        this.clockQuarterFrame();
        this.clockHalfFrame();
      }
      this.settle();
      return;
    }

    // The frame sequence. Half frames on the second and fourth steps: an
    // earlier version fired them on the first and third, which put every
    // length counter and sweep a quarter frame early.
    const sequence = FRAME_SEQUENCES[this.frameMode];
    this.frameCycles++;
    if (this.frameStep < 4 && this.frameCycles === sequence.steps[this.frameStep]) {
      this.clockQuarterFrame();
      if (sequence.half[this.frameStep]) this.clockHalfFrame();
      this.frameStep++;
    }
    // The frame IRQ flag: the last three cycles of the 4-step sequence.
    if (this.frameMode === 0 && !this.frameIrqInhibit && this.frameCycles >= sequence.period - 2) {
      this.frameIrq = true;
    }
    if (this.frameCycles >= sequence.period) {
      this.frameCycles = 0;
      this.frameStep = 0;
    }
    this.settle();
  }

  /** The end of a cycle: held halt bits and length loads land. */
  private settle() {
    settleLength(this.pulse1);
    settleLength(this.pulse2);
    settleLength(this.triangle);
    settleLength(this.noise);
  }

  /**
   * One cycle of the chip: the writes due on it land, before it is clocked,
   * then it is clocked, then the count advances.
   */
  step() {
    while (this.events.length > 0 && this.events[0].at <= this.cycle) {
      const ev = this.events[0];
      this.events.shift();
      this.applyEvent(ev);
    }
    this.clockCPU();
    this.cycle++;
  }

  /** The five voices, now: four 4-bit values and the DMC's 7-bit level. */
  outputs(into: number[]) {
    into[0] = this.pulse1.output();
    into[1] = this.pulse2.output();
    into[2] = this.triangle.output();
    into[3] = this.noise.output();
    into[4] = this.dmc.output();
  }

  /** Puts bytes into the CPU's address space, for the DMC to read. */
  load(address: number, bytes: Uint8Array) {
    this.memory.set(bytes.subarray(0, Math.max(0, 0x10000 - address)), address);
  }

  /** Queues register writes. Each one is applied at the cycle it names. */
  schedule(events: RegisterEvent[]) {
    for (const ev of events) this.events.push(ev);
    // Keep the queue ordered; scheduling can interleave. The sort is stable,
    // so two writes on the same cycle land in the order they were queued.
    this.events.sort((a, b) => a.at - b.at);
  }

  /**
   * Runs `cycles` cycles from where the chip is, and reports each change of a
   * voice's value as it happens. Every voice starts from 0, so a voice that
   * is not 0 on the first cycle is reported there.
   *
   * A list of changes is the compact form of the per-cycle output and says
   * the same thing, and it is what an oracle's amplitude deltas turn into -
   * which is why parity is measured on it.
   */
  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    const last = [0, 0, 0, 0, 0];
    const now = [0, 0, 0, 0, 0];
    for (let i = 0; i < cycles; i++) {
      const cycle = this.cycle;
      this.step();
      this.outputs(now);
      for (let v = 0; v < 5; v++) {
        if (now[v] !== last[v]) {
          last[v] = now[v];
          onChange(cycle, v, now[v]);
        }
      }
    }
  }

  /**
   * Power-on: every unit fresh, `$4015` and `$4017` at zero, nothing queued.
   * The cycle count is left alone; it belongs to whoever is driving the chip.
   * So is the memory: a reset does not empty a cartridge.
   */
  reset() {
    this.events.length = 0;
    this.pulse1 = new Pulse(1);
    this.pulse2 = new Pulse(2);
    this.triangle = new Triangle();
    this.noise = new Noise();
    this.dmc = new Dmc(this.memory);
    this.apuToggle = false;
    this.frameMode = 0;
    this.frameCycles = 0;
    this.frameStep = 0;
    this.frameResetIn = 0;
    this.frameIrqInhibit = false;
    this.frameIrq = false;
    this.lastFrameWrite = 0;
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
 * What a console does to the chip's output on its way to the jack.
 *
 * Named, because no two consoles do the same thing: the corner frequencies
 * below are nesdev's approximations for a front-loading NES and nothing has
 * been measured yet. The sheet's analog section is where a profile earns a
 * tolerance against a real unit.
 */
export interface OutputProfile {
  name: string;
  /** Two first-order high-pass sections, in Hz. */
  highPassHz: [number, number];
  /** One first-order low-pass section, in Hz. */
  lowPassHz: number;
  /**
   * Make-up gain after the filters. The mixer tops out near 0.63 and the two
   * high-pass sections eat a lot of low end; this brings it back with room
   * for peaks. Not hardware, and to be replaced by a measured level.
   */
  gain: number;
}

export const NESDEV_PROFILE: OutputProfile = {
  name: "nesdev",
  highPassHz: [90, 440],
  lowPassHz: 14000,
  gain: 2.9,
};

/**
 * The analog stage: the DAC curves, the averaging down to a sample rate, the
 * filters, the gain.
 *
 * One sample is built by `begin`, then `add` once per CPU cycle with the
 * voices' values, then `end`. Averaging over the cycles that make up a sample
 * is a box filter: plain decimation would alias harshly, and this keeps the
 * grit without the artefacts. It is not band-limited, and the sheet says so.
 */
export class NesOutputStage {
  readonly profile: OutputProfile;
  private sum = 0;
  private count = 0;
  /**
   * Whether the filters have seen a sample. On the first one they are set
   * to the state they would have reached on a steady input at that level, so
   * a chip that powers on with a DC level - the triangle outputs 15 until its
   * first note - does not put a step through the high-pass sections. A
   * console that has been on for a second is in the same state.
   */
  private primed = false;

  // The three filters, as one-pole sections, and their state.
  private readonly hp1Coef: number;
  private readonly hp2Coef: number;
  private readonly lpCoef: number;
  private hp1 = 0;
  private hp2 = 0;
  private lp = 0;
  private lastIn1 = 0;
  private lastIn2 = 0;

  constructor(sampleRate: number, profile: OutputProfile = NESDEV_PROFILE) {
    this.profile = profile;
    this.hp1Coef = Math.exp((-2 * Math.PI * profile.highPassHz[0]) / sampleRate);
    this.hp2Coef = Math.exp((-2 * Math.PI * profile.highPassHz[1]) / sampleRate);
    this.lpCoef = 1 - Math.exp((-2 * Math.PI * profile.lowPassHz) / sampleRate);
  }

  begin() {
    this.sum = 0;
    this.count = 0;
  }

  /** One cycle's worth of the five voices, through the DAC curves. */
  add(p1: number, p2: number, triangle: number, noise: number, dmc: number) {
    this.sum += mixPulses(p1, p2) + mixTND(triangle, noise, dmc);
    this.count++;
  }

  /** The sample: the average, filtered, scaled by `gain`, clamped. */
  end(gain: number): number {
    let sample = this.count > 0 ? this.sum / this.count : 0;
    if (!this.primed) {
      this.primed = true;
      this.lastIn1 = sample;
    }

    const hp1Out = this.hp1Coef * (this.hp1 + sample - this.lastIn1);
    this.lastIn1 = sample;
    this.hp1 = hp1Out;
    sample = hp1Out;

    const hp2Out = this.hp2Coef * (this.hp2 + sample - this.lastIn2);
    this.lastIn2 = sample;
    this.hp2 = hp2Out;
    sample = hp2Out;

    this.lp += this.lpCoef * (sample - this.lp);
    sample = this.lp;

    return Math.max(-1, Math.min(1, sample * gain * this.profile.gain));
  }
}

/**
 * The chip and its output stage, behind `ChipCore`: the thing the worklet and
 * the offline renderer drive.
 *
 * It owns the one piece of state neither stage has, the relation between the
 * sample clock and the cycle clock.
 */
export class NesApuCore implements ChipCore {
  readonly sampleRate: number;
  readonly chip = new Nes2A03();
  readonly stage: NesOutputStage;

  /**
   * Where the cycle clock stands against the sample clock, in integers.
   *
   * `chip.cycle` is the absolute CPU cycle about to be clocked, counted from
   * sample 0. `remainder` is how far the sample clock has got into that cycle,
   * in units of one sample rate: each sample adds CPU_HZ to it and clocks a
   * cycle for every whole sample rate it holds. Exact arithmetic, so the two
   * clocks cannot drift apart over a long render the way a floating
   * accumulator would let them.
   *
   * `nextSample` is where the last block ended. When a caller renders from
   * somewhere else - the first block, or a worklet that came up with the
   * context already running - both are re-derived from the sample position
   * rather than carried on from a place the chip never was.
   */
  private remainder = 0;
  private nextSample = -1;
  private masterGain = 1;
  private readonly voices = [0, 0, 0, 0, 0];

  constructor(sampleRate: number, profile: OutputProfile = NESDEV_PROFILE) {
    this.sampleRate = sampleRate;
    this.stage = new NesOutputStage(sampleRate, profile);
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

    const chip = this.chip;
    const stage = this.stage;
    const voices = this.voices;
    for (let i = 0; i < n; i++) {
      stage.begin();
      this.remainder += CPU_HZ;
      while (this.remainder >= this.sampleRate) {
        this.remainder -= this.sampleRate;
        chip.step();
        chip.outputs(voices);
        stage.add(voices[0], voices[1], voices[2], voices[3], voices[4]);
      }
      const v = stage.end(this.masterGain);
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
    this.chip.cycle = Math.floor(scaled / this.sampleRate);
    this.remainder = scaled - this.chip.cycle * this.sampleRate;
  }

  schedule(events: RegisterEvent[]) {
    this.chip.schedule(events);
  }

  load(address: number, bytes: Uint8Array) {
    this.chip.load(address, bytes);
  }

  setGain(value: number) {
    this.masterGain = value;
  }

  /**
   * Power-on for the chip. The clocks and the filters are left alone: the
   * sample clock did not stop, and zeroing a filter is a step through the
   * high-pass sections.
   */
  reset() {
    this.chip.reset();
  }
}
