import { forkState } from "../../checkpoint.js";
import type {
  ChipCore,
  ChipSpec,
  DigitalChip,
  RegisterEvent,
} from "../../chip.js";
import { CPU_HZ, Nes2A03, NES_VOICES } from "./dsp.js";
import { Vrc6Apu, VRC6_VOICES } from "./vrc6.js";

/**
 * A 2A03 with Konami's VRC6 expansion audio wired in, as a Konami cartridge
 * did it: a full, unmodified 2A03 (`Nes2A03`, the same class the plain
 * "2a03" chip uses) plus the three extra voices of `vrc6.ts`, mixed
 * together before the shared output filters.
 *
 * This is deliberately its own module, imported by nothing the plain "2a03"
 * chip reaches. `dsp.ts`, `driver.ts`, `index.ts` and `worklet.ts` are not
 * edited anywhere in this file or by adding it: `git diff` on those four
 * files is empty for the whole change that introduced VRC6, which is the
 * proof that nothing about the plain chip moved. The cost is a duplicated
 * ~30 lines of filter math (`Vrc6MixStage` below, copied from
 * `NesOutputStage` since its fields are private and its `add()` takes a
 * fixed five voices); `test/vrc6.mjs` asserts the duplication stayed
 * faithful by checking that with the VRC6 side silent, this stage produces
 * bit-identical samples to `NesOutputStage` for the same 2A03 register
 * sequence.
 *
 * Registered under a new chip id, `"2a03-vrc6"`, rather than as an option on
 * `"2a03"`: nesdev describes VRC6 as a cartridge mapper's extra voices
 * alongside a full working 2A03, not a variant of the 2A03 itself, and the
 * package's one existing precedent for "the same chip, a different circuit"
 * - the C64's `model: "6581" | "8580"` - is for two DSPs that produce the
 * *same* voice set differently, where VRC6 adds three voices the plain chip
 * does not have. A new id keeps `NES_2A03.voices` and every song written
 * against `"2a03"` untouched, and is how `packages/conform` and the NSF
 * player both already key each chip they know about.
 *
 * This id is not in `CHIP_IDS` (`project-schema.ts`), so it does not reach
 * the studio's project format, its picker, or the arranger's `INTENTS`
 * words - decision 38's "a sheet before a chip" gate. It is fully reachable
 * from the package API below: `chips()`, `getChip("2a03-vrc6")`,
 * `chipFor("2a03-vrc6")` and `Chip.create({ chip: "2a03-vrc6" })` all see
 * it, the same way any other chip is reached from code that does not go
 * through the studio.
 *
 * The `ChipDefinition` itself - the part that needs the bundled worklet
 * string - is assembled in `vrc6-index.ts`, not here, mirroring the plain
 * chip's own `dsp.ts`/`index.ts` split: `vrc6-worklet.ts` imports
 * `Vrc6NesCore` from this file, and this file must never import the
 * generated `vrc6-worklet-inline.ts` back, or bundling it would embed each
 * previous build's output inside the next one.
 */

/** Voice order for the combined digital chip and `ChipSpec`: the 2A03's five, then the VRC6's three. */
export const NES_VRC6_VOICES = [...NES_VOICES, ...VRC6_VOICES] as const;

export const NES_VRC6: ChipSpec = {
  id: "2a03-vrc6",
  name: "Ricoh 2A03 + Konami VRC6",
  system: "NES / Famicom (VRC6 mapper: Akumajou Densetsu, Madara, Esper Dream 2)",
  instruments: "table",
  nativeSampleRate: null,
  clockHz: CPU_HZ,
  voices: [
    { id: "p1", label: "Pulse 1", kind: "pulse", notes: "pitch" },
    { id: "p2", label: "Pulse 2", kind: "pulse", notes: "pitch" },
    { id: "tri", label: "Triangle", kind: "triangle", notes: "pitch" },
    { id: "noi", label: "Noise", kind: "noise", notes: "period" },
    { id: "dmc", label: "DMC", kind: "sample", notes: "sample" },
    // The three VRC6 voices. No instrument or arranger reaches them yet
    // (decision 38): they exist here so the spec, the conform harness and
    // NSF import/export can address them, and a caller can drive them
    // directly through `RegisterEvent`s at $9000-$9003/$A000-$A002/$B000-$B002.
    { id: "vp1", label: "VRC6 Pulse 1", kind: "pulse", notes: "pitch" },
    { id: "vp2", label: "VRC6 Pulse 2", kind: "pulse", notes: "pitch" },
    { id: "vsaw", label: "VRC6 Sawtooth", kind: "wavetable", notes: "pitch" },
  ],
  // Unchanged from the plain 2A03: the VRC6 voices have no role yet.
  roles: { lead: "p1", chord: "p2", bass: "tri", perc: "noi" },
};

