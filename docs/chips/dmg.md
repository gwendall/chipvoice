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
| Identical cycles | 83100551 / 145122916 (57.2622 %) |
| Logs with a divergence | 7 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-envelopes | 42.8902 % | cycle 419432, ch1: ours 0, oracle 15 | ch1 52.6199 %, 1/0/6385; runs 3129: 3123 on times, 3103 on values, shift <= 1146729; ch2 82.1773 %, 2/0/1298; runs 631: 631 on times, 631 on values, shift <= 180315; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-lengths | 79.8947 % | cycle 419432, ch1: ours 0, oracle 15 | ch1 94.3298 %, 0/0/492; runs 244: 244 on times, 244 on values, shift <= 12343767; ch2 95.4753 %, 0/0/438; runs 216: 216 on times, 216 on values, shift <= 13925083; ch3 90.8527 %, 0/0/3901; runs 1: 0 on times, 0 on values, shift <= 0; ch4 99.2370 %, 0/0/1270; runs 1: 0 on times, 0 on values, shift <= 0 |
| script-noise | 64.0117 % | cycle 419880, ch4: ours 0, oracle 15 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 64.0117 %, 5/32991/301954 (32995 at -9); runs 472: 326 on times, 289 on values, shift <= 157119 |
| script-pulses | 43.3493 % | cycle 419432, ch2: ours 0, oracle 15 | ch1 67.7054 %, 2/198/7284 (198 at -1); runs 1957: 1953 on times, 1952 on values, shift <= 9767; ch2 63.9991 %, 3/0/3924; runs 1416: 1414 on times, 1413 on values, shift <= 28055; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-sweep | 78.7510 % | cycle 419432, ch1: ours 0, oracle 15 | ch1 78.7510 %, 0/0/1459; runs 631: 625 on times, 625 on values, shift <= 2919123; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-wave | 74.0036 % | cycle 419432, ch3: ours 0, oracle 1 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 74.0036 %, 6/0/14612; runs 912: 909 on times, 908 on values, shift <= 1513; ch4 100.0000 %, 0/0/0 |
| song-golden | 7.1197 % | cycle 0, ch3: ours 0, oracle 1 | ch1 66.2346 %, 5/0/6519; runs 1623: 1615 on times, 1606 on values, shift <= 97787; ch2 80.0688 %, 0/0/4255; runs 1063: 1062 on times, 1062 on values, shift <= 136043; ch3 12.7521 %, 18/0/12165; runs 420: 400 on times, 400 on values, shift <= 2679; ch4 77.8509 %, 8/0/106661 (26672 at +7); runs 331: 199 on times, 153 on values, shift <= 1463649 |
<!-- parity:end -->

**What the numbers say.** Read the last column, not the first. On every voice
nearly every run of edges lines up with the oracle's under a shift of its own,
on step times and on values: the pulses' duty cycles and rates, every envelope
in both directions, the wave sequence at all three levels, the noise register's
pattern in both widths. The identical-cycle count is low because the oracle and
the chip disagree on *when a note starts*, systematically: Gb_Snd_Emu takes a
voice's first step the moment it is triggered and does not reload the timer,
where blargg's notes have the hardware reload it and step a full period later
(for the noise, an open question: see SameBoy below); its frame clock
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
| Identical cycles | 137604380 / 145122916 (94.8192 %) |
| Logs with a divergence | 6 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-envelopes | 97.4779 % | cycle 427391, ch1: ours 15, oracle 0 | ch1 97.4918 %, 49/0/6313 (2903 at -4); runs 3129: 3128 on times, 3124 on values, shift <= 10692; ch2 99.9851 %, 22/0/1252 (454 at -4); runs 631: 631 on times, 631 on values, shift <= 8; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-lengths | 99.6205 % | cycle 429451, ch1: ours 15, oracle 0 | ch1 99.9909 %, 0/0/488 (244 at -8); runs 244: 244 on times, 244 on values, shift <= 8; ch2 99.9919 %, 0/0/432 (216 at -8); runs 216: 216 on times, 216 on values, shift <= 8; ch3 100.0000 %, 1946/0/0; runs 1: 1 on times, 1 on values, shift <= 0; ch4 99.6377 %, 1/0/1250; runs 1: 1 on times, 1 on values, shift <= 124 |
| script-noise | 77.7483 % | cycle 419903, ch4: ours 0, oracle 15 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 77.7483 %, 24/0/368036 (132099 at -4); runs 472: 452 on times, 440 on values, shift <= 57048 |
| script-pulses | 99.8781 % | cycle 433459, ch1: ours 15, oracle 0 | ch1 99.9147 %, 8/0/7668 (3108 at -4); runs 1957: 1956 on times, 1956 on values, shift <= 8; ch2 99.9622 %, 7/0/3910 (1890 at -4); runs 1416: 1416 on times, 1416 on values, shift <= 8; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-sweep | 99.9727 % | cycle 443271, ch1: ours 15, oracle 0 | ch1 99.9727 %, 1/0/1460 (729 at -8); runs 631: 631 on times, 631 on values, shift <= 8; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-wave | 100.0000 % | none | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 7312/0/0; runs 912: 912 on times, 912 on values, shift <= 0; ch4 100.0000 %, 0/0/0 |
| song-golden | 87.4468 % | cycle 4643, ch4: ours 0, oracle 13 | ch1 99.9228 %, 20/0/6480 (3240 at -4); runs 1623: 1623 on times, 1623 on values, shift <= 4; ch2 99.9493 %, 2/0/4250 (2125 at -4); runs 1063: 1062 on times, 1062 on values, shift <= 4; ch3 100.0000 %, 6101/0/0; runs 420: 420 on times, 420 on values, shift <= 0; ch4 87.5588 %, 6200/0/94255 (7116 at -8); runs 331: 202 on times, 167 on values, shift <= 1499072 |
<!-- parity-sameboy:end -->

