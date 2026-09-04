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

### 4. Event time moves to chip cycles (2026-09-04, to be done in phase 1)

`RegisterEvent.at` becomes a count of the chip's clock cycles. The sample position
is derived inside the core from the cycle count and the sample rate.

**Why.** Every oracle reasons in cycles, VGM is written in cycles, and the driver
thinks in frames and does not care. Timestamps in samples tie the event stream to
one sample rate and make bit-exact comparison a conversion problem.

**What changes.** The worklet converts `currentFrame` to cycles on the way in.
VGM export becomes a serialisation of the event stream.

### 5. The triangle starts at a zero-output phase (2026-09-04)

The core's triangle powers on at sequencer step 15, which outputs 0. The hardware
powers on at step 0, which outputs 15.

**Why.** A held 15 at power-on is a DC step through two high-pass filters, which
is a click at the head of every render. The deviation affects only the initial
state and is listed on the sheet as deliberate.

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

## Open

### B. The SID's licence

reSID-fp is GPL. Either a separate GPL package, or a rewrite from the
documentation with a weaker sheet. Decide when phase 7 is in sight, not before.
