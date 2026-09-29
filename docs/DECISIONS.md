# Decisions

<p align="center">
  <a href="DECISIONS.md">English</a> &bull;
  <a href="DECISIONS_ja.md">日本語</a>
</p>


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

**Amended 2026-09-07:** Keep the English originals and add Japanese `_ja.md`
siblings following RTK, as requested by the user. Each document links both
languages; update both with the implementation. The existing French audit keeps
its original language. See [documentation maintenance](README.md#translations).

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

### 10. Audio URLs stay immutable; a deploy changes what they serve next (2026-09-04, superseded by 21)

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

### 19. No new systems: the site is an instrument first (2026-09-04)

Updated by decision 20: the playable-demo spec sets V1 scope and order. The
first sound is explicit, and targeted transport/score repairs precede the UI.

Five chips are shipped, verified and released, and no sixth is started until
the site is the most interesting thing to land on. The engine, the score, the
harness and the sheets stay as they are; the work is the layer in front of
them, phase 8 of the roadmap, in the backlog's order of importance: the
first tap works, the page opens playing, the five machines are one gesture,
a tap is a sound, the rows show their level, pitch is height, the drums are
pads, then live play, MIDI and exports.

**Why.** The product is judged by someone landing on chipvoice.dev, and what
they meet today is an editor for people who read notes and know a tracker:
four steps between a tap and a sound, the machines in a dropdown, an empty
output box. A sixth chip changes nothing for that person; five machines one
click apart changes everything, and it is the one thing nobody else has. The
browser music tools that people share have no setup, one gesture per sound
and nothing that can sound wrong; the hardware the chiptune scene plays is
pads with sixteen sounds; the producers' reference is a chip under a MIDI
keyboard. None of that needs another chip.

**What changed.** Phase 8 in the backlog and the roadmap; the roadmap's later
systems closed until it is done; the README points at it.

### 20. A playable library demo, with two foundations repaired first (2026-09-05)

Updated by decision 38: V1 is accepted and new systems reopen under its guards.

The product discussion following the audit defines chipvoice.dev as a playful
demonstration of the library. [DEMO.md](DEMO.md) is the implementation spec.
V1 is three composed presets, five machine selectors, four reactive role lanes,
four arcade effect pads, simple editing, sharing and runnable code export.
Sound starts on an explicit musical gesture, not an arbitrary first click.

**Why.** The demonstration should make the library's capabilities audible:
portable music, machine-specific sound and real voice stealing. The audit
reproduced loss of score structure on fork and pending music overwriting Stop
or SFX. Those two defects prevent an honest demo and must be repaired first.
Existing cores and framework stay; their transport and integration can change.

**Order.** Repair score preservation and event cancellation with behavioral
regressions; deliver the first playable screen; complete editing, sharing and
code export. Instrument the first slice. Identity recovery and other audit
work have explicit follow-ups, but do not block anonymous play unnecessarily.
Live recording, controlled variations, MIDI and stems follow V1. New systems
remain closed until V1 acceptance, then are considered by demand; optional
later features do not make that gate indefinite.

**What changes.** This supersedes decision 19's arbitrary-click autoplay,
unchangeable-engine constraint and all-fourteen-tickets release scope. The
backlog preserves existing ticket IDs and assigns delivery slices. The earlier
decision remains above as historical reasoning.

## Open

### B. The SID's licence

Closed by decision 18: written from the documents, reSID-fp in the harness
only, and the sheet is not weaker for it.

### 21. Stable audio URLs revalidate the current renderer (2026-09-05)

Supersedes decision 10. Published scores remain immutable, but the engine,
arranger and output profile deployed by the server determine their current
render. `/s/{id}.mp3` and `.wav` keep their URLs and return `Cache-Control:
public, no-cache` with an ETag derived from the rendered bytes. A browser must
revalidate; a deployment cannot silently leave a year of stale browser audio.
Existence/deletion is checked before rendering. Saved downloads retain their
bytes. MP3 and WAV preserve stereo; tags identify the selected machine.

This contract deliberately does not promise archival reproduction across engine
versions. Pin the npm package and keep the full score for reproducible projects.
A content-addressed render cache and engine-versioned archival assets remain
AUD-2 follow-ups, with measurements before adding infrastructure.

### 22. Cancel musical commands outside the digital chip (2026-09-05)

Queue placement superseded by decision 23; ownership and cancellation semantics
remain in force.

The transport owns future writes by voice and effect, feeding the digital core
one render block at a time. Stop removes future owned writes; an effect replaces
a voice and restores the remaining held music with complete register state.
Canceled initialization invalidates the driver's patch/sample cache. Raw bus
writes and the conformance oracle API retain their original semantics.

Incremental scheduling exposed an existing MD/SNES queue defect: adding writes
reset a cursor without discarding consumed entries, replaying old registers.
Discard consumed entries before merging. Regression tests compare 128- and
4096-sample renders byte for byte and verify cancellation and recovery on actual
output. The MD/SNES song goldens change because obsolete writes no longer
retrigger their voices; raw corpus parity must remain unchanged.

### 23. Consume one shared scheduler directly at each bus clock (2026-09-06)

The mixer conformance job exposed a design problem in decision 22's wrapper:
`push(...events)` exceeds the VM's argument limit on legitimate captured ROM
logs. Replacing the spread alone would preserve redundant global sorting,
per-block splicing/cloning, and a second queue in the digital core. Several
cores also shifted the entire remaining array on every consumed write.

Remove the transport wrapper. Each bus owns an internal `EventQueue`, used by
both live music and raw capture replay and consumed directly at its existing
hardware clock. Incoming batches become sorted runs; a heap merges their heads.
An already ordered batch costs O(n) to enqueue plus O(log r) to insert its run;
unsorted input sorts only that new batch. Consumption costs O(log r), or O(1)
for a single run, where r is the number of pending runs. Equal-cycle writes keep
arrival order. The queue caches the next timestamp for the idle per-cycle path.
Consumed references are cleared, and no register records are cloned during
consumption. The Mega Drive has separate YM and PSG clocks; accepted YM bus
writes use a ring FIFO, preserving the hardware's serial write acceptance.

Ownership is interpreted only by the scheduler, before register decoding.
Cancellation compacts affected runs and rebuilds the heap; it does not undo
accepted hardware writes. Raw writes have no owner and remain uncancelled.
Repeated writes, triggers and address/data ordering are meaningful hardware
operations: no arbitrary event limit, dropping or register deduplication here.
The musical encoder can still omit unchanged state where its chip contract
permits that optimization.

The offline host now supplies its advancing render clock to the shared driver.
Flush prunes expired music and effect history across all voices in place;
reset initializes sample memory once after resetting the core. Live memory
messages rely on structured cloning instead of making another preliminary copy.

Tradeoffs: a run retains its reference-array capacity until consumed (objects
are released individually); cancellation scans affected runs. Active/future
notes still retain the frames required to restore held music. This is bounded
by scheduled work, not a constant-memory streaming claim. The shared scheduler
adds some code to each standalone worklet but introduces no runtime dependency.
Packed transferable buffers or a shared-memory transport need measurements of
real browser messaging pressure before adding another protocol.

Qualification covers 500,000 writes, randomized interleaving/cancellation,
hardware FIFO wraparound, offline clock/expiry/reset, five-chip block-size and
audio regressions, the mixer capture that originally crashed, and browser audio.
See [the scheduling evaluation](evals/SCHEDULING-2026-09-06.md). Host timings are
not representative: the user's machine was heavily loaded.

### 24. Reuse hot-path scratch without sharing retained results (2026-09-06)

Audio cores own reusable stereo scratch; BRR encodes own two search buffers;
the demo owns its position polling buffer. Default snapshot-returning calls
remain independent, including `Chip.position()`. Callers can opt into
`position(into)` without mutating the sequencer timeline. React state receives
snapshots only when values change, never mutable scratch storage.

Keep pending register records and musical frames independent until consumed;
zero-copy PCM views remain preferable to extra sample copies. Optimize repeated
object/array construction and copying where ownership allows it, rather than
introducing global pools or moving every scalar variable out of its loop.
The [hot-path audit](evals/HOT-PATHS-2026-09-06.md) records the corrected sites,
compatibility checks and the distinction between source-level construction
counts and measured GC/CPU behavior.

### 25. Record input against the audio timeline, commit playback once (2026-09-06)

The demo captures note and drum presses at the live AudioContext clock.
`Chip.quantizedPosition()` rounds to the nearest sixteenth using the sequencer's
audible timeline; exact half steps round forward. Pattern lengths, repeated order
entries and loop wrap belong to that calculation. Startup and scheduling gaps
return null. The UI additionally rejects capture while the context is suspended.
The animation frame's last position and the scheduler's future cursor are not
input timestamps.

Each take edits the full score through functional document updates and one
history group. Edits persist to the local draft as they arrive. The backing
score and its display remain stable throughout capture; finishing loads the
updated score once at the existing position. This uses the existing scheduler
and ownership restoration, with no per-tap transport restart or second player.
Captured taps audition immediately through the current chip's SFX ownership.

The user can change roles and scales during a take. Tempo, machine, mute/solo,
cartridges and direct editing are locked until finishing. Stop, Undo, focus loss
and tab hiding finish capture; stale asynchronous starts cannot rearm it.
Reload recovers the edited score without resuming audio or recording. A repeated
order entry edits its shared pattern, consistently with the grid editor.
Chord insertion preserves existing later voicings and unused authored shapes.

This is grid overdubbing: the last tap on a role/step wins, untouched tokens
remain intact, and duration extends to the next note/cut under the score's
existing convention. It does not record held-key duration or arcade SFX, and
does not need a PCM stream, MIDI layer, metronome or schema migration. Those
can be evaluated as separate interactions. See the
[recording evaluation](evals/RECORDING-2026-09-06.md) for evidence and limits.

## 26. Creative tools reuse the score and tap transport (2026-09-06)

P8-23, P8-11 and P8-12 extend the playable demo after quantized recording.
`varyScore` is a pure seeded transform: melody edits reuse pitch classes, drums
use authored grooves, timbres choose catalog alternatives. Locked roles retain
notes and instruments; the document owns Undo. This does not add an AI service
or another musical state model.

Web MIDI is opt-in without SysEx. Note-on events use the existing tap audition
and quantized recording path; releases and velocity-zero note-ons do not write
steps. Channel 10 maps common GM drums. Port handlers close on selection,
disconnection and unmount. Held-note duration and physical MIDI latency are not
claimed; device/browser support is optional.

Local workers export WAV, isolated role stems, one arrangement on all five
machines and VGM on NES/GB/MD. ZIP uses stored entries, CRC32 and no new runtime
dependency. Bundles include the score and aligned files, capped at two loops
and 30 seconds; WAV retains the library's five-minute cap. Cancellation
terminates the worker. Stems are isolated renders and need not sum to a full
mix where voices or nonlinear output stages interact.

## 27. Bound server rendering independently of playback (2026-09-06)

The request thread should not execute cycle-level DSP. A bundled Node worker
runs one cold render at a time per instance, with a 45-second deadline and a
128 MiB V8 old-generation limit (not a total process-memory guarantee).
Identical in-flight jobs share work. Different cold jobs receive 503 with
Retry-After. Completed audio uses an LRU bounded by 32 MiB, 16 entries and ten
minutes, keyed by the actual built worker hash plus score, options and tags.

Public durations accept integers 1-30; the default remains two loops, refused
with 422 if longer. Invalid query values return 400. Cold work is limited to
six requests/minute/address, cached requests are free. Stable URLs use byte
ETags and revalidation; publication existence is checked before and after work.
These limits/cache are per instance. Distributed quotas or persistent storage
require production demand and measurements; this is not a fleet-wide queue.
Loaded-host timings are recorded only as diagnostics, not product benchmarks.

## 28. Accounts own songs; keys and sessions authenticate accounts (2026-09-06)

An email-normalized stable user owns publications. API keys remain independent
credentials, stored hashed. Browser links create hashed, 30-day sessions in
HttpOnly, SameSite=Lax cookies, Secure over HTTPS; logging in never rotates an
agent key. A conditional token claim and session insert commit in one batch so
concurrent redemption has one winner. Links expire after 30 minutes.

Existing keys with the same normalized email merge into one account; existing
owned songs follow that account. Anonymous publications remain anonymous.
Account tools sit within sharing, with no login requirement for play/drafts.
`GET /api/me` lists the latest 50 account publications. Key listing/revocation
is account-scoped; deleting a key preserves ownership. Cookie writes check
request origin; explicit invalid bearer credentials do not fall back to cookies.

Versioned migrations replace opportunistic ALTER/catch startup. Schema, data
backfill and version markers commit in one write transaction; failures roll
back and remain visible. Initialization shares its promise within the module.
Legacy magic links migrate hashed; consumed legacy links are marked consumed in
the old table too. The additive old tables remain, but rolling back to a writer
that does not set user_id is not a supported steady state: use a backup/forward
repair before relying on identity again. No production DB or email was used
for qualification; migrations are tested against disposable legacy/fresh files.

## 29. Native fidelity bypasses musical reconstruction (2026-09-07)

Keep three interfaces over the same chip cores: simple scores/presets, expressive
polyphonic performances/custom instruments, and native register plans. A chip
can produce far more timbres than a preset catalogue contains. Emulating its
rules does not require cataloguing each sound, and a simple API must not limit
the low-level capabilities.

On its original machine, a familiar song uses its original driver/log commands,
including instrument automation and samples. MIDI transcription and portable
note observation remain useful for editing and other-console arrangements, but
cannot certify original timbres. Mario and Zelda use independently verified NES
NSF execution; Sonic uses independently decoded VGM commands including DAC drums.
Selecting a cartridge selects its original console. Native solo masks voices
without changing shared bus timing; tempo/transpose edits remain adaptations.

VGM timestamps describe logical register commands at 44,100 ticks per second,
not physical bus writes. Multiple FM commands at the same sample need the
reference's buffered-write spacing (15 internal clocks between port bytes).
Without it, operator and pitch settings are overwritten before the YM2612
applies them. A second core fed the same incorrect serialization also passes a
comparison, so source-command equality and core-output equality alone are not
a complete integration test. Test effective register state, independent audio,
visible spectra and actual browser output as well. Report bus timing scope;
do not call rounded/serialized VGM playback original CPU-cycle timing.

The source command ledger, reviewed portable extraction, complete native artifact,
initialization recipe, and serialized bus have separate checksums. Source files
and independent references are pinned; rendering must not regenerate the oracle.
Physical analog fidelity and exact cross-console timbres remain separate claims.

For the requested familiar-song demo, the selected credited audio command logs
and recordings may live in the repository, including Sonic VGM/DAC data. This
is a scoped exception to exploratory corpus storage in CONFORMANCE.md. These
game music assets are not covered by the library code licence; executable
NSF/ROM files and entire downloaded archives remain local.


The Zelda regression also requires song identity to precede emulation parity. An emulator and a reference can agree perfectly on the wrong NSF subsong. Pin the selected track and independently check a reviewed musical phrase before source acceptance and publication. Catalogue identity, full command parity and physical audio fidelity are separate claims; [regression evidence](evals/ZELDA-SELECTION-2026-09-07.md).

## 30. Agents authorize through the standard device grant, not a dialect (2026-09-15)

Agent authorization speaks OAuth 2.0 on the wire: the Device Authorization
Grant (RFC 8628) at `/api/v1/oauth/device_authorization` and `/api/v1/oauth/token`,
advertised by RFC 8414 server metadata and RFC 9728 resource metadata under
`/.well-known/`, with the metadata URL repeated in every `401`'s `WWW-Authenticate`.
The grant lifecycle in `apps/web/src/lib/agents.ts` did not change; the standard
endpoints are a second face over it, and the earlier `/api/v1/agent-requests`
JSON API stays as a deprecated alias so agents already paired keep working.

**Why.** The custom API had the same shape as the standard (a private code, a
public code, a verification link, polling with a slow-down) but different field
names and error vocabulary, so every client needed chipvoice-specific code and
the skill had to teach a protocol. OAuth device-flow clients already exist in
every agent runtime and in the MCP authorization specification; conformance to
the standard makes chipvoice reachable by agents nobody wrote for it, and lets
one generic client, one conformance check and one three-line skill section
serve every service that speaks it.

**What changes.** New agents discover the endpoints instead of reading a guide.
Scopes keep their names; they are advertised in `scopes_supported`. Unknown
request tokens now answer `invalid_grant` (standard) and `invalid_token` (alias)
instead of being reported as expired. The proxy leaves `/.well-known/` paths
alone: without a file extension they were rewritten into the locale tree.
`apps/web/test-agent-oauth.mjs` pins discovery, every routine and terminal
token answer, one-time delivery, scope enforcement and the alias sharing the
grant. `apps/web/test-auth-conformance.mjs` (2026-09-16) adds the outside view:
the generic conformance script every issuer of the grant shares, vendored under
`apps/web/vendor/`, written from the RFCs and knowing nothing of chipvoice, must
get the same nine answers - the owner's approval and refusal are a browser
session, never an API call.

## 31. The approval page answers before it edits (2026-09-16)

On `/connect`, after "Review access", the decision (expiry, Authorize, Decline)
comes right after the agent's permissions, the section scrolls itself into
view, and the profile editor is folded by default.

**Why.** The first person to connect an agent for real reviewed the request,
read the permissions, and told the agent "done" - with the Authorize button
below the fold, pushed there by a profile editor that opened by itself for a
fresh artist. The agent waited on a code nobody had answered, then blamed its
own side. A page that asks for a decision must show the button that gives it
where the person is looking.

**What changes.** `apps/web/src/community/Connect.tsx` reorders the section and
scrolls to it when the request loads. `apps/web/test-artists.mjs` pins the
button inside the phone viewport after review and the editor folded;
`test-creator-journey.mjs` opens the editor before filling it. The profile is
still editable there, one click away, and the agent kinds do not need it.

## 32. A game's own Mega Drive driver beside the portable one (2026-09-26)

chipvoice has a second Mega Drive driver, `compileMdVoices`, beside `MdDriver`.
`MdDriver` plays the portable score's four roles and must sound like the same
song on five machines; the native driver takes the six FM channels, the three
tones, the noise and the DAC by name and plays what a game written for this
machine plays. A text tracker, a bank with a PCM kit and the render steps a
game ships through come with it: [MD-NATIVE-DRIVER.md](MD-NATIVE-DRIVER.md).

**Why.** Punk Force, a shooter written for this chip, grew its own driver,
tracker and render script in its game repository, because the portable path
could not give it a DAC kit, hard pan, six FM voices or a patch per note.
Nothing in them was about that game; a second game would have copied them.
Decision 29 already keeps native register plans as a third interface over the
same cores, and this is its authoring side for one machine. Folding it into
`MdDriver` would have tied the portable score's promise (every role on every
machine) to voices four machines lack.

