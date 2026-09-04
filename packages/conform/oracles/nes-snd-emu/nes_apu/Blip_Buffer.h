// A recorder in place of Blip_Buffer, for the conformance oracle.
//
// Nes_Snd_Emu's oscillators do not produce samples; they produce amplitude
// deltas at exact CPU times and hand them to a Blip_Synth, which turns each
// one into a band-limited step in a Blip_Buffer at some sample rate. Parity is
// measured before any of that: what the oracle knows is "voice N moved by D
// at cycle T", and the exact digital value of the voice at every cycle is the
// running sum of those. So this presents the same interface - the types, the
// constants, the three offset methods and the two resampled-time helpers the
// oscillators call - and records instead of synthesising. Resampled time is
// CPU time, one to one.
//
// Nothing here is blargg's. The files around it are, under the LGPL; see
// LICENSE. This header exists so they compile unchanged.

#ifndef BLIP_BUFFER_H
#define BLIP_BUFFER_H

#include <limits.h>
#include <vector>

#include "blargg_common.h"

typedef long blip_time_t;

// Quality levels are template arguments to Blip_Synth in the oscillators'
// headers, so they have to exist. They mean nothing here.
enum { blip_low_quality = 1, blip_med_quality = 8, blip_good_quality = 12, blip_high_quality = 16 };

class blip_eq_t {
public:
	blip_eq_t( double = 0, long = 0, long = 44100 ) { }
};

struct Recorded_Delta {
	long time;
	int delta;
};

class Blip_Buffer {
public:
	typedef unsigned long resampled_time_t;

	// Every delta, in the order the oscillator produced it: time order.
	std::vector<Recorded_Delta> deltas;

	resampled_time_t resampled_time( blip_time_t t ) const { return (resampled_time_t) t; }
	resampled_time_t resampled_duration( int t ) const { return (resampled_time_t) t; }

	void record( long time, int delta ) {
		Recorded_Delta d = { time, delta };
		deltas.push_back( d );
	}
};

typedef Blip_Buffer::resampled_time_t blip_resampled_time_t;

template<int quality,int range>
class Blip_Synth {
public:
	void volume( double ) { }
	void volume_unit( double ) { }
	void treble_eq( const blip_eq_t& ) { }

	void offset( blip_time_t t, int delta, Blip_Buffer* buf ) const { buf->record( t, delta ); }
	void offset_inline( blip_time_t t, int delta, Blip_Buffer* buf ) const { buf->record( t, delta ); }
	void offset_resampled( blip_resampled_time_t t, int delta, Blip_Buffer* buf ) const {
		buf->record( (long) t, delta );
	}
};

#endif
