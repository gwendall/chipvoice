# Corpus: .spc files

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

`.spc` snapshots for `check:spc` (`src/spc/check.mjs`): each one is played
through `importSpc` and through `../../../oracles/snes-spc/play-spc.cpp` (a
real SPC700, blargg's `SPC_CPU.h`) from the same file, and the two traces are
compared. Never a commercial game rip: only files whose licence allows
redistribution land here, self-produced or otherwise cleared, each recorded
below with its source, licence and SHA-256. A local, gitignored directory
(`--corpus <dir>` on the check script) can hold anything else for a
person's own testing; CI never depends on it.

| File | Source | Licence | SHA-256 |
| --- | --- | --- | --- |
| `selftest.spc` | Self-authored for this repository (a hand-assembled SPC700 program: selects and writes FLG, then MVOLL, then MVOLR, then loops in place) | CC0 / MIT, same terms as this repository | `6b8d4837cb1fb0dc5c4daabe9a5555e1126ceeed3a5bf24f1213cd584023d3b0` |
| `timer-phase.spc` | Self-authored for this repository (a hand-assembled SPC700 program: enables timer 0 with a period of 1, polls its counter until non-zero, writes that one moment to V0VOLL, then stops) | CC0 / MIT, same terms as this repository | `cdeb697fe3eac22176eae3b65cdd42eb7856d7f1b08192fa340cbcd892c7ab66` |
| `dspaddr-select.spc` | Self-authored for this repository (a hand-assembled SPC700 program: one bare `MOV $F3,#$5A` with no `$F2` write of its own, resuming a snapshot whose DSPADDR overlay cell already selects register $0C, then loops in place) | CC0 / MIT, same terms as this repository | `c1a4ef9b02d56470e42dbf3450a9743af006239fcaa81b527ed4789dda49cac8` |
| `echo-snapshot-restore.spc` | Self-authored for this repository (a snapshot with ESA=$04, EDL=1, FIR0=$7F and every other FIR tap 0, EVOLL/EVOLR=$7F, MVOLL/MVOLR=0, KON=0, FLG=$20 (echo writes disabled), and one distinctive non-zero sample already sitting in RAM at the echo buffer's own address; the CPU program only re-writes FLG to its own value, then loops) | CC0 / MIT, same terms as this repository | `322accc2e989a84617be04700d7beb8c0b7897f0452b2591cbcf77a5805fe756` |

## The timer-phase regression

`timer-phase.spc` is the regression test for the `fix_snapshot_timer_phase()`
patch in `../../../oracles/snes-spc/snes_spc/SNES_SPC.cpp` (see that file's
own doc comment, and DECISIONS.md #46, for the full mechanism): a snapshot
whose only observable event is the exact cycle its CPU first sees timer 0's
counter become non-zero. Timer 0 is enabled with a period of 1 (one
prescaler period, 128 SPC cycles at normal tempo), so a correct emulator
only reaches that moment once a full period has actually elapsed since the
snapshot's own cycle 0, not before.

`check.mjs` gates this file's write cycle exactly, not just its content: the
patched oracle's one write lands at cycle 141, one cycle (the same
pre-charge labelling difference documented in this file's own top comment)
after this package's own SPC700 reports it at cycle 140. Without the patch,
blargg's own snes_spc reports it at cycle 15 - roughly 126 cycles early,
crediting a whole prescaler period as elapsed before the snapshot has run
for more than a couple of instructions. If this regresses, `check.mjs`'s own
report on this file names it directly, not just as a lower overall
percentage.

## The two snapshot-restore regressions

`dspaddr-select.spc` and `echo-snapshot-restore.spc` are the regression
tests for NEXT-26, both in `packages/chipvoice/src/spc-import.ts` and (for
the second file) `chips/snes/sdsp.ts`/`chips/snes/dsp.ts`: two ways a fresh
chip replaying an imported plan's `events` used to reconstruct a snapshot's
state differently from a snapshot actually being loaded, found by testing
`importSpc` against local commercial SPC rips (never committed; see
DECISIONS.md).

`dspaddr-select.spc`: DSPADDR ($F2) is S-SMP latch state, not one of the
128 DSP registers a snapshot's register block restores. A snapshot taken
mid-song almost always resumes with the CPU's very next instruction writing
straight to DSPDATA ($F3) with no $F2 write of its own - the selecting
write already happened before the snapshot was taken. Without seeding this
latch, a fresh chip replaying the plan's restore writes is left with
whatever register that restore loop's own last iteration selected (127),
so this file's one real write lands on the wrong register. Fixed by adding
one more restore event, `{addr: 0xf2, value: <the snapshot's own DSPADDR>}`,
right after the register restore loop.

`echo-snapshot-restore.spc`: several S-DSP fields - the echo address latch,
the direction-page latch, the KON edge-latch, the echo history and its ring
position - are hidden internal state a real chip only re-derives once a
sample, not on an ordinary register write. During continuous play they are
always in sync with the register file (at most one sample stale); a
snapshot's register file was written by a chip that had been running
continuously, so they were in sync at that instant too, but the snapshot
format does not carry them. A fresh chip replaying only the plan's ordinary
$F2/$F3 writes never triggers this re-sync, so its first sample - and,
through the echo buffer's 8-deep history, every sample until the ring
wraps once, 8 samples later - runs on the chip's own construction defaults
instead. This file's echo buffer already holds one distinctive sample in
RAM at the address its own ESA selects; a correct restore reads it back
starting with sample 0, an incorrect one reads from address 0 instead
(silence, in this file) until the ring buffer's stale zero at that
position gets naturally overwritten many samples later. Fixed by
`SDsp.restoreInternalState()` (the non-register half of `SDsp.load()`,
now also callable on its own) and a second synthetic event, at a reserved
address ($F9) `SnesChip.write` recognizes only from a plan's own restore
prefix, never from real S-SMP traffic (see `dsp.ts`'s
`DSP_SNAPSHOT_RESTORE_ADDR` doc comment).

## Why so small

The CPU itself is verified far more strictly elsewhere: every one of its 256
opcodes, every documented flag effect and every documented cycle count,
against Anomie's SPC700 doc, in `packages/chipvoice/test/spc700.mjs`. This
corpus is the end-to-end cross-check - a real snapshot, a real reference CPU,
the same file - not the primary evidence. It grows if a redistributable SPC
worth cross-checking against turns up; nothing here blocks on that.