**What the numbers say.** SameBoy reloads a triggered voice's timer, ticks its
frame sequencer on the divider's own bit 12, and its duty patterns are Pan
Docs' order, so none of Gb_Snd_Emu's constant-shift causes (its own 256 Hz
clock, its untimed trigger, its rotated duties) apply here. Most of what an
earlier version of this table read as a large, hardware-level gap turned out
to be this driver's own bug, not SameBoy's or ours: `main.c` re-sorted an
already-ordered write list with `qsort`, and `qsort`'s ordering of writes
that share a cycle - common in the corpus, where a channel's setup registers
and its trigger are routinely logged on the same cycle - is unspecified by
the C standard and came out differently on glibc and on Apple's libc, so the
one, unmodified `vendor/apu.c` genuinely disagreed with itself across
compilers (CI caught it: gcc and clang produced different traces from the
same build). The writes were already in the log's own correct order
(`formatLog` in `log.mjs` sorts stably before writing the file, and `main.c`'s
own read loop already rejects anything out of order), so the sort was both
redundant and the only non-deterministic step in the whole driver; removing
it (see `main.c`) fixed the cross-compiler mismatch and, as a side effect,
raised every script log from the 35-90 % range to 97-100 % - including
`script-sweep` and `script-wave`, whose apparent hardware disagreements in an
earlier version of this table were entirely this bug and are not findings.
What is left, identical on both compilers now, is below: a pulse's first step
a few cycles early, the noise clock's phase at a trigger, and a zombie-mode
compound case. P2-1 read each against the documents: none is changed in the
core, the first two are recorded in "Known deviations" below, and the third is
nondeterministic on the hardware. Every cycle, voice and value pair is in
[`corpus/dmg/parity-sameboy.json`](../../packages/conform/corpus/dmg/parity-sameboy.json).

- **A pulse's first step comes 4 or 8 cycles before SameBoy's, and every edge
  after it keeps that offset.** Before #86, `Pulse` played its pattern the
  instant a trigger landed, and `script-envelopes`' first note differed from
  SameBoy's by 7969 cycles, one whole duty step. #86 (P2-1) gave it Pan Docs'
  digital zero until its first duty step (see "A pulse started from silence"
  below), which closes that step. What remains is when the step starts:
  `dsp.ts` reloads the timer on the trigger's own cycle, and SameBoy's trigger
  adds a short delay to the reload, a different one cold and while playing.
  On the corpus, `dsp.ts`'s first edge of a note comes 8 or 4 cycles, now
  and then 0, before SameBoy's. Pan Docs gives part of it: "When triggering Ch1 and Ch2,
  the low two bits of the frequency timer are NOT modified", which `dsp.ts`
  does not keep. That is at most 3 cycles, and no document we follow gives
  the rest. It costs every pulse line less than 0.1 point, the zombie case
  below aside.
