# Game Boy APU (`dmg`)

<p align="center">
  <a href="dmg.md">English</a> &bull;
  <a href="dmg_ja.md">日本語</a>
</p>


The Game Boy's sound, in the DMG's CPU: two pulses, the first with a frequency
sweep, a wave channel playing thirty-two 4-bit samples out of RAM, and a noise
generator, mixed to stereo through two volume controls. The method behind every
section is in [CONFORMANCE.md](../CONFORMANCE.md).

| | |
| --- | --- |
| **Machine** | Game Boy (DMG), 4194304 Hz |
| **Status** | **in progress**: every test ROM passes, the driver plays every voice, the oracle is a weak one, the analog stage is unmeasured |
| **Core** | own, `packages/chipvoice/src/chips/gb/dsp.ts`, written from Pan Docs and blargg's "Game Boy Sound Operation" |
| **Licence of the core** | MIT |
| **Sheet updated** | 2026-09-27, by hand and by `conform` |

## Digital parity

Measured by [`conform`](../../packages/conform), the harness, against
[Gb_Snd_Emu 0.1.4](../../packages/conform/oracles/gb-snd-emu), blargg's Game Boy
APU from 2005, on all four voices, over a song through the driver and six
scripts in [`packages/conform/corpus/dmg`](../../packages/conform/corpus/dmg). The numbers
between the markers are written by the harness (`pnpm --filter chipvoice-conform
baseline:dmg`); the reading of them below is a person's. CI reruns the corpus and
fails if any voice's identical count falls below the committed baseline.

<!-- parity:begin -->
Written by `conform` on 2026-09-27, against Gb_Snd_Emu 0.1.4 (blargg), on ch1, ch2, ch3, ch4.

| | |
| --- | --- |
| Oracle | Gb_Snd_Emu 0.1.4 (blargg) |
| Corpus | 7 logs, 145122916 cycles |
| Identical cycles | 83287893 / 145122916 (57.3913 %) |
| Logs with a divergence | 7 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-envelopes | 42.8880 % | cycle 419430, ch1: ours 0, oracle 15 | ch1 52.6199 %, 1/0/6385; runs 3129: 3123 on times, 3103 on values, shift <= 1146729; ch2 82.1732 %, 2/0/1298; runs 631: 631 on times, 631 on values, shift <= 180313; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-lengths | 79.8947 % | cycle 419430, ch1: ours 0, oracle 15 | ch1 94.3298 %, 0/0/492; runs 244: 244 on times, 244 on values, shift <= 12343767; ch2 95.4753 %, 0/0/438; runs 216: 216 on times, 216 on values, shift <= 13925083; ch3 90.8527 %, 0/0/3901; runs 1: 0 on times, 0 on values, shift <= 0; ch4 99.2370 %, 0/0/1270; runs 1: 0 on times, 0 on values, shift <= 0 |
| script-noise | 63.8646 % | cycle 419878, ch4: ours 0, oracle 15 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 63.8646 %, 4/32991/301956 (32995 at -7); runs 472: 326 on times, 289 on values, shift <= 157119 |
| script-pulses | 43.3493 % | cycle 419430, ch2: ours 0, oracle 15 | ch1 67.7054 %, 2/198/7284 (198 at -1); runs 1957: 1953 on times, 1952 on values, shift <= 9767; ch2 63.9991 %, 3/0/3924; runs 1416: 1414 on times, 1413 on values, shift <= 28055; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-sweep | 78.7511 % | cycle 419430, ch1: ours 0, oracle 15 | ch1 78.7511 %, 0/0/1459; runs 631: 625 on times, 625 on values, shift <= 2919121; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-wave | 74.0036 % | cycle 419430, ch3: ours 0, oracle 1 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 74.0036 %, 6/0/14612; runs 912: 909 on times, 908 on values, shift <= 1513; ch4 100.0000 %, 0/0/0 |
| song-golden | 8.4267 % | cycle 419430, ch3: ours 0, oracle 1 | ch1 60.7225 %, 8/41/6257 (41 at -1); runs 1579: 1561 on times, 1555 on values, shift <= 94210; ch2 76.5812 %, 0/0/4146; runs 1036: 1036 on times, 1036 on values, shift <= 128888; ch3 14.7736 %, 17/0/11879; runs 410: 391 on times, 391 on values, shift <= 2679; ch4 77.6376 %, 5/0/104673 (22293 at +7); runs 328: 212 on times, 190 on values, shift <= 638199 |
<!-- parity:end -->

