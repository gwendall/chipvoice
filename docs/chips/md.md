# Mega Drive: YM2612 + SN76489 (`md`)

<p align="center">
  <a href="md.md">English</a> &bull;
  <a href="md_ja.md">日本語</a>
</p>


The Mega Drive's sound: a Yamaha YM2612, six channels of four-operator FM with a
DAC on the sixth, and a Texas Instruments SN76489, three square tones and a
noise, inside the video chip. The method behind every section is in
[CONFORMANCE.md](../CONFORMANCE.md).

| | |
| --- | --- |
| **Machine** | Mega Drive, Genesis (NTSC master clock 53693175 Hz; the YM2612 at a seventh, the PSG at a fifteenth) |
| **Status** | **in progress**: the FM chip is identical to the die-derived reference on every script, the driver plays every role, the PSG has no oracle yet, the analog stage is unmeasured |
| **Core** | the YM2612 ported line for line from Nuked-OPN2 (`packages/chipvoice/src/chips/md/ym2612.ts`); the SN76489 written from SMS Power's notes (`sn76489.ts`) |
| **Licence of the core** | `ym2612.ts` is a line-for-line port of Nuked-OPN2 and carries its LGPL 2.1; everything else in the package is MIT. The package's licence field says both |
| **Sheet updated** | 2026-09-04, by hand and by `conform` |

## Digital parity

Measured by [`conform`](../../packages/conform), the harness, against
[Nuked-OPN2](../../packages/conform/oracles/nuked-opn2), on the six FM voices,
over two songs through the driver and five scripts in
[`packages/conform/corpus/md`](../../packages/conform/corpus/md). The numbers
between the markers are written by the harness (`pnpm --filter chipvoice-conform
baseline:md`); the reading of them below is a person's. CI reruns the corpus and
fails if any voice's identical count falls below the committed baseline.

<!-- parity:begin -->
Written by `conform` on 2026-09-04, against Nuked-OPN2 1.0.12 (Nuke.YKT), on fm1, fm2, fm3, fm4, fm5, fm6.

| | |
| --- | --- |
| Oracle | Nuked-OPN2 1.0.12 (Nuke.YKT) |
| Corpus | 7 logs, 1798721365 cycles |
| Identical cycles | 1798721365 / 1798721365 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-algorithms | 100.0000 % | none | fm1 100.0000 %, 241084/0/0; runs 1182: 1182 on times, 1182 on values, shift <= 0; fm2 100.0000 %, 0/0/0; fm3 100.0000 %, 0/0/0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
| script-detune-lfo | 100.0000 % | none | fm1 100.0000 %, 235695/0/0; runs 1785: 1785 on times, 1785 on values, shift <= 0; fm2 100.0000 %, 195942/0/0; runs 106: 106 on times, 106 on values, shift <= 0; fm3 100.0000 %, 84832/0/0; runs 1862: 1862 on times, 1862 on values, shift <= 0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
| script-envelopes | 100.0000 % | none | fm1 100.0000 %, 171195/0/0; runs 6412: 6412 on times, 6412 on values, shift <= 0; fm2 100.0000 %, 126874/0/0; runs 3205: 3205 on times, 3205 on values, shift <= 0; fm3 100.0000 %, 10802/0/0; runs 1391: 1391 on times, 1391 on values, shift <= 0; fm4 100.0000 %, 125994/0/0; runs 872: 872 on times, 872 on values, shift <= 0; fm5 100.0000 %, 69981/0/0; runs 7353: 7353 on times, 7353 on values, shift <= 0; fm6 100.0000 %, 112/0/0; runs 9: 9 on times, 9 on values, shift <= 0 |
| script-psg | 100.0000 % | none | fm1 100.0000 %, 0/0/0; fm2 100.0000 %, 0/0/0; fm3 100.0000 %, 0/0/0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
| script-ssg-ch3-dac | 100.0000 % | none | fm1 100.0000 %, 101843/0/0; runs 7162: 7162 on times, 7162 on values, shift <= 0; fm2 100.0000 %, 0/0/0; fm3 100.0000 %, 65431/0/0; runs 1211: 1211 on times, 1211 on values, shift <= 0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
| song-bright | 100.0000 % | none | fm1 100.0000 %, 191137/0/0; runs 462: 462 on times, 462 on values, shift <= 0; fm2 100.0000 %, 166647/0/0; runs 1852: 1852 on times, 1852 on values, shift <= 0; fm3 100.0000 %, 0/0/0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
| song-golden | 100.0000 % | none | fm1 100.0000 %, 169736/0/0; runs 1151: 1151 on times, 1151 on values, shift <= 0; fm2 100.0000 %, 97120/0/0; runs 565: 565 on times, 565 on values, shift <= 0; fm3 100.0000 %, 0/0/0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
<!-- parity:end -->

