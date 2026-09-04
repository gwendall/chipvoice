# Oracle: Nuked-OPN2

Alexey Khokholov's (Nuke.YKT's) Nuked-OPN2 1.0.12, the YM3438 emulator written
from a die shot of the chip and cycle-exact against it, built natively and driven
with a register log. Vendored from <https://github.com/nukeykt/Nuked-OPN2> under
the LGPL 2.1 (see [LICENSE](LICENSE)). It is a tool in this repository; nothing
here ships in the `chipvoice` package, which stays MIT.

## What is Nuked's and what is not

`ym3438.c` and `ym3438.h` are his, unchanged. One file is ours:

- `main.cpp` reads a log, drives the chip in YM2612 mode with the writes to
  `$A04000-$A04003`, one per internal cycle, and prints every change of every
  channel's nine-bit output as `<cycle> <voice> <value>` on the Mega Drive's
  master clock. PSG writes in the log are another chip's and are skipped.

The harness builds it with the system C compiler on first use, into `build/`.

## What this oracle is

The strongest kind the method has short of the die itself: Nuked-OPN2 *is* a
reading of the die, and chipvoice's YM2612 is that code ported line for line
(`packages/chipvoice/src/chips/md/ym2612.ts`, with Nuked's names kept). Parity
with it is parity with the silicon, to the internal cycle, and any divergence
the harness finds is a line of the port to fix. On the corpus's scripts - every
algorithm, feedback, detune, the envelope's stages, SSG-EG, the LFO, channel 3's
special mode, the DAC - the two are identical on every voice.

What it does not cover: the PSG, which is the SN76489 from the documents; and
the analog stage, where Nuked's YM2612 DAC model is marked "not verified" by its
author and chipvoice's mix of the two chips is a placeholder.
