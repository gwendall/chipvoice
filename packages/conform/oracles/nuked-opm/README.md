# Oracle: Nuked-OPM

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Alexey Khokholov's (Nuke.YKT's) Nuked-OPM 1.0, the YM2151 emulator written
from John McMaster's die shot of the chip and cycle-exact against it, built
natively and driven with a register log. Vendored from
<https://github.com/nukeykt/Nuked-OPM> under the LGPL 2.1 (see
[LICENSE](LICENSE)), pinned at commit
`f209e6ed3712032b641d53ce8fb24824eae6adc3`. It is a tool in this repository;
the oracle itself does not ship - but `ym2151.ts`
(`packages/chipvoice/src/chips/ym2151.ts`) is a line-for-line port of
`opm.c`, so the published package's licence is
`(MIT AND LGPL-2.1-or-later)`, not plain MIT, because of it (decision 17,
decision 51).

## What is Nuked's and what is not

`opm.c` and `opm.h` are his, unchanged. One file is ours:

- `main.cpp` reads a log, drives the chip in YM2151 mode (`opm_flags_none` -
  the YM2164/OPP variant Nuked-OPM also models is a different chip and out of
  scope for this project; see `docs/DECISIONS.md`'s decision 51) with the
  writes to its two ports, one `OPM_Clock` call every two of the log's
  cycles (this chip's internal state machine runs at half its input clock),
  and prints every change of the two DAC pins as `<cycle> <voice> <value>`,
  voice 0 the left channel and 1 the right - the only outputs the chip has.

The harness builds it with the system C compiler on first use, into `build/`.

## What this oracle is

The strongest kind the method has short of the die itself: Nuked-OPM *is* a
reading of the die, and chipvoice's YM2151 is that code ported line for line
(`packages/chipvoice/src/chips/ym2151.ts`, with Nuked's names kept, and the
YM2164/OPP-only branches of the original left out - see that file's own doc
comment). Parity with it is parity with the silicon, to the internal cycle,
and any divergence the harness finds is a line of the port to fix.

What it does not cover: the YM2164 (OPP), a related but different chip this
project has no need of; and anything the real chip's timers or CSM mode do
that is not audible, which this port does not model either (see
`docs/chips/ym2151.md`).
