# Decisions

Project-level decisions, with the reasoning, so they are not re-litigated by
accident. Small, local ones live as comments in the code next to what they decide.

Each entry: the date, what was decided, why, and what it changes.

## Decided

### 1. Accuracy is a sheet, not an adjective (2026-09-04)

No chip is described as "cycle-accurate" or "exact" in a README, a package
description or the skill. Each chip has a conformance sheet, produced by the one
method in [CONFORMANCE.md](CONFORMANCE.md), that says what was verified against
which oracle and what is known to differ.

**Why.** The 2A03 was described as cycle-accurate while its noise channel ran an
octave low. The word cost nothing to write and nothing checked it. A sheet with
"unverified" on it is honest; a missing sheet is a claim.

**What changes.** The package README links the sheet. `docs/chips/<id>.md` exists
for every chip that ships, from the first commit that ships it.

### 2. Cores are borrowed and verified, except the 2A03 (2026-09-04)

Every chip after the first uses a reference core - ported when it is small and
permissively licensed, compiled to WebAssembly when it is not - behind the same
`ChipCore` interface. The 2A03 core predates this decision and is kept and
verified rather than replaced.

**Why.** The reverse engineering is done, in C, by people with die shots and logic
analysers. A core derived from the die carries its verification with it. Rewriting
one by hand reintroduces the class of bug that a formula test found in the 2A03.

**What changes.** The roadmap's per-chip work is porting, wrapping, licensing and
arranging, not emulation. The worklet inlining gains a WebAssembly variant: a
binary as a base64 string, instantiated inside the worklet.

### 3. A second chip before the score abstraction (2026-09-04)

The Game Boy is built, and the `ChipSpec`, `RegisterEvent` and instrument model
are rewritten against two real chips, before the portable score is designed.

**Why.** The package README already says it: generalising against a single case
produces a bad abstraction. The Game Boy is the cheapest second case with a real
difference, the wave channel.

### 4. Event time is in chip cycles (2026-09-04)

`RegisterEvent.at` is a count of the chip's clock cycles, `ChipSpec.clockHz` of
them a second, from the same origin as the sample clock. A write lands on its
cycle wherever that falls inside a sample. The core derives its cycle position
from the sample position it is asked to render from, in exact integer
arithmetic, so one second of samples is exactly one second of cycles.

**Why.** Every oracle reasons in cycles, VGM is written in cycles, and the driver
thinks in frames and does not care. Timestamps in samples tied the event stream
to one sample rate, applied every write at the start of a sample rather than on
its cycle, and made bit-exact comparison a conversion problem.

**What changed.** The driver stamps writes with `Math.round(seconds * clockHz)`
and needs no sample rate, so the offline driver lost its override. The golden
hash moved by the sub-sample shift and nothing else. The same event stream now
applies its writes on the same cycles at 44100 and 48000, which `test/clock.mjs`
checks. VGM export is a serialisation of the event stream.

### 5. The triangle starts at a zero-output phase (2026-09-04) - superseded by 13

The core's triangle powered on at sequencer step 15, which outputs 0, where the
hardware powers on at step 0, which outputs 15, to spare every render a DC step
through the high-pass filters. Superseded the same day: see 13.

### 6. CI runs the unit tests; the release runs the browser (2026-09-04)

`ci.yml` runs typecheck, build, the validator, the clock tests and the golden hash
on every push and pull request. `publish.yml` keeps the fresh-install test that
installs the tarball and drives it in a browser.

**Why.** The browser test needs Playwright and a Chromium download and takes
minutes; it is the right gate for a release and the wrong one for a commit. The
unit tests take seconds and catch the class of regression that actually happens
between releases.

### 7. Licences: MIT stays MIT (2026-09-04)

The `chipvoice` package stays MIT and contains only MIT-compatible code. GPL
cores are not used in it. LGPL cores compiled to WebAssembly ship as their own
packages under LGPL, with source, and `chipvoice` depends on them optionally.

**Why.** A permissive package is what gets adopted in games, and the licence of a
core is a property of the core, not something to negotiate per file.

