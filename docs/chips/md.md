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
| **Status** | **in progress**: the FM chip is identical to the die-derived reference on every script, the driver plays every role, the PSG is compared against MAME's `sn76496` with three diagnosed divergences (period 0/1, reset polarity, tone-3-rate noise phase), the analog stage is unmeasured |
| **Core** | the YM2612 ported line for line from Nuked-OPN2 (`packages/chipvoice/src/chips/md/ym2612.ts`); the SN76489 written from SMS Power's notes (`sn76489.ts`) |
| **Licence of the core** | `ym2612.ts` is a line-for-line port of Nuked-OPN2 and carries its LGPL 2.1; everything else in the package is MIT. The package's licence field says both |
| **Sheet updated** | 2026-09-27, by hand and by `conform` |

## Digital parity

Measured by [`conform`](../../packages/conform), the harness, against
[Nuked-OPN2](../../packages/conform/oracles/nuked-opn2), on the six FM voices,
over two songs through the driver and five scripts in
[`packages/conform/corpus/md`](../../packages/conform/corpus/md). The numbers
between the markers are written by the harness (`pnpm --filter chipvoice-conform
baseline:md`); the reading of them below is a person's. CI reruns the corpus and
fails if any voice's identical count falls below the committed baseline.

<!-- parity:begin -->
Written by `conform` on 2026-09-27, against Nuked-OPN2 1.0.12 (Nuke.YKT), on fm1, fm2, fm3, fm4, fm5, fm6.

| | |
| --- | --- |
| Oracle | Nuked-OPN2 1.0.12 (Nuke.YKT) |
| Corpus | 8 logs, 2233636083 cycles |
| Identical cycles | 2233636083 / 2233636083 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-algorithms | 100.0000 % | none | fm1 100.0000 %, 241084/0/0; runs 1182: 1182 on times, 1182 on values, shift <= 0; fm2 100.0000 %, 0/0/0; fm3 100.0000 %, 0/0/0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
| script-detune-lfo | 100.0000 % | none | fm1 100.0000 %, 235695/0/0; runs 1785: 1785 on times, 1785 on values, shift <= 0; fm2 100.0000 %, 195942/0/0; runs 106: 106 on times, 106 on values, shift <= 0; fm3 100.0000 %, 84832/0/0; runs 1862: 1862 on times, 1862 on values, shift <= 0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
| script-envelopes | 100.0000 % | none | fm1 100.0000 %, 171195/0/0; runs 6412: 6412 on times, 6412 on values, shift <= 0; fm2 100.0000 %, 126874/0/0; runs 3205: 3205 on times, 3205 on values, shift <= 0; fm3 100.0000 %, 10802/0/0; runs 1391: 1391 on times, 1391 on values, shift <= 0; fm4 100.0000 %, 125994/0/0; runs 872: 872 on times, 872 on values, shift <= 0; fm5 100.0000 %, 69981/0/0; runs 7353: 7353 on times, 7353 on values, shift <= 0; fm6 100.0000 %, 112/0/0; runs 9: 9 on times, 9 on values, shift <= 0 |
| script-psg-edges | 100.0000 % | none | fm1 100.0000 %, 0/0/0; fm2 100.0000 %, 0/0/0; fm3 100.0000 %, 0/0/0; fm4 100.0000 %, 0/0/0; fm5 100.0000 %, 0/0/0; fm6 100.0000 %, 0/0/0 |
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

### PSG parity, against MAME's sn76496

Measured against MAME's `sn76496.cpp`/`sn76496.h`, pinned at commit
`76c7d197ed46e844ffb1fbad5cc21c9ab3cdc9c0`, configured as `segapsg_device` -
the Sega VDP PSG the Mega Drive's own driver instantiates
(`315_5313.cpp:248`), on the master clock's fifteenth
(`megadriv.cpp:763`, `315_5124.h:66`) - and built natively in
[`packages/conform/oracles/sn76496`](../../packages/conform/oracles/sn76496),
on the four PSG voices, over the same corpus plus a script written for this
oracle's edge cases. The numbers between the markers are written by the
harness (`pnpm --filter chipvoice-conform baseline:sn76496`); the reading of
them below is a person's.

