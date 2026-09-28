import type { DigitalChip, RegisterEvent } from "../chip.js";
import { EventQueue } from "../event-queue.js";

/**
 * General Instrument's AY-3-8910 and Yamaha's YM2149F: three tone
 * generators, one shared 17-bit noise generator and one shared envelope
 * generator, mixed through a per-channel AND gate. Standalone and
 * host-agnostic - no CPU address decode, no DAC curve, no mixing with
 * another chip - so it is reusable wherever this family of PSG shows up
 * next: the Sunsoft 5B (`chips/nes/sunsoft5b.ts`, this ticket, NEXT-15),
 * later MSX's own AY-3-8910, and the SSG half of the YM2203/YM2608 FM chips
 * (`docs/BACKLOG.md`).
 *
 * Written from nesdev's "Sunsoft 5B audio" page and General Instrument's
 * AY-3-8910/8912/8913 datasheet (see `docs/chips/sunsoft5b.md`'s sources
 * section), never from a reference emulator (decision 41): Game_Music_Emu's
 * `Ay_Apu` and Ayumi are used only to measure this core's output, in
 * `packages/conform`.
 *
 * Register writes address one of 16 internal registers by index (0-15), the
 * chip's own addressing - not a CPU bus address. A host wraps this: the
 * Sunsoft 5B decodes $C000 (register select) and $E000 (register write)
 * into calls to `write(reg, value)`; a future MSX host would decode its own
 * I/O ports the same way.
 *
 * ## What is common to the AY-3-8910 and the YM2149, and what is not
 *
 * Every counter, the noise LFSR, the envelope's 16 shapes and the tone/noise
 * mixer's AND-gate logic are the same hardware on both chips - this is not
 * an assumption made to simplify the model, it is how Ayumi (a dual AY/YM
 * emulator, MIT, see `packages/conform/oracles/ayumi`) itself is built:
 * `ayumi_configure`'s `is_ym` flag selects only which of two DAC lookup
 * tables (`AY_dac_table`/`YM_dac_table` in `ayumi.c`) the chip's raw 5-bit
 * envelope/volume index is read through - every other function (`update_tone`,
 * `update_noise`, `update_envelope`, the mixer's AND gate) runs unconditionally
 * of `is_ym`. Nesdev's own text agrees: "the least significant bit cannot be
 * controlled by the volume register, only used by YM2149F's double-resolution
 * envelope generator" says the envelope generator - the counter - is the same
 * 32-level part on both chips; only the DAC's resolution of it differs. That
 * DAC curve is the analog stage (`docs/CONFORMANCE.md`'s digital/analog
 * split), not this class: `outputs()` below reports the raw index this
 * generator computed (0-31 per channel), the same on an AY-3-8910 or a
 * YM2149 clocked the same way, and a host's analog stage is what turns that
 * into a voltage through whichever DAC curve its own chip actually has.
 * `docs/chips/sunsoft5b.md`'s "Analog stage" section documents the 5B's
 * (YM2149F's) curve; an AY-3-8910 host is not built by this ticket and its
 * own curve is not measured here.
 *
 * What genuinely differs by host, and so is a constructor parameter instead
 * of a hard-coded constant: the prescale divider between the chip's own
 * input clock and the tick every tone/noise/envelope counter advances on.
 * Nesdev states the Sunsoft 5B's tone and noise formula as
 * `Frequency = Clock / (32 * Period)`, "the chip is driven directly by the
 * CPU clock... equivalent to a YM2149F with the SEL pin held low", and
 * derives it as "a counter that counts up every 16th clock" (`prescale`
 * below, defaulting to 16) compared against the period register, toggling
 * and resetting to 0 when it reaches or exceeds it - period 0 behaves as
 * period 1. The envelope's own formula, `Frequency = Clock / (16 * Period)`
 * per ramp step, uses the same prescaled tick with no extra factor (see
 * `tick()`'s own comment for the full derivation and its three-source
 * cross-check).
 */

/** Trace order: the three tone/noise-mixed channels. There is no separate
 * "noise voice" - a real AY/YM has three output pins, each optionally
 * carrying the shared noise generator ANDed in, and that is the voice a
 * conformance harness or a future driver addresses. */
