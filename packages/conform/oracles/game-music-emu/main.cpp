// The Game_Music_Emu VRC6 oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header, then
// one write per line as `<cycle> <addr hex> <value hex>` in cycle order -
// drives Game_Music_Emu's `Nes_Vrc6_Apu` with it, and prints every change of
// every voice's value as `<cycle> <voice> <value>`, in cycle order. Voices
// are 0 to 2: pulse 1, pulse 2, sawtooth - the same order chipvoice's
// `Vrc6Apu.trace` produces, and the harness compares the two.
//
// The address-to-register dispatch below (`reg = addr & 0xFFF`,
// `osc = (addr - 0x9000) / 0x1000`, forwarded only when `osc < 3 && reg < 3`)
// is copied from `Nsf_Emu.cpp`'s own `HANDLE_CHIP_VRC6` dispatch, not
// invented here: Game_Music_Emu's `Nes_Vrc6_Apu::reg_count` is 3, so a write
// to $9003/$A003/$B003 (VRC6's shared halt/frequency-shift register) is
// silently dropped by the real player too - this oracle is faithful to that,
// not a hand-picked omission. See the README for what that means for the
// corpus this drives.
//
// The amplitude of a voice is the running sum of the deltas its oscillator
// handed the recorder in Blip_Buffer.h, exactly as in the Nes_Snd_Emu oracle
// (oracles/nes-snd-emu/main.cpp), which this file otherwise mirrors.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "gme/Nes_Vrc6_Apu.h"

struct Change {
	long cycle;
	int voice;
	int value;
};

static bool before( const Change& a, const Change& b ) {
	if ( a.cycle != b.cycle ) return a.cycle < b.cycle;
	return a.voice < b.voice;
}

int main()
{
	Nes_Vrc6_Apu apu;
	Blip_Buffer voices [Nes_Vrc6_Apu::osc_count];
	for ( int i = 0; i < Nes_Vrc6_Apu::osc_count; i++ )
		apu.osc_output( i, &voices [i] );
	apu.reset();

	long cycles = -1;
	char line [1024];
	long last = 0;
	while ( fgets( line, sizeof line, stdin ) )
	{
		if ( line [0] == '#' )
		{
			if ( strncmp( line, "# cycles:", 9 ) == 0 )
				cycles = strtol( line + 9, NULL, 10 );
			continue;
		}
		long cycle;
		unsigned addr, value;
		if ( sscanf( line, "%ld %x %x", &cycle, &addr, &value ) != 3 )
			continue;
		if ( cycle < last )
		{
			fprintf( stderr, "writes out of order at cycle %ld\n", cycle );
			return 1;
		}
		// A driver schedules past the end of what it renders - a note-off, a
		// lookahead - and those writes cannot reach the compared range.
		if ( cycles >= 0 && cycle >= cycles )
			continue;
		last = cycle;
		if ( addr < Nes_Vrc6_Apu::base_addr ) continue;
		unsigned reg = (addr - Nes_Vrc6_Apu::base_addr) & (Nes_Vrc6_Apu::addr_step - 1);
		unsigned osc = (addr - Nes_Vrc6_Apu::base_addr) / Nes_Vrc6_Apu::addr_step;
		if ( osc < (unsigned) Nes_Vrc6_Apu::osc_count && reg < (unsigned) Nes_Vrc6_Apu::reg_count )
			apu.write_osc( cycle, osc, reg, (int) value );
	}
	if ( cycles < 0 )
	{
		fprintf( stderr, "no `# cycles:` header before the first write\n" );
		return 1;
	}
	// `cycles + 1`, not `cycles`: distinct from (and in addition to) the
	// `<=` fix on this file's own delta filter below. Measured directly
	// (`corpus/vrc6/script-saw-worked-example.log`, whose last real edge
	// sits exactly on the requested cycle budget): `end_frame(cycles)`
	// alone never produces a delta timestamped at `cycles - 1` at all, not
	// even one this filter then discards - Blip_Buffer's frame boundary
	// needs one more cycle of clocking past the requested budget to flush a
	// change landing that close to it. `end_frame(cycles + 1)` supplies
	// exactly that one cycle of headroom; the filter below still caps what
	// is kept at `time <= cycles` (the ORIGINAL budget, not `cycles + 1`),
	// so nothing past the true requested window is ever admitted.
	apu.end_frame( cycles + 1 );

	std::vector<Change> changes;
	for ( int v = 0; v < Nes_Vrc6_Apu::osc_count; v++ )
	{
		std::vector<Recorded_Delta> const& deltas = voices [v].deltas;
		long amp = 0;
		for ( size_t i = 0; i < deltas.size(); )
		{
			long time = deltas [i].time;
			long before_ = amp;
			while ( i < deltas.size() && deltas [i].time == time )
				amp += deltas [i++].delta;
			// `<=`, not `<`: a delta landing exactly on this log's own
			// `cycles` bound is one past the last tick's 0-based index, not
			// beyond it - see `oracles/mesen/main-vrc6.cpp`'s own copy of
			// this comment for the full mechanism and why widening it here
			// is safe (it only ever matters to a voice a later shift, like
			// this oracle's own sawtooth correction, pulls back inside
			// `compare.mjs`'s `< cycles` window).
			if ( amp != before_ && time <= cycles )
			{
				Change c = { time, v, (int) amp };
				changes.push_back( c );
			}
		}
	}
	std::stable_sort( changes.begin(), changes.end(), before );

	for ( size_t i = 0; i < changes.size(); i++ )
		printf( "%ld %d %d\n", changes [i].cycle, changes [i].voice, changes [i].value );
	return 0;
}
