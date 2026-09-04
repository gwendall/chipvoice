# Backlog

The [roadmap](ROADMAP.md) says where this is going. This is the list of what is
being done about it, ticket by ticket, kept current at the start and the end of
every pull request. A ticket moves to *doing* with its branch, and to *done* with
its PR and what was learned. Discoveries that change the plan go in the log at
the bottom, dated, and the ticket they change is updated in the same commit.

Statuses: `todo`, `doing`, `done`, `dropped` (with why).

## Phase 1. The bench

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P1-1 | Events in chip cycles | done | 0.4.0 |
| P1-2 | Register writes are bytes: `RegisterEvent` is `{at, addr, value}`, the core decodes `$4000-$4017`, the driver encodes | done | 0.5.0. Learned: see the log |
| P1-3 | Digital and analog apart: a per-cycle digital output before mixing, resampling and filters; the output stage as its own class with a named profile | done | PR #2. `Nes2A03`, `NesOutputStage`, `NESDEV_PROFILE`; golden unchanged |
| P1-4 | The trace: a change stream per voice, `(cycle, value)`, which is what parity is measured on | done | PR #2. `DigitalChip.trace`, `ChipDefinition.digital()` |
| P1-5 | `conform`: the harness. Corpus in, two cores run, first divergence out, numbers as JSON | done | PR #3, `packages/conform` |
| P1-6 | Oracle 1: Nes_Snd_Emu, built natively from vendored LGPL sources with a recording sink in place of Blip_Buffer | done | PR #3. Its limits are on the sheet |
| P1-7 | Corpus 1: this project's own songs and feature scripts, as byte write logs | done | PR #3, 12 logs |
| P1-8 | The sheet's numbers written by the harness | done | PR #3, `--sheet` between markers |
| P1-9 | `conform` in CI on the subset | done | PR #3, against a committed baseline |
| P1-10 | The 5-step frame sequence and `$4017` write timing | done | 0.5.0, with P1-2: the decoder needed `$4017` anyway |
| P1-11 | A 6502 test fixture to run blargg's APU ROMs | done | PR #7. 29 of 29 pass, in CI |
| P1-12 | Corpus 2: real games, from NSFs played through a reference with a write logger | todo | needs P1-11 or an NSF player |
| P1-13 | Oracle 2: a modern reference - Mesen 2's APU or puNES - for the envelope, the sweep and the triangle's start, which neither the 2005 oracle nor the test ROMs settle | todo | found in P1-6; the frame timing is settled by the ROMs |
| P1-14 | The triangle metric: compare step times with a per-run shift and a sequencer-position offset, so the triangle reads as identical when it is, rather than a few percent because of the oracle's start convention | done | PR #4. Hidden steps put back; every triangle run aligns on step times |

## Phase 2. NES to 100 %

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P2-1 | Fix every divergence the harness finds, or document why the oracle is wrong | todo | |
| P2-2 | The DMC | done | PR #5, 0.6.0. Identical steps to the oracle one bit period apart; see the log |
| P2-3 | A reference unit for the analog stage, captured and measured | doing | PR #8: the mixer is measured against blargg's own recordings of his NES and cancels as well as it; the filters still want a unit's line output |
| P2-4 | Release with the sheet linked from the package README and the skill | todo | |

## Phase 3. Game Boy

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P3-1 | DMG APU from Pan Docs and blargg's notes, verified by his dmg_sound ROMs on an SM83 fixture | done | `packages/chipvoice/src/chips/gb`, `packages/conform/src/roms/{sm83,gb}.mjs` |
| P3-2 | `ChipSpec`, `RegisterEvent` and the instrument model rewritten against two chips | done | `ChipDriver`, `FrameState`, `ChipSpec.roles`; `chips/{nes,gb}/driver.ts`. The 2A03's golden hash did not move |
| P3-3 | The Game Boy sheet, generated | done | `docs/chips/dmg.md` |
| P3-4 | A stronger Game Boy oracle: SameBoy driven by a register log, or a GBS player on the SM83 for real-game logs | todo | Gb_Snd_Emu is 2005 and takes its first step at the trigger |
| P3-5 | The Game Boy's output stage measured: a DMG's line-out under a known script | todo | needs a unit, like P2-3 |
| P3-6 | The Game Boy in the API, the studio and the skill: `chip: "dmg"` accepted, rendered and played; a chip selector in the editor; the skill says what changes | done | `apps/web`, skill 0.4.0 |

