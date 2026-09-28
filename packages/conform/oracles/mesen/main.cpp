// The Mesen 2 oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header,
// `# memory ADDR: hex` lines for the DMC's sample data, then one write per
// line as `<cycle> <addr hex> <value hex>` in cycle order - drives Mesen's
// vendored NES APU with it, and prints every change of every voice's value
// as `<cycle> <voice> <value>`, in cycle order. Voices are 0 to 4: square 1,
// square 2, triangle, noise, DMC - see README.md for exactly what each
// voice's value means and how it maps to chipvoice's own trace.
//
// Unlike blargg's Nes_Apu (see the nes-snd-emu oracle), Mesen's NesApu has no
// single write_register(cycle, ...)/run_until(cycles) entry point: it is
// driven one CPU cycle at a time via ProcessCpuClock(), and registers are
// written through a memory manager that dispatches to whichever channel
// object claimed that address. This loop reproduces the same convention
// nes-snd-emu's driver relies on regardless: run the APU forward to exactly
// the write's cycle (using the OLD register value), then apply the write, so
// the new value governs from that cycle onward. See NesApu::WriteRam in the
// vendored source (every channel's WriteRam calls _console->GetApu()->Run()
// first) for why that is also Mesen's own convention.
//
// The amplitude of a voice is the running sum of the deltas its ApuTimer
// handed the recorder in NesSoundMixer.h. A delta of zero is never recorded,
// but two deltas on the same cycle are, so the sum is taken per cycle before
// a change is reported - exactly as in the nes-snd-emu oracle's main.cpp.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "NES/APU/NesApu.h"
#include "NES/NesConsole.h"
#include "NES/NesCpu.h"
#include "NES/NesMemoryManager.h"
#include "NES/NesSoundMixer.h"

static void load_memory(NesConsole& console, const char* line)
{
	unsigned addr;
	int used = 0;
	if (sscanf(line, "# memory %x: %n", &addr, &used) < 1 || used == 0)
		return;
	const char* p = line + used;
	while (p[0] && p[1] && addr < 0x10000)
	{
		unsigned byte;
		if (sscanf(p, "%2x", &byte) != 1)
			break;
		console.memory[addr++] = (unsigned char) byte;
		p += 2;
	}
}

struct Change {
	long cycle;
	int voice;
	int value;
};

static bool before(const Change& a, const Change& b) {
	if (a.cycle != b.cycle) return a.cycle < b.cycle;
	return a.voice < b.voice;
}

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

	// NesApu's constructor registers each channel and the frame counter with
	// the memory manager, then calls Reset(false) - Mesen's own power-on.
	NesApu apu(&console);
	console.apu = &apu;

	// NesApu itself claims the $4015 write range (channel enable) in its own
	// GetMemoryRanges, but - like real Mesen - never registers itself; the
	// console does that once the APU exists.
	memoryManager.RegisterIODevice(&apu);

	// The frame counter's step-cycle table (ApuFrameCounter::_stepCycles) is
	// only ever filled by SetRegion, never by Reset; without this call it
	// stays all zero and ApuFrameCounter::Run never advances, spinning
	// forever the first time the APU is run. Real Mesen's console calls this
	// once at startup for the same reason.
	apu.SetRegion(ConsoleRegion::Ntsc, true);

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
			else if (strncmp(line, "# memory ", 9) == 0)
				load_memory(console, line);
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
		// A driver schedules past the end of what it renders - note-offs, a
		// lookahead - and those writes cannot reach the compared range.
		if (cycles >= 0 && cycle >= cycles)
			continue;
		last = cycle;

		// Run the APU (and its cycle counter) forward to this write's cycle
		// with the OLD register value, then apply the write - see the
		// header comment above.
		while ((long) globalCycle < cycle)
		{
			apu.ProcessCpuClock();
			cpu.Tick();
			globalCycle++;
		}
		memoryManager.Write((uint16_t) addr, (uint8_t) value);
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
		globalCycle++;
	}
	// NesApu::Run() is only called lazily (register reads/writes, IRQs due
	// soon, an approaching frame-counter step) - ProcessCpuClock() alone can
	// leave several hundred or thousand cycles' worth of channel/timer state
	// un-caught-up. One last explicit Run() flushes every pending change up
	// to exactly `cycles`, at each change's true original cycle (ApuTimer::
	// Run's while loop replays deferred timer fires one at a time, each at
	// its own reconstructed cycle) - nothing is lost, only its recording is
	// delayed. Without this, changes near the end of a log could be dropped.
	apu.Run();

	std::vector<Change> changes;
	for (int v = 0; v < NesSoundMixer::VoiceCount; v++)
	{
		std::vector<MixerDelta> const& deltas = mixer.deltas[v];
		long amp = 0;
		for (size_t i = 0; i < deltas.size(); )
		{
			uint64_t time = deltas[i].cycle;
			long before_ = amp;
			while (i < deltas.size() && deltas[i].cycle == time)
				amp += deltas[i++].delta;
			// `<=`, not `<` - see `main-vrc6.cpp`'s own copy of this comment
			// for the mechanism and why widening it is safe.
			if (amp != before_ && (long) time <= cycles)
			{
				Change c = { (long) time, v, (int) amp };
				changes.push_back(c);
			}
		}
	}
	std::stable_sort(changes.begin(), changes.end(), before);

	for (size_t i = 0; i < changes.size(); i++)
		printf("%ld %d %d\n", changes[i].cycle, changes[i].voice, changes[i].value);
	return 0;
}
