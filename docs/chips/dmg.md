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
| Identical cycles | 83100392 / 145122916 (57.2621 %) |
| Logs with a divergence | 7 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-envelopes | 42.8902 % | cycle 419432, ch1: ours 0, oracle 15 | ch1 52.6199 %, 1/0/6385; runs 3129: 3123 on times, 3103 on values, shift <= 1146729; ch2 82.1773 %, 2/0/1298; runs 631: 631 on times, 631 on values, shift <= 180315; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-lengths | 79.8942 % | cycle 419432, ch1: ours 0, oracle 15 | ch1 94.3288 %, 0/0/492; runs 244: 244 on times, 244 on values, shift <= 12343768; ch2 95.4757 %, 0/0/438; runs 216: 216 on times, 216 on values, shift <= 13925084; ch3 90.8527 %, 0/0/3901; runs 1: 0 on times, 0 on values, shift <= 0; ch4 99.2370 %, 0/0/1270; runs 1: 0 on times, 0 on values, shift <= 0 |
| script-noise | 64.0117 % | cycle 419880, ch4: ours 0, oracle 15 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 64.0117 %, 5/32991/301954 (32995 at -9); runs 472: 326 on times, 289 on values, shift <= 157119 |
| script-pulses | 43.3493 % | cycle 419432, ch2: ours 0, oracle 15 | ch1 67.7054 %, 2/198/7284 (198 at -1); runs 1957: 1953 on times, 1952 on values, shift <= 9767; ch2 63.9991 %, 3/0/3924; runs 1416: 1414 on times, 1413 on values, shift <= 28055; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-sweep | 78.7509 % | cycle 419432, ch1: ours 0, oracle 15 | ch1 78.7509 %, 0/0/1459; runs 631: 625 on times, 625 on values, shift <= 2919126; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
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
| Identical cycles | 137606353 / 145122916 (94.8206 %) |
| Logs with a divergence | 6 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-envelopes | 97.4779 % | cycle 427391, ch1: ours 15, oracle 0 | ch1 97.4918 %, 49/0/6313 (2903 at -4); runs 3129: 3128 on times, 3124 on values, shift <= 10692; ch2 99.9851 %, 22/0/1252 (454 at -4); runs 631: 631 on times, 631 on values, shift <= 8; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-lengths | 99.6219 % | cycle 429451, ch1: ours 15, oracle 0 | ch1 99.9919 %, 0/0/488 (214 at -7); runs 244: 244 on times, 244 on values, shift <= 8; ch2 99.9924 %, 0/0/432 (120 at -8); runs 216: 216 on times, 216 on values, shift <= 8; ch3 100.0000 %, 1946/0/0; runs 1: 1 on times, 1 on values, shift <= 0; ch4 99.6377 %, 1/0/1250; runs 1: 1 on times, 1 on values, shift <= 124 |
| script-noise | 77.7483 % | cycle 419903, ch4: ours 0, oracle 15 | ch1 100.0000 %, 0/0/0; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 77.7483 %, 24/0/368036 (132099 at -4); runs 472: 452 on times, 440 on values, shift <= 57048 |
| script-pulses | 99.8781 % | cycle 433459, ch1: ours 15, oracle 0 | ch1 99.9147 %, 8/0/7668 (3108 at -4); runs 1957: 1956 on times, 1956 on values, shift <= 8; ch2 99.9622 %, 7/0/3910 (1890 at -4); runs 1416: 1416 on times, 1416 on values, shift <= 8; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
| script-sweep | 99.9805 % | cycle 443271, ch1: ours 15, oracle 0 | ch1 99.9805 %, 1/0/1460 (325 at -5); runs 631: 631 on times, 631 on values, shift <= 8; ch2 100.0000 %, 0/0/0; ch3 100.0000 %, 0/0/0; ch4 100.0000 %, 0/0/0 |
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

