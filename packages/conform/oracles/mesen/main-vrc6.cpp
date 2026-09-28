// The Mesen 2 VRC6 oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header, then
// one write per line as `<cycle> <addr hex> <value hex>` in cycle order -
// drives Mesen's vendored `Vrc6Audio` with it, and prints every change of
// its single mixed value as `<cycle> <voice> <value>`, voice always 0 (the
// combined VRC6 line, the same convention `oracles/mesen.mjs`'s `main.cpp`
// uses for the 2A03's five separate voices, but VRC6 has one summed output
// here since that is all real Mesen's own `Vrc6Audio::ClockAudio` computes -
// see below for why this oracle cannot separate the three VRC6 voices the
// way chipvoice's own `Vrc6Apu.trace()` does).
//
// This reuses the same `NesConsole`/`NesCpu`/`NesMemoryManager`/
// `NesSoundMixer` shim stack `main.cpp` (the 2A03 driver) already sets up,
// purely as the vessel `Vrc6Audio` needs to compile and run: it calls
// `_console->GetApu()->AddExpansionAudioDelta(...)` and
// `_console->GetApu()->IsApuEnabled()`, so a real (if otherwise idle)
// `NesApu` has to exist and be wired into the console. `apu.IsApuEnabled()`
// is true from construction and nothing here ever calls `SetApuStatus(false)`,
// so the gate `BaseExpansionAudio::Clock()` applies is always open.
//
// `apu.ProcessCpuClock()` is still called once per cycle, in lockstep with
// `vrc6.Clock()`, even though no 2A03 register is ever written in a VRC6-only
// log and its five channels stay silent throughout: `NesApu::
// AddExpansionAudioDelta` timestamps every delta with `_currentCycle`, which
// only `ProcessCpuClock()` advances (`vrc6.Clock()` alone never touches it),
// and `NesSoundMixer::AddDelta`'s `base + time` absolute-cycle reconstruction
// depends on `_mixer->PlayAudioBuffer()` being called every `CycleLength`
// cycles, which only happens from inside `NesApu::Exec()`, reached the same
// way. Skipping this left every delta timestamped at cycle 0 the first time
// this driver was tried - caught by the corpus's own worked example
// collapsing to a single reported change instead of the expected repeating
// ramp. Real hardware clocks the 2A03 APU and the cartridge's own mapper
// audio off the same CPU cycle regardless of whether a game ever touches
// $4000-$4013, so this is not a divergence from anything real, just this
// shim needing the same "frame" bookkeeping the 2A03 driver already relies
// on for the same reason.
//
// `Vrc6Audio::WriteRegister` is called directly, not through
// `NesMemoryManager`: real Mesen's mapper (`VRC6.h`, not vendored - it is
// cartridge-banking machinery irrelevant to audio) is what claims
// $9000-$9003/$A000-$A002/$B000-$B002 and forwards to `_audio->WriteRegister`;
// this driver already knows every write in a chipvoice VRC6 log is one of
// those ten addresses, so it skips reproducing the mapper's own address
// decode and calls the audio object directly, the same simplification
// `oracles/game-music-emu`'s `main.cpp` makes for `Nes_Vrc6_Apu::write_osc`.
//
// The catch-up convention is the same as `main.cpp`'s: run every pending CPU
// cycle forward with the OLD register state (via `vrc6.Clock()`, once per
// cycle) before applying a write, so the new value governs from that cycle
// onward - matching `Vrc6Audio::WriteRegister` being called mid-frame in
// real Mesen, after `ProcessCpuClock()` has already clocked the audio for
// cycles up to but not including the write's own.
//
// Why one voice, not three: `Vrc6Audio::ClockAudio` (vendored, unchanged)
// sums `_pulse1.GetVolume() + _pulse2.GetVolume() + _saw.GetVolume()` into a
// single `outputLevel` before ever calling `AddExpansionAudioDelta` - real
// Mesen's own mixer never sees the three VRC6 voices separately, only their
// sum. This driver cannot report vp1/vp2/vsaw individually without changing
// vendored code, which decision 41 and this ticket's own instructions both
// rule out ("shim only what they call into"). `oracles/mesen-vrc6.mjs`
// compensates by summing chipvoice's own three voices (each 0-15, 0-15, 0-31)
// the same way before comparing, and multiplying by 15 to match
// `ClockAudio`'s own `* 15` scaling - see its own comment for the exact
// formula and what this does and does not let the harness check (it proves
// the combined level at every cycle, not which of the three voices produced
// it, which chipvoice's `trace()` reports individually and Game_Music_Emu's
// oracle already covers per-voice).

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "NES/APU/BaseExpansionAudio.h"
#include "NES/APU/NesApu.h"
#include "NES/Mappers/Audio/Vrc6Audio.h"
#include "NES/NesConsole.h"
#include "NES/NesCpu.h"
#include "NES/NesMemoryManager.h"
#include "NES/NesSoundMixer.h"

