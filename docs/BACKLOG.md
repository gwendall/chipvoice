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

## Phase 7. C64

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P7-1 | reSID-fp vendored as the SID oracle, in the harness only: it is GPL and never ships in the package (decision B) | done | `packages/conform/oracles/residfp`, `src/oracles/residfp.mjs` |
| P7-2 | The SID's digital part from the documents: oscillators, the noise register, waveform selection and combination, sync and ring modulation, the envelopes with their rate counters and the ADSR delay bug, behind `DigitalChip` | done | `packages/chipvoice/src/chips/c64/sid.ts`; identical to reSID-fp on every log |
| P7-3 | The SID's analog stage as a profile: the 6581's DAC ladders, the filter, the output stage | done | `chips/c64/dsp.ts`, `SID_6581_PROFILE`; unmeasured, the 8580 left for P7-10 |
| P7-4 | The C64's driver and arranger: waveforms and the envelope for the intents, three voices for four roles with the classic sharing | done | `chips/c64/driver.ts`, `arranger.ts`; the sharing rule in `Sequencer.scheduleStep` |
| P7-5 | The chip in the API, the studio and the skill | done | schema, openapi, skill 0.8.0, llms.txt, studio |
| P7-6 | The C64 sheet: parity with reSID-fp on the digital voices, a corpus of scripts and songs | done | `docs/chips/c64.md`, `corpus/c64`, `check:c64` in CI |
| P7-7 | VICE's SID test programs (`testprogs/SID`) on a 6510 in the harness, reading OSC3 and ENV3: a second verification of the digital part against programs written for the hardware | todo | needs a 6510 the way the NES has a 6502 |
| P7-8 | A 6581's line-out captured under a known script, and the analog profile fitted to it: the DAC's zero, the filter's curve, the output stage | todo | needs a unit |
| P7-9 | The filter in the arranger: a word that opens it, a sweep for a lead | todo | |
| P7-10 | The 8580: its combined waveforms, the triangle and sawtooth delay, its linear DACs and its own filter, as a second profile and a second table | todo | |
| P7-11 | The harness holds every change of every stream in memory, and a SID sawtooth changes every cycle: the corpus keeps dense waveforms short. A streaming compare, or a change stream as typed arrays, would lift that | todo | hit while generating the corpus: an 8 s script of three sawtooths ran the harness out of memory |

## Phase 8. The site as an instrument

[DEMO.md](DEMO.md) is the agreed product spec. Decision 20 updates decision 19.
Delivery slices: **A** repairs the two foundations; **B** delivers the first
playable screen; **C** completes V1 editing and sharing; **D** contains later
extensions. Work in that order, using the dependencies below. Keep existing
IDs so historical references remain useful. V1 implementation is grouped in one
PR; deployment and real-device checks are distinct from local completion.

| # | Ticket | Status | Slice / dependencies |
| --- | --- | --- | --- |
| P8-15 | Preserve the complete score across load, editor, playback and fork: patterns, order, chord shapes, intents and machine. A title-only fork changes no music | implemented | A. Audit finding 1; shared document model before editing UI |
| P8-16 | Cancel scheduled music on Stop and voice stealing; define restoration after SFX and ownership of shared registers. Test resulting writes/audio, including overlapping effects | implemented | A. Audit finding 2; prerequisite for reliable switching and arcade pads |
| P8-17 | Fail conformance on a missing/invalid baseline and unexpected corpus membership; retain explicit subset runs. Add the foundation regressions | implemented | A. Audit finding 7; supports P8-15/16 |
| P8-1 | The first musical gesture works once on the production build. Handle audio unlock, pending creation and obsolete switches; a nonmusical click does not start playback | implemented | B. After P8-16; browser lifecycle and hydration |
| P8-2 | Three excellent composed cartridges, each playable on all five machines. A tune is loaded at opening; explicit Play starts it | implemented | B. Replaces arbitrary-click autoplay and six-to-eight-preset scope |
| P8-3 | Five visible machine selectors; switching preserves musical position and edits, with no overlapping player or unexpected start | implemented | B. After P8-15/16; selectChip does not currently preserve position |
| P8-5 | Four reactive role lanes showing notes, duration, playback and real voice ownership. Mute/solo; measured levels only when actually measured. Small scene actions accompany SFX | implemented | B. After P8-16; respect C64 shared voices and reduced motion |
| P8-18 | Four arcade pads: Jump, Coin, Laser, Explosion. Chip-appropriate sounds, touch and keyboard, visual action and truthful voice interruption/recovery | implemented | B. After P8-16; no full game required |
| P8-8 | Instrument-first layout: presets, machines, display and pads. Title, account and publication controls appear when relevant; playing needs no account | implemented | B. DEMO.md visual direction; no marketing hero prerequisite |
| P8-14 | Measure first sound, machine comparisons, effects, edits and shares without identity or score content. Observe usability sessions and establish a baseline | partial | Session-only counters implemented; observed human sessions and performance baseline deferred until a representative device is available |
| P8-4 | Sound on touch and an eight-note audition palette; document keyboard shortcuts, preserve a scale-assisted and a chromatic path | implemented | C. After P8-16; live recording remains P8-10 |
| P8-6 | Simple pitch-by-height editing of the selected pattern; preserve the full score and provide existing intent choices per role | implemented | C. After P8-15; incorporates P4-8, which is not yet done |
| P8-7 | Drum creation as a readable step grid with immediate audition. Distinguish musical drum controls from arcade SFX pads | implemented | C. After P8-15/16 |
| P8-9 | Phone editing with large enough targets and an overview; scroll/pinch never paint. Keyboard activation/navigation; do not shrink targets merely to fit sixteen steps | partial | Controls and touch-emulated editor implemented; real-phone scroll/pinch check deferred |
| P8-19 | Undo/redo and automatic local draft recovery. Raw text remains editable while incomplete, with validation before application | implemented | C. After P8-15; repairs text input and provides reversible exploration |
| P8-20 | View/copy the current score and runnable library code; share reopens the complete song and chosen machine. Clearly separate draft from publication | implemented | C. After P8-15; verify round trip and copied example |
| P8-21 | Coherent audio downloads: render identity/cache contract, stereo where appropriate, correct machine tags. Stable song links survive asset versioning | implemented | C. Before claiming exported audio reproduces the demo |
| P8-22 | Put critical production-build web journeys in CI with a temporary database; verify actual transport output, score preservation, input and sharing | implemented | A regressions, B/C journeys; no production writes from CI |
| P8-10 | Quantized live recording and overdubbing from the note palette and drums, with undo | todo | D. After V1; audition exists earlier in P8-4 |
| P8-23 | Controlled variations: vary a role, lock others, undo. Start with authored/rule-based music, without a remote AI dependency | todo | D. After V1 |
| P8-11 | Web MIDI input using the same tested transport and ownership model | todo | D. After V1 |
| P8-12 | Producer exports: stems, render on all five machines, VGM where supported | todo | D. After P8-21; basic audio download is in V1 |
| P8-13 | Expose the SID's actual filter and sweep; consider alongside SNES triads and FM drums as richer musical arrangements | todo | D. P7-9, P6-10, P5-10; no simulated generic substitute |

