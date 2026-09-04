# SNES: S-DSP (`snes`)

The Super Nintendo's sound: the S-DSP, eight sample voices with ADSR and gain
envelopes, Gaussian interpolation, pitch modulation, a noise source and an echo
with an eight-tap FIR, playing BRR samples out of the 64 KB it shares with the
SPC700. The method behind every section is in [CONFORMANCE.md](../CONFORMANCE.md).

| | |
| --- | --- |
| **Machine** | Super Nintendo, Super Famicom (the SPC700's clock, 1024000 Hz; a sample every 32 clocks, 32000 Hz) |
| **Status** | **in progress**: the DSP is identical to snes_spc on its output stream, the driver plays every role, the analog stage is unmeasured |
| **Core** | ported line for line from snes_spc's SPC_DSP (`packages/chipvoice/src/chips/snes/sdsp.ts`) |
| **Licence of the core** | `sdsp.ts` is a port of snes_spc and carries its LGPL 2.1; everything else in the package is MIT. The package's licence field says both |
| **Sheet updated** | 2026-09-04, by hand and by `conform` |

## Digital parity

Measured by [`conform`](../../packages/conform), the harness, against
[snes_spc](../../packages/conform/oracles/snes-spc), on the DSP's output
stream - left and right, the sixteen-bit words the chip hands its DAC - over two
songs through the driver and three scripts in
[`packages/conform/corpus/snes`](../../packages/conform/corpus/snes). The numbers
between the markers are written by the harness (`pnpm --filter chipvoice-conform
baseline:snes`); the reading of them below is a person's. CI reruns the corpus and
fails if the identical count falls below the committed baseline.

<!-- parity:begin -->
Written by `conform` on 2026-09-04, against snes_spc 0.9.0 (blargg), on left, right.

| | |
| --- | --- |
| Oracle | snes_spc 0.9.0 (blargg) |
| Corpus | 5 logs, 23859200 cycles |
| Identical cycles | 23859200 / 23859200 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-echo | 100.0000 % | none | left 100.0000 %, 78790/0/0; runs 60: 60 on times, 60 on values, shift <= 0; right 100.0000 %, 78813/0/0; runs 59: 59 on times, 59 on values, shift <= 0 |
| script-envelopes | 100.0000 % | none | left 100.0000 %, 142795/0/0; runs 2: 2 on times, 2 on values, shift <= 0; right 100.0000 %, 142795/0/0; runs 2: 2 on times, 2 on values, shift <= 0 |
| script-pitch-noise-pmod | 100.0000 % | none | left 100.0000 %, 54203/0/0; runs 28: 28 on times, 28 on values, shift <= 0; right 100.0000 %, 54203/0/0; runs 28: 28 on times, 28 on values, shift <= 0 |
| song-bright | 100.0000 % | none | left 100.0000 %, 124507/0/0; runs 1: 1 on times, 1 on values, shift <= 0; right 100.0000 %, 124506/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| song-golden | 100.0000 % | none | left 100.0000 %, 124266/0/0; runs 1: 1 on times, 1 on values, shift <= 0; right 100.0000 %, 124266/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- parity:end -->

**What the numbers say.** On this chip the digital output is the output: the
DSP computes the word the DAC gets, and the comparison is on that word, sample
for sample. Every log is identical to snes_spc on both channels - the envelopes
in ADSR and each GAIN mode, pitch and the noise at several rates, pitch
modulation, the echo at several delays and feedbacks through two FIRs, the BRR
decoder on the driver's bank and on a burst - on the first run of the port. What
the first run found was in the programs, not the chip, and the chip and its
oracle agreed on every bit of it. Two things the DSP powers on with, since its
power-on state is a register set captured from a console: an echo buffer 28 KB
long from wherever ESA points, which wraps round the top of RAM and over the
samples until the old buffer has run out and the new EDL is read; and voices
keyed on with the noise routed to some of them and the noise clock stopped,
which is a constant on the output that grows with an envelope. The IPL ROM
keyed everything off and a program disabled echo writes first and waited the
old delay out; the driver, the scripts and the formula tests now do both.

## Test ROMs

None run. There is no community test ROM suite for the S-DSP the way there is
for the 2A03 and the DMG; snes_spc, written against captures of the hardware,
carries the verification.

<!-- roms:begin -->
<!-- roms:end -->

## Formula tests

`packages/chipvoice/test/snes.mjs`, run on every push.

| Test | Result |
| --- | --- |
| A looped sine at the pitch for 440 Hz crosses zero 440 times a second | pass |
| Full volume reaches most of sixteen bits; a key-off releases to silence | pass |
| The echo brings a burst back 2 × 16 ms later | pass |
| BRR: 64 samples encode as four blocks with the flags right, and play back near the amplitude that went in | pass |

## Analog stage

| | |
| --- | --- |
| Reference unit | none yet |
| Capture | none |
| Tolerance | |
| Maximum band error | unmeasured |
| Corners measured | none |
| Resampling | the output stage: the DAC holds each 32000 Hz word, a 14 kHz first-order low-pass rounds the steps, a 20 Hz high-pass; one host sample per period by stepping the SPC700 clock |

The DAC and the console's filter are placeholders. A capture of a real unit's
line-out under a known script is what it needs (P6-8); a capture of the DSP's
digital stream, which exists for some consoles, would compare directly with
the trace.

## Driver coverage

`SnesDriver` in `packages/chipvoice/src/chips/snes/driver.ts`, checked by
`test/snes-driver.mjs`. The song's lead goes to voice 0, its chord to voice 1,
its bass to voice 2, its percussion to voice 3.

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| v0, v1, v2 | a looped single-cycle waveform from the bank, the pitch per frame, the voice's two volumes per frame, an ADSR that attacks at once and sustains, a key-on; note off as a fast GAIN decrease; the echo | ADSR's decay and release as an envelope, GAIN's other modes, pitch modulation, the noise, four of the eight voices |
| v3 | a one-shot drum from the bank at pitch `$1000`, the volumes per frame | the noise source for hats |
| the echo | on for the pitched voices: 48 ms, feedback `$38`, the low-pass FIR most games used, enabled once the power-on buffer has wrapped | other FIRs, other delays |

## Known deviations

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| A write to `$F3` lands before the clock it is stamped with; several on one clock land in order | yes | the SPC700 writes between DSP clocks; the oracle's driver takes the same convention | when a register lands, to within one clock |
| Note off is the voice's GAIN, not KOFF | yes | KOFF is one register for eight voices, and a driver that writes notes out of time order cannot hold its state; GAIN is the voice's own | how a note fades: exponentially over about 8 ms rather than linearly |
| The bank's samples are synthesised and encoded here, not recorded | yes | they are the arranger's instruments, not the chip's | what the intents sound like, not what the chip does |

## Power-on state

`reset()` is snes_spc's: the registers a real SPC state was captured with -
which keys some voices on, routes the noise to some, and sets an echo buffer
of 28 KB - the noise register at `$4000`, the counters at zero. The driver's
power-on does what the IPL ROM and a program did: disables echo writes, keys
every voice off, sets the directory, the volumes, the echo and every voice's
envelope, then releases KOFF, and enables echo writes a quarter of a second
later, once the power-on buffer has wrapped.

## History

- 2026-09-04: the port, the driver, the corpus. Identical to snes_spc on every
  log on the first run; the power-on state's echo buffer and keyed-on voices
  were the two things to handle, in the programs rather than the chip.

## Sources

Written from:

- snes_spc 0.9.0, Shay Green, the DSP.
- Anomie's SPC700 and DSP documents, and Fullsnes, the registers and the BRR format.

Verified against:

- snes_spc, built natively, in `packages/conform/oracles/snes-spc`.
