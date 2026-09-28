// Ours. Real Mesen's NesSoundMixer resamples every channel into a stereo
// audio stream with panning/filters/blip_buf. This oracle never listens to
// the audio - it only needs the change stream each ApuTimer::AddOutput hands
// AddDelta - so this shim just records (channel, absolute cycle, delta)
// instead of mixing anything, one vector per voice.
//
// AddDelta's `time` argument is relative to the current mixer frame, which
// NesApu::Exec ends the instant _currentCycle reaches CycleLength - 1 (see
// NesApu.cpp) and then resets to 0 - so a frame is CycleLength - 1 cycles
// long, not CycleLength; PlayAudioBuffer(cycle) is what EndFrame calls right
// before that reset, with cycle always equal to CycleLength - 1 in practice.
// `base` accumulates the true length of every frame seen so far (by adding
// the exact argument PlayAudioBuffer was called with, not the CycleLength
// constant), so base + time recovers the absolute cycle main.cpp drove the
// APU to, exactly the quantity the log's cycles are counted in. An earlier
// version of this shim multiplied a frame count by CycleLength instead,
// which overcounted by one cycle per completed frame and drifted noticeably
// over a log of more than a few frames.
#pragma once
#include "pch.h"
#include "NES/NesTypes.h"

struct MixerDelta
{
	uint64_t cycle;
	int16_t delta;
};

class NesSoundMixer
{
public:
	static constexpr uint32_t CycleLength = 10000;

	// Index matches AudioChannel. 0-4 are the 2A03's own p1, p2, tri, noi, dmc
	// (chipvoice's own voice order too); 5 and 6 (FDS, MMC5) are expansion
	// audio neither oracle driver wires up and stay perpetually empty; 7 is
	// VRC6, wired up by main-vrc6.cpp only. Bumped from 5 to 8 for NEXT-14
	// (decision 38's second expansion-audio ticket) rather than adding a
	// second mixer type, since an always-empty `deltas[5]`/`deltas[6]` costs
	// nothing and every future expansion chip through Sunsoft 5B (index 10)
	// will want the same array grown further, not replaced.
	static constexpr int VoiceCount = 8;
	vector<MixerDelta> deltas[VoiceCount];

	uint64_t base = 0;

	void AddDelta(AudioChannel channel, uint32_t time, int16_t delta)
	{
		int voice = (int) channel;
		if (voice < 0 || voice >= VoiceCount) {
			return;
		}
		// The 2A03's own channels only ever call this on an actual output
		// change (real Mesen's ApuTimer/SquareChannel/etc. convention), so a
		// zero delta was never observed here before NEXT-14. Vrc6Audio's
		// ClockAudio (vendored, unchanged) calls this every single CPU cycle
		// unconditionally, delta zero or not - dropping the zero ones changes
		// no running sum (adding zero is a no-op) and keeps a multi-million-
		// cycle VRC6 log's vector from holding one entry per cycle.
		if (delta == 0) {
			return;
		}
		uint64_t absoluteCycle = base + time;
		deltas[voice].push_back({absoluteCycle, delta});
	}

	void PlayAudioBuffer(uint32_t cycle)
	{
		base += cycle;
	}
};
