// Ours. Real Mesen's NesConsole owns the whole machine: cartridge, mapper,
// CPU, PPU, controllers, the APU, and wiring between all of them. This oracle
// only ever drives the APU, so this shim is just a bag of pointers and the
// handful of accessors the vendored APU code calls on "the console" -
// GetApu/GetCpu/GetMemoryManager/GetSoundMixer/GetEmulator/GetRegion/
// GetNesConfig/GetMasterClock/SetNextFrameOverclockStatus - plus the flat
// 64KB memory image the DMC's DMA shim (NesCpu::StartDmcTransfer, in
// NesCpu.cpp) reads sample bytes from. main.cpp wires the pointers together
// before constructing NesApu.
#pragma once
#include "pch.h"
#include "Shared/SettingTypes.h"

class NesApu;
class NesCpu;
class NesMemoryManager;
class NesSoundMixer;
class Emulator;

class NesConsole
{
public:
	NesApu* apu = nullptr;
	NesCpu* cpu = nullptr;
	NesMemoryManager* memoryManager = nullptr;
	NesSoundMixer* soundMixer = nullptr;
	Emulator* emulator = nullptr;

	ConsoleRegion region = ConsoleRegion::Ntsc;
	NesConfig nesConfig = {};
	uint64_t masterClock = 0;

	// The CPU's address space, filled from the log's `# memory ADDR: hex`
	// lines. The DMC's DMA shim reads sample bytes from it.
	uint8_t memory[0x10000] = {};

	NesApu* GetApu() { return apu; }
	NesCpu* GetCpu() { return cpu; }
	NesMemoryManager* GetMemoryManager() { return memoryManager; }
	NesSoundMixer* GetSoundMixer() { return soundMixer; }
	Emulator* GetEmulator() { return emulator; }
	ConsoleRegion GetRegion() { return region; }
	NesConfig& GetNesConfig() { return nesConfig; }
	uint64_t GetMasterClock() { return masterClock; }

	// Only used by the DMC's $4011-popping-reduction and $4012/$4013
	// overclock-skip heuristics, both of which are about smoothing DMC audio
	// glitches on real hardware timing; this oracle has no frame overclocking
	// concept, so it is a no-op.
	void SetNextFrameOverclockStatus(bool) { }
};