## Phase 4. The portable score

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P4-1 | VGM export from the event stream, and VGM import into the corpus | done | PR #4. `toVgm`, `recordSong`; `import-vgm` in the harness |
| P4-2 | The score: roles and intents | done | `score.ts`: `Score`, `arrange`, `INTENTS`; decision 16 |
| P4-3 | An arranger per chip | done | `chips/nes/arranger.ts`, `chips/gb/arranger.ts`; the roles and idioms in `ChipSpec.roles` and `ChipDriver` since P3-2 |
| P4-4 | Instruments in the API and the wire format | done | as `intent`, words from the catalogue, stored, forked, rendered; skill 0.5.0 |
| P4-5 | Idioms per chip in the skill | done | skill 0.5.1: the catalogue per word, and a section per chip on how to write for it. There is no MCP server; the skill is the file an agent reads |
| P4-8 | Intent pickers in the studio, one per row | todo | the studio arranges with the default words |
| P4-6 | Smooth vibrato through the sweep unit, the FamiStudio trick, so a vibrato across a period high-byte boundary does not reset the phase | done | `NesDriver.smoothHighByte`; golden hash moved; see the log |
| P4-7 | "Agent-written music sounds good" as a named goal with its own measures | todo | |

## Operations

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| OPS-1 | Vercel: the `chipvoice-api` project was still connected to the repository and failed a deployment on every push, next to the `chipvoice` project that serves chipvoice.dev | done | Its root directory was `apps/api`, which stopped existing when the API moved into `apps/web`; nothing referenced it. Deleted with the Vercel CLI on 2026-09-04. Every PR from #1 to #11 wore its red cross; it should have been fixed at #1 |

## Phase 5. Mega Drive

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P5-1 | Nuked-OPN2 vendored as the YM2612 oracle: built natively, driven by a register log, its per-channel outputs traced | done | `packages/conform/oracles/nuked-opn2` |
| P5-2 | The YM2612 in TypeScript, ported from Nuked-OPN2 line for line, behind `DigitalChip`: six FM channels and the DAC | done | `chips/md/ym2612.ts`; identical to Nuked on every script |
| P5-3 | The SN76489 from the documents, with formula tests | done | `chips/md/sn76489.ts`; no oracle yet, see P5-8 |
| P5-4 | The Mega Drive chip: the two behind one `ChipCore`, the ladder DAC and the console's output stage, a worklet | done | `chips/md/dsp.ts`; the output stage is a placeholder |
| P5-5 | The Mega Drive's driver and arranger: FM patches for the intents, the PSG for the chord, the kit on the noise | done | `chips/md/driver.ts`, `arranger.ts`; FM drums are still to come |
| P5-6 | VGM for the YM2612 and the PSG, the chip in the API, the studio and the skill | done | `toVgm({ chip: "md" })`; skill 0.6.0 |
| P5-7 | The Mega Drive sheet: parity with Nuked on every voice, a corpus of scripts and songs | done | `docs/chips/md.md` |
| P5-8 | A PSG oracle: MAME's `sn76496` behind a shim, or a Master System test ROM | todo | the noise register's sequence and the period-0 behaviour are from the documents |
| P5-9 | The Mega Drive's output stage measured: a Model 1's line-out under a known script | todo | needs a unit, like P2-3 |
| P5-10 | FM drums on channel 6 and the LFO in the arranger | todo | the kit is on the PSG noise for now |

