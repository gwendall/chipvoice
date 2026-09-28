import type { DigitalChip, RegisterEvent } from "../../chip.js";
import { EventQueue } from "../../event-queue.js";

/**
 * Konami's VRC6 expansion audio: two pulse channels and a sawtooth, wired
 * into a cartridge mapper rather than the console's own die.
 *
 * Written from nesdev's "VRC6 audio" wiki page and the VRCVI chip info it
 * cites (see `docs/chips/vrc6.md`'s sources section), never from a reference
 * emulator (decision 41): GME's `Nes_Vrc6_Apu` and Mesen's VRC6 audio class
 * are used only to measure this core's output, in `packages/conform`.
 *
 * Three registers per channel ($9000-$9002 pulse 1, $A000-$A002 pulse 2,
 * $B000-$B002 saw) plus one shared register, $9003, that halts and rescales
 * all three oscillators together. `Vrc6Apu` is the digital chip alone -
 * register writes in, three voice values out, cycle by cycle - the same
 * split `Nes2A03` makes in `dsp.ts`, and for the same reason: this is what a
 * harness compares with an oracle, and mixing it with the 2A03's own output
 * is a separate, analog-stage concern handled in `vrc6-core.ts`.
 */

/** The order `trace` reports voices in: the two pulses, then the saw. */
export const VRC6_VOICES = ["vp1", "vp2", "vsaw"] as const;

/**
 * One pulse channel.
 *
 * The duty cycle generator "takes 16 steps, counting down from 15 to 0.
 * When the current step is less than or equal to the given duty cycle D,
 * the channel volume V is output, otherwise 0" (nesdev, verbatim). That is
 * a literal down-counter, not the 2A03's lookup table, and this implements
 * it as one: `step` counts 15 down to 0 and wraps, `output` compares it to
 * `duty` directly.
 *
 * "When the channel is disabled by clearing the E bit, output is forced to
 * 0, and the duty cycle is immediately reset and halted; it will resume
 * from the beginning when E is once again set." The beginning of a 15-to-0
 * countdown is 15, so `step` is set to 15 on the 0-to-1 edge of `enabled`,
 * and "halted" is literal: `clockDivider` below does nothing at all while
 * `enabled` is false, so `timer` freezes along with `step` rather than
 * free-running. This is the pulse's own stated behavior, not the saw's -
 * the saw section says plainly that ITS divider keeps running through a
 * disable ("clearing E does not reset the frequency divider, however"),
 * which is a distinction nesdev draws deliberately, not an omission to fill
 * in by analogy. Measuring against Game_Music_Emu's `Nes_Vrc6_Apu`
 * (`packages/conform`) corroborates this: its duty phase does not move at
 * all while the channel's effective volume is zero, which disabling
 * produces there too.
 */
class Vrc6Pulse {
  /** 0-15, register bits 3-0. */
  volume = 0;
  /** 0-7, register bits 6-4. */
  duty = 0;
  /** Register bit 7: ignore the duty generator, output `volume` always. */
  mode = false;
  /** The E bit of the period-high register. */
  enabled = false;
  /** The 12-bit period, unshifted by $9003's frequency scaling. */
  periodReg = 0;
  timer = 0;
  /** 15 down to 0, wrapping. Whatever it holds when disabled reads as 0
   * output regardless, per `output()`. */
  step = 15;

  writeControl(v: number) {
    this.mode = (v & 0x80) !== 0;
    this.duty = (v >> 4) & 7;
    this.volume = v & 15;
  }

  writePeriodLow(v: number) {
    this.periodReg = (this.periodReg & 0xf00) | v;
  }

  writePeriodHigh(v: number) {
    const wasEnabled = this.enabled;
    this.enabled = (v & 0x80) !== 0;
    this.periodReg = (this.periodReg & 0xff) | ((v & 0x0f) << 8);
    if (this.enabled && !wasEnabled) this.step = 15;
  }

