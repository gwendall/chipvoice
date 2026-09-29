# Oracle: Mesen 2

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Mesen 2's NES APU (`Core/NES/APU/`), built natively and driven with a register
log, the same way as the `nes-snd-emu` oracle. Vendored from
<https://github.com/SourMesen/Mesen2> at commit `b9fa69ddc6d0a331fb103fdb5eef6904305703c2`
(2026-06-04), under the GPL-3.0 (see [LICENSE](LICENSE)). Per this repository's
vendoring policy (decision 41), it runs as a separate native process under
`packages/conform` only; nothing here ships in the `chipvoice` package, which
stays MIT.

## What is Mesen's and what is not

Under `vendor/`, unchanged from the pinned commit: `NES/APU/NesApu.*`,
`SquareChannel.h`, `TriangleChannel.h`, `NoiseChannel.h`,
`DeltaModulationChannel.*`, `ApuFrameCounter.h`, `ApuEnvelope.h`,
`ApuLengthCounter.h`, `ApuTimer.h`, and the two small interfaces they need,
`NES/INesMemoryHandler.h` and `NES/NesConstants.h`.

Everything under `shim/` is ours: a minimal console, CPU, memory manager,
sound mixer and serializer, standing in for the real Mesen classes those
files call into (`NesConsole`, `NesCpu`, `NesMemoryManager`, `NesSoundMixer`,
`Serializer`/`ISerializable`, `Emulator`, and the `ConsoleRegion`/`NesConfig`
settings). Real Mesen's versions run a whole console: PPU, mappers, save
states, a full 6502, panned and filtered audio. This oracle only needs the
APU's own register decoding and its channels' output level, so the shims are
bags of pointers and no-ops wherever the APU only needs an interface to
compile against, not real behaviour:

- `shim/NES/NesConsole.h` - the pointers the APU's classes reach through
  (`GetApu`, `GetCpu`, `GetMemoryManager`, `GetSoundMixer`, `GetEmulator`,
  `GetRegion`, `GetNesConfig`), plus the `uint8_t memory[0x10000]` the DMC
  reads from.