- **A pulse's first step still comes before SameBoy's, now by up to 5 cycles
  instead of 4 or 8 (P3-7).** Before #86, `Pulse` played its pattern the
  instant a trigger landed, and `script-envelopes`' first note differed from
  SameBoy's by 7969 cycles, one whole duty step. #86 (P2-1) gave it Pan Docs'
  digital zero until its first duty step (see "A pulse started from silence"
  below), which closes that step. P3-7 gave the timer itself Pan Docs'
  "Obscure Behavior": "When triggering Ch1 and Ch2, the low two bits of the
  frequency timer are NOT modified" - a trigger's reload now keeps whatever
  the timer already held in its low two T-cycles (0 to 3, zero on a voice's
  first ever trigger, since the timer starts there) instead of forcing them
  to zero. Against this oracle that raised `script-lengths` from 99.6205 % to
  99.6219 % (ch1 +214 cycles, ch2 +96) and `script-sweep`'s ch1 from
  99.9727 % to 99.9805 % (+1663 cycles), 1973 cycles of the corpus in all;
  `script-envelopes`, `script-pulses`, `script-wave` and `song-golden` did
  not move, so most of this corpus's triggers already landed on a timer
  that was already a multiple of four. The best constant shift that lines up
  a log's edges fell with it: `script-sweep`'s ch1 from 8 to 5, `script-lengths`'
  ch1 from 8 to 7 (its ch2 stays at 8 - a different note in that log, its own
  leftover phase unaffected). What is left, up to 5 cycles now, is SameBoy's
  own delay before its reload takes effect, cold and while playing; no
  document checked for this ticket gives a cycle count for it (Pan Docs'
  Audio_details and its "Obscure Behavior" page, the gbdev wiki's "Gameboy
  sound hardware", blargg's `dmg_sound` readme, and GBEDG, which as of this
  writing has no APU or sound page at all). Against Gb_Snd_Emu, which does
  not model this rule either (its own README already lists its untimed
  trigger among its gaps), the same change moves `script-envelopes` from
  17090241 to 17090121 identical cycles (ch1 -214, ch2 +94) and
  `script-sweep`'s ch1 from 16845596 to 16845557 (-39), 159 cycles of that
  corpus: a weaker, further-from-the-hardware oracle moving slightly further
  away as ours moves closer to a stronger one is the expected direction, not
  a regression in what it is being measured against. It costs every pulse
  line less than 0.1 point either way, the zombie case below aside.
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

## GBS playback

`importGbs(bytes, options)`, in [`gbs-import.ts`](../../packages/chipvoice/src/gbs-import.ts),
plays a `.gbs` (Game Boy Sound) file through an own SM83 (LR35102) CPU -
[`cpu.ts`](../../packages/chipvoice/src/chips/gb/cpu.ts) - written from Pan
Docs and gbdev's opcode tables, not ported from any GPL/LGPL emulator
(decision 41); it returns a `PerformancePlan` on `dmg`, the same chip this
sheet's driver targets, so a GBS's own INIT/PLAY routines drive the real
register model above rather than a separate playback path. `parseGbsHeader`
is exported alongside it for reading a file's metadata without running it.

