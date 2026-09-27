// Ours. Real Mesen's Emulator is the whole application: settings, the run
// loop, save states, debuggers. NesApu.cpp only ever calls GetSettings() (and
// stores the result in a field it never actually reads again in the vendored
// code) and IsEmulationThread() (only on a PeekRam() path this oracle never
// exercises, since it never reads APU registers back). Both are stubbed.
#pragma once

class EmuSettings;

class Emulator
{
public:
	EmuSettings* GetSettings() { return nullptr; }
	bool IsEmulationThread() { return true; }
};