**What the numbers say.** Read the last column, not the first. On every voice
nearly every run of edges lines up with the oracle's under a shift of its own,
on step times and on values: the pulses' duty cycles and rates, every envelope
in both directions, the wave sequence at all three levels, the noise register's
pattern in both widths. The identical-cycle count is low because the oracle and
the chip disagree on *when a note starts*, systematically: Gb_Snd_Emu takes a
voice's first step the moment it is triggered and does not reload the timer,
where the hardware reloads it and steps a full period later; its frame clock
ticks at time zero rather than on the divider's bit; its duty patterns for 50
and 75 percent are rotated. Each of those shifts every note by a constant, and
every shifted note counts as different on every cycle. The remaining unmatched
edges are the oracle's missing features: no zombie envelope, a sweep that
applies its frequency a period late, a wave channel that plays its first sample
at once. The oracle's [README](../../packages/conform/oracles/gb-snd-emu/README.md)
lists them; none is a chipvoice deviation from Pan Docs or from blargg's ROMs,
which check the hardware to the cycle and pass. What this oracle confirms that
no ROM does: the short noise sequence's pattern, and the envelope's steps. A
stronger oracle, below, checks the same corpus against a cycle-accurate core.

### Against SameBoy

A second oracle, [SameBoy](../../packages/conform/oracles/sameboy) configured
as a DMG-B: a cycle-accurate core with DACs, a power switch and a
divider-driven frame sequencer, the same model this chip is written against.
Measured the same way, on the same corpus (`pnpm --filter chipvoice-conform
baseline:sameboy`); its own baseline is
[`corpus/dmg/parity-sameboy.json`](../../packages/conform/corpus/dmg/parity-sameboy.json)
so Gb_Snd_Emu's stays the board's.

<!-- parity-sameboy:begin -->
Written by `conform` on 2026-09-27, against SameBoy (DMG-B), on ch1, ch2, ch3, ch4.

| | |
| --- | --- |
| Oracle | SameBoy (DMG-B) |
| Corpus | 7 logs, 145122916 cycles |
| Identical cycles | 94903246 / 145122916 (65.3951 %) |
| Logs with a divergence | 7 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-envelopes | 35.9201 % | cycle 419430, ch1: ours 15, oracle 0 | ch1 40.3142 %, 7/0/5006; runs 3130: 1760 on times, 1742 on values, shift <= 8746022; ch2 89.6732 %, 6/0/1111; runs 631: 463 on times, 463 on values, shift <= 1863679; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-lengths | 92.8843 % | cycle 419430, ch1: ours 15, oracle 0 | ch1 98.0820 %, 0/0/460; runs 245: 214 on times, 214 on values, shift <= 12589601; ch2 95.8000 %, 0/0/314; runs 217: 96 on times, 96 on values, shift <= 15103782; ch3 100.0000 %, 1946/0/0; runs 1: 1 on times, 1 on values, shift <= 0; ch4 99.0024 %, 0/0/626; runs 1: 0 on times, 0 on values, shift <= 0 |
| script-noise | 52.1127 % | cycle 419909, ch4: ours 15, oracle 0 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 52.1127 %, 7/0/338741 (132099 at -8); runs 472: 293 on times, 254 on values, shift <= 1351482 |
| script-pulses | 49.6683 % | cycle 419430, ch2: ours 15, oracle 0 | ch1 54.8284 %, 0/0/7174 (1 at -6); runs 1957: 1607 on times, 1606 on values, shift <= 3598818; ch2 90.7619 %, 5/0/3444 (1418 at -6); runs 1417: 1005 on times, 1004 on values, shift <= 6156926; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-sweep | 78.6408 % | cycle 419430, ch1: ours 15, oracle 0 | ch1 78.6408 %, 0/0/1567 (1 at -7); runs 633: 627 on times, 626 on values, shift <= 6400228; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-wave | 86.0895 % | cycle 6720891, ch3: ours 10, oracle 11 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 86.0895 %, 7001/0/1927; runs 912: 907 on times, 907 on values, shift <= 2097224; ch4 100.0000 %, 0/0/0 |
| song-golden | 61.6399 % | cycle 424229, ch4: ours 13, oracle 0 | ch1 96.3677 %, 20/0/6313 (772 at -4); runs 1579: 1561 on times, 1560 on values, shift <= 103170; ch2 99.9433 %, 0/0/4144 (836 at -6); runs 1036: 1036 on times, 1036 on values, shift <= 6; ch3 99.9822 %, 2969/2988/0 (2988 at +1); runs 410: 400 on times, 400 on values, shift <= 1; ch4 63.5568 %, 564/535/159956 (1813 at -3); runs 328: 184 on times, 134 on values, shift <= 6634087 |
<!-- parity-sameboy:end -->

