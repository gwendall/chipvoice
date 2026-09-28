#pragma once
#include "pch.h"
#include "Utilities/Serializer.h"

class Vrc6Pulse: public ISerializable
{
private:
	uint8_t _volume = 0;
	uint8_t _dutyCycle = 0;
	bool _ignoreDuty = false;
	uint16_t _frequency = 1;
	bool _enabled = false;

	int32_t _timer = 1;
	uint8_t _step = 0;
	uint8_t _frequencyShift = 0;

	void Serialize(Serializer& s) override
	{
		SV(_volume); SV(_dutyCycle); SV(_ignoreDuty); SV(_frequency); SV(_enabled); SV(_timer); SV(_step); SV(_frequencyShift);
	}

public:
	void WriteReg(uint16_t addr, uint8_t value)
	{
		switch(addr & 0x03) {
			case 0:
				_volume = value & 0x0F;
				_dutyCycle = (value & 0x70) >> 4;
				_ignoreDuty = (value & 0x80) == 0x80;
				break;

			case 1:
				_frequency = (_frequency & 0x0F00) | value;
				break;

			case 2:
				_frequency = (_frequency & 0xFF) | ((value & 0x0F) << 8);
				_enabled = (value & 0x80) == 0x80;
				if(!_enabled) {
					_step = 0;
				}
				break;
		}
	}

	void SetFrequencyShift(uint8_t shift)
	{
		_frequencyShift = shift;
	}

	void Clock()
	{
		if(_enabled) {
			_timer--;
			if(_timer == 0) {
				_step = (_step + 1) & 0x0F;
				_timer = (_frequency >> _frequencyShift) + 1;
			}
		}
	}

	// ---------------------------------------------------------------------
	// chipvoice patch (2026-09-28, round 4 wording), upstream Mesen 2
	// (b9fa69d) is otherwise unmodified. See oracles/mesen/README.md and
	// docs/chips/vrc6.md ("Digital parity", "The pulse mapping") for the
	// full story; this comment gives the mechanism and says plainly what it
	// does and does not prove.
	//
	// This is not a convention relabelling: it changes Mesen's observable
	// output. Unpatched, a pulse here is HIGH for the first D+1 steps after
	// an enable, then low (`_step` starts at 0, `_step <= _dutyCycle`) -
	// Game_Music_Emu's `Nes_Vrc6_Apu`, whose `phase` starts at 1 from
	// power-on, is high-first too. chipvoice's own core
	// (packages/chipvoice/src/chips/nes/vrc6.ts) is low-first: `step` is set
	// to 15 on the 0-to-1 edge of `enabled` and the channel is high only
	// once `step <= duty`, so it is LOW for the first 15-D steps, then at
	// volume for D+1 - nesdev's VRC6 audio page, quoted verbatim in that
	// core's own doc comment, read literally: "takes 16 steps, counting down
	// from 15 to 0. When the current step is less than or equal to the given
	// duty cycle D, the channel volume V is output, otherwise 0." The patch
	// below makes THIS oracle low-first too - it makes Mesen adopt
	// chipvoice's own nesdev-literal duty-phase reading, not the other way
	// around, and not a reading Mesen or Game_Music_Emu held on their own.
	//
	// The derivation, for the record: this file's own `_step` counts 0 up to
	// 15 and wraps (`(_step + 1) & 0x0F`, just above), frozen while disabled,
	// reset to 0 on every enable transition (`WriteReg`'s `case 2`, above).
	// chipvoice's own `step` counts 15 down to 0, frozen while disabled,
	// reset to 15 on the same edge. Call chipvoice's counter s' and this
	// one s. From every enable edge onward, both freeze on exactly the same
	// cycles and both step exactly once per divider firing, in opposite
	// directions, and both are re-anchored at the same edge (s to 0, s' to
	// 15) on every subsequent disable/re-enable - so the identity
	// s' = 15 - s holds for any sequence of period, duty or enable writes
	// after that first edge, not just for one run with a fixed duty.
	// Substituting s' = 15 - s into chipvoice's own condition
	// `s' <= dutyCycle` gives `15 - s <= dutyCycle`, i.e. `s >= 15 -
	// dutyCycle` - this file's own `_step` compared the other way, which is
	// the one line changed below. A single constant time shift cannot
	// express this: the counter's direction decides which edge of the duty
	// window is anchored to the divider's own wrap (an up-counter anchors
	// the rising edge there; a down-counter anchors the falling edge), so
	// shifting the whole trace in time moves both edges together where only
	// one needs to move.
	//
	// What `check:vrc6-flat-mesen`'s 100 % is, and is not, evidence of: on
	// duty phase alone it is NOT independent evidence, because the patch
	// makes this oracle read duty phase the same way chipvoice does by
	// construction, not by measuring hardware or an unmodified reference.
	// What it DOES independently verify, unaffected by the patch, is
	// everything the patch does not touch: the divider's own cadence (how
	// often `_step` advances), step timing relative to the period register,
	// freezing while disabled, re-anchoring at each enable edge, and the
	// output levels (`_volume`) themselves - all read from, and compared
	// against, Mesen's own independent implementation of those, same as
	// `check:vrc6-core-mesen`/`check:vrc6-edge-mesen` always were.
	//
	// Whose duty-phase reading is correct is an open question, not one this
	// patch or this gate settles: this core follows nesdev's text; both
	// Mesen 2 and Game_Music_Emu, unpatched, disagree with that reading (and
	// with each other's own re-anchoring behaviour - "The pulse mapping" in
	// docs/chips/vrc6.md has the numbers); no real VRC6 cartridge has been
	// captured to check any of the three against hardware
	// (docs/BACKLOG.md's NEXT-14 entry tracks that capture).
	//
	// `check:vrc6-core-mesen`/`check:vrc6-edge-mesen` are unaffected by this
	// patch (still 100 %) for a reason unrelated to duty phase at all: every
	// $9000/$A000 write in `corpus/vrc6/core/*.log` and
	// `corpus/vrc6/edge/pulse-enable.log` sets bit 7 (M, "ignore duty") -
	// `89`, `85`, `80`-`BB`, `8D` are this corpus's own values, all with bit
	// 7 set - which bypasses the duty generator entirely on both sides
	// (`_ignoreDuty`/`mode`, both return `_volume`/`volume` unconditionally).
	// Before round 3, no exact gate against Mesen exercised the duty
	// generator at all; `check:vrc6-flat-mesen` is the first one that does.
	// ---------------------------------------------------------------------
	uint8_t GetVolume()
	{
		if(!_enabled) {
			return 0;
		} else if(_ignoreDuty) {
			return _volume;
		} else {
			return _step >= (uint8_t)(15 - _dutyCycle) ? _volume : 0;
		}
	}
};