struct Change {
	long cycle;
	int value;
};

int main()
{
	NesConsole console;
	NesCpu cpu;
	NesMemoryManager memoryManager;
	NesSoundMixer mixer;

	cpu.console = &console;
	console.cpu = &cpu;
	console.memoryManager = &memoryManager;
	console.soundMixer = &mixer;
	console.region = ConsoleRegion::Ntsc;

	NesApu apu(&console);
	console.apu = &apu;
	apu.SetRegion(ConsoleRegion::Ntsc, true);

	Vrc6Audio vrc6(&console);

	long cycles = -1;
	uint64_t globalCycle = 0;
	char line[1024];
	long last = 0;
	while (fgets(line, sizeof line, stdin))
	{
		if (line[0] == '#')
		{
			if (strncmp(line, "# cycles:", 9) == 0)
				cycles = strtol(line + 9, NULL, 10);
			continue;
		}
		long cycle;
		unsigned addr, value;
		if (sscanf(line, "%ld %x %x", &cycle, &addr, &value) != 3)
			continue;
		if (cycle < last)
		{
			fprintf(stderr, "writes out of order at cycle %ld\n", cycle);
			return 1;
		}
		if (cycles >= 0 && cycle >= cycles)
			continue;
		last = cycle;

		while ((long) globalCycle < cycle)
		{
			apu.ProcessCpuClock();
			cpu.Tick();
			vrc6.Clock();
			globalCycle++;
		}
		vrc6.WriteRegister((uint16_t) addr, (uint8_t) value);
	}
	if (cycles < 0)
	{
		fprintf(stderr, "no `# cycles:` header before the first write\n");
		return 1;
	}
	while ((long) globalCycle < cycles)
	{
		apu.ProcessCpuClock();
		cpu.Tick();
		vrc6.Clock();
		globalCycle++;
	}
	// Consistency with main.cpp's own final flush; ProcessCpuClock() is
	// called every cycle above rather than lazily skipped ahead, so there
	// should be no pending deferred 2A03 state left for this to catch, but
	// costs nothing to call.
	apu.Run();

	std::vector<Change> changes;
	std::vector<MixerDelta> const& deltas = mixer.deltas[(int) AudioChannel::VRC6];
	long amp = 0;
	for (size_t i = 0; i < deltas.size(); )
	{
		uint64_t time = deltas[i].cycle;
		long before = amp;
		while (i < deltas.size() && deltas[i].cycle == time)
			amp += deltas[i++].delta;
		// `<=`, not `<`: `main-vrc6.cpp`'s own final clock loop, just above,
		// clocks exactly `cycles` ticks, ending with `globalCycle == cycles`,
		// and the mixer timestamps a delta produced by that very last tick
		// with `_currentCycle`'s value AFTER `ProcessCpuClock()` has already
		// advanced it for that tick - i.e. `cycles` itself, one past the
		// tick's own 0-based index. A log whose very last register change
		// lands exactly there (`corpus/vrc6/script-saw-worked-example.log`
		// is the corpus case that hits it) had that one change silently
		// dropped by a strict `<` here, in BOTH this oracle's driver and
		// Game_Music_Emu's own (`oracles/game-music-emu/main.cpp`) - not a
		// VRC6-specific bug, the same off-by-one this project's own comment
		// two lines above already half-diagnoses ("changes near the end of a
		// log could be dropped"), just one cycle short of catching it. Safe
		// for every chip this idiom is shared with (`git grep -n
		// 'time < cycles'` under `oracles/`): `compare.mjs` only ever
		// consults a change whose cycle is strictly less than the log's own
		// `cycles` bound, so admitting one at exactly `cycles` here changes
		// nothing unless some later step in the pipeline shifts it down into
		// that window - which happens only for this oracle's own unconditional
		// `CYCLE_OFFSET` and Game_Music_Emu's per-cycle sawtooth correction
		// (`oracles/game-music-emu.mjs`); every other consumer of this same
		// filter (`oracles/mesen/main.cpp`, `oracles/gb-snd-emu/main.cpp`,
		// `oracles/nes-snd-emu/main.cpp`) applies no such shift, so widening
		// their own copies of this filter the same way is a no-op there,
		// confirmed by running every 2A03/GB baseline unchanged after doing so.
		if (amp != before && (long) time <= cycles)
			changes.push_back({ (long) time, (int) amp });
	}

	for (size_t i = 0; i < changes.size(); i++)
		printf("%ld 0 %d\n", changes[i].cycle, changes[i].value);
	return 0;
}
