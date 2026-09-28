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

None found. This is the fully-trusted oracle for every generator on this
chip, including the noise LFSR. Ayumi's `update_noise` computes one new
bit, `bit0 ^ bit3`, and inserts it at bit 16 - a Fibonacci-form LFSR -
matching MAME's own `noise_rng_tick()` (`src/devices/sound/ay8910.h`,
licence BSD-3-Clause, Couriersud), the one source this project found that
states this construction was "verified on AY-3-8910 and YM2149 chips."
`Ay8910`'s own noise generator (`packages/chipvoice/src/chips/ay8910.ts`'s
`tick()`) now implements the same construction. `docs/DECISIONS.md`'s
decision 48 records that an earlier version of this ticket instead read
nesdev's "taps at bits 16 and 13" as a Galois-form construction (XOR the
shifted-out bit into both tapped positions directly) and, on review, that
reading was wrong: "taps" is Fibonacci vocabulary, and the only source that
shared the Galois reading (Game_Music_Emu's `Ay_Apu`) carries no
hardware-verified citation for it. Tone, mixer/gate, fixed volume, the
envelope generator and now the noise generator all measure 100% identical
against this oracle with no settling and no constant shift needed - Ayumi's
`update_tone` restarts a fresh phase at every register write's next reload
the same discrete, counter-vs-threshold way `Ay8910`'s own `toneCounter`
does (no delta-carry complexity to reconcile, unlike Game_Music_Emu's
`Ay_Apu` - see `oracles/game-music-emu-ay.mjs`'s own "known limits"), and
the envelope table (`ayumi.c`'s `Envelopes[16][2]`/`reset_segment`) was
cross-checked against `Ay8910`'s own `ENVELOPE_SHAPES` table before either
was trusted (`ay8910.ts`'s own class doc comment).

## A second oracle

Game_Music_Emu's `Ay_Apu` (`oracles/game-music-emu-ay.mjs`,
`oracles/game-music-emu/README.md`'s own "AY-3-8910/YM2149 (`Ay_Apu`)"
section) is the other oracle for this core. It corroborates `core` (DAC
mode, gated exact against both), but is report-only on `edge`: its own
noise LFSR is the Galois form, undocumented as hardware-verified, and its
own tone/noise timing carries a settle-dependent offset -
`docs/DECISIONS.md`'s decision 48 is the record of both, written
specifically so a later ticket (an MSX AY-3-8910 host, or the YM2203/2608's
SSG half - both named as future hosts in `ay8910.ts`'s own class doc
comment) does not have to re-derive it.
