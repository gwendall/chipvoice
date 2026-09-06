# reSID-fp, as the C64 oracle

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


`residfp/` is [reSID-fp](https://github.com/drfiemost/residfp), Leandro
Nini's fork of Dag Lem's reSID as it lives in libsidplayfp, vendored as is:
the SID's two generators as the VICE project and the reSID authors
reverse-engineered them from the die and from sampling real chips - the
oscillator's 23-bit noise register and its two-cycle shift pipeline, the
combined waveforms as a model fitted to kevtris's samplings, the envelope's
15-bit rate register, exponential counter and the cycle-by-cycle state
machine of a gate change. The filters and the resamplers come with it
because `SID.cpp` links against them; the oracle does not run them.

`main.cpp` is the harness's: it reads a register log, drives the SID as a
6581 one cycle at a time and prints every change of every voice's twelve-bit
waveform output and eight-bit envelope counter, read before the DACs. That
is the digital chip, the part that can be right or wrong; what the DACs and
the filter make of it is a profile on chipvoice's side. `--tables` prints
the 6581's waveform tables, which chipvoice's combined-waveform model is
fitted against.

`sidcxx11.h` stands in for libsidplayfp's, and `residfp/siddefs-fp.h` is
the template next to it with its configure variables filled in.

reSID-fp is GPL 2 or later. It is used here as a test fixture and nothing
of it is in the package, which is written from the documents: see decision
18 in `docs/DECISIONS.md`.