## Audit follow-ups

The [audit](AUDIT-2026-09-05.md) contains evidence and the distinction between
reproduced defects and risks found by inspection. Score, transport, frontend,
cache and CI work is tracked in phase 8 above. These remaining repairs are
explicitly tracked without turning anonymous demo delivery into a platform
rewrite.

| # | Ticket | Status | Priority / dependency |
| --- | --- | --- | --- |
| AUD-1 | Separate stable user identity, API keys and browser sessions; recover publications across logins, consume magic tokens atomically, and do not rotate an agent key on browser login | todo | Before relying on account recovery/sign-in; does not block anonymous play |
| AUD-2 | Profile render CPU, bound/cache request variants and deduplicate concurrent renders; add worker/storage only as measurements justify | todo | Before expanding expensive export usage; alongside P8-21 |
| AUD-3 | Make low-sample-rate offline scheduling correct, bound the timeline without a position reader and fix beatDelay's contract | partial | Scheduling fixes, host-driven offline expiry and direct shared bus queues included (decision 23); low-rate performance qualification remains separate |
| AUD-4 | Validate playable ranges per machine/voice and return arrangement diagnostics; preserve explicit target identity in the arranged API | todo | Before claiming every syntactically valid score plays unchanged |
| AUD-5 | Use versioned database migrations with precise error handling | todo | Alongside identity/schema work |
| AUD-6 | Align root/npm README, package metadata, capabilities and licence statements; distinguish corpus parity from physical verification, remove misleading global completeness claims | partial | Root/npm introductions, metadata and licences aligned; full capability-copy audit remains follow-up |

## Later phases

New systems remain closed until phase 8 V1 acceptance under decision 20.
Slice D is optional later work and does not indefinitely extend that gate.
After V1, additions are driven by demand; see the roadmap.

## Discoveries

**2026-09-05, phase 8 and audit follow-ups.** The user clarified that the site
is a playful library demo. DEMO.md captures the agreed V1 and later ideas.
The audit reproduced complete-score loss on a title-only fork and musical
register writes returning after Stop or overwriting SFX. Repair those two
foundations first, then ship the visible instrument. Explicit Play replaces
arbitrary-click autoplay; three strong cartridges replace the larger initial
preset target. Live recording, MIDI, variations and stems follow V1. Existing
phase 8 IDs are retained, new prerequisites and missing outcomes are added,
and no implementation is marked complete by writing this specification.

**2026-09-04, P7-1 to P7-6.** The fifth chip, and the first written from the
documents since the Game Boy: the SID's digital part is chipvoice's own code,
from the datasheet, kevtris's rate values, plogue's ADSR findings and what
VICE and reSID published from the die, and reSID-fp, GPL, stays in the
harness as the oracle (decision 18). It was identical to reSID-fp on every
stream of every log once two things were right, both facts about the
hardware: power-on is a reset, which clocks the noise register once as the
reset line goes; and rate 8 of the envelope is 392 cycles a step, one more
than the datasheet's 391, which is what the register value kevtris read off
the chip says. The combined waveforms are a model with six numbers per
combination, bits pulling on their neighbours and the pulse pulling from
above; it matches the oracle's tables on every entry, and the harness scores
it (`fit:c64`). Three voices for four lines is the first time the score has
more lines than the chip has voices, and the rule went into the sequencer
rather than the driver, because the driver expands a note into writes when
the note is scheduled and cannot take a write back: a drum cuts the chord,
and the chord comes back after it until the next drum, as on every C64 tune
with drums. The drums are the SID's own, pitched, and every one is shorter
than a step because a drum's note off lands where its duration says on every
chip. The harness holds every change of every stream in memory, and a SID
sawtooth at an audible pitch changes every cycle: an 8 s script of three
sawtooths ran it out of memory, and the corpus now uses pulses wherever the
waveform is not what is under test (P7-11).

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
