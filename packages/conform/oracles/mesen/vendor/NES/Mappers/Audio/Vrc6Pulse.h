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
	// chipvoice patch (2026-09-28), upstream Mesen 2 (b9fa69d) is otherwise
	// unmodified. See oracles/mesen/README.md and docs/chips/vrc6.md ("Digital
	// parity") for the full story; this comment gives the mechanism.
	//
	// nesdev's VRC6 audio page, quoted verbatim in this project's own core
	// (packages/chipvoice/src/chips/nes/vrc6.ts's Vrc6Pulse doc comment):
	// "takes 16 steps, counting down from 15 to 0. When the current step is
	// less than or equal to the given duty cycle D, the channel volume V is
	// output, otherwise 0." That core implements it literally: `step` counts
	// 15 down to 0 and wraps, frozen while disabled, reset to 15 on the
	// 0-to-1 edge of `enabled`, output `step <= duty`.
	//
	// This file counts the other way: `_step` counts 0 up to 15 and wraps
	// (`(_step + 1) & 0x0F`, just above), also frozen while disabled, also
	// reset on every enable transition, but to 0, not 15 (`WriteReg`'s
	// `case 2`, above). Call chipvoice's counter s' and this one s. From
	// every enable edge onward, both freeze on exactly the same cycles and
	// both step exactly once per divider firing, in opposite directions, and
	// both are re-anchored at the same edge (s to 0, s' to 15) on every
	// subsequent disable/re-enable - so the identity s' = 15 - s holds for
	// any sequence of period, duty or enable writes after that first edge,
	// not just for one run with a fixed duty. Substituting s' = 15 - s into
	// chipvoice's own condition `s' <= dutyCycle` gives `15 - s <= dutyCycle`,
	// i.e. `s >= 15 - dutyCycle` - this file's own `_step` compared the other
	// way, which is the one line changed below. A single constant time shift
	// cannot express this: the counter's direction decides which edge of the
	// duty window is anchored to the divider's own wrap (an up-counter
	// anchors the rising edge there; a down-counter anchors the falling
	// edge), so shifting the whole trace in time moves both edges together
	// where only one needs to move. The output mapping above is exact
	// regardless, because it is derived from the counters' own invariant, not
	// fitted to any one trace. Verified: `check:vrc6-flat-mesen` (100 % on
	// every pure-pulse flat-corpus script) and no regression on
	// `check:vrc6-core-mesen`/`check:vrc6-edge-mesen` (still 100 %, unaffected
	// since every core/edge script already held duty and period fixed across
	// an enable span, where the mapped and unmapped conditions agree).
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