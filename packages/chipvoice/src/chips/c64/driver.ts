import type { ChipDriver, FilterMode, NoteFrame, RegisterEvent, Waveform } from "../../chip.js";
import { CLOCK_HZ } from "./dsp.js";

/**
 * The C64's driver: a note's frames to bytes on `$D400-$D418`.
 *
 * The SID has no volume register per voice; it has an envelope with a gate.
 * The instrument tables are the envelope here: the attack and decay rates
 * are set to their fastest, the sustain level is the frame's volume, and a
 * frame that lowers the volume writes a new sustain, which the counter
 * falls to within a millisecond. A frame that raises it has to gate the
 * voice again, since the counter only ever falls towards the sustain
 * level; the attack to full scale and back takes two milliseconds and is
 * what a C64 driver paid for the same thing. The release is one step slow,
 * for a tail where the other chips cut.
 *
 * A pitch is the 16-bit frequency register, a duty one of four pulse
 * widths, and the instrument names the waveform: the same score's bass is a
 * triangle or a sawtooth here where a NES had only the triangle. A noise
 * voice takes its pitch too: the register clocks the noise at sixteen times
 * the frequency it would give a tone. `pulseWidth` overrides `duty`'s four
 * steps with the raw twelve-bit register, frame by frame, for a PWM sweep.
 *
 * The filter is `$D415`-`$D418`: an eleven-bit cutoff split high/low, a
 * resonance and three routing bits in `$D417`, a mode and the master volume
 * in `$D418`. It is one filter for three voices, so those four registers are
 * chip-wide rather than per-voice, and this class keeps the last byte written
 * to each as instance state, across every voice's calls, the way the rest of
 * this file keeps `waveBits`. A voice asking for the filter sets its own
 * routing bit and writes whatever cutoff, resonance and mode its instrument
 * names; a voice not asking for it clears its own bit and leaves the other
 * three registers alone. When two voices ask for different cutoffs,
 * resonances or modes at once, there is only one register for each and the
 * later write wins - exactly as real hardware would, a byte at a time - so
 * the earlier voice stays routed through the filter but is heard through
 * whatever the later voice set, until it writes its own again. A note off
 * touches only the gate; the filter is left as it was.
 */

const BASE = 0xd400;
const VOICE_INDEX: Record<string, number> = { v1: 0, v2: 1, v3: 2 };
/** A store takes the 6510 four cycles. */
const GAP = 4;
/** Cycles between one voice's burst and the next's. */
const STAGGER = 48;

const WAVE_BITS: Record<Waveform, number> = { triangle: 0x10, sawtooth: 0x20, pulse: 0x40, noise: 0x80 };
/** The pulse width for a duty of 12.5, 25, 50 and 75 percent: the output is high above it. */
const PULSE_WIDTH = [0xe00, 0xc00, 0x800, 0x400];
/** The release rate: 32 cycles a step, about twenty milliseconds from a mid level. */
const RELEASE = 1;
/** `$D418`'s high nibble: which of the filter's outputs reach the mix. */
const FILTER_MODE_BITS: Record<FilterMode, number> = { lowpass: 0x10, bandpass: 0x20, highpass: 0x40 };

/** f = F * clock / 2^24. */
function frequencyRegister(freq: number): number {
  if (freq <= 0) return 0;
  return Math.max(0, Math.min(0xffff, Math.round((freq * 16777216) / CLOCK_HZ)));
}

/**
 * A bend in 2A03 period units, applied to a pitch as the ratio it would have
 * made on that chip, so an instrument written there bends the same way here.
 */
function bent(freq: number, offset: number): number {
  if (offset === 0 || freq <= 0) return freq;
  const period = 1789773 / (16 * freq) - 1;
  return (freq * (period + 1)) / (period + 1 + offset);
}

export class SidDriver implements ChipDriver {
  /** Each voice's waveform bits, for a note off that keeps the waveform. */
  private waveBits = [0x40, 0x40, 0x40];
  /** The last byte written to `$D417`: resonance, and the three routing bits. */
  private lastResonanceRouting = 0x00;
  /** The last byte written to `$D418`: the filter mode, and the master volume. */
  private lastModeVolume = 0x0f;
  /** The last eleven-bit cutoff written across `$D415`-`$D416`. */
  private lastCutoff = 0;

  /** Volume full, nothing filtered, the cutoff at the bottom. */
  powerOn(): RegisterEvent[] {
    this.waveBits = [0x40, 0x40, 0x40];
    this.lastResonanceRouting = 0x00;
    this.lastModeVolume = 0x0f;
    this.lastCutoff = 0;
    return [
      { at: 0, addr: 0xd418, value: 0x0f },
      { at: GAP, addr: 0xd417, value: 0x00 },
      { at: 2 * GAP, addr: 0xd415, value: 0x00 },
      { at: 3 * GAP, addr: 0xd416, value: 0x00 },
    ];
  }