/** Whether a CPU address is one of the VRC6's ten sound registers. Exported
 * so the NSF player and exporter (`nsf.ts`) can route by the same rule this
 * core uses to split an event stream between the 2A03 and the VRC6. */
export function isVrc6Addr(addr: number): boolean {
  return (addr >= 0x9000 && addr <= 0x9003) || (addr >= 0xa000 && addr <= 0xa002) || (addr >= 0xb000 && addr <= 0xb002);
}

/**
 * The combined digital chip: dispatches each write to the 2A03 or the VRC6
 * by address and reports all eight voices. Composition only - neither
 * `Nes2A03` nor `Vrc6Apu` is changed to build this.
 */
export class Vrc6NesDigital implements DigitalChip {
  readonly voices = NES_VRC6_VOICES;
  readonly nes = new Nes2A03();
  readonly vrc6 = new Vrc6Apu();

  write(addr: number, value: number) {
    if (isVrc6Addr(addr)) this.vrc6.write(addr, value);
    else this.nes.write(addr, value);
  }

  applyEvent(ev: RegisterEvent) {
    this.write(ev.addr, ev.value);
  }

  load(address: number, bytes: Uint8Array) {
    this.nes.load(address, bytes);
  }

  schedule(events: RegisterEvent[]) {
    const nesEvents = events.filter((e) => !isVrc6Addr(e.addr));
    const vrc6Events = events.filter((e) => isVrc6Addr(e.addr));
    if (nesEvents.length) this.nes.schedule(nesEvents);
    if (vrc6Events.length) this.vrc6.schedule(vrc6Events);
  }

  cancel(owner: string, from: number) {
    this.nes.cancel(owner, from);
    this.vrc6.cancel(owner, from);
  }

  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    const nesLast = [0, 0, 0, 0, 0];
    const nesNow = [0, 0, 0, 0, 0];
    const vrc6Last = [0, 0, 0];
    const vrc6Now = [0, 0, 0];
    for (let i = 0; i < cycles; i++) {
      const cycle = this.nes.cycle;
      this.nes.step();
      this.vrc6.step();
      this.nes.outputs(nesNow);
      for (let v = 0; v < 5; v++) {
        if (nesNow[v] !== nesLast[v]) {
          nesLast[v] = nesNow[v];
          onChange(cycle, v, nesNow[v]);
        }
      }
      this.vrc6.outputs(vrc6Now);
      for (let v = 0; v < 3; v++) {
        if (vrc6Now[v] !== vrc6Last[v]) {
          vrc6Last[v] = vrc6Now[v];
          onChange(cycle, 5 + v, vrc6Now[v]);
        }
      }
    }
  }

  reset() {
    this.nes.reset();
    this.vrc6.reset();
  }
}

