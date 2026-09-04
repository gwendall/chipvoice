// The Gb_Snd_Emu oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header, then
// one write per line as `<cycle> <addr hex> <value hex>` in cycle order -
// drives blargg's Gb_Apu with it, and prints every change of every voice's
// value as `<cycle> <voice> <value>`, in cycle order. Voices are 0 to 3:
// square 1, square 2, wave, noise. That is the stream chipvoice's `trace`
// produces, and the harness compares the two.
//
// Gb_Snd_Emu has no DACs: its squares and noise swing between plus and minus
// the volume, scaled by the master volume, and its wave is the sample times
// twice the master volume. chipvoice traces what each DAC is given, 0 to 15.
// So this expects the log to leave the master volume at 7 - the corpus does -
// and folds the oracle's amplitudes back onto the DAC's scale: a square or
// noise at +7v is v and at -7v is 0; a wave at 14s is s.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "gb_apu/Gb_Apu.h"

struct Change {
	long cycle;
	int voice;
	int value;
};

static bool before( const Change& a, const Change& b ) {
	if ( a.cycle != b.cycle ) return a.cycle < b.cycle;
	return a.voice < b.voice;
}

static int dac_value( int voice, long amp )
{
	if ( voice == 2 )
		return (int) (amp / 14);
	return amp > 0 ? (int) (amp / 7) : 0;
}

int main()
{
	Gb_Apu apu;
	Blip_Buffer voices [Gb_Apu::osc_count];
	for ( int i = 0; i < Gb_Apu::osc_count; i++ )
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
	apu.end_frame( cycles );

	std::vector<Change> changes;
	for ( int v = 0; v < Gb_Apu::osc_count; v++ )
	{
		std::vector<Recorded_Delta> const& deltas = voices [v].deltas;
		long amp = 0;
		int value = 0;
		for ( size_t i = 0; i < deltas.size(); )
		{
			long time = deltas [i].time;
			while ( i < deltas.size() && deltas [i].time == time )
				amp += deltas [i++].delta;
			int next = dac_value( v, amp );
			if ( next != value && time < cycles )
			{
				value = next;
				Change c = { time, v, value };
				changes.push_back( c );
			}
		}
	}
	std::stable_sort( changes.begin(), changes.end(), before );

	for ( size_t i = 0; i < changes.size(); i++ )
		printf( "%ld %d %d\n", changes [i].cycle, changes [i].voice, changes [i].value );
	return 0;
}
