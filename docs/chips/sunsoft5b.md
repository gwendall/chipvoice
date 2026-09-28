# AY-3-8910 / YM2149 (`ay8910`), first hosted as the Sunsoft 5B (`2a03-sunsoft5b`)

<p align="center">
  <a href="sunsoft5b.md">English</a> &bull;
  <a href="sunsoft5b_ja.md">日本語</a>
</p>


NEXT-15's chip: General Instrument's AY-3-8910 and Yamaha's YM2149F, one
standalone, host-agnostic core (`Ay8910`,
[`packages/chipvoice/src/chips/ay8910.ts`](../../packages/chipvoice/src/chips/ay8910.ts)) -
three tone generators, a shared 17-bit noise LFSR and a shared 16-shape
envelope generator, mixed through a per-channel AND gate - first hosted as
the Sunsoft 5B, the FME-7 mapper's own YM2149F wired behind two NES CPU
ports. Decision 38 keeps this out of the studio picker and the arranger for
this ticket: a chip, its harness, NSF export/playback and this sheet, not a
driver. The method behind every section is in
[CONFORMANCE.md](../CONFORMANCE.md).

| | |
| --- | --- |
| **Machine** | NES, Famicom (Sunsoft 5B mapper - nesdev: "this audio hardware was only used in one game," Gimmick!) |
| **Status** | **in progress**: measured against two independent oracles, Peter Sovietov's Ayumi and Game_Music_Emu's `Ay_Apu`, neither ported (decision 41). `core` (DAC-mode-only, both generators bypassed on every channel) gates at a literal 100 % against both. `edge` (tone, noise and the envelope actually running) gates exactly against Ayumi wherever it has no known disagreement (tone, mixer/gate, fixed volume, the envelope), and is report-only against Ayumi and against Game_Music_Emu wherever the corpus exercises the noise generator (decision 47: a genuine, independently-corroborated disagreement between the two oracles' own 17-bit LFSR construction) or either oracle's own documented timing quirks. No driver or arranger reaches it yet |
| **Core** | written from nesdev's "Sunsoft 5B audio" page and General Instrument's AY-3-8910/8912/8913 datasheet: the standalone digital chip in `packages/chipvoice/src/chips/ay8910.ts`, the Sunsoft 5B's two-port shim in `chips/nes/sunsoft5b.ts`, the combined `2a03-sunsoft5b` cartridge chip and its mixing stage in `chips/nes/sunsoft5b-core.ts` |
| **Licence of the core** | MIT, like the rest of the package. Both oracles live in the harness only, never ported (decision 41): Ayumi is MIT; Game_Music_Emu's `Ay_Apu` is LGPL, the same vendored tree the VRC6 and 2A03 sheets already use |
| **Sheet updated** | 2026-09-28, by hand and by `conform` |

## Digital parity

Measured by [`conform`](../../packages/conform), the harness, against two
independent oracles: [Ayumi](../../packages/conform/oracles/ayumi) and
[Game_Music_Emu](../../packages/conform/oracles/game-music-emu)'s `Ay_Apu`.
`generate-ay8910.mjs`'s own comment explains the split, drawn on a stricter
line than VRC6's own:

- **`core`** ([`packages/conform/corpus/ay8910/core`](../../packages/conform/corpus/ay8910/core)):
  every channel's mixer bits set both tone and noise disabled on every
  script - DAC mode, where `Ay8910.outputs`'s own gate formula forces
  `gate = 1` unconditionally, so a channel's output is its volume register
  alone, sampled once a prescaled tick. Held to a literal 100 % against
  **both** oracles with no settling and no constant offset - this is the
  region with no known disagreement of any kind.
- **`edge`** ([`packages/conform/corpus/ay8910/edge`](../../packages/conform/corpus/ay8910/edge)):
  tone, noise and the envelope actually running. Gated exactly against Ayumi
  on the four scripts with no known disagreement (tone sweeps, envelope
  periods and shapes, envelope-and-tone together); `--report` only against
  Ayumi on the three that exercise the noise generator
  (`noise-sweep`, `tone-noise-mixed`, `gate-toggle`), and `--report` only
  against Game_Music_Emu on every `edge` script, since that oracle's own
  tone/noise timing carries a phase delta forward from its own reset default
  rather than restarting cleanly at a write (see "Known deviations" below).

The numbers between each pair of markers are written by the harness (`pnpm
--filter chipvoice-conform baseline:ay8910-*`, one script per table below);
the reading of them is a person's. CI reruns every corpus and fails if a
`core` or exact-gated `edge` script's identical count is anything but exact.
[`packages/conform/test/ay8910-gate.mjs`](../../packages/conform/test/ay8910-gate.mjs)
(part of `test:unit`, so it runs on every push) proves each exact gate would
actually catch a regression rather than passing only because nothing in the
corpus happens to exercise the path a bug would break: it runs the same
`chip.trace()`/`oracle.trace()`/`compare()` each gate script is built from,
once on a corpus log's own writes (must not diverge) and once against a copy
with one write's low nibble flipped (must diverge), for `check:ay8910-core`,
`check:ay8910-core-gme` and `check:ay8910-edge` each.

### Core scripts, against Ayumi (exact gate)

<!-- core-ayumi:begin -->
Written by `conform` on 2026-09-28, against Ayumi, on a, b, c.

| | |
| --- | --- |
| Oracle | Ayumi |
| Corpus | 5 logs, 104913 cycles |
| Identical cycles | 104913 / 104913 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| all-three-independent | 100.0000 % | none | a 100.0000 %, 9/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 7/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 10/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| channel-a | 100.0000 % | none | a 100.0000 %, 21/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| channel-b | 100.0000 % | none | a 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 21/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| channel-c | 100.0000 % | none | a 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 21/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| mixer-upper-bits | 100.0000 % | none | a 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- core-ayumi:end -->

### Core scripts, against Game_Music_Emu (exact gate)

<!-- core-game-music-emu-ay:begin -->
Written by `conform` on 2026-09-28, against Game_Music_Emu (Ay_Apu), on a, b, c.

| | |
| --- | --- |
| Oracle | Game_Music_Emu (Ay_Apu) |
| Corpus | 5 logs, 104913 cycles |
| Identical cycles | 104913 / 104913 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| all-three-independent | 100.0000 % | none | a 100.0000 %, 8/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 7/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 10/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| channel-a | 100.0000 % | none | a 100.0000 %, 20/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| channel-b | 100.0000 % | none | a 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 20/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| channel-c | 100.0000 % | none | a 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 20/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| mixer-upper-bits | 100.0000 % | none | a 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- core-game-music-emu-ay:end -->

### Edge scripts, against Ayumi (exact gate on 4 of 7)

<!-- edge-ayumi:begin -->
Written by `conform` on 2026-09-28, against Ayumi, on a, b, c.

| | |
| --- | --- |
| Oracle | Ayumi |
| Corpus | 4 logs, 1493880 cycles |
| Identical cycles | 1493880 / 1493880 (100.0000 %) |
| Logs with a divergence | 0 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| envelope-and-tone | 100.0000 % | none | a 100.0000 %, 102/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| envelope-periods | 100.0000 % | none | a 100.0000 %, 353/0/0; runs 4: 4 on times, 4 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| envelope-shapes | 100.0000 % | none | a 100.0000 %, 682/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| tone-sweep | 100.0000 % | none | a 100.0000 %, 659/0/0; runs 49: 49 on times, 49 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- edge-ayumi:end -->

### Edge scripts, against Ayumi, full corpus (report only)

<!-- edge-ayumi-report:begin -->
Written by `conform` on 2026-09-28, against Ayumi, on a, b, c.

| | |
| --- | --- |
| Oracle | Ayumi |
| Corpus | 7 logs, 1893115 cycles |
| Identical cycles | 1797970 / 1893115 (94.9742 %) |
| Logs with a divergence | 3 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| envelope-and-tone | 100.0000 % | none | a 100.0000 %, 102/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| envelope-periods | 100.0000 % | none | a 100.0000 %, 353/0/0; runs 4: 4 on times, 4 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| envelope-shapes | 100.0000 % | none | a 100.0000 %, 682/0/0; runs 1: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| gate-toggle | 88.1126 % | cycle 71590, a: ours 0, oracle 27 | a 88.1126 %, 74/0/96; runs 2: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| noise-sweep | 53.7517 % | cycle 447, a: ours 31, oracle 0 | a 53.7517 %, 85/0/278; runs 2: 0 on times, 0 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| tone-noise-mixed | 77.3132 % | cycle 4607, a: ours 31, oracle 0 | a 77.3132 %, 150/0/518; runs 5: 2 on times, 2 on values, shift <= 5984; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
| tone-sweep | 100.0000 % | none | a 100.0000 %, 659/0/0; runs 49: 49 on times, 49 on values, shift <= 0; b 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0; c 100.0000 %, 1/0/0; runs 1: 1 on times, 1 on values, shift <= 0 |
<!-- edge-ayumi-report:end -->

### Edge scripts, against Game_Music_Emu, full corpus (report only)

<!-- edge-game-music-emu-ay-report:begin -->
Written by `conform` on 2026-09-28, against Game_Music_Emu (Ay_Apu), on a, b, c.

| | |
| --- | --- |
| Oracle | Game_Music_Emu (Ay_Apu) |
| Corpus | 7 logs, 1893115 cycles |
| Identical cycles | 1402887 / 1893115 (74.1047 %) |
| Logs with a divergence | 7 |

| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |
| --- | --- | --- | --- |
| envelope-and-tone | 53.3333 % | cycle 1264, a: ours 0, oracle 32 | a 53.3333 %, 0/0/58; b 100.0000 %, 0/0/0; c 100.0000 %, 0/0/0 |
| envelope-periods | 11.2215 % | cycle 32, a: ours 0, oracle 2 | a 11.2215 %, 0/0/170; b 100.0000 %, 0/0/0; c 100.0000 %, 0/0/0 |
| envelope-shapes | 49.6954 % | cycle 0, a: ours 0, oracle 255 | a 49.6954 %, 0/0/391; b 100.0000 %, 0/0/0; c 100.0000 %, 0/0/0 |
| gate-toggle | 84.3705 % | cycle 36464, a: ours 128, oracle 0 | a 84.3705 %, 1/0/216 (37 at +15); runs 2: 1 on times, 1 on values, shift <= 0; b 100.0000 %, 0/0/0; c 100.0000 %, 0/0/0 |
| noise-sweep | 49.1206 % | cycle 0, a: ours 255, oracle 0 | a 49.1206 %, 0/3/447 (3 at -1); runs 2: 0 on times, 0 on values, shift <= 0; b 100.0000 %, 0/0/0; c 100.0000 %, 0/0/0 |
| tone-noise-mixed | 76.9233 % | cycle 624, a: ours 0, oracle 255 | a 76.9233 %, 0/56/681 (56 at -1); runs 5: 0 on times, 0 on values, shift <= 0; b 100.0000 %, 0/0/0; c 100.0000 %, 0/0/0 |
| tone-sweep | 98.6995 % | cycle 0, a: ours 0, oracle 127 | a 98.6995 %, 0/0/758 (97 at +15); runs 49: 47 on times, 47 on values, shift <= 32015; b 100.0000 %, 0/0/0; c 100.0000 %, 0/0/0 |
<!-- edge-game-music-emu-ay-report:end -->

**Where the two oracles disagree, and why neither one wins outright.**
Decision 47 is the full record; in short: nesdev's own text for the noise
generator is "a 17-bit linear feedback shift register with taps at bits 16
and 13," and nothing more specific. Taken literally - the shifted-out bit
XORed directly into both tapped positions - that is a Galois-form
construction, which is what `Ay8910.tick()` implements, corroborated
independently by Game_Music_Emu's `Ay_Apu`
(`(uMinus(lfsr & 1) & 0x12000) ^ (lfsr >> 1)`), read from its source and
confirmed maximal-length (period 131071 = 2^17-1 from seed 1) before being
adopted here. Ayumi's own `update_noise` computes a different bit,
`bit0 ^ bit3`, inserted at bit 16 - a Fibonacci-form LFSR. An exhaustive
search (every insertion bit 13-16, every XOR tap 1-16, every output bit
0-16) found no relabelling of Ayumi's form that reproduces the Galois form's
own bit-0 sequence: the two are genuinely different 17-bit LFSRs, not two
descriptions of the same one, and this project's own review lesson - never
patch an oracle to adopt the core's behaviour and call it a convention
mapping - is exactly why no correction is baked into either oracle driver to
paper over this. Ayumi stays the trusted oracle for tone, the mixer/gate
logic, fixed volume and the envelope generator, where it has no known
disagreement and needs no settling; Game_Music_Emu's `Ay_Apu` independently
corroborates the noise LFSR's own construction (source-read, not measured
exact, since its own tone/noise timing has an unrelated quirk of its own -
next paragraph) and is the second oracle for the DAC-mode `core` corpus. The
two are trusted for different, non-overlapping features, not one simply
outranking the other everywhere.

