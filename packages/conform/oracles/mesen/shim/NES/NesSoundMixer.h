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

	// Index matches AudioChannel / chipvoice's own voice order: p1, p2, tri,
	// noi, dmc. Channels 5 and up (FDS, MMC5, ...) are expansion audio this
	// oracle never wires up, and are dropped.
	static constexpr int VoiceCount = 5;
	vector<MixerDelta> deltas[VoiceCount];

	uint64_t base = 0;

	void AddDelta(AudioChannel channel, uint32_t time, int16_t delta)
	{
		int voice = (int) channel;
		if (voice < 0 || voice >= VoiceCount) {
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
