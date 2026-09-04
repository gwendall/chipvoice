// The reSID-fp oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header, then
// one write per line as `<cycle> <addr hex> <value hex>` in cycle order, the
// cycle counted on the C64's clock - drives reSID-fp's SID as a 6581 with the
// writes to `$D400-$D7FF`, and prints every change of every voice's two
// digital values as `<cycle> <voice> <value>`: voices 0 to 2 are the twelve
// bit waveform outputs of voices 1 to 3, voices 3 to 5 their eight bit
// envelope counters. Both are read before the DACs, which is where the
// digital chip ends and the profile begins.
//
// A write lands before the cycle it is stamped with is clocked. The chip is
// clocked one cycle at a time the way reSID-fp's own `SID::clock` does it:
// the three oscillators, the three envelopes, the three outputs, then the
// sync between oscillators when one's MSB has just risen.
//
// `--tables` prints the 6581's eight waveform tables instead, one per line,
// 4096 values each: the combined waveforms are a model fitted to samplings
// of one chip, and chipvoice's own model is fitted against these.

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

// The oracle reads the generators' state, which reSID-fp keeps private.
#define private public
#define protected public
#include "residfp/SID.h"
#include "residfp/WaveformCalculator.h"
#undef private
#undef protected

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

static int tables()
{
	matrix_t* t = reSIDfp::WaveformCalculator::getInstance()->buildTable( reSIDfp::MOS6581 );
	for ( int wf = 0; wf < 8; wf++ )
	{
		for ( int i = 0; i < 4096; i++ )
			printf( i ? " %d" : "%d", (*t) [wf] [i] );
		printf( "\n" );
	}
	return 0;
}

int main( int argc, char** argv )
{
	if ( argc > 1 && strcmp( argv [1], "--tables" ) == 0 )
		return tables();
	// `--debug <voice> <from> <to>`: the envelope's state per cycle, for a look inside.
	int debug_voice = -1;
	long debug_from = 0, debug_to = 0;
	if ( argc > 4 && strcmp( argv [1], "--debug" ) == 0 )
	{
		debug_voice = atoi( argv [2] );
		debug_from = atol( argv [3] );
		debug_to = atol( argv [4] );
	}

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
		if ( (addr & 0xfc00) != 0xd400 )
			continue;
		Write w = { cycle, addr & 0x1f, value & 0xff };
		writes.push_back( w );
	}
	if ( cycles < 0 )
	{
		fprintf( stderr, "no `# cycles:` header before the first write\n" );
		return 1;
	}

	reSIDfp::SID sid;
	sid.setChipModel( reSIDfp::MOS6581 );
	sid.reset();

	std::vector<Change> changes;
	int last_out [6] = { 0, 0, 0, 0, 0, 0 };
	size_t next = 0;
	for ( long cycle = 0; cycle < cycles; cycle++ )
	{
		while ( next < writes.size() && writes [next].cycle <= cycle )
		{
			sid.write( (int) writes [next].addr, (unsigned char) writes [next].value );
			next++;
		}
		for ( int v = 0; v < 3; v++ )
			sid.voice [v]->wave()->clock();
		for ( int v = 0; v < 3; v++ )
			sid.voice [v]->envelope()->clock();
		sid.voice [0]->wave()->output( sid.voice [2]->wave() );
		sid.voice [1]->wave()->output( sid.voice [0]->wave() );
		sid.voice [2]->wave()->output( sid.voice [1]->wave() );
		if ( --sid.nextVoiceSync == 0 )
			sid.voiceSync( true );
		if ( debug_voice >= 0 && cycle >= debug_from && cycle <= debug_to )
		{
			reSIDfp::EnvelopeGenerator* e = sid.voice [debug_voice]->envelope();
			fprintf( stderr, "%ld lfsr=%04x rate=%04x exp=%u/%u next=%u sp=%u ep=%u xp=%u state=%d reset=%d counting=%d counter=%02x\n",
				cycle, e->lfsr, e->rate, e->exponential_counter, e->exponential_counter_period, e->new_exponential_counter_period,
				e->state_pipeline, e->envelope_pipeline, e->exponential_pipeline, (int) e->state, (int) e->resetLfsr, (int) e->counter_enabled, e->envelope_counter );
		}
		for ( int v = 0; v < 3; v++ )
		{
			int osc = (int) sid.voice [v]->wave()->waveform_output;
			int env = (int) sid.voice [v]->envelope()->envelope_counter;
			if ( osc != last_out [v] )
			{
				last_out [v] = osc;
				Change c = { cycle, v, osc };
				changes.push_back( c );
			}
			if ( env != last_out [3 + v] )
			{
				last_out [3 + v] = env;
				Change c = { cycle, 3 + v, env };
				changes.push_back( c );
			}
		}
	}
	std::stable_sort( changes.begin(), changes.end(), before );
	for ( size_t i = 0; i < changes.size(); i++ )
		printf( "%ld %d %d\n", changes [i].cycle, changes [i].voice, changes [i].value );
	return 0;
}
