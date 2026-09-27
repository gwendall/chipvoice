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

Public durations accept integers 1–30; the default remains two loops, refused
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

**Encoding.** The write stream is tick-deltas plus `{reg, value}` pairs, with
no run-length or dictionary compaction: the simplest encoding that fits
comfortably inside 64 KB for the corpus tested so far except the two dense,
multi-instrument arrangements (mario, sonic), which fail loudly with
`SpcExportSizeError { measured, limit }` rather than truncating, matching
how `validateSong` already reports capacity elsewhere. A denser encoding
(run lengths, a value dictionary) was considered and set aside, not ruled
out: today's failures are named and measured, not silent, which was the
ticket's bar.

**What changes.** `packages/chipvoice/src/spc-export.ts` and
`chips/snes/spc-player.ts` are new; `exportSpc` and `SpcExportSizeError` are
exported from the package index; `projectCapabilities()` reports `spc` as
the SNES `registerExportFormats` entry; `apps/web/src/studio/exports.ts`
gains an `spc` export kind. None of this touches `spc-import.ts`,
`spc700.ts` or `ssmp.ts` from decision 45; a round trip through `importSpc`
is how the CI check in `packages/conform/src/spc/check-export.mjs` proves
the player's writes land where the capture put them.