export const AY8910_VOICES = ["a", "b", "c"] as const;

/** Mixer register (R7) bit layout, nesdev's own naming for the 5B's $07:
 * bits 0-2 disable tone on channels A/B/C, bits 3-5 disable noise on the
 * same three, 0 = enabled. Bits 6-7 (I/O port direction) do not apply to
 * the 5B - FME-7 exposes no AY I/O pins - and are ignored here. */
const TONE_DISABLE_SHIFT = 0;
const NOISE_DISABLE_SHIFT = 3;

/**
 * The envelope's 16 shapes, R13's low nibble (`---- CAaH`: bit3 Continue,
 * bit2 Attack, bit1 Alternate, bit0 Hold - nesdev's own bit names for the
 * 5B's $0D, taken as authoritative for this chip; see the sheet's "Where
 * documents disagree" for how this squares with the classic AY-3-8910
 * datasheet's own block diagram, which draws the same four latches without
 * spelling out their bit positions in the diagram text itself).
 *
 * Each shape is two segments; the envelope runs the first until it reaches
 * an end (0 or 31), flips to the second, and repeats forever. A segment is
 * one of four behaviours: slide from 31 down to 0, slide from 0 up to 31,
 * or hold at one end. This table, and `resetSegment`'s rule for which value
 * a new segment starts at, reproduce the widely-documented 10 distinct
 * shapes (continue=0 always ends up silent regardless of the attack
 * direction - a well-known AY/YM quirk, not a simplification made here) and
 * were cross-checked against Ayumi's independent implementation
 * (`ayumi.c`'s `Envelopes[16][2]` table and `reset_segment`) before being
 * written in this form; nothing here is copied from it.
 */
type Segment = "down" | "up" | "holdTop" | "holdBottom";
const ENVELOPE_SHAPES: readonly [Segment, Segment][] = [
  ["down", "holdBottom"], // 0  C0 A0 a0 H0
  ["down", "holdBottom"], // 1  C0 A0 a0 H1
  ["down", "holdBottom"], // 2  C0 A0 a1 H0
  ["down", "holdBottom"], // 3  C0 A0 a1 H1
  ["up", "holdBottom"], // 4  C0 A1 a0 H0
  ["up", "holdBottom"], // 5  C0 A1 a0 H1
  ["up", "holdBottom"], // 6  C0 A1 a1 H0
  ["up", "holdBottom"], // 7  C0 A1 a1 H1
  ["down", "down"], // 8  C1 A0 a0 H0 \\\\
  ["down", "holdBottom"], // 9  C1 A0 a0 H1 \___
  ["down", "up"], // 10 C1 A0 a1 H0 \/\/
  ["down", "holdTop"], // 11 C1 A0 a1 H1 \‾‾‾
  ["up", "up"], // 12 C1 A1 a0 H0 ////
  ["up", "holdTop"], // 13 C1 A1 a0 H1 /‾‾‾
  ["up", "down"], // 14 C1 A1 a1 H0 /\/\
  ["up", "holdBottom"], // 15 C1 A1 a1 H1 /___
];

export interface Ay8910Options {
  /** Chip clocks every tone/noise/envelope counter every `prescale` input
   * clocks. The Sunsoft 5B's own value, per nesdev's "counts up every 16th
   * clock", is the default. */
  prescale?: number;
}

/**
 * The digital chip: sixteen registers in, three channels out, tick by tick.
 *
 * `write`'s `reg` is the chip's own 0-15 register index, matching how the
 * real chip's BC1/BDIR bus protocol (and, on the Sunsoft 5B, the $C000
 * register-select port) work: a register is selected, then written,
 * addressed by index rather than by a CPU memory address.
 */
export class Ay8910 implements DigitalChip {
  readonly voices = AY8910_VOICES;

  /** All 16 registers, raw, for the few that need more than one decoded
   * field (the mixer, the two volume-register bits) and so a host or a test
   * can read back exactly what was last written. */
  readonly regs = new Uint8Array(16);

  private readonly prescale: number;
  private prescaleCounter = 0;

  private readonly tonePeriod = [1, 1, 1];
  private readonly toneCounter = [0, 0, 0];
  private readonly toneBit = [0, 0, 0];

