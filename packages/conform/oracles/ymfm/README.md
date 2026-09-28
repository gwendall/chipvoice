# Oracle: ymfm

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Aaron Giles's ymfm, a second, independent YM2151 model, built natively and
driven with a register log. Vendored from
<https://github.com/aaronsgiles/ymfm> under the BSD 3-Clause license (see
[LICENSE](LICENSE)), pinned at commit
`81aec25ccbb98f4873a255f7551ac4dadac59b4a`. It is a tool in this repository;
nothing here ships in the `chipvoice` package, which stays MIT.

## What is ymfm's and what is not

`src/ymfm.h`, `src/ymfm_fm.h`, `src/ymfm_fm.ipp`, `src/ymfm_opm.h` and
`src/ymfm_opm.cpp` are his, unchanged - the files ymfm's own `ym2151` class
needs and no more (its YM2608/YM2610/OPL families are not vendored here; this
project has no use for them). One file is ours:

- `main.cpp` reads a log and drives the chip with the writes to its two
  ports, and prints every change of its two output channels as
  `<cycle> <voice> <value>`, voice 0 the left and 1 the right. ymfm's own
  `generate()` is not a cycle-by-cycle model the way Nuked-OPM's `OPM_Clock`
  is - it produces one finished sample per call from the register state at
  that instant, with no notion of where inside a sample a write landed - so
  writes are batched to the sample period they fall in (every 64 of the
  log's cycles, this chip's clock/64 rate) rather than interleaved cycle by
  cycle. A minimal `ymfm_interface` subclass overrides none of its hooks:
  none of them (timers, IRQ, the busy flag) affect `generate()`'s output.

The harness builds it with the system C++ compiler on first use, into
`build/`.

## What this oracle is

A second, independently-written model - not derived from a die shot, written
instead from the public documentation, other emulators' behaviour, and tuned
against real hardware captures. It is a useful cross-check, but not the
project's ground truth: chipvoice's YM2151 (`packages/chipvoice/src/chips/ym2151.ts`)
is ported line for line from Nuked-OPM, the die-shot-derived source (see
`docs/DECISIONS.md`'s decision 51), and where the two oracles disagree that
decision's own precedent (decision 48) is what settles it - the die-shot
source wins, and the disagreement is named on the chip's own sheet
(`docs/chips/ym2151.md`), not silently absorbed.

For that reason this oracle's gate is never exact, only `--report`: a
divergence here is not by itself evidence of a bug in the port, only a
prompt to look at it and say, on the sheet, which side is right and why.