- `shim/NES/NesCpu.h` / `.cpp` - a cycle counter, counted from 1 so that it
  calls the same cycles APU cycles as chipvoice does (the frame
  counter's 3- or 4-cycle `$4017` delay and the DMC's start delay are read
  from it; see the header's comment, P2-1), the `IRQSource` flags the
  APU sets and reads, and `StartDmcTransfer()`: a synchronous, zero-stall
  read of `console->memory[apu->GetDmcReadAddress()]` handed straight to
  `apu->SetDmcReadBuffer()`. See "The DMC's memory reads" below.
- `shim/NES/NesMemoryManager.h` - dispatches a `$4000-$401F` write to
  whichever channel's `GetMemoryRanges()` claimed that address, the same way
  real Mesen's console wires every `INesMemoryHandler` up at startup.
- `shim/NES/NesSoundMixer.h` - real Mesen's mixer resamples every channel
  into a stereo stream. This oracle never listens to it; it only needs the
  `AddDelta(channel, time, delta)` calls the channels already make, recorded
  as `(absolute cycle, delta)` per voice instead of mixed into anything. See
  its own comment for how the absolute cycle is reconstructed from the
  per-frame `time` argument.
- `shim/NES/NesTypes.h` - a trimmed, verbatim copy of just the enums and
  state structs the vendored files reference (`AudioChannel`, `IRQSource`,
  `MemoryOperation`, the six `Apu*State` structs), leaving out the PPU,
  cartridge and mapper declarations the real file also carries.
- `shim/Shared/SettingTypes.h` - `ConsoleRegion` and a `NesConfig` with just
  the seven flags the vendored APU code reads, every one at Mesen's real
  documented default (`false`); this oracle is NTSC-only, matching
  chipvoice's own `CPU_HZ`.
- `shim/Shared/Emulator.h`, `shim/Utilities/{ISerializable,Serializer}.h` -
  trivial stand-ins; this oracle never saves or loads state, so every
  vendored `Serialize()` method is dead code that only needs to compile.
- `shim/pch.h` - stands in for Mesen's own `Core/pch.h`, a precompiled-header
  umbrella for the whole emulator. The vendored APU files only need a handful
  of standard headers and the `__forceinline`/`__noinline` aliases Mesen's
  code uses, so this shim provides just those.

`main.cpp` is ours: it reads a chipvoice register log from stdin, drives
`NesApu::ProcessCpuClock()` one CPU cycle at a time up to each write's cycle
(applying the write with the memory manager, the same "catch up on the old
value, then apply the new one" convention `NesApu::WriteRam` itself uses),
and prints every change any voice's summed deltas show as
`<cycle> <voice> <value>` in cycle order. Voices are 0 to 4: square 1,
square 2, triangle, noise, DMC - `AudioChannel`'s own order, and chipvoice's.

The harness builds it with the system C++ compiler on first use, into
`build/`.

## The value each voice reports

Each voice's printed value is the running sum of `AddDelta`'s deltas for that
`AudioChannel`, which is exactly the instantaneous output level Mesen's own
`GetOutput()` (`_timer.GetLastOutput()` for the square/triangle/noise
channels, the DMC's 7-bit counter for the DMC) reports at that cycle - the
same quantity `packages/chipvoice/src/chips/nes/dsp.ts`'s `Chip.outputs()`
writes for each voice and `Chip.trace()` reports a change for: 0-15 for the
two pulses, the triangle and the noise, 0-127 for the DMC. A change is only
ever printed when the value itself changes, on either side, matching
`trace()`'s own convention.

## The DMC's memory reads

The log's `# memory ADDR: hex...` lines are loaded into `console.memory`
before any write is applied. `NesCpu::StartDmcTransfer()` reads that array
synchronously, with no simulated CPU stall - the ticket that added this
oracle asked for exactly that simplification, since a DMA's CPU stall does
not change the APU's own timing in a log-driven run (there is no CPU program
counter here for a stall to delay). `StopDmcTransfer()` is a no-op, since a
transfer that always completes synchronously is never left pending.

## Power-on and reset

`main.cpp` starts every run from Mesen's own power-on: `NesApu`'s
constructor calls `Reset(false)` itself, and `main.cpp` adds nothing before
the first write except `SetRegion(ConsoleRegion::Ntsc, true)`, which real
Mesen's console also calls once at startup and which the vendored
`ApuFrameCounter::Run()` needs before it can advance at all (its step-cycle
table is only ever filled by `SetRegion`, never by `Reset`). There is no
reset path other than power-on: a corpus script that means to start partway
into a song still begins this oracle from the same cold state chipvoice
itself starts a trace from.

## Known limits of this oracle

- **The triangle's power-on value.** Mesen's `ApuTimer::_lastOutput`
  defaults to 0, and `TriangleChannel::Reset()` never seeds it to 15, so this
  oracle's triangle reads 0 from power-on until its sequencer first steps.
  nesdev and blargg's `apu_mixer` test say real hardware, and chipvoice,
  read 15 there instead (see `docs/chips/2a03.md`'s "Power-on state").
  Nes_Snd_Emu's triangle has the same limit, in the same direction. Every
  script that never writes the triangle's registers holds it at this
  disagreement for the script's entire length, which is why the sheet's
  per-log table shows 0 % on the triangle line for those logs.
- **The sweep's power-on state.** `SquareChannel::TickSweep()` counts its
  divider from P+1 down to 1, decrementing first and checking the result,
  where nesdev's page (and chipvoice's `clockSweep()`) counts from P down to
  0 and checks first: the same unit, a divider of d in one reading being d+1
  in the other. `Reset()`, though, sets both the divider and the period to
  0, outside that 1 to P+1 range, so the first decrement wraps the byte to
  255, and until a channel's first `$4001`/`$4005` write is followed by a
  half-frame clock, its sweep fires late - by a whole 4-step sequence on
  `script-sweep-up`'s pulse 2. A scratch build with both reset to 1
  (nesdev's 0) matches chipvoice on every edge of both sweep scripts. Nesdev
  does not give the divider's power-on value; songs never see it, since
  chipvoice's driver writes `$4001 = $08` at every note start.
- **An output changes only on a write or a timer tick.** The square channel
  recomputes its output on a register write and on a timer reload;
  `TickEnvelope()` and `TickLengthCounter()` do not, so an envelope step, a
  restart or a length expiry shows up to one timer period late. The noise
  channel recomputes its output only on a timer tick, not even on a write.
  On the hardware the volume is gated straight to the mixer. Every such
  interval in the corpus closes within one timer period, and a scratch build
  that refreshes the output in those places removes all of them.
- **A write on a reload's own cycle.** `WriteRam` runs every channel through
  the write's own cycle before applying it, so a period write that lands on
  the cycle a pulse's timer reloads is not seen by that reload; chipvoice,
  and Nes_Snd_Emu, apply it first, the harness's convention for a write's
  cycle. Twice in the corpus (`song-studio`'s pulse 2, `song-golden`'s pulse
  1), each leaving a constant phase offset for the rest of the song. This
  shim cannot take chipvoice's order without shifting everything else by a
  cycle: the pulse timers here count 2P+1 cycles from where the first period
  write left them, not on a fixed APU-cycle parity, and their phase lines up
  with chipvoice's on this corpus because the reload comes first.
- **The DMC's first byte, and every restart from a cold buffer.** With no
  simulated CPU stall, this oracle's DMC plays its first sample byte 54
  cycles apart from chipvoice's own - the same magnitude the `nes-snd-emu`
  oracle already shows, for an unrelated reason (its power-on bit count
  disagrees with nesdev's; this oracle's does not). Every step after the
  first carries the identical value, just shifted; only a log that restarts
  the channel from a cold buffer (`script-dmc` in the corpus) shows it.

## VRC6 audio (NEXT-14)

NEXT-14's round 2 asked for a second, independent oracle for Konami's VRC6
expansion audio, beside the already-vendored Game_Music_Emu
(`../game-music-emu`). Mesen 2 emulates VRC6 audio too, in
`Core/NES/Mappers/Audio/{Vrc6Audio,Vrc6Pulse,Vrc6Saw}.h` - not
`Core/NES/Mappers/Konami/VRC6.h`, which is the mapper/banking class and only
`#include`s these; the audio classes themselves are what is vendored, under
`vendor/NES/Mappers/Audio/` at the same pinned commit as the rest of this
oracle, plus `NES/APU/BaseExpansionAudio.{h,cpp}`, the abstract base every
expansion-audio chip shares. `NesTypes.h`'s `AudioChannel` enum already
listed `VRC6 = 7` and `NesApu::AddExpansionAudioDelta` already forwarded to
the mixer - both written for a future ticket that turned out to be this one -
so the only shim change VRC6 needed was growing `NesSoundMixer.h`'s
`deltas[]` array from 5 to 8 voices to hold index 7; nothing vendored was
touched in round 2. Round 3 added the one marked, cited exception:
`Vrc6Pulse.h`'s `GetVolume()` carries a small chipvoice patch (see below);
`Vrc6Audio.h` and `Vrc6Saw.h` remain unchanged.

`main-vrc6.cpp` is the second driver ours: it reads a chipvoice VRC6 register
log the same way `main.cpp` reads a 2A03 one, but clocks `Vrc6Audio` directly
through its own `Clock()` rather than through `NesApu::ProcessCpuClock()`
(irrelevant to a cartridge-mapper chip), and prints every change of the
mixer's one VRC6 line as `<cycle> 0 <value>`. There is only one voice, not
three: real Mesen's own `Vrc6Audio::ClockAudio` sums both pulses and the
sawtooth into one `outputLevel` before ever calling
`AddExpansionAudioDelta` - it does not expose them separately, so this oracle
cannot be compared voice by voice the way Game_Music_Emu's can.
`oracles/mesen-vrc6.mjs` compensates on the chipvoice side (`vrc6-combined`
in `chips/vrc6.mjs`'s `chipVrc6Combined`): chipvoice's own three voices,
summed and scaled by 15 the same way, so both sides of the comparison are the
same single quantity.

Mesen is the independent check of exactly what Game_Music_Emu's own
`Nes_Vrc6_Apu` cannot check (see this oracle's - and `../game-music-emu`'s -
own "known limits"): `Vrc6Pulse::Clock` has no period-4-or-under guard,
`Vrc6Saw::WriteReg`'s disable path explicitly zeroes the accumulator
(matching nesdev and this core; Game_Music_Emu's own `run_saw` freezes it
instead), and `$9003` reaches this oracle directly, unlike Game_Music_Emu's
own dispatch, which drops it. `Vrc6Saw::Clock()` does gate its own timer on
`_enabled` - an undocumented deviation from nesdev's text ("clearing E does
not reset the frequency divider") this core does not follow - so the corpus's
own disable/re-enable script (`corpus/vrc6/edge/saw-enable.log`) is written
to keep every disabled span an exact multiple of the saw's own full divider
period, which sidesteps this specific difference rather than measuring it as
a divergence.

One offset applies to every entry this oracle reports, sawtooth or pulse
alike: a flat `-1` cycle, from the same "catch the emulated CPU up to a
write's cycle using the OLD register state, then apply the write" convention
`main-vrc6.cpp` shares with `main.cpp` and with real Mesen calling
`WriteRegister` mid-frame after `ProcessCpuClock` has already run for that
cycle. Measured on `corpus/vrc6/core/saw-worked-example.log` (8999/8999
edges align at shift -1) and independently on `corpus/vrc6/core/
pulse-levels.log` (30/30 edges, no sawtooth activity at all, same shift) -
see `oracles/mesen-vrc6.mjs`'s own comment for the full derivation and why an
earlier, narrower version of this correction scoped it to sawtooth-only logs
before the second measurement showed the scoping was unnecessary.

Every log in `corpus/vrc6/core` and `corpus/vrc6/edge` is 100.0000 % against
this oracle (`check:vrc6-core-mesen`, `check:vrc6-edge-mesen`).

NEXT-14's round 3 went further on the full, duty-generator-active legacy
corpus (`corpus/vrc6`): `vendor/NES/Mappers/Audio/Vrc6Pulse.h` carries a
small, marked chipvoice patch on top of Mesen's otherwise-unmodified pulse,
under a "chipvoice patch" comment marking exactly what changed and when and
citing the mechanism in full, per GPL-3.0 5(a) ("The work must carry
prominent notices stating that you modified it, and giving a relevant
date"). The one line it changes is `GetVolume()`'s duty comparison, from
`_step <= _dutyCycle` to `_step >= (uint8_t)(15 - _dutyCycle)`. The reason:
Mesen's `_step` counts up (0 to 15, wrapping, reset to 0 on disable);
chipvoice's own `step` (`vrc6.ts`) counts down (15 to 0, wrapping, reset to
15 on the disable-to-enable edge); both freeze while disabled and both
re-anchor at that same edge on every subsequent disable/re-enable, so the
identity `s' = 15 - s` (chipvoice's counter s', Mesen's s) holds from the
first edge onward for any sequence of period, duty or enable writes, not
just for a run with a fixed duty - substituting it into chipvoice's own
`s' <= dutyCycle` gives exactly the changed line. `docs/chips/vrc6.md`'s "The
pulse mapping" has the full derivation and the direct, oracle-against-oracle
measurement against Game_Music_Emu showing why that oracle's own pulse
cannot take the same mapping (its `phase` never re-anchors on any
disable/re-enable, unlike this oracle's `_step`).

Round 4's correction (this file's earlier wording overclaimed what this
patch, and the gate it enables, prove): this is not a neutral relabelling of
two conventions that were always going to agree. It changes this oracle's
OBSERVABLE output. Unpatched, a pulse here is HIGH for the first D+1 steps
after an enable, then low; Game_Music_Emu's own pulse (power-on `phase = 1`)
is high-first too. chipvoice's own core is low-first: LOW for the first
15-D steps, then at volume for D+1 - nesdev's VRC6 audio page, read
literally ("counting down from 15 to 0... less than or equal to the given
duty cycle D, the channel volume V is output, otherwise 0"). The patch makes
THIS oracle low-first too, i.e. it makes Mesen adopt chipvoice's own
nesdev-literal duty-phase reading - not a convention both sides already
shared. Consequence: on duty phase alone, `check:vrc6-flat-mesen`'s
100.0000 % is NOT independent evidence, because the patch is precisely what
forces phase agreement. What it DOES remain independent evidence for,
unaffected by the patch, is everything the patch does not touch: the
divider's own cadence, step timing relative to the period register, freezing
while disabled, re-anchoring at each enable edge, and the output levels
themselves. Whose duty-phase reading is hardware-correct was, as of round 4,
undetermined: this core follows nesdev's text, both Mesen 2 and
Game_Music_Emu (unpatched) disagree with that reading, and no real VRC6
cartridge had been captured to check any of the three against hardware.
Round 5 found it was already settled, published, without a hardware
purchase: rainwarrior, hotswapping a real Esper Dream 2 VRC6 cartridge on
real hardware (nesdev forums, "VRC6 $9003 audio enable register?", 12 August
2012), reported the pulse is low-first ("the pulse duty cycles begin with 0
and end at the volume setting") - this core's own reading, not the
unpatched oracle's; neither Mesen 2 nor Game_Music_Emu cites a measurement
for its own high-first choice. `docs/chips/vrc6.md`'s "Hardware evidence"
has the full source table; `docs/BACKLOG.md`'s NEXT-14 entry records the
round. With the patch, the four flat-corpus scripts that
disable and re-enable a pulse but never the sawtooth (`script-duty`,
`script-pulse-both`, `script-pulse-enable`, `script-pulse-periods`) gate at a
literal 100.0000 % against this oracle too (`check:vrc6-flat-mesen`), the
same as `core` and `edge`.

`check:vrc6-core-mesen`/`check:vrc6-edge-mesen` are unaffected by the patch
(still 100.0000 %) for a reason that has nothing to do with duty-phase
agreement at all, and round 3's original explanation for it was wrong: it is
not that "every script there already held duty and period fixed across an
enable span, where the mapped and the original condition agree" - a fixed
duty does not make the two counting directions phase-agree, full stop. The
real reason, confirmed directly against the corpus: every `$9000`/`$A000`
write in `corpus/vrc6/core/*.log` and `corpus/vrc6/edge/pulse-enable.log`
sets bit 7 (M, "ignore duty") - this corpus's own values include `89`, `85`,
every byte from `80` to `BB`, and `8D`, all with bit 7 set - which bypasses
the duty generator entirely on both sides (`_ignoreDuty`/`mode`, both return
`_volume`/`volume` unconditionally, never consulting `_step`/`step` at all).
Before round 3, no exact gate against Mesen exercised the duty generator at
all; `check:vrc6-flat-mesen` is the first one that does, and it is exact for
every reason above except duty-phase polarity itself.

The other three legacy-corpus scripts (`script-all-three`, `script-saw-
enable`, `script-saw-rates`) disable and re-enable the sawtooth, not just a
pulse, and stay on the pre-round-3 no-regression baseline convention
(`check:vrc6-mesen`), for a different, genuine reason: `Vrc6Saw::Clock()`
gates its whole body, the frequency divider included, behind `if(_enabled)`,
so the divider pauses entirely while disabled and resumes from wherever it
stopped, where chipvoice's own `Vrc6Saw.clockDivider()` ticks unconditionally
every cycle, following nesdev's text literally ("clearing E does not reset
the frequency divider, however"). `docs/chips/vrc6.md`'s "The sawtooth's
divider across a disable" has the first-divergence cycle for each. This is
the same divider-freeze behaviour `corpus/vrc6/edge/saw-enable.log` already
sidesteps by construction (its disabled spans are exact multiples of the
saw's own full divider period, so a paused and a continuously-ticking
divider reach the same next firing either way), noted above; the flat corpus
was not built with that constraint, so it is the one that exposes it as a
measured divergence rather than avoiding it. A fourth flat-corpus script,
`script-saw-worked-example`, used to sit at 99.9972 % against this oracle for
an unrelated reason - not the sawtooth-disable behaviour above, but two
distinct harness bugs (one in this oracle's own `main-vrc6.cpp`, one in
Game_Music_Emu's driver) that both clipped its very last edge, exactly on the
log's own cycle budget; round 4 found and fixed both (see `main-vrc6.cpp`'s
and `main.cpp`'s own comments on the delta filter, and `docs/chips/vrc6.md`'s
"The sawtooth's divider across a disable"), so this script now gates exact
too and has moved out of `check:vrc6-flat-mesen`'s exclude list.

## Build

Needs a C++17 compiler and nothing else: no extra system packages, no
libraries beyond the standard one. Builds clean, no warnings suppressed
beyond `-w`, with clang (macOS, used locally) and gcc (`ubuntu-latest`, used
in CI).

## Trusted voices

All five: p1, p2, tri, noi, dmc. Unlike `nes-snd-emu`, this oracle's noise
starts at the documented power-on value, runs with the documented polarity
and feedback tap, and is clocked exactly while muted, so its bit pattern is
checked too - the one thing `nes-snd-emu` cannot settle. Its one settled
limit is the triangle's power-on value above, which is a known, understood
difference from both this oracle and hardware, not a live question the sheet
still needs answered.