  private noisePeriod = 1;
  private noiseCounter = 0;
  /** The 17-bit LFSR. Nesdev does not state a reset seed; Game_Music_Emu and
   * Ayumi both seed it to 1, which this follows - 0 is a fixed point of the
   * recurrence below and would never produce noise at all. */
  private noiseLfsr = 1;

  private envPeriod = 1;
  private envCounter = 0;
  private envShape = 0;
  private envSegment: 0 | 1 = 0;
  /** 0-31, the envelope generator's own output - the finer, YM2149-style
   * resolution; see the class doc comment for why this is not coarsened for
   * an AY-3-8910 host here. */
  private envPos = 0;

  /** The absolute cycle about to be clocked, same convention as `Vrc6Apu.cycle`. */
  cycle = 0;

  private readonly events = new EventQueue();

  constructor(options: Ay8910Options = {}) {
    this.prescale = options.prescale ?? 16;
  }

  /** A register write, `reg` 0-15. Registers 14/15 (I/O ports A/B) are
   * stored but otherwise unused - the 5B exposes no AY I/O pins. */
  write(reg: number, value: number) {
    if (reg < 0 || reg > 15) return;
    const v = value & 0xff;
    this.regs[reg] = v;
    switch (reg) {
      case 0:
      case 1:
        this.tonePeriod[0] = this.readPeriod12(0, 1);
        return;
      case 2:
      case 3:
        this.tonePeriod[1] = this.readPeriod12(2, 3);
        return;
      case 4:
      case 5:
        this.tonePeriod[2] = this.readPeriod12(4, 5);
        return;
      case 6:
        this.noisePeriod = (v & 0x1f) || 1;
        return;
      case 11:
      case 12:
        this.envPeriod = ((this.regs[11] | (this.regs[12] << 8)) & 0xffff) || 1;
        return;
      case 13:
        // "Writing the shape register resets the envelope" (nesdev). Any
        // write, even the same value again, restarts it from segment 0.
        this.envShape = v & 0x0f;
        this.envCounter = 0;
        this.envSegment = 0;
        this.resetSegment();
        return;
      default:
        return; // 7 (mixer), 8-10 (volume) are read live from `regs` below; 14-15 unused.
    }
  }

  private readPeriod12(lo: number, hi: number): number {
    return ((this.regs[lo] | ((this.regs[hi] & 0x0f) << 8)) & 0xfff) || 1;
  }

  applyEvent(ev: RegisterEvent) {
    this.write(ev.addr, ev.value);
  }

  private resetSegment() {
    const seg = ENVELOPE_SHAPES[this.envShape][this.envSegment];
    this.envPos = seg === "down" || seg === "holdTop" ? 31 : 0;
  }

  private stepEnvelope() {
    const seg = ENVELOPE_SHAPES[this.envShape][this.envSegment];
    if (seg === "down") {
      this.envPos--;
      if (this.envPos < 0) {
        this.envSegment = this.envSegment === 0 ? 1 : 0;
        this.resetSegment();
      }
    } else if (seg === "up") {
      this.envPos++;
      if (this.envPos > 31) {
        this.envSegment = this.envSegment === 0 ? 1 : 0;
        this.resetSegment();
      }
    }
    // holdTop/holdBottom: frozen, nothing to do.
  }