## Phase 6. SNES

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P6-1 | snes_spc's S-DSP vendored as the oracle: built natively, driven by a register log with the sample RAM from the log's memory lines, its stereo output traced per sample | done | `packages/conform/oracles/snes-spc` |
| P6-2 | The S-DSP in TypeScript, ported from snes_spc line for line, behind `DigitalChip`: the digital stereo output is the voice pair | done | `chips/snes/sdsp.ts`; identical to snes_spc on every log, first run |
| P6-3 | The SNES chip: 64 KB of sample RAM, the DSP reached through the SPC700's `$F2`/`$F3`, a placeholder output stage, a worklet | done | `chips/snes/dsp.ts` |
| P6-4 | A BRR encoder, and the sample instrument shape: `Instrument.sample` | done | `chips/snes/brr.ts`; `ChipDriver.memory()` |
| P6-5 | The SNES's driver and arranger: samples synthesised per intent, ADSR, the echo as the signature, the kit as samples | done | `chips/snes/driver.ts`, `arranger.ts` |
| P6-6 | The chip in the API, the studio and the skill. VGM has no S-DSP; SPC export is a driver in the file and comes later | done | skill 0.7.0; SPC export is P6-9 |
| P6-7 | The SNES sheet: parity with snes_spc on the output stream, a corpus of scripts and songs | done | `docs/chips/snes.md` |
| P6-8 | The SNES's output measured: a capture of the DSP's stream or a unit's line-out under a known script | todo | needs a unit |
| P6-9 | SPC export: a driver embedded in the file, so a song plays in any SPC player | todo | |
| P6-10 | Real triads across voices for the chord, the SNES's idiom, and the noise voice for hats | todo | the arranger arpeggiates for now |

## Later phases

C64: see the roadmap. Not ticketed until phase 6 is done.

## Discoveries

**2026-09-04, P6-1 to P6-7.** The fourth chip, and the port was identical to
its oracle on the first run: snes_spc's S-DSP, line for line, compared on the
DSP's output stream, which on this chip is the chip's output. Everything the
first run found was in the programs. The DSP powers on in a state captured
from a console: an echo buffer 28 KB long from wherever ESA points, which
wraps round the top of RAM and over the samples until the old buffer runs
out; and voices keyed on with the noise routed to some of them and the noise
clock stopped, a constant on the output that grows with an envelope and
looked, for an hour, like a drift in the chip. The IPL ROM keyed every voice
off and every program disabled echo writes and waited the old delay out
before enabling them; the driver, the scripts and the formula tests now do
both, and the chip was never wrong. The BRR encoder's first version was wrong
by a factor of two: the decoder works on half-scale values and doubles the
result, so a nibble is worth `2^shift` on the scale of the samples and the
prediction counts double; a sine encoded with the wrong unit saturated. Note
off on this chip is the voice's own GAIN rather than KOFF, because KOFF is one
register for eight voices and a driver that writes notes out of time order
cannot hold its state. `ChipDriver.memory()` and `Instrument.sample` are the
sample instrument shape: a chip whose instruments are samples names them from
a bank the driver puts in memory at power-on.

**2026-09-04, P5-1 to P5-7.** The third chip, in a day, and the first whose
verification is against the die. Nuked-OPN2 is a reading of the YM3438's
transistors, and the chip's YM2612 is that reading ported line for line with
Nuked's names kept; Nuked itself, built natively, is the oracle. The first run
was 93 % identical with every run aligned under a shift of at most 41 cycles,
which was two conventions and no bug: the trace stamped a change at the end of
the internal cycle where the oracle stamps its start, and a write was delivered
on the cycle after its stamp rather than the one starting at it. With both made
the oracle's, every script - the eight algorithms at three feedback levels, the
envelope's stages and key scaling, detune and every multiple, the LFO at every
speed with both sensitivities, SSG-EG's eight shapes, channel 3's special mode,
the DAC - is identical on every voice, every edge exact. Two things learned on
the way: the register's slot pipeline means a data byte lands only when the
chip's twelve-slot cycle reaches its operator, so a driver that writes faster
than the busy flag loses writes, and the driver here spaces registers as a
program that waits on the flag does; and the master clock is the right unit for
the log, because the 68000, the YM2612 and the PSG all divide from it and
nothing else is integral in all three. The SN76489's noise register, sixteen
bits with taps at 0 and 3 as SMS Power and MAME have it, is not a maximal
register: it repeats after 7 times 8191 shifts, not 32767, which the formula
test now says. It has no oracle yet.

