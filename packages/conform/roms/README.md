
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
