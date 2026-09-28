import { forkState } from "../../checkpoint.js";
import type {
  ChipCore,
  ChipSpec,
  DigitalChip,
  RegisterEvent,
} from "../../chip.js";
import { CPU_HZ, Nes2A03, NES_VOICES } from "./dsp.js";
import { Sunsoft5bAudio } from "./sunsoft5b.js";

/**
 * A 2A03 with Sunsoft's 5B expansion audio wired in, as the one cartridge
 * that shipped it did: a full, unmodified 2A03 (`Nes2A03`, the same class
 * the plain "2a03" chip uses) plus the three extra voices of
 * `sunsoft5b.ts`, mixed together before the shared output filters.
 *
 * Structured exactly like `vrc6-core.ts` (its own module doc comment
 * explains why: a deliberately separate module so nothing about the plain
 * 2A03's own `dsp.ts`/`driver.ts`/`index.ts`/`worklet.ts` moves), with one
 * real difference in the mixing math, not just the names: nesdev states the
 * VRC6's DAC is linear, but the 5B's is explicitly "converted to analog
 * with a logarithmic DAC" - a 1.5dB step per raw unit - so `Sunsoft5bMixStage`
 * below cannot reuse VRC6's "sum the raw units, multiply by one gain"
 * shape. Each channel is looked up in `SUNSOFT5B_DAC` (the log curve) first,
 * matching how the 2A03's own non-linear `mixPulsesLocal`/`mixTndLocal`
 * curves (copied below, same as `vrc6-core.ts` does, for the same reason)
 * are non-linear too - only VRC6 happens to be the linear one.
 *
 * Registered under `"2a03-sunsoft5b"`, not in `CHIP_IDS` (`project-schema.ts`):
 * decision 38's "a sheet before a chip" gate, same as `"2a03-vrc6"`. Fully
 * reachable from the package API - `chips()`, `getChip("2a03-sunsoft5b")`,
 * `chipFor("2a03-sunsoft5b")`, `Chip.create({ chip: "2a03-sunsoft5b" })`.
 */

/** Voice order for the combined digital chip and `ChipSpec`: the 2A03's five, then the 5B's three (A, B, C). */
export const NES_SUNSOFT5B_VOICES = [...NES_VOICES, "s5a", "s5b", "s5c"] as const;

export const NES_SUNSOFT5B: ChipSpec = {
  id: "2a03-sunsoft5b",
  name: "Ricoh 2A03 + Sunsoft 5B",
  system: "NES / Famicom (Sunsoft 5B mapper: Gimmick! - nesdev: \"this audio hardware was only used in one game\")",
  instruments: "table",
  nativeSampleRate: null,
  clockHz: CPU_HZ,
  voices: [
    { id: "p1", label: "Pulse 1", kind: "pulse", notes: "pitch" },
    { id: "p2", label: "Pulse 2", kind: "pulse", notes: "pitch" },
    { id: "tri", label: "Triangle", kind: "triangle", notes: "pitch" },
    { id: "noi", label: "Noise", kind: "noise", notes: "period" },
    { id: "dmc", label: "DMC", kind: "sample", notes: "sample" },
    // The three 5B voices. No instrument or arranger reaches them yet
    // (decision 38): they exist here so the spec, the conform harness and
    // NSF import/export can address them, and a caller can drive them
    // directly through `RegisterEvent`s at $C000/$E000.
    { id: "s5a", label: "Sunsoft 5B Channel A", kind: "pulse", notes: "pitch" },
    { id: "s5b", label: "Sunsoft 5B Channel B", kind: "pulse", notes: "pitch" },
    { id: "s5c", label: "Sunsoft 5B Channel C", kind: "pulse", notes: "pitch" },
  ],
  // Unchanged from the plain 2A03: the 5B voices have no role yet.
  roles: { lead: "p1", chord: "p2", bass: "tri", perc: "noi" },
};