**2026-09-04, P4-6.** Blargg's smooth vibrato, as FamiStudio's engine writes
it: to move a pulse's period high bits by one without the `$4003` write that
restarts the phase, put the low byte at `$FF` or `$00`, arm the sweep with a
shift of 7 in the right direction, clock it at once with a `$4017` write in
5-step mode, disarm it, restore the low byte. The period moves by `period >>
7`, enough to cross the boundary and too little to cross two. Traced on the
chip: a vibrato on A4 that used to reset the phase six times a second now
keeps every edge within the vibrato's own swing. The writes are spaced as a
CPU spaces them, because `$4017` takes effect three or four cycles after the
write and the disarm has to land after that; the two pulses are staggered so
both crossing in one frame do not interleave. The golden hash moved, as it
should. And the oracle found a new place to disagree: Nes_Snd_Emu clocks the
forced half frame zero or one cycle after the write where the hardware takes
three or four, which blargg's own later `apu_test` checks and the chip passes.
When a pulse's timer happens to reload inside those cycles, the oracle's
edges sit a few cycles from ours for the rest of the note; it happened once,
on pulse 2 of the e2e song, and the baseline moved to say so.

**2026-09-04, P4-2, P4-3, P4-4.** The second chip turned the score sketch into
a design in an afternoon, and the design is smaller than the sketch. The roles
kept their names, because renaming `chord` to harmony would have broken every
stored song for a nicer word. The intents are words from a catalogue, not
parameters, and the Game Boy's bass is what decided it: `"hollow"` is a square
wave in wave RAM there and nothing on a NES, which a word says and a
brightness of 0.6 could not. Instruments never entered the wire format; the
API stores a word per role and each chip's arranger maps it, so a song keeps
its timbre across chips. Both golden hashes did not move: a score with no
intent arranges to the instruments every song had, to the number, and the
studio now arranges the same way the API renders, which removed a copy of
those instruments that had been kept by hand in two places. What the two
chips could not test: the voice budget - both have four voices for four roles
- and arrangement-level validation, which the SN76489's tone floor will force.

**2026-09-04, P3-2.** The driver split where the second chip said it should:
at the frame. Reading an instrument's tables, the arpeggio, the slide, the
vibrato and the frame clock produce a `FrameState` - a volume, a pitch in hertz,
a duty, a noise index - that no chip owns, and each chip's own `ChipDriver`
turns a note's frames into its registers. `RegisterEvent` did not need to
change: a byte to an address on a clock was already what both chips are.
`ChipSpec` gained one thing, the map of a song's four roles onto the chip's
voices, which is the arranger in its smallest form. What the Game Boy's idiom
turned out to be, against the same instrument tables: a pulse's volume takes
effect on a trigger, so a volume change retriggers the voice, which the
hardware makes cheap by keeping the duty position; the bass goes on the wave
channel, whose RAM is only writable while it is off; and a noise drum's volume
table cannot be followed frame by frame, because a retrigger restarts the
register and mutes it for its first fifteen shifts, which at the rates drums
use is most of a frame - so the table is fitted to the hardware envelope at the
note's start. The 2A03's golden hash did not move through the rewrite. Two
things the instrument model still carries from the 2A03, named as such rather
than hidden: the noise index is the 2A03's and other chips map it onto their
rates, and a pitch table is in 2A03 period units, applied elsewhere as the
ratio it would have made there.

**2026-09-04, P3-1.** The Game Boy's APU was written from Pan Docs and blargg's
"Game Boy Sound Operation" rather than ported from SameBoy as the ticket first
said: SameBoy's `apu.c` is shaped around its emulator's state and would have had
to be rewritten into `DigitalChip` anyway, and the verification does not come
from the port but from the ROMs. Blargg's twelve `dmg_sound` ROMs, on an SM83
the harness now carries, passed eleven of twelve on the first run. The twelfth
was the DMG's wave RAM corruption on a retrigger, which happens in the two
cycles *before* the channel fetches a byte, with the byte it is about to fetch,
not after the fetch with the byte it just read; SameBoy models it the same way.
Two things the documents leave open and the ROMs do not settle, both taken from
SameBoy: a voice's timer runs only while the voice is on, so a note starts at
the duty position the last one stopped at; and the wave channel's first fetch
after a trigger comes six cycles after its period, which ROMs 09, 10 and 12 are
sensitive to within two cycles and pass with. Gb_Snd_Emu 0.1.4 as an oracle is
as old as Nes_Snd_Emu and weaker: it takes a voice's first step at the trigger
without reloading the timer, ticks its frame clock at time zero, and has no
DACs, no power switch and no zombie envelope. Its runs line up with ours on
every voice; its identical-cycle count never will. It confirms the short noise
sequence's pattern and the envelope's steps, which no ROM checks.