  /** One firing of the (possibly rescaled) 12-bit divider: `f = CPU / (16 * (t + 1))`
   * while enabled. Disabled, this does nothing - "halted" per the class doc comment. */
  clockDivider(shift: number) {
    if (!this.enabled) return;
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    this.timer = this.periodReg >> shift;
    this.step = this.step === 0 ? 15 : this.step - 1;
  }

  output(): number {
    if (!this.enabled) return 0;
    if (this.mode) return this.volume;
    return this.step <= this.duty ? this.volume : 0;
  }
}

/**
 * The sawtooth channel.
 *
 * The 12-bit divider fires every `(t + 1)` cycles, same as a pulse, but
 * "the accumulator only reacts on every 2 clocks": every other firing is a
 * no-op. Of the firings that do act, six add the 6-bit rate `A` to an 8-bit
 * accumulator and the seventh resets it to 0 - nesdev's own worked table
 * (A = $08) is reproduced exactly by this: `subPhase` starts `true` so the
 * very first firing is the documented "odd step, do nothing", and `stepCount`
 * counts the six adds before the reset.
 *
 * `A` above 42 (`floor(255 / 6)`) overflows the 8-bit accumulator before the
 * reset fires, producing a non-monotonic ramp - nesdev's "distorted sound".
 * Nothing special is coded for it: `(accumulator + rate) & 0xff` already
 * wraps, which is all the overflow is.
 *
 * "If E is clear, the accumulator is forced to zero until E is again set."
 * That is stronger than the pulse's single edge-triggered reset, so `act()`
 * re-zeroes the accumulator on every acting firing while disabled, not just
 * once - and, per the same "clearing E does not reset the frequency
 * divider, however, so the first step of the reset saw may appear
 * shortened" sentence, `subPhase` keeps alternating through a disable, so
 * the firing immediately after E is set again is whichever parity the
 * divider happened to be on, not always a fresh "add".
 */
class Vrc6Saw {
  /** 0-63, register bits 5-0 ("Accumulator Rate"). */
  rate = 0;
  enabled = false;
  periodReg = 0;
  timer = 0;
  /** Alternates every firing; only a `true` result runs `act()`. */
  subPhase = true;
  accumulator = 0;
  /** 0-6: how many of the six adds have landed since the last reset. */
  stepCount = 0;

  writeRate(v: number) {
    this.rate = v & 0x3f;
  }

  writePeriodLow(v: number) {
    this.periodReg = (this.periodReg & 0xf00) | v;
  }

  writePeriodHigh(v: number) {
    this.enabled = (v & 0x80) !== 0;
    this.periodReg = (this.periodReg & 0xff) | ((v & 0x0f) << 8);
  }

  clockDivider(shift: number) {
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    this.timer = this.periodReg >> shift;
    this.subPhase = !this.subPhase;
    if (this.subPhase) this.act();
  }

  private act() {
    if (!this.enabled) {
      this.accumulator = 0;
      this.stepCount = 0;
      return;
    }
    if (this.stepCount >= 6) {
      this.accumulator = 0;
      this.stepCount = 0;
    } else {
      this.accumulator = (this.accumulator + this.rate) & 0xff;
      this.stepCount++;
    }
  }

  /** The high 5 bits of the 8-bit accumulator. */
  output(): number {
    return this.enabled ? this.accumulator >> 3 : 0;
  }
}

/**
 * The digital chip: three voices, register writes in, values out.
 *
 * $9003 is shared by all three oscillators (nesdev: "H - halts all
 * oscillators... B - 16x frequency, all oscillators... A - 256x frequency,
 * all oscillators", "the halt flag overrides the other flags", "the 256x
 * flag overrides the 16x flag", "the 16x/256x flags effectively control a
 * 4-bit and 8-bit right shift of the 12-bit period registers"). `halted`
 * stops every divider from firing at all - registers can still be written,
 * only the internal clocking pauses, matching "stopping them in their
 * current state" - and `shiftAmount()` is applied to every channel's raw
 * period wherever it is used to reload a divider.
 */
