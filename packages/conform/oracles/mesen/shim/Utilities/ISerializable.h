// Ours. Same interface shape as Mesen's real Utilities/ISerializable.h (a
// single pure-virtual Serialize method), reproduced here so the vendored APU
// classes have something to override; see Utilities/Serializer.h for why the
// method itself is never actually invoked by this oracle.
#pragma once

class Serializer;

class ISerializable
{
public:
	virtual void Serialize(Serializer& s) = 0;
	virtual ~ISerializable() = default;
};