*Amended by 17:* the YM2612 is a port, not a WebAssembly build, and it is one
LGPL file inside the package rather than a second package. The licence field
says `(MIT AND LGPL-2.1-or-later)` and the licence file names the file, so the
boundary is as explicit as a package's would be and a consumer who cannot take
LGPL knows which file to leave out.

### 8. Documents live in the repository, in English (2026-09-04)

`docs/` holds the roadmap, the method, the sheets and this file. They are written
in the repository's language, next to the code, and updated in the same commits
as the changes they describe.

**Why.** A document elsewhere drifts; a document in another language than the
code excludes the people the project wants as readers.

### 9. The DSP is TypeScript, and the worklet is a bundle (2026-09-04)

The chip is an ordinary TypeScript module, `dsp.ts`, that implements `ChipCore`
and is type-checked with the rest of the package. The worklet is `worklet.ts`,
which imports it; `scripts/build-worklet.mjs` bundles the two with esbuild into
one self-contained script and writes it out as the string the driver hands to
`addModule`. Tests and scripts stay plain JavaScript: they import from `dist`,
so they test what ships, with no toolchain between them and Node.

**Why.** The DSP was plain JavaScript with no imports so it could be pasted into
the worklet verbatim, and that made it the one part of the package the compiler
never checked - `@ts-nocheck` on the core of the project. The constraint was
always on the emitted script, not on the source; a bundler makes it a property
of the output. Phase 1 changes the units on every event and phase 5 embeds
WebAssembly in the worklet, and both are easier with types and a bundler than
without.

**What changes.** `dsp.js`, `worklet-shell.js` and the generated
`dsp.generated.ts` are gone. The golden hash did not move, which is the proof
that the conversion changed nothing but the language.

### 10. Audio URLs stay immutable; a deploy changes what they serve next (2026-09-04)

`/s/{id}.mp3` keeps its one-year immutable cache and its URL. When the engine
changes - phase 0 changed the sound of every drum - a new deployment is what
changes the bytes: the edge cache is purged on deploy, so the next fetch of any
URL renders with the new engine, while a file somebody already downloaded stays
what it was when they heard it.

**Why.** A version in the path would be the more honest URL and would break
every link already pasted into a chat, which is the one thing a share link must
not do. A shorter cache would cost renders for no benefit, since the song never
changes and the engine changes rarely. And a file that stays what it was when it
was fetched is the honest behaviour for a download: nobody's saved MP3 changes
under them.

**What changes.** A release that changes the sound says so in the skill, so an
agent that published before it knows the drums moved. Package and site are
released together, because the end-to-end test compares their renders byte for
byte.

### 11. Register writes are bytes (2026-09-04)

`RegisterEvent` is `{ at, addr, value }`: a byte to an address on the chip's
clock. The core decodes `$4000` to `$4017` the way the chip does, and the driver
encodes its notes into those bytes. The decoded shape - `duty`, `period`,
`trigger`, `stop` - is gone.

**Why.** Bytes are what every chip is from the outside, what every log of a real
machine contains, what a VGM file is, and what an oracle takes. The decoded shape
also let the driver do two things the hardware cannot: change a pulse's period
high bits without restarting its phase, and never write the sweep register,
which on a NES mutes every pulse note at period `$400` or above until `$4001`
holds `$08`. A byte interface cannot skip a register or invent a path. Whatever
the driver does through it, a program on the hardware could have done.

**What changed.** Silence goes through each channel's own registers, never
`$4015`: that register sets every enable at once, and a driver scheduling two
hundred milliseconds ahead cannot know what the other channels will be doing on
the cycle a write lands. A vibrato or a slide across a period high-byte boundary
now restarts the phase, as on a NES; the sweep-unit trick that avoids it is a
ticket. Low pulse notes play. The 5-step frame sequence and the `$4017` write
delay came with the decoder. `RegisterEvent` is now chip-agnostic, which is one
less thing the Game Boy has to force open.

### 12. CI checks a parity baseline, not zero divergence (2026-09-04)

