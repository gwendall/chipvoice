/*
 * This file is OURS, not SameBoy's. `vendor/apu.c` includes "gb.h" verbatim
 * (it cannot be edited, see ../README.md), and upstream's real gb.h pulls in
 * the CPU, the PPU, memory mapping, the whole console. All apu.c actually
 * touches is a handful of GB_gameboy_t fields, two trivial functions and a
 * few constants, enumerated below by grepping the vendored source for every
 * `gb->` field and every external `GB_*` symbol it calls. This header gives
 * it exactly that and nothing else.
 */
#pragma once

#define GB_INTERNAL
#include "vendor/defs.h"
#include "vendor/model.h"

#include <stdbool.h>
#include <stdint.h>

/* From save_state.h upstream: the enum-with-underlying-type helper apu.h's
   `skip_div_event` field uses. Reproduced here rather than vendoring the
   save-state machinery, which apu.c does not otherwise need. */
#if __clang_major__ >= 8 || __GNUC__ >= 13 || defined(__cplusplus)
#define GB_ENUM(type, ...) enum : type __VA_ARGS__
#else
#define GB_ENUM(type, ...) __typeof__((type)((enum __VA_ARGS__)0))
#endif

/* apu.c calls this on the audio-recording path (GB_set_sample_rate and
   friends), which we never exercise since we never set a sample rate.
   Upstream asserts the caller isn't the audio thread; we have one thread. */
#define GB_ASSERT_NOT_RUNNING_OTHER_THREAD(gb)

/* apu.c's SGB intro-animation hush check (`gb->sgb && gb->sgb->intro_animation
   < GB_SGB_INTRO_ANIMATION_LENGTH`) needs a complete type to compile, even
   though `sgb` is always NULL for us (we only ever build GB_MODEL_DMG_B) and
   the right-hand side of the `&&` never actually runs. */
#define GB_SGB_INTRO_ANIMATION_LENGTH 200
typedef struct GB_sgb_s {
    int16_t intro_animation;
} GB_sgb_t;

/* The IO register offsets apu.c reads or writes through `io_registers[]`,
   copied from upstream's Core/gb.h (an enum starting at the Joypad register;
   only the sound and LCD ones below are needed). */
enum {
    GB_IO_NR10 = 0x10,
    GB_IO_NR11 = 0x11,
    GB_IO_NR12 = 0x12,
    GB_IO_NR13 = 0x13,
    GB_IO_NR14 = 0x14,
    GB_IO_NR21 = 0x16,
    GB_IO_NR22 = 0x17,
    GB_IO_NR23 = 0x18,
    GB_IO_NR24 = 0x19,
    GB_IO_NR30 = 0x1A,
    GB_IO_NR31 = 0x1B,
    GB_IO_NR32 = 0x1C,
    GB_IO_NR33 = 0x1D,
    GB_IO_NR34 = 0x1E,
    GB_IO_NR41 = 0x20,
    GB_IO_NR42 = 0x21,
    GB_IO_NR43 = 0x22,
    GB_IO_NR44 = 0x23,
    GB_IO_NR50 = 0x24,
    GB_IO_NR51 = 0x25,
    GB_IO_NR52 = 0x26,
    GB_IO_WAV_START = 0x30,
    GB_IO_WAV_END = 0x3F,
    GB_IO_LCDC = 0x40,
    GB_IO_STAT = 0x41,
    GB_IO_RP = 0x56,
};
enum { GB_LCDC_ENABLE = 0x80 };

#include "vendor/apu.h"

/*
 * The real GB_gameboy_s has hundreds of fields (CPU registers, PPU state,
 * memory maps, timers...); apu.c only ever dereferences the eleven below
 * (found by grepping vendor/apu.c for `gb->`). Field order does not matter,
 * since apu.c only ever reaches them by name.
 */
struct GB_gameboy_s {
    GB_model_t model;
    bool cgb_double_speed;
    bool halted;
    bool stopped;
    bool during_div_write;
    uint16_t pc;
    uint16_t address_bus;
    uint16_t div_counter;
    uint8_t io_registers[0x80];
    GB_apu_t apu;
    GB_apu_output_t apu_output;
    GB_sgb_t *sgb;
};

/* apu.c's only two calls outside itself: both trivial, implemented in
   shim.c. Real SameBoy reads these from GB_gameboy_t fields set up by its
   model-switching code; a DMG-B's clock rate is a constant and its CGB-ness
   is always false, so there is nothing to compute. */
uint32_t GB_get_clock_rate(GB_gameboy_t *gb);
bool GB_is_cgb(const GB_gameboy_t *gb);
