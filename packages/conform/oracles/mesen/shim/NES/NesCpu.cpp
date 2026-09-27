// Ours. Split from NesCpu.h because this needs NesApu's full definition
// (vendored) and NesConsole's full definition (ours), and both of those
// headers only forward-declare NesCpu - see NesCpu.h for why StartDmcTransfer
// works this way.
#include "pch.h"
#include "NES/NesCpu.h"
#include "NES/NesConsole.h"
#include "NES/APU/NesApu.h"

void NesCpu::StartDmcTransfer()
{
	NesApu* apu = console->GetApu();
	uint16_t addr = apu->GetDmcReadAddress();
	uint8_t value = console->memory[addr];
	apu->SetDmcReadBuffer(value);
}