**What changes.** `compileMdVoices`, `arrangeMdTracker`, `MD_BANK` and its
parts, `renderMdEvents`, `MD_BRIGHT_PROFILE` and five render helpers are
exported. `FmOperator` takes `ssg`, which both drivers write to `$90` (0 when
absent, as before). The extraction was proven by compiling the game's score
both ways: the same register writes for five songs and forty effects, and the
same samples after render, trim, level and sprite packing. The one difference
is a fix: without a tail, the game's tracker returned a loop end of zero.
`test/md-native.mjs`, `test/game-audio.mjs` and `test/golden-md-native.mjs`
pin it. The LFO stays off and channel 3's special mode is unused (P5-12).

## 33. The shared render lease favors publications and meters caller time (2026-09-26)

Evaluate, MP3 encoding and composition validation already shared one
fleet-wide render lease with publication rendering (decision 27); the
`utilityWorker` that granted it did not distinguish who was asking or what
else was waiting. A single anonymous caller making repeated evaluate calls,
each holding the lease up to its deadline, could keep every publication
render queued behind it indefinitely, and every other caller with it.

`apps/web/src/lib/utility-worker.ts` now checks two admissions before
evaluate, MP3 encoding or composition validation take the lease: a fresh
queued publication render (not only a rendering one) refuses admission
outright, bounded by a 270-second staleness window so an abandoned queued row
cannot block work forever; and a per-caller render-time budget, tracked in a
new `worker_time_budget` table and charged by `apps/web/src/lib/projects.ts`'s
`chargeWorkerTime` whether the held work succeeded, failed or timed out.
`admitWorkerTime` refuses with 429 `worker_budget` and an accurate
`Retry-After` once a caller has spent 60 seconds of render time in the current
minute signed in, or 20 seconds anonymous - well under the six evaluate
requests per minute `admitProject` already allows, so repeated short requests
cannot substitute for one long one. Every `utilityWorker` caller now passes an
identity: the bare account ID signed in, `anonymous:` plus `clientKey(request)`
anonymous, matching the convention `evaluate/route.ts` already used. A queued
publication still starts on its owner's next job poll, as before: nothing is
started outside a request's `after()`, where a serverless instance could freeze
it mid-render.

**Why.** Decision 27 kept rendering to one fleet-wide slot deliberately, as a
cost choice, and that stays: this decision does not add a second concurrent
lane, add capacity, or change who may render at once. It changes who the one
slot serves when several callers want it. Publication renders are the
product's core promise and have an owner waiting on them; evaluate is a
preflight check an agent can retry. Counting evaluate calls (already six per
minute per address) bounds how often a caller can ask, not how long each turn
holds the shared slot, so a caller requesting the full 30-second deadline
every time could still spend nearly all of it. Measured against the starter
fixture and an eight-times-denser variant, an evaluate call completes in
200-470 ms because it renders only a two-second excerpt regardless of song
length - about 30x headroom under a shorter 15-second anonymous deadline, so
tightening it costs normal callers nothing while capping how long one stuck or
adversarial anonymous request can occupy the lease.