**2026-09-04, P1-2.** The decoded-command interface let the driver do two things
the hardware cannot. It changed a pulse's period high bits without restarting the
sequencer, which on a NES only a `$4003` write can do, and that write resets the
phase; and it never wrote `$4001`, leaving the sweep negate flag clear, so the
sweep unit's mute condition silenced any pulse note with a period of `$400` or
more - roughly G#2 and below. Drivers on the hardware wrote `$4001 = $08` for
that reason. Both are now what the hardware does: a note that crosses a period
high-byte boundary restarts its phase, and low pulse notes play.

**2026-09-04, P2-3.** Blargg's `apu_mixer` ROMs come with recordings of a real
NES, and they measure the mixer without owning one: each has a channel play a
waveform while the DMC plays its inverse, and how silent the middle is says how
right the DAC curves are. Ours cancels to -32.7 dB on the pulses, -33 dB on the
triangle and -31 dB on the DMC, where his console does -32.2, -30.9 and -27.2.
It did not at first: the triangle's power-on position, which decision 5 had
moved to spare a click, put it on the wrong value for the whole test and read
22 dB worse. The hardware's position is back and the click is handled where it
belongs, in the output stage. A measurement beat a reasonable-sounding choice.

**2026-09-04, P1-11.** Every one of blargg's APU test ROMs passes on a 6502
the harness carries: the 2011 `apu_test` and `apu_reset`, the `dmc_tests`, and
the 2005 frame counter set, twenty-nine ROMs. That settles the one question the
2005 oracle raised: the frame timing is nesdev's, to the cycle, and the oracle
is the one that is two cycles off. Two things the ROMs knew that the wiki says
less plainly are now in the chip: a halt flag written on a length clock's cycle
takes effect after the clock, and a length reload on that cycle is ignored
unless the counter was zero. What no ROM checks: the envelope, the sweep and the
linear counter near a clock, and any voice's output.

**2026-09-04, P2-2.** The DMC's steps are identical to the oracle's, one bit
period apart: its output unit powers on with one bit remaining in Nes_Snd_Emu
and with eight in nesdev's description and in Mesen, and no document pins the
hardware's power-on state. And a `$4011` write in the oracle adjusts the
amplitude through a DAC table for the sound of the pop, so its levels after one
are not the register's value. Kept nesdev's eight; a hardware capture of the
first DMC byte after power-on would settle it (P2-3 territory).

**2026-09-04, P1-6, first run.** The pulses are identical to the oracle cycle
for cycle on every song and on the sweep-down, mute, and restart scripts: not
one edge unmatched. Every divergence found is an oracle convention: its frame
steps land two cycles late, its triangle steps at once when its counters reload
where the hardware waits for the timer, and its `reset()` writes `$4003` to
every voice so that its first frame clock loads every envelope with 15. The
sheet has the reading. CI checks a baseline rather than demanding zero
divergence, because with this oracle zero is not on offer; a second oracle is
ticket P1-13.

**2026-09-04, P1-6.** Nes_Snd_Emu 0.1.7 is from 2005 and predates some of what
nesdev now knows. Its frame sequence is a uniform 7458 cycles, not
7457/14913/22371/29829; its noise register starts at `1 << 14` and outputs the
volume when bit 0 is *set*, the inverse of the documented polarity; and while a
noise channel is muted it does not clock the register exactly, so the LFSR's
phase after any silence is approximate. The oracle is used for the pulses and
the triangle, cycle for cycle. The noise is verified by the formula tests and by
its envelope, which shares code with the pulses. The sheet says so.
