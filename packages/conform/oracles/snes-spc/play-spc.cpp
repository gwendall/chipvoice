// The snes_spc CPU oracle: a real .spc snapshot in, blargg's own SPC700
// (`SPC_CPU.h`, textually included from `SNES_SPC.cpp`) plays it, and this
// prints two traces: every DSP register write the CPU makes (through $F2/$F3,
// DSPADDR/DSPDATA - already resolved to a register index by the
// `SPC_DSP_WRITE_HOOK` the source provides at exactly that point, inside
// `dsp_write()`), and every output sample the DSP produces, through the same
// `SPC_DSP_OUT_HOOK` the DSP-only oracle (`main.cpp`) already uses. Both are
// stamped with the SPC clock (1024000 a second) counted from 0 at the start
// of the loaded snapshot, one `end_frame` call for the whole run so
// `m.spc_time` never gets reframed mid-trace.
//
// This is what `importSpc` cannot get from a unit test: whether the new
// SPC700 core, run against the same snapshot as the reference CPU, sends the
// S-DSP the same bytes at the same cycles. `packages/conform/src/spc/*`
// drives both from the corpus and reports where (if anywhere) they part; it
// resolves chipvoice's own $F2/$F3 pairs to the same (cycle, register,
// value) form before comparing, since that is the canonical event, not the
// bus protocol that produced it.
//
// Usage: play-spc <cycles> [--writes | --samples] < file.spc
//
// With neither flag, prints both sections for a person to read:
//   # writes
//   <cycle> <register hex> <value hex>
//   # samples
//   <cycle> <left> <right>      (only on a change from the previous pair)
//
// `--writes` prints only the writes section, unchanged. `--samples` prints
// only the samples section, reshaped to one line per channel per change -
// `<cycle> <voice> <value>` (voice 0 = left, 1 = right), the same shape
// `main.cpp` already prints and `packages/conform/src/change-stream.mjs`'s
// `traceProcess` already parses - so the samples half of the comparison
// reuses that machinery unchanged. Neither flag's output has a header line:
// callers that want one format need not skip the other.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

struct Write { long cycle; int addr; int value; };
struct Sample { long cycle; int l; int r; };

static std::vector<Write> g_writes;
static std::vector<Sample> g_samples;
static long g_sample_cycle = 0; // the DSP's own 32-cycle sample clock; SPC_DSP_OUT_HOOK fires once per period, unconditionally, from a fixed phase in its pipeline - counting firings from 0 is exact regardless of where in a period that phase falls.

// `SPC_DSP_WRITE_HOOK` fires from `SNES_SPC::dsp_write`, called only for a
// CPU write to $F3 (DSPDATA); `reg` is the DSP register DSPADDR ($F2) was
// last set to, already resolved - not the bus address. That is exactly the
// canonical event both sides are compared on: a DSP register write, with
// its cycle, independent of how many bytes of bus protocol produced it.
#define SPC_DSP_OUT_HOOK( l, r ) do { g_samples.push_back( { g_sample_cycle, (l), (r) } ); g_sample_cycle += 32; } while ( 0 )
#define SPC_DSP_WRITE_HOOK( time, reg, data ) g_writes.push_back( { (long) (time), (int) (reg), (int) (data) } )

#include "snes_spc/SPC_DSP.h"
#include "snes_spc/SPC_DSP.cpp"
#include "snes_spc/SNES_SPC.h"
#include "snes_spc/SNES_SPC.cpp"
#include "snes_spc/SNES_SPC_misc.cpp"
#include "snes_spc/SNES_SPC_state.cpp"