  /**
   * One prescaled tick: every tone/noise/envelope counter that is due fires
   * once. Nesdev's tone/noise formula, `Frequency = Clock / (32 * Period)`,
   * splits as `prescale` (16) times 2 (a full square wave needs two
   * toggles); noise needs the same factor of 2 spelled out explicitly here
   * (`2 * this.noisePeriod`) since one LFSR shift, not two, is a full noise
   * "period" in register terms. The envelope's formula, `Frequency = Clock /
   * (16 * Period)` per ramp step (nesdev, "one ramp-step's frequency"), has
   * no such factor: one step per `envPeriod` prescaled ticks.
   *
   * Cross-checked three ways before being written this way: Ayumi's
   * `update_tone`/`update_noise`/`update_envelope` (`ayumi.c`) compare their
   * counters directly against the raw period register with the same 2x-only
   * -for-noise asymmetry: this function's own tick already runs at the
   * prescaled rate their code assumes. Game_Music_Emu's `Ay_Apu`, which
   * instead models the AY-3-8910's own coarser 16-level-per-segment
   * envelope, ticks each of its 16 steps every `32 * EnvelopePeriod` clocks
   * (`period_factor * 2`, `Ay_Apu.cpp`) - 16 steps of 32 clocks each is the
   * same total ramp duration as this generator's 32 steps of 16 clocks
   * each, `512 * EnvelopePeriod` clocks either way: the AY and the YM2149
   * sound the same envelope frequency for the same period register, just at
   * different step resolutions - which is exactly the difference
   * `docs/chips/sunsoft5b.md` documents rather than treating as a bug in
   * either oracle.
   */
  private tick() {
    for (let ch = 0; ch < 3; ch++) {
      this.toneCounter[ch]++;
      if (this.toneCounter[ch] >= this.tonePeriod[ch]) {
        this.toneCounter[ch] = 0;
        this.toneBit[ch] ^= 1;
      }
    }
    this.noiseCounter++;
    if (this.noiseCounter >= 2 * this.noisePeriod) {
      this.noiseCounter = 0;
      // 17-bit LFSR, Fibonacci form: the new top bit is bit0 XOR bit3 of the
      // *current* register, inserted at bit 16 after a one-place right
      // shift; the output is bit0 of the *new* register (i.e. the old bit1).
      // This is MAME's own `noise_rng_tick()`/`noise_output()`
      // (`src/devices/sound/ay8910.h`, licence BSD-3-Clause, Couriersud;
      // cited and independently re-derived here, never copied):
      //   m_rng = (m_rng >> 1) | ((BIT(m_rng, 0) ^ BIT(m_rng, 3)) << 16);
      //   noise_output() { return m_rng & 1; }
      // MAME's own comment on that function states it plainly: "The Random
      // Number Generator of the 8910 is a 17-bit shift register. The input
      // to the shift register is bit0 XOR bit3 (bit0 is the output). This
      // was verified on AY-3-8910 and YM2149 chips" - the one source here
      // that claims a hardware check on this specific point. It is also
      // exactly Ayumi's construction (`oracles/ayumi/ayumi.c`,
      // `update_noise`: `bit0x3 = (noise ^ (noise >> 3)) & 1; noise =
      // (noise >> 1) | (bit0x3 << 16); return noise & 1;`), independently
      // corroborating it, and confirmed maximal-length (period 131071 =
      // 2^17-1 from seed 1) before being adopted here.
      //
      // An earlier version of this file read nesdev's "taps at bits 16 and
      // 13" as a Galois-form shift register instead (shift right, and where
      // the bit just shifted out was 1, XOR the feedback into both tapped
      // bits at once, `0x12000` = `1<<16 | 1<<13`) and, on review, that
      // reading was wrong: "taps" is Fibonacci vocabulary, nesdev gives no
      // pseudocode to settle it either way, and the Galois form has no
      // source here claiming a hardware check - only Game_Music_Emu's own
      // `Ay_Apu` (`(uMinus(lfsr & 1) & 0x12000) ^ (lfsr >> 1)`,
      // `oracles/game-music-emu/gme/Ay_Apu.cpp`) happens to share it, which
      // is one undocumented emulator against one hardware-verified one. That
      // is why this project's own two oracles disagreed with each other on
      // this generator (`docs/DECISIONS.md`'s decision 48) - not a
      // tolerance question, a wrong construction on this side. See
      // `docs/chips/sunsoft5b.md`'s "Where the two oracles disagree" for the
      // full account, including that Game_Music_Emu's own noise sequence is
      // therefore report-only against this core, not gated exact - it is
      // not this generator's Galois form that was wrong to reject, it is
      // that this core used to share it for the wrong reason.
      const bit0x3 = (this.noiseLfsr ^ (this.noiseLfsr >> 3)) & 1;
      this.noiseLfsr = (this.noiseLfsr >> 1) | (bit0x3 << 16);
    }
    this.envCounter++;
    if (this.envCounter >= this.envPeriod) {
      this.envCounter = 0;
      this.stepEnvelope();
    }
  }

