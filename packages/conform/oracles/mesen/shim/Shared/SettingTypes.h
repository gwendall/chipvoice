// Ours. Mesen's real Shared/SettingTypes.h defines every setting for every
// console it supports (SNES, Game Boy, PC Engine, ...) in one large file.
// The vendored 2A03 APU code only reads two things from it: the console's
// region, and seven accuracy/compatibility toggles on NesConfig. This shim
// defines just those, with the toggles left at Mesen's own documented
// defaults (Core/Shared/SettingTypes.h: all false, i.e. "most accurate").
#pragma once

enum class ConsoleRegion
{
	Auto,
	Ntsc,
	Pal,
	Dendy,
};

struct NesConfig
{
	bool SwapDutyCycles = false;
	bool DisableNoiseModeFlag = false;
	bool EnableDmcSampleDuplicationGlitch = false;
	bool ReduceDmcPopping = false;
	bool SilenceTriangleHighFreq = false;
	bool ReverseDpcmBitOrder = false;
	bool EnableCpuTestMode = false;
};