/** Whether a CPU address is one of the 5B's two sound ports, $C000-$DFFF
 * (register select) or $E000-$FFFF (register write). Exported so the NSF
 * player and exporter (`nsf.ts`) can route by the same rule this core uses
 * to split an event stream between the 2A03 and the 5B. */
export function isSunsoft5bAddr(addr: number): boolean {
  const page = addr & 0xe000;
  return page === 0xc000 || page === 0xe000;
}

/**
 * The combined digital chip: dispatches each write to the 2A03 or the 5B by
 * address and reports all eight voices. Composition only - neither
 * `Nes2A03` nor `Sunsoft5bAudio` is changed to build this.
 */
export class Sunsoft5bNesDigital implements DigitalChip {
  readonly voices = NES_SUNSOFT5B_VOICES;
  readonly nes = new Nes2A03();
  readonly s5b = new Sunsoft5bAudio();

  write(addr: number, value: number) {
    if (isSunsoft5bAddr(addr)) this.s5b.write(addr, value);
    else this.nes.write(addr, value);
  }

  applyEvent(ev: RegisterEvent) {
    this.write(ev.addr, ev.value);
  }

  load(address: number, bytes: Uint8Array) {
    this.nes.load(address, bytes);
  }

  schedule(events: RegisterEvent[]) {
    const nesEvents = events.filter((e) => !isSunsoft5bAddr(e.addr));
    const s5bEvents = events.filter((e) => isSunsoft5bAddr(e.addr));
    if (nesEvents.length) this.nes.schedule(nesEvents);
    if (s5bEvents.length) this.s5b.schedule(s5bEvents);
  }

  cancel(owner: string, from: number) {
    this.nes.cancel(owner, from);
    this.s5b.cancel(owner, from);
  }

  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    const nesLast = [0, 0, 0, 0, 0];
    const nesNow = [0, 0, 0, 0, 0];
    const s5bLast = [0, 0, 0];
    const s5bNow = [0, 0, 0];
    for (let i = 0; i < cycles; i++) {
      const cycle = this.nes.cycle;
      this.nes.step();
      this.s5b.step();
      this.nes.outputs(nesNow);
      for (let v = 0; v < 5; v++) {
        if (nesNow[v] !== nesLast[v]) {
          nesLast[v] = nesNow[v];
          onChange(cycle, v, nesNow[v]);
        }
      }
      this.s5b.outputs(s5bNow);
      for (let v = 0; v < 3; v++) {
        if (s5bNow[v] !== s5bLast[v]) {
          s5bLast[v] = s5bNow[v];
          onChange(cycle, 5 + v, s5bNow[v]);
        }
      }
    }
  }

  reset() {
    this.nes.reset();
    this.s5b.reset();
  }
}

/**
 * The 5B's own DAC: nesdev, verbatim - "The tone channels each produce a
 * 5-bit signal which is then converted to analog with a logarithmic DAC...
 * The logarithmic curve increases by 1.5 decibels for each step in the
 * 5-bit signal." and, from the envelope section, the anchor that fixes the
 * curve's zero point: "envelope levels 0 and 1 are both equivalent to
 * volume 0 (silent)" - `Ay8910.outputs()`'s own raw index is exactly this
 * 5-bit signal (see its doc comment for why the digital core reports it
 * unconverted), so this table is what turns it into analog amplitude, index
 * 31 normalized to a peak of 1.
 *
 * `10 ** ((i - 31) * 1.5 / 20)` is the amplitude-domain form of "1.5dB per
 * step" (dB = 20*log10(ratio) for an amplitude, not a power, ratio) -
 * Mesen's own `Sunsoft5bAudio.h` builds its coarser 16-level curve the same
 * way (`output *= 1.1885022274370184377301224648922` twice per volume step;
 * 1.1885022... is `10 ** (1.5/20)`, so two applications is exactly the 3dB
 * a whole 4-bit volume step is documented as further down), a cross-check
 * that this is the intended construction, not a number this core invented.
 *
 * Nesdev's own next sentence: "Some emulator implementations that are based
 * on the AY-3-8910 instead treat it as a 4-bit signal with a 3dB per step
 * curve" - the coarser curve `Nes_Fme7_Apu` and `Sunsoft5bAudio` (Mesen)
 * both actually use, per `packages/conform`'s oracle notes. This core
 * implements the finer, YM2149F-accurate curve nesdev gives as the 5B's own
 * behavior, since that is what the chip on a real Sunsoft 5B board is; the
 * coarser curve is not implemented anywhere in this package, there being no
 * AY-3-8910 host chip in this ticket for it to belong to (decision 38's
 * scope; see `docs/chips/sunsoft5b.md`).
 */