<!-- parity-sn76496:begin -->
Written by `conform` on 2026-09-27, against MAME sn76496 (Sega VDP PSG, 76c7d197), on psg1, psg2, psg3, noise.

| | |
| --- | --- |
| Oracle | MAME sn76496 (Sega VDP PSG, 76c7d197) |
| Corpus | 8 logs, 2233636083 cycles |
| Identical cycles | 1990757028 / 2233636083 (89.1263 %) |
| Logs with a divergence | 4 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-algorithms | 100.0000 % | none | psg1 100.0000 %, 0/0/0; psg2 100.0000 %, 0/0/0; psg3 100.0000 %, 0/0/0; noise 100.0000 %, 0/0/0 |
| script-detune-lfo | 100.0000 % | none | psg1 100.0000 %, 0/0/0; psg2 100.0000 %, 0/0/0; psg3 100.0000 %, 0/0/0; noise 100.0000 %, 0/0/0 |
| script-envelopes | 100.0000 % | none | psg1 100.0000 %, 0/0/0; psg2 100.0000 %, 0/0/0; psg3 100.0000 %, 0/0/0; noise 100.0000 %, 0/0/0 |
| script-psg-edges | 91.2304 % | cycle 8054100, psg1: ours 15, oracle 0 | psg1 97.2840 %, 69782/0/98450; runs 7235: 7232 on times, 7232 on values, shift <= 83239440; psg2 97.5309 %, 0/0/89494 (1 at -15); runs 4: 0 on times, 0 on values, shift <= 0; psg3 97.5309 %, 0/0/89492 (1 at -15); runs 4: 0 on times, 0 on values, shift <= 0; noise 98.8847 %, 0/0/3770; runs 1885: 1885 on times, 1885 on values, shift <= 9840 |
| script-psg | 44.3637 % | cycle 5369445, psg1: ours 15, oracle 0 | psg1 55.8823 %, 0/0/3874; runs 1935: 1935 on times, 1935 on values, shift <= 243840; psg2 51.7945 %, 0/0/2324; runs 1162: 1161 on times, 1161 on values, shift <= 2010; psg3 100.0000 %, 0/0/0; noise 93.2458 %, 426/0/3878; runs 2366: 2364 on times, 2364 on values, shift <= 564465 |
| script-ssg-ch3-dac | 100.0000 % | none | psg1 100.0000 %, 0/0/0; psg2 100.0000 %, 0/0/0; psg3 100.0000 %, 0/0/0; noise 100.0000 %, 0/0/0 |
| song-bright | 87.8041 % | cycle 6223425, noise: ours 0, oracle 13 | psg1 99.9999 %, 2066/0/10; runs 2071: 2071 on times, 2071 on values, shift <= 30; psg2 100.0000 %, 0/0/0; psg3 100.0000 %, 0/0/0; noise 87.8042 %, 3116/0/35151; runs 2840: 2377 on times, 2303 on values, shift <= 8695680 |
| song-golden | 87.8041 % | cycle 6223425, noise: ours 0, oracle 13 | psg1 99.9999 %, 2066/0/18; runs 2074: 2074 on times, 2074 on values, shift <= 30; psg2 100.0000 %, 0/0/0; psg3 100.0000 %, 0/0/0; noise 87.8042 %, 3116/0/35151; runs 2840: 2377 on times, 2303 on values, shift <= 8695680 |
<!-- parity-sn76496:end -->

**What the numbers say.** `script-algorithms`, `script-detune-lfo`,
`script-envelopes` and `script-ssg-ch3-dac` never touch the PSG, so they read
100 % trivially. The other four logs disagree with MAME, and every
disagreement traces to a real difference between `sn76489.ts` and MAME's
`segapsg_device`, not a harness bug:

