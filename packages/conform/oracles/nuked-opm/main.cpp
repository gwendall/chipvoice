// The Nuked-OPM oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header, then
// one write per line as `<cycle> <addr hex> <value hex>` in cycle order, the
// cycle counted on the YM2151's own input clock (the pin frequency the log's
// `# clock:` header names, not used by this driver directly since the log's
// own cycle numbers are already in that unit) - drives Nuked-OPM in YM2151
// mode (`opm_flags_none`; the YM2164/OPP variant is out of scope, see
// `docs/DECISIONS.md`'s decision 51) with the writes to its two ports, `addr`
// 0 for the address port and 1 for the data port, and prints every change of
// the two DAC pins as `<cycle> <voice> <value>`, voice 0 the left and 1 the
// right - the only outputs this chip has.
//
// The chip's internal state machine runs at half the input clock: one
// `OPM_Clock` call every two of the log's cycles, thirty-two calls to a full
// operator sweep, sixty-four input clocks to a sample pair - `clock / 64`,
// as documented for the real chip.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "opm.h"

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
		Write w = { cycle, addr & 1, value & 0xff };
		writes.push_back( w );
	}
	if ( cycles < 0 )
	{
		fprintf( stderr, "no `# cycles:` header before the first write\n" );
		return 1;
	}

	opm_t chip;
	OPM_Reset( &chip, opm_flags_none );

	std::vector<Change> changes;
	int32_t last_out [2] = { 0, 0 };
	size_t next = 0;
	int32_t output [2];
	uint8_t sh1, sh2, so;
	const long step = 2;
	for ( long cycle = 0; cycle < cycles; cycle += step )
	{
		// A `while`, not nuked-opn2's `if`: this chip's own two-port
		// protocol means one register write is two log entries, address
		// then data, usually at the same cycle - both must land before the
		// next `OPM_Clock`, not one now and one a step late.
		while ( next < writes.size() && writes [next].cycle <= cycle )
		{
			OPM_Write( &chip, writes [next].addr, (uint8_t) writes [next].value );
			next++;
		}
		OPM_Clock( &chip, output, &sh1, &sh2, &so );
		for ( int v = 0; v < 2; v++ )
		{
			if ( chip.dac_output [v] != last_out [v] )
			{
				last_out [v] = chip.dac_output [v];
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