export const SUNSOFT5B_DAC: readonly number[] = Array.from({ length: 32 }, (_, i) =>
  i < 2 ? 0 : 10 ** ((i - 31) * 1.5 / 20),
);

/**
 * The mixing level: how much of `SUNSOFT5B_DAC`'s normalized 0..1 peak one
 * 5B channel alone contributes to the composite sample, on the same -1..1
 * scale `mixPulses`/`mixTND` (`dsp.ts`) produce.
 *
 * Unlike VRC6 (`VRC6_MIX_UNIT_GAIN`, `vrc6-core.ts`), nesdev gives no
 * quantitative anchor for the 5B at all: its own words are "The output is
 * mixed with the 2A03 and amplified. It is very loud compared to other
 * audio expansion carts. The amplifier becomes nonlinear at higher
 * amplitudes, and includes some filtering", citing a "Sunsoft 5B amplifier
 * investigation (ongoing)" - nesdev's own community has not settled this
 * either. There is no "roughly equivalent to a 2A03 pulse channel" sentence
 * to turn into a number the way VRC6's comment does.
 *
 * Absent that anchor, this constant reuses VRC6's own anchor point only for
 * lack of a better documented one: one 5B channel at maximum level (DAC
 * index 31, normalized to 1.0 above) is set equal in magnitude to one 2A03
 * pulse channel at maximum volume, `mixPulses(15, 0)`. This is a stated
 * placeholder, not a measurement - nesdev's own "very loud... compared to
 * other audio expansion carts" strongly suggests the real board is louder
 * than this, and the cited nonlinear amplifier stage is not modeled here at
 * all. `docs/chips/sunsoft5b.md`'s "Known deviations" table says this
 * plainly: the conformance gates in `packages/conform` only ever compare
 * the digital, pre-DAC 0-31 index (`Sunsoft5bNesDigital.trace()`, never
 * this mix stage), so this placeholder does not affect what is actually
 * being verified - only what `render()`'s audio sounds like today.
 */
export const SUNSOFT5B_MIX_UNIT_GAIN = 95.88 / (8128 / 15 + 100);

/**
 * The analog stage for the combined chip. Same near-duplicate-of-
 * `NesOutputStage` shape as `Vrc6MixStage` (`vrc6-core.ts`), for the same
 * reason (see this file's own doc comment); `add()` differs from VRC6's by
 * looking each 5B channel up in `SUNSOFT5B_DAC` before summing, since the
 * 5B's DAC is logarithmic where VRC6's is linear.
 */
export class Sunsoft5bMixStage {
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

