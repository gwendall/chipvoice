# Konami VRC6 (`vrc6`)

<p align="center">
  <a href="vrc6.md">English</a> &bull;
  <a href="vrc6_ja.md">日本語</a>
</p>


The first of NEXT-14's expansion-audio chips (decision 38): a mapper chip
Konami put on some of its own NES/Famicom cartridges, adding two pulses with a
16-step duty table (not the 2A03's four fixed duties) and a seven-bit
sawtooth, each at its own 12-bit period (one bit wider than the 2A03's own
11-bit pulses), mixed alongside the console's own five voices rather than
replacing any of them. The method behind every section is in
[CONFORMANCE.md](../CONFORMANCE.md).

| | |
| --- | --- |
| **Machine** | NES, Famicom (Konami VRC6 cartridges: Akumajou Densetsu / Castlevania III, Madara, Esper Dream 2) |
| **Status** | **in progress**: measured against two independent oracles, Game_Music_Emu's `Nes_Vrc6_Apu` and, since round 2, Mesen 2's own VRC6 audio; the corpus is split so every script that avoids the oracles' own known gaps (no disable after the first enable, no period at or below 4, no `$9003` writes) gates at a literal 100 % against both, and every script that hits one of those gaps gates exactly against Mesen 2 (which models all three) while Game_Music_Emu reports the same script without gating CI; round 3 found the pulse duty generator's own counting-direction mismatch against Mesen 2 is an exact, algebraic mapping, not a baseline question, so the four flat-corpus scripts that never touch the sawtooth's own disable/re-enable gap now gate at a literal 100 % against Mesen 2 too (`check:vrc6-flat-mesen`); the remaining four, all of which do touch that gap, stay on the original eight-script corpus's no-regression baseline, 38.1 % against Game_Music_Emu (unchanged) and now 90.4 % against Mesen 2 (up from 23.6 %), while the per-run, shift-tolerant match the board reads is 79.0 % of 105 runs; a self-authored VRC6 NSF probe proves NSF export/playback round-trips through Game_Music_Emu's own `Nsf_Emu` player exactly; no driver reaches it yet |
| **Core** | written from the nesdev wiki and Konami's own VRC6 documents: the standalone digital chip in `packages/chipvoice/src/chips/nes/vrc6.ts`, the combined `2a03-vrc6` cartridge chip and its mixing stage in `vrc6-core.ts` |
| **Licence of the core** | MIT, like the rest of the package. Game_Music_Emu's `Nes_Vrc6_Apu`, the oracle, is LGPL and lives in the harness only: decision 41 |
| **Sheet updated** | 2026-09-28, by hand and by `conform` |

## Digital parity

Measured by [`conform`](../../packages/conform), the harness, against two
independent oracles: [Game_Music_Emu](../../packages/conform/oracles/game-music-emu)'s
`Nes_Vrc6_Apu`, and, since round 2, [Mesen 2](../../packages/conform/oracles/mesen)'s
own vendored VRC6 audio. Round 2 split the corpus by what each script
actually exercises (`generate-vrc6.mjs`'s own comment says why):

- **`core`** ([`packages/conform/corpus/vrc6/core`](../../packages/conform/corpus/vrc6/core)):
  no disable after the first enable, no period at or below 4, no `$9003`
  writes - duty table, mode bit, volumes, periods, saw rates including
  overflow, multi-voice independence. Held to a literal 100 % against
  **both** oracles: this is the region where the documents, this core and
  both independent emulations agree exactly, cycle for cycle.
- **`edge`** ([`packages/conform/corpus/vrc6/edge`](../../packages/conform/corpus/vrc6/edge)):
  disable/re-enable, `$9003`, tiny periods. Mesen 2 models all three
  (`$9003`, the sawtooth's disable-zeroes-the-accumulator behaviour, any
  period at or below 4), so these gate exactly against it too. Game_Music_Emu
  does not model any of the three ("What the numbers say" below), so against
  it these scripts are report-only, never gating CI, the documented gap
  stated as a rule rather than a loosened threshold.
- The original eight-script corpus (duty-generator-active throughout) drives
  every voice through several enable/disable cycles at once, and splits in
  two once measured against Mesen 2:
  - Four scripts (`script-duty`, `script-pulse-both`, `script-pulse-enable`,
    `script-pulse-periods`) disable and re-enable pulses but never touch the
    sawtooth while it is disabled. Round 3 found the pulse mismatch there is
    not a phase convention any shift could close, but an exact algebraic
    mapping - see "The pulse mapping" below - so these four now gate at a
    literal 100 % against Mesen 2 (`check:vrc6-flat-mesen`), the same as
    `core` and `edge`.
  - The other four (`script-all-three`, `script-saw-enable`,
    `script-saw-rates`, `script-saw-worked-example`) disable and re-enable
    the sawtooth, where Mesen 2's own divider stops counting entirely while
    disabled - see "The sawtooth's divider across a disable" below - a
    genuinely different mechanism the mapping does not reach. These four stay
    on the original no-regression baseline, against both oracles.

The numbers between each pair of markers are written by the harness (`pnpm
--filter chipvoice-conform baseline:vrc6*`, one script per table below); the
reading of them is a person's. CI reruns every corpus and fails if a `core`,
`edge`-against-Mesen or `flat-mesen` script's identical count is anything but
exact, or if the legacy corpus's identical count falls below its committed
baseline against either oracle. `packages/conform/test/vrc6-gate.mjs` (part
of `test:unit`, so it runs on every push) proves each exact gate would
actually catch a regression rather than passing only because nothing in the
corpus happens to exercise the path a bug would break: it runs the same
`chip.trace()`/`oracle.trace()`/`compare()` each gate script is built from,
once on a corpus log's own writes (must not diverge) and once against a copy
with one write's enable bit flipped (must diverge), for `check:vrc6-core`,
`check:vrc6-core-mesen`, `check:vrc6-edge-mesen` and `check:vrc6-flat-mesen`
each; a second, separate negative test for `check:vrc6-flat-mesen` proves the
mapping itself matters, not just that a corpus log can be corrupted - see
"The pulse mapping" below.

### Core scripts, against Game_Music_Emu (exact gate)

<!-- core-game-music-emu:begin -->
Written by `conform` on 2026-09-28, against Game_Music_Emu (Nes_Vrc6_Apu), on vp1, vp2, vsaw.

| | |
| --- | --- |
| Oracle | Game_Music_Emu (Nes_Vrc6_Apu) |
| Corpus | 5 logs, 310840 cycles |
| Identical cycles | 310840 / 310840 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| multi-voice | 100.0000 % | none | vp1 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; vp2 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; vsaw 100.0000 %, 332/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| pulse-levels | 100.0000 % | none | vp1 100.0000 %, 15/0/0; runs 1: 1 on times, 1 on values, shift <= 0; vp2 100.0000 %, 15/0/0; runs 1: 1 on times, 1 on values, shift <= 0; vsaw 100.0000 %, 0/0/0 |
| saw-periods | 100.0000 % | none | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 100.0000 %, 16/0/0; runs 16: 16 on times, 16 on values, shift <= 0 |
| saw-rates | 100.0000 % | none | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 100.0000 %, 492/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| saw-worked-example | 100.0000 % | none | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 100.0000 %, 9002/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- core-game-music-emu:end -->

### Core scripts, against Mesen 2 (exact gate)

<!-- core-mesen:begin -->
Written by `conform` on 2026-09-28, against Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio, on sum.

| | |
| --- | --- |
| Oracle | Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio |
| Corpus | 5 logs, 310840 cycles |
| Identical cycles | 310840 / 310840 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| multi-voice | 100.0000 % | none | sum 100.0000 %, 333/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| pulse-levels | 100.0000 % | none | sum 100.0000 %, 30/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| saw-periods | 100.0000 % | none | sum 100.0000 %, 16/0/0; runs 16: 16 on times, 16 on values, shift <= 0 |
| saw-rates | 100.0000 % | none | sum 100.0000 %, 492/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| saw-worked-example | 100.0000 % | none | sum 100.0000 %, 9002/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- core-mesen:end -->

### Edge scripts, against Mesen 2 (exact gate)

<!-- edge-mesen:begin -->
Written by `conform` on 2026-09-28, against Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio, on sum.

| | |
| --- | --- |
| Oracle | Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio |
| Corpus | 3 logs, 181323 cycles |
| Identical cycles | 181323 / 181323 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| pulse-enable | 100.0000 % | none | sum 100.0000 %, 12/0/0; runs 6: 6 on times, 6 on values, shift <= 0 |
| register-9003 | 100.0000 % | none | sum 100.0000 %, 1832/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| saw-enable | 100.0000 % | none | sum 100.0000 %, 70/0/0; runs 5: 5 on times, 5 on values, shift <= 0 |
<!-- edge-mesen:end -->

### Edge scripts, against Game_Music_Emu (report only, not a gate)

<!-- edge-game-music-emu:begin -->
Written by `conform` on 2026-09-28, against Game_Music_Emu (Nes_Vrc6_Apu), on vp1, vp2, vsaw.

| | |
| --- | --- |
| Oracle | Game_Music_Emu (Nes_Vrc6_Apu) |
| Corpus | 3 logs, 181323 cycles |
| Identical cycles | 113273 / 181323 (62.4703 %) |
| Logs with a divergence | 2 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| pulse-enable | 100.0000 % | none | vp1 100.0000 %, 12/0/0; runs 6: 6 on times, 6 on values, shift <= 0; vp2 100.0000 %, 0/0/0; vsaw 100.0000 %, 0/0/0 |
| register-9003 | 45.4332 % | cycle 19231, vsaw: ours 0, oracle 1 | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 45.4332 %, 25/4/2219; runs 1: 0 on times, 0 on values, shift <= 0 |
| saw-enable | 32.5073 % | cycle 18465, vsaw: ours 0, oracle 7 | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 32.5073 %, 65/0/14; runs 5: 5 on times, 1 on values, shift <= 42 |
<!-- edge-game-music-emu:end -->

### Flat corpus, pulse scripts against Mesen 2 (exact gate)

The four flat-corpus scripts that disable and re-enable a pulse but never the
sawtooth: `check:vrc6-flat-mesen` runs the same directory as `check:vrc6-mesen`
below, `--exclude`-ing the four that do touch the sawtooth's own disable/
re-enable gap (those four stay on `parity-mesen`'s no-regression baseline).
See "The pulse mapping" below for why these four can be held exact.

<!-- flat-mesen:begin -->
Written by `conform` on 2026-09-28, against Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio, on sum.

| | |
| --- | --- |
| Oracle | Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio |
| Corpus | 4 logs, 3891837 cycles |
| Identical cycles | 3891837 / 3891837 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-duty | 100.0000 % | none | sum 100.0000 %, 320/0/0; runs 8: 8 on times, 8 on values, shift <= 0 |
| script-pulse-both | 100.0000 % | none | sum 100.0000 %, 6060/0/0; runs 3: 3 on times, 3 on values, shift <= 0 |
| script-pulse-enable | 100.0000 % | none | sum 100.0000 %, 12/0/0; runs 6: 6 on times, 6 on values, shift <= 0 |
| script-pulse-periods | 100.0000 % | none | sum 100.0000 %, 1268/0/0; runs 65: 65 on times, 65 on values, shift <= 0 |
<!-- flat-mesen:end -->

### Full legacy corpus, against Game_Music_Emu (no-regression baseline)

<!-- parity:begin -->
Written by `conform` on 2026-09-28, against Game_Music_Emu (Nes_Vrc6_Apu), on vp1, vp2, vsaw.

| | |
| --- | --- |
| Oracle | Game_Music_Emu (Nes_Vrc6_Apu) |
| Corpus | 8 logs, 6339623 cycles |
| Identical cycles | 2413335 / 6339623 (38.0675 %) |
| Logs with a divergence | 8 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-all-three | 15.0657 % | cycle 17898, vp2: ours 0, oracle 9 | vp1 60.9123 %, 0/0/5250; runs 3: 1 on times, 1 on values, shift <= 91; vp2 51.3302 %, 0/0/6940; runs 3: 0 on times, 0 on values, shift <= 0; vsaw 32.1948 %, 7976/0/39629; runs 3: 3 on times, 1 on values, shift <= 35 |
| script-duty | 74.8876 % | cycle 37551, vp1: ours 15, oracle 0 | vp1 74.8876 %, 40/0/572; runs 8: 2 on times, 2 on values, shift <= 41; vp2 100.0000 %, 0/0/0; vsaw 100.0000 %, 0/0/0 |
| script-pulse-both | 52.6977 % | cycle 17898, vp1: ours 0, oracle 10 | vp1 80.0625 %, 0/0/8518; runs 3: 2 on times, 2 on values, shift <= 117; vp2 62.5967 %, 0/0/3608; runs 3: 1 on times, 1 on values, shift <= 23; vsaw 100.0000 %, 0/0/0 |
| script-pulse-enable | 98.3029 % | cycle 17898, vp1: ours 0, oracle 15 | vp1 98.3029 %, 0/0/28 (2 at -13); runs 6: 4 on times, 4 on values, shift <= 181; vp2 100.0000 %, 0/0/0; vsaw 100.0000 %, 0/0/0 |
| script-pulse-periods | 41.5736 % | cycle 17898, vp2: ours 0, oracle 12 | vp1 100.0000 %, 0/0/0; vp2 41.5736 %, 2/1/1412; runs 65: 59 on times, 59 on values, shift <= 94309; vsaw 100.0000 %, 0/0/0 |
| script-saw-enable | 29.5108 % | cycle 18117, vsaw: ours 0, oracle 1 | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 29.5108 %, 7/0/67; runs 5: 5 on times, 1 on values, shift <= 16 |
| script-saw-rates | 49.3714 % | cycle 29799, vsaw: ours 0, oracle 1 | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 49.3714 %, 0/0/1404 (139 at -12); runs 5: 5 on times, 1 on values, shift <= 60 |
| script-saw-worked-example | 99.9972 % | cycle 35897, vsaw: ours 5, oracle 4 | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 99.9972 %, 8999/0/1; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- parity:end -->

### Full legacy corpus, against Mesen 2 (no-regression baseline)

<!-- parity-mesen:begin -->
Written by `conform` on 2026-09-28, against Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio, on sum.

| | |
| --- | --- |
| Oracle | Mesen 2 (b9fa69d, 2026-06-04), VRC6 audio |
| Corpus | 8 logs, 6339623 cycles |
| Identical cycles | 5732468 / 6339623 (90.4229 %) |
| Logs with a divergence | 4 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-all-three | 73.4395 % | cycle 757716, sum: ours 75, oracle 0 | sum 73.4395 %, 12613/0/42309; runs 3: 1 on times, 1 on values, shift <= 0 |
| script-duty | 100.0000 % | none | sum 100.0000 %, 320/0/0; runs 8: 8 on times, 8 on values, shift <= 0 |
| script-pulse-both | 100.0000 % | none | sum 100.0000 %, 6060/0/0; runs 3: 3 on times, 3 on values, shift <= 0 |
| script-pulse-enable | 100.0000 % | none | sum 100.0000 %, 12/0/0; runs 6: 6 on times, 6 on values, shift <= 0 |
| script-pulse-periods | 100.0000 % | none | sum 100.0000 %, 1268/0/0; runs 65: 65 on times, 65 on values, shift <= 0 |
| script-saw-enable | 99.2116 % | cycle 30426, sum: ours 15, oracle 0 | sum 99.2116 %, 14/0/48; runs 5: 5 on times, 5 on values, shift <= 31 |
| script-saw-rates | 90.8676 % | cycle 29799, sum: ours 0, oracle 15 | sum 90.8676 %, 0/0/1400 (140 at -12); runs 5: 5 on times, 5 on values, shift <= 18 |
| script-saw-worked-example | 99.9972 % | cycle 35897, sum: ours 75, oracle 60 | sum 99.9972 %, 8999/0/1; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- parity-mesen:end -->

**What the numbers say.** Round 2 split the corpus precisely so the legacy
number would no longer have to carry both kinds of question at once. The
`core` and `edge` scripts above answer "does this core match the documents,
independently confirmed by two emulators built by different people from
different sources": yes, exactly, cycle for cycle, on every script that does
not hit one of Game_Music_Emu's own three known gaps, and exactly against
Mesen 2 even on the three that do, and now, since round 3, exactly against
Mesen 2 on four of the legacy corpus's own eight scripts too (see "Flat
corpus" above and "The pulse mapping" below). The legacy corpus's raw
headline (38.1 % against Game_Music_Emu, up from 35.7 % once round 2's
polarity fix and split were in place; 90.4 % against Mesen 2, up from 23.6 %
once round 3's pulse mapping was in place) answers a different question,
"what happens when a script drives every voice through several enable/
disable cycles at once," and still undercounts this chip against
Game_Music_Emu specifically because of it, and, on the four still-diverging
scripts, against Mesen 2's own sawtooth as well ("The sawtooth's divider
across a disable" below): the corpus deliberately drives every voice through
several enable/disable cycles (`generate-vrc6.mjs`'s own comment says why),
and
Game_Music_Emu's `Nes_Vrc6_Apu` - read directly, `gme/Nes_Vrc6_Apu.cpp` in
the vendored oracle - freezes state across a disable that the documents, and
this core, do not. A pulse's `run_square` only advances its 16-step phase
while `volume && !gate && period > 4`, which is false whenever the channel is
disabled (volume forced to 0 there) or in "always on" mode (`gate` true), so
the phase holds wherever it stopped and resumes from there on re-enable -
where nesdev's own text ("it will resume from the beginning when E is once
again set") and this core both reset to step 15 on every disable-to-enable
edge. The sawtooth's `run_saw` is stronger still: while disabled it takes a
branch that never touches the accumulator or advances its own divider at
all, where nesdev's text says plainly "the accumulator is forced to zero"
and "clearing E does not reset the frequency divider" - both of which this
core does, literally, following the wiki page over the oracle (decision 41).
None of this is a documented hardware reset value either side claims to know;
it is one 2005-era emulator's own implementation, which predates the wiki
page this core is written from. That is why `status-data.mjs`'s own board
reads the per-run, shift-tolerant fraction - 79.0 % of 105 runs align
edge-for-edge once each run gets its own constant shift - rather than this
raw number, the same way the 2A03 sheet's own triangle is trusted despite a
0 % raw match in some of its own logs.

`script-saw-worked-example` never disables at all, yet its single run still
sits at a constant one-cycle shift for its whole length - a clocking-order
convention (which side's write takes effect on the cycle it lands on)
distinct from the disable behaviour above, and the smallest, most mechanical
divergence measured here. `script-pulse-periods`' own worst run (a many-
thousand-cycle shift the search could not resolve) is consistent with a
second GME shortcut read from the same source: `run_square`'s phase-advance
loop is skipped whenever the reloaded period is 4 cycles or less, which is
exactly this script's period-0 and period-1 cases - the oracle stops toggling
near the Nyquist rate where the real chip, and this core, keep going; this is
read from the source, not independently re-verified edge by edge. `$9003`
(the frequency-scaling/halt register) is written by every script here but the
oracle's own address decode (`reg_count = 3`) drops it before its dispatch
ever sees it, so it contributes no comparable signal either way. All of this
is written up, with the source lines, in
[the oracle's own README](../../packages/conform/oracles/game-music-emu/README.md);
see "Known deviations" below for what it costs this sheet.

Mesen 2 independently confirms all three of Game_Music_Emu's own gaps read
above from its source rather than re-measured: `Vrc6Pulse::Clock` has no
period-4-or-under guard, `Vrc6Saw::WriteReg`'s disable path zeroes the
accumulator exactly as nesdev and this core do, and nothing in its own
register dispatch drops `$9003`, which is why `edge` and `core` both gate at
100 % against it (`oracles/mesen-vrc6.mjs`'s own comment has the source
lines). The two oracles also settle on two different, unrelated
cycle-offset conventions once corrected for: Game_Music_Emu's sawtooth edges
land `period + 1` cycles later than chipvoice's own, tracking whichever
period was active at that edge's own cycle (`saw-worked-example` and
`saw-rates` each pad their own tail, `tailPad: 5` and `tailPad: 25`, to keep
that later edge from being clipped by the script's own cutoff); Mesen 2's
whole trace, pulses and sawtooth alike, sits at one flat, register-independent
cycle earlier (`CYCLE_OFFSET = -1`), confirmed on a pulse-only log with no
sawtooth activity at all. Neither is a hardware claim: both are that specific
driver's own catch-up-then-write timing, read and corrected for once each,
not re-derived per script.

### The pulse mapping

Round 3 read both counters directly rather than treat the pulse's flat-corpus
mismatch against Mesen 2 as a shift question. Mesen's `Vrc6Pulse::_step`
(`Vrc6Pulse.h`) counts up, 0 to 15, wrapping (`(_step + 1) & 0x0F`); frozen
while disabled; reset to 0 on disable (`WriteReg`'s `case 2`); output
`_step <= _dutyCycle`. This core's own `step` (`vrc6.ts`) counts down, 15 to
0, wrapping; also frozen while disabled; reset to 15 on the 0-to-1 edge of
`enabled`; output `step <= duty`. Call Mesen's counter s and this core's s'.
From every enable edge onward both freeze on exactly the same cycles and both
step exactly once per divider firing, in opposite directions, and both are
re-anchored at that same edge - s to 0, s' to 15 - on every subsequent
disable/re-enable, so s' = 15 - s holds for any sequence of period, duty or
enable writes after the first edge, not just for a run with a fixed duty.
Substituting into this core's own condition, `s' <= dutyCycle`, gives
`15 - s <= dutyCycle`, i.e. `s >= 15 - dutyCycle` - Mesen's own `_step`
compared the other way. That one line, changed in `Vrc6Pulse::GetVolume()`
with the derivation above quoted in a comment there, is exact: every voice on
every cycle of all four flat-corpus scripts that disable and re-enable a
pulse but not the sawtooth (`script-duty`, `script-pulse-both`,
`script-pulse-enable`, `script-pulse-periods`, "Flat corpus, pulse scripts
against Mesen 2" above), and `core`/`edge` are unaffected (still 100 %): every
script there already held duty and period fixed across an enable span, where
the mapped and the original condition agree.

A single constant time shift cannot express this mapping, which is why
`compare.mjs`'s own shift search (used for the sawtooth, above) never closed
it: the counter's direction decides which edge of the duty window is anchored
to the divider's own wrap - an up-counter anchors the rising edge there, a
down-counter the falling edge - so shifting a whole trace in time moves both
edges of the duty window together, where only one needs to move. The mapping
above moves the right one, because it comes from the counters' own reset
invariant, not from fitting one trace to another.

Game_Music_Emu's own pulse (`gme/Nes_Vrc6_Apu.cpp`) also counts up - `phase`
increments, wraps at 16, and the channel reads high while `phase < duty + 1`,
the same comparison in the same direction as Mesen's original, unmapped
condition. Measured directly, oracle against oracle rather than either
against this core, on the three flat scripts that disable and re-enable a
pulse without ever touching a period at or below 4 (where Game_Music_Emu's
own gap, above, drops out of the comparison): `script-duty` 92.8250 %
identical (first divergence cycle 18472, Game_Music_Emu 225, Mesen 0, unmapped
Mesen build), `script-pulse-both` 32.4362 % (cycle 17979, Game_Music_Emu 90,
Mesen 240), `script-pulse-periods` 49.1166 % (cycle 17902, Game_Music_Emu 180,
Mesen 0). Both emulators do count up, and this core deliberately follows
nesdev's text instead - "takes 16 steps, counting down from 15 to 0. When the
current step is less than or equal to the given duty cycle D, the channel
volume V is output, otherwise 0," quoted in full in `vrc6.ts`'s own
`Vrc6Pulse` doc comment - but counting the same direction is not the same as
agreeing with each other: the two oracles still diverge from each other on
most of these cycles, because Mesen resets `_step` to a fixed value (0) on
every disable, where Game_Music_Emu's own `phase` (`gme/Nes_Vrc6_Apu.h`) is
set once in `reset()` and never again by any register write or disable/
re-enable - it freezes wherever the phase-advance loop left it and resumes
from there, with no anchor for a mapping to substitute. That is also why the
mapping above does not transfer to Game_Music_Emu: the s' = 15 - s identity
depends on both sides re-anchoring at the same edge, and Game_Music_Emu's
side never re-anchors at all, so its phase after any disable is a function of
that disable's own length, not a constant a single algebraic substitution can
absorb. The audible difference the mapping settles, in both oracles, is never
duty width or period - both are already correct in every corpus script's
`edges`/`shift`/`runs` numbers above - only which edge of the duty window
stays anchored across a mid-note duty change, the "always on" mode's mid-note
polarity, and, against Game_Music_Emu specifically, the absolute phase after
any disable.

### The sawtooth's divider across a disable

The four flat-corpus scripts still on the no-regression baseline against
Mesen 2 all disable and re-enable the sawtooth, and all diverge for the same,
single, sourced reason: Mesen's `Vrc6Saw::Clock()` (`Vrc6Saw.h`) gates its
entire body - the frequency-divider timer as well as the step and the
accumulator - behind `if(_enabled)`, so the divider stops counting the moment
E clears and resumes from wherever it stopped the moment E sets again. This
core's own `Vrc6Saw.clockDivider()` (`vrc6.ts`) is called unconditionally
every cycle regardless of `enabled`, following nesdev's text literally:
"clearing E does not reset the frequency divider, however" is read as "never
pauses," not "pauses but keeps its count." `edge/saw-enable.log` (the exact
gate above) sidesteps this by construction - every disabled span there is an
exact multiple of the saw's own full divider period, so a paused-then-resumed
divider and a continuously-ticking one reach the same next firing either way
- and `oracles/mesen/README.md`'s own VRC6 section already says so. The flat
corpus was not built with that constraint, so it exposes the difference:
- `script-saw-enable`: 99.2116 % identical, first divergence cycle 30426. The
  third disable/re-enable in the script leaves Mesen's divider frozen at 11
  from the disable at cycle 24368 through the re-enable at cycle 30421; this
  core's own divider keeps counting down through the same span and reaches 0
  several cycles sooner, firing at 30426 where Mesen, resuming from 11, fires
  later.
- `script-saw-rates`: 90.8676 % identical, first divergence cycle 29799, the
  same mechanism at a different rate.
- `script-all-three`: 73.4395 % identical (up from 15.99 % before the pulse
  mapping - the pulse portion is now exact, see above), first divergence
  cycle 757716, eleven cycles after a saw re-enable at cycle 757705
  (`$B002 = $80` in the log) - the same freeze-then-resume mechanism, not a
  new one.
- `script-saw-worked-example`: 99.9972 % identical, first divergence at cycle
  35897 - the log's own next-to-last cycle (`# cycles: 35898`), with no
  cycles afterward for a real edge to land inside the compared window. This
  script never disables the sawtooth at all, and its own `edges` count
  (8999/9000 exact, one unmatched) shows every edge but the very last landing
  on the same cycle in both traces: a boundary artifact of the fixed cycle
  count, not the disable mechanism above, and unrelated to the two other
  scripts' cause.

None of this is a documented hardware reset value either side claims to know;
like the pulse's own reset-to-0-versus-reset-to-15 difference above, it is
each emulator's own implementation choice, read from its source rather than
guessed at.

## Test ROMs

No automatable VRC6 test ROM was found. `bbbradsmith/nes-audio-tests`
publishes `db_vrc6.nes` (CC0), which plays each VRC6 waveform in turn for a
listener to judge by ear against a real cartridge or a known-good emulator; it
prints nothing machine-readable and drives no debug-cartridge convention (no
`$6000`-class pass/fail byte, no border-colour or halt-on-done signal this
harness's 6502 fixtures already read for the 2A03 and the SID), so it cannot
be wired into `roms:vrc6` the way `roms:c64` or `roms:dmg` are. It is
vendored nowhere in this repository; running it is a manual, occasional check
outside CI, not part of this sheet's numbers.

| ROM | Result | Notes |
| --- | --- | --- |
| `db_vrc6` (`bbbradsmith/nes-audio-tests`, CC0) | not run | listening-only; no machine-readable verdict to automate |

## Formula tests

`packages/chipvoice/test/vrc6.mjs`, run on every push.

| Test | Result |
| --- | --- |
| A pulse's duty register D gives (D+1)/16 of the cycle "on" for D = 0-7; the mode bit holds a constant volume with no duty transitions at all | pass |
| The pulse divider fires every `t + 1` cycles; `$9003`'s 16x and 256x flags rescale that to a 4-bit and an 8-bit right shift, the second overriding the first | pass |
| Disabling a pulse forces its output to 0; re-enabling resets its duty step to 15 (nesdev's "beginning"), silent for any duty below 15, with its timer frozen exactly where disabling left it, not free-running | pass |
| The sawtooth's A = $08 worked example reproduces nesdev's own sequence 1,2,3,4,5,6,0; a rate above 42 overflows into a non-monotonic ramp; a full period is 14 * (t + 1) cycles at t = 0 | pass |
| Clearing the sawtooth's E bit forces its accumulator to zero (nesdev's explicit text) | pass |
| `$9003`'s halt bit stops a divider from ever firing; clearing it lets the oscillator resume | pass |
| A corrupted sawtooth-rate write changes the trace - a cheap proof the parity gate this unlocks has something to catch | pass |
| `NES_VRC6` lists the 2A03's five voices plus the VRC6's three; the combined chip is reachable through `chips()`, `getChip`, `chipFor`, but absent from the studio's `CHIP_IDS` (decision 38) | pass |
| `isVrc6Addr` recognises exactly the ten registers `$9000`-`$9003`, `$A000`-`$A002`, `$B000`-`$B002` and nothing outside them | pass |
| The combined digital chip (`Vrc6NesDigital`) reports changes on both the 2A03's voices and the VRC6's from one schedule | pass |
| `Vrc6MixStage` matches the plain 2A03's `NesOutputStage` DAC and filter math exactly when the VRC6 side is silent; `Vrc6NesCore` renders finite, bounded, non-silent audio with both sides driven | pass |

## Analog stage

| | |
| --- | --- |
| Reference unit | none yet |
| Capture | none |
| Tolerance | |
| Maximum band error | unmeasured |
| Corners measured | none |
| Resampling | shared with the 2A03's own stage, once mixed |

Unmeasured. `Vrc6MixStage` (`packages/chipvoice/src/chips/nes/vrc6-core.ts`)
adds the three VRC6 voices to the 2A03's own five before the shared DAC and
filter math the 2A03 sheet already describes, at a mix gain
(`VRC6_MIX_UNIT_GAIN`) documented as a formula, not fitted to any measurement.
Nesdev's own text calls the VRC6's pulses "roughly equivalent to the pulse
channels of the 2A03 (except inverted)" - a statement about sign, not just
magnitude - and round 2 modelled that inversion, not just cited it:
`Vrc6MixStage.add()` subtracts the scaled VRC6 term from the composite sum
instead of adding it, so a VRC6 pulse at maximum volume pulls the mix the
opposite way a 2A03 pulse at the same nominal level would. The formula test
above proves the combined stage is bit-identical to the plain 2A03's when the
VRC6 side contributes silence, which shows the addition introduces no
regression to the already-partially-measured 2A03 mixer - it does not show
the combined, all-eight-voices-active output matches a real VRC6 cartridge's
own line-out, which no capture here attempts. A real cartridge's own capture
is the only thing that would close this, the same P7-8-shaped gap the 2A03
and the SID both still have.

## Driver coverage

None. Decision 38 keeps VRC6 out of the studio picker and the arranger for
this ticket: "a sheet before a chip" reaches the public picker only once its
sheet is filled, and NEXT-14's own scope is the chip, the harness, NSF and
this sheet, not a driver. The combined chip is registered as `"2a03-vrc6"`
(`NES_VRC6` in `vrc6-core.ts`), fully reachable from code that does not go
through the studio - `chips()`, `getChip("2a03-vrc6")`, `chipFor("2a03-vrc6")`
and `Chip.create({ chip: "2a03-vrc6" })` all see it - but it is deliberately
absent from `CHIP_IDS` (`project-schema.ts`), so no project, picker or
arranger word can select it. A driver and an arranger role for
`vp1`/`vp2`/`vsaw` are open work, tracked in [BACKLOG.md](../BACKLOG.md).

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| vp1, vp2, vsaw | the harness corpus and NSF export/playback (see below) | every arranger role: lead, bass, chord, drums; nothing a shipped song can reach yet |

## NSF export and playback

`exportNsf` (`packages/chipvoice/src/nsf.ts`) routes a capture's VRC6 register
writes (`isVrc6Addr`, the same ten addresses the core and the harness use)
into the exported ROM the same way it routes the 2A03's, and sets the
expansion-audio header byte's bit 0 when any of them appear, so a player that
reads that bit (Famitracker's, `foobar2000`'s, most others) knows to enable
its own VRC6 expansion audio before playback. The player code itself no
longer stores a fixed offset from `$4000`: a two-register-page store
(`STA $4000,Y`) cannot reach VRC6's three separate pages
(`$9000`-`$9003`/`$A000`-`$A002`/`$B000`-`$B002`), so every write - 2A03 or
VRC6 alike - is now dispatched through an index into an in-ROM table of
whichever registers the capture actually uses, resolved with an indirect
store (`LDA table,Y` into a zero-page pointer, then `STA (zp),Y`). This
applies uniformly, so a 2A03-only file's own output changes bytes without
changing behaviour: proven unaffected by the existing CI-gated
`nsf-export:check`/`nsf-corpus:check` oracle suites (all real-world 2A03
sources, exact-match on both the command stream and frame writes, unchanged).
`capture-nsf.mjs` (the offline 6502 this harness plays an exported NSF back
on) accepts a file with the VRC6 bit set and routes writes to its ten
registers as events the same way it already does for the 2A03's; a
self-authored round-trip proves this end to end in
`packages/chipvoice/test/nsf.mjs` (mixed 2A03/VRC6 writes exported, then
replayed and matched frame-for-frame against the original capture, the same
gate 2A03-only files are held to). No third-party VRC6 NSF this project found
carries a licence [`scores/nsf-corpus`](../../scores/nsf-corpus)'s own
convention requires (CC0, CC-BY, public domain, or similarly permissive, with
a source URL next to it), so round 2 added a self-authored one instead,
`vrc6-probe` (CC0, `make-vrc6-probe.mjs`, the same fixture-of-last-resort
convention `scores/psid-corpus/make-fixtures.mjs` already uses for two SID
probes): a small hand-assembled NSF that declares the VRC6 expansion bit and
writes all three oscillators every frame. It is played back by Game_Music_Emu's
own `Nsf_Emu` NSF player, not just the register-level `Nes_Vrc6_Apu` oracle
the rest of this sheet uses, which meant extending `native-oracle.py`'s patch
with a second, independent capture point in `gme/Nes_Vrc6_Apu.cpp` (`Nsf_Emu`
dispatches VRC6 writes there, not through `Nes_Apu.cpp`). The result closes
every gate `scores/nsf-corpus` and `scores/nsf-export` hold their other files
to: an exact command-stream match in `nsf-corpus` (2700/2700), and in
`nsf-export`, an exact command-stream match (2773/2773), an exact frame-write
match (301/301), and an export loss of 0.0 %, all against the same real NSF
player every 2A03 file in both corpora is measured against.

## Known deviations

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| A pulse's duty phase does not resume from step 15 on re-enable, and does not advance at all while disabled or in "always on" mode, against Game_Music_Emu | no, that oracle's, not this core's | this core follows nesdev's explicit text ("it will resume from the beginning when E is once again set"); Game_Music_Emu's `run_square` only advances the phase while `volume && !gate && period > 4`, and never resets `phase` on any register write or disable/re-enable (`gme/Nes_Vrc6_Apu.h`/`.cpp`), so it freezes and resumes wherever it stopped instead; Mesen 2's own `_step` does reset on every disable (to 0, not 15), so its own version of this row is mapped to an exact gate instead (`Vrc6Pulse.h`'s "chipvoice patch" comment; "The pulse mapping" above) | every corpus script that disables and re-enables a pulse, against Game_Music_Emu; measured as a per-run shift, not a raw match (see above); no longer affects Mesen 2 |
| Game_Music_Emu and Mesen 2 do not closely agree with each other on pulse duty phase either, despite both counting the duty step up where this core counts it down | no, each oracle's own choice, not this core's | both count up (nesdev's text describes counting down, which this core follows literally), but only Mesen re-anchors its counter on every disable; Game_Music_Emu's phase never resets, so the two independent oracles diverge from each other on most cycles of a script that disables and re-enables a pulse, measured directly oracle against oracle: `script-duty` 92.8250 %, `script-pulse-both` 32.4362 %, `script-pulse-periods` 49.1166 % identical (against an unmapped Mesen build; see "The pulse mapping" above) | explains why the mapping above closes the gap against Mesen 2 but cannot be extended to Game_Music_Emu; no effect on this core's own gates, which measure each oracle separately |
| The sawtooth's accumulator does not freeze on disable, and its divider does not stop, against Game_Music_Emu | no, that oracle's, not this core's | this core follows nesdev's text ("the accumulator is forced to zero"; "clearing E does not reset the frequency divider"); Game_Music_Emu's `run_saw` takes a branch while disabled that touches neither (`gme/Nes_Vrc6_Apu.cpp`) | every corpus script that disables and re-enables the sawtooth, against Game_Music_Emu |
| Mesen 2's sawtooth frequency divider pauses entirely while disabled and resumes from wherever it stopped, rather than continuing to tick | no, that emulator's own choice | this core ticks the divider unconditionally every cycle, per nesdev's text ("clearing E does not reset the frequency divider, however"); Mesen 2's `Vrc6Saw::Clock()` gates its whole body, divider included, behind `if(_enabled)` (`Vrc6Saw.h`) | `script-saw-enable`, `script-saw-rates`, `script-all-three` against Mesen 2 ("The sawtooth's divider across a disable" above); not exercised by `edge/saw-enable.log`, whose disabled spans are exact multiples of the saw's own full divider period, so both conventions land on the same next firing there |
| A pulse whose reloaded period is 4 cycles or less never toggles in the oracle | no, a gap in the oracle | Game_Music_Emu's `run_square` only runs its phase-advance loop when `period > 4`; this core keeps advancing at any period | `script-pulse-periods`' own period-0 and period-1 runs |
| `$9003` (frequency scaling / halt) is implemented from the documents but not cross-checked against Game_Music_Emu | no, a gap in that oracle, not the core | Game_Music_Emu's own address decode (`reg_count = 3`) drops any write to it before the oracle ever sees it; Mesen 2 does not drop it, so `core`/`edge` against Mesen 2 do exercise it | confidence in the halt bit and the scaling divisor against Game_Music_Emu rests on the documents alone, not on independent measurement |
| Game_Music_Emu's sawtooth edges are reported `period + 1` cycles later than chipvoice's own, tracking whichever period was active at that edge's cycle | no, that oracle's own phase convention | `Nes_Vrc6_Apu`'s `phase` runs exactly one firing ahead of chipvoice's `subPhase`, read from `gme/Nes_Vrc6_Apu.cpp` and confirmed on `saw-rates` across three period changes | corrected for in `oracles/game-music-emu.mjs`'s `trace()`; scripts that end on the sawtooth pad their own tail (`tailPad`) to the correct parity so the corrected last edge is not clipped by the script's own cutoff |
| Mesen 2's whole trace sits at one flat, register-independent cycle earlier than chipvoice's own | no, that driver's own catch-up-then-write timing | confirmed on `core/pulse-levels` (both pulses, mode on, no sawtooth activity): every edge aligns at the same shift, not some other value or none | corrected once, unconditionally, as `CYCLE_OFFSET = -1` in `oracles/mesen-vrc6.mjs` |
| The three voices' combined mix gain (`VRC6_MIX_UNIT_GAIN`) is a documented formula, not fitted to a measurement | yes, pending a capture | no real VRC6 cartridge line-out has been captured (see "Analog stage") | the analog stage's accuracy when the VRC6 side is not silent |

## Power-on state

`reset()` sets every VRC6 register to zero: both pulses and the sawtooth
disabled and silent, `$9003`'s halt and scaling bits clear. This is an
inferred convention (VRC6 hardware and Game_Music_Emu's own emulation both
leave the equivalent internal state at zero after any real console's own
power-on/reset sequence clears cartridge RAM and a driver writes every
register once before its first note), not a documented power-on default the
VRC6's own datasheet states - Konami's own documents describe the registers'
behaviour once written, not their reset value.

## History

- 2026-09-28 (NEXT-14, round 3, PR #111): the pulse duty generator's
  counting-direction mismatch against Mesen 2 resolved to an exact gate, not
  a no-regression baseline, through an algebraic mapping between the two
  counters (`Vrc6Pulse.h`'s own "chipvoice patch" comment; `check:vrc6-flat-
  mesen`) rather than a per-run time shift; the flat corpus's remaining
  four sawtooth-touching scripts' divergence against Mesen 2 traced to its
  own divider pausing while disabled, and one of the four
  (`script-saw-worked-example`) confirmed to be a boundary-clipping artifact
  of its own fixed cycle count, not a genuine behavioural difference;
  Game_Music_Emu and Mesen 2 measured directly against each other and found
  not to closely agree on pulse duty phase despite both counting up, which is
  why the mapping does not transfer to Game_Music_Emu.
- 2026-09-28 (NEXT-14, round 2, PR #111): Mesen 2 added as a second,
  independent oracle; the corpus split into `core` and `edge` with exact
  gates against both oracles (Game_Music_Emu report-only on `edge`); the
  documented pulse-polarity inversion modelled, not just cited, in
  `Vrc6MixStage.add()`; a negative test per exact gate; a self-authored VRC6
  NSF probe added to `scores/nsf-corpus`/`scores/nsf-export`, played back by
  Game_Music_Emu's own `Nsf_Emu` player.
- 2026-09-28 (NEXT-14): the core, the harness and NSF export/playback added
  in one PR. No earlier history: this is VRC6's first sheet.

## Sources

- [NESdev Wiki: VRC6 audio](https://www.nesdev.org/wiki/VRC6_audio) - register
  layout, the duty table, the sawtooth's double-speed accumulator, `$9003`'s
  halt and frequency-scaling bits.
- [NESdev Wiki: VRC6](https://www.nesdev.org/wiki/VRC6) - the mapper's own
  register addressing, including the A0/A1 line-swap some Konami boards wire
  differently (out of scope here: this sheet covers the audio registers
  only, which every known board addresses the same way).
- Game_Music_Emu's `Nes_Vrc6_Apu` (`Nes_Vrc6_Apu.h`/`.cpp`, pinned revision
  `fe8da4b6d3876d7542c2fb69d94487e19836d678`), read to know what to measure
  and run as the harness's oracle, never ported (decision 41).
- Mesen 2's own VRC6 audio (`Vrc6Audio.h`/`Vrc6Pulse.h`/`Vrc6Saw.h`, pinned
  revision `b9fa69ddc6d0a331fb103fdb5eef6904305703c2`, the same commit
  already pinned for the plain 2A03 oracle), the second, independent oracle
  round 2 added, read and run the same way, never ported.

---

**Done** means: digital parity 100 % on the full corpus; every ROM above passes;
the analog stage within tolerance of the named unit; only deliberate deviations,
each with a reason; the golden hash recorded and the formula tests green in CI.