  /** One input-clock cycle - the Sunsoft 5B's own CPU clock, "driven
   * directly" per nesdev. Ticks the prescaled counters once every
   * `prescale` calls; none of the three generators can ever be halted
   * (nesdev is explicit that disabling via the mixer or the volume register
   * only silences the output, it never stops the counting), so there is no
   * enable/disable branch here at all - only `outputs()` gates the result. */
  clock() {
    this.prescaleCounter++;
    if (this.prescaleCounter >= this.prescale) {
      this.prescaleCounter = 0;
      this.tick();
    }
  }

  step() {
    while (this.events.nextAt <= this.cycle) {
      const ev = this.events.take();
      this.applyEvent(ev);
    }
    this.clock();
    this.cycle++;
  }

  /**
   * The three channels' raw 0-31 output index, gated by the mixer's AND
   * logic: `(tone | toneDisabled) & (noise | noiseDisabled)`, 0 silences
   * the channel regardless of its volume or envelope - matching Ayumi's own
   * `update_mixer` (`out = (tone | t_off) & (noise | n_off)`) and
   * Game_Music_Emu's equivalent bit test.
   *
   * A fixed (non-envelope) volume `V` (0-15, register bits 3-0) maps to
   * `2V + 1`, unconditionally - not `V === 0 ? 0 : 2V + 1`. Nesdev's output
   * section: "the least significant bit cannot be controlled by the volume
   * register, it is only used by the YM2149F's double-resolution envelope
   * generator" - the register can only ever address the odd half of the
   * 5-bit index space, `2V + 1`; which constant the fixed low bit actually
   * holds is not stated in that sentence, but the envelope section gives it
   * away: "envelope levels 0 and 1 are both equivalent to volume 0
   * (silent)" pairs the volume register's own V=0 with envelope level *1*,
   * not 0 - only true if the volume register's fixed low bit is 1. Ayumi's
   * `volume * 2 + 1` (and the equivalent in Game_Music_Emu's amplitude
   * path) independently does the same thing, corroborating this. The
   * silence at index 0 and 1 both is not a branch here - it is a property
   * of the DAC lookup table (`SUNSOFT5B_DAC` in `sunsoft5b-core.ts`, whose
   * own doc comment cites the same envelope-section sentence), not the
   * digital index this function reports.
   */
  outputs(into: number[]) {
    for (let ch = 0; ch < 3; ch++) {
      const toneDisabled = (this.regs[7] >> (TONE_DISABLE_SHIFT + ch)) & 1;
      const noiseDisabled = (this.regs[7] >> (NOISE_DISABLE_SHIFT + ch)) & 1;
      const gate = (this.toneBit[ch] | toneDisabled) & (this.noiseLfsr | noiseDisabled) & 1;
      const volReg = this.regs[8 + ch];
      const envelopeOn = (volReg & 0x10) !== 0;
      const ampIndex = envelopeOn ? this.envPos : 2 * (volReg & 0x0f) + 1;
      into[ch] = gate ? ampIndex : 0;
    }
  }

  /** No memory-mapped voice on this chip. */
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

  /** All registers to 0 - the AY-3-8910 datasheet's own documented RESET
   * pin behaviour ("zeroes all registers"), taken as this chip's power-on
   * state. Game_Music_Emu's own `Ay_Apu::reset()` instead sets `regs[7] =
   * 0xFF` (every tone and noise disabled) before its first render; both are
   * silent at cycle 0 either way (an all-zero volume register is silent
   * regardless of the mixer gate - see `outputs()`), so the difference
   * never shows up in a conformance run, but only the all-zero form is
   * actually documented for this chip, so that is what this core does. */
  reset() {
    this.events.clear();
    this.regs.fill(0);
    this.prescaleCounter = 0;
    this.tonePeriod[0] = this.tonePeriod[1] = this.tonePeriod[2] = 1;
    this.toneCounter[0] = this.toneCounter[1] = this.toneCounter[2] = 0;
    this.toneBit[0] = this.toneBit[1] = this.toneBit[2] = 0;
    this.noisePeriod = 1;
    this.noiseCounter = 0;
    this.noiseLfsr = 1;
    this.envPeriod = 1;
    this.envCounter = 0;
    this.envShape = 0;
    this.envSegment = 0;
    this.resetSegment();
    this.cycle = 0;
  }
}