  note(voice: string, frames: NoteFrame[]): RegisterEvent[] {
    const index = VOICE_INDEX[voice];
    if (index === undefined || frames.length === 0) return [];
    const base = BASE + 7 * index;
    const out: RegisterEvent[] = [];
    let t = 0;
    const write = (addr: number, value: number) => {
      out.push({ at: t, addr, value });
      t += GAP;
    };
    let lastFreq = -1;
    let lastPw = -1;
    let lastVolume = -1;
    let lastWave = -1;
    frames.forEach((s, f) => {
      t = s.at + STAGGER * index;
      const wave = WAVE_BITS[s.waveform ?? "pulse"];
      const freq = frequencyRegister(bent(s.freq, s.pitchOffset));
      // A per-frame pulse-width sweep overrides the four fixed duty steps.
      const pw = s.pulseWidth != null ? Math.max(0, Math.min(0xfff, Math.round(s.pulseWidth))) : PULSE_WIDTH[s.duty & 3];
      const volume = Math.max(0, Math.min(15, s.volume));
      if (f === 0) {
        write(base + 0, freq & 0xff);
        write(base + 1, freq >> 8);
        write(base + 2, pw & 0xff);
        write(base + 3, pw >> 8);
        // The fastest attack and decay: the table is the envelope.
        write(base + 5, 0x00);
        write(base + 6, (volume << 4) | RELEASE);
        write(base + 4, wave | 0x01);
      } else {
        if ((freq & 0xff) !== (lastFreq & 0xff)) write(base + 0, freq & 0xff);
        if (freq >> 8 !== lastFreq >> 8) write(base + 1, freq >> 8);
        if ((pw & 0xff) !== (lastPw & 0xff)) write(base + 2, pw & 0xff);
        if (pw >> 8 !== lastPw >> 8) write(base + 3, pw >> 8);
        if (volume !== lastVolume) {
          write(base + 6, (volume << 4) | RELEASE);
          // The counter only falls to the sustain level: a rise is a new attack.
          if (volume > lastVolume) {
            write(base + 4, wave);
            write(base + 4, wave | 0x01);
          } else if (wave !== lastWave) {
            write(base + 4, wave | 0x01);
          }
        } else if (wave !== lastWave) {
          write(base + 4, wave | 0x01);
        }
      }
      lastFreq = freq;
      lastPw = pw;
      lastVolume = volume;
      lastWave = wave;

      // The filter: chip-wide, shared by three voices. This voice's own
      // routing bit follows whether this frame asks for the filter; the
      // resonance, cutoff and mode - one register each for the whole chip -
      // follow whichever voice last asked, so two voices fighting over them
      // resolve the way two writes to one byte always do.
      const bit = 1 << index;
      const routing = (this.lastResonanceRouting & 0x07 & ~bit) | (s.filter ? bit : 0);
      const resonance = s.filter
        ? Math.max(0, Math.min(15, Math.round(s.filter.resonance))) << 4
        : this.lastResonanceRouting & 0xf0;
      const resonanceRouting = resonance | routing;
      if (resonanceRouting !== this.lastResonanceRouting) {
        write(0xd417, resonanceRouting);
        this.lastResonanceRouting = resonanceRouting;
      }
      if (s.filter) {
        const modeVolume = FILTER_MODE_BITS[s.filter.mode] | (this.lastModeVolume & 0x0f);
        if (modeVolume !== this.lastModeVolume) {
          write(0xd418, modeVolume);
          this.lastModeVolume = modeVolume;
        }
        const cutoff = Math.max(0, Math.min(0x7ff, Math.round(s.filter.cutoff)));
        if (cutoff !== this.lastCutoff) {
          if ((cutoff & 0x07) !== (this.lastCutoff & 0x07)) write(0xd415, cutoff & 0x07);
          if (cutoff >> 3 !== this.lastCutoff >> 3) write(0xd416, cutoff >> 3);
          this.lastCutoff = cutoff;
        }
      }
    });
    this.waveBits[index] = lastWave;
    return out;
  }

  /** The gate off: the envelope releases. */
  noteOff(voice: string, at: number): RegisterEvent[] {
    const index = VOICE_INDEX[voice];
    if (index === undefined) return [];
    return [{ at: at + STAGGER * index, addr: BASE + 7 * index + 4, value: this.waveBits[index] }];
  }
}