**What the numbers say.** SameBoy reloads a triggered voice's timer, ticks its
frame sequencer on the divider's own bit 12, and its duty patterns are Pan
Docs' order, so none of Gb_Snd_Emu's constant-shift causes (its own 256 Hz
clock, its untimed trigger, its rotated duties) apply here. What is left
instead is one dominant, previously undiagnosed cause common to almost every
log, plus four narrower findings, each below with both values, a cycle, and
the source it cites. None of them is a chipvoice deviation from Pan Docs or
blargg's ROMs, which continue to pass; every cycle, voice and value pair is in
[`corpus/dmg/parity-sameboy.json`](../../packages/conform/corpus/dmg/parity-sameboy.json).

- **A freshly-triggered pulse or noise voice is not instant on real hardware,
  and we do not model that.** This is the majority of every log's remaining
  gap (`script-envelopes` 35.92 %, `script-pulses` 49.67 %, `script-noise`
  52.11 %). At `script-pulses`' first divergence, cycle 419430, `ours` reads
  15 the instant NR14's trigger bit lands; SameBoy reads 0 there and keeps
  reading 0 until cycle 457327 (pulse 1, `script-sweep`) or a comparable gap
  elsewhere, then jumps straight to the value the duty position and volume
  say it should be. `vendor/apu.c`'s NR14/NR24 trigger case sets a `delay`
  field (`6 + lf_div * ...` cold, `4 - lf_div + extra_delay` if the channel
  was already active) into the timer reload and marks the channel
  `sample_surpressed` until its own first natural tick clears it, with the
  comment: "The volume changes caused by NRx4 sound start take effect
  instantly ... The playback itself is not instant which is why we don't
  update the sample for other cases." `dsp.ts`'s wave channel already models
  exactly this (the "first fetch after a trigger is 6 cycles late" row
  below); `Pulse` and `Noise` do not, and read the current duty or LFSR bit
  the moment the trigger lands. This is a real gap worth its own ticket
  (P2-1), not something to fix here.
