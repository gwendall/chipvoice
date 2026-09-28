// The Game_Music_Emu AY-3-8910 oracle: a register log in, a change stream
// out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header,
// then one write per line as `<cycle> <reg hex> <value hex>` in cycle
// order, where `reg` is the chip's own 0-15 register index (`Ay_Apu::write`
// takes it directly - unlike `Nes_Vrc6_Apu`, there is no CPU-address decode
// here at all) - drives Game_Music_Emu's `Ay_Apu` with it, and prints every
// change of every oscillator's recorded amplitude BYTE as `<cycle> <voice>
// <value>`, in cycle order. Voices are 0 to 2: channels A, B, C, the same
// order `Ay8910.trace` produces.
//
// Unlike `main.cpp` (VRC6), the value on each output line here is not a raw
// digital index - it is `Ay_Apu`'s own internal `amp_table` byte (its
// 16-entry, ~1.5 dB/step logarithmic curve, `Ay_Apu.cpp`), because that
// table is applied inside `Ay_Apu::write_data_`/`run_until` before the
// amplitude ever reaches `Blip_Buffer`'s recorder, and `env.pos`/`osc.delay`
// etc. are private - there is no public way to read the raw pre-DAC index
// back out (see the README's "known limits" for why this and Ayumi's oracle
// take different approaches here). `oracles/game-music-emu-ay.mjs`'s own
// chip-side counterpart (`chipAy8910Gme` in `src/chips/ay8910.mjs`) passes
// chipvoice's own raw index through the identical table before comparing,
// so the comparison is still exact where it applies - fixed (non-envelope)
// volume only; see that file's own comment for why an envelope-active log
// is out of scope for this specific comparison.
//
// The amplitude of a voice is the running sum of the deltas its oscillator
// handed the recorder in Blip_Buffer.h, exactly as in `main.cpp`.

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "gme/Ay_Apu.h"

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
	Ay_Apu apu;
	Blip_Buffer voices [Ay_Apu::osc_count];
	for ( int i = 0; i < Ay_Apu::osc_count; i++ )
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
		unsigned reg, value;
		if ( sscanf( line, "%ld %x %x", &cycle, &reg, &value ) != 3 )
			continue;
		if ( cycle < last )
		{
			fprintf( stderr, "writes out of order at cycle %ld\n", cycle );
			return 1;
		}
		if ( cycles >= 0 && cycle >= cycles )
			continue;
		last = cycle;
		if ( reg < Ay_Apu::reg_count )
			apu.write( cycle, (int) reg, (int) value );
	}
	if ( cycles < 0 )
	{
		fprintf( stderr, "no `# cycles:` header before the first write\n" );
		return 1;
	}
	// `cycles + 1`, same reasoning as `main.cpp`'s own copy of this comment:
	// a delta landing exactly on the requested budget needs one more cycle
	// of clocking to flush out of Blip_Buffer, and the `time <= cycles`
	// filter below still caps what is kept at the original budget.
	apu.end_frame( cycles + 1 );

	std::vector<Change> changes;
	for ( int v = 0; v < Ay_Apu::osc_count; v++ )
	{
		std::vector<Recorded_Delta> const& deltas = voices [v].deltas;
		long amp = 0;
		for ( size_t i = 0; i < deltas.size(); )
		{
			long time = deltas [i].time;
			long before_ = amp;
			while ( i < deltas.size() && deltas [i].time == time )
				amp += deltas [i++].delta;
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