- **A period of 0 or 1 is constant here, not the fastest tone there.**
  `sn76489.ts`'s `clock()` special-cases `period[i] <= 1` and holds the
  output high; MAME's `sound_stream_update()` has no such case and reloads
  and toggles every step regardless, so a period of 0 or 1 there plays the
  fastest tone the divider can produce, about 111861 Hz. SMS Power's SN76489
  notes state both readings - "if the register value is zero or one then the
  output is a constant value of +1" for tone generation, and separately, for
  sample playback, that the wave "does not flip-flop" at a half-wavelength of
  1 - but also derives the 111861 Hz figure from the same formula MAME's code
  follows uniformly. This chip keeps the constant-output reading; MAME's
  reading is the other one the same document allows. `script-psg-edges`
  shows this directly: tone 0 held at periods 0 through 64, one at a time.
- **Which polarity a channel starts at, before its first reload, differs.**
  `sn76489.ts`'s `reset()` sets `output.fill(1)` - every channel silent-but-high;
  `sn76496.cpp`'s `device_start()` sets `m_output[0..2] = 0` for the tone
  channels (`m_output[3]` instead takes the noise LFSR's own bit). Both
  models start each channel's counter at 0, so both reach their first reload
  at the same cycle - but that shared reload flips this core's output down
  and MAME's up, a one-time inversion that then holds for as long as the note
  does, on a channel unsilenced for the first time since reset before its
  first natural reload. `script-psg-edges` shows it plainly (tones 1 and 2,
  unsilenced straight onto small periods); `script-psg`'s first note shows it
  too (psg1 and psg2 both land near 51-56 %, an inverted square wave's own
  overlap with itself). Neither document states a power-on polarity for the
  flip-flop; this is a real implementation choice, not documented either way.
- **Tone 3's noise rate carries a residual phase MAME and this core disagree
  on.** For `(register[6] & 3) == 3`, MAME doubles tone 2's period
  (`m_period[3] = m_period[2] << 1`) and shifts the LFSR on every reload;
  `sn76489.ts`'s `noisePeriod()` returns tone 2's period undoubled and shifts
  only on alternate reloads (the "rising edge" of its own toggling output).
  The two conventions give the same net shift rate in steady state, but
  neither model resets its counter or output flag on a mode-only write to
  register 6, so the exact phase of the first reload after (re)configuring
  this mode depends on history neither model shares with the other. This
  shows as a large but constant offset wherever the mode is active - about
  1440 cycles in `song-bright`'s kit, not growing - rather than a drifting
  or a small one. Both readings are internally consistent with their own
  document; this is not fixable in the oracle itself.
- **The white noise LFSR's period from reset is 57337 shifts in MAME too,
  confirmed separately.** Running MAME's own `segapsg_device` from reset with
  a throwaway measurement program (not part of the committed corpus - the
  full period needs about 440 million master cycles, longer than is worth
  carrying there) counted exactly 57337 shifts before the shift register
  returned to its seed, and exactly 16 for the periodic mode: both match this
  sheet's formula-test figures precisely. `script-psg-edges` carries a
  shorter white-noise run (about 29000 shifts) for ordinary harness coverage,
  and a second write to the noise register while it is already running, to
  confirm the shift register resets again - both this core and MAME reset it
  unconditionally on any write to register 6, and the two agree everywhere
  in that run except for the tone-3-rate phase difference above when that
  mode is active.
- **The attenuation mapping matches.** MAME's raw register value at
  `m_register[2c+1]` read as `output[c] ? 15 - m_register[2c+1] : 0` is the
  same quantity `sn76489.ts`'s own `outputs()` computes
  (`output[i] ? 15 - attenuation[i] : 0`), and every volume step in
  `script-psg-edges`'s sweep, and psg3 throughout `script-psg` (never
  unsilenced, so never touched by the polarity divergence), reads identical
  to MAME cycle for cycle.

