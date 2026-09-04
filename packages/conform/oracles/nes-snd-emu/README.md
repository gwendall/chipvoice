# Oracle: Nes_Snd_Emu

Shay Green's (blargg's) Nes_Snd_Emu 0.1.7, the reference 2A03 APU emulator,
built natively and driven with a register log. Vendored from
<https://github.com/blarggs-audio-libraries/Nes_Snd_Emu> under the LGPL 2.1
(see [LICENSE](LICENSE)). It is a tool in this repository; nothing here ships in
the `chipvoice` package, which stays MIT.

## What is blargg's and what is not

`nes_apu/Nes_Apu.*`, `nes_apu/Nes_Oscs.*`, `nes_apu/blargg_*.h` and `boost/`
are his, unchanged. Two files are ours:

- `nes_apu/Blip_Buffer.h` replaces his. His oscillators do not produce samples;
  they produce amplitude deltas at exact CPU times and hand them to a synth
  that band-limits them into a sample buffer. Parity is measured before any of
  that, so this one records the deltas instead. The oscillators compile against
  it unchanged.
- `main.cpp` reads a log, drives the APU, sums the deltas per voice and prints
  every change of value as `<cycle> <voice> <value>`.

The harness builds it with the system C++ compiler on first use, into `build/`.

## Known limits of this oracle

It is from 2005 and predates some of what nesdev now knows. The sheet lists what
it is trusted for and what it is not; in short:

- Its frame sequence is 7458 cycles a step with corrections, not nesdev's
  7457, 14913, 22371, 29829, and its steps land two cycles after nesdev's.
- Its noise register starts at `1 << 14` and outputs the volume when bit 0 is
  *set*, the inverse of the documented polarity, and it does not clock the
  register exactly while the voice is muted.
- Its triangle steps at once when the length and linear counters reload,
  where the hardware waits for the timer's next expiry, and it starts on the
  other of the sequence's two zeros. From the first note the two sequencers
  are two steps apart, for good: the hardware never resets the triangle's
  position.
- Its `reset()` writes `$4003` to every voice, which leaves the envelope start
  flag set, and its first frame clock then loads every decay level with 15. A
  voice put in envelope mode before that has decayed sounds at 15 here and at
  0 on the hardware. The corpus scripts start a tenth of a second in for this.

So it is the oracle for the pulses and the triangle, and a witness for the
noise's envelope and length, not its bit pattern.