/**
 * The mixing level: how much one raw unit of the VRC6's linear 6-bit DAC
 * (two 4-bit pulses plus the saw's 5-bit output, summed - nesdev: "The
 * final mix is a 6-bit DAC summing the two 4-bit pulse outputs and the high
 * 5 bits of the saw accumulator") adds to the composite sample, on the same
 * -1..1 scale `mixPulses`/`mixTND` (`dsp.ts`) produce.
 *
 * Nesdev's only quantitative anchor is qualitative: "At maximum volume, the
 * pulse channels of the VRC6 are roughly equivalent to the pulse channels
 * of the 2A03 (except inverted)." This core turns that into a number by
 * requiring one VRC6 pulse channel alone, at maximum volume (raw 15, the
 * other two VRC6 voices silent), to contribute the same amount a single
 * 2A03 pulse at maximum volume does through the 2A03's own documented DAC
 * curve: `mixPulses(15, 0) = 95.88 / (8128 / 15 + 100)`. Nesdev also says
 * the VRC6's DAC, unlike the 2A03's, is linear, so the same per-unit gain
 * is used across the whole 0-61 raw range rather than curved.
 *
 * `mixPulses(15, 0)` is about 0.1494; divided by 15 raw units gives this
 * constant, about 0.00996 per unit. This is derived only from nesdev's own
 * numbers already in `dsp.ts`, not ported from an oracle (decision 41).
 * Game_Music_Emu's own calibration lands its VRC6-pulse-per-unit gain at
 * roughly 86% of its 2A03-pulse-per-unit gain (`Nes_Vrc6_Apu::volume`
 * against `Nes_Apu::volume`, both in the pinned oracle build) - a rough,
 * independent corroboration of "roughly equivalent" in the same direction,
 * cited here only as a cross-check, not as the source of this number.
 *
 * No cartridge-accurate constant exists: real boards mix VRC6's audio
 * through their own resistor network, and the closest surveyed analogue
 * (Famicom expansion audio mixing resistors, summarised on nesdev's forums)
 * shows values that cluster but are not identical across boards. The sheet
 * (`docs/chips/vrc6.md`) states this plainly rather than implying a
 * hardware-measured figure.
 */
export const VRC6_MIX_UNIT_GAIN = (95.88 / (8128 / 15 + 100)) / 15;

/**
 * The analog stage for the combined chip.
 *
 * Deliberately a near-duplicate of `NesOutputStage` (`dsp.ts`) rather than
 * a subclass or a changed version of it: see the module doc comment for
 * why. Same profile, same three one-pole filter sections, same box-filter
 * averaging down to a sample; `add()` takes the 2A03's five voices plus the
 * VRC6's three and folds the VRC6 term in linearly before the filters, so
 * VRC6 shares the console's own output filtering rather than bypassing it -
 * the only placement nesdev's "audio in" description supports, in the
 * absence of a more specific circuit diagram.
 */
export class Vrc6MixStage {
  private sum = 0;
  private count = 0;
  private primed = false;

  private readonly hp1Coef: number;
  private readonly hp2Coef: number;
  private readonly lpCoef: number;
  private hp1 = 0;
  private hp2 = 0;
  private lp = 0;
  private lastIn1 = 0;
  private lastIn2 = 0;
  readonly gain: number;

  constructor(sampleRate: number, highPassHz: [number, number], lowPassHz: number, gain: number) {
    this.gain = gain;
    this.hp1Coef = Math.exp((-2 * Math.PI * highPassHz[0]) / sampleRate);
    this.hp2Coef = Math.exp((-2 * Math.PI * highPassHz[1]) / sampleRate);
    this.lpCoef = 1 - Math.exp((-2 * Math.PI * lowPassHz) / sampleRate);
  }

  begin() {
    this.sum = 0;
    this.count = 0;
  }

  /** The 2A03's five voices through its own DAC curves, plus the VRC6's raw linear sum, scaled by `VRC6_MIX_UNIT_GAIN`. */
  add(p1: number, p2: number, triangle: number, noise: number, dmc: number, vp1: number, vp2: number, vsaw: number) {
    const nesSum = mixPulsesLocal(p1, p2) + mixTndLocal(triangle, noise, dmc);
    const vrc6Sum = (vp1 + vp2 + vsaw) * VRC6_MIX_UNIT_GAIN;
    this.sum += nesSum + vrc6Sum;
    this.count++;
  }

  end(masterGain: number): number {
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

    return Math.max(-1, Math.min(1, sample * masterGain * this.gain));
  }
}

