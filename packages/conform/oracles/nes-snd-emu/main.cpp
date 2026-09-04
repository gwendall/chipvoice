// The Nes_Snd_Emu oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header, then
// one write per line as `<cycle> <addr hex> <value hex>` in cycle order -
// drives blargg's Nes_Apu with it, and prints every change of every voice's
// value as `<cycle> <voice> <value>`, in cycle order. Voices are 0 to 4:
// square 1, square 2, triangle, noise, DMC. That is the same stream
// chipvoice's `trace` produces, and the harness compares the two.
//
// The amplitude of a voice is the running sum of the deltas its oscillator
// handed the recorder in Blip_Buffer.h. A delta of zero is never recorded by
// the oscillators, but two deltas on the same cycle are, so the sum is taken
// per cycle before a change is reported.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "nes_apu/Nes_Apu.h"

// The DMC reads sample memory through this. No log written so far enables the
// DMC, and when one does, a memory image will come with it.
static int read_rom( void*, cpu_addr_t ) { return 0; }

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
	Nes_Apu apu;
	Blip_Buffer voices [Nes_Apu::osc_count];
	for ( int i = 0; i < Nes_Apu::osc_count; i++ )
		apu.osc_output( i, &voices [i] );
	apu.dmc_reader( read_rom, NULL );
	apu.reset( false, 0 );

	long cycles = -1;
	char line [256];
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
		// A driver schedules past the end of what it renders - note-offs, a
		// lookahead - and those writes cannot reach the compared range.
		if ( cycles >= 0 && cycle >= cycles )
			continue;
		last = cycle;
		apu.write_register( cycle, addr, (int) value );
	}
	if ( cycles < 0 )
	{
		fprintf( stderr, "no `# cycles:` header before the first write\n" );
		return 1;
	}
	apu.run_until( cycles );

	std::vector<Change> changes;
	for ( int v = 0; v < Nes_Apu::osc_count; v++ )
	{
		std::vector<Recorded_Delta> const& deltas = voices [v].deltas;
		long amp = 0;
		for ( size_t i = 0; i < deltas.size(); )
		{
			long time = deltas [i].time;
			long before_ = amp;
			while ( i < deltas.size() && deltas [i].time == time )
				amp += deltas [i++].delta;
			if ( amp != before_ && time < cycles )
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