- **Length counters agree**: `script-lengths` is at 99.62 %; channel 3's 1946
  edges are all exact, so the 256 Hz clock and the "extra clock on an NRx4
  write" glitch
  ([Pan Docs, "Length Timer"](https://gbdev.io/pandocs/Audio_Registers.html#length-timer),
  blargg's ROM 07) read the same on both. Channels 1 and 2's remaining gap
  (99.99 % each) is the pulse's first step above, and channel 4's (99.64 %)
  the noise clock below, neither a length one. This log never writes NR52 to
  power off, so it does not exercise power-cycle survival either way (a gap
  in the corpus, not a result).
- **The noise voice: a whole missing note was the corpus's doing; what is
  left is when a note's first step comes.** Both LFSRs start silent, spelled
  with opposite polarity: `dsp.ts` seeds `0x7fff` and reads bit 0 as silent,
  SameBoy seeds 0 and reads bit 0 as on, the same fact per Pan Docs' "Noise
  Channel".
  - *Fixed in the corpus (P2-1).* On a DMG, SameBoy starts a triggered noise
    voice at once only when its 2 MHz `alignment` is a multiple of 4;
    otherwise it waits 6 cycles and triggers again, and an odd alignment stays
    odd, so the note never starts. A real CPU writes on whole M-cycles, which
    keeps that alignment even. The corpus stamped writes at any T-cycle, and
    `script-noise`'s first trigger, at cycle 419430, was one no program can
    make: SameBoy stayed silent for that whole note. `generate-dmg.mjs` now
    moves every write to the nearest M-cycle, and channel 4 goes from 52.11 %
    to 77.75 % on `script-noise`; on `song-golden`, regenerated in the same
    change, it reads 87.56 %, from 63.49 %.
  - *Open: the noise clock across a trigger.* SameBoy steps the LFSR on the
    rise of one bit of a counter, the bit the clock shift picks, and that
    counter keeps running from one note to the next, so the first step after
    a trigger comes whenever that bit next rises. `dsp.ts` reloads the
    voice's timer on the trigger, so its first step is one full period later.
    The same sequence plays on both, started up to one step apart: on
    `script-noise`, `dsp.ts`'s first step comes 8 cycles after SameBoy's on
    the first note, which finds SameBoy's counter at zero, then anywhere from
    4 cycles before it to 6872 cycles after it (1.6 ms, at `$6F`), and a note
    whose steps are offset that far matches on few cycles.
    The documents disagree. The gbdev wiki's "Trigger Event", from blargg's
    notes, lists "Frequency timer is reloaded with period" for every channel,
    which `dsp.ts` follows. Pan Docs' NR44 lists what a trigger does and a
    timer reload is not among them, and its note that a clock shift of 14 or
    15 stops the LFSR fits a 14-bit counter. No published capture settles it
    ([HARDWARE-EVIDENCE.md](../HARDWARE-EVIDENCE.md)), so the core stays as
    written until a unit does (P3-5), rather than being changed from a
    reading of SameBoy's code.
- **Zombie-mode envelope writes are exercised (`script-envelopes`' own notes
  say so: "a zombie write mid-note") and the two models agree on the
  simple case, diverge on the compound one.** At cycle 20132659, NR12 is
  written `$A0` to `$A1` while channel 1 is running (period 0 to 1, same
  direction): `dsp.ts`'s `oldPeriod === 0 -> volume++` reads 10 to 11 at
  the write itself; SameBoy's volume also becomes 11 (confirmed at its next
  natural duty edge, cycle 20138149, within one duty period, and the only
  reason it is not visible at the write's own cycle is that channel 1's
  duty bit happened to be low there). At cycle 20552090,
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
  genuine open question, not a bug to assign to either side, and P2-1 leaves
  it open.

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
| A pulse trigger reloads its whole timer | no, a later fix | Pan Docs: "When triggering Ch1 and Ch2, the low two bits of the frequency timer are NOT modified", at most 3 cycles on a note's first step. SameBoy starts that step 4 or 8 cycles after `dsp.ts` does, and no document we follow gives the rest of that delay | the first duty step of every pulse note |
| The noise voice's timer is reloaded on a trigger | no, unverified either way | The gbdev wiki's "Trigger Event" reloads every channel's frequency timer; Pan Docs' NR44 does not list a reload, and SameBoy keeps its noise counter running across triggers. No published capture settles it (P3-5) | the first LFSR step of every noise note, by up to one step |
| The CGB's differences are not here | yes | The chip is the DMG's; a `cgb` chip would share the code with the differences switched | Game Boy Color behaviour |

## Power-on state

`reset()` puts the chip where the DMG is after the boot ROM has run except for
the chime: powered on, every register zero, the frame sequencer about to clock
its first step, the noise register all ones, wave RAM zero. The boot ROM's chime
leaves pulse 1's registers set and the master volume at 7 on both sides; the
harness's Game Boy writes those before a ROM runs.

## History

- 2026-09-27: P2-1's second pass. The corpus is written on whole M-cycles, as a
  CPU writes, which gives SameBoy back a noise note it never started;
  `song-golden` is regenerated through today's driver. The pulse's trigger
  delay and the noise clock across a trigger are recorded as deviations, the
  zombie compound case as nondeterministic on the hardware.
- 2026-09-27: a second, stronger oracle, SameBoy's DMG-B `apu.c` (ticket
  P3-4). It found that a triggered pulse or noise voice does not start where
  chipvoice starts it, and a zombie-mode divergence; its apparent sweep and
  wave disagreements were its driver's own write-order bug, fixed before it
  merged.
- 2026-09-27: a pulse started from silence outputs a digital zero until its
  first duty step, as Pan Docs and SameBoy have it (P2-1); the Gb_Snd_Emu
  baseline was rewritten for it.
- 2026-09-04: the chip, from Pan Docs and blargg's notes; twelve of twelve
  dmg_sound ROMs after one fix, the wave corruption window moved to the two
  cycles before the fetch (`f636b9f`).

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
