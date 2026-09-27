// Ours. Real Mesen's Serializer is a full binary/map (de)serializer used for
// save states and the debugger's state view, with overloads for every field
// type in the emulator. This oracle only ever drives the APU forward from a
// register log - it never saves or loads state - so every Serialize() method
// the vendored code defines is dead code that must compile, not work. Stream
// is therefore a no-op for any type, and SV keeps Mesen's own macro spelling
// so the vendored Serialize() bodies need no changes.
#pragma once

enum class SerializeFormat
{
	Binary,
	Map,
};

class Serializer
{
public:
	SerializeFormat GetFormat() { return SerializeFormat::Binary; }
	bool IsSaving() { return true; }

	template<typename T>
	void Stream(T&, const char*) { }
};

#define SV(var) (s.Stream(var, #var))