Separately, Game_Music_Emu's `Ay_Apu` carries its own documented timing
quirk, unrelated to the LFSR disagreement: "changes to envelope and noise
periods are delayed until next reload" is the oracle's own listed
inaccuracy, and this project's own measurement confirms a tone-only sweep
settles to a constant **+15-cycle** offset and a noise-only sweep to a
constant **-1/+1-cycle** offset from a fresh reset, but not to any constant
offset once both interact or a period is rewritten mid-stream - exactly the
kind of settle-dependent correction the review lesson above rules out baking
into `oracles/game-music-emu-ay.mjs`'s `trace()`. Every `edge` script is
`--report` only against this oracle for that reason; only `core`
(DAC mode, where neither generator's timing is ever sampled) gates exact
against it.

## Test ROMs

No test ROM was found for this chip, the same conclusion the VRC6 sheet
reaches for its own chip: nothing publishing a machine-readable pass/fail
convention this harness's other 6502 fixtures already read (no `$6000`-class
status byte, no border-colour or halt-on-done signal) was found for the
Sunsoft 5B or the AY-3-8910/YM2149 generally.

| ROM | Result | Notes |
| --- | --- | --- |
| (none found) | not run | no machine-readable AY-3-8910/YM2149/Sunsoft 5B test ROM found |

