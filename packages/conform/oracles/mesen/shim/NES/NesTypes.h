// Ours, but not really "ours" in content: Mesen's real NES/NesTypes.h is one
// shared header mixing APU, CPU, PPU, cartridge and mapper types together.
// This trims it to only what the vendored APU files use - the IRQSource,
// MemoryOperation and AudioChannel enums, and the six Apu*State structs
// GetState() builds - with names, fields and values copied verbatim from
// upstream so the vendored code compiles unchanged. The PPU/cartridge/mapper
// declarations, and the BaseState base class they depend on, are left out.
#pragma once

enum class IRQSource
{
	External = 1,
	FrameCounter = 2,
	DMC = 4,
	FdsDisk = 8,
	Epsm = 16
};

enum class MemoryOperation
{
	Read = 1,
	Write = 2,
	Any = 3
};

enum class AudioChannel
{
	Square1 = 0,
	Square2 = 1,
	Triangle = 2,
	Noise = 3,
	DMC = 4,
	FDS = 5,
	MMC5 = 6,
	VRC6 = 7,
	VRC7 = 8,
	Namco163 = 9,
	Sunsoft5B = 10
};

struct ApuLengthCounterState
{
	bool Halt;
	uint8_t Counter;
	uint8_t ReloadValue;
};

struct ApuEnvelopeState
{
	bool StartFlag;
	bool Loop;
	bool ConstantVolume;
	uint8_t Divider;
	uint8_t Counter;
	uint8_t Volume;
};

struct ApuSquareState
{
	uint8_t Duty;
	uint8_t DutyPosition;
	uint16_t Period;
	uint16_t Timer;

	bool SweepEnabled;
	bool SweepNegate;
	uint8_t SweepPeriod;
	uint8_t SweepShift;

	bool Enabled;
	uint8_t OutputVolume;
	double Frequency;

	ApuLengthCounterState LengthCounter;
	ApuEnvelopeState Envelope;
};

struct ApuTriangleState
{
	uint16_t Period;
	uint16_t Timer;
	uint8_t SequencePosition;

	bool Enabled;
	double Frequency;
	uint8_t OutputVolume;

	uint8_t LinearCounter;
	uint8_t LinearCounterReload;
	bool LinearReloadFlag;

	ApuLengthCounterState LengthCounter;
};

struct ApuNoiseState
{
	uint16_t Period;
	uint16_t Timer;
	uint16_t ShiftRegister;
	bool ModeFlag;

	bool Enabled;
	double Frequency;
	uint8_t OutputVolume;

	ApuLengthCounterState LengthCounter;
	ApuEnvelopeState Envelope;
};

struct ApuDmcState
{
	double SampleRate;
	uint16_t SampleAddr;
	uint16_t NextSampleAddr;
	uint16_t SampleLength;

	bool Loop;
	bool IrqEnabled;
	uint16_t Period;
	uint16_t Timer;
	uint16_t BytesRemaining;

	uint8_t OutputVolume;
};

struct ApuFrameCounterState
{
	bool FiveStepMode;
	uint8_t SequencePosition;
	bool IrqEnabled;
};

struct ApuState
{
	ApuSquareState Square1;
	ApuSquareState Square2;
	ApuTriangleState Triangle;
	ApuNoiseState Noise;
	ApuDmcState Dmc;
	ApuFrameCounterState FrameCounter;
};
