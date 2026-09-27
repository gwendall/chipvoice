# SNES: S-DSP (`snes`)

<p align="center">
  <a href="snes.md">English</a> &bull;
  <a href="snes_ja.md">日本語</a>
</p>


The Super Nintendo's sound: the S-DSP, eight sample voices with ADSR and gain
envelopes, Gaussian interpolation, pitch modulation, a noise source and an echo
with an eight-tap FIR, playing BRR samples out of the 64 KB it shares with the
SPC700. The method behind every section is in [CONFORMANCE.md](../CONFORMANCE.md).

| | |
| --- | --- |
| **Machine** | Super Nintendo, Super Famicom (the SPC700's clock, 1024000 Hz; a sample every 32 clocks, 32000 Hz) |
| **Status** | **in progress**: the DSP is identical to snes_spc on its output stream, the driver plays every role, `.spc` files play back through `importSpc`, the analog stage is unmeasured |
| **Core** | ported line for line from snes_spc's SPC_DSP (`packages/chipvoice/src/chips/snes/sdsp.ts`) |
| **Licence of the core** | `sdsp.ts` is a port of snes_spc and carries its LGPL 2.1; everything else in the package is MIT. The package's licence field says both |
| **Sheet updated** | 2026-09-27, by hand and by `conform` |

## Digital parity

Measured by [`conform`](../../packages/conform), the harness, against
[snes_spc](../../packages/conform/oracles/snes-spc), on the DSP's output
stream - left and right, the sixteen-bit words the chip hands its DAC - over two
songs through the driver and four scripts in
[`packages/conform/corpus/snes`](../../packages/conform/corpus/snes). The numbers
between the markers are written by the harness (`pnpm --filter chipvoice-conform
baseline:snes`); the reading of them below is a person's. CI reruns the corpus and
fails if the identical count falls below the committed baseline.

<!-- parity:begin -->
Written by `conform` on 2026-09-27, against snes_spc 0.9.0 (blargg), on left, right.

| | |
| --- | --- |
| Oracle | snes_spc 0.9.0 (blargg) |
| Corpus | 6 logs, 29081600 cycles |
| Identical cycles | 29081600 / 29081600 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-echo | 100.0000 % | none | left 100.0000 %, 78790/0/0; runs 60: 60 on times, 60 on values, shift <= 0; right 100.0000 %, 78813/0/0; runs 59: 59 on times, 59 on values, shift <= 0 |
| script-envelopes | 100.0000 % | none | left 100.0000 %, 142795/0/0; runs 2: 2 on times, 2 on values, shift <= 0; right 100.0000 %, 142795/0/0; runs 2: 2 on times, 2 on values, shift <= 0 |
| script-noise-clock | 100.0000 % | none | left 100.0000 %, 58698/0/0; runs 53: 53 on times, 53 on values, shift <= 0; right 100.0000 %, 58698/0/0; runs 53: 53 on times, 53 on values, shift <= 0 |
| script-pitch-noise-pmod | 100.0000 % | none | left 100.0000 %, 54203/0/0; runs 28: 28 on times, 28 on values, shift <= 0; right 100.0000 %, 54203/0/0; runs 28: 28 on times, 28 on values, shift <= 0 |
| song-bright | 100.0000 % | none | left 100.0000 %, 127730/0/0; runs 1: 1 on times, 1 on values, shift <= 0; right 100.0000 %, 127756/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| song-golden | 100.0000 % | none | left 100.0000 %, 127636/0/0; runs 1: 1 on times, 1 on values, shift <= 0; right 100.0000 %, 127656/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- parity:end -->

**What the numbers say.** On this chip the digital output is the output: the
DSP computes the word the DAC gets, and the comparison is on that word, sample
for sample. Every log is identical to snes_spc on both channels - the envelopes
in ADSR and each GAIN mode, pitch and the noise at several rates, pitch
modulation, the echo at several delays and feedbacks through two FIRs, the BRR
decoder on the driver's bank and on a burst - on the first run of the port.
Later, once the kit's hats moved onto the DSP's own noise, a fourth script
added two voices sharing that noise at once, its clock changed under a held
note rather than only at key-on, and `FLG`'s reset and mute bits held over an
active noise voice; identical to snes_spc as well. What the first run found
was in the programs, not the chip, and the chip and its oracle agreed on
every bit of it. Two things the DSP powers on with, since its
power-on state is a register set captured from a console: an echo buffer 28 KB
long from wherever ESA points, which wraps round the top of RAM and over the
samples until the old buffer has run out and the new EDL is read; and voices
keyed on with the noise routed to some of them and the noise clock stopped,
which is a constant on the output that grows with an envelope. The IPL ROM
keyed everything off and a program disabled echo writes first and waited the
old delay out; the driver, the scripts and the formula tests now do both.

## SPC playback

`importSpc` (`packages/chipvoice/src/spc-import.ts`) plays an `.spc` file - a
frozen SPC700 + S-DSP snapshot, the SNES's own music format - through this
package's own S-SMP (`ssmp.ts`) and SPC700 (`spc700.ts`), written from
fullsnes, Anomie's SPC700 and S-DSP documents, and the SNES developer wiki's
`.spc`/ID666 layout, never from snes_spc's own CPU. It restores the CPU
registers, the 64 KB of ARAM and all 128 DSP registers exactly, reads the
ID666 tag when present (title, game, artist, length), and rejects a
truncated or misidentified file explicitly. See the package README for the
function and its options.

Measured by [`check:spc`](../../packages/conform/src/spc/check.mjs) against
`play-spc` - blargg's real SPC700 (`SPC_CPU.h`), built from the same vendored
snes_spc `main.cpp` already uses, but driving the CPU this time, not just the
DSP. Since the DSP itself already matches snes_spc line for line (see
"Digital parity" above), any divergence here can only be the new CPU, its
timers, or the snapshot restore. Two things are compared: the sequence of DSP
register writes the CPU makes (register and value, in order - the pass/fail
signal; cycle numbers are reported alongside but not asserted equal, since
blargg's CPU stamps a write with the cycle at the end of its whole
instruction, this package's own with the cycle of the write's own bus access,
a fixed labelling difference documented in `spc700.ts` and in `check.mjs`),
and the output samples, compared the same way "Digital parity" is. The corpus
is `packages/conform/corpus/snes/spc` (redistributable files only, self-authored
for now - see its README); a local, gitignored directory can hold anything
else for a person's own testing without CI depending on it.

<!-- spc:begin -->
Written by `check:spc` on 2026-09-27, against play-spc (blargg's SPC700, vendored snes_spc).

| | |
| --- | --- |
| Files | 1 |
| Write-sequence divergences | 0 |
| Sample cycles identical | 2048000 / 2048000 (100.0000 %) |
| Files with a sample divergence | 0 |

| File | Writes | Samples | First divergence |
| --- | --- | --- | --- |
| corpus/snes/spc/selftest.spc | 3/3 | 100.0000 % | none |
<!-- spc:end -->

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
[docs/HARDWARE-EVIDENCE.md](../HARDWARE-EVIDENCE.md#snes-s-dsp) has what was
found short of that: the one logic-analyser capture anyone made of a real
console's S-DSP lines is dead-linked, and the one frequency estimate for the
output filter is a schematic simulation, not a captured unit.

## Driver coverage

`SnesDriver` in `packages/chipvoice/src/chips/snes/driver.ts`, checked by
`test/snes-driver.mjs`. The song's lead goes to voice 0, its chord to voices 1/4/5 (up to 1/4/5/6/7 for extended shapes),
its bass to voice 2, its percussion to voice 3. Chords exceeding five notes
fall back to an arpeggio with a validation warning. The chord amplitude budget
is divided across its notes; pitched chord voices have moderate stereo spread.

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| v0, v1, v2, v4–v7 | original BRR attacks and separate sustain loops, per-family hardware ADSR, pitch and stereo volume per frame, key-on, note off as a fast GAIN decrease, echo; legacy periodic waveforms also available | GAIN's other modes, pitch modulation, hardware noise |
| v3 | a one-shot drum from the bank at pitch `$1000`, the volumes per frame; the kit's hats routed to the DSP's own noise through `NON`, at the one clock `FLG`'s very first power-on write sets | a held drum note's noise clock changed mid-note (the corpus scripts this; the kit does not) |
| the echo | on for the pitched voices: 48 ms, feedback `$38`, the low-pass FIR most games used, enabled once the power-on buffer has wrapped | other FIRs, other delays |

## Known deviations

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| A write to `$F3` lands before the clock it is stamped with; several on one clock land in order | yes | the SPC700 writes between DSP clocks; the oracle's driver takes the same convention | when a register lands, to within one clock |
| Note off is the voice's GAIN, not KOFF | yes | KOFF is one register for eight voices, and a driver that writes notes out of time order cannot hold its state; GAIN is the voice's own | how a note fades: exponentially over about 8 ms rather than linearly |
| The bank's samples are synthesised and encoded here, not recorded | yes | they are the arranger's instruments, not the chip's | what the intents sound like, not what the chip does |
| `NON` is written whole, with only the percussion voice's bit, and the noise clock (`FLG`'s low five bits) is set from the very first `FLG` write at power-on and never rewritten to a different value | yes | `NON` and the noise clock are each one register shared by every voice; only the percussion voice's `notes: "period"` ChipSpec ever carries `noiseMode`, and a driver that let a second voice carry noise would need to track the others' bits instead of overwriting them, and would need to pick one clock for whichever voices ask for different rates at once | a future second noise voice sharing the kit's own voice would need this register handled like KOFF, not extended as is; today it does not arise |

## Power-on state

`reset()` is snes_spc's: the registers a real SPC state was captured with -
which keys some voices on, routes the noise to some, and sets an echo buffer
of 28 KB - the noise register at `$4000`, the counters at zero. The driver's
power-on does what the IPL ROM and a program did: disables echo writes and
mutes echo output (reads can initially wrap into sample RAM), keys
every voice off, sets the directory, the volumes, the echo and every voice's
envelope, then releases KOFF, and enables echo writes and echo output a quarter
of a second later, once the power-on buffer has wrapped. The very first of
those writes - the one that disables echo writes - also sets the noise
clock, `FLG`'s low five bits, to its fastest rate - the one clock every voice
routed to noise shares - because a note can start as early as the song's own
time zero, before the echo buffer has finished settling. The later write that
turns echo writes back on repeats the same clock rather than setting it for
the first time; it is never rewritten to a different value after.

The factory bank occupies 21,472 bytes below the echo buffer at 57,344. Sample
generation and BRR encoding happen at build time. Voice volume is capped at
`$1f`; the factory arrangement reserves headroom before the saturating DSP sum.
This is not a guarantee for arbitrary eight-voice effects or custom register writes.
See [palette acceptance and measurements](../SNES-PALETTE.md).

## History

- 2026-09-27: `importSpc`, a new SPC700 (S-SMP) written from documents, and
  `check:spc` against a real CPU oracle. Matched the oracle on both the DSP
  register write sequence and the output samples on the first file measured.
- 2026-09-27: the kit's hats moved from BRR bursts to the DSP's own noise
  generator (`NON`, `FLG`'s clock), the kick and the snare staying BRR
  samples. A new corpus script exercises two voices on the noise at once, the
  clock changed under a held note, and `FLG`'s reset and mute bits over a
  voice routed to noise; still identical to snes_spc. The golden render moved
  (rms 0.0858 to 0.0867, peak 0.313 to 0.3127) with the hats now hiss rather
  than a recorded burst.
- 2026-09-04: the port, the driver, the corpus. Identical to snes_spc on every
  log on the first run; the power-on state's echo buffer and keyed-on voices
  were the two things to handle, in the programs rather than the chip.

## Sources

Written from:

- snes_spc 0.9.0, Shay Green, the DSP.
- Anomie's SPC700 and DSP documents, and Fullsnes, the registers, the BRR
  format, the SPC700 CPU/timers/I/O and the IPL ROM's behaviour.
- The SNES developer wiki's `.spc` and ID666 file format page, the container
  `importSpc` reads.

Verified against:

- snes_spc, built natively, in `packages/conform/oracles/snes-spc`.
- `play-spc`, blargg's real SPC700 built from the same vendored snes_spc, in
  the same directory: the CPU-capable oracle `check:spc` uses.
