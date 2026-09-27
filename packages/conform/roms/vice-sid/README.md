# VICE's `testprogs/SID`, as a second digital verification

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


`vice-sid/` is a subset of VICE's `testprogs/SID`: the emulator project's own
test programs for the SID, several of them written for and checked against
real 6581 and 8580 chips. `testprogs` is a separate top-level path in VICE's
Subversion repository, not carried by the project's GitHub mirror, so these
are vendored directly from `https://svn.code.sf.net/p/vice-emu/code/testprogs/SID`
at r46273. `LICENSE` is VICE's own `COPYING` (GPL 2 or later) at that
revision; decision 41 in `docs/DECISIONS.md` is what allows a GPL test
program in this private harness, never in the published package.

Fourteen programs across eight groups, chosen because each needs nothing
from a Commodore 64 the harness does not carry to report its own verdict:
VICE's own debug cartridge convention, a byte at `$D7FF` (0 for pass, `$ff`
for fail) and the border colour at `$D020`, then a jump to itself. A few call
the KERNAL's CHROUT purely to print their working; the runner
(`packages/conform/src/roms/c64.mjs`) hooks that call as a no-op rather than
loading a KERNAL. `docs/chips/c64.md`'s Test ROMs section has the results and,
for the one failure, the diagnosis.

- `ringmod/` - ring modulation read back from OSC3.
- `osc3-wave0/` - a combined waveform's zero read back from OSC3.
- `oscinit/`, plus its `noiseinit.prg` and `allinit.prg` - the accumulator's
  and the noise register's power-on values.
- `busvalue/` - the internal data bus latch that a read of a write-only or
  non-existent register returns. It failed on the first run and passes
  since P2-1 (#86) made an OSC3 or ENV3 read refresh the latch (see the sheet).
- `osc_topbit/` - the `_old` (6581) variants of a combined waveform's top bit
  read back from OSC3. The chip here is 6581 only, so the `_new` (8580)
  variants are not applicable and are not vendored, not run and not counted;
  none of the fourteen chosen programs are 8580 only.
- `envelope/` - `testADSRDelayBug`: a rate change landing mid-step.
- `resid-test/` - four of Dag Lem's own reSID test programs: `envrate` and
  `envtime` measure the fifteen ADSR rates and the ADSR stage lengths in
  cycles, through a CIA timer chained into a 32-bit counter; `envsustain`
  checks the sustain comparison; `noisetest` the noise LFSR's period. Their
  own readme (`resid-test/readme.txt`) says which real chips each reference
  table was verified against.

## Not run

VICE's own copy of `testprogs/SID` has more than these fourteen. Left out,
and why:

- `resid-test/envdelay`, `oscsample0`, `oscsample1` - "genrun" samplers that
  rewrite their own code to step through a table; more implementation risk
  than this pass wanted, on ground the four other `resid-test` programs
  already cover.
- `resid-test/boundary*`, `resid-test/envsample*`, `waveforms/*` (a separate
  top-level group) - load further data from a `.d64` disk image or a second
  `.prg`, which the runner does not model.
- `wb_testsuite`, `wf12nsr` - interactive, or depend on a warm-up run first.
- `env_test` - plots a column graph on screen; nothing here reads a screen.
- `exp_counter_reset` - calls the KERNAL's screen editor at `$e536`, beyond
  the CHROUT-only stub the runner has.
- `sidcheck.prg` - its scoring is not documented clearly enough to trust.
- `bitfade` - times a capacitor's discharge (a write-only register's or
  OSC3's bits fading with no write) against a real chip's measured cycle
  counts; an analog measurement, not a pass/fail digital check.
- `noisewriteback` - the combined-waveform noise register write-back
  (`sourceforge.net/p/vice-emu/bugs/746`); its own readme describes it as an
  audible/visual comparison, with no `$D7FF`-style verdict.
- `noiselfsrinit` - 8580 only.
- `chipmodel`, `detect*` (including `detectmirrors`, a demo's SID-count
  probe), `paddles*`, `stereo`, `mapping`, `testwave00`, `zerolevel`,
  `writedelay` - analog measurement or hardware-detection tools, not
  digital conformance checks.
- `csid-light-tests` - a third party's sound tests, not hardware
  verification programs.

## Known limits

The runner is not a C64: no ROMs, a VIC-II reduced to its raster line, and
CIA 1 timers modelled only as far as these fourteen programs use them.
`packages/conform/src/roms/c64.mjs`'s doc comment has the detail; none of the
chosen programs need more than that to reach a verdict.
