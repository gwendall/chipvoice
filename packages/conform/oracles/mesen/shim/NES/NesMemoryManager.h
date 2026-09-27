// Ours. Real Mesen's NesMemoryManager maps the whole 64KB CPU address space
// (RAM, PPU/APU registers, cartridge, mapper) and tracks open-bus behavior.
// This oracle only ever writes APU registers ($4000-$4017), so this shim
// dispatches writes for just that window, to whichever vendored channel or
// frame-counter object registered itself for that address via
// RegisterIODevice - the same mechanism real Mesen uses, at a reduced scale.
// Reads and open-bus are stubbed at 0: this oracle only ever replays writes
// from a register log, it never reads APU registers back.
#pragma once
#include "pch.h"
#include "NES/INesMemoryHandler.h"

class NesMemoryManager
{
private:
	static constexpr uint16_t Base = 0x4000;
	static constexpr int Size = 0x20; // covers $4000-$401F

	INesMemoryHandler* _handlers[Size] = {};

public:
	void RegisterIODevice(INesMemoryHandler* handler)
	{
		MemoryRanges ranges;
		handler->GetMemoryRanges(ranges);
		for (uint16_t addr : *ranges.GetRAMWriteAddresses()) {
			if (addr >= Base && addr < Base + Size) {
				_handlers[addr - Base] = handler;
			}
		}
	}

	void Write(uint16_t addr, uint8_t value)
	{
		if (addr >= Base && addr < Base + Size && _handlers[addr - Base]) {
			_handlers[addr - Base]->WriteRam(addr, value);
		}
	}

	uint8_t GetOpenBus(uint8_t mask = 0xFF) { (void) mask; return 0; }
	uint8_t GetInternalOpenBus(uint8_t mask = 0xFF) { (void) mask; return 0; }
};