`conform` runs the corpus against the oracle on every push and fails only when a
voice's identical count on any log falls below the committed baseline,
`packages/conform/corpus/2a03/parity.json`. The baseline is rewritten by hand,
with `pnpm --filter chipvoice-conform baseline`, in the same commit as the change
that moved it, and the diff of it is that change's evidence.

**Why.** The first oracle, Nes_Snd_Emu 0.1.7, predates some of what nesdev now
knows, and diverges from this core by its own conventions: frame steps two cycles
late, a triangle that steps at once on reload, envelopes left armed by its
reset, a DMC that starts a bit period early. None of those is a bug here, so
"no divergence" is not a check this oracle can pass, and a check that cannot
pass is a check nobody reads. What must not happen is a regression, and that is
what the baseline catches. When a second oracle settles the conventions, the
baseline moves toward 100 and the check stays the same.

**What changes.** A pull request that changes the chip's sound shows it in
`parity.json` as well as in `golden.json`, and both diffs say in which direction.

### 13. The triangle powers on as the hardware does; the output stage primes (2026-09-04)

The triangle starts at step 0, which outputs 15. `NesOutputStage` sets its
filters, on the first sample, to the state they would have reached on a steady
input at that level, so the power-on 15 puts no step through them.

**Why.** Blargg's `apu_mixer` test walks the triangle from power-on to the
sequence's zero and leaves it there while it checks the mixing table against the
DMC. From step 15 it landed on 15 instead, and the whole table read 22 dB worse
than his recording of a real NES. From step 0 it lands on 0 and the core cancels
as well as his console. The digital chip has one truth, the hardware's; a click
is the analog stage's problem, and a console that has been on for a second has
no click either.

**What changed.** Decision 5 is withdrawn. The golden hash moved with the
triangle's phase, and the parity baseline moved with it too: the oracle powers
its triangle on at 0, so every silent cycle now differs on that voice.

### 14. The Game Boy's chip is written from the documents, not ported (2026-09-04)

`gb/dsp.ts` is our own, from Pan Docs and blargg's "Game Boy Sound Operation",
behind the same `DigitalChip` and `ChipCore` as the 2A03. The roadmap had said
"port SameBoy's `apu.c`".

**Why.** A port buys verification only if the ported code is verified and stays
verified through the port, and SameBoy's APU is written into its emulator's
state in a way that would have been rewritten line by line to fit the chip
interface. The verification here comes from the ROMs, not the source: blargg's
`dmg_sound` suite checks the hardware to the cycle on the things that are hard
to get right, and a chip that passes it is verified whoever wrote it. Two
choices the documents leave open are taken from SameBoy and marked as such on
the sheet: timers run only while a voice is on, and the wave RAM corruption's
window. Where a later chip's reference core came from the die, as Nuked-OPN2
did, the roadmap's reasoning still holds and that one is ported.

**What changed.** Ticket P3-1's wording, the roadmap's chip table, and the
sheet's "Core" line. The harness carries an SM83 next to its 6502.

### 15. The driver splits at the frame (2026-09-04)

One driver reads instruments and produces frames - `FrameState`: a volume, a
pitch in hertz, a duty, a noise index, a bend - and each chip has a
`ChipDriver` that turns a note's frames into its registers. A song's four
lines are roles, and `ChipSpec.roles` says which voice each lands on.

**Why.** The instrument model is FamiTracker's, tables read one frame at a
time, and it is the right model for every chip whose programs rewrote the
registers every frame - which is all of them until the SNES. What differs
between chips is not the reading of the table but what a frame costs: a
volume is a byte on the 2A03 and a retrigger on the Game Boy, a bass note is a
triangle period on one and a waveform in RAM on the other. Putting that below
the frame keeps the arpeggios, slides and vibratos in one place and lets a
chip say, in its own file, what its idiom is. The alternative - a per-chip
driver each reading the tables its own way - would have drifted the moment a
third chip arrived. The 2A03's golden hash did not move through the rewrite,
which is the proof that the frame was where the split already was.

**What is still the 2A03's.** The noise index and the pitch table's units.
Both are named as such on `FrameState` rather than generalised, because the
songs were written in them and a generalisation without a third chip to test
it against is the bad abstraction the roadmap warned about.

