# Oracle: snes_spc

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Shay Green's (blargg's) snes_spc 0.9.0, the S-DSP emulator written against the
hardware's own output, in its "highly accurate" form, built natively and driven
with a register log. Vendored from
<https://github.com/blarggs-audio-libraries/snes_spc> under the LGPL 2.1 (see
[LICENSE](LICENSE)). It is a tool in this repository; nothing here ships in the
`chipvoice` package, which stays MIT but for the port of this very file.

## What is blargg's and what is not

`snes_spc/SPC_DSP.*`, `snes_spc/blargg_*.h`, and - as of the CPU oracle below
- `snes_spc/SNES_SPC.*`, `snes_spc/SNES_SPC_misc.cpp`,
`snes_spc/SNES_SPC_state.cpp` and `snes_spc/SPC_CPU.h` are his, unchanged.
Two files are ours:

- `main.cpp` reads a log - the samples from its `# memory` lines into the 64 KB
  the DSP shares with the SPC700, then the writes the SPC700 makes to `$F2` and
  `$F3` on the SPC700's clock - runs the DSP one clock at a time, and prints its
  output stream: every change of the left and right sixteen-bit words as
  `<cycle> <voice> <value>`, through the `SPC_DSP_OUT_HOOK` the source provides
  for exactly this.
- `play-spc.cpp` reads a whole `.spc` file (header, ID666, ARAM and DSP
  registers) from stdin, has `SNES_SPC` load it and run its own real SPC700
  (`SPC_CPU.h`) for a requested number of cycles, and prints two traces
  through the `SPC_DSP_WRITE_HOOK` and `SPC_DSP_OUT_HOOK` extension points the
  vendored source already provides: every DSP register write the CPU makes
  (`--writes`: `<cycle> <register> <value>`, hex) and every output sample
  (`--samples`: `<cycle> <voice> <value>`, the same shape `main.cpp` prints).
  With neither flag it prints both, for a person to read. Unlike `main.cpp`,
  which only ever drives the DSP from a log someone already made, this is
  what actually plays a `.spc` file with blargg's own CPU - the reference for
  `importSpc`'s new CPU and snapshot loader, not just its ported S-DSP.

The harness builds each with the system C++ compiler on first use, into
`build/`.

## What these oracles are

The chip's S-DSP (`packages/chipvoice/src/chips/snes/sdsp.ts`) is `SPC_DSP.*`
ported line for line, and the two are compared on the DSP's output stream - on
this chip the digital output is the word the DSP hands its DAC, so the stream
is the chip's output and a capture from a real console is the same kind of
thing. On the corpus's scripts and songs the two are identical, sample for
sample, echo and FIR included. `packages/conform/src/spc/check.mjs`
(`check:spc`) instead drives `play-spc` from a real `.spc` file, alongside the
package's own new SPC700 (`spc700.ts`, `ssmp.ts`) and its `importSpc` snapshot
loader, so that a divergence there - which the DSP-only comparison above
cannot see at all, since it starts downstream of any CPU - can only be the new
CPU, its timers, or the snapshot restore. See
[docs/chips/snes.md#spc-playback](../../../../docs/chips/snes.md#spc-playback).

What neither covers: the DAC and the console's analog output after it, where
chipvoice's stage is a placeholder.
