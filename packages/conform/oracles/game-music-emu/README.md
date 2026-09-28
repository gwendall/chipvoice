# Oracle: Game_Music_Emu (`Nes_Vrc6_Apu`)

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Shay Green's (blargg's) Game_Music_Emu, `Nes_Vrc6_Apu` (part of Nes_Snd_Emu
0.1.8), the oracle for Konami's VRC6 expansion audio. Vendored from
<https://github.com/libgme/game-music-emu> under the LGPL 2.1 (see
[LICENSE](LICENSE)), pinned at revision
`fe8da4b6d3876d7542c2fb69d94487e19836d678`. It is a tool in this repository;
nothing here ships in the `chipvoice` package, which stays MIT (decision 41).

## What is blargg's and what is not

`gme/Nes_Vrc6_Apu.h`/`.cpp`, `gme/Blip_Buffer.h`, `gme/blargg_common.h` and
`boost/` are his, unchanged, the same split `oracles/nes-snd-emu` uses for the
plain 2A03. One file is ours: `main.cpp` reads a chipvoice register log,
drives `Nes_Vrc6_Apu` with it, sums each oscillator's amplitude deltas and
prints every change of value as `<cycle> <voice> <value>` - voices 0-2, the
two pulses then the sawtooth, the same order `Vrc6Apu.trace` produces. The
address-to-register dispatch in `main.cpp` (`reg = (addr - 0x9000) &
(addr_step - 1)`, `osc = (addr - 0x9000) / addr_step`, forwarded only when
`osc < osc_count && reg < reg_count`) is copied from Game_Music_Emu's own
`Nsf_Emu.cpp` (`HANDLE_CHIP_VRC6`), not invented here. The harness builds it
with the system C++ compiler on first use, into `build/`.

## Known limits of this oracle

It is a 2005-era emulator, predating the nesdev wiki page this core is
written from. `docs/chips/vrc6.md`'s own "What the numbers say" reads the
board's numbers against these; in short, read directly from
`gme/Nes_Vrc6_Apu.cpp`:

- **A pulse's duty phase freezes on disable and in "always on" mode, and
  never resets on re-enable.** `run_square`'s phase-advance loop only runs
  while `volume && !gate && period > 4`; disabling a channel forces `volume`
  to 0 in the same function, and the mode bit sets `gate`, so either one
  skips the loop entirely and the phase (`osc.phase`) simply holds. On
  re-enable it resumes from wherever it froze. Nesdev's own text is explicit
  that a real VRC6 does the opposite: "output is forced to 0, and the duty
  cycle is immediately reset and halted; it will resume from the beginning
  when E is once again set" - which this core does literally (`step = 15` on
  the disable-to-enable edge). Every corpus script that disables and
  re-enables a pulse measures this as a per-run shift, not a raw match.
- **A pulse whose reloaded period is 4 cycles or less never toggles.** The
  same `period > 4` guard above also skips the loop at very short periods,
  near the Nyquist rate; this core keeps advancing at any period, following
  the documented `f = CPU / (16 * (t + 1))` formula with no floor.
- **The sawtooth's accumulator does not freeze on disable - it holds without
  even that; the divider stops too.** `run_saw` takes an entirely different
  branch while disabled (`!(regs[2] & 0x80)`): it neither touches
  `osc.amp` (the accumulator) nor advances `osc.phase`/the divider at all.
  Nesdev's text says plainly that a real VRC6 does both differently: "the
  accumulator is forced to zero until E is again set" (this core zeroes it
  on every accumulating tick while disabled, not just once) and "clearing E
  does not reset the frequency divider, however" (this core's divider keeps
  ticking through a disable; only the accumulator is held at zero). Every
  corpus script that disables and re-enables the sawtooth shows this as a
  divergence that widens with each cycle, not a constant phase.
- **`$9003`/`$A003`/`$B003` (the shared halt/frequency-scaling register and
  its two unused mirrors) are silently dropped.** `Nes_Vrc6_Apu::reg_count`
  is 3, so `main.cpp`'s own dispatch (copied from `Nsf_Emu.cpp`'s real
  player-integration code, not a choice made here) never forwards a write to
  register index 3 of any oscillator's block. The real player is exactly
  this faithful to it too. The corpus never writes `$9003` for this reason -
  a log that halted or rescaled the divider would only be measuring the
  oracle's silence, not this core - and `$9003` is exercised instead by
  `packages/chipvoice/test/vrc6.mjs`'s own unit tests, against nesdev's text
  directly.
- **A one-cycle clocking-order offset, even with no disable at all.**
  `script-saw-worked-example` never touches E after enabling once, yet its
  single run still sits at a constant one-cycle shift for its whole length -
  which side's register write is considered to take effect on the cycle it
  lands on, not a behavioural difference. This is the smallest and most
  mechanical divergence measured here, the kind the 2A03 sheet's own
  Nes_Snd_Emu oracle README also documents for a custom NSF rate.

So it is the oracle for the sawtooth's waveform shape, both pulses' duty
ratio and period, and the frequency-scaling formula - each confirmed once its
own script's per-run shift is applied - not for the exact cycle a disabled
voice's phase sits at, or for `$9003` at all.

## A second oracle

Mesen 2 also emulates the VRC6 (`Core/NES/Mappers/Audio/Vrc6*.h` in its own
source - real Mesen is C++, not C#; an earlier pass at this ticket had that
backwards, which is what read as disproportionate to vendor). NEXT-14's
round 2 added it as a second, independent oracle beside this one, the same
way Mesen already is for the plain 2A03 (`oracles/mesen`): vendored
unchanged under `oracles/mesen/vendor/NES/Mappers/Audio/`, driven by
`oracles/mesen/main-vrc6.cpp`, wrapped by `oracles/mesen-vrc6.mjs`. See
[`oracles/mesen/README.md`](../mesen/README.md)'s own "VRC6 audio (NEXT-14)"
section for what it is, what it checks that this oracle cannot ($9003, the
sawtooth's disable-zeroes-the-accumulator behaviour, any period at or below
4 cycles), and its own measured cycle-offset convention.
