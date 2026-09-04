// The Nuked-OPN2 oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header, then
// one write per line as `<cycle> <addr hex> <value hex>` in cycle order, the
// cycle counted on the Mega Drive's master clock - drives Nuked's YM3438 in
// YM2612 mode with the writes to `$A04000-$A04003`, and prints every change
// of every channel's nine-bit output as `<cycle> <voice> <value>`. Voices 0
// to 5 are the six FM channels. Writes to the PSG are not this chip's and
// are skipped.
//
// The chip's input clock is the 68000's, one master cycle in seven; its
// internal cycle is six of those. A write reaches the chip on the internal
// cycle after its own, one write per internal cycle, which is faster than
// the 68000 can write and so never a constraint on a real log.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "ym3438.h"

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
		if ( (addr & 0xfffffc) != 0xa04000 )
			continue;
		Write w = { cycle, addr & 3, value & 0xff };
		writes.push_back( w );
	}
	if ( cycles < 0 )
	{
		fprintf( stderr, "no `# cycles:` header before the first write\n" );
		return 1;
	}

	OPN2_SetChipType( ym3438_mode_ym2612 );
	ym3438_t chip;
	OPN2_Reset( &chip );

	std::vector<Change> changes;
	int last_out [6] = { 0, 0, 0, 0, 0, 0 };
	size_t next = 0;
	Bit16s buffer [2];
	const long step = 7 * 6;
	for ( long cycle = 0; cycle < cycles; cycle += step )
	{
		if ( next < writes.size() && writes [next].cycle <= cycle )
		{
			OPN2_Write( &chip, writes [next].addr, (Bit8u) writes [next].value );
			next++;
		}
		OPN2_Clock( &chip, buffer );
		for ( int v = 0; v < 6; v++ )
		{
			if ( chip.ch_out [v] != last_out [v] )
			{
				last_out [v] = chip.ch_out [v];
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
