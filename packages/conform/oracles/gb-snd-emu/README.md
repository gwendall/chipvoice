# Oracle: Gb_Snd_Emu

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Shay Green's (blargg's) Gb_Snd_Emu 0.1.4, his Game Boy APU emulator from 2005,
built natively and driven with a register log. Vendored from
<https://github.com/blarggs-audio-libraries/Gb_Snd_Emu> under the LGPL 2.1 (see
[LICENSE](LICENSE)). It is a tool in this repository; nothing here ships in the
`chipvoice` package, which stays MIT.

## What is blargg's and what is not

`gb_apu/Gb_Apu.*`, `gb_apu/Gb_Oscs.*`, `gb_apu/blargg_*.h` and `boost/` are his,
unchanged. Two files are ours:

- `gb_apu/Blip_Buffer.h` replaces his (and his `Blip_Synth.h`), for the reason
  the 2A03 oracle's does: the oscillators produce amplitude deltas at exact
  clock times, parity is measured before any synthesis, and this records the
  deltas instead. The oscillators compile against it unchanged.
- `main.cpp` reads a log, drives the APU, sums the deltas per voice, folds his
  amplitudes onto the DAC's 0 to 15 (his squares and noise swing between plus
  and minus the volume times the master volume; his wave is the sample times
  twice the master volume) and prints every change as `<cycle> <voice> <value>`.
  The fold assumes the master volume is 7, which the corpus keeps it at.

The harness builds it with the system C++ compiler on first use, into `build/`.

## Known limits of this oracle

It was written for sound, before blargg wrote the dmg_sound test ROMs, and the
ROMs are the better authority wherever the two disagree. In short:

- Its frame sequencer is its own 256 Hz clock that ticks at time zero, not the
  divider's bit. Its length clocks land 8192 cycles from the hardware's, its
  sweep clocks 8192 the other way, its envelope clocks 16384 early.
- A trigger does not reload its period timer, and a voice starting from
  silence takes its first step at once: the hardware reloads the timer and
  steps a full period later. Every note therefore starts one step apart, and
  the comparison's runs line up under a shift of their own.
- Its sweep applies the frequency it computed a period earlier, and clamps
  rather than checks overflow on the trigger.
- It has no DACs and no power switch: a voice with volume 0 is silent, the
  envelope register can be written freely and restarts the envelope (no
  zombie mode), NR52 only masks the enables.
- Its wave channel outputs the first sample the moment it is triggered; the
  hardware keeps the last byte it fetched until its first fetch, some cycles
  later, and blargg's own ROMs 09, 10 and 12 check that timing.
- Its duty patterns for 50 and 75 percent are rotated against Pan Docs' by
  two and one steps, which shifts those notes in time and nothing else.
- Its noise register is 15 bits from all ones, as the hardware's, and both
  widths produce the hardware's sequence: the comparison confirms the short
  one's pattern, which no ROM checks.