One open question was not chased further: `song-bright` and `song-golden`
unsilence psg1 for the first time since reset exactly like `script-psg`'s
first note does, yet psg1 reads 99.9999 % identical in both songs (all but 10
and 18 of about 2070 edges exact) while `script-psg`'s psg1 lands near 56 %.
The songs likely write frequency and volume in a different order, or
resynchronise some other way, before the note the driver plays first; this
was not traced further.

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
[docs/HARDWARE-EVIDENCE.md](../HARDWARE-EVIDENCE.md#mega-drive-ym2612-ym3438-sn76489)
has what published evidence exists short of that: named units and a
documented capture method (MDFourier), but no register sequence found yet to
render the same input against.

## Driver coverage

`MdDriver` in `packages/chipvoice/src/chips/md/driver.ts`, checked by
`test/md-driver.mjs`. The song's lead goes to FM 1, its bass to FM 2, its chord
to PSG 1, its percussion to the noise with tone 3 as its clock.

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| fm1, fm2 | a patch per intent, loaded once per channel; block and F-number per frame; the carriers' total levels per frame for the volume; key-on and key-off | the LFO, SSG-EG, channel 3's mode, the DAC, key scaling in the patches, four of the six channels |
| psg1 | the tone's period and attenuation per frame | psg2, psg3 as tones |
| noise | white noise clocked by tone 3 at the 2A03's sixteen rates; the attenuation per frame | periodic noise, the three fixed rates |

The native driver, `compileMdVoices` in `native-driver.ts`, checked by
`test/md-native.mjs` and `test/golden-md-native.mjs`, reaches what `MdDriver`
leaves out; a game writes for it directly ([MD-NATIVE-DRIVER.md](../MD-NATIVE-DRIVER.md)).

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| fm1 to fm6 | a patch per note, written as a diff of the last; hard pan; per-frame levels, bends, glides, vibrato and sweeps; legato; SSG-EG through `ssg`; key scaling | the LFO, channel 3's mode |
| psg1 to psg3 | tones with a per-frame envelope in dB | - |
| noise | white and periodic noise, clocked by tone 3 or at the three fixed rates | - |
| dac | a PCM stream on FM 6 at about 13.3 kHz, one sample per write on the bus | - |

## Known deviations

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| A write reaches the YM2612 on the internal cycle that starts at or after its master cycle, one write per cycle | yes | The 68000 cannot write faster; the oracle's driver takes the same convention | when a register lands, to within one internal cycle |
| A tone period of 0 or 1 holds the output constant instead of toggling at the divider's fastest rate | yes | SMS Power's SN76489 notes state both readings; MAME's `sn76496.cpp` takes the other one | tones at periods 0 and 1 |
| Every channel's output starts low (tone channels) or at the LFSR's own bit (noise) at reset, not high | no, undocumented | neither SMS Power nor MAME's comments state a power-on polarity; MAME's `segapsg_device` starts its tone channels low | a channel unsilenced for the first time since reset, before its first natural reload: a one-time, permanent phase inversion |
| Tone 3's noise rate does not double tone 2's period, and shifts the LFSR on alternate reloads rather than every one | yes, net rate matches | SMS Power's notes do not give the exact reload convention; the two conventions agree in steady state but not in the residual phase carried across a mode change | the noise's phase for as long as tone-3-rate is active after a mode-only write to register 6 |
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
- 2026-09-27: a second oracle for the PSG, MAME's `sn76496.cpp` configured as
  `segapsg_device`, plus a corpus script for its edge cases. Confirmed the
  white noise LFSR's 57337-shift period against MAME directly; diagnosed three
  real divergences (period 0/1, reset polarity, tone-3-rate noise phase),
  recorded above and in the Known deviations table.

## Sources

Written from:

- Nuked-OPN2 1.0.12, Alexey Khokholov, the YM2612.
- SMS Power, "SN76489 notes", the PSG.
- Sega, "Mega Drive hardware manual", the addresses and the clocks.
- MAME, `src/devices/sound/sn76496.cpp`/`.h`, pinned at commit
  `76c7d197ed46e844ffb1fbad5cc21c9ab3cdc9c0`, the PSG's second oracle.

Verified against:

- Nuked-OPN2, built natively, in `packages/conform/oracles/nuked-opn2`.
- MAME's `sn76496.cpp`, built natively as `segapsg_device`, in
  `packages/conform/oracles/sn76496`.