The environment it builds per file: the 112-byte header's load/init/play
addresses and stack pointer; a virtual ROM image built from the program
bytes with `$2000-$3FFF` bank switching for a multi-bank file (unmasked, a
raw byte in, unlike an MBC1's own "0 becomes 1" quirk - there is no MBC on a
GBS's virtual cartridge to reproduce that on); ordinary `JP` stubs written
into that ROM at every RST and interrupt vector's fixed low address,
relocated to the load address - the GBS format spec's own documented
software-player technique, not something specific to any one player; and the
DMG's post-boot-ROM power-on register ceremony (the same table
[`packages/conform/src/roms/gb.mjs`](../../packages/conform/src/roms/gb.mjs)
uses, cited in `gbs-import.ts`) seeded before a file's own INIT ever runs.
INIT is called once, with `A` set to the zero-based song index; PLAY is then
called every VBlank (70224 cycles, 59.7 Hz) or at the header's own timer
rate, whichever the header's timer control bits select - a direct call each
time, the same way every real GBS player schedules it, not a simulated
interrupt firing into idle CPU time. A minimal VBlank/timer edge tracker sets
the matching IF bits at their documented cycle rates purely so a driver's own
`ei`/`halt` idiom (extremely common as a routine's internal pacing) wakes up
and reaches the relocated vectors; it is not a PPU, and nothing about
graphics, joypad input or cartridge RAM persistence is modelled beyond inert,
DMG-accurate stubs.

Rejected explicitly, by name, rather than silently played wrong: a version
byte other than 1; a load address outside `$400-$7FFF`; the undocumented CGB
double-speed timer bit; reserved timer-control bits; a track number outside
the header's song count; a bank-select write that reaches past the file's
own bank count; a serial transfer-start write (`$FF02`'s bit 7); and an
INIT or PLAY call that runs past its frame budget without returning (an
infinite loop, not a slow one - 4 frames for INIT, 1 for PLAY). None of these
are guessed at: each throws by name, in `gbs-import.ts`. Not modelled at all,
because nothing about them can affect a DMG's register stream: the PPU, OAM,
joypad presses, cartridge RAM persistence across a run, CGB-only I/O, and the
HALT-bug hardware artifact (a real quirk, deliberately not reproduced).

Every SM83 opcode, including the CB-prefixed block, is tested standalone in
[`test/cpu-gb.mjs`](../../packages/chipvoice/test/cpu-gb.mjs): flags from
8-bit and 16-bit adds, DAA, cycle counts per Pan Docs' own machine-cycle
table, HALT/interrupt polling, and EI's one-instruction delay.
[`test/gbs-import.mjs`](../../packages/chipvoice/test/gbs-import.mjs) covers
header parsing, every rejection above by name, INIT/PLAY scheduling and
pacing, RST relocation, and bank switching.

Measured against [Game_Music_Emu](https://github.com/libgme/game-music-emu)'s
`Gbs_Emu`, pinned the same way `scores/arrangements/native-oracle.py` pins it
for NSF, by [`scores/gbs-corpus`](../../scores/gbs-corpus) - a comparison, not
an assertion: run `pnpm gbs-corpus:check`. The corpus below holds one
self-produced file plus four real files from three independent drivers
(hUGEDriver, GBT Player and Laxity's own driver, bundled with gbsplay - see
[the corpus README](../../scores/gbs-corpus/README.md) for how each was
sourced or built). On every one of them, every register write matches GME's
own, address and value, in the same order, for the file's whole run
(`compare.mjs`'s `valueMatched`) - the CPU decodes and runs each of these
five different programs, from four different authors, correctly. The exact
cycle timestamps do not agree nearly as often, and it is worth being precise
about why, since a constant gap could mean either side has a wrong
instruction length: it does not. On `pulse-sweep.gbs`, every write is an
`LDH (n),A` (`$E0`); at one fixed PC, the measured delta (ours minus GME)
takes four different values across the capture (21, 22, 23, 24 T-cycles),
which rules out a fixed per-opcode stamping-point offset - that would
produce one constant, not four. Reading
GME's own `Gb_Cpu.cpp` (revision `fe8da4b6d3876d7542c2fb69d94487e19836d678`,
cited by revision and not vendored, per decision 41) confirms the actual
cause: its dispatch loop charges a flat `clocks_per_instr = 4` T-cycles per
instruction, once, before that instruction's own body runs - the same 4T for
an 8T `LD r,n` as for a 16T `JP`, for every opcode including CB-prefixed
ones. That is a real divergence in timing *model*, not in stamping
convention, and because the error it introduces depends on which
instructions ran rather than on which opcode is writing, no single
per-opcode or per-address offset closes the gap; `compare.mjs`'s docstring
has the full account. The cycle-exact score is reported raw for this reason,
never adjusted; matching GME's timing exactly would mean copying its model
rather than building from documents, which decision 41 does not allow.
[`instr_timing`](#test-roms) below is what actually settles the timing
question against real hardware, independently of GME.

<!-- gbs-corpus:begin -->
Written by `gbs-corpus:sheet` on 2026-09-27, against Game_Music_Emu revision `fe8da4b6d3876d7542c2fb69d94487e19836d678`.

| Song | Driver | Commands | Cycle-exact | Same value+order | First divergence |
| --- | --- | --- | --- | --- | --- |
| [Pulse Sweep](https://github.com/gwendall/chipvoice/blob/main/scores/gbs-corpus/files/pulse-sweep.gbs) | self-produced (hand-assembled SM83) | 724 | 1/724 | 724/724 | cycle 36 vs 15, $ff24: 119 vs 119 |
| [Sample Song](https://github.com/SuperDisk/hUGEDriver) | hUGEDriver | 48299 | 1/48299 | 48299/48299 | cycle 44 vs 15, $ff25: 255 vs 255 |
| [Effects Test](https://github.com/AntonioND/gbt-player) | GBT Player | 2220 | 1/2220 | 2220/2220 | cycle 44 vs 15, $ff25: 255 vs 255 |
| [Volume Test](https://github.com/AntonioND/gbt-player) | GBT Player | 509 | 1/509 | 509/509 | cycle 44 vs 15, $ff25: 255 vs 255 |
| [Nightmode](https://github.com/mmitch/gbsplay/blob/master/examples/nightmode.gbs) | Laxity's own driver (bundled with gbsplay) | 59673 | 0/59673 | 59673/59673 | cycle 3928 vs 1895, $ff26: 128 vs 128 |
<!-- gbs-corpus:end -->

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

blargg's `cpu_instrs` (behaviour: every opcode except `STOP` and the eleven
illegal ones, boundary data, other registers left alone) and `instr_timing`
(every opcode's T-cycle count, cross-checked here against real hardware
rather than against GME) run the same way, but on the PACKAGE's own
[`chips/gb/cpu.ts`](../../packages/chipvoice/src/chips/gb/cpu.ts) rather than
this harness's separate `sm83.mjs` fixture
(`pnpm --filter chipvoice-conform roms:cpu-instrs`). Both suites speak an
older, plainer protocol than `dmg_sound`'s: the ROM prints to a screen this
harness does not render, and sends the same text out the serial port
(`$FF01`/`$FF02`), which is what is captured and read here. `instr_timing`
passing is the hardware-grounded answer to the timing question
[GBS playback](#gbs-playback) raises against GME above: every opcode's
length, checked against blargg's own verified cycle tables running on real
Game Boy behaviour, not against another emulator's.

<!-- cpu-instrs:begin -->
Run by `conform`'s SM83 fixture on 2026-09-27, against the package's own `chips/gb/cpu.ts`: 12 of 12 pass.

| ROM | Result | What it said |
| --- | --- | --- |
| `cpu_instrs/01-special` | pass | 01-special Passed |
| `cpu_instrs/02-interrupts` | pass | 02-interrupts Passed |
| `cpu_instrs/03-op sp,hl` | pass | 03-op sp,hl Passed |
| `cpu_instrs/04-op r,imm` | pass | 04-op r,imm Passed |
| `cpu_instrs/05-op rp` | pass | 05-op rp Passed |
| `cpu_instrs/06-ld r,r` | pass | 06-ld r,r Passed |
| `cpu_instrs/07-jr,jp,call,ret,rst` | pass | 07-jr,jp,call,ret,rst Passed |
| `cpu_instrs/08-misc instrs` | pass | 08-misc instrs Passed |
| `cpu_instrs/09-op r,r` | pass | 09-op r,r Passed |
| `cpu_instrs/10-bit ops` | pass | 10-bit ops Passed |
| `cpu_instrs/11-op a,(hl)` | pass | 11-op a,(hl) Passed |
| `instr_timing/instr_timing` | pass | instr_timing Passed |
<!-- cpu-instrs:end -->

Both suites are Shay Green's (blargg's), from
[retrio/gb-test-roms](https://github.com/retrio/gb-test-roms) - the same
informal, no-formal-licence, "free for any use" status `dmg_sound` already
carries here; see [`roms/README.md`](../../packages/conform/roms/README.md)
for that repository's own provenance and this one's disclosed difference
from the `dmg_sound` build already vendored.

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
| A pulse trigger's first step lands a few cycles before SameBoy's | no, unexplained | P3-7 gave the timer Pan Docs' rule (a trigger keeps the low two bits it already held instead of zeroing them), which closed up to 3 of the gap. What is left, up to 5 cycles on this corpus (was 4 or 8), is SameBoy's own trigger delay before its reload takes effect; no document checked (Pan Docs, the gbdev wiki, blargg's readme, GBEDG) gives a cycle count for it | the first duty step of every pulse note, and every edge after it by the same amount |
| The noise voice's timer is reloaded on a trigger | no, unverified either way | The gbdev wiki's "Trigger Event" reloads every channel's frequency timer; Pan Docs' NR44 does not list a reload, and SameBoy keeps its noise counter running across triggers. No published capture settles it (P3-5) | the first LFSR step of every noise note, by up to one step |
| The CGB's differences are not here | yes | The chip is the DMG's; a `cgb` chip would share the code with the differences switched | Game Boy Color behaviour |

## Power-on state

`reset()` puts the chip where the DMG is after the boot ROM has run except for
the chime: powered on, every register zero, the frame sequencer about to clock
its first step, the noise register all ones, wave RAM zero. The boot ROM's chime
leaves pulse 1's registers set and the master volume at 7 on both sides; the
harness's Game Boy writes those before a ROM runs.

## History

- 2026-09-27: P3-7. A trigger on ch1 or ch2 keeps the low two bits of the
  frequency timer instead of forcing them to zero, Pan Docs' "Obscure
  Behavior". Against SameBoy, `script-lengths` and `script-sweep`'s ch1
  raised (1973 cycles of the corpus); against Gb_Snd_Emu, which does not
  model the rule, the same two logs fell back slightly (159 cycles), as
  expected of a weaker oracle. The golden moved and went through the
  calibration and the arrangement eval.
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
