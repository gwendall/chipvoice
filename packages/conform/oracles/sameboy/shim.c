/*
 * Ours: the two functions vendor/apu.c calls outside itself. Real SameBoy
 * derives both from the running model and clock multiplier; a DMG-B never
 * changes model or speed, so both collapse to a constant.
 */
#include "gb.h"

uint32_t GB_get_clock_rate(GB_gameboy_t *gb) {
    (void)gb;
    return 4194304; /* DMG-B, single speed: gbChip.spec.clockHz in dmg.mjs. */
}

bool GB_is_cgb(const GB_gameboy_t *gb) {
    return gb->model >= GB_MODEL_CGB_0;
}
