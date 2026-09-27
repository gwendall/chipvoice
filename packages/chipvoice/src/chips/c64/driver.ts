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
 * chip-wide rather than per-voice. A voice's own routing bit is tracked as
 * persistent instance state, the way `waveBits` is - safe because only that
 * voice's own calls ever touch its own bit. The shared resonance, cutoff and
 * mode are never compared against another voice's write, only against this
 * voice's own previous frame, and are written unconditionally again on a
 * filtered note's first frame. That is because `note()` receives a whole
 * note at once, and `performance.ts` (and the live APU path in `driver.ts`)
 * hand notes to it in the order they start, not the order their register
 * writes actually land in time; a long note started earlier can finish
 * being processed, and so finish writing every frame of its own sweep, before
 * a shorter note that started later - but genuinely overlaps it - is even
 * dispatched. Comparing that later note's first frame against whatever the
 * earlier note's last frame left behind would sometimes skip a write this
 * note genuinely needs, because the two values coincide by accident while the
 * true hardware value at that moment was something else entirely. A voice
 * asking for the filter sets its own routing bit and writes whatever cutoff,
 * resonance and mode its instrument names; a voice not asking for it clears
 * its own bit and leaves the other three registers alone. When two voices ask
 * for different cutoffs, resonances or modes at once, there is only one
 * register for each, so whichever write actually lands later in absolute
 * time wins - exactly as real hardware would, a byte at a time - and
 * `validateSong`'s `filter_conflict` names that moment on the song rather
 * than leaving the arbitration to be discovered by ear. A note off touches
 * only the gate; the filter is left as it was.
 *
 * This still leans on the arranger's own contract: `sweep` and `resonant`
 * hold a note's routing and resonance fixed from its first frame to its
 * last, so a note's first frame is the only frame that can change either,
 * and a first frame is exactly what lands in true time order no matter what
 * order notes are dispatched in. A caller-built `NoteFrame[]` that turns the
 * filter on or off, or changes resonance, partway through a note - no
 * built-in instrument does this - loses that guarantee: routing and
 * resonance changes are only resolved correctly at note starts, and a
 * mid-note change to either, overlapped by another voice's later-starting
 * note, is resolved in dispatch order rather than time order.
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
  /** Each voice's own routing bit into `$D417`, bit `index`: safe as
   * persistent cross-call state because only that voice's own calls ever
   * set or clear it. */
  private routingBits = 0x00;
  /** The resonance nibble last written to `$D417`, kept only so a
   * routing-bit-only write (a voice starting or stopping asking for the
   * filter, with its resonance unchanged) can preserve it rather than
   * clobber it - never read as a dedup target for another voice's write. */
  private sharedResonanceNibble = 0x00;

  /** Volume full, nothing filtered, the cutoff at the bottom. */
  powerOn(): RegisterEvent[] {
    this.waveBits = [0x40, 0x40, 0x40];
    this.routingBits = 0x00;
    this.sharedResonanceNibble = 0x00;
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
    // This voice's own last-known filter fields, local to this note - reset
    // for every call so the note's first frame always writes its own
    // resonance, cutoff and mode unconditionally (-1 matches no real value),
    // rather than being compared against another voice's write, or against a
    // value this same instance held before this note existed. See the class
    // doc comment for why that comparison would be unsafe.
    let ownResonance = -1;
    let ownMode = -1;
    let ownCutoffLow = -1;
    let ownCutoffHigh = -1;
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
      // routing bit compares against `routingBits`, safe across calls since
      // only this voice's own calls ever touch its own bit (see the class
      // doc comment). The resonance nibble that rides along with it, and the
      // cutoff and mode below, compare only against this note's own previous
      // frame - never against `routingBits`' resonance half, which exists
      // only so a routing-bit-only write can preserve it unchanged.
      const bit = 1 << index;
      const wantsFilter = !!s.filter;
      const currentBit = this.routingBits & bit;
      const resonanceNibble = s.filter
        ? Math.max(0, Math.min(15, Math.round(s.filter.resonance))) << 4
        : this.sharedResonanceNibble;
      const resonanceChanged = wantsFilter && resonanceNibble !== ownResonance;
      if ((wantsFilter ? bit : 0) !== currentBit || resonanceChanged) {
        this.routingBits = (this.routingBits & ~bit) | (wantsFilter ? bit : 0);
        this.sharedResonanceNibble = resonanceNibble;
        write(0xd417, resonanceNibble | this.routingBits);
        if (wantsFilter) ownResonance = resonanceNibble;
      }
      if (s.filter) {
        const modeBits = FILTER_MODE_BITS[s.filter.mode];
        if (modeBits !== ownMode) {
          // The low nibble is the master volume, always full: nothing else
          // in this driver ever writes `$D418`.
          write(0xd418, modeBits | 0x0f);
          ownMode = modeBits;
        }
        const cutoff = Math.max(0, Math.min(0x7ff, Math.round(s.filter.cutoff)));
        const cutoffLow = cutoff & 0x07;
        const cutoffHigh = cutoff >> 3;
        if (cutoffLow !== ownCutoffLow) {
          write(0xd415, cutoffLow);
          ownCutoffLow = cutoffLow;
        }
        if (cutoffHigh !== ownCutoffHigh) {
          write(0xd416, cutoffHigh);
          ownCutoffHigh = cutoffHigh;
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
