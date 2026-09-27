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

## Why so small

The CPU itself is verified far more strictly elsewhere: every one of its 256
opcodes, every documented flag effect and every documented cycle count,
against Anomie's SPC700 doc, in `packages/chipvoice/test/spc700.mjs`. This
corpus is the end-to-end cross-check - a real snapshot, a real reference CPU,
the same file - not the primary evidence. It grows if a redistributable SPC
worth cross-checking against turns up; nothing here blocks on that.
