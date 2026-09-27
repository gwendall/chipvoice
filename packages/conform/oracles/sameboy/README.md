# Oracle: SameBoy

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Lior Halphon's SameBoy, a cycle-accurate Game Boy emulator, configured as a
DMG-B and driven with a register log. Vendored from
<https://github.com/LIJI32/SameBoy> at commit
[`213a12ce93d66b105a113debd9396306066a7cfc`](https://github.com/LIJI32/SameBoy/commit/213a12ce93d66b105a113debd9396306066a7cfc)
(2026-07-10) under the Expat License (see [LICENSE](LICENSE)). It is a tool in
this repository; nothing here ships in the `chipvoice` package, which stays
MIT.

## What is SameBoy's and what is not

`vendor/apu.c`, `vendor/apu.h`, `vendor/defs.h` and `vendor/model.h` are
Lior Halphon's, byte for byte, at the pinned commit. Only the APU is
vendored: SameBoy's real `Core/gb.h` pulls in the CPU, the PPU, memory
mapping and the rest of the console, none of which `apu.c` needs to run
against a register log. Three files are ours:

- `gb.h` is a shim for SameBoy's own `Core/gb.h`, which `vendor/apu.c`
  includes verbatim (it is not ours to edit). `GB_gameboy_t` is a forward
  declared opaque type in upstream's `defs.h` (`struct GB_gameboy_s; typedef
  struct GB_gameboy_s GB_gameboy_t;`), so this defines our own minimal
  `struct GB_gameboy_s` with only the fields `apu.c` actually dereferences
  (found by grepping the vendored source for every `gb->` field), plus the
  handful of `GB_IO_*` register offsets, the `GB_ENUM` and
  `GB_ASSERT_NOT_RUNNING_OTHER_THREAD` macros, and a one-field `GB_sgb_t`
  stand-in `apu.c`'s SGB intro-hush check needs a complete type for (it is
  always null; the check never runs). Field order does not matter, since
  `apu.c` only ever reaches them by name.
- `shim.c` implements the two functions `apu.c` calls outside itself,
  `GB_get_clock_rate` and `GB_is_cgb`. Both are constants for a DMG-B that
  never changes model or speed.
- `main.c` reads a chipvoice register log, drives the APU one T-cycle at a
  time, and prints every change of `GB_get_channel_amplitude(gb, voice)` -
  already what the voice's DAC is given, 0 to 15, no folding needed - as
  `<cycle> <voice> <value>`. Not `gb->apu.samples[voice]` directly: SameBoy
  parks an invalidation sentinel (`0x10`, out of the DAC's own 0-15 range)
  there when NR50 or NR51 is written while a channel's DAC is off, and a
  DAC that stays off never overwrites it (`update_sample`'s DMG branch:
  `if (!GB_apu_is_DAC_enabled(...)) value = gb->apu.samples[index];`, i.e.
  the array is left holding the sentinel). `GB_get_channel_amplitude` is
  SameBoy's own public accessor for this exact question, and returns 0
  whenever the channel is not active, the same DAC-off convention
  `dsp.ts`'s own `output()` uses.

The harness builds it with the system C compiler on first use, into `build/`,
as `-std=gnu11` rather than plain `-std=c11`: `vendor/apu.c` reaches for
`M_PI`, a POSIX/BSD extension to `<math.h>`, not ISO C. Apple's libc exposes
it regardless of `-std`, which is why building this locally on macOS never
surfaced the gap; glibc hides it behind `-std=c11`'s `__STRICT_ANSI__` and
fails the build outright on Linux. GNU C11 is a superset of ISO C11, so
nothing `apu.c` itself relies on changes, only that one declaration becomes
visible; the flag lives in `sameboy.mjs`'s `build()`, not in the vendored
file, which stays untouched.

`main.c` used to re-sort the parsed write list with `qsort` before driving
the APU with it, comparing only by cycle. Two things make that both
redundant and dangerous: `formatLog` (`log.mjs`) writes the log with a
stable sort already, and `main.c`'s own read loop already rejects any file
where a cycle goes backwards, so the array `qsort` ran on was already
non-decreasing by cycle. `qsort`'s ordering of writes that share a cycle -
common in the corpus, where a channel's setup registers and its trigger are
routinely logged on the same cycle - is unspecified by the C standard, and
glibc's and Apple libc's implementations resolved those ties differently in
practice: the same, unmodified `vendor/apu.c` produced a materially
different trace on gcc/Linux than on clang/macOS, caught by CI. The fix is
in `main.c`, not the vendored file: the redundant sort is gone, so the
writes are applied in exactly the order the log already puts them in, on
every platform.

## The frame sequencer's phase

`dsp.ts`'s frame sequencer is the falling and rising edge of bit 0x1000 of
its own `divider`, a 16-bit counter that starts at 0 on `reset()`. SameBoy's
is the same edge of the same bit of `div_counter` (`GB_apu_div_event` on the
falling edge, `GB_apu_div_secondary_event` on the rising one), reproduced
here in `main.c`'s `tick_div` from `Core/timing.c`'s
`GB_set_internal_div_counter` (not vendored; it also drives TIMA and the
serial port, which nothing here reads). Both traces are driven from
`div_counter = 0` and `divider = 0` at cycle 0, so the two start in the same
phase with nothing to line up: no offset is applied, or needed, in either
direction.

The one timebase the two genuinely differ on is `apu.apu_cycles`, SameBoy's
own internal clock. Real hardware's APU ticks at half the CPU's T-cycle rate
(`Core/timing.c`'s `timers_run` adds `1 << !cgb_double_speed` per four
T-cycles processed, i.e. 2 per 4 for a DMG-B); `main.c` reproduces that ratio
by accumulating one T-cycle into `apu_cycles` and flushing it through
`GB_apu_run` only on every second T-cycle, rather than SameBoy's own internal
scheduling (which normally only ever advances in 4-T-cycle, whole-M-cycle
jumps; ticking `div_counter` here by 1 every T-cycle is finer than real
SameBoy ever does internally, and is necessary to match `dsp.ts`'s own
per-T-cycle trace resolution, whose frame sequencer edges land on
odd, non-4-aligned cycle values). The result is that a change whose true
T-cycle is the earlier of a pair can be stamped with the later one instead;
this is a real, small (at most 2 T-cycles per APU tick, observed as a
residual of roughly 6 to 10 cycles once accumulated through a trigger's own
delay math) rounding of this driver's own making, not a SameBoy or chipvoice
difference, and it is the cause the sheet points to wherever a divergence's
edges line up under a small constant shift with no other explanation.

## Known limits of this oracle

It is far closer to the hardware than Gb_Snd_Emu (see that oracle's own
[README](../gb-snd-emu/README.md)): DACs, a power switch, the divider's own
frame sequencer, zombie mode, and a sweep modeled at the register level
rather than folded into an output sample. Where it still disagrees with
chipvoice, per voice, with cycles and both values, is on the sheet
([`docs/chips/dmg.md`](../../../../docs/chips/dmg.md), "Against SameBoy").
In short:

- A triggered pulse voice's first step comes 4 or 8 cycles after
  chipvoice's: SameBoy's trigger adds a short delay (its `delay` field) to
  the timer reload, and chipvoice reloads on the trigger's own cycle. The
  whole-step gap this oracle first found, a pulse playing its pattern the
  instant it was triggered, was chipvoice's and is fixed (P2-1, #86).
- The noise channel's DMG start depends on `alignment`, the APU's 2 MHz
  phase: a trigger at an odd alignment waits 6 cycles and triggers again,
  for ever. Only a write between M-cycles can produce one, which a real CPU
  never makes, so the corpus writes on whole M-cycles (`generate-dmg.mjs`,
  P2-1) and a log fed to this oracle should too. What still differs on the
  noise is where its clock stands when a note is triggered: SameBoy's
  counter keeps running across triggers, chipvoice reloads its timer. The
  documents disagree on which is right; the sheet has both readings and
  leaves it to a unit.
- SameBoy's zombie-mode glitch (`nrx2_glitch`) runs a DMG-B-specific
  two-step model through an intermediate `0xFF`, which its own comment
  acknowledges is partly non-deterministic on real pre-CGB hardware; it
  agrees with chipvoice's simpler single-step model on the simple case and
  diverges on a direction flip with a non-zero period.
- This driver's own 2-T-cycle `apu_cycles` batching (above) rounds an
  occasional transition to the wrong side of a 2-cycle boundary; every case
  found self-corrects on the very next sample or duty edge, with no lasting
  shift.

## Trusted voices

All four: it is a cycle-accurate DMG core with DACs, a power switch and a
divider-driven frame sequencer, the same model `dsp.ts` documents itself
against, so it is compared on every voice rather than a subset. What it
still disagrees with chipvoice on, per voice, is diagnosed on the sheet, not
excluded here - the same convention Gb_Snd_Emu's oracle module uses despite
its own, larger set of known limits.