// Anomie's SPC700 doc, the same 64 bytes `packages/chipvoice`'s `Ssmp`
// embeds as `IPL_ROM`: the fixed boot ROM at $FFC0-$FFFF, needed only for a
// snapshot taken with CONTROL's ROM-enable bit set (rare - most are taken
// mid-song, long after boot).
static const unsigned char IPL_ROM[ 0x40 ] = {
	0xcd, 0xef, 0xbd, 0xe8, 0x00, 0xc6, 0x1d, 0xd0, 0xfc, 0x8f, 0xaa, 0xf4, 0x8f, 0xbb, 0xf5, 0x78,
	0xcc, 0xf4, 0xd0, 0xfb, 0x2f, 0x19, 0xeb, 0xf4, 0xd0, 0xfc, 0x7e, 0xf4, 0xd0, 0x0b, 0xe4, 0xf5,
	0xcb, 0xf4, 0xd7, 0x00, 0xfc, 0xd0, 0xf3, 0xab, 0x01, 0x10, 0xef, 0x7e, 0xf4, 0x10, 0xeb, 0xba,
	0xf6, 0xda, 0x00, 0xba, 0xf4, 0xc4, 0xf4, 0xdd, 0x5d, 0xd0, 0xdb, 0x1f, 0x00, 0x00, 0xc0, 0xff,
};

int main( int argc, char** argv )
{
	if ( argc < 2 )
	{
		fprintf( stderr, "usage: play-spc <cycles> [--writes | --samples] < file.spc\n" );
		return 2;
	}
	long cycles = strtol( argv [1], NULL, 10 );
	bool writesOnly = false, samplesOnly = false;
	for ( int i = 2; i < argc; i++ )
	{
		if ( !strcmp( argv [i], "--writes" ) ) writesOnly = true;
		else if ( !strcmp( argv [i], "--samples" ) ) samplesOnly = true;
	}

	std::vector<unsigned char> data;
	{
		unsigned char buf [65536];
		size_t n;
		while ( ( n = fread( buf, 1, sizeof buf, stdin ) ) > 0 )
			data.insert( data.end(), buf, buf + n );
	}

	SNES_SPC spc;
	if ( spc.init() )
	{
		fprintf( stderr, "snes_spc init failed\n" );
		return 1;
	}
	spc.init_rom( IPL_ROM );
	blargg_err_t err = spc.load_spc( data.data(), (long) data.size() );
	if ( err )
	{
		fprintf( stderr, "load_spc: %s\n", err );
		return 1;
	}
	spc.clear_echo();

	// One stereo sample pair (2 shorts) every 32 clocks; size generously so
	// `end_frame` never has more to write than the buffer holds.
	long out_size = ( cycles / 32 + 4 ) * 2;
	std::vector<SNES_SPC::sample_t> out( (size_t) out_size );
	spc.set_output( out.data(), (int) out_size );
	spc.end_frame( (SNES_SPC::time_t) cycles );

	if ( !samplesOnly )
	{
		if ( !writesOnly ) printf( "# writes\n" );
		for ( size_t i = 0; i < g_writes.size(); i++ )
			printf( "%ld %x %x\n", g_writes [i].cycle, g_writes [i].addr, g_writes [i].value );
	}
	if ( !writesOnly )
	{
		if ( !samplesOnly ) printf( "# samples\n" );
		int lastL = 0, lastR = 0;
		bool first = true;
		for ( size_t i = 0; i < g_samples.size(); i++ )
		{
			if ( g_samples [i].cycle >= cycles )
				break;
			if ( first || g_samples [i].l != lastL || g_samples [i].r != lastR )
			{
				if ( samplesOnly )
				{
					// One line per channel that changed, cycle first: the
					// exact `<cycle> <voice> <value>` shape `main.cpp` and
					// `traceProcess` already agree on (voice 0 = left, 1 =
					// right), so this can be diffed with `compare()` as-is.
					if ( first || g_samples [i].l != lastL ) printf( "%ld 0 %d\n", g_samples [i].cycle, g_samples [i].l );
					if ( first || g_samples [i].r != lastR ) printf( "%ld 1 %d\n", g_samples [i].cycle, g_samples [i].r );
				}
				else
				{
					printf( "%ld %d %d\n", g_samples [i].cycle, g_samples [i].l, g_samples [i].r );
				}
				lastL = g_samples [i].l;
				lastR = g_samples [i].r;
				first = false;
			}
		}
	}
	return 0;
}