// Copied from `dsp.ts`'s private `mixPulses`/`mixTND` (nesdev's non-linear
// 2A03 DAC curves) rather than imported: they are not exported, and adding
// an export to `dsp.ts` for this alone would touch the one file this
// change promises not to touch. `test/vrc6.mjs` checks these two stay
// identical to `dsp.ts`'s by comparing `Vrc6MixStage` against
// `NesOutputStage` with the VRC6 side silent.
function mixPulsesLocal(p1: number, p2: number): number {
  const sum = p1 + p2;
  return sum === 0 ? 0 : 95.88 / (8128 / sum + 100);
}

function mixTndLocal(triangle: number, noise: number, dmc: number): number {
  const denom = triangle / 8227 + noise / 12241 + dmc / 22638;
  return denom === 0 ? 0 : 159.79 / (1 / denom + 100);
}

// Same profile numbers as `NESDEV_PROFILE` in `dsp.ts` (also duplicated
// rather than imported, for the same reason as the mix curves above): the
// 2A03 side of this combined chip should sound like the plain 2A03 does,
// and a moved constant here would silently diverge from it.
const HIGH_PASS_HZ: [number, number] = [90, 440];
const LOW_PASS_HZ = 14000;
const PROFILE_GAIN = 2.9;

export const VRC6_PROCESSOR_NAME = "vrc6-apu-processor";

/**
 * The combined `ChipCore`: a `Nes2A03`, a `Vrc6Apu`, and `Vrc6MixStage`
 * between them and the sample clock. Same cycle/sample bookkeeping as
 * `NesApuCore` (`dsp.ts`), duplicated for the same reason as the mix stage.
 */
export class Vrc6NesCore implements ChipCore {
  fork(): Vrc6NesCore { return forkState(this, () => new Vrc6NesCore(this.sampleRate)); }
  readonly sampleRate: number;
  readonly nes = new Nes2A03();
  readonly vrc6 = new Vrc6Apu();
  readonly stage: Vrc6MixStage;

  private remainder = 0;
  private nextSample = -1;
  private masterGain = 1;
  private readonly nesVoices = [0, 0, 0, 0, 0];
  private readonly vrc6Voices = [0, 0, 0];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.stage = new Vrc6MixStage(sampleRate, HIGH_PASS_HZ, LOW_PASS_HZ, PROFILE_GAIN);
  }

  render(left: Float32Array, right: Float32Array | null, startSample: number) {
    const n = left.length;
    if (startSample !== this.nextSample) this.seek(startSample);

    const { nes, vrc6, stage, nesVoices, vrc6Voices } = this;
    for (let i = 0; i < n; i++) {
      stage.begin();
      this.remainder += CPU_HZ;
      while (this.remainder >= this.sampleRate) {
        this.remainder -= this.sampleRate;
        nes.step();
        vrc6.step();
        nes.outputs(nesVoices);
        vrc6.outputs(vrc6Voices);
        stage.add(nesVoices[0], nesVoices[1], nesVoices[2], nesVoices[3], nesVoices[4], vrc6Voices[0], vrc6Voices[1], vrc6Voices[2]);
      }
      const v = stage.end(this.masterGain);
      left[i] = v;
      if (right) right[i] = v;
    }
    this.nextSample = startSample + n;
  }

  private seek(sample: number) {
    const scaled = sample * CPU_HZ;
    const cycle = Math.floor(scaled / this.sampleRate);
    this.nes.cycle = cycle;
    this.vrc6.cycle = cycle;
    this.remainder = scaled - cycle * this.sampleRate;
  }

  schedule(events: RegisterEvent[]) {
    const nesEvents = events.filter((e) => !isVrc6Addr(e.addr));
    const vrc6Events = events.filter((e) => isVrc6Addr(e.addr));
    if (nesEvents.length) this.nes.schedule(nesEvents);
    if (vrc6Events.length) this.vrc6.schedule(vrc6Events);
  }

  cancel(owner: string, from: number) {
    this.nes.cancel(owner, from);
    this.vrc6.cancel(owner, from);
  }

  load(address: number, bytes: Uint8Array) {
    this.nes.load(address, bytes);
  }

  setGain(value: number) {
    this.masterGain = value;
  }

  reset() {
    this.nes.reset();
    this.vrc6.reset();
  }
}
