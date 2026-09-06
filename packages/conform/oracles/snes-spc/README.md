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

`snes_spc/SPC_DSP.*` and `snes_spc/blargg_*.h` are his, unchanged. One file is
ours:

- `main.cpp` reads a log - the samples from its `# memory` lines into the 64 KB
  the DSP shares with the SPC700, then the writes the SPC700 makes to `$F2` and
  `$F3` on the SPC700's clock - runs the DSP one clock at a time, and prints its
  output stream: every change of the left and right sixteen-bit words as
  `<cycle> <voice> <value>`, through the `SPC_DSP_OUT_HOOK` the source provides
  for exactly this.

The harness builds it with the system C++ compiler on first use, into `build/`.

## What this oracle is

The chip's S-DSP (`packages/chipvoice/src/chips/snes/sdsp.ts`) is this code
ported line for line, and the two are compared on the DSP's output stream - on
this chip the digital output is the word the DSP hands its DAC, so the stream
is the chip's output and a capture from a real console is the same kind of
thing. On the corpus's scripts and songs the two are identical, sample for
sample, echo and FIR included.

What it does not cover: the DAC and the console's analog output after it,
where chipvoice's stage is a placeholder.