**What changes.** `apps/web/src/lib/utility-worker.ts` gains the
queued-publication check and the render-time admission.
`apps/web/src/lib/projects.ts` gains
`admitWorkerTime`/`chargeWorkerTime` and a `retryAfter` on `ProjectHttpError`;
`apps/web/src/lib/project-http.ts` reflects it in the `Retry-After` header
instead of a fixed 60. `apps/web/src/lib/migrations.ts` adds the
`worker_time_budget` table. `apps/web/src/lib/evaluation.ts` shortens the
anonymous evaluate deadline to 15 seconds (30 stays for signed-in callers and
for `apps/web/src/lib/composition/jobs.ts`'s validation step, which now also
passes the composing account's identity). `apps/web/test-artists.mjs` pins a
queued row blocking evaluation, a stale queued row not blocking it, and both
budgets refusing with a correct `Retry-After` and resuming once spent;
`apps/web/test-projects.mjs` updates its direct `utilityWorker` call for the
new identity parameter.

## 34. No page can be framed, an agent's name is marked unverified, and sign-in mail is throttled per address (2026-09-26)

Every response carries `X-Frame-Options: DENY` and
`Content-Security-Policy: frame-ancestors 'none'` (`apps/web/next.config.ts`).
On `/connect`, the agent's declared name is labelled self-declared and
unverified, next to how long ago the request was made and a warning against
approving one the person did not just start themselves. `/api/auth/signin`
throttles outgoing mail per recipient address, on top of the existing per-IP
limit.

**Why.** No chipvoice page has a legitimate reason to sit inside another
site's frame, including the agent approval page itself, so refusing all
framing removes a class of clickjacking for free. On `/connect`, an agent's
`label` is whatever text it sent when it created the request; shown as a
plain heading it read as something chipvoice had checked, which is exactly
where an agent posing as "chipvoice support" would put a name to talk someone
into approving a device code they did not request, especially over a phone
call or a shared screen. Sign-in links must never reveal whether an address
has an account, but nothing before this stopped one address from being
flooded with them; a per-IP limit alone does not stop that flood once it is
spread across many IPs.

**What changes.** `apps/web/next.config.ts`'s `headers()` sets both framing
headers for every path; `apps/web/test-auth-http.mjs` checks them on `/` and
on `/connect`. `apps/web/src/community/Connect.tsx` shows the label with a
"self-declared, not verified by chipvoice" note and an elapsed-time line
asking the person to decline unless they started this just now;
`apps/web/src/lib/agents.ts`'s `inspectAgentRequest` now returns `createdAt`
for that line to read. `apps/web/src/app/api/auth/signin/route.ts` admits at
most three links per normalized address per fifteen minutes, answering an
exceeded throttle exactly like the per-IP limit (429, `Retry-After`) and
never revealing whether the address has an account either way.
`apps/web/src/lib/projects.ts`'s `admitProject` takes an optional window
length now, and stores its window as an absolute timestamp instead of a
dimensionless index, so two callers using different window lengths cannot
delete each other's still-valid rows during cleanup. All three changes are
pinned in `apps/web/test-auth-http.mjs`; the agent-identity note is also
checked against the phone viewport in `apps/web/test-artists.mjs`, so it
cannot push the Authorize button below the fold that Decision 31 fixed.

The emailed sign-in link no longer signs anyone in by being opened.
`GET /api/auth/redeem` only checks that the link is still good and sends the
person to `/signin/confirm`, whose button posts back to the same route; that
POST is the one thing that spends the token. Mail scanners and link
prefetchers open links to inspect them, and the old GET spent the one-time
token before the person ever clicked, which then read as an expired link.
Three smaller fixes ride along: `clientKey` in `apps/web/src/lib/limit.ts`
now prefers `x-real-ip` and otherwise the rightmost `X-Forwarded-For` entry,
because the leftmost one is whatever the client chose to send and let a
caller pick its own rate-limit bucket; the admin key on song deletion is
compared in constant time and never matches when unset; and
`apps/web/src/lib/db.ts` refuses a development database URL without its own
`TURSO_DEV_AUTH_TOKEN` instead of falling back to the production token.
`apps/web/test-auth-http.mjs` pins that a GET sets no cookie and leaves the
token redeemable, and that a spent token cannot be redeemed twice.

## 35. Chip engines load with what needs them, not the shared shell (2026-09-27)

`apps/web/src/studio/document.ts` carried a module-scope `import {arrange,
validateSong} from 'chipvoice'` next to `DEMO_MACHINES`, a plain array of chip
logos and labels. `PersistentPlayer` (mounted on every route) and
`SiteHeader`/`MachinePicker` (rendered on nearly every page) only needed that
array, but importing it from `document.ts` pulled in the whole package: all
five chip emulators and their inlined AudioWorklet sources, because
`validateSong` genuinely depends on every chip's concrete spec to check a
song's notes against its voice count. About, Connect, Docs, Signin and the
three Lab pages - none of which plays an emulated chip, only pre-rendered
recordings - shipped roughly 627KB of chip-engine JavaScript they never used.

**Why.** Chip metadata for display (a name, a logo, a year) and the actual
playback/validation engine (an AudioWorklet processor per chip, 30-56KB each)
lived in the same module, so importing either dragged in both. Splitting them
lets the shared UI shell stay light while the editor, arrangements deck and
lab keep loading the real engine exactly where they already need it.

**What changes.** `apps/web/src/studio/machines.ts` holds `ChipId`, `ROLES`,
`ROLE_NAMES`, `MACHINES`, `DEMO_MACHINES`, `tokens` and `lengthOf` - pure data
and string helpers, with no runtime import of `chipvoice`. `document.ts`
re-exports them for its existing consumers (the studio editor, arrangements,
the publication view); `Player.tsx` and `ui/components.tsx` - the two modules
reachable from nearly every route - import directly from `machines.ts`
instead. Measured from `apps/web`'s build output: About, Connect, Docs, Signin
and the three Lab pages drop about 627KB each (roughly half their first-load
JS). Create, Explore and Library still load the real engine for their own
editing features, but each drops about 281KB too, because before this change
they were loading it a second time through the shared UI shell as well; only
the home page, which needs none of the chip machinery, is unchanged.
`apps/web/test-page-weight.mjs` reads the built
`.next` output directly (no server, no browser) and fails if any of those
seven audio-feature-free pages ever references a chunk containing
`registerProcessor` again.

## 36. Publishing gains a parity gate and creates its own release (2026-09-27)

`publish.yml` runs `test:parity` after `test:fresh`, before `npm publish`: the
offline render and the worklet's live capture have to describe the same
loudness, headroom and brightness, or the MP3 a listener downloads is not what
they actually heard. It hosts `packages/chipvoice` itself on the fixed port,
4181, the check has always expected a server there rather than starting one of
its own. Once `npm publish` succeeds, the job also creates the tag's GitHub
release, `gh release view "$GITHUB_REF_NAME" || gh release create "$GITHUB_REF_NAME"
--verify-tag --notes-from-tag`, skipping it if one already exists.

**Why.** The chip now runs in two places, a worklet on the audio clock and
Node on a counter, and nothing before this checked that they still agree -
only `test/parity.mjs` did, and it had never run anywhere. Release
qualification is where that check belongs: it is slower and more failure-prone
than the rest of the suite, a real Chromium capturing four seconds of real
audio, which is why CI does not run it on every push, but a release is exactly
the point where "the render matches what people actually heard" has to hold.
The GitHub release, separately, was a manual step that depended on somebody
remembering it after `npm publish` had already succeeded; 0.15.0, 0.15.1,
0.18.0 and 0.19.0 are what happens when nobody does: each reached npm without
one and had to be backfilled by hand. Checking for an existing release
first keeps a maintainer's own manual release from becoming a failed run.

**What changes.** `publish.yml` needs `contents: write` (kept alongside the
existing `id-token: write` for npm's OIDC exchange) to create the release. A
release is still not created if `test:parity` or `npm publish` fails.

## 37. Run the package's unit tests with node --test, not a chain of them (2026-09-27)

`packages/chipvoice`'s `test:unit` script is now `node scripts/run-unit-tests.mjs`,
which reads `test/*.mjs` from disk (all of it but `test/parity.mjs`, which keeps
its own `test:parity` script) and hands the list to `node --test
--allow-natives-syntax --test-concurrency=4`.

**Why.** The old script was over forty commands, `node test/a.mjs && node
test/b.mjs && ...`, one `&&` per file. That chain stopped at the first failing
file and never ran, or reported on, anything after it, and a new test file only
joined the suite if its author remembered to add a matching `&&` clause to that
one line; nothing enforced it. `node --test` runs every file regardless of an
earlier failure and reports every failure it finds, and reading the file list
from disk means a new file joins the moment it exists, not the moment someone
remembers to wire it in.

**What changes.** `scripts/run-unit-tests.mjs` is the one place a file can be
left out on purpose, by name, in its own exclusion list; that list holds one
entry today. `--test-concurrency=4` matches CI's four vCPUs; wall time on the
author's machine went from about 48s to about 20s for the same 49 files.
`pnpm test:unit`, `pnpm test` and the release workflow's own call to
`test:unit` are unaffected by name; only what runs underneath changed.

## 38. Demo V1 is accepted; new chips reopen, with guards (2026-09-27)

Phase 8's V1, as [DEMO.md](DEMO.md) defines it, is merged, deployed and
exercised by the production e2e. It is accepted. P8-9 (phone editing), P8-13
(the SID's filter, which is chip work) and P8-14 (usage measurement) are still
partial or open; they continue after V1 instead of holding it. This lifts the
gate decision 20 put on new systems (the roadmap's "Later").

**Why.** Decision 20 closed new systems so the demo would be finished before
the project spread, and said optional later work must not make that gate
indefinite. The demo is finished; what remains are refinements. The aim is
still more machines, instruments and music, each one measured.

**Guards.** No new chip starts before the open second-oracle tickets are done:
P1-13 (NES), P3-4 (Game Boy), P5-8 (the Mega Drive's PSG) and P7-7 (the SID's
digital part against VICE's test programs). The YM2612 and the S-DSP already
run a reference core line for line, so their next check is a unit. The first
addition is NES expansion audio (VRC6, VRC7, FDS, N163, Sunsoft 5B, MMC5): it
extends a proven chip, and NSF already carries it, so the real-game corpus
(P1-12) grows with it. Every addition follows "a sheet before a chip": a core,
an oracle, test ROMs where they exist and a conformance sheet before it
reaches the public picker.

**Hardware, free evidence first.** An emulator cannot settle the analog stage
on its own. It is a model fitted to someone's measurements, so agreeing with
it proves agreement with that model, not with the hardware; filters, DAC
curves and output stages also vary between units and board revisions. The
order is independent emulator oracles and published recordings of real units
first (blargg's recordings of his NES already back P2-3's mixer), then one
purchased reference unit, a NES, to validate a capture bench and its method
before any other machine is bought.

**What changes.** The roadmap's "Later" lists the additions in order, and
[the backlog](BACKLOG.md#next-steps-2026-09-27) sequences the work. The
backlog's phase 8 and "Later phases" text records the acceptance.

## 39. Generation opens as a closed beta; familiar game melodies stay only while it is free (2026-09-27)

Prompt-to-music ([GENERATIVE-COMPOSITION.md](GENERATIVE-COMPOSITION.md))
opens to people outside the project as a closed beta: by invitation (20 to 50
people to start, not an open sign-up), free, bounded by the existing per-owner
daily limit (`COMPOSITION_DAILY_LIMIT`) and by a monthly spend cap set at the
model provider (100 EUR to start). Pricing is decided afterwards, from the
beta's measured cost per song and the share of songs that pass whole-song
checks and listening.

The Mario, Zelda and Sonic material on chipvoice.dev (the studio's familiar
melodies and the complete arrangements) stays while the site is free and
non-commercial. Before any paid launch it leaves the public site; its hashes,
ledgers and measurements stay in the repository, and a legal review happens
before anyone is charged. Generation declines requests to reproduce a known
theme.

**Why.** The generator works end to end but has been qualified on a handful of
songs, its HTTP acoustic report covers the opening two seconds, and nothing
accounts for money. A closed beta measures what an open launch would
otherwise discover in public. Familiar melodies are a fair way to demonstrate
an engine in a free preservation project; the same material beside a paid
product is a different risk.

**What changes.** This refines GEN-13: fixture tests alone still do not launch
paid inference, and neither does a beta without its measurements. Step 6 of
[the backlog's next steps](BACKLOG.md#next-steps-2026-09-27) lists the work.

## 40. Published recordings live in object storage, under paths that name their content (2026-09-27)

The lab's and the arrangements' FLAC recordings move out of git into a public
Vercel Blob store. They were 145 MB of the checkout, and each lab publication
added another 8 to 48 MB to the history for good. The two reports stay in the
repository as the manifest, with every recording's SHA-256. The lab's paths
already carried an engine version and the PCM's hash; the arrangements' now
carry a prefix of the FLAC's own hash. A store key is its site path, written
once and never overwritten, so Next.js rewrites the two folders to the store
one to one, and a browser may keep a file for a year.

`pnpm audio:push` uploads what a publication adds. `pnpm audio:pull` fetches
a verified local copy, which the site serves before the store. CI pulls
through a cache keyed on the two reports, checking every hash, and
`pnpm audio:check` fails a report that names a recording the store lacks. The
production e2e downloads recordings through the site and compares their bytes
with the reports. The write token is connected to the development environment
only; the deployed site just reads.

**Why.** The repository proves; the store serves. These recordings are
deterministic outputs whose hashes the reports already pin, so their bytes in
git bought nothing a hash does not, and every clone and CI checkout carried
them. Vercel Blob is where the site already deploys, needs no new provider and
costs next to nothing at this size. Git LFS would have put a bandwidth quota
on every clone and CI run without changing what visitors download. Cloudflare
R2 is the move if egress ever dominates.

**What it does not do.** The history is not rewritten, so `.git` keeps its
size; only the growth stops. Only recordings a current report names were
uploaded; the 169 of 316 lab files no report referenced any more are gone.
The old arrangement URLs without a hash now answer 404. A checkout that pulls
this change loses its tracked lab copies with it; the site still plays them
from the store, and `pnpm audio:pull` brings them back.

## 41. Reference emulators under the GPL may be vendored in the harness, never in the package (2026-09-27)

Step 1's second oracles include GPL code: Mesen 2 (GPL 3) for the NES and
VICE's SID test programs (GPL 2) for the C64. They may be vendored under
`packages/conform`, each in its own folder with its licence and a README that
says what is upstream and what is ours, the way the LGPL oracles already are.
They run as separate programs the harness builds and drives over a pipe, or as
test programs its CPUs execute. Nothing from them is linked into, copied into
or ported into `packages/chipvoice`, which stays `(MIT AND LGPL-2.1-or-later)`
(decision 17), and `packages/conform` is private and never published.

**Why.** The strongest available reference is often GPL, and an oracle is
only worth what it is validated against. Running it beside our core, rather
than inside it, keeps the package's licence unchanged while letting the sheets
cite the best evidence there is.

**What changes.** A reviewer rejects any change that moves code from a GPL
oracle into the package. A divergence a GPL oracle finds is fixed from the
documents, the way decision 14 wrote the Game Boy's chip, not from its code.

## 42. The server enforces the closed beta: invitations and a monthly budget (2026-09-27)

Decision 39 opened prompt composition as a closed beta with a monthly spend cap
"set at the model provider". Production had neither: any signed-in account
could compose, and nothing counted money. The server now enforces both.

- **Invitations.** With `COMPOSITION_ACCESS=invite`, the default on every
  Vercel deployment, only accounts whose email is in `composition_invites`
  compose; the others get `403 generation_invite_required`. An invitation
  names an email, so it can come before the account.
  `apps/web/scripts/composition-invites.mjs` lists, adds and removes them.
  The migration that creates the table invites everyone who had already
  composed, so nobody loses access they had.
- **A monthly budget.** `COMPOSITION_MONTHLY_BUDGET_USD` caps the calendar
  month (UTC). The month's spend is every generation's recorded token usage at
  the model's list prices (GPT-6 Astra: 10, 1 and 50 USD per million input,
  cached input and output tokens, from OpenAI's pricing page, read
  2026-09-27), plus a worst case (32,768 input tokens and the output cap) for
  each generation still running, or failed after reaching the model, with no
  usage recorded. Admission adds one more worst case and checks the sum in the
  same write transaction as the daily limit, so concurrent requests cannot
  overshoot. A spent budget returns `429 generation_budget` with a
  `Retry-After` until the first of next month. Production refuses to compose
  without the variable, or with a model that has no known price.
- **Saying why.** `GET /api/v1/generations/access` tells the signed-in account
  whether it can compose now and, if not, why (`invite_required`,
  `monthly_budget`, `daily_limit`, `disabled`), without revealing the budget
  or the spend. The composer shows the reason and disables its button.

Production starts at 110 USD a month, about decision 39's 100 EUR. The six
generations recorded before this decision averaged about 6,800 input and 4,100
output tokens, about 0.28 USD each, so the cap covers some 350 songs a month.
The worst case, about 1.5 USD with the 24,000-token output cap, only counts
while a request runs.

**Why.** A cap at the provider acts after the bill and covers every use of the
key. The server knows each call's usage: it can refuse before a call, say why,
and be tested with the rest of the API. Prices live in code because the
Responses API reports tokens, not money; a new model without a price stops
composition instead of spending uncounted. A limit in the provider's dashboard
remains a useful second fence.

**What changes.** Decision 39's cap moves from the provider to the server.
NEXT-20's quotas are in place for the beta; billing remains.

## 43. Every song and publication records the chipvoice engine that made it (2026-09-27)

Decision 21 stated a limit directly: stable audio URLs revalidate with
whatever engine is currently deployed, "does not promise archival
reproduction across engine versions", and named the fix as "pin the npm
package and keep the full score", left for AUD-2 "with measurements before
adding infrastructure". Nothing recorded which version to pin. NEXT-11 closes
that: `songs`, `projects` and `project_jobs` each gain a nullable
`engine_version` column, stamped with `PROJECT_ENGINE_VERSION` (the chipvoice
package version, already equal to what npm serves per NEXT-01) at the moment
each row is written - a song saved, a revision published, a render job
created. `project_jobs` already carried a content hash of the actual bundled
renderer (`engine`, decision 27's cache key); the version now sits next to it,
answering "which npm release" where the hash only ever answered "byte for
byte the same build".

**Which objects, and what "again" means for each.**

- **Drafts** stay local to a browser (CREATE.md); there is no server row to
  stamp. `prepareProject`/`renderProject` already return `engineVersion` in
  their result, so a draft's exported JSON and its downloader already know
  it; nothing new was needed here.
- **Saved songs** (`/api/songs`, the compact `songs` table) now record the
  version that saved them, shown on the song and through the API. This does
  not change decision 21's own choice for `/s/{id}`: that URL still revalidates
  with whatever engine is live, on purpose, so a listener always hears the
  current sound. The recorded version is a fact about authorship ("made with
  chipvoice x.y.z"), not a pin on what `/s/{id}` renders next.
- **Complete projects** (`/api/v1/projects`, the `projects` table) record the
  version live at publish time. The document itself is already immutable
  (decision 27); recording the version makes the document reproducible on its
  own terms - installing that exact `chipvoice` release and calling
  `renderProject` on it is a known, exact operation, not a guess.
- **Immutable publications' renditions** (`project_jobs`, decision 40) record
  the version that actually rendered them, alongside the existing bundle
  hash. A render always uses whatever engine is current, so a rendition's own
  version can differ from its publication's; it is the rendition's version,
  not the publication's, that reproduces its exact bytes.

**How an older engine is obtained: not installed on the server.** Considered
aliasing exact past npm releases (`"chipvoice-0.19.1": "npm:chipvoice@0.19.1"`)
and loading whichever a render needs. Rejected: the package already bundles
five chip cores and their inlined AudioWorklet sources (about 760 KB minified
per release); every past release added as a dependency grows the deployed
Vercel function by that much again, forever, with no bound, since a
publication can in principle need any release ever shipped. That cost is paid
on every cold start whether or not that release is ever actually requested,
and it means never dropping a version even after a security fix in one of its
dependencies, because some old publication might name it. Against that,
nothing here actually needs the server to re-render with an old engine: a
render always uses whatever engine is current and simply records that fact,
so there is no case where the server must reach for a version it does not
have installed.

So the policy is the one decision 21 already named: the server always renders
with its current engine, and never keeps an old one installed to pick from.
Considered having `createProjectJob` check a publication's recorded
`engineVersion` against the server's current one before its first render of a
kind, and refuse with `409 engine_upgraded` on a mismatch. Rejected: job
kinds are only `preview` and `full`, so a publication whose `full` render
nobody happened to request before the next chipvoice release would become
unrenderable by anyone but its owner republishing it under a new id, breaking
shared links - on every release, including ones that touched nothing about
that publication's chip. The refusal also bought no honesty the recording did
not already give: a rendition's own `engine_version` already says which
engine actually made it, so nothing needs to claim it is the publication's
engine's recording when it is not. So a render always proceeds, and the job
records the version that actually rendered it, whether or not that matches
the publication's own. The caller's remedy for an exact historical
reproduction is unchanged: install the named `chipvoice` version - a
rendition's own, since that is the one that actually produced its bytes - and
render the document locally, which reproduces those bytes exactly because the
document and that release are both fixed.

**Rows written before this shipped get `engine_version = null`, read as
"unknown", not guessed.** Backfilling from a publication's own recording was
considered - decision 21's other suggestion - but `project_jobs.engine` is a
content hash of a specific build, and no table anywhere paired that hash with
the version that produced it before now; there is no reliable hash-to-version
history to backfill from, and guessing from a row's timestamp against release
dates would assume a Vercel deploy landed exactly when a tag was cut, which it
does not. `null` costs nothing and claims nothing false.

**What is shown.** The song, project and job API responses, and their OpenAPI
schemas, all carry `engineVersion` (nullable). `/api/v1/capabilities` keeps
its own `engineVersion` field, which is the server's current engine, not any
one song's or rendition's; its description now says so. A rendition's own
`engineVersion` is the one to install to reproduce its exact bytes; a
publication's own `engineVersion` can differ from it after a deploy, and
neither is a promise about the other. The published-song page shows "made
with chipvoice x.y.z" when a ready rendition's version matches its
publication's, "published with chipvoice x.y.z, rendered with chipvoice
a.b.c" when it does not, and "engine version not recorded" when nothing is
known, in English and Japanese. The skill explains the same distinction.

**Why.** The stated limit was never about capability, only about record-
keeping: decision 21 already knew installing the exact npm version reproduces
a rendering, and decision 27/40 already made a publication's bytes immutable.
What was missing was only the version number itself, recorded honestly for
whichever engine actually did the rendering. That is small, bounded, and
testable; multi-version hosting is none of those on a serverless deployment
with no ceiling on how many releases ship over the project's life, and a
refusal at render time would have traded a rare, already-honest gap for a
real one: a publication nobody could ever render again.

**What it does not do.** It does not make `/s/{id}` archival; that URL still
tracks the current engine by decision 21's own design, and this only adds a
record of what made it, not a pin on what serves it. It does not let the
deployed site itself produce an old release's bytes on demand; that remains
an operation a caller runs locally, against a named, exact, reproducible
target. MIX-14 (render hashes across browsers, Node and phones) and further
AUD-2 measurement remain separate.

## 44. VGM import carries DPCM through a memory block, and rejects what it does not model, by name (2026-09-27)

`importVgm`, which shipped for the Mega Drive only, extends to the NES 2A03
and the Game Boy DMG. Both read the same VGM header
clock fields the file format already reserves for them (`0x84`, `0x80`), so
one function keeps telling the three machines apart the way it already told
the Mega Drive's YM2612 clock from a foreign one.

- **DPCM through `PerformancePlan.memory`, not a DAC-stream command.** A VGM's
  NES DPCM sample data can arrive two ways: data-block type `0xC2` ("NES APU
  RAM write", a plain address-and-bytes dump) or type `0x07` plus the
  `0x90`-`0x95` DAC-stream commands (a compressed bank format meant for
  streaming playback, not for a one-shot sample already sitting in address
  space). `importVgm` supports only the first, and turns it into
  `PerformancePlan.memory`, the same field `recordSong` already fills for a
  DMC sample composed from a score (`packages/conform`'s `script-dmc`
  corpus entry uses it too). `renderPerformance` already knows what to do
  with it: `core.load(address, bytes)` before `core.schedule(events)`. No
  new mechanism, and no bulk-bank decompressor, is needed. Type `0x07`/DAC
  streams are rejected by name; a file that only used them would need one.
- **NES and Game Boy writes need no buffered-write spacing.** The Mega Drive
  importer paces YM2612 writes because the real chip needs cycles between a
  port write and the next; the 2A03 and the DMG's registers have no such
  restriction, so their register writes turn directly into `RegisterEvent`s
  at the write's own VGM sample time, with no artificial spacing inserted.
- **Rejected, by name, rather than silently ignored or best-effort.** A PAL or
  otherwise non-NTSC clock (accepted within 0.01% of the NES's own 1789773 Hz,
  which admits both that and the 1789772 most real rips and VGMPlay itself
  write, and still rejects PAL's 1662607 and Dendy's 1773448), the Famicom
  Disk System bit, a second ("dual-chip") NES or Game Boy chip (bit 7 of the
  register byte, the VGM convention for both), and another chip's clock in
  the same header each throw a named error rather than produce a
  plausible-looking but wrong render: none of the four is modeled by either
  chip core, so a silent partial import would misrepresent what was played.
  VGM versions outside 1.50-1.71 fail the same way, at the format check that
  runs before any machine is chosen. In practice that range is narrower for
  the NES and Game Boy than for the Mega Drive: VGM only reserves their
  clock fields (`0x84`, `0x80`) from 1.61 on, so a file below that version is
  not recognized as either and falls through to the Mega Drive branch
  instead, which fails there on its own header check; the Mega Drive itself,
  whose clock fields sit earlier in the header, keeps the full 1.50-1.71
  range.

**Why.** Reusing `PerformancePlan.memory` and `renderPerformance` unchanged
means the arranger's own scores and an imported VGM are indistinguishable
once parsed, the same property decision 21 wants from any performance plan.
Naming what is rejected, rather than skipping unknown bytes, matches the
package's existing Mega Drive importer and keeps a caller from mistaking a
half-read file for a complete one.

**What changes.** `packages/chipvoice/src/vgm-import.ts` gains an NES branch
and a Game Boy branch beside the existing Mega Drive one, both documented in
the package README and on each chip's sheet
([2a03.md](chips/2a03.md#vgm-import), [dmg.md](chips/dmg.md#vgm-import)),
scored against Nes_Snd_Emu/Mesen and Gb_Snd_Emu/SameBoy on a self-composed,
round-tripped corpus. A rip of a commercial game is not committed here.

## 45. The SPC700 and S-SMP stay MIT; the IPL ROM's 64 bytes are the one embedded exception (2026-09-27)

NEXT-08 adds `chips/snes/spc700.ts` (the CPU) and `chips/snes/ssmp.ts` (its
timers, I/O ports and the DSP address/data latch), both written from Anomie's
SPC700 doc and fullsnes, with their own structure, not `SPC_CPU.h`'s. Neither
crosses the same line decision 17 drew for `ym2612.ts` and `sdsp.ts`: nothing
of snes_spc's own CPU is read into either file, snes_spc's `SPC_CPU.h` runs
only as an oracle, natively built inside `packages/conform` (`play-spc.cpp`),
the way decision 41 already allows. `chips/snes/*` therefore stays exactly as
much MIT as before; this is not a third LGPL exception.

**The one embedded exception.** `ssmp.ts` exports `IPL_ROM`, the 64 bytes at
$FFC0-$FFFF a real SPC700 boots from, mapped in over RAM whenever CONTROL's
bit 7 is set. A `.spc` snapshot is a frozen mid-song state, not a boot state,
but nothing stops a snapshot's own code from re-entering the boot vector, or
from reading $FFC0-$FFFF as data with the ROM bit set - Anomie's doc and
fullsnes both publish these bytes byte for byte as part of documenting the
hardware, so they are sourced the same way every other opcode timing and
register bit in this ticket is, not lifted from snes_spc or any other
emulator's source. They are the only bytes in `spc700.ts`/`ssmp.ts` that are
not chipvoice's own original code: everything around them (the CPU, the
timers, the register dispatch, the snapshot loader) is written, not copied.

**Why embed rather than require one.** The alternative - a caller-supplied
ROM, defaulting to none - was considered and rejected for this ticket only
because every known `.spc` file assumes the same 64 bytes are there; a
snapshot that reads or executes them without one would fail for every real
file, not just a contrived one, so the ROM is not optional in the way a
sample set or a font is. Embedding the well-published bytes directly, the
way `IPL_ROM`'s own name and doc comment already say where they are from, is
the smallest correct implementation, not a shortcut around sourcing it.

**How to remove them, if that ever becomes necessary.** `loadSnapshot()` and
`read()` are the only two places `IPL_ROM` is referenced. Removing the
constant would mean: (1) `Ssmp`'s constructor or `loadSnapshot()` accepts an
optional `iplRom?: Uint8Array` (64 bytes), stored on the instance instead of
imported as a module constant; (2) `read()` throws a named error - for
example `SpcIplRomRequiredError` - instead of indexing into `IPL_ROM` when
$FFC0-$FFFF is read with the ROM bit set and no ROM was supplied, rather than
silently returning zeros or RAM; (3) `importSpc` gains its own `iplRom?:
Uint8Array` option, passed through to `Ssmp`; a caller who wants today's
exact behaviour keeps working only by supplying the same 64 bytes itself,
since the package would no longer ship them - a caller who supplies nothing
gets the same named error from (2) the moment a snapshot reads or executes
$FFC0-$FFFF with the ROM bit set, not a silent substitute. This is written
down, not implemented: nothing today requires removing them, and no caller
has asked for a non-Sony-ROM SPC700.

**What does not change.** `packages/chipvoice`'s licence field stays `(MIT
AND LGPL-2.1-or-later)`, unchanged by this file: the LGPL half still names
only `ym2612.ts` and `sdsp.ts`. The package README documents `IPL_ROM`'s
source next to `importSpc`.

## 46. The exported .spc carries its own tiny SPC700 player, assembled from TS source in the repo (2026-09-28)

P6-9 adds `exportSpc` (`packages/chipvoice/src/spc-export.ts`), which freezes
a SNES song's register-write capture into a standard `.spc` snapshot. Nothing
of chipvoice runs on the machine that opens a `.spc` file, so something has
to replay the writes on the real SPC700 itself: the snapshot's own ARAM
carries a tiny player program (`chips/snes/spc-player.ts`) that reads the
next tick-delta, waits it out on a hardware timer, issues the next
`$F2`/`$F3` pair, repeats, and loops back to the song's loop point forever.

**Why write it, not assemble it externally.** The ticket required the
player's source stay readable in the repo, with the TS-side bytes
reproducible from committed source by a script CI can run, not an opaque
blob. `buildPlayerProgram` in `spc-player.ts` is a small TS emitter: SPC700
opcodes and operands written out as an annotated byte sequence, assembled by
chipvoice itself at export time, not by a third-party assembler whose own
output would need to be vendored or trusted as-is. This is not decision 45's
IPL ROM exception again: nothing here is copied from another emulator or
from Sony's own driver code, so there is no licensing question to record,
only an unusual artifact (assembled SPC700 machine code, MIT, produced by
TypeScript) worth naming so a future reader does not mistake it for a
binary blob.

**Timer, tick rate, quantization.** The player times itself with the S-SMP's
Timer 0, at `TIMER_TARGET = 8` against its 8000 Hz input, giving 1000
ticks/second (`TICKS_PER_SECOND`, `chips/snes/spc-player.ts`; `SPC_HZ /
TICKS_PER_SECOND` is 1024 cycles/tick, exactly). Each captured write's cycle
stamp is rounded to the nearest tick before being re-simulated:
`exportSpc` runs a second, scratch instance of this package's own SPC700
over the assembled player program during export, so the tick-delta stream
that ships is the one that actually reproduces each write's target tick when
a real SPC700 executes the wait loop and dispatch, not an estimate that
ignores the player's own instruction cost.

**How close a write lands to its own rounded tick.** Rounding alone promises
half a tick; the real player also spends real cycles walking its own
dispatch loop before a write actually reaches the DSP, and a dense same-tick
burst (a chord, an instrument retrigger touching many voices' registers at
once) makes many writes queue behind a single real CPU with no DMA to share
the load. Measured on both the synthetic unit test and on real songs
(`packages/chipvoice/test/spc-export.mjs`; mario and zelda both converge on
the same figure independently), the worst case is about 1993-1998 cycles,
just under two ticks, and does not grow with a song's length - it is bounded
by how many registers one originally-simultaneous group can touch, not by
how long the song runs. A back-of-envelope bound on the burst loop itself
(about 12 cycles per register touched, a 1024-cycle tick) shows one tick
would need a group under roughly 85 registers wide with zero rounding
margin left over - not a target this driver's own dispatch cost can reach
for real content, not a bug to chase further. The test's own bound is set at
3 ticks: a real margin over the measured ~2-tick ceiling, not the tighter
figure hoped for at the start of this ticket, kept honest rather than forced.

**Encoding.** The write stream is tick-deltas plus `{reg, value}` pairs,
`$FE count (reg value)*count` bursts for same-tick register groups, and (new
since the ticket's first pass) `$FD` back-references: a greedy LZ77-style
match (`MATCH_MIN_GROUPS = 2` consecutive groups) lets a repeated run of
groups - the same chord retriggered, the same instrument's envelope
replayed - point back at stream bytes already written instead of repeating
them, decoded by the player's own `L_COPY_START` section rather than
inflating the assembled program with per-song logic. This closed most of the
gap the first pass's plain encoding left: `mario` (52991/65472 bytes) and
`zelda` (29623/65472 bytes) both now fit; `sonic` still does not (82896
needed against 57344 available for its own memory layout) and fails loudly
with `SpcExportSizeError { measured, limit }` naming its real size, rather
than truncating - matching how `validateSong` already reports capacity
elsewhere. A denser encoding (a value dictionary, cross-song matching) was
considered and set aside, not ruled out: today's one remaining failure is
named and measured, not silent, which was the ticket's bar.

**Two bugs the oracle comparison found, both fixed.** First, the live S-DSP
echo buffer (`ESA`/`EDL`) writes into the export's own scratch ARAM on the
DSP's own initiative while the second, scratch SPC700 re-simulates the
player program - a back-reference pass reading stream bytes back out of
that same RAM could read a byte the echo hardware had since overwritten.
Fixed by tracking every footprint the capture's own `ESA`/`EDL`/`FLG`
writes could ever put echo into (`inEchoFootprint`) and refusing, in
`pokeStream`, to trust or reuse any byte inside one - the same
`SpcExportSizeError` path a plain overflow takes, not a silent misread.
Second, the final pre-loop wait (the tail between the last write and the
loop point) rounded its own tick count with `Math.round`, which could round
down and leave the simulated player waiting fractionally short of the loop
point it was told to reach; changed to `Math.ceil`, matching what "wait at
least until the loop point" actually requires.

**Envelope correlation window.** `check-export.mjs` scores audio fidelity by
per-voice RMS envelope correlation rather than a raw cycle-exact sample
match, because a write correctly rounded to its own tick still shifts the
DSP's audio-rate waveform out of phase with an unquantized render, and phase
alone scores two identical tones as almost entirely different. The window
width matters: measured at 1, 2 and 4 ticks on both real songs
(`ENVELOPE_WINDOWS_TICKS`, reported every run, not just historically), a
correct export climbs from about 0.72-0.85 at 1 tick to 0.91-0.96 at 4,
still far below anything a listener could perceive as separately timed, and
climbing - the signature of an under-resolved phase effect, not a real
mismatch (a real mismatch instead falls or flattens as the window widens).
Four ticks is kept as the gate (`ENVELOPE_MATCH_THRESHOLD = 0.95` would be
too tight at the finer windows for the reason above, not because the export
is wrong at 1 or 2 ticks).

**The oracle comparison: cycle-exact writes, and samples now cycle-exact
too.** A round two of this same review asked for the oracle write
comparison to check cycles, not just content, and for the oracle sample gap
(17-31% raw cycle-exact) to be either fixed or explained with numbers
rather than left as an unqualified "phase" claim; a round three asked for
the sample gap itself to be closed, not just characterized further, if
another cause could be found. All three now hold.

Reading blargg's vendored snes_spc directly (`SNES_SPC.cpp`'s
`run_timer_`) found a real, one-time quirk in its lazy timer model: `elapsed
= TIMER_DIV(t, time - t->next_time) + 1` combined with `reset_time_regs()`
setting every timer's `next_time` to 1 on every snapshot load means the very
first post-load call always credits itself with one whole prescaler period
already elapsed, however few cycles actually passed. Confirmed with the
regression fixture below (`timer-phase.spc`, timer 0 at a period of 1, one
128-cycle prescaler period at normal tempo): before a fix, blargg's own CPU
sees timer 0's counter as already non-zero and makes its one write only 15
cycles into the snapshot, far short of the 128 cycles a full period actually
takes; this package's own per-cycle model, from the same file, only reaches
that same write at cycle 140. Round three fixed this at the source instead
of only naming it: a load-time shim, `fix_snapshot_timer_phase()` in the
vendored oracle, runs once right after a snapshot loads so blargg's own
timers start in the same phase as real hardware, not one prescaler period
ahead of it - with the fix, the oracle's write lands at cycle 141, one cycle
after this package's own 140 (the same pre-charge labelling difference
`check.mjs`'s own doc comment already names, not a second issue). This
minimal regression fixture (one write, one timer target) pins the fix in
`check:spc` alongside the existing corpus so a future change to the
vendored oracle cannot silently reopen the one-time jump; `check:spc` now
covers both files at 100.0000% (3072000/3072000 cycles).

That fix moved the residual write-cycle offset onto a second, narrower
boundary effect, found this round: the exported player polls Timer 0's own
output register in a tight loop, and blargg's lazy timer catch-up formula
and this package's own per-cycle timer model resolve "has this exact
boundary cycle already elapsed" one cycle differently whenever a poll's own
dispatch-overhead phase drift (which never compounds - it resynchronizes at
the very next wait) happens to cross a timer-0 prescaler boundary at the
wrong instant, making blargg's poll exit one whole 7-cycle "still waiting"
iteration early. Proven by construction (a single isolated wait never
reproduces it; a repeating wait-then-write loop does, deterministically)
and confirmed exhaustively on this corpus (every write in both `mario` and
`zelda` takes one of exactly two values, nothing else). `check-export.mjs`'s
`compareOracleWrites` now names both values (`WRITE_CYCLE_OFFSETS = [1,
-6]`, generalizing the single-offset gate the previous round named
`T0_STAGE1_PERIOD`) and gates on them exactly - no residual, no running
count.

Driving this package's own DSP with blargg's own actual write cycles
(`oracleWrites`, already exact above), instead of this package's own CPU's
independently re-derived ones, isolates the sample comparison to the one
question it exists to answer - given the *same* stimulus, does the S-DSP
core compute the *same* output - with no CPU-timing variable left in it.
One narrow artifact remained even then: blargg's `SNES_SPC.cpp` keeps the
DSP lazily caught up (the `RUN_DSP` macro, only actually run from
`dsp_write`/`dsp_read`/`end_frame`'s own final catch-up call), so
`play-spc`'s one-shot render may or may not flush this package's own
trailing `SAMPLE_OUTPUT_CYCLES`-period output sample depending on internal
phase alignment exactly at the cutoff, while this package's own per-cycle
DSP model always computes and includes it. Confirmed directly on `zelda`
(the one song whose tail had not already decayed to silence by the cutoff):
this package's own last recorded sample sits exactly one
`SAMPLE_OUTPUT_CYCLES` period past blargg's own last recorded sample, at
the literal last cycle of the render, nowhere else. `ORACLE_TAIL_TRIM_CYCLES`
excludes exactly that one trailing period from the oracle samples
comparison; with it, both `mario` and `zelda` reach exactly 100.0000%
cycle-exact on the oracle side (`identical === cycles`), the same bar
`check:spc` already gates its own comparison at. Envelope correlation and
note-timing alignment are still reported on the oracle side, not gated -
they were this file's own gate before this round, and stay as evidence
that the CPU-timing difference the write comparison names is exactly what
they already tolerated, not a second, undiscovered problem.

`check-export.mjs` also gates the round trip's own timing directly (the
largest deviation between any write's actual cycle and the tick `exportSpc`
rounded it to, at the same 3-tick bound the unit test derives, measured
live on `mario` and `zelda`: 1998 and 1993 cycles respectively, about 1.95
ticks, unchanged this round), and a `--self-test` mode (wired into CI as
`check:spc-export:self-test`, alongside `check:spc` itself, which was not
previously run in CI at all) exercises a positive and a negative control
per gate: the write-cycle gate accepts both named offsets outright
(including the `-6` case, not just the plain `+1`) and rejects one cycle
past either; the new exact sample gate accepts two identical streams and
rejects one perturbed by a single sample at a single cycle; the round-trip
timing and envelope-correlation gates keep their existing negative controls
(a write outside the round-trip timing bound, a dropped voice) unchanged
from before this round.

**What changes.** `packages/chipvoice/src/spc-export.ts` and
`chips/snes/spc-player.ts` are new; `exportSpc` and `SpcExportSizeError` are
exported from the package index; `projectCapabilities()` reports `spc` as
the SNES `registerExportFormats` entry; `apps/web/src/studio/exports.ts`
gains an `spc` export kind. None of this touches `spc-import.ts`,
`spc700.ts` or `ssmp.ts` from decision 45; a round trip through `importSpc`
is how the CI check in `packages/conform/src/spc/check-export.mjs` proves
the player's writes land where the capture put them, alongside a direct
comparison against `play-spc`'s own playback of the same exported file.
Round three also touches the vendored oracle itself
(`packages/conform/oracles/snes-spc/`): the `fix_snapshot_timer_phase()`
load-time shim and the `g_sample_cycle` output-hook fix in `play-spc.cpp`,
plus the new `timer-phase.spc` regression fixture and its
`checkTimerPhase` assertion in `check.mjs`. `.github/workflows/ci.yml`
gains two steps in the `conformance` job: `check:spc` (previously written
but never run in CI) and the new `check:spc-export:self-test`.

## 47. Server code shared between the apps moves into web-kit (2026-09-28)

A new private workspace package, `packages/web-kit`, holds the server code
that chipvoice.dev (`apps/web`) and a second app in this monorepo both need:
crypto (`hashKey`/`newId`/`secret`), the HTTP route envelope, the in-memory
rate limiter, SSE parsing, the database factory (connect, migrate,
windowed admission), device-flow agent authorization (RFC 8628 plus RFC
8414/9728 discovery), MP3/ID3 audio encoding and byte-range streaming, the
agent tool manifest built from an OpenAPI spec, and the locale/translator
core. `apps/web` depends on it like any other workspace package and, per
decision 37, its unit tests run under `node --test`.

**Why.** The second app needs its own accounts, rate limits, agent
authorization and audio export, and copying chipvoice's versions forward
would drift the moment either one changed a table name or a token prefix.
Everything above was already app-agnostic in every way that mattered except
the specific values chipvoice happened to hardcode - a table name, a cookie
name, a token prefix, a default tier budget - so each module became a
factory or a configuration object (`createDb`, `createAgentAuth`,
`createRoute`, `createLocaleHelpers`/`createI18nReact`, `agentManifest`)
that takes those values as arguments instead of assuming them.

**What changes.** `apps/web/src/lib/db.ts`, `migrations.ts`, `limit.ts`,
`project-http.ts`, `agents.ts`, `auth.ts`, `oauth.ts`, `agent-tools.ts` and
`apps/web/src/i18n/core.ts`/`react.tsx` are now thin configuration shims
over `web-kit/*`, unchanged in the shape every call site already used;
`apps/web/src/lib/crypto.ts` and `sse.ts` were fully redundant and are
gone, their callers pointed at `web-kit/crypto` and `web-kit/sse` directly.
Two of `web-kit/agent-auth`'s generic return values name the owning
resource `ownerId`; chipvoice's external agent API has always answered
`profileId` (and, for the device-flow poll, `profileUrl`) in these exact
response bodies, so `apps/web/src/lib/agents.ts` remaps those two fields
rather than re-exporting the generic shape, keeping the wire format
byte-for-byte unchanged for every agent client already depending on it.
Table names, migration names and migration order, the `cv_agent_`/
`cv_live_`/`cv_session_` token prefixes, and chipvoice's own route-to-scope
authorization policy (`authorizeAgent`) all stay exactly as they were,
passed into the shared factories as configuration rather than generalized
away. `turbo.json`'s existing `dependsOn: ["^build"]` builds `web-kit`
before `apps/web` for any `pnpm build`/`pnpm typecheck` that goes through
turbo, but not for the few places that call a package's script directly
with `pnpm --filter`, which bypasses turbo's dependency graph entirely:
`.github/workflows/ci.yml`'s `unit` job now builds `web-kit` explicitly
before bundling `apps/web`'s render worker, and `test-generation.mjs`/
`scripts/eval-composition.mjs` reference `web-kit/sse` by its package name
rather than the relative path it replaced. `.github/workflows/e2e.yml`'s
`deployment_status` trigger checks `deployment.environment` against
chipvoice's own known values rather than `environment_url`: real GitHub
deployments show `environment_url` as an ephemeral per-deployment Vercel
alias that every project linked to this repo shares alike, never a fixed
value that tells them apart, so it cannot be what keeps the second app's
own production deploy from also firing chipvoice's end-to-end suite.

## 48. A hardware-verified source outranks a second, undocumented oracle that merely agrees (2026-09-28)

NEXT-15's AY-3-8910/YM2149 core needed its 17-bit noise LFSR's feedback
taps, and nesdev's Sunsoft 5B page gives only a sentence: "a 17-bit linear
feedback shift register with taps at bits 16 and 13," no pseudocode. This
decision went through two wrong turns before landing on the sourced answer,
and records all three states as honest history, not just the last one.

**First wrong turn.** An early version of this ticket's own work read
Ayumi's `update_noise` (`oracles/ayumi/ayumi.c`, one new bit `bit0 ^ bit3`
inserted at bit 16 - a Fibonacci-form construction) as an equivalent
restatement of nesdev's "taps at bits 16 and 13" (16 - 13 = 3) and wrote
`Ay8910`'s own generator to the same formula without checking that the two
are actually the same recurrence.

**Second wrong turn.** A later pass through this ticket checked that
assumption and found it false: an exhaustive search (every insertion bit
13-16, every XOR tap 1-16, every output bit 0-16) found no relabelling of
Ayumi's Fibonacci form that reproduces the literal reading of "taps at bits
16 and 13" - a shift register with XOR gates at two absolute bit positions,
fed by the bit shifted out, a Galois-form construction
(`(uMinus(lfsr & 1) & 0x12000) ^ (lfsr >> 1)`, confirmed maximal-length:
period 131071 from seed 1). Game_Music_Emu's `Ay_Apu` happened to implement
that identical Galois formula, independently written, which this ticket
took as corroboration of the literal reading and rewrote `Ay8910` to match.
That corroboration was weaker than it looked: nothing found at the time
established that either the literal-taps reading or Game_Music_Emu's own
formula had ever been checked against real AY-3-8910/YM2149 hardware: it
was one undocumented emulator agreeing with one literal (but unverified)
reading of an ambiguous sentence, not independent confirmation of a fact.

**The sourced answer.** MAME's `noise_rng_tick()`
(`src/devices/sound/ay8910.h`, licence BSD-3-Clause, Couriersud) states
plainly: "The Random Number Generator of the 8910 is a 17-bit shift
register. The input to the shift register is bit0 XOR bit3 (bit0 is the
output). This was verified on AY-3-8910 and YM2149 chips." In code:
`m_rng = (m_rng >> 1) | ((BIT(m_rng, 0) ^ BIT(m_rng, 3)) << 16)`, output
`m_rng & 1` - the Fibonacci form, exactly Ayumi's construction, and this is
the one source found in this investigation that claims a hardware check on
this specific generator. "Taps" is itself Fibonacci-shift-register
vocabulary (a Galois LFSR is usually described by its feedback polynomial
or XOR mask, not "taps"), so nesdev's own wording does not actually settle
the question in the Galois direction the way the second wrong turn assumed
- if anything it leans the other way. Weighed against MAME's citation,
Game_Music_Emu's agreement with the Galois reading no longer corroborates
anything: it is one hardware-verified source against one unverified
emulator, not two independent references in a genuine tie.
`packages/chipvoice/src/chips/ay8910.ts`'s `tick()` now implements the
Fibonacci form, matching Ayumi exactly; the entire `ay8910`
`core`/`edge` corpus, including every noise-bearing script, is gated exact
against Ayumi (`docs/chips/sunsoft5b.md`'s "where oracles disagree",
`oracles/ayumi`'s own "known limits" - now empty).

Game_Music_Emu's own noise and tone timing cannot be gated exact regardless
of the LFSR question, for a separate, also-measured reason: its own source
lists "changes to envelope and noise periods are delayed until next
reload" as a known inaccuracy, and `Ay_Apu`'s tone-period write carries a
phase delta forward from its reset default (`period_factor`, not a clean
zero) rather than restarting a divider's phase at the write - confirmed by
instrumenting `run_until` directly, cycle numbers included, in the
investigation this decision records. A settle write before the real one
makes the resulting offset constant and period-independent for tone alone
and for noise alone (not both together, and not across a later mid-stream
period rewrite - GME's own "delayed until next reload" note explains why),
but baking a settle-dependent correction into the oracle wrapper the way
decision 41's sawtooth correction does would be silently wrong for any
corpus script that does not happen to follow that exact convention, so
this ticket does not do that: `game-music-emu-ay`'s "core" role is
restricted to logs with no oscillator timing dependency at all (both tone
and noise held off, a channel acting as a plain 4-bit DAC through its
volume register alone, verified exact against both oracles with no
settling needed), and it is `--report` everywhere else, including on
noise, where it now additionally disagrees on the LFSR's own construction
as well as on timing.

**Why.** A second implementation agreeing with a reading is corroboration
only if that second implementation's own claim is itself sourced; two
undocumented emulators agreeing with each other is not the same evidence as
one hardware-verified statement, and this ticket spent two wrong turns
finding that out the direct way before checking for a primary source that
settles it. Recording all three states - the first unchecked assumption,
the second, better-but-still-wrong reasoning, and the sourced correction -
is what keeps a later ticket (an MSX AY-3-8910 host, the YM2203/2608's SSG
half - both already named as future hosts in `ay8910.ts`'s own class doc
comment) from re-litigating the same question with less information than
this one gathered, and from repeating either wrong turn.

**What changes.** `packages/chipvoice/src/chips/ay8910.ts`'s noise LFSR
feedback formula (Fibonacci form, MAME-cited, matching Ayumi - not the
Galois form this ticket held at its previous review). `packages/conform`'s
`check:ay8910-edge` gates the full `edge` corpus exact against Ayumi, no
`--exclude` needed any more; `check:ay8910-edge-gme-report` (Game_Music_Emu,
report-only) is unchanged, still report-only, now for two independent
reasons instead of one. No automatic cross-oracle correction is introduced
for tone or noise timing, unlike decision 41's own sawtooth case,
specifically because the underlying offset is convention-dependent rather
than a fixed property of the oracle itself.

## 49. gamesounds.ai ships Phase 1: an agent-first sound-effects bank, the monorepo's second app (2026-09-28)

`apps/sounds` (gamesounds.ai) and `packages/gamesounds` ship a game
sound-effects bank filed by event, not by pack: 220 sounds
over 52 categories (of 85 in the
taxonomy - the 9 top-level branches are pure hubs, every sound is filed on
a leaf) and 2 of the 10 style facets, all `CC0-1.0`, none
loop-flagged. gamesounds is our own sound bank: every sound is generated by
chipvoice's own `renderSfx` - no third-party sounds, no external generation
API - so every sound's licence holds by construction, not by a runtime
filter. The taxonomy's other style facets (the ones no chip renders, like
`realistic` or `fantasy`) and the rest of the taxonomy stay defined with
zero sounds today, reserved for the procedural synthesis engine tracked as
GS-02 in `docs/BACKLOG.md`, not for a curated third-party pack. A person
browses the site; an agent calls the REST API directly or runs `npx
gamesounds add <event...>` to pull a `sounds.json` and the audio into its
own project, with no account and no key.

**Why.** The brief that opened this branch asked for an SFX bank an agent
can use unattended: resolve a game event to a licensed, loudness-matched
sound and get playing, without a person auditioning candidates first. That
is a different shape of product from chipvoice.dev (one engine, one song at
a time) and a different data model (an event-indexed catalogue, not a
composition), so it is a second app and a second publishable package
(`gamesounds`, for its own CLI and runtime), not a page bolted onto the
first. `packages/gamesounds` depends on nothing else in the workspace, so
an agent installing it never pulls in chipvoice's own engine or database
code, and `apps/sounds` imports its types by relative path rather than
depending on the package's own build, so this app's CI job never needs to
build `packages/gamesounds` first.

**What changes.** The catalogue build (`apps/sounds/scripts/build-catalog.mjs`)
calls `renderSfx` (chipvoice's own offline single-effect render, `b649b54`)
against a checked-in taxonomy (`catalog/taxonomy.json`) and per-event/chip
recipes (`catalog/chipvoice-recipes.mjs`), trims each take at a zero
crossing with a documented fade, measures loudness (-18 LUFS momentary max,
true peak <= -1 dBTP) and rejects anything over 10 ms of leading silence or
clipping; a negative test proves each check actually fails a bad file. Every
variant is encoded to `.ogg`/`.mp3`/`.wav` and served content-addressed at
`/f/<sha256>.<ext>` - the three formats of one take share one filename hash,
the canonical WAV's own SHA-256 (`apps/sounds/scripts/lib/audio.mjs`'s
`encodeVariant`), as a group key, so only the `.wav` at that address
literally hashes to it; the CLI's own SHA-256 verification (below) fetches
that WAV, in memory only, to check the claim rather than trusting the
filename. `sounds.json` (schema `packages/gamesounds/schema/manifest-1.json`,
draft 2020-12) is the one contract every producer and consumer of a
manifest shares: `POST /api/v1/resolve`, `GET /packs/{id}`, and the CLI's
own written file are all `buildManifest`'s output, and
`apps/sounds/test/manifest.test.mjs` validates a real one against the
published schema (plus three cases the schema must reject) rather than
trusting that it "looks right." The runtime (`packages/gamesounds/src/runtime.ts`)
is its own package precisely so an agent's generated game can `import
"gamesounds"` and play sounds with no server in the loop: round-robin
variant selection, pitch jitter, cooldowns, per-event and global voice caps
with priority stealing, bus ducking and the iOS unlock gesture, all driven
against a fake `AudioContext` in `packages/gamesounds/test/runtime.test.mjs`
rather than a browser. That suite is new with this decision and found a
real bug before anything shipped: `reserve()`'s voice-stealing path filtered
the *triggering* event's own `active` array for a stolen voice, a no-op
whenever the global cap steals from a *different* event than the one being
triggered, which left `PlayHandle.playing` reporting `true` for a voice that
had already been stopped. Fixed by a new `steal()` method that looks up the
victim's own owning event before filtering it out. `bin/gamesounds.mjs`
downloads by content hash (a file already on disk is never re-fetched),
merges into any `sounds.json` already in the target directory rather than
overwriting it, and rewrites the server's root-relative paths to the
manifest's own `"./"` base so the file is portable on its own; a Playwright-
free integration test (`packages/gamesounds/test-cli.mjs`, mirroring
`apps/sounds/test-smoke.mjs`'s flat-script convention) runs it twice against
a real local server and checks both behaviors. The site
(`apps/sounds/src/app/[locale]`) is a keyboard-first result list (`/` search,
`j`/`k` move, `space`/`1`-`8` play, `r` random variant, `d` download) over
Web Audio, not `<audio>`, with `llms.txt`, `skill.md`, `openapi.json` and
`.well-known/mcp.json` all derived from one `openApiSpec()` so the API is
described once. It ships no Three.js and no vote button: Phase 1 has no
accounts, and a vote with nothing behind it would be worse than no vote.
`i18n` routing exists (`/en`, `/ja`) but no page copy is wired through
`useT` yet - an honest, tracked cut, not a broken feature; see
`docs/BACKLOG.md`.

## 50. gamesounds.ai stays single-origin and gets a pre-launch review pass: Blob storage, per-file hashes, a variant floor, a full CLI, an exponential detune fix and a network-free CI gate (2026-09-28)

Before PR #119 merged, review found the branch shipping a mixed catalogue
(some sounds curated from Kenney's CC0 packs, some rendered by chipvoice)
and several gaps between the brief and the code: shipped audio committed to
git instead of object storage, one hash covering a whole variant instead of
each of its files, no floor on how few variants a sound could ship with, a
CLI that only implemented `add`, a linear approximation where the detune
math needed to be exponential, and a CI job that could not build the whole
catalogue without the network. All of it landed in this one pass, before
anything reached `main`.

**Why.** The curated half of the catalogue was the bigger problem: gamesounds
is our own sound bank, and a Kenney sound sitting next to a chipvoice one
under the same API made "every sound here is ours" false the day it shipped,
not eventually. Pulling it now, pre-merge, means the merged history never
carries a design `main` has to walk back later - Decision 49 above already
describes the single-origin catalogue as it actually ships, not the
mixed one this branch carried first. The rest of the review is the ordinary
gap between a brief and a first pass: `docs/GAMESOUNDS.md` promised
per-file content addressing, a 3-to-5 variant range, a full CLI and a
loudness floor derived from real measurements, and the code did not yet
hold up its end.

**What changes.**

- **No third-party sounds, no external generation API.** `catalog/sources/*.json`,
  their filelists, `catalog/mapping.mjs` and its test, and every fetch/extract
  step in `scripts/build-catalog.mjs` are gone; `Origin` narrows from
  `"curated" | "chipvoice" | "generated"` to `"chipvoice" | "generated"`.
  `"generated"` stays in the type, unused, reserved for GS-02 (below) rather
  than removed, so a second origin does not mean a schema change when it
  arrives. `checkChipvoiceVariantCount` (`scripts/lib/checks.mjs`) still
  gates on `origin === "chipvoice"` rather than checking unconditionally, so
  GS-02's engine can define its own variant rule instead of inheriting this
  one by accident. The taxonomy keeps categories with zero sounds today (the
  style facets no chip renders yet, reserved for GS-02), but nothing that
  shows a category may present it as populated when it is not:
  `GET /api/v1/categories` now returns each category's own honest `count`
  (`listCategoriesWithCounts`, `apps/sounds/src/lib/catalog.ts`), a leaf's own
  sounds plus every descendant leaf's for a branch, and the site's category
  grid and hub pages already rendered an explicit "0 sounds" / "No sounds
  filed here yet" rather than hiding the row.
- **Shipped audio moves to object storage.** `apps/sounds/scripts/audio-store.mjs`
  ports Decision 40's pattern (`apps/web/scripts/audio-store.mjs`) to
  gamesounds: `pnpm sounds:pull` fetches a verified local copy of
  `public/f/*` from the Vercel Blob store named in `audio-store.json`,
  `pnpm sounds:check` proves every file the catalogue references is already
  in the store, and `pnpm sounds:push` uploads what is missing (needs
  `GAMESOUNDS_BLOB_READ_WRITE_TOKEN`). `generated/catalog.json` stays
  committed; the bytes it points at do not.
- **Per-file content addressing.** Each variant's `.ogg`/`.mp3`/`.wav` is its
  own file with its own SHA-256 and byte count (`AudioFile`,
  `packages/gamesounds/src/types.ts`), not one hash asserted for a whole
  variant. `encodeVariant` (`apps/sounds/scripts/lib/audio.mjs`) writes each
  format to `<its own sha256>.<ext>`, so a file's url already names its
  content; the CLI's own SHA-256 verification fetches the bytes, in memory
  only, to check the claim rather than trusting the filename.
- **A 3-to-5 variant floor, checked, with a negative test.** The brief's own
  range was aspirational until `checkChipvoiceVariantCount` existed to
  enforce it; `apps/sounds/test/checks.test.mjs` proves both that a
  chipvoice sound under the minimum fails the build and that a non-chipvoice
  origin is not held to it.
- **A per-variant loudness gate that catches a broken gain stage exactly,
  not statistically, checked on every variant.** The first pass derived a
  floor from the widest peak-to-loudness gap observed anywhere in the
  build (`peakCeilingDb - maxObservedGap - marginDb`), which a second
  review round found could miss a broken variant whose own gap happened to
  fall inside another, legitimate variant's wider range - the floor moved
  every time the catalogue's widest crest factor changed, so it never
  bounded any single variant on its own terms. `levelToConvention`
  (`scripts/lib/audio.mjs`) applies exactly one linear gain per render:
  whichever of the two is quieter, the gain that brings momentary LUFS to
  -18 or the gain that brings true peak to -1 dBTP. A correctly leveled
  variant therefore always lands within rounding slack of at least one of
  the two ceilings - `checkOneCeilingBinds` (`scripts/lib/checks.mjs`)
  asserts exactly that, per variant, with no cross-variant statistic
  involved: `lufs >= -18 - eps OR peakDb >= -1 - eps`, eps 0.2 dB. All 880
  committed variants pass it; a synthetic -30 LUFS / -10 dBTP variant
  (a broken gain stage the old derived floor would have let through) fails
  it, proving the new gate strictly stronger.
- **The CLI's full scope.** `packages/gamesounds/bin/gamesounds.mjs` gains
  `search`, `swap`, `list` and `sync` alongside `add`; `--json`, `--dir`,
  `--formats` and `--api` are honored across all five, and
  `packages/gamesounds/test-cli.mjs` covers each command rather than only
  the download-and-merge path `add` exercised alone.
- **The detune math is exponential, not linear.** A playback-rate multiplier
  is exponential in pitch: `source.playbackRate.value = (1 + jitterOffset) *
  2 ** (semitones / 12)` (`packages/gamesounds/src/runtime.ts`), so `+12`
  semitones doubles the rate and `-12` halves it exactly, not `1 +
  semitones * k`. `packages/gamesounds/test/runtime.test.mjs` asserts both
  bounds exactly (`2` and `0.5`) and one case where seeded jitter and detune
  compose, catching the old linear approximation being wrong everywhere
  except semitone zero.
- **The player's spec features are proven, not assumed.** Preload on
  viewport visibility and on hover or keyboard selection
  (`SoundList.tsx`'s `IntersectionObserver` plus per-row hover/selection
  handlers, `data-preload-state` as the observable proof), a playhead driven
  off the player's own clock (`Waveform.tsx`), a sticky mini-player naming
  whatever last played (`MiniPlayer.tsx`), and a spam guard that stops a
  sound's own prior voice before retriggering it rather than stacking
  unbounded voices (`data-active-voices`) are all exercised in
  `test-smoke.mjs` against a real running server, not asserted from reading
  the component.
- **CI builds the whole catalogue and checks it for determinism, needing no
  network.** With no fetch step left, `catalog:build` and
  `catalog:build:chipvoice`/`catalog:build:fetch-only`/`catalog:build:skip-fetch`
  collapse to the one `catalog:build` (`--out <path>` still writes elsewhere
  for a scratch build). The `sounds` CI job rebuilds the full catalogue
  fresh from committed recipes into `.artifacts/ci-catalog.json` and
  `check-determinism.mjs` compares it against the committed
  `generated/catalog.json` - WAV/PCM bytes only, since `.ogg`/`.mp3`
  encoding can legitimately differ by ffmpeg version - covering every sound
  in the catalogue, not a subset carved out by origin.
- **`vercel.json`'s `ignoreCommand`** stays scoped to the paths that can
  actually change this app's output (`apps/sounds`, `packages/gamesounds`,
  `packages/web-kit`, the lockfile, `vercel.json` itself), so an unrelated
  commit elsewhere in the monorepo does not trigger a gamesounds deploy.
- **GS-02, tracked in `docs/BACKLOG.md`:** a procedural synthesis engine for
  the style facets no chip can render (`realistic`, `fantasy` and the rest) -
  our own DSP, deterministic from a recipe and a seed, filed under the
  `"generated"` origin already reserved for it. Not part of this phase; the
  taxonomy branches it will fill stay defined with zero sounds until it
  ships.

## 51. The YM2151 is Nuked-OPM ported line for line; ymfm is its second, report-only oracle; the YM2610 waits for its own ticket (2026-09-28)

NEXT-16's chip: Yamaha's YM2151 (OPM), the eight-channel, four-operator FM
synthesiser behind the arcade boards and computers of the mid-to-late
1980s. `packages/chipvoice/src/chips/ym2151.ts` is Nuked-OPM's `opm.c`
(Nuke.YKT, LGPL 2.1, written from John McMaster's die shot of the chip) in
TypeScript, line for line, exactly the choice decision 17 made for the
YM2612 and Nuked-OPN2: Nuked's own field and function names are kept
(snake_case fields, camelCase methods with the `OPM_` prefix dropped), the
file carries the LGPL 2.1 notice, and the package's licence field and
`LICENSE` file both now name a third file. Nuked-OPM itself, built natively
in `packages/conform/oracles/nuked-opm` and driven over a register-log
pipe, is this core's primary oracle, gated exact: every sample equal, for
the same register stream, at this chip's own native rate (clock/64 - the
pipeline inside `OPM_Clock` runs at half the input clock and completes a
full 32-slot sweep every 64 input cycles, independently corroborated by
ymfm's own `sample_rate() = baseclock / (clock_prescale * OPERATORS)`,
`2 * 32 = 64`, from a completely separate codebase). `check:ym2151-core`
and `check:ym2151-edge` (`packages/conform/package.json`) hold `core` and
`edge` to that gate; `packages/conform/test/ym2151-gate.mjs` proves each
would actually catch a regression, the same negative-test convention
`ay8910-gate.mjs` set.

**The second oracle, and why it is report-only.** Aaron Giles's ymfm
(BSD-3-Clause), vendored in `packages/conform/oracles/ymfm`, is this core's
second, independent cross-check - written from the public documentation and
other emulators' behaviour, not from a die shot, and tuned against real
hardware captures rather than derived from the silicon itself. Its own
`generate()` is not cycle-exact the way `OPM_Clock` is: it produces one
finished sample per call from the register state at that instant, with no
notion of where inside a sample interval a write landed, so
`oracles/ymfm/main.cpp` batches writes to the sample period they fall in
(every 64 log cycles) rather than interleaving them cycle by cycle. Decision
48's own precedent settles what a disagreement between the two oracles
means: a hardware-verified (here, die-shot-derived) source outranks a
second, undocumented-against-hardware one that merely differs, so where
Nuked-OPM and ymfm disagree, Nuked-OPM's reading wins and the disagreement
is named on `docs/chips/ym2151.md`, not silently absorbed or averaged.
`check:ym2151-core-ymfm-report` and `check:ym2151-edge-ymfm-report` are
`--report` only, never gated exact, for exactly the reason decision 48 also
applied to Game_Music_Emu's `Ay_Apu`: a real difference here is a prompt to
look and say which side is right and why, not by itself evidence of a bug
in the port.

**MAME's `ym2151.cpp`** was read as a third reference, to cross-check
register semantics and the CSM/timer behaviour against a third
independently-written implementation, but it is GPL and is never vendored
or copied into anything, harness included: decision 41 allows a GPL
reference in `packages/conform` only where it is actually run as an oracle
and built from its own unmodified source tree with its licence alongside
it, and this ticket has no need of a third built oracle when two already
disagree by at most a documented, sourced amount. Nothing in `ym2151.ts`,
`opm.c`, or `ymfm`'s vendored files was copied from MAME; everything traces
to Nuked-OPM or to ymfm.

**Scope: the YM2151 only, not the YM2164 or the YM2610.** Nuked-OPM's own
source also models the YM2164 (OPP), a wider-register-map, TL-ramping
variant selected by a runtime flag (`opm_flags_ym2164`); every `chip->opp`
branch of the original C, and `OPP_TLRamp` itself, is simply not ported -
the YM2151-only (`opp = 0`) path is what `ym2151.ts` implements, verbatim.
NEXT-16 also named the YM2610 (OPNB, the two-chip-in-one used by Neo Geo
and several other Taito/SNK boards) as its second half; that chip shares
some FM machinery with the YM2612 lineage but adds ADPCM-A/ADPCM-B sample
playback entirely absent from both the YM2151 and the YM2612, a
substantially different core, its own oracle work and its own probe corpus.
It is out of scope for this PR and is tracked as its own, separate ticket in
`docs/BACKLOG.md`, not silently folded into "NEXT-16 done."

**No per-channel tap, unlike the YM2612.** `packages/chipvoice/src/chips/md/ym2612.ts`
exposes a `ch_out` array, because the real YM2612 genuinely has one - Sega's
Mega Drive wiring reads the six channels separately before its own external
mixing. The YM2151 has no such pin: Nuked-OPM sums every channel into one
shared stereo accumulator internally and only the two DAC outputs, left and
right, ever leave the die. An earlier pass of this port carried a `ch_dry`
instrumentation array anyway, mirroring the YM2612's shape; it was removed
before any oracle-side code depended on it, once it was clear that
supporting it would mean duplicating Nuked-OPM's internal `fm_algorithm`
routing table a second time inside the C oracle driver, a synchronisation
risk between two independently-maintained implementations, in service of an
output the hardware itself does not have. `packages/conform`'s YM2151
comparison is two voices, `l` and `r`, not eight or ten - the only outputs
this chip actually has.

**The two-port write-latch settling window, documented rather than
papered over.** Nuked-OPM's register writes are not immediate: an
address-port write and the data-port write that follows it are only
applied once the internal 32-cycle pipeline sweeps back around to that
register's own channel or slot index (up to 32 `OPM_Clock()` calls, 64
native cycles at this chip's clock/2-per-tick rate), and a new
address-port write before that happens clears the pending one
unconditionally (`reg_data_ready = reg_data_ready && !write_a_en` in the
vendored `opm.c`), silently dropping it - genuine two-port bus behaviour,
not an emulator quirk. This was found directly, by a register write that
appeared to do nothing until the write spacing was widened from 4 to 40
`OPM_Clock()` calls in a debug build. The probe corpus's own `SETTLE`
constant (`packages/conform/src/corpus/generate-ym2151.mjs`, 4000 native
cycles, comfortably past the 64-cycle window) keeps every script except one
clear of it by a wide margin; `edge/write-clobber.log` is the one script
that means to hit it, two register writes on the very same VGM sample with
zero cycles between them, so the behaviour is exercised and gated exact
rather than only described in a comment.

**Register-stream host.** VGM command `0x54` (`aa dd`, one register write
per command - the chip's own two-port protocol collapsed into a single
logical write, unlike the memory-mapped `2a03`/`dmg` commands already in
`packages/conform/src/vgm.mjs`) is this chip's transport, decoded by a new
`ym2151` branch of `vgmToWrites`: each command becomes two register-log
writes at the same cycle, the address-port write then the data-port write,
matching `Ym2151.write`'s own port numbering. An unmodeled VGM command
throws by name, the same convention decision 44 set for the NES/Game Boy
importer. The probe corpus itself is committed as `.vgm` files (`source/`,
SHA-256 recorded in `manifest.json`, CC0, no external material) decoded
through this same importer into the `.log` files the harness actually
runs, so a bug in the importer would show up as a score against the
oracle rather than only agreeing with itself - the same round-trip
`generate-vgm-import.mjs` already uses for the 2A03 and Game Boy corpora.
Real arcade or computer VGM rips of this chip are useful for local
measurement but are never committed (no rip's licence is ever CC0 or
otherwise clearable at the level `scores/nsf-corpus`'s own convention
requires); they stay in a gitignored `.artifacts/` directory, exactly the
"local-only" precedent `docs/CONFORMANCE.md` already sets for other chips'
real-world captures.

**No driver, no arranger, no public picker - decision 38's scope again.**
`Ym2151` does not implement chipvoice's own `DigitalChip` interface
(`schedule`, `cancel`, `outputs`, `load`, `step`) the way `Ay8910` and
`Vrc6Apu` do; it only exposes the bare Nuked-OPM-mirroring surface
(`write`, `read`, `readIRQ`, `readCT1`, `readCT2`, `setIC`, `clock`,
`reset`). All cycle-stepping for conformance purposes lives in the private
`packages/conform/src/chips/ym2151.mjs` wrapper, which drives the class
directly the way `oracles/nuked-opm/main.cpp` drives the C reference, not
through any shared chipvoice-side scheduler. This is deliberate, not an
oversight: this ticket's own scope is core, oracle, probes and sheet only,
exactly what decision 38 already carved out for the AY-3-8910/Sunsoft 5B
and the VRC6 before it. A driver, an arranger role and a studio picker
entry are open work, tracked in `docs/BACKLOG.md`.

**Why.** Decision 17's reasoning for the YM2612 - "the die-derived reference
is still the authority, because it is the oracle... a port keeps the code
inspectable and the harness's trace inside it" - applies to the YM2151
without needing to be rediscovered: Nuked-OPM is, like Nuked-OPN2, written
from a die shot and cycle-exact against it, and a line-for-line port lets a
divergence the harness finds be traced to one line rather than reverse
engineered from a black box. Decision 41's boundary (GPL reference material
stays in the harness, never in the package) is why MAME is read and cited
but never vendored or copied. Decision 48's boundary (a hardware-verified
source outranks a second, undocumented one that merely disagrees) is why
ymfm - a careful, independent, hardware-tuned model, but not a die reading -
is a report-only cross-check rather than a second exact gate: agreement
between it and Nuked-OPM is corroboration, disagreement is not evidence
against the port, and decision 48 already worked out why that asymmetry
does not go both ways.

**What changes.** `packages/chipvoice/src/chips/ym2151.ts` (new, LGPL
2.1-or-later), exported as `Ym2151` from `packages/chipvoice/src/index.ts`.
`packages/chipvoice/LICENSE` and its `package.json`'s `license` field name
the third LGPL file. `packages/conform/oracles/nuked-opm` and
`packages/conform/oracles/ymfm` (both vendored, with their own licences and
READMEs), `packages/conform/src/oracles/nuked-opm.mjs` and `ymfm.mjs`,
`packages/conform/src/chips/ym2151.mjs`, a `ym2151` branch in
`packages/conform/src/vgm.mjs`, the probe corpus
(`packages/conform/corpus/ym2151`), `docs/chips/ym2151.md`, and the
`check:ym2151-*`/`baseline:ym2151-*`/`corpus:ym2151` scripts in
`packages/conform/package.json`. No driver, arranger or studio picker
change; the YM2610 is explicitly not part of this change and is tracked as
its own ticket.

## 52. gamesounds makes its own sounds: a deterministic procedural engine, recipes plus seeds, no third-party audio or external generator (2026-09-28)

`packages/sfx-engine` is a new, private, zero-runtime-dependency workspace
package: gamesounds.ai's own offline sound effect synthesizer. A sound is a
recipe (JSON: model, params, seed, sample rate) plus that seed, rendered to
PCM by DSP built from scratch in this repository - oscillators, noise,
envelopes, filters, delay, algorithmic reverb, waveshaping, and four
physically-informed models (modal synthesis, PhISEM, Karplus-Strong, a
bubble model), each an independent implementation of a published algorithm
or paper, never a port of an existing codebase. 53 named presets cover the
UI, impact, footstep, whoosh, explosion, sci-fi, magic and pickup taxonomy
families; every render is dedicated to the public domain (CC0-1.0) by
construction, since nothing recorded or third-party ever enters it. Full
detail is in [GAMESOUNDS-ENGINE.md](GAMESOUNDS-ENGINE.md).

**Why.** gamesounds.ai's product needs sound effects it can ship, remix and
regenerate without a licensing question attached to any one of them, and
without depending on a third-party generation API's availability, pricing
or output license. A recipe plus a seed is also reproducible and
inspectable in a way a generated-and-cached audio file is not: the same
JSON renders to bit-identical PCM in Node, Chromium, Firefox and WebKit
(`parity/`, local-only, matching chipvoice's own render-parity pattern), so
a sound is fully described by a few hundred bytes of JSON, not by a binary
blob with no record of how it was made.

**Guards.** Determinism is enforced structurally, not by convention: every
transcendental function the DSP core needs is implemented in `dsp/math.ts`
from `+`, `-`, `*` and `/` only, since ECMA-262 leaves `Math.sin`/`cos`/
`exp`/`log`/`pow`/`tanh` implementation-approximated across engines. A
committed SHA-256 hash fixture (53 presets x 3 seeds) and a committed
render-time baseline (3x regression budget) both run in the `sfx-engine` CI
job; the cross-engine parity check, an ffmpeg loudness cross-check, a
self-contained listening report and a CLAP-based semantic eval are
local-only tooling, the same split chipvoice already uses for its own
render-parity.

**What changes.** `packages/sfx-engine` is additive: it does not touch
`apps/sounds`, `packages/gamesounds` or `packages/chipvoice`, and nothing
outside it is required to adopt it. It is the sound-generation option
gamesounds.ai's app can call into going forward, alongside whatever it
already has.

## 54. gamesounds' generated sounds ship mono, leveled on their own actual shipped bytes; sfx-engine's presets are filed by what they model, never forced to fill a style (2026-09-29)

GS-03 wires `packages/sfx-engine` (decision 52) into the gamesounds.ai
catalogue: `apps/sounds/catalog/generated-recipes.mjs` maps all 53 named
presets to a taxonomy category, a style and tags, rendered at the
catalogue's own 44.1 kHz through the same trim/level/encode/measure
pipeline the chipvoice half already uses, 4 seed-ladder variants per
preset. Two things had to be decided that were left open (or assumed
incorrectly) when decision 52 shipped.

**Channel layout: mono for wav and mp3, catalogue-wide; ogg depends on the
build machine's ffmpeg - decided by measurement, not by following the
suggested default.** Decision 52's own writeup, and `docs/BACKLOG.md`'s
GS-03 tracking bullet, both assumed the existing catalogue ships stereo
("the shipped stereo 44.1 kHz channel layout"). Direct inspection of
`apps/sounds/scripts/lib/audio.mjs`'s `toWavBytes` (`channels = right ? 2 :
1`) shows this was never true: chipvoice's own `renderSfx` is never called
with `stereo: true` anywhere in the catalogue build, so every existing
chipvoice-origin sound already ships mono in its wav and mp3. Generated
sounds match that convention for the same reason - consistency with the
actual, not aspirationally documented, existing convention - not to
introduce a stereo file layout no sound actually uses.

The ogg format is the one exception, and it is NOT uniform across a
catalogue built on different machines: `vorbisEncoderArgs` (same file)
picks its encoder once per build machine - libvorbis, if the machine's
ffmpeg has it (true in CI, Ubuntu's apt package), which keeps a mono source
mono; ffmpeg's own native "experimental" vorbis encoder otherwise (this
repo's own dev Homebrew ffmpeg, confirmed missing libvorbis), which refuses
mono input and must upmix to dual-mono stereo instead. A catalogue built in
CI ships mono ogg files; a catalogue built locally on a libvorbis-less
machine (what actually built the catalogue this ticket commits) ships
dual-mono-stereo ogg files of the same, equally-loud sounds. Both are
correct; a build only needs to know which one it is producing, never assume
"mono throughout" - see the next-but-one paragraph below for how that
fallback upmix is kept correctly leveled and byte-for-byte reproducible,
a defect a PR review of this same ticket's rebuild caught before merge.

This also sidesteps the loudness trap in the direction it actually runs:
sfx-engine's `loudness/normalize.ts` meters and gains a render as mono
*before* `panToStereo` runs
(`packages/sfx-engine/src/render/renderRecipe.ts`), so its own
self-reported `RenderedSound.loudness` describes the pre-pan signal, not
the post-pan channel a caller receives - at every preset's `pan: 0`,
equal-power pan law gives `left = right = mono * cos(pi/4)`, about
-3.0103 dB quieter than the engine's own figure. Trusting that figure
instead of re-measuring the actual shipped bytes would have silently
under-leveled every generated variant by about 3 dB. `build-catalog.mjs`'s
`renderGeneratedVariants` never does this: it takes `RenderedSound.left`
as the shipped signal (valid exactly because `left === right` at `pan: 0`)
and runs it through the catalogue's own `levelToConvention`, which
re-measures whatever bytes it is actually given, regardless of what any
engine claims about them.
`apps/sounds/test/generated-loudness.test.mjs` proves both directions on
real, independently-measured bytes: the correct path passes
`checkOneCeilingBinds`, and shipping the engine's own pre-pan self-report
as the recorded measure fails it.

**Ogg's fallback upmix: bitexact determinism and a unity-gain pan, not
`-ac 2`.** Building on a libvorbis-less machine's fallback path (the one
that actually built this ticket's committed catalogue) surfaced two
defects, both caught by a PR review of this same rebuild before merge and
now fixed in `encodeVariant` (`apps/sounds/scripts/lib/audio.mjs`). First:
without explicit bitexact flags, ffmpeg's ogg/vorbis and mp3 muxers embed a
randomized-per-encode stream serial number, so re-running the same build
with no signal change at all produced different ogg/mp3 bytes and a
spurious re-hash of every file, catalogue-wide, on every rebuild - fixed by
adding `-fflags +bitexact -flags:a +bitexact` as OUTPUT options (placed
after `-i`, immediately before the output path; the same flags placed as an
INPUT option before `-i` do not fix it), on both formats. Second, and more
serious: the fallback upmix used `-ac 2`, ffmpeg's generic channel-count
converter, which applies its default equal-power split (-3.0103 dB,
`1/sqrt(2)`, per channel) when going from 1 to 2 channels - correct for
spreading a mono source across a stereo *mix*, wrong for how a browser
plays a mono file copied to both channels (unity gain, not attenuated), so
every ogg built on this fallback path shipped about 3 dB too quiet. Fixed
by replacing `-ac 2` with an explicit unity-gain pan filter,
`-af pan=stereo|c0=c0|c1=c0` (a literal copy of the source channel into
both outputs, no channel-count-conversion gain math involved). Verified
directly with ffmpeg's own `volumedetect`: a -20.0 dBFS source measured
-22.9 dBFS through the old `-ac 2` path (matching the expected -3.01 dB
loss almost exactly) and -19.9 dBFS through the new pan-filter path.

`encodeVariant` now also decodes every shipped ogg and mp3 back to PCM and
measures each one's own ENERGY (total energy - the sum of each sample
squared, not a mean, and not peak - see below for why) per channel,
recorded as `formatEnergy`; `checkSound` (`scripts/lib/checks.mjs`) gates
every variant on it directly, `checkFormatEnergy`/`checkFormatEnergies`, a
single per-variant, per-channel, per-format tolerance
(`FORMAT_ENERGY_TOLERANCE_DB`, 1.0 dB) with no separate aggregate layer.

This replaces an earlier, wrong design a round-2 PR review caught before
merge: a per-variant PEAK tolerance loosened to 17 dB, backstopped by a
separate whole-build aggregate check on the mean of every peak delta. The
outliers that tolerance was widened to admit - `pickup-key` losing up to
16.23 dB of peak, `impact-glass-light` and `footstep-metal` losing smaller
but still large amounts - were assumed to be lossy-codec transient smearing
(a block-transform codec spreading a sharp attack's energy across an MDCT
block, which lowers peak while roughly preserving total energy: a real,
harmless artifact elsewhere in this catalogue). They are not that. Decoding
both the wav and the shipped ogg/mp3 and measuring actual ENERGY showed
these three presets lose real, substantial energy through the lossy
encode - `pickup-key` 13.2 to 16.5 dB, `impact-glass-light` up to 6.6 dB,
`footstep-metal` up to 7.8 dB on the catalogue's own shipped variants - and
a steep 16 kHz highpass on their own source wav shows why: 97.4%, 77.6% and
31.0% of each preset's own energy sits above 16 kHz, respectively, well
inside the range both ffmpeg's native vorbis encoder and libmp3lame simply
filter away at this catalogue's quality settings (`impact-metal-heavy`, an
unaffected preset, has 0.0% of its energy up there). Transient smearing
preserves energy; a codec's own lowpass removing content the source never
had a chance to keep does not - the wav and the shipped lossy files are
audibly different sounds for these three, not a measurement artifact. They
are excluded (`build-catalog.mjs`'s `EXCLUDED_PRESETS`), with a follow-up
ticket (`docs/BACKLOG.md`, GS-05) to find why sfx-engine's own modal
synthesis puts their energy there and fix it at the source - tuning the
engine itself stays out of scope for this ticket (decision 52, this
decision). A whole-build aggregate mean check also had its own, separate
problem once framed this way: bugging only the generated half of a build
(about half of ~1092 variants) would move the catalogue-wide mean by
roughly 0.4 dB, comfortably under even a tight bound - a partial regression
could hide in the average. Peak itself was also simply the wrong signal
for either job, fragile under a lossy codec in both directions, so it is
kept only as informational build-log data
(`collectFormatPeakDeltas`), never as a gate.

`FORMAT_ENERGY_TOLERANCE_DB` (1.0 dB) is derived from the real, healthy
catalogue AFTER the three exclusions above: the measured max |energy
delta| across every remaining format/channel reading is 0.56 dB
(`footstep-water-puddle`, the worst of the rest). The bug this check
exists to catch (the old ogg fallback path's `-ac 2` upmix) has an exact,
content-independent signature of -3.0103 dB
(`10*log10((1/sqrt(2))**2)`, the same numeric value in the energy domain
as its peak-domain `20*log10(1/sqrt(2))` counterpart, since a uniform
amplitude scale produces the same dB delta in either domain) on every
affected channel. 1.0 dB sits with real margin on both sides: about 0.44
dB of headroom above the healthy worst case, over 2 dB of headroom below
the bug's own size. A single variant then catches the systematic bug
directly, and a partial regression can no longer hide in an average -
bugging only the generated half would have moved the old design's mean by
about 0.4 dB and passed it. `apps/sounds/test/audio.test.mjs` and
`apps/sounds/test/checks.test.mjs` prove both fixes and the energy gate,
including a standing regression record that the pre-fix ogg args really do
produce different bytes across repeated encodes of the same input, a
direct proof that the old `-ac 2` delta fails `checkFormatEnergy` on a
single variant with no aggregate needed, a proof that a HF-dominated
signal whose lossy encode loses energy fails too, and a real-fixture
regression (a ~20.5 kHz near-Nyquist tone run through the actual
`encodeVariant` production path) proving the HF-energy-loss finding in
code, not just asserted numbers.

**Round 3: the ENERGY metric itself was measuring the wrong thing.** A
later local rebuild, with this design otherwise unchanged, failed 36
sounds against `FORMAT_ENERGY_TOLERANCE_DB` - 33 pre-existing
`origin: "chipvoice"` sounds entirely outside this ticket's scope, plus 3
more generated presets (`ui-hover`, `ui-toggle-off`, `ui-text-blip`, all
short "minimal-ui" oscillator blips) beyond the three already excluded
above. The first read was more codec passband loss; it was not. The real
cause: `energyPerChannel` computed a MEAN (sum of squares divided by
sample count), and on this development machine ffmpeg is built without
libvorbis, so `encodeVariant`'s ogg fallback path uses ffmpeg's own
"experimental" native vorbis encoder (`vorbisEncoderArgs` in
`scripts/lib/audio.mjs`), which does not trim the ogg's own end granule.
A decoded ogg from this machine comes back padded with trailing silence
out to the next 1024-sample block boundary (up to 1023 samples, about
23 ms at 44.1 kHz). Padding grows the sample count while leaving the sum
of squares almost unchanged, so a MEAN reads an artificially lower value;
for a clip only ~1000-3500 samples long (exactly the `ui-*` presets'
size), that padding is a large fraction of the total length and the bias
is large enough to trip a 1.0 dB gate. mp3 is unaffected (ffmpeg already
trims LAME's own gapless padding), and CI's ffmpeg (the Ubuntu apt
package) is built with libvorbis and does not hit this path at all - the
defect is specific to oggs built on this machine, not to any shipped
audio. The fix: `energyPerChannel` now sums instead of averaging (total
energy, not mean-square power), which is invariant to trailing
zero-valued padding, while a real uniform-gain bug (the `-ac 2` case
above) still produces the identical `10*log10(k**2)` delta either way,
since the length term cancels in a ratio - the fix loses no sensitivity
to the bug the gate exists to catch. Re-measured over the full local
catalogue with the corrected sum metric (270 sounds, 1080 variants, 3240
ogg/mp3 format/channel readings): mean |delta| 0.0327 dB, p99 |delta|
0.3595 dB, max |delta| 0.5556 dB, still `footstep-water-puddle` - within
0.005 dB of the figure the original (mean-based) measurement had already
found for that preset, since its ~10,500-11,500-sample variants are far
enough from the 1024-sample block boundary that the bias barely reached
them. `FORMAT_ENERGY_TOLERANCE_DB` stays at 1.0 dB under the corrected
metric too, with the same real margin on both sides. The three `ui-*`
presets pass comfortably once summed (worst deltas -0.05, -0.10 and
-0.18 dB) and were never a real defect, only this measurement artifact.
The three exclusions above were re-checked the same way and hold under
the corrected metric, re-measured rather than assumed: `pickup-key` now
13.2 to 18.2 dB, `impact-glass-light` 6.1 to 6.9 dB, `footstep-metal` 2.2
to 15.6 dB - and for `footstep-metal` specifically, every one of its
eight candidate seeds exceeds tolerance, not only the worst ones, which
settles the open question of whether that exclusion was itself partly a
padded-mean artifact: it was not. `apps/sounds/test/audio.test.mjs` adds
three regression tests for this using the real
`combat-shoot-16bit-snes` shape (1029 real samples padded to 2048): a
padded-silence signal passes the corrected gate; the same signal scaled
by `1/sqrt(2)` still fails at exactly -3.0103 dB; and a pure regression
guard proves in code, not just asserted numbers, that the removed
mean-square formula really would have read about -3 dB on the padded
case alone. The padding defect itself - harmless to the gate now, but
still worth fixing so a developer's local ogg bytes match CI's - is
tracked as a known, non-blocking issue rather than fixed in this ticket
(`docs/GAMESOUNDS.md`'s ogg-fallback-upmix section, `docs/BACKLOG.md`
GS-06).

**Style: what a preset actually models, never a forced fit.** `impact`,
`footstep`, `whoosh` and `explosion` presets model real-world physics
(struck materials, walked surfaces, air movement, a blast) and are filed
`realistic`; `scifi` presets are synthetic sound design and stay `scifi`;
`magic` presets are spell/cast content and are filed `fantasy`; `ui`
presets are short oscillator-only blips and are filed `minimal-ui`.
`pickup` is the one family judged per preset rather than by a blanket
rule: `pickup.ts`'s own header calls its warm, tuned-oscillator arpeggios
(`coin`, `gem`, `powerup`, `level-up`) deliberately "not an 8-bit
square-wave cliche", so those are filed `cartoon`; `key`, the one
physically-informed preset in the family (a struck-metal modal jingle), is
filed `realistic` instead, honestly, alongside the material-impact
families it shares its synthesis technique with. Nothing is forced into
`cartoon`, `horror` or `cozy` just to give an otherwise-empty style facet a
sound: an empty facet stays empty and honest, rather than mislabelled.
`apps/sounds/catalog/generated-recipes.mjs`'s own header carries this same
reasoning line by line, next to the map it explains; `docs/GAMESOUNDS.md`'s
"Generated sounds" section is the canonical summary.

**Guards.** Every generated variant runs through the same `checkSound`
every chipvoice variant does, including a new `checkGeneratedVariantCount`
(same 3-minimum floor as `checkChipvoiceVariantCount`, gated on
`origin === "generated"` so neither rule can silently apply to the other's
sounds by accident). A preset whose variants fail, whose style judgment
cannot be made honestly, or that simply sounds wrong is named and excluded
with a reason in `build-catalog.mjs`'s `EXCLUDED_PRESETS` map, rather than
shipped anyway or forced into a facet it does not belong in; this ticket's
own build excludes three presets this way (`pickup-key`,
`impact-glass-light`, `footstep-metal` - see the format-energy paragraphs
above, including the round-3 correction, for the measured reason each was
excluded). Tuning a preset's own sound is explicitly
out of scope here - sfx-engine's committed hash fixture (decision 52) is
not touched by this ticket, and a preset that needs tuning gets excluded,
not silently shipped worse than it should be. `POST /api/v1/resolve`
reaches a generated sound through an ordinary, origin-blind style match.
The correctly-scoped guarantee, proven exhaustively (not just
spot-checked) by `apps/sounds/test/resolve-generated.test.mjs` against the
real, built catalogue: for every (category, tag-or-none, style)
combination the catalogue can actually be asked for, the full-catalogue
pick equals the chipvoice-only pick whenever a chipvoice-only pick exists
at all - a generated sound can only ever fill a gap a chipvoice sound
leaves empty, it can never override one that exists, since
`pickSoundForEvent`'s style fallback and id tie-break (every generated
sound's id starts with a letter, sorting after chipvoice's digit-starting
`8bit`/`16bit` under `localeCompare`) never reaches past an existing
chipvoice candidate. This is a real, intended behavior change for a
combination that previously resolved to nothing, not a no-op: across 405
combinations checked (85 categories, every tag actually in use, all three
styles - none, `8bit`, `16bit`), 138 previously-unresolvable combinations
now resolve to a generated sound - 46 unique (category, tag) gaps, each
one filling identically under all three styles, so 92 of the 138 are a
`8bit`/`16bit` request newly reaching a generated sound, not just the
style-less default. Examples: `movement/footstep/concrete`,
`movement/footstep/wood`, `combat/explosion/small`, `combat/shield`,
`ui/toggle/on`, `collect/coin/coin` and `magic/cast/shimmer` all
previously resolved to nothing under an explicit `8bit` or `16bit` request
(no chipvoice sound exists for any of them, in any style) and now resolve
to a generated one - correctly: gamesounds' resolve behavior has always
been to widen the search across style rather than return nothing (it never
falls back across tag), and a generated sound filling a gap the
chipvoice-only catalogue actually has is that same fallback doing its job
over a wider candidate pool, not a new kind of override.

The same invariant extends to the EXCLUDE (swap) path,
`pickSoundForEvent`'s `exclude` parameter (the CLI's `swap`): for every
combination with a chipvoice-only pick, excluding that pick's own id must
give the same next pick on both the chipvoice-only pool and the full pool,
whenever the chipvoice-only pool still has another candidate once its own
pick is excluded. When the chipvoice-only pool has no other candidate -
`pickSoundForEvent`'s own documented fallback returns the same excluded
sound again rather than nothing, "a swap request with no other candidate
should say so honestly" - the only permitted difference on the full pool
is a generated sound filling that gap in place of "the same sound again",
the same gap-filling-not-overriding rule applied to the swap case. Also
proven exhaustively by `apps/sounds/test/resolve-generated.test.mjs`,
against the same real, built catalogue and the same production
`pickSoundForEvent` function, never a second hand-copied selection logic.

**What changes.** `apps/sounds/catalog/generated-recipes.mjs` (new),
`scripts/build-catalog.mjs` (renders and merges the generated half),
`scripts/lib/checks.mjs` (`checkGeneratedVariantCount`),
`packages/gamesounds/src/types.ts` (`Origin`'s doc comment no longer says
"not built in this phase"; `Variant` gains an optional `recipe`, one per
generated variant), `src/lib/openapi.ts` (the same, reflected in
`/openapi.json`/`/llms.txt`/`/skill.md`/`/.well-known/mcp.json`, all
derived from it), and the sound detail page (states plainly whether a
sound was made by chip emulation or by sfx-engine, and which model).
`packages/gamesounds`'s CLI and runtime needed no code change - a sound's
origin is opaque to both, they only ever handle a resolved
`Sound`/`Variant` - only new test coverage. CI's `sounds` job now builds
`packages/sfx-engine` before `catalog:build`, the same way it already
builds `packages/chipvoice` and `packages/web-kit` first, for the same
reason (`build-catalog.mjs` imports its built `dist/` directly).
`apps/sounds/vercel.json`'s `ignoreCommand` is unchanged: the site's own
`src/` never imports `packages/sfx-engine` (only the build-time
`scripts/build-catalog.mjs` does), and Vercel's `buildCommand` never runs
`catalog:build` - it serves the already-committed `generated/catalog.json`
- so a change to `packages/sfx-engine` cannot affect what Vercel builds or
serves.

**Amendment, GS-07 v1 (2026-09-29, superseded below the same day): round
3's "padding" description was incomplete - the native-fallback ogg path
DROPS audio, it does not merely pad it.** Round 3 above (and
`docs/GAMESOUNDS.md`'s "known, non-blocking issue" section) described
ffmpeg's native vorbis encoder as extending a decoded ogg with harmless
trailing silence out to the next 1024-sample block boundary. That is true
for most input lengths, but not all of them. Measured directly on this
machine (ffmpeg 8.0.1, no libvorbis) with an 880 Hz, 0.4-linear-amplitude
mono tone, encoded with exactly `vorbisEncoderArgs("native")` plus
`BITEXACT_ARGS` and decoded back: input lengths whose `n mod 1024` falls
in roughly [962, 1023], and any length with residue exactly 0, decode
SHORT by the entire final 1024-sample block - real, non-silent audio
removed, not padded (`n=3071`, residue 1023, decodes to 2048; `n=4096`,
residue 0, decodes to 3072) - and `n=1023`/`n=1024` decode to zero
samples, the whole sound gone. Decoding all 1080 shipped live oggs on
`main` (commit `3b40c16`) found 56 of them (5.2%) actually inside the
truncating band, mean 999 samples lost. The fix this amendment shipped -
an encode-verify-retry inside `encodeVariant`, forced native-only in a new
`oggEncoder` test option - passed locally and moved exactly those 56
oggs' `files.ogg` fields. **It never passed CI**, and CI's own `sounds` job
failure on the resulting PR (#126) is what triggered the re-investigation
below, superseding this amendment in full.

**Amendment, GS-07 v2 (2026-09-29): v1 blamed the wrong layer - it is
DECODERS, not either vorbis ENCODER, that cut real audio off a file's own
tail, and CI's libvorbis oggs are cut too.** A v1 fix that only retried on
the native-encoder branch could only ever be a no-op in CI, whose ffmpeg
has libvorbis - and CI's `sounds` job failed anyway (333 of 1080 variants
failing the length gate, every one exactly 128 frames short), proving the
defect was never specific to the native encoder at all. Direct measurement
settles where it actually lives. Ogg's own granule position - the
authoritative, standard field a stream's last page carries stating exactly
how many sample frames it contains - is read straight off the byte stream
(no decoder involved) and is always >= the source frame count on both
encoders: a native-encoder ogg at `n=1023` carries granule `1024`; at
`n=3071`, granule `3072`; at `n=4096`, granule `4096`; at `n=10035`,
granule `10048`; the same `n=10035` source encoded with libvorbis instead
carries granule `10035`, exactly matching the true content length. The
reference libvorbis decoder plays every one of these files whole. The
encoder, either encoder, was never the problem - every file it produces
already declares, and contains, its own complete content.

What actually cuts audio is DECODERS - plural, disagreeing with each other
and with the truth the granule position states:

- **ffmpeg's own CLI decoder** (what `decodeToRender` in
  `apps/sounds/scripts/lib/audio.mjs` uses, and so what `checkFormatLengths`
  itself was reading) drops up to 128 frames off the end of ANY ogg,
  libvorbis-encoded ones included. Reproduced directly: a granule-complete,
  `n=1023` native-encoder ogg (granule `1024`, provably whole) decodes via
  `ffmpeg -f f32le` to **zero frames** - the entire sound gone, by the
  decoder, from a stream whose own header says it is complete. A
  granule-exact `n=10035` libvorbis ogg (granule `10035`, no padding at
  all) decodes to 9907 frames, 128 short; the first 9907 samples match a
  reference decode to within 1.5e-5, and the missing tail peaks at
  0.00024 - real content, just quiet. Across the 1080 live variants
  re-encoded with libvorbis (the GS-06/GS-07 v2 fix below, before any tail
  guard), 610 of 1080 (56.5%) decode via this same ffmpeg CLI decoder
  exactly 128 frames short of source - never more, never less, whenever
  short at all.
- **Real browsers** (Playwright 1.62.1, `decodeAudioData` into an
  `OfflineAudioContext(1, 44100, 44100)`, "last sample whose absolute value
  exceeds 1e-3" as the content-loss threshold) disagree with the ffmpeg CLI
  and with each other. On the CURRENT (native-encoder) live catalogue,
  across all 1080 variants: Chromium 151 fails to decode 5 of them
  entirely (all `ui-typewriter-*` presets' shortest takes), decodes 1013 of
  the remaining 1075 shorter than the wav's own frame count, and loses
  audible content on 747 relative to what Firefox plays (mean 465.3
  samples lost, max 1024, about 10.5 to 23.2ms at 44.1kHz) - while Firefox
  153 decodes all 1080 whole. The ffmpeg CLI's own decoded length matches
  Chromium's on only 1004 of 1080 (93.0%) - it is measurably NOT a faithful
  proxy for what a browser does with the same bytes.

The same 1010 unique live wavs, re-encoded with `sox -R in.wav -C 5
out.ogg` (libvorbis, mono, the GS-07 v2 fix below), fare much better in
Chromium but not perfectly: 0 decode errors; 686 of 1080 (63.5%) still
decode shorter than the wav's own frame count, but by at most 128 frames
(matching the ffmpeg-CLI figure above almost exactly - 610 of those 686
came from ffmpeg's CLI decoder reading exactly the same file the same
way); the last audible sample matches Firefox exactly on 917 of 1080
(84.9%), and on the other 163 (15.1%) it sits earlier by 1 to 179 frames
(mean 74.4, p99 approximately 150). The worst single case,
`movement-swim-16bit-snes` take 3 (15888 source frames): Chromium decodes
15760 frames with its last audible sample at 15675, Firefox decodes all
15888 with its last audible sample at 15854 - a 128-frame buffer shortfall
but a 179-frame last-audible gap, because a decoder's own rendering of an
already-near-zero fade tail can differ even inside the portion of the
buffer that is not literally missing; buffer length and content loss are
related but not the same measurement, and the larger of the two (179, not
128) is the one that matters for a guard meant to protect real content.
Firefox again decodes all 1080 whole.

mp3 has no equivalent content-loss problem, but has a different,
previously-unmeasured one: Chromium is gapless-exact on every one of the
1080 live mp3s (1042 decode to exactly the wav's own frame count, the
other 38 longer by 4 to 46 samples, mean 23.4, none shorter). Firefox
decodes every mp3 whole too, but does not trim the LAME encoder's own
priming delay the way Chromium's gapless playback does, so its decode of
the same file sits a median 578 samples later than Chromium's (minimum
531, about 13.1ms at 44.1kHz, close to one mp3 granule of 576 samples) -
measured as the last-audible-sample difference between the two engines'
own decodes of the identical bytes, which cancels the encoder's own
pre-echo since both engines decode the same bitstream. That leading-delay
figure is smaller than, and different from, Firefox's own decoded length
exceeding the wav's frame count by 623 to 1774 samples (mean 1172.0): the
length excess is the leading delay plus whatever trailing padding Firefox
also leaves untrimmed, not latency by itself (see this decision's GS-07
v2.1 amendment below - an earlier draft of this paragraph called the whole
623-to-1774 length excess "14 to 40ms of latency", which conflated the two).
Either way it is a real, separate defect (added leading delay, not lost
content) - tracked as new backlog item GS-08, not fixed in this ticket. The
catalogue has no loop sounds (`docs/BACKLOG.md`), so none of this
trailing-silence handling - padding, a guard, or either decoder's own
end-trim - is ever audible as a seam.

**The fix has two parts, both in `apps/sounds/scripts/lib/audio.mjs`.**
First, stop using ffmpeg's own vorbis encoders - native OR libvorbis -
entirely: every ogg on every machine, dev and CI alike, is now encoded
with `sox -R <wav> -C 5 <ogg>` (`-R`: deterministic pseudo-random state,
proven byte-repeatable across two encodes of the same input; `-C 5`:
sox's own documented quality knob for a lossy format, fed straight into
libvorbis's own quality API exactly as ffmpeg's `-q:a 5` is - same
encoder, same scale, same target quality, different front end). `sox` and
its vorbis format handler (`libsox-fmt-base`/`libsox-fmt-all` on
Ubuntu/Debian) are now a hard build requirement - `ensureSoxVorbis` checks
for both before the first encode and throws a specific, actionable error
naming exactly what to install if either is missing, never silently
skipping or falling back. This removes the dev-machine-only code path
entirely (there is no more "native" branch to diverge into) and delivers
GS-06 (libvorbis everywhere) as a side effect: sox also keeps the source's
own mono channel count, so the ogg is mono like the wav and mp3 now - the
old native-fallback path's dual-mono stereo upmix, and its own unity-gain
pan filter, no longer exist on any machine. Second, since even a complete,
correctly-encoded libvorbis ogg still loses up to 128 frames of raw buffer
length and up to 179 frames of real content to the worse of ffmpeg's CLI
decoder or Chromium's own end-trim, `encodeVariant` now appends a fixed
`OGG_TAIL_GUARD_FRAMES = 256` zero-sample pad to the ogg encoder's INPUT
only (never the wav or mp3 that ship) before every single encode - chosen
to clear both measured worst cases (128 and 179 frames) with real margin,
not just the rounder-sounding "128" figure alone. `checkFormatLengths`
keeps comparing against the true, unpadded source frame count; only the
ogg encoder's own input changes.

**A new real-browser gate exists because the CLI-decoder-based gate
structurally cannot see what browsers do.** `checkFormatLength`/
`checkFormatLengths` (`apps/sounds/scripts/lib/checks.mjs`) are unchanged
in logic - ffmpeg CLI decode >= source frame count, zero tolerance short -
and stay wired into `checkSound` alongside `checkFormatEnergies`, catching
exactly the class of loss energy cannot (content removed from a part of
the signal that was already quiet). But the 1004/1080 Chromium-match
figure above means passing that gate was never proof a real browser plays
a file whole. `apps/sounds/scripts/check-browser-decode.mjs` (new) decodes
every catalogue ogg and mp3 in real Chromium AND Firefox (one browser
launch per engine, one page reused, a hard 30-minute process-wide timeout,
both browsers closed in a `finally` - measured about 38 seconds locally for
the full 1080-variant catalogue across both engines) via the same
`decodeAudioData`/`OfflineAudioContext` methodology used to measure the
numbers above. It fails the build on: any decode error; any decoded length
shorter than the wav's own frame count; and, ogg only, disagreement with a
reference decode of the SAME file (sox/libvorbisfile decoding those exact
bytes, compared sample by sample over `[0, sourceFrames)` against the
browser's own decode, `DECODER_AGREEMENT_TOLERANCE` = 1e-3, the pure
comparison living in `apps/sounds/scripts/lib/decode-judge.mjs` so
`node --test` can exercise it with no browser at all). Comparing against a
reference DECODE of the file, rather than against the wav, answers the
question this gate actually needs answered - did the browser's own decoder
return what is actually in the file bytes - without also catching the
codec's own already-gated lossy quantization of the wav (`checkFormatEnergies`'s
job, not this gate's; see the v2.1 amendment below for why an earlier
version of this gate compared against the wav instead, and why that was
wrong). Firefox's mp3 leading delay is reported, never failed on - it is
GS-08's concern, not this gate's. Before checking anything real, the script
builds and checks three negative fixtures, each proving one rule fires
specifically, in every engine: a length fixture (an ogg whose content
genuinely ends 1024 frames before its claimed length, with no tail guard,
must fail the length rule only); a content fixture (an 8192-frame 0.4 tone
with its last 1024 frames zeroed before encoding, same length, same
`OGG_TAIL_GUARD_FRAMES` guard as production, compared against a reference
decode of the un-zeroed tone's own encode, must fail the agreement rule
only, proving the comparison catches a real content difference the length
rule cannot see); and the same fixture at 2e-3 (-54 dBFS), proving there is
no hidden level floor above the stated tolerance. If any of the three does
not fail with its specific expected rule in either engine, the checker
itself is proven untrustworthy and refuses to run the real catalogue at
all. Wired into the `sounds` CI job (which now also installs Firefox, not
just Chromium) and exposed as `pnpm sounds:check-decode` for a pre-push
local run.

**Measured against the rebuilt catalogue, the reference-decode gate passes
cleanly with a wide margin.** Across all 1080 live oggs, the max
`|browser - reference|` disagreement is 1.54e-5 in both Chromium and
Firefox - about 65x below `DECODER_AGREEMENT_TOLERANCE` (1e-3), comfortably
past the 10x-margin bar this gate requires before it will ship (see the
v2.1 amendment below for the full methodology and why the tolerance itself
needed no change). `check-browser-decode.mjs` passes with 0 failures in
Chromium and 0 in Firefox, across all 2160 ogg+mp3 decodes in each engine.

**Rebuilding the catalogue under the new encoder moves every variant's
ogg, and nothing else.** Every one of the 1080 variants' `files.ogg` entry
(sha256, byte count, url) changed; `files.wav` and `files.mp3` did not
change for a single variant (byte-identical, same sha256, confirmed by
diffing the freshly rebuilt `generated/catalog.json` field-by-field
against the pre-rebuild committed version). No sound or variant was added
or removed (270 sounds, 1080 variants, before and after). No other field -
`measure`, `peaks`, `duration`, `recipe`, `category`, `tags`, or the
top-level `categories` list - changed on any sound or variant. `public/f`
is content-addressed and additive-only, so the old, pre-fix ogg files are
still physically present there for anyone who wants to re-run a
before/after comparison.

**Re-measured `FORMAT_ENERGY_TOLERANCE_DB` and the three `EXCLUDED_PRESETS`
under the new encoder.** Rebuilding logged the real distribution under the
new encoder across all 2160 ogg/mp3 energy readings: mean |delta| 0.0474
dB, p99 |delta| 0.2985 dB, max |delta| 0.4789 dB (worst single reading:
`movement-footstep-realistic-footstep-water-puddle` at -0.48 dB) -
comfortably inside `FORMAT_ENERGY_TOLERANCE_DB`'s 1.0 dB with real margin,
so the tolerance itself needs no change. Each of the three
`EXCLUDED_PRESETS` (`pickup-key`, `impact-glass-light`, `footstep-metal`)
was independently re-rendered (all 8 `SEED_LADDER` seeds, not just the
accepted takes) and re-measured against the new sox/libvorbis ogg and the
(byte-identical, unchanged) mp3: the loss is essentially unchanged from
before the encoder switch - `impact-glass-light` (6.05 to 6.86 dB) and
`footstep-metal` (2.17 to 15.59 dB) re-measured within a few hundredths of
a dB of their existing recorded range, `pickup-key`'s worst-seed range
moved from 13.2-18.2 dB to 12.64-18.17 dB (still far outside tolerance).
All three exclusions still trigger and remain excluded; `build-catalog.mjs`'s
reason strings were updated to the re-measured figures.

**What remains open.** GS-06 (libvorbis everywhere) and this GS-07 v2 fix
both ship in the same PR (#126) - a developer's local ogg rebuild now
matches CI's byte-for-byte for the same input, closing GS-06 as a side
effect rather than merely tolerating the old divergence. GS-08 (Firefox's
mp3 leading-delay/encoder-priming defect, `docs/BACKLOG.md`) remains open
and unfixed - it is added latency, not lost content, and out of scope
here.

**Amendment, GS-07 v2.1 (2026-09-29): the content-loss gate's own oracle
was wrong, and the GS-08 numbers were mislabeled.** Review of v2 found two
defects in the browser gate itself, both since fixed, still in the same PR
(#126); the encoder fix above (sox/libvorbis everywhere,
`OGG_TAIL_GUARD_FRAMES = 256`) is unaffected and was not revisited.

The content-loss rule compared a browser's ogg decode against the SOURCE
WAV at an instantaneous 1e-3 crossing. That conflates two different things:
the lossy codec's own quantization of an already-quiet decaying tail
(which `checkFormatEnergies` already gates, on total energy, at the
encoder level) with an actual DECODER cut (a browser returning less than
what the file itself contains). The evidence was in the reviewer's own
rebuilt-catalogue measurement: v2's first real run against the rebuilt
catalogue flagged 96 of 1080 variants, and every one of those 96 showed
the identical gap size in BOTH Chromium and Firefox (96 and 96 - zero
flagged by only one engine) - and Firefox is independently proven to
decode every one of those 1080 files whole (the granule-position proof
earlier in this decision). Two independent decoder implementations
agreeing exactly with each other, and disagreeing only with a wav the
lossy codec had already legitimately requantized, is not evidence of a
decoder cut; it is evidence the codec's own encode differs slightly from
the wav, which is expected and already gated elsewhere. `REAL_CONTENT_THRESHOLD`
= 4e-3 was picked after seeing these 96 cases (about 2.4x their observed
1.68e-3 max), making it a post-hoc threshold reverse-fitted to the data it
was meant to judge, even though it happened to hide no real cut. The
`CONTENT_LOSS_MARGIN_FRAMES` comment additionally claimed the pre-guard gap
distribution was "bimodal: matches exactly or differs by 100+ frames,
nothing in between" - that was false; the real, measured pre-guard
distribution (Chromium: <=0 frames 691, 1-16 frames 226, 17-64 frames 114,
65-128 frames 46, >128 frames 3; Firefox, a whole decoder: <=0 frames 765,
1-16 frames 217, 17-64 frames 80, 65-128 frames 15, >128 frames 3) is
continuous. A further check on 45 of the rebuilt files where Chromium and
Firefox disagreed on the last audible sample (Chromium earlier in every
one, by up to 165 frames) found both engines' last-audible sample landing
AFTER the wav's own last-audible sample in every case, with the wav
exactly zero in between - codec ringing inside the guard zone that
Chromium trims more aggressively, not lost content. The earlier "confirmed
by hand" description of the 96 cases similarly overstated what had been
established; the actual, decisive evidence was the 96/96 cross-engine
agreement and Firefox's independent proof of wholeness, not a listen-by-ear
check.

The fix replaces the wav-based rule with a reference-decode comparison:
for each shipped ogg, sox's own reference decoder (`sox <ogg> -t f32 -`,
libvorbisfile under the hood - the same decoder GS-06/GS-07 encodes with,
used here purely as a decoder) decodes those exact bytes, and each
browser's own decode of the same bytes is compared against it, sample by
sample, over `[0, sourceFrames)`, at `DECODER_AGREEMENT_TOLERANCE` = 1e-3
(the same -60 dBFS audibility floor the old, wrong rule used - unchanged,
since the floor itself was never the problem). The comparison never
searches for or corrects a lag: offset 0 is what a correct decode at a
matching, unresampled 44.1kHz sample rate is expected to produce, and a
systematic offset would be a bug to report, not paper over - none was
found. `REAL_CONTENT_THRESHOLD`, `CONTENT_LOSS_MARGIN_FRAMES` and the false
"bimodal" comment are deleted outright, along with the wav-based
`lastAboveThreshold` mechanism. The pure comparison and judging logic moved
into `apps/sounds/scripts/lib/decode-judge.mjs`, unit-tested directly
(`apps/sounds/test/decode-judge.test.mjs`, 8 cases: equal arrays agree;
reference plus 1.5e-5 noise still agrees, the reviewer's own measured
ffmpeg-vs-sox reference-decoder disagreement on a real file; a zeroed tail
and a zeroed middle block each fail naming the exact first/last differing
index; `judge()`'s length, content, decode-error and healthy-decode paths
each behave independently) with no browser launched at all. The tolerance
was fixed before measuring, per this project's own standing rule never to
adjust a stated tolerance to fit what got measured: the actual max
`|browser - reference|` across all 1080 rebuilt oggs measured 1.54e-5 in
both Chromium and Firefox - about 65x below the 1e-3 tolerance, comfortably
past the 10x margin required before shipping, so no widening was ever
needed or considered. The single length-only negative fixture is now three,
each asserted to fail its OWN specific rule (not "any failure") in both
engines before the real catalogue is allowed to run at all: the existing
length fixture; a content fixture (an 8192-frame 0.4 tone with the last
1024 frames zeroed before encoding, same length and same
`OGG_TAIL_GUARD_FRAMES` guard as production, compared against a reference
decode of the un-zeroed tone's own separate encode - deliberately a
different file, since comparing the zeroed file against a reference decode
of itself would never catch missing content that was never encoded in the
first place); and the same fixture at 2e-3 (-54 dBFS), proving there is no
hidden level floor above the stated tolerance. All three fail with their
specific expected rule, in both engines, on every run.

GS-08's own numbers were also wrong. The "623 to 1774 samples, mean 1172,
14 to 40ms of latency" figure above is Firefox's decoded mp3 length minus
the wav's own frame count - that excess is the leading delay PLUS whatever
trailing padding Firefox also leaves untrimmed, not latency by itself. The
actual leading delay - Firefox's last-audible sample minus Chromium's own,
on the same decoded bytes (a comparison that cancels the encoder's own
pre-echo, since both engines decode the identical bitstream) - is a median
578 samples (minimum 531), about 13.1ms at 44.1kHz and close to one mp3
granule of 576 samples. `docs/BACKLOG.md`'s GS-08 entry, `docs/GAMESOUNDS.md`
and this decision's own mp3 paragraph above are corrected to state both
numbers and which is which. Separately, `check-browser-decode.mjs`'s own
per-file info line reports a plainer, script-computable proxy for the same
defect - each engine's decoded mp3's first sample above 1e-3 minus the
wav's own first sample above 1e-3, median/min/max across all 1080 variants
- because this forward-looking, per-engine version is markedly noisier than
the cross-engine last-sample figure above (Chromium: min -219, median -10,
max 37; Firefox: min -142, median -4, max 580): many of this catalogue's
short, percussive chiptune attacks carry their own lossy-encoding pre-echo
right at the start of the decoded stream in BOTH engines, which this
simpler per-engine metric cannot distinguish from a genuine delay, while
comparing the two engines' decodes of the same bitstream against each
other cancels that shared pre-echo out. The script reports this info line
as a diagnostic, never a failure; the 578-sample/13.1ms figure above is the
one to cite as "what GS-08 is."

The catalogue itself did not change in this round: `apps/sounds/generated/catalog.json`
diffs at zero changed fields against the version this decision's own GS-07
v2 fix produced (commit `6308ea5`) - this round touched only the gate
script, its new unit-tested lib module, and documentation.
