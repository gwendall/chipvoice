// Ours. Real Mesen's NesCpu is a full 6502 core plus DMA/DMC-stall modelling.
// The vendored APU code only ever calls five things on it: GetCycleCount
// (for two write-timing parity checks), SetIrqSource/ClearIrqSource/
// HasIrqSource (the frame counter and DMC IRQ flags, which this oracle's
// register-log-only comparison never reads back), and StartDmcTransfer/
// StopDmcTransfer for the DMC's sample DMA.
//
// There is no real CPU or DMA in this harness, so StartDmcTransfer (defined
// in NesCpu.cpp, where NesApu's full definition is visible) fetches the
// sample byte from the console's memory image and hands it back to the APU
// synchronously, with none of the CPU-stall cycles a real DMA would cost. Per
// the ticket this drives: a log-driven run has no CPU to stall, and the
// DMA's stall does not change the APU's own timing, only the CPU's - see the
// oracle README's "DMC memory reads" section.
#pragma once
#include "pch.h"
#include "NES/NesTypes.h"

class NesConsole;

class NesCpu
{
public:
	NesConsole* console = nullptr;
	uint64_t cycleCount = 0;
	uint8_t irqSources = 0;

	uint64_t GetCycleCount() { return cycleCount; }
	void SetIrqSource(IRQSource source) { irqSources |= (uint8_t) source; }
	void ClearIrqSource(IRQSource source) { irqSources &= ~(uint8_t) source; }
	bool HasIrqSource(IRQSource source) { return (irqSources & (uint8_t) source) != 0; }

	// Advances the cycle counter main.cpp keeps in lockstep with NesApu's own
	// internal cycle count (see main.cpp's driving loop).
	void Tick() { cycleCount++; }

	void StartDmcTransfer();
	void StopDmcTransfer() { }
};
