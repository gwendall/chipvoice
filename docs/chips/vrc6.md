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
| **Status** | **in progress**: measured against Game_Music_Emu's `Nes_Vrc6_Apu` on eight scripts, every one built around several enable/disable cycles; the oracle freezes state across a disable where the documents (and this core) reset or zero it, which floors the raw cycle-for-cycle match at 35.7 % while the per-run, shift-tolerant match the board reads is 79.0 % of 105 runs; NSF export/playback route the chip; no driver reaches it yet |
| **Core** | written from the nesdev wiki and Konami's own VRC6 documents: the standalone digital chip in `packages/chipvoice/src/chips/nes/vrc6.ts`, the combined `2a03-vrc6` cartridge chip and its mixing stage in `vrc6-core.ts` |
| **Licence of the core** | MIT, like the rest of the package. Game_Music_Emu's `Nes_Vrc6_Apu`, the oracle, is LGPL and lives in the harness only: decision 41 |
| **Sheet updated** | 2026-09-28, by hand and by `conform` |

## Digital parity

Measured by [`conform`](../../packages/conform), the harness, against
[Game_Music_Emu](../../packages/conform/oracles/game-music-emu)'s
`Nes_Vrc6_Apu`, on the chip's three voices, over eight scripts in
[`packages/conform/corpus/vrc6`](../../packages/conform/corpus/vrc6). The
numbers between the markers are written by the harness (`pnpm --filter
chipvoice-conform baseline:vrc6`); the reading of them below is a person's. CI
reruns the corpus and fails if any voice's identical count falls below the
committed baseline.

<!-- parity:begin -->
Written by `conform` on 2026-09-27, against Game_Music_Emu (Nes_Vrc6_Apu), on vp1, vp2, vsaw.

| | |
| --- | --- |
| Oracle | Game_Music_Emu (Nes_Vrc6_Apu) |
| Corpus | 8 logs, 6339623 cycles |
| Identical cycles | 2265932 / 6339623 (35.7424 %) |
| Logs with a divergence | 8 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| script-all-three | 9.1195 % | cycle 17898, vp2: ours 0, oracle 9 | vp1 60.9123 %, 0/0/5250; runs 3: 1 on times, 1 on values, shift <= 91; vp2 51.3302 %, 0/0/6940; runs 3: 0 on times, 0 on values, shift <= 0; vsaw 21.8408 %, 0/0/55581 (1 at +15); runs 3: 3 on times, 1 on values, shift <= 81 |
| script-duty | 74.8876 % | cycle 37551, vp1: ours 15, oracle 0 | vp1 74.8876 %, 40/0/572; runs 8: 2 on times, 2 on values, shift <= 41; vp2 100.0000 %, 0/0/0; vsaw 100.0000 %, 0/0/0 |
| script-pulse-both | 52.6977 % | cycle 17898, vp1: ours 0, oracle 10 | vp1 80.0625 %, 0/0/8518; runs 3: 2 on times, 2 on values, shift <= 117; vp2 62.5967 %, 0/0/3608; runs 3: 1 on times, 1 on values, shift <= 23; vsaw 100.0000 %, 0/0/0 |
| script-pulse-enable | 98.3029 % | cycle 17898, vp1: ours 0, oracle 15 | vp1 98.3029 %, 0/0/28 (2 at -13); runs 6: 4 on times, 4 on values, shift <= 181; vp2 100.0000 %, 0/0/0; vsaw 100.0000 %, 0/0/0 |
| script-pulse-periods | 41.5736 % | cycle 17898, vp2: ours 0, oracle 12 | vp1 100.0000 %, 0/0/0; vp2 41.5736 %, 2/1/1412; runs 65: 59 on times, 59 on values, shift <= 94309; vsaw 100.0000 %, 0/0/0 |
| script-saw-enable | 29.4799 % | cycle 17914, vsaw: ours 1, oracle 0 | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 29.4799 %, 0/0/81 (7 at -16); runs 5: 5 on times, 1 on values, shift <= 32 |
| script-saw-rates | 44.7904 % | cycle 29805, vsaw: ours 1, oracle 0 | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 44.7904 %, 0/0/1404 (139 at -15); runs 5: 5 on times, 1 on values, shift <= 39 |
| script-saw-worked-example | 74.9290 % | cycle 17899, vsaw: ours 1, oracle 0 | vp1 100.0000 %, 0/0/0; vp2 100.0000 %, 0/0/0; vsaw 74.9290 %, 0/8999/1 (8999 at -1); runs 1: 1 on times, 1 on values, shift <= 1 |
<!-- parity:end -->

**What the numbers say.** The raw headline (35.7 %) undercounts this chip
specifically: the corpus deliberately drives every voice through several
enable/disable cycles (`generate-vrc6.mjs`'s own comment says why), and
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
The formula test above proves the combined stage is bit-identical to the
plain 2A03's when the VRC6 side contributes silence, which shows the addition
introduces no regression to the already-partially-measured 2A03 mixer - it
does not show the combined, all-eight-voices-active output matches a real
VRC6 cartridge's own line-out, which no capture here attempts. A real
cartridge's own capture is the only thing that would close this, the same
P7-8-shaped gap the 2A03 and the SID both still have.

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
gate 2A03-only files are held to). No third-party VRC6 NSF was added to
[`scores/nsf-corpus`](../../scores/nsf-corpus): no VRC6 file this project
found carries a licence that corpus's own convention requires (CC0, CC-BY,
public domain, or similarly permissive, with a source URL next to it).

## Known deviations

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| A pulse's duty phase does not resume from step 15 on re-enable, and does not advance at all while disabled or in "always on" mode | no, the oracle's, not this core's | this core follows nesdev's explicit text ("it will resume from the beginning when E is once again set"); Game_Music_Emu's `run_square` only advances the phase while `volume && !gate && period > 4`, so it freezes and resumes wherever it stopped instead (`gme/Nes_Vrc6_Apu.cpp`) | every corpus script that disables and re-enables a pulse; measured as a per-run shift, not a raw match (see above) |
| The sawtooth's accumulator does not freeze on disable, and its divider does not stop | no, the oracle's, not this core's | this core follows nesdev's text ("the accumulator is forced to zero"; "clearing E does not reset the frequency divider"); Game_Music_Emu's `run_saw` takes a branch while disabled that touches neither (`gme/Nes_Vrc6_Apu.cpp`) | every corpus script that disables and re-enables the sawtooth |
| A pulse whose reloaded period is 4 cycles or less never toggles in the oracle | no, a gap in the oracle | Game_Music_Emu's `run_square` only runs its phase-advance loop when `period > 4`; this core keeps advancing at any period | `script-pulse-periods`' own period-0 and period-1 runs |
| `$9003` (frequency scaling / halt) is implemented from the documents but not cross-checked against the oracle | no, a gap in the oracle, not the core | Game_Music_Emu's own address decode (`reg_count = 3`) drops any write to it before the oracle ever sees it | confidence in the halt bit and the scaling divisor rests on the documents alone, not on independent measurement |
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

---

**Done** means: digital parity 100 % on the full corpus; every ROM above passes;
the analog stage within tolerance of the named unit; only deliberate deviations,
each with a reason; the golden hash recorded and the formula tests green in CI.
