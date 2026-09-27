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
- `shim/NES/NesCpu.h` / `.cpp` - a cycle counter, the `IRQSource` flags the
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
- **A freshly-armed sweep's first step.** `SquareChannel::TickSweep()`
  decrements its divider first and checks the result against zero; nesdev's
  sweep page gives the algorithm the other way around - check the divider
  against zero, *then* reload or decrement it - which is what
  `packages/chipvoice/src/chips/nes/dsp.ts`'s `clockSweep()` does verbatim.
  From a freshly-written sweep, that ordering difference costs one extra
  half-frame clock before this oracle's first period step, once per unit of
  the divider's period. The target-period arithmetic itself (the mute
  thresholds, pulse 1's extra minus one) matches exactly; only this timing
  does not. See `docs/chips/2a03.md`'s second-oracle section for the
  corpus numbers this produces. Filed as a finding for a later ticket
  (P2-1), not fixed here.
- **The DMC's first byte, and every restart from a cold buffer.** With no
  simulated CPU stall, this oracle's DMC plays its first sample byte 54
  cycles apart from chipvoice's own - the same magnitude the `nes-snd-emu`
  oracle already shows, for an unrelated reason (its power-on bit count
  disagrees with nesdev's; this oracle's does not). Every step after the
  first carries the identical value, just shifted; only a log that restarts
  the channel from a cold buffer (`script-dmc` in the corpus) shows it.

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