- **Sweep, in the low shift/period regime, disagrees on whether overflow
  silences the channel** ([Pan Docs, "Sound Channel 1 - Pulse with period
  sweep"](https://gbdev.io/pandocs/Audio_Registers.html#ff10--nr10-channel-1-sweep)).
  `script-sweep`'s first segment (NR10 = `$11`: period 1, add, shift 1, from
  frequency 856 at cycle 419430) is the clearest case: `ours` steps the
  frequency up three times and then goes silent for good at cycle 483327
  (frequency crossed 2047), matching Pan Docs' "if this new frequency is
  2047 or more, this channel is turned off" and the corpus's other four
  segments, where the two traces agree closely. SameBoy instead keeps
  outputting a steady tone at a period of 32768 cycles all the way to the
  next trigger at cycle 3774874, 3.3 million cycles later. `vendor/apu.c`'s
  own comment on `sweep_calculation_done` explains why: "APU bug: sweep
  frequency is checked after adding the sweep delta twice" - SameBoy checks
  overflow against a shadow frequency plus a doubled sweep addend
  (`shadow_sweep_sample_length`, `sweep_length_addend`, both built up across
  `trigger_sweep_calculation` and a delayed `square_sweep_calculate_countdown`),
  a documented DMG quirk that at small shifts can mask an overflow the
  single, undoubled check our model performs would catch. blargg's ROM 05,
  "sweep details", targets exactly this doubling; the scripted corpus's other
  five sweep segments (larger shifts and periods, or subtract) do not expose
  it and read within the same small residual shift as every other voice.
- **Length counters agree**: `script-lengths` is the corpus's best log
  (92.88 %); channel 3's 1946 edges are all exact and channel 4's are 99.00 %,
  so the 256 Hz clock and the "extra clock on an NRx4 write" glitch
  ([Pan Docs, "Length Timer"](https://gbdev.io/pandocs/Audio_Registers.html#length-timer),
  blargg's ROM 07) read the same on both. Channels 1 and 2's remaining gap
  (98.08 % and 95.80 %) is the same cold-trigger-silence cause above, not a
  length-specific one; this log never writes NR52 to power off, so it does
  not exercise power-cycle survival either way (a gap in the corpus, not a
  result).
- **The wave channel's first sample after a trigger matches; a later sample
  is occasionally one step early, then self-corrects.** At `script-wave`'s
  own trigger, cycle 6710886, both traces read 2 on the same cycle: SameBoy's
  `wave_channel` delay model and `dsp.ts`'s (Known deviations, below) are too
  close for this driver's timing resolution to tell apart, so this run
  neither confirms nor newly contradicts the "6 cycles late" claim. The
  log's one real divergence is mid-playback, far from any trigger: at cycle
  6720891, `ours` reads sample value 10 where SameBoy reads 11, one step
  ahead of schedule; SameBoy's very next sample (500 cycles later, at
  6721391) reverts to 10 and both traces are exact again from the following
  sample on, with no lasting shift. This shape (one sample early, then an
  immediate, exact resync) recurs 912 times over the log, 907 of them lining
  up under a shift of their own, which is this oracle's own 2-T-cycle
  `apu_cycles` batching (see the oracle's
  [README](../../packages/conform/oracles/sameboy/README.md)), not a
  wave-sequence disagreement: every sample's value is right, only one
  transition's cycle is occasionally rounded to the wrong side of a 2-cycle
  boundary.
- **The noise LFSR's silent-at-trigger convention is the same, spelled with
  opposite polarity; its cold-start is the same suppression as the squares'.**
  `dsp.ts` seeds the LFSR to `0x7fff` and reads bit 0 as "silent"; SameBoy's
  `prepare_noise_start` seeds it to 0 and reads bit 0 as "on" - complementary
  encodings of the same fact, both silent the instant a fresh noise channel
  is triggered, per Pan Docs' "Noise Channel" and the `NR43` width bit's two
  feedback taps (bit 14 always, bit 6 added when the width bit is set),
  which both implementations use. `script-noise`'s 52.11 % is the same
  cold-trigger-silence cause as the pulses, not a fresh finding about the
  LFSR itself: channel 4's edges align 132099 of 154713 under a shift of -8,
  the signature of a suppressed cold start followed by an exact resync.
- **Zombie-mode envelope writes are exercised (`script-envelopes`' own notes
  say so: "a zombie write mid-note") and the two models agree on the
  simple case, diverge on the compound one.** At cycle 20132659, NR12 is
  written `$A0` to `$A1` while channel 1 is running (period 0 to 1, same
  direction): `dsp.ts`'s `oldPeriod === 0 -> volume++` reads 10 to 11 at
  the write itself; SameBoy's volume also becomes 11 (confirmed at its next
  natural duty edge, cycle 20134147, 1488 cycles later - within one duty
  period, and the only reason it is not visible at the write's own cycle is
  that channel 1's duty bit happened to be low there). At cycle 20552090,
  NR12 is written `$A1` to `$A9` (period still 1, but the envelope's
  direction flips): `dsp.ts` reads 3, SameBoy reads 7, and each holds its
  own value afterwards rather than converging. `vendor/apu.c`'s own comment
  on `nrx2_glitch` gives the likely reason: "on pre-CGB models *some* of
  these are non-deterministic. Specifically, $x0 writes seem to be
  non-deterministic while $x8 always work as expected" - for a DMG-B,
  `nrx2_glitch` runs `_nrx2_glitch` twice, once through an intermediate
  `0xFF`, a documented pre-CGB-D-specific model with no simple closed form;
  `dsp.ts`'s single-step formula (credited to blargg's own description of
  the glitch) is not that model, and this compound case (a direction flip
  with a non-zero period, on top of an already-shifted volume) is where the
  two part ways. Real DMG zombie mode is itself acknowledged, in SameBoy's
  own words, as partly non-deterministic hardware behaviour; this is a
  genuine open question, not a bug to assign to either side.

**A pulse started from silence.** Since 2026-09-27 (P2-1), a pulse triggered
while off outputs a digital zero until its first duty step, whatever its
pattern holds where it starts. Pan Docs: "When first starting up a pulse
channel, it will _always_ output a (digital) zero." SameBoy's `apu.c` does the
same, suppressing the sample on every trigger that starts the channel until its
first tick. Gb_Snd_Emu plays the pattern at once, so the baseline above was
rewritten with fewer identical cycles on the pulse lines whose notes start from
silence, 5759 at most (`script-sweep`'s ch1), one step's worth per such note.
Against SameBoy, measured with ticket P3-4's oracle, the same change raises the
identical count on every log with a pulse. blargg's twelve ROMs pass either way;
none checks this.

## Test ROMs

blargg's `dmg_sound` suite, run on the harness's own SM83 with the chip on the
bus (`pnpm --filter chipvoice-conform roms:dmg`). Each ROM reports through
blargg's `$A000` protocol, a code and the text it printed.

<!-- roms:begin -->
Run by `conform`'s SM83 fixture on 2026-09-04: 12 of 12 pass.

| ROM | Result | What it said |
| --- | --- | --- |
| `dmg_sound/01-registers` | pass | 01-registers Passed |
| `dmg_sound/02-len_ctr` | pass | 02-len ctr 0 1 2 3 Passed |
| `dmg_sound/03-trigger` | pass | 03-trigger 0 1 2 3 Passed |
| `dmg_sound/04-sweep` | pass | 04-sweep Passed |
| `dmg_sound/05-sweep_details` | pass | 05-sweep details Passed |
| `dmg_sound/06-overflow_on_trigger` | pass | 06-overflow on trigger 0555 0666 071C 0787 07C1 07E0 07F0 0556 0667 071D 0788 07C2 07E1 07F1 Passed |
| `dmg_sound/07-len_sweep_period_sync` | pass | 07-len sweep period sync Passed |
| `dmg_sound/08-len_ctr_during_power` | pass | 08-len ctr during power 33 44 11 22 Passed |
| `dmg_sound/09-wave_read_while_on` | pass | 09-wave read while on FF FF 00 FF 11 FF 11 FF 22 FF 22 FF 33 FF 33 FF 44 FF 44 FF 55 FF 55 FF 66 FF 66 FF 77 FF 77 FF ... |
| `dmg_sound/10-wave_trigger_while_on` | pass | 10-wave trigger while on 00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE FF 00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE ... |
| `dmg_sound/11-regs_after_power` | pass | 11-regs after power Passed |
| `dmg_sound/12-wave_write_while_on` | pass | 12-wave write while on 00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE FF 00 11 22 33 44 55 66 77 88 99 AA BB CC DD EE F ... |
<!-- roms:end -->

The twelve cover: register read masks and power; the length counters, including
the extra clock on an NRx4 write and their survival through power off; the
trigger's effects on every voice; the sweep, its overflow check on the trigger
and its negate trap; the sync of length and sweep clocks to the divider; and the
wave channel's RAM while it plays: what a read returns, what a write lands on,
and the corruption a retrigger causes on the DMG.

## Formula tests

`packages/chipvoice/test/gb.mjs`, run on every push.

| Test | Result |
| --- | --- |
| Pulse rate `4194304 / (32 (2048 - f))`, at the envelope's volume | pass |
| Envelope steps one level per 64 Hz clock | pass |
| Wave channel steps a sample every `(2048 - f) * 2` cycles, RAM high nibble first, first fetch after the trigger | pass |
| NR32 level shifts | pass |
| Noise shifts every `divisor << shift` cycles; long sequence 32767, short 127 | pass |
| Length counters at 256 Hz; the extra clock on enable | pass |
| Sweep by `f >> shift` per period; overflow ends the voice, on the trigger too | pass |
| Power off clears registers, keeps lengths; NR52 and unused bits read back | pass |

## Analog stage

| | |
| --- | --- |
| Reference unit | none yet |
| Capture | none |
| Tolerance | |
| Maximum band error | unmeasured |
| Corners measured | none |
| Resampling | the output stage: each DAC's 0 to 15 centred on 7.5, summed per side under NR50 and NR51, a 28 Hz high-pass, one sample per period by stepping the T-cycle clock |

The DMG's DACs, its mixer and its headphone amplifier are unmeasured. The output
stage is a placeholder built to be replaced by a measurement: a linear DAC, a
sum, a high-pass. A real unit's line-out under a known script is what it needs.
[docs/HARDWARE-EVIDENCE.md](../HARDWARE-EVIDENCE.md#game-boy-dmg) has what was
found short of that: a public-domain formula for the high-pass that agrees
with the placeholder, and a teardown of the DMG's amplifier against the CGB's,
neither tied to a captured unit.

## Driver coverage

`GbDriver` in `packages/chipvoice/src/chips/gb/driver.ts`, checked by
`test/gb-driver.mjs`. The song's lead goes to pulse 1, its chord to pulse 2,
its bass to the wave channel, its percussion to the noise.

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| ch1, ch2 | all four duties; the envelope's starting volume, retriggered on every change; frequency changes without a trigger; silence at volume 0 with the DAC on | the sweep (written off), the hardware envelope's decay, the length counter, the DAC switched off |
| ch3 | wave RAM loaded while the channel is off, a triangle by default or the instrument's own 32 samples; the three levels; frequency changes without a trigger | the length counter, a write to RAM while playing, a retrigger while playing |
| ch4 | every one of the 2A03's sixteen rates mapped onto a divisor and shift; both widths; a decaying volume table fitted to the hardware envelope; rate changes mid-note | a rising envelope, the length counter, a retrigger mid-note |
| NR50, NR51 | written once at power-on: 7 both sides, every voice both sides | panning, the master volume |

## Known deviations

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| Stereo routing and master volume are not in the digital trace | yes | The trace is what each DAC is given; NR50 and NR51 act after the DACs and are the output stage's | parity only; the output stage applies them |
| The wave channel's first fetch after a trigger is 6 cycles late | no, but unverified either way | blargg's notes give the delay; his ROMs 09, 10 and 12 pass with it and are sensitive to it to within two cycles | the first sample of every wave note |
| The wave RAM corruption on a retrigger is one model of a glitch that varies between units | yes | SameBoy's notes say most DMG-B units behave this way and some do not; blargg's ROM 10 checks this model | wave RAM after a retrigger while playing |
| The CGB's differences are not here | yes | The chip is the DMG's; a `cgb` chip would share the code with the differences switched | Game Boy Color behaviour |

## Power-on state

`reset()` puts the chip where the DMG is after the boot ROM has run except for
the chime: powered on, every register zero, the frame sequencer about to clock
its first step, the noise register all ones, wave RAM zero. The boot ROM's chime
leaves pulse 1's registers set and the master volume at 7 on both sides; the
harness's Game Boy writes those before a ROM runs.

## History

- 2026-09-27: a pulse started from silence outputs a digital zero until its
  first duty step, as Pan Docs and SameBoy have it (P2-1); the Gb_Snd_Emu
  baseline was rewritten for it.
- 2026-09-04: the chip, from Pan Docs and blargg's notes; twelve of twelve
  dmg_sound ROMs after one fix, the wave corruption window moved to the two
  cycles before the fetch (`f636b9f`).
- 2026-09-27: a second, stronger oracle, SameBoy's DMG-B `apu.c` (ticket
  P3-4); it found a real gap chipvoice's squares and noise share and Gb_Snd_Emu
  never could have shown (a freshly-triggered voice is not instant on real
  hardware), plus a sweep-overflow and a zombie-mode divergence, both open
  questions rather than confirmed bugs. Ticket P2-1 tracks fixing the
  cold-trigger gap.

## Sources

Written from:

- Pan Docs, "Audio" and "Audio Registers", and its "Audio details" page.
- blargg, "Game Boy Sound Operation" (gbdev wiki), the obscure behaviour.

Verified against:

- blargg's dmg_sound test ROMs, in `packages/conform/roms/dmg_sound`.
- Gb_Snd_Emu 0.1.4, as a first implementation of the plain behaviour.
- SameBoy's `apu.c`, vendored whole as a second, stronger oracle
  (`packages/conform/oracles/sameboy`); read for the wave corruption's model
  and window, the trigger's cold-start suppression, the sweep's shadow-register
  overflow check and zombie mode's pre-CGB-D glitch.