### 16. The score carries words, not instruments (2026-09-04)

A score is four lines, a tempo, an order, and an *intent*: one word per role
from a catalogue (`INTENTS`), which each chip's arranger maps onto an
instrument in its own idiom. The roles keep their names, `lead`, `chord`,
`bass`, `perc`. A song with no intent arranges to the instruments every song
had before, to the number.

**Why.** Instruments are the chip's: a duty and a volume table on a 2A03, a
waveform in RAM on a Game Boy, four operators on a YM2612. Putting them in
the wire format would have made every stored song an arrangement for one
chip, which is what the format already was without admitting it. A word is
what a person or an agent actually means - "a bright lead" - and it leaves the
arranger free to be idiomatic, where a parameter would push every chip
towards one wrong answer. Words over parameters was a lean in SCORE.md; the
Game Boy's bass decided it: `"hollow"` means a square wave in wave RAM there
and nothing on a NES, which no parameter could express and a word says.

**What changed.** `Score`, `arrange`, `INTENTS`; the API's schema, spec and
skill read the catalogue; the studio arranges the same way the API renders;
the validator names a word that is not in the catalogue. `SCORE.md` moved from
draft to decided.

### 17. The YM2612 is Nuked-OPN2 ported line for line, and Nuked is its oracle (2026-09-04)

`chips/md/ym2612.ts` is Nuked-OPN2's `ym3438.c` in TypeScript with Nuked's
names kept, so the two can be read side by side. Nuked itself, built natively
in the harness, is the oracle the port is compared with. A line-for-line port
is a derivative work, so that one file is under the LGPL 2.1 as Nuked is,
with the notice in the file, the package's licence field saying
`MIT AND LGPL-2.1-or-later`, and the licence file naming the file; the rest
of the package stays MIT.

**Why.** The roadmap said "compiled to WebAssembly". A WebAssembly build
would have kept the package's dependency-free, readable-in-devtools character
for every chip but this one, added a toolchain, and made the chip a black box
the harness could only compare from outside. A port keeps the code inspectable
and the harness's trace inside it, and the die-derived reference is still the
authority, because it is the oracle. Decision 14 chose writing over porting
for the Game Boy because the verification came from ROMs, not the source;
here the source *is* the verification, so the port is the point.

**What changed.** The chip's file carries the LGPL 2.1 notice and the package
README says which file is under which licence. The SNES followed the same
day: `chips/snes/sdsp.ts` is snes_spc's SPC_DSP ported the same way, the
second LGPL file, with snes_spc as its oracle.

### 18. The SID is written from the documents, and reSID-fp is its oracle in the harness only (2026-09-04)

`chips/c64/sid.ts` is chipvoice's own code, written from the 6581 datasheet,
kevtris's rate register values, plogue's ADSR findings and the behaviour the
VICE and reSID projects recovered from the die and published: the noise
register's taps and its two-cycle shift, the write-back of combined
waveforms, the cycle-by-cycle state changes of a gate, the power-on values.
reSID-fp, which is GPL, is vendored in the harness as the oracle and nothing
of it is in the package; the package stays MIT for this chip. The combined
waveforms are a model with six numbers per combination, fitted against the
oracle's tables; the harness scores the fit.

**Why.** Open question B: a GPL core cannot ship in an MIT package, and a
separate GPL package would have split the library in two for one chip. The
Mega Drive and the SNES were ported because their reference cores carried the
verification and were LGPL, which a file can carry; reSID-fp carries the
verification too, but as GPL it can only be the thing the chip is compared
with. Writing from the documents and comparing with reSID-fp cycle for cycle
gives the same sheet the ports have - identical on every log - without the
licence. What is not clean-room about it is honest: the documents were read
alongside the oracle's source, and the model of the combined waveforms is the
one its authors described. The code is chipvoice's; the facts are the chip's.

**What changed.** Question B is closed. The harness has a GPL directory with
its own licence file and README; the package's licence field is unchanged.
The sheet says which of the chip's behaviours come from which document.

## Open

### B. The SID's licence

Closed by decision 18: written from the documents, reSID-fp in the harness
only, and the sheet is not weaker for it.
