// The snes_spc oracle: a register log in, the DSP's output stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header,
// `# memory ADDR: hex` lines for the 64 KB the DSP shares with the SPC700,
// then one write per line as `<cycle> <addr hex> <value hex>` in cycle order,
// the cycle counted on the SPC700's clock, 1024000 a second - drives blargg's
// SPC_DSP with the writes the SPC700 makes to `$F2` (which register) and
// `$F3` (the byte), and prints the DSP's digital output: every change of the
// left and right samples as `<cycle> <voice> <value>`, voice 0 left and 1
// right, stamped with the clock of the phase that produced them.
//
// Writes land between clocks, before the clock they are stamped with, one
// or many, as an SPC700 program's do.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#define SPC_DSP_OUT_HOOK( l, r ) out_hook( l, r )

static long g_cycle = 0;
static std::vector<long> g_cycles;
static std::vector<int> g_left;
static std::vector<int> g_right;

static void out_hook( int l, int r )
{
	g_cycles.push_back( g_cycle );
	g_left.push_back( l );
	g_right.push_back( r );
}

#include "snes_spc/SPC_DSP.h"
#include "snes_spc/SPC_DSP.cpp"

static unsigned char ram [0x10000];

static void load_memory( const char* line )
{
	unsigned addr;
	int used = 0;
	if ( sscanf( line, "# memory %x: %n", &addr, &used ) < 1 || used == 0 )
		return;
	const char* p = line + used;
	while ( p [0] && p [1] && addr < 0x10000 )
	{
		unsigned byte;
		if ( sscanf( p, "%2x", &byte ) != 1 )
			break;
		ram [addr++] = (unsigned char) byte;
		p += 2;
	}
}

struct Write {
	long cycle;
	unsigned addr;
	unsigned value;
};

int main()
{
	std::vector<Write> writes;
	long cycles = -1;
	char line [4096];
	long last = 0;
	while ( fgets( line, sizeof line, stdin ) )
	{
		if ( line [0] == '#' )
		{
			if ( strncmp( line, "# cycles:", 9 ) == 0 )
				cycles = strtol( line + 9, NULL, 10 );
			else if ( strncmp( line, "# memory ", 9 ) == 0 )
				load_memory( line );
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
		Write w = { cycle, addr, value & 0xff };
		writes.push_back( w );
	}
	if ( cycles < 0 )
	{
		fprintf( stderr, "no `# cycles:` header before the first write\n" );
		return 1;
	}

	SPC_DSP dsp;
	dsp.init( ram );
	dsp.reset();

	int selected = 0;
	size_t next = 0;
	for ( g_cycle = 0; g_cycle < cycles; g_cycle++ )
	{
		while ( next < writes.size() && writes [next].cycle <= g_cycle )
		{
			const Write& w = writes [next++];
			if ( w.addr == 0xf2 )
				selected = w.value;
			else if ( w.addr == 0xf3 && selected < 0x80 )
				dsp.write( selected, w.value );
		}
		dsp.run( 1 );
	}

	int lastL = 0, lastR = 0;
	for ( size_t i = 0; i < g_cycles.size(); i++ )
	{
		if ( g_left [i] != lastL ) { lastL = g_left [i]; printf( "%ld 0 %d\n", g_cycles [i], lastL ); }
		if ( g_right [i] != lastR ) { lastR = g_right [i]; printf( "%ld 1 %d\n", g_cycles [i], lastR ); }
	}
	return 0;
}
