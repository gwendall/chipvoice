// The ymfm oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin, the same format `oracles/nuked-opm`
// reads, and drives Aaron Giles's ymfm `ym2151` with the writes to its two
// ports. Unlike Nuked-OPM, ymfm is not a cycle-by-cycle gate model - its own
// `generate()` produces one finished sample per call from the current
// register state, with no notion of where inside a sample a write landed -
// so writes are batched to the sample period they fall in (every 64 of the
// log's cycles, this chip's own clock/64 sample rate) and applied before
// that period's `generate()` call, and prints every change of the two
// output channels as `<cycle> <voice> <value>`, voice 0 the left and 1 the
// right, the cycle at the sample's start.
//
// `ymfm_interface`'s hooks (timers, IRQ, busy) all default to harmless
// no-ops in the base class; none of them affect `generate()`'s output, so
// the minimal interface below overrides nothing.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "ymfm_opm.h"

struct Write {
	long cycle;
	unsigned addr;
	unsigned value;
};

struct Change {
	long cycle;
	int voice;
	int value;
};

static bool before( const Change& a, const Change& b ) {
	if ( a.cycle != b.cycle ) return a.cycle < b.cycle;
	return a.voice < b.voice;
}

class MinimalInterface : public ymfm::ymfm_interface {};

int main()
{
	std::vector<Write> writes;
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
		last = cycle;
		if ( cycles >= 0 && cycle >= cycles )
			continue;
		Write w = { cycle, addr & 1, value & 0xff };
		writes.push_back( w );
	}
	if ( cycles < 0 )
	{
		fprintf( stderr, "no `# cycles:` header before the first write\n" );
		return 1;
	}

	MinimalInterface intf;
	ymfm::ym2151 chip( intf );
	chip.reset();

	std::vector<Change> changes;
	int32_t last_out [2] = { 0, 0 };
	size_t next = 0;
	ymfm::ym2151::output_data output;
	const long step = 64;
	for ( long cycle = 0; cycle < cycles; cycle += step )
	{
		while ( next < writes.size() && writes [next].cycle < cycle + step )
		{
			chip.write( writes [next].addr, (uint8_t) writes [next].value );
			next++;
		}
		chip.generate( &output, 1 );
		for ( int v = 0; v < 2; v++ )
		{
			if ( output.data [v] != last_out [v] )
			{
				last_out [v] = output.data [v];
				Change c = { cycle, v, last_out [v] };
				changes.push_back( c );
			}
		}
	}
	std::stable_sort( changes.begin(), changes.end(), before );
	for ( size_t i = 0; i < changes.size(); i++ )
		printf( "%ld %d %d\n", changes [i].cycle, changes [i].voice, changes [i].value );
	return 0;
}
