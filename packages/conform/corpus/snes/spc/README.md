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

## Why so small

The CPU itself is verified far more strictly elsewhere: every one of its 256
opcodes, every documented flag effect and every documented cycle count,
against Anomie's SPC700 doc, in `packages/chipvoice/test/spc700.mjs`. This
corpus is the end-to-end cross-check - a real snapshot, a real reference CPU,
the same file - not the primary evidence. It grows if a redistributable SPC
worth cross-checking against turns up; nothing here blocks on that.
