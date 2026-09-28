# Oracle: Ayumi

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

Peter Sovietov's Ayumi, the second, independent oracle for the
AY-3-8910/YM2149 core (`Ay8910`, `packages/chipvoice/src/chips/ay8910.ts`),
first hosted here as the Sunsoft 5B expansion audio (NEXT-15). Vendored from
<https://github.com/true-grue/ayumi> under the MIT licence (see
[LICENSE](LICENSE)), pinned at revision
`07c08b4874c359169e4a028edf73f046d8b763e2`. It is a tool in this repository;
nothing here ships in the `chipvoice` package.

## What is Sovietov's and what is not

`ayumi.c`/`ayumi.h` are his, unchanged. `main.cpp` is ours: it reads a
chipvoice register log, drives Ayumi with it, and prints every change of
every channel's raw 0-31 digital index as `<cycle> <voice> <value>` - the
same units `Ay8910.trace` produces, unlike Game_Music_Emu's `Ay_Apu`
(`oracles/game-music-emu-ay.mjs`), which reports its own amplitude-table
byte instead because its raw index is private state with no public accessor.
`main.cpp`'s own module doc comment has the full driver design: the two
clock layers (input clock to generator tick, 16:1, matching
`Ay8910.clock()`'s own `prescaleCounter`; generator tick to
`ayumi_process()`, 8:1, via `DECIMATE_FACTOR`), and why it reads Ayumi's
public struct fields and recomputes the mixer's gate-and-index formula
itself rather than calling `update_tone`/`update_noise`/`update_envelope`/
`update_mixer` directly - those are `static`, not part of Ayumi's public
API, and the "never patch an oracle to adopt the core's behaviour" rule
(this ticket's own review lesson) rules out changing that just to expose
them. The harness builds it with the system C++ compiler on first use, into
`build/`.

## Known limits of this oracle

- **The noise generator's 17-bit LFSR is a different, provably
  non-equivalent construction from this core's own.** Ayumi's
  `update_noise` computes one new bit, `bit0 ^ bit3`, and inserts it at bit
  16 - a Fibonacci-form LFSR. Nesdev's Sunsoft 5B audio page states the real
  generator only as "a 17-bit linear feedback shift register with taps at
  bits 16 and 13," and taken literally - XOR the shifted-out bit into both
  tapped positions directly - that is a Galois-form construction instead,
  which `Ay8910`'s own noise generator now implements
  (`packages/chipvoice/src/chips/ay8910.ts`'s `tick()`), corroborated by
  Game_Music_Emu's independently-written `Ay_Apu` using the identical
  Galois formula. `docs/DECISIONS.md`'s decision 47 records the exhaustive
  search this project ran (every insertion bit, every XOR tap, every output
  bit) that found no relabelling of Ayumi's form reproducing the Galois
  form's sequence - two real, independent references, genuinely
  disagreeing, not a bug in either one's own engineering. Any corpus script
  whose gate depends on the noise generator (`corpus/ay8910/edge/noise-sweep.log`,
  `tone-noise-mixed.log`, and two of `gate-toggle.log`'s four runs) is
  `--report` only against this oracle, never gated exact.
- **Tone, mixer/gate, fixed volume and the envelope generator have no known
  disagreement and are gated exact.** Ayumi's `update_tone` restarts a
  fresh phase at every register write's next reload the same discrete,
  counter-vs-threshold way `Ay8910`'s own `toneCounter` does (no
  delta-carry complexity to reconcile, unlike Game_Music_Emu's `Ay_Apu` -
  see `oracles/game-music-emu-ay.mjs`'s own "known limits"), and the
  envelope table (`ayumi.c`'s `Envelopes[16][2]`/`reset_segment`) was
  cross-checked against `Ay8910`'s own `ENVELOPE_SHAPES` table before either
  was trusted (`ay8910.ts`'s own class doc comment) - `corpus/ay8910/core`
  (DAC-mode only) and the tone/envelope logs in `corpus/ay8910/edge` all
  measure 100% identical against this oracle with no settling and no
  constant shift needed.

## A second oracle

Game_Music_Emu's `Ay_Apu` (`oracles/game-music-emu-ay.mjs`,
`oracles/game-music-emu/README.md`'s own "AY-3-8910/YM2149 (`Ay_Apu`)"
section) is the other oracle for this core. The two are trusted for
different, non-overlapping features rather than one simply outranking the
other everywhere - `docs/DECISIONS.md`'s decision 47 is the record of which
is which and why, written specifically so a later ticket (an MSX AY-3-8910
host, or the YM2203/2608's SSG half - both named as future hosts in
`ay8910.ts`'s own class doc comment) does not have to re-derive it.