**What the numbers say.** Nuked-OPN2 is a reading of the YM3438's die, and the
chip here is that reading ported. On every script - the eight algorithms at
three feedback levels, the envelope's stages and key scaling, detune and every
multiple, the LFO at every speed with both sensitivities, SSG-EG's eight shapes,
channel 3's special mode, the DAC - the six FM voices are identical to it cycle
for cycle: every edge exact, none unmatched, every run at a shift of zero. The
songs through the driver are identical but for a handful of cycles, read in the
history below. That is parity with the silicon, as far as a die shot can give it,
and the strongest verification any chip here has.

The PSG is not compared: there is no oracle for it yet. Its rates, its attenuator
and both its noise sequences are pinned by the formula tests.

## Test ROMs

None run. No community test ROM probes the YM2612 the way blargg's probe the
2A03 and the DMG; the die is the authority, and Nuked-OPN2 carries it.

<!-- roms:begin -->
<!-- roms:end -->

## Formula tests

`packages/chipvoice/test/md.mjs`, run on every push.

| Test | Result |
| --- | --- |
| A carrier at the F-number for A4 crosses zero 440 times a second | pass |
| Full level reaches the nine-bit edge; a key-off releases to silence | pass |
| The DAC puts its byte on the pins | pass |
| A PSG tone at N = 254 plays 440 Hz at the attenuator's full level | pass |
| The white noise register repeats after 57337 shifts (sixteen bits with taps 0 and 3 is not maximal), the periodic one after 16 | pass |

## Analog stage

| | |
| --- | --- |
| Reference unit | none yet |
| Capture | none |
| Tolerance | |
| Maximum band error | unmeasured |
| Corners measured | none |
| Resampling | the output stage: the YM2612's pins as Nuked models its ladder DAC, averaged over the sample; the PSG's levels summed at a chosen ratio; a 2.84 kHz low-pass where a Model 1 has one; one sample per period by stepping the master clock |

The YM2612's DAC model is marked "not verified" by Nuked's own author; the mix
of the two chips and the Model 1's filter are placeholders. A real unit's
line-out under a known script is what it needs (P5-8).

## Driver coverage

`MdDriver` in `packages/chipvoice/src/chips/md/driver.ts`, checked by
`test/md-driver.mjs`. The song's lead goes to FM 1, its bass to FM 2, its chord
to PSG 1, its percussion to the noise with tone 3 as its clock.

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| fm1, fm2 | a patch per intent, loaded once per channel; block and F-number per frame; the carriers' total levels per frame for the volume; key-on and key-off | the LFO, SSG-EG, channel 3's mode, the DAC, key scaling in the patches, four of the six channels |
| psg1 | the tone's period and attenuation per frame | psg2, psg3 as tones |
| noise | white noise clocked by tone 3 at the 2A03's sixteen rates; the attenuation per frame | periodic noise, the three fixed rates |

## Known deviations

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| A write reaches the YM2612 on the internal cycle that starts at or after its master cycle, one write per cycle | yes | The 68000 cannot write faster; the oracle's driver takes the same convention | when a register lands, to within one internal cycle |
| The PSG's noise flip-flop and the exact reload of a period of 0 or 1 are as SMS Power describes them | unverified | no oracle and no test ROM for the PSG yet | the noise's rate; tones at periods 0 and 1 |
| The YM2612 is the discrete one, with the ladder DAC, not the YM3438 | yes | it is the sound of the Model 1 and early Model 2; a `type` on the chip picks the other | the pins, not the digital voices |

## Power-on state

`reset()` is Nuked's `OPN2_Reset`: every operator in release at the bottom of
its envelope, multiples at 1, pan on both sides, and the PSG silent at every
attenuator. The driver's power-on turns the LFO off, sets channel 3 normal, the
DAC off and every key off, which is what a game's driver did first.

## History

- 2026-09-04: the port, the driver, the corpus. The first run against Nuked was
  93 % identical with every run aligned under a shift of at most 41 cycles: the
  trace stamped a change at the end of the internal cycle and the oracle at its
  start, and a write was delivered on the cycle after its stamp rather than the
  one starting at it. Both conventions made the oracle's, every script went to
  100 %.

## Sources

Written from:

- Nuked-OPN2 1.0.12, Alexey Khokholov, the YM2612.
- SMS Power, "SN76489 notes", the PSG.
- Sega, "Mega Drive hardware manual", the addresses and the clocks.

Verified against:

- Nuked-OPN2, built natively, in `packages/conform/oracles/nuked-opn2`.
