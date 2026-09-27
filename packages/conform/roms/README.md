
<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

Blargg's APU test ROMs, from https://github.com/christopherpow/nes-test-roms
(Shay Green's tests, free for any use). Suites: apu_test (2011, $6000 protocol),
apu_reset (2011, $6000 protocol, needs the reset button), dmc_tests (2011),
apu_2005 (2005, screen output only). `dmg_sound/` is blargg's equivalent suite
for the Game Boy, reporting through the same kind of protocol, at `$A000`.

`vice-sid/` is a different kind of ROM suite: VICE's own `testprogs/SID`, GPL-2
and vendored under decision 41, run on a 6510 the harness carries for the
purpose. See its own [README](vice-sid/README.md) for which programs, which
are left out, and why.

`cpu_instrs/` (instruction behaviour) and `instr_timing/` (instruction timing)
are two more of blargg's own Game Boy suites, fetched from
https://github.com/retrio/gb-test-roms - a straightforward re-host of the same
author's original gb-tests (once at blargg.parodius.com, now dead). That
repository carries no formal `LICENSE` file either, the same informal "free
for any use" status `dmg_sound/` above already relies on. Disclosed for
honesty: that repository's own copy of `dmg_sound/01-registers.gb` does not
byte-match the file already vendored here, so it is a different specific
build of the same author's test family, not the source of the files already
in `dmg_sound/`; only `cpu_instrs/` and `instr_timing/` were sourced from it.
Both suites speak an older protocol than `dmg_sound/`'s `$A000` one: a
verdict printed to a screen this harness does not render, sent out the same
byte at a time over the serial port (`$FF01`/`$FF02`), which
[`cpu-instrs.mjs`](../src/roms/cpu-instrs.mjs) captures instead. Unlike every
other suite here, these two run against the PACKAGE's own `chips/gb/cpu.ts`,
not a harness-local CPU fixture - that is their point: `instr_timing` in
particular checks the package's own SM83 timing against real Game Boy
hardware behaviour, independently of any oracle emulator.

`klaus-6502/` is neither: Klaus Dormann's 6502 functional test and Bruce
Clark's decimal-mode test, run against `chipvoice`'s own `Cpu6510` (the
PSID/RSID player's CPU) rather than against an oracle, since each one
verifies itself. See its own [README](klaus-6502/README.md).