export class Vrc6Apu implements DigitalChip {
  readonly voices = VRC6_VOICES;
  pulse1 = new Vrc6Pulse();
  pulse2 = new Vrc6Pulse();
  saw = new Vrc6Saw();
  halted = false;
  shift16 = false;
  shift256 = false;

  /** The absolute cycle about to be clocked, same convention as `Nes2A03.cycle`. */
  cycle = 0;

  private readonly events = new EventQueue();

  /**
   * A register write, `$9000-$9003`, `$A000-$A002` or `$B000-$B002`.
   *
   * The PPU-banking bit at `$B003` is not sound and is not decoded here;
   * this core only ever sees the addresses `packages/conform` and the NSF
   * player route to it.
   */
  write(addr: number, value: number) {
    const v = value & 0xff;
    switch (addr) {
      case 0x9000:
        this.pulse1.writeControl(v);
        return;
      case 0x9001:
        this.pulse1.writePeriodLow(v);
        return;
      case 0x9002:
        this.pulse1.writePeriodHigh(v);
        return;
      case 0x9003:
        this.halted = (v & 0x01) !== 0;
        this.shift16 = (v & 0x02) !== 0;
        this.shift256 = (v & 0x04) !== 0;
        return;
      case 0xa000:
        this.pulse2.writeControl(v);
        return;
      case 0xa001:
        this.pulse2.writePeriodLow(v);
        return;
      case 0xa002:
        this.pulse2.writePeriodHigh(v);
        return;
      case 0xb000:
        this.saw.writeRate(v);
        return;
      case 0xb001:
        this.saw.writePeriodLow(v);
        return;
      case 0xb002:
        this.saw.writePeriodHigh(v);
        return;
      default:
        return;
    }
  }

  /** 0 normally, 4 under the 16x flag, 8 under the 256x flag (which overrides it). */
  private shiftAmount(): number {
    if (this.shift256) return 8;
    if (this.shift16) return 4;
    return 0;
  }

  applyEvent(ev: RegisterEvent) {
    this.write(ev.addr, ev.value);
  }

  /** One CPU cycle: all three oscillators run off the same clock, unshared with the 2A03's own APU divide-by-2. */
  clockCPU() {
    if (this.halted) return;
    const shift = this.shiftAmount();
    this.pulse1.clockDivider(shift);
    this.pulse2.clockDivider(shift);
    this.saw.clockDivider(shift);
  }

  step() {
    while (this.events.nextAt <= this.cycle) {
      const ev = this.events.take();
      this.applyEvent(ev);
    }
    this.clockCPU();
    this.cycle++;
  }

  /** The three voices: two 4-bit pulse levels and the saw's 5-bit level. */
  outputs(into: number[]) {
    into[0] = this.pulse1.output();
    into[1] = this.pulse2.output();
    into[2] = this.saw.output();
  }

  /** No memory-mapped voice on the VRC6's audio side. */
  load(_address: number, _bytes: Uint8Array) {}

  schedule(events: RegisterEvent[]) {
    this.events.schedule(events);
  }
  cancel(owner: string, from: number) {
    this.events.cancel(owner, from);
  }

  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    const last = [0, 0, 0];
    const now = [0, 0, 0];
    for (let i = 0; i < cycles; i++) {
      const cycle = this.cycle;
      this.step();
      this.outputs(now);
      for (let v = 0; v < 3; v++) {
        if (now[v] !== last[v]) {
          last[v] = now[v];
          onChange(cycle, v, now[v]);
        }
      }
    }
  }

  reset() {
    this.events.clear();
    this.pulse1 = new Vrc6Pulse();
    this.pulse2 = new Vrc6Pulse();
    this.saw = new Vrc6Saw();
    this.halted = false;
    this.shift16 = false;
    this.shift256 = false;
  }
}