## Formula tests

`packages/chipvoice/test/sunsoft5b.mjs`, run on every push.

| Test | Result |
| --- | --- |
| Voice order is `a`, `b`, `c`; a DAC-mode channel (tone and noise both disabled) outputs its raw fixed volume as `2V + 1` for every one of the 16 volume levels, never 0 | pass |
| A non-DAC, tone-driven channel with the volume register at 0 is silent throughout | pass |
| The mixer is a per-channel AND gate: a tone-only channel alternates between silent and its level on the tone bit; a tone-and-noise channel's gate matches the AND of the two independently-measured tone-only and noise-only gates | pass |
| The 17-bit noise LFSR has a maximal-length period of exactly 131071 (2^17-1) from seed 1, matching a standalone reference recurrence of the same Galois-form feedback | pass |
| Envelope shape 0 (`down, holdBottom`) ramps once from 31 to 0 and then holds at 0 for the rest of the run | pass |
| Envelope shape 8 (`down, down`, the "continue" sawtooth) repeats: multiple runs of both 31 and 0 appear across the sampled window | pass |
| Envelope shape 14 (`up, down`, the classic triangle) alternates: multiple runs of both 0 and 31 appear, starting from 0 | pass |
| A channel's volume register bit 4 switches it between a fixed level and the shared envelope generator's own output | pass |
| None of the three generators (tone, noise, envelope) ever halts while its channel is gate-disabled - only `outputs()` silences the result, not the counters | pass |
| A corrupted tone-period write changes the trace - a cheap proof the parity gate this unlocks has something to catch | pass |
| `Sunsoft5bAudio`'s $C000/$E000 ports round-trip a register write; a nonzero high nibble on a $C000 write latches the data port disabled until the next $C000 write clears it (nesdev: "like the original YM2149F"); an address outside the two ports is a no-op | pass |
| `NES_SUNSOFT5B` lists the 2A03's five voices plus the 5B's three; the combined chip is reachable through `chips()`, `getChip`, `chipFor`, but absent from the studio's `CHIP_IDS` (decision 38) | pass |
| `isSunsoft5bAddr` recognises exactly $C000-$DFFF and $E000-$FFFF and nothing outside them | pass |
| The combined digital chip (`Sunsoft5bNesDigital`) reports changes on both the 2A03's voices and the 5B's from one schedule | pass |
| `SUNSOFT5B_DAC` is a 1.5 dB/step logarithmic curve, peak normalised to 1, indices 0 and 1 both silent (nesdev's envelope-section sentence pairing volume-register 0 with envelope level 1) | pass |
| `Sunsoft5bMixStage` sums a maximum-level 5B-only sample as a positive contribution (no inversion, unlike VRC6); `Sunsoft5bNesCore.render()` produces finite, in-range, non-silent audio with both sides driven | pass |

## Analog stage

| | |
| --- | --- |
| Reference unit | none yet |
| Capture | none |
| Tolerance | |
| Maximum band error | unmeasured |
| Corners measured | none |
| Resampling | shared with the 2A03's own stage, once mixed |

Unmeasured, and less anchored than VRC6's own placeholder. `SUNSOFT5B_DAC`
(`packages/chipvoice/src/chips/nes/sunsoft5b-core.ts`) is nesdev's own
1.5 dB-per-step logarithmic curve, quoted verbatim in that constant's own
doc comment, with index 31 normalised to a peak of 1 and indices 0-1 both
silent (the envelope section's own "envelope levels 0 and 1 are both
equivalent to volume 0" sentence, which only holds if the volume register's
fixed low bit reads as 1, corroborating `Ay8910.outputs`'s own `2V + 1`
choice - see that method's doc comment). `SUNSOFT5B_MIX_UNIT_GAIN`, the
constant that scales one 5B channel's DAC output into the composite mix, has
no documented anchor at all to fit: nesdev's own words are "very loud
compared to other audio expansion carts. The amplifier becomes nonlinear at
higher amplitudes, and includes some filtering," citing an "ongoing" amplifier
investigation nesdev's own community has not settled either. Absent that,
this constant reuses VRC6's own anchor point only for lack of a better
documented one - one 5B channel at maximum level set equal in magnitude to
one 2A03 pulse channel at maximum volume - which is a stated placeholder, not
a measurement, and the cited nonlinear amplifier stage is not modelled at
all. None of this affects what `packages/conform` actually verifies: every
gate above compares the digital, pre-DAC 0-31 index
(`Sunsoft5bNesDigital.trace()`), never this mix stage - only what
`Sunsoft5bNesCore.render()`'s audio sounds like today, not what this sheet's
own numbers measure. A real Sunsoft 5B cartridge's own line-out capture is
the only thing that would close this, the same P7-8-shaped gap the 2A03,
the SID and VRC6 all still have.

## Driver coverage

None. Decision 38 keeps this chip out of the studio picker and the arranger
for this ticket. The combined chip is registered as `"2a03-sunsoft5b"`
(`NES_SUNSOFT5B` in `sunsoft5b-core.ts`), fully reachable from code that does
not go through the studio - `chips()`, `getChip("2a03-sunsoft5b")`,
`chipFor("2a03-sunsoft5b")` and `Chip.create({ chip: "2a03-sunsoft5b" })` all
see it - but it is deliberately absent from `CHIP_IDS` (`project-schema.ts`),
so no project, picker or arranger word can select it. A driver and an
arranger role for `s5a`/`s5b`/`s5c` are open work, tracked in
[BACKLOG.md](../BACKLOG.md).

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| s5a, s5b, s5c | the harness corpus and NSF export/playback (see below) | every arranger role: lead, bass, chord, drums; nothing a shipped song can reach yet |

## NSF export and playback

`exportNsf` (`packages/chipvoice/src/nsf.ts`) routes a capture's 5B register
writes (`isSunsoft5bAddr`, the same two ports the core and the harness use)
into the exported ROM the same indirect-store table VRC6's own writes
already needed, and sets the expansion-audio header byte's bit 5 when any of
them appear, so a player that reads that bit knows to enable its own Sunsoft
5B expansion audio before playback. `$C000` and `$E000` fall inside the
player's own DMC bank-switching window ($C000-$FFFF); that is not a
conflict - nesdev's own FME-7/5B page and Game_Music_Emu's `Nes_Fme7_Apu`
both describe the 5B's sound ports as mapper-decoded write-only registers, a
`STA $C000` always reaching the sound chip regardless of which ROM bank is
switched into that window for reads, the same way VRC6's own $9000-$B002
writes already share the player's single fixed data window
(`nsf.ts`'s own doc comment has the full reasoning). `capture-nsf.mjs` (the
offline 6502 this harness plays an exported NSF back on) accepts a file with
the 5B bit set and routes writes to its two ports the same way it already
does for the 2A03 and VRC6; a self-authored round-trip proves this end to
end in `packages/chipvoice/test/nsf.mjs`. No third-party Sunsoft 5B NSF this
project found carries a licence [`scores/nsf-corpus`](../../scores/nsf-corpus)'s
own convention requires (CC0, CC-BY, public domain, or similarly permissive,
with a source URL next to it), so this ticket added a self-authored one
instead, `sunsoft5b-probe` (CC0, `make-sunsoft5b-probe.mjs`, the same
fixture-of-last-resort convention `make-vrc6-probe.mjs` already used): a
small hand-assembled NSF that declares the 5B expansion bit and writes all
fourteen of its sound registers every frame. It is played back by
Game_Music_Emu's own `Nsf_Emu` NSF player, not just the register-level
`Ay8910`/`Ay_Apu` oracles the rest of this sheet uses, which meant extending
`native-oracle.py`'s patch a third time. Unlike VRC6's own `write_osc`, the
5B's register-select write (`write_latch`, $C000) carries no timing
parameter at all inside `Nes_Fme7_Apu.cpp` - only the data write
(`write_data`, $E000) does - so this patch logs both writes one level up, in
`Nsf_Emu.cpp`'s own dispatcher (`cpu_write_misc`), where accurate timing is
available for both regardless. This also sidesteps `Nes_Fme7_Apu`'s own
incomplete noise/envelope audio synthesis entirely (see "Where the two
oracles disagree", above): the patch captures the write stream at the
dispatcher, before `Nes_Fme7_Apu` ever decides what to do with it, so this
proof is about the NSF round-trip carrying every command intact, not about
`Nes_Fme7_Apu`'s own audio. The result closes every gate `scores/nsf-corpus`
and `scores/nsf-export` hold their other files to: an exact command-stream
match in `nsf-corpus` (8400/8400), and in `nsf-export`, an exact
command-stream match (8530/8530), an exact frame-write match (301/301), and
an export loss of 0.0 %, all against the same real NSF player every 2A03 and
VRC6 file in both corpora is measured against - see
[docs/chips/2a03.md](2a03.md)'s own `nsf-corpus`/`nsf-export` tables, which
this probe's row now shares with every other file there.

## Known deviations

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| The noise generator's 17-bit LFSR uses a Galois-form feedback (`taps at bits 16 and 13` read as two literal XOR points), where Ayumi's own generator uses a different, provably non-equivalent Fibonacci-form construction | no, that oracle's own construction, not this core's | nesdev's text ("a 17-bit linear feedback shift register with taps at bits 16 and 13") supports the literal Galois reading this core takes; Game_Music_Emu's independently-written `Ay_Apu` uses the identical Galois formula, corroborating it; an exhaustive search found no relabelling of Ayumi's Fibonacci form that reproduces the Galois form's sequence (decision 47) | every corpus script that exercises the noise generator, against Ayumi only (`noise-sweep`, `tone-noise-mixed`, two of `gate-toggle`'s four states); no effect against Game_Music_Emu, which agrees |
| Game_Music_Emu's `Ay_Apu` carries a tone/noise phase delta forward from its own reset default instead of restarting cleanly at a period-register write | no, a documented inaccuracy in that oracle | `Ay_Apu.cpp`'s own "Emulation inaccuracies" comment lists this; measured here as a constant +15-cycle offset (tone-only, after a settle write) and a constant -1/+1-cycle offset (noise-only), not constant once both interact or a period is rewritten mid-stream, which is why no settle-dependent correction is baked into the oracle driver (this project's own review lesson: never patch an oracle to match the core and call it a convention) | every `edge` script against Game_Music_Emu is `--report` only, never gated exact; `core` (DAC mode, no generator ever sampled) is unaffected |
| Game_Music_Emu's own source also lists "changes to envelope and noise periods are delayed until next reload" as a known inaccuracy | no, a documented inaccuracy in that oracle | confirmed here empirically: a mid-stream noise-period rewrite after an initial settle breaks the constant-offset property a fresh noise-only run otherwise has | same as above |
| The amplitude-table comparison (`ay8910-gme-amp`/`check:ay8910-*-gme*`) has no envelope curve: `AY_AMP_TABLE` only covers the 16 fixed-volume levels | no, a gap in that comparison's own reach | `Ay_Apu`'s raw pre-table index is private state with no public accessor, so `main-ay.cpp` reads the amplitude byte after its own 16-entry table is already applied; a log with the envelope bit set is still accepted but is not a meaningful comparison against this oracle | confidence in the envelope generator rests on Ayumi (which does expose its own raw index) and the documents, not on Game_Music_Emu |
| A fixed (non-envelope) volume register `V` maps to amplitude index `2V + 1`, never 0, for every V including 0 | no, read from the documents | nesdev's output section states the volume register's least significant bit "cannot be controlled... only used by the YM2149F's double-resolution envelope generator," and the envelope section's own "envelope levels 0 and 1 are both equivalent to volume 0 (silent)" only holds if that fixed bit reads as 1; Ayumi's own `volume * 2 + 1` independently does the same thing | every fixed-volume channel; the actual silence at index 0-1 is a property of the DAC curve (`SUNSOFT5B_DAC`), not a branch in the digital index |
| The envelope's 16 shapes are two-segment programs (`down`/`up`/`holdTop`/`holdBottom`), with two distinct hold behaviours at the two extremes (31 and 0) rather than one shared "hold" state | no, read from the documents and cross-checked against an oracle | reproduces the widely-documented 10 distinct audible shapes, including "continue = 0 always ends up silent regardless of attack direction" as a consequence of the table rather than a special case; cross-checked against Ayumi's own `Envelopes[16][2]`/`reset_segment` before being written in this form, nothing copied from it | every envelope-shape script; `edge/envelope-shapes.log` and `edge/envelope-periods.log` are both gated exact against Ayumi |
| A $C000 write's high nibble, nonzero, latches the $E000 data port disabled until the next $C000 write clears it | no, read from the documents | nesdev's own bitfield comment for $C000-$DFFF: "Disable writes to $E000 if nonzero (like the original YM2149F)" - the real chip's own BDIR/BC1/BC2-style device-select bus, not a 5B-specific quirk | any capture whose driver writes a nonzero high nibble to $C000; exercised at the unit level by `test/sunsoft5b.mjs`, not by any real-world NSF corpus file found |
| $C000/$E000 fall inside the NSF player's own DMC bank-switching window, but a write always reaches the 5B regardless of which ROM bank is mapped there for reads | yes | nesdev's own FME-7/5B page and Game_Music_Emu's `Nes_Fme7_Apu` (`latch_addr = 0xC000`/`data_addr = 0xE000`) both describe the 5B's sound ports as mapper-decoded write-only registers, never the same physical storage as whatever is readable at that address - the same reasoning VRC6's own $9000-$B002 writes already relied on in the same player | NSF export/playback only; no effect on the conformance harness, which addresses `Ay8910` by register index directly, never through a CPU address |
| No AY-3-8910 host, and so no coarser 4-bit/3dB-per-step DAC curve some AY-3-8910-based emulators use (including Mesen's own 5B implementation and Game_Music_Emu's `Nes_Fme7_Apu`), is implemented anywhere in this package | yes, out of scope | decision 38's scope for this ticket is one host, the Sunsoft 5B, which is a YM2149F wired directly to the CPU clock, not an AY-3-8910; nesdev's own text names the coarser curve as a choice "some emulator implementations... based on the AY-3-8910" make, not what a real 5B board does | the analog stage only; the digital core (`Ay8910`) is DAC-curve-agnostic and reports the raw 0-31 index either a finer or coarser host curve would read |
| Mesen's own 5B/`Nes_Fme7_Apu`-style implementations were read to understand the coarser-curve convention above but not adopted as a third oracle for this sheet's digital parity gates | yes | Mesen's own 5B audio and Game_Music_Emu's `Nes_Fme7_Apu` both model the AY-3-8910's coarser 16-level curve, not the YM2149F's finer one this core implements (`SUNSOFT5B_DAC`'s own doc comment); comparing this core's raw 0-31 index against either would require reproducing that coarsening in the harness first, which is exactly the DAC-curve question decision 38 places out of this ticket's scope, not a digital-generator question either oracle could otherwise decide | no digital parity gate references either as an oracle; Ayumi and Game_Music_Emu's `Ay_Apu` (register-level, not `Nes_Fme7_Apu`) remain the two |
| The mix gain scaling one 5B channel into the composite render (`SUNSOFT5B_MIX_UNIT_GAIN`) is a placeholder anchor, not a measurement | yes, pending a capture | nesdev gives no quantitative anchor for the 5B's own amplifier at all, unlike VRC6's "roughly equivalent to a 2A03 pulse channel" sentence; this constant reuses VRC6's own anchor point for lack of a better documented one, and nesdev's own "very loud... nonlinear at higher amplitudes" is not modelled | the analog stage's accuracy only (see "Analog stage" above); no digital parity gate is affected |
| No primary YM2149F datasheet (Yamaha's own) was consulted; this core is written from nesdev's "Sunsoft 5B audio" page and General Instrument's AY-3-8910/8912/8913 datasheet | yes, a documented gap in sourcing | nesdev's own page already states where the YM2149 differs from the AY-3-8910 (the finer envelope/volume DAC resolution) in enough detail to model directly; no Yamaha-published YM2149F datasheet was located during this ticket | anywhere this sheet or `ay8910.ts` cites "the YM2149" specifically, the claim traces to nesdev's own secondary description of it, not a primary Yamaha document |

## Power-on state

`reset()` sets every one of the 16 registers to 0 - the AY-3-8910 datasheet's
own documented RESET pin behaviour ("zeroes all registers"), taken as this
chip's power-on state. Register 7 (the mixer) at 0 means every tone and
noise generator enabled (0 = enabled, this chip's own inverted convention),
but every volume register is also 0, so the chip is silent at cycle 0
regardless. Game_Music_Emu's own `Ay_Apu::reset()` instead sets its mixer
register to `0xFF` (everything disabled) before its first render; both are
silent at cycle 0 either way, so the difference never shows up in a
conformance run, but only the all-zero form is actually documented for this
chip, so that is what this core does. `Sunsoft5bAudio.reset()` additionally
clears the $C000 register-select latch to 0 and re-enables the $E000 data
port - not independently documented, but the same "a real console's
power-on/reset sequence clears cartridge state and a driver writes every
register once before its first note" inference the VRC6 sheet's own
"Power-on state" section makes for its own registers.

## History

- 2026-09-28 (NEXT-15, PR TBD): the standalone `Ay8910` core, the Sunsoft
  5B's two-port shim, the combined `2a03-sunsoft5b` cartridge chip and its
  mixing stage, added in one PR. Two independent oracles: Ayumi (Peter
  Sovietov, MIT) and Game_Music_Emu's `Ay_Apu` (the same vendored LGPL tree
  the VRC6 and 2A03 sheets already use). The corpus split into `core`
  (DAC-mode only, exact against both oracles) and `edge` (tone/noise/envelope
  running, exact against Ayumi wherever it has no known disagreement, report
  only elsewhere). The noise generator's 17-bit LFSR resolved to a Galois-form
  construction, independently corroborated by Game_Music_Emu and provably
  non-equivalent to Ayumi's own Fibonacci-form generator (decision 47) - the
  first time two of this project's own oracles have been found to disagree
  with each other, not just with the core, on a specific feature, rather than
  one being trusted over the other for the whole chip. A negative test per
  exact gate proves each would actually catch a regression. A self-authored
  Sunsoft 5B NSF probe (CC0) closes this ticket's own NSF corpora. No driver
  or arranger role yet, decision 38. This is the Sunsoft 5B's, and the
  AY-3-8910/YM2149 core's, first sheet.

## Sources

- [NESdev Wiki: Sunsoft 5B audio](https://www.nesdev.org/wiki/Sunsoft_5B_audio) -
  register layout, the tone/noise clock formula, the envelope's 16 shapes and
  their bit names, the DAC curve, the FME-7 mapper's $C000/$E000 port pair
  and the "disable writes if nonzero" high-nibble bit.
- General Instrument's AY-3-8910/8912/8913 datasheet - the register map, the
  17-bit noise LFSR's own tap positions, the envelope generator's block
  diagram, the RESET pin's documented all-registers-zero behaviour.
- Peter Sovietov's Ayumi (`ayumi.c`/`ayumi.h`, MIT, pinned revision
  `07c08b4874c359169e4a028edf73f046d8b763e2`), read to know what to measure
  and run as the harness's primary oracle, never ported (decision 41).
- Game_Music_Emu's `Ay_Apu` (`Ay_Apu.h`/`.cpp`, the same vendored LGPL tree
  and pinned revision `fe8da4b6d3876d7542c2fb69d94487e19836d678` already
  pinned for the VRC6 and 2A03 oracles), the second, independent oracle, read
  and run the same way, never ported.

---

**Done** means: digital parity 100 % on the full corpus; every ROM above passes;
the analog stage within tolerance of the named unit; only deliberate deviations,
each with a reason; the golden hash recorded and the formula tests green in CI.
