/*
 * The SameBoy oracle: a register log in, a change stream out. Mirrors
 * oracles/gb-snd-emu/main.cpp's job, for vendor/apu.c instead of Gb_Apu.
 *
 * Reads a chipvoice register log on stdin (`# cycles: N` in the header, then
 * one write per line as `<cycle> <addr hex> <value hex>` in cycle order),
 * drives SameBoy's DMG-B APU with it one T-cycle at a time, and prints every
 * change of `gb->apu.samples[voice]` - already what the voice's DAC is given,
 * 0 to 15, with no folding needed - as `<cycle> <voice> <value>`, in cycle
 * order. Voices are 0 to 3: square 1, square 2, wave, noise (GB_channel_t's
 * order, which is chipvoice's).
 *
 * Two clocks are driven, both starting at 0 in lockstep with dsp.ts's own
 * `divider` and `cycle`, so no offset needs correcting for either (see
 * README.md's "Frame sequencer phase"):
 *
 *  - `div_counter`, a 16-bit register that ticks every T-cycle on real
 *    hardware; SameBoy's frame sequencer is the falling (GB_apu_div_event)
 *    and rising (GB_apu_div_secondary_event) edge of its bit 12, exactly as
 *    dsp.ts's own `clockT` finds the same edge on the same bit of its own
 *    `divider`. Reproduced here from Core/timing.c's
 *    GB_set_internal_div_counter, which is not vendored (it drags in the
 *    CPU and the timers); only the APU-relevant edge check is.
 *  - `apu.apu_cycles`, SameBoy's own internal clock: real hardware's APU
 *    genuinely ticks at half the CPU's T-cycle rate (Core/timing.c's
 *    `timers_run` adds 2 per 4 T-cycles processed), so one accumulated
 *    T-cycle is handed to `GB_apu_run` every other T-cycle. This is coarser
 *    than dsp.ts, which clocks every channel every T-cycle; a change whose
 *    true T-cycle is the earlier of a pair is stamped with the later one
 *    instead, which is this oracle's `trusted` list's granularity, not a
 *    driver bug (see README.md).
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "gb.h"

typedef struct {
    long at;
    unsigned addr;
    unsigned value;
} Write;

static int before_write(const void *a, const void *b) {
    long da = ((const Write *)a)->at - ((const Write *)b)->at;
    if (da != 0) return da < 0 ? -1 : 1;
    return 0;
}

/* The APU-relevant half of Core/timing.c's GB_set_internal_div_counter: the
   TIMA/serial edges it also checks never apply, since nothing here reads a
   timer or the link cable. */
static void tick_div(GB_gameboy_t *gb) {
    uint16_t apu_bit = 0x1000; /* DMG-B is never double speed. */
    uint16_t before = gb->div_counter;
    uint16_t after = (uint16_t)(before + 1);
    uint16_t triggers = before & (uint16_t)~after;
    if (triggers & apu_bit) {
        GB_apu_div_event(gb);
    } else {
        uint16_t secondary = (uint16_t)~before & after;
        if (secondary & apu_bit) {
            GB_apu_div_secondary_event(gb);
        }
    }
    gb->div_counter = after;
}

static void apply_write(GB_gameboy_t *gb, unsigned addr, unsigned value) {
    if (addr >= 0xFF10 && addr <= 0xFF3F) {
        GB_apu_write(gb, (uint8_t)(addr & 0xFF), (uint8_t)value);
    }
    /* Nothing else is in range: dsp.ts only ever sees these addresses. */
}

int main(void) {
    long cycles = -1;
    Write *writes = NULL;
    size_t n_writes = 0, cap = 0;

    char line[1024];
    long last = -1;
    while (fgets(line, sizeof line, stdin)) {
        if (line[0] == '#') {
            if (strncmp(line, "# cycles:", 9) == 0) {
                cycles = strtol(line + 9, NULL, 10);
            }
            continue;
        }
        long at;
        unsigned addr, value;
        if (sscanf(line, "%ld %x %x", &at, &addr, &value) != 3) continue;
        if (at < last) {
            fprintf(stderr, "writes out of order at cycle %ld\n", at);
            return 1;
        }
        last = at;
        if (n_writes == cap) {
            cap = cap ? cap * 2 : 64;
            writes = realloc(writes, cap * sizeof(*writes));
        }
        writes[n_writes].at = at;
        writes[n_writes].addr = addr;
        writes[n_writes].value = value;
        n_writes++;
    }
    if (cycles < 0) {
        fprintf(stderr, "no `# cycles:` header before the first write\n");
        return 1;
    }
    qsort(writes, n_writes, sizeof(*writes), before_write);

    /* Zero-initialized: power off, every register 0, div_counter 0 - the
       same reset state as dsp.ts's `reset()` (divider = 0, frameStep = 7 is
       set later, inside GB_apu_init, once the log's NR52 write turns the
       power on; see README.md). */
    static GB_gameboy_t GB;
    memset(&GB, 0, sizeof(GB));
    GB.model = GB_MODEL_DMG_B;
    GB_set_sample_rate(&GB, 0); /* Leaves rendering off; see README.md. */

    int last_sample[GB_N_CHANNELS] = {0, 0, 0, 0};
    size_t wi = 0;
    for (long cycle = 0; cycle < cycles; cycle++) {
        while (wi < n_writes && writes[wi].at == cycle) {
            apply_write(&GB, writes[wi].addr, writes[wi].value);
            wi++;
        }
        tick_div(&GB);
        if (cycle % 2 == 1) {
            /* Real hardware's APU ticks at half the T-cycle rate (Core/
               timing.c's timers_run adds 2 apu_cycles per 4 T-cycles); one
               accumulated T-cycle becomes one apu-tick every other call. */
            GB.apu.apu_cycles += 1;
            GB_apu_run(&GB, true);
        }
        for (int v = 0; v < GB_N_CHANNELS; v++) {
            /* Not gb->apu.samples[v] directly: SameBoy briefly parks an
               invalidation sentinel (0x10) there when NR50/NR51 are written
               while a channel's DAC is off (update_sample's "Invalidate to
               force update" in GB_apu_write), and a DAC that is off never
               overwrites it. GB_get_channel_amplitude is SameBoy's own public
               accessor for this exact question, and returns 0 whenever the
               channel is not active - the DAC-off convention dsp.ts's own
               `output()` uses too. */
            int value = GB_get_channel_amplitude(&GB, (GB_channel_t)v);
            if (value != last_sample[v]) {
                last_sample[v] = value;
                printf("%ld %d %d\n", cycle, v, value);
            }
        }
    }

    free(writes);
    return 0;
}