  /**
   * The 2A03's five voices through its own DAC curves, plus the 5B's three
   * raw 0-31 indices through `SUNSOFT5B_DAC` and summed linearly - nesdev:
   * "the three output channels are mixed together linearly" - then scaled
   * by `SUNSOFT5B_MIX_UNIT_GAIN` and added (not subtracted: nesdev states
   * no inversion for the 5B the way it does for VRC6).
   */
  add(p1: number, p2: number, triangle: number, noise: number, dmc: number, a: number, b: number, c: number) {
    const nesSum = mixPulsesLocal(p1, p2) + mixTndLocal(triangle, noise, dmc);
    const s5bSum = (SUNSOFT5B_DAC[a] + SUNSOFT5B_DAC[b] + SUNSOFT5B_DAC[c]) * SUNSOFT5B_MIX_UNIT_GAIN;
    this.sum += nesSum + s5bSum;
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
// 2A03 DAC curves) rather than imported, same reasoning and same
// `test/sunsoft5b.mjs` cross-check as `vrc6-core.ts`'s own copy.
function mixPulsesLocal(p1: number, p2: number): number {
  const sum = p1 + p2;
  return sum === 0 ? 0 : 95.88 / (8128 / sum + 100);
}

function mixTndLocal(triangle: number, noise: number, dmc: number): number {
  const denom = triangle / 8227 + noise / 12241 + dmc / 22638;
  return denom === 0 ? 0 : 159.79 / (1 / denom + 100);
}

// Same profile numbers as `NESDEV_PROFILE` in `dsp.ts` (duplicated for the
// same reason as the mix curves above).
const HIGH_PASS_HZ: [number, number] = [90, 440];
const LOW_PASS_HZ = 14000;
const PROFILE_GAIN = 2.9;

export const SUNSOFT5B_PROCESSOR_NAME = "sunsoft5b-apu-processor";

/**
 * The combined `ChipCore`: a `Nes2A03`, a `Sunsoft5bAudio`, and
 * `Sunsoft5bMixStage` between them and the sample clock. Same cycle/sample
 * bookkeeping as `NesApuCore` (`dsp.ts`), duplicated for the same reason as
 * the mix stage.
 */
export class Sunsoft5bNesCore implements ChipCore {
  fork(): Sunsoft5bNesCore { return forkState(this, () => new Sunsoft5bNesCore(this.sampleRate)); }
  readonly sampleRate: number;
  readonly nes = new Nes2A03();
  readonly s5b = new Sunsoft5bAudio();
  readonly stage: Sunsoft5bMixStage;

  private remainder = 0;
  private nextSample = -1;
  private masterGain = 1;
  private readonly nesVoices = [0, 0, 0, 0, 0];
  private readonly s5bVoices = [0, 0, 0];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.stage = new Sunsoft5bMixStage(sampleRate, HIGH_PASS_HZ, LOW_PASS_HZ, PROFILE_GAIN);
  }

  render(left: Float32Array, right: Float32Array | null, startSample: number) {
    const n = left.length;
    if (startSample !== this.nextSample) this.seek(startSample);

    const { nes, s5b, stage, nesVoices, s5bVoices } = this;
    for (let i = 0; i < n; i++) {
      stage.begin();
      this.remainder += CPU_HZ;
      while (this.remainder >= this.sampleRate) {
        this.remainder -= this.sampleRate;
        nes.step();
        s5b.step();
        nes.outputs(nesVoices);
        s5b.outputs(s5bVoices);
        stage.add(nesVoices[0], nesVoices[1], nesVoices[2], nesVoices[3], nesVoices[4], s5bVoices[0], s5bVoices[1], s5bVoices[2]);
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
    this.s5b.cycle = cycle;
    this.remainder = scaled - cycle * this.sampleRate;
  }

  schedule(events: RegisterEvent[]) {
    const nesEvents = events.filter((e) => !isSunsoft5bAddr(e.addr));
    const s5bEvents = events.filter((e) => isSunsoft5bAddr(e.addr));
    if (nesEvents.length) this.nes.schedule(nesEvents);
    if (s5bEvents.length) this.s5b.schedule(s5bEvents);
  }

  cancel(owner: string, from: number) {
    this.nes.cancel(owner, from);
    this.s5b.cancel(owner, from);
  }

  load(address: number, bytes: Uint8Array) {
    this.nes.load(address, bytes);
  }

  setGain(value: number) {
    this.masterGain = value;
  }

  reset() {
    this.nes.reset();
    this.s5b.reset();
  }
}
