/**
 * The Texas Instruments SN76489, as the Mega Drive has it: three square
 * tones and a noise, each with a 4-bit attenuator. On the Mega Drive it is
 * inside the VDP and clocked at 3579545 Hz, the master clock over fifteen.
 *
 * Written from SMS Power's "SN76489 notes", the document the community has
 * tested against the hardware: a tone counter counts down at the clock over
 * sixteen and flips its output when it reaches zero, a period of zero or one
 * holds the output high, the noise is a 16-bit shift register with taps at
 * bits 0 and 3 fed by its own counter or by tone 3's, and the attenuator
 * steps 2 dB.
 *
 * The digital value of a voice is what its DAC is given: 0 to 15, the volume
 * the attenuation leaves, while the output bit is set, and 0 while it is
 * clear. The output stage turns that into the chip's levels.
 */

export const PSG_CLOCK_HZ = 3579545;

const NOISE_RESET = 0x8000;
const NOISE_TAPS = 0x0009;

export class Sn76489 {
  /** Tone periods, 10 bits; index 3 is the noise's control. */
  readonly period = new Uint16Array(4);
  /** Attenuations, 0 loud to 15 silent. */
  readonly attenuation = new Uint8Array(4);
  readonly counter = new Int32Array(4);
  readonly output = new Uint8Array(4);
  /** The noise register's control: rate in the low two bits, white in bit 2. */
  noise = 0;
  lfsr = NOISE_RESET;
  /** Which register the last latch byte pointed at. */
  private latch = 0;
  /** The chip's clock over sixteen, counted here. */
  private divider = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.period.fill(0);
    this.attenuation.fill(15);
    this.counter.fill(0);
    this.output.fill(1);
    this.noise = 0;
    this.lfsr = NOISE_RESET;
    this.latch = 0;
    this.divider = 0;
  }

  /** A byte on the chip's one port: a latch byte with the low bits, or a data byte with the high ones. */
  write(value: number) {
    value &= 0xff;
    if (value & 0x80) {
      this.latch = (value >> 4) & 0x07;
      const channel = this.latch >> 1;
      if (this.latch & 1) {
        this.attenuation[channel] = value & 0x0f;
      } else if (channel === 3) {
        this.setNoise(value & 0x07);
      } else {
        this.period[channel] = (this.period[channel] & 0x3f0) | (value & 0x0f);
      }
      return;
    }
    const channel = this.latch >> 1;
    if (this.latch & 1) {
      this.attenuation[channel] = value & 0x0f;
    } else if (channel === 3) {
      this.setNoise(value & 0x07);
    } else {
      this.period[channel] = (this.period[channel] & 0x00f) | ((value & 0x3f) << 4);
    }
  }

  /** A write to the noise register resets the shift register. */
  private setNoise(value: number) {
    this.noise = value;
    this.lfsr = NOISE_RESET;
  }

  /** The noise's period: 16, 32, 64 by the rate bits, or tone 3's. */
  private noisePeriod(): number {
    const rate = this.noise & 3;
    return rate === 3 ? this.period[2] : 0x10 << rate;
  }

  /** One cycle of the chip's clock. The counters move once in sixteen. */
  clock() {
    if (++this.divider < 16) return;
    this.divider = 0;
    for (let i = 0; i < 3; i++) {
      if (--this.counter[i] <= 0) {
        this.counter[i] = this.period[i];
        // A period of 0 or 1 leaves the output high: too fast to hear, and
        // what the chip does with it is hold.
        if (this.period[i] > 1) this.output[i] ^= 1;
        else this.output[i] = 1;
      }
    }
    if (--this.counter[3] <= 0) {
      this.counter[3] = this.noisePeriod();
      // The noise's own flip-flop; the register shifts on its rising edge.
      this.output[3] ^= 1;
      if (this.output[3]) this.shift();
    }
  }

  private shift() {
    const white = (this.noise & 0x04) !== 0;
    const input = white ? this.parity(this.lfsr & NOISE_TAPS) : this.lfsr & 1;
    this.lfsr = (this.lfsr >> 1) | (input << 15);
  }

  private parity(v: number): number {
    v ^= v >> 8;
    v ^= v >> 4;
    v ^= v >> 2;
    v ^= v >> 1;
    return v & 1;
  }

  /** What each voice's DAC is given: 0 to 15. */
  outputs(into: number[]) {
    for (let i = 0; i < 3; i++) into[i] = this.output[i] ? 15 - this.attenuation[i] : 0;
    into[3] = this.lfsr & 1 ? 15 - this.attenuation[3] : 0;
  }
}
