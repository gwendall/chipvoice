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

## Open

### A. Immutable audio URLs versus a chip that changes

`/s/{id}.mp3` is cached for a year as immutable, on the reasoning that the song
behind an id never changes. The engine behind it does: phase 0 changed the sound
of every drum. Cached files stay old until they expire, and a freshly rendered
file differs from one somebody downloaded last week from the same URL.

Options: put an engine version in the audio path or query, so a conformance fix
is a new URL; keep the URL and accept that an immutable cache holds the sound as
it was when first fetched; or shorten the cache. Not decided. The first option
is the honest one and the one that breaks pasted links.

### B. The SID's licence

reSID-fp is GPL. Either a separate GPL package, or a rewrite from the
documentation with a weaker sheet. Decide when phase 7 is in sight, not before.
