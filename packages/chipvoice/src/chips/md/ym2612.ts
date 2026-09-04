/*
 * Copyright (C) 2017-2022 Alexey Khokholov (Nuke.YKT)
 * Copyright (C) 2026 the chipvoice contributors, for the port
 *
 * This file is a port of Nuked OPN2 and is free software; you can
 * redistribute it and/or modify it under the terms of the GNU Lesser General
 * Public License as published by the Free Software Foundation; either version
 * 2.1 of the License, or (at your option) any later version. It is distributed
 * in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
 * the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Lesser General Public License for more details.
 *
 * This is the one file in the chipvoice package that is not MIT.
 */

/**
 * The Yamaha YM2612, the Mega Drive's FM chip, ported from Nuked-OPN2.
 *
 * Nuked-OPN2 (Alexey Khokholov, LGPL 2.1) was written from a die shot of the
 * YM3438, the CMOS YM2612, and is cycle-exact against it: every operator,
 * envelope step and DAC quirk is a transistor's behaviour rather than a
 * formula. This is that code in TypeScript, line for line, with Nuked's own
 * names kept so the two can be read side by side and any divergence found
 * by the harness can be traced to a line. Nuked itself, built natively, is
 * the oracle: parity with it is parity with the silicon.
 *
 * What is here and what is not: the FM chip alone, at its internal clock -
 * one internal cycle is six of the input clock, and a full turn of the
 * 24-slot pipeline is one sample. `clock()` is `OPN2_Clock`; `write()` is
 * `OPN2_Write`, whose data lands a few cycles later, as it does on the chip.
 * The per-channel 9-bit outputs `ch_out` are what the harness compares; the
 * MOL/MOR pins, with the YM2612's ladder-DAC distortion, are what the output
 * stage takes.
 *
 * Version 1.0.12 of Nuked-OPN2, plus nothing.
 */

// The die's tables.

const logsinrom = new Uint16Array([
  0x859, 0x6c3, 0x607, 0x58b, 0x52e, 0x4e4, 0x4a6, 0x471,
  0x443, 0x41a, 0x3f5, 0x3d3, 0x3b5, 0x398, 0x37e, 0x365,
  0x34e, 0x339, 0x324, 0x311, 0x2ff, 0x2ed, 0x2dc, 0x2cd,
  0x2bd, 0x2af, 0x2a0, 0x293, 0x286, 0x279, 0x26d, 0x261,
  0x256, 0x24b, 0x240, 0x236, 0x22c, 0x222, 0x218, 0x20f,
  0x206, 0x1fd, 0x1f5, 0x1ec, 0x1e4, 0x1dc, 0x1d4, 0x1cd,
  0x1c5, 0x1be, 0x1b7, 0x1b0, 0x1a9, 0x1a2, 0x19b, 0x195,
  0x18f, 0x188, 0x182, 0x17c, 0x177, 0x171, 0x16b, 0x166,
  0x160, 0x15b, 0x155, 0x150, 0x14b, 0x146, 0x141, 0x13c,
  0x137, 0x133, 0x12e, 0x129, 0x125, 0x121, 0x11c, 0x118,
  0x114, 0x10f, 0x10b, 0x107, 0x103, 0x0ff, 0x0fb, 0x0f8,
  0x0f4, 0x0f0, 0x0ec, 0x0e9, 0x0e5, 0x0e2, 0x0de, 0x0db,
  0x0d7, 0x0d4, 0x0d1, 0x0cd, 0x0ca, 0x0c7, 0x0c4, 0x0c1,
  0x0be, 0x0bb, 0x0b8, 0x0b5, 0x0b2, 0x0af, 0x0ac, 0x0a9,
  0x0a7, 0x0a4, 0x0a1, 0x09f, 0x09c, 0x099, 0x097, 0x094,
  0x092, 0x08f, 0x08d, 0x08a, 0x088, 0x086, 0x083, 0x081,
  0x07f, 0x07d, 0x07a, 0x078, 0x076, 0x074, 0x072, 0x070,
  0x06e, 0x06c, 0x06a, 0x068, 0x066, 0x064, 0x062, 0x060,
  0x05e, 0x05c, 0x05b, 0x059, 0x057, 0x055, 0x053, 0x052,
  0x050, 0x04e, 0x04d, 0x04b, 0x04a, 0x048, 0x046, 0x045,
  0x043, 0x042, 0x040, 0x03f, 0x03e, 0x03c, 0x03b, 0x039,
  0x038, 0x037, 0x035, 0x034, 0x033, 0x031, 0x030, 0x02f,
  0x02e, 0x02d, 0x02b, 0x02a, 0x029, 0x028, 0x027, 0x026,
  0x025, 0x024, 0x023, 0x022, 0x021, 0x020, 0x01f, 0x01e,
  0x01d, 0x01c, 0x01b, 0x01a, 0x019, 0x018, 0x017, 0x017,
  0x016, 0x015, 0x014, 0x014, 0x013, 0x012, 0x011, 0x011,
  0x010, 0x00f, 0x00f, 0x00e, 0x00d, 0x00d, 0x00c, 0x00c,
  0x00b, 0x00a, 0x00a, 0x009, 0x009, 0x008, 0x008, 0x007,
  0x007, 0x007, 0x006, 0x006, 0x005, 0x005, 0x005, 0x004,
  0x004, 0x004, 0x003, 0x003, 0x003, 0x002, 0x002, 0x002,
  0x002, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001, 0x001,
  0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000, 0x000,
]);

const exprom = new Uint16Array([
  0x000, 0x003, 0x006, 0x008, 0x00b, 0x00e, 0x011, 0x014,
  0x016, 0x019, 0x01c, 0x01f, 0x022, 0x025, 0x028, 0x02a,
  0x02d, 0x030, 0x033, 0x036, 0x039, 0x03c, 0x03f, 0x042,
  0x045, 0x048, 0x04b, 0x04e, 0x051, 0x054, 0x057, 0x05a,
  0x05d, 0x060, 0x063, 0x066, 0x069, 0x06c, 0x06f, 0x072,
  0x075, 0x078, 0x07b, 0x07e, 0x082, 0x085, 0x088, 0x08b,
  0x08e, 0x091, 0x094, 0x098, 0x09b, 0x09e, 0x0a1, 0x0a4,
  0x0a8, 0x0ab, 0x0ae, 0x0b1, 0x0b5, 0x0b8, 0x0bb, 0x0be,
  0x0c2, 0x0c5, 0x0c8, 0x0cc, 0x0cf, 0x0d2, 0x0d6, 0x0d9,
  0x0dc, 0x0e0, 0x0e3, 0x0e7, 0x0ea, 0x0ed, 0x0f1, 0x0f4,
  0x0f8, 0x0fb, 0x0ff, 0x102, 0x106, 0x109, 0x10c, 0x110,
  0x114, 0x117, 0x11b, 0x11e, 0x122, 0x125, 0x129, 0x12c,
  0x130, 0x134, 0x137, 0x13b, 0x13e, 0x142, 0x146, 0x149,
  0x14d, 0x151, 0x154, 0x158, 0x15c, 0x160, 0x163, 0x167,
  0x16b, 0x16f, 0x172, 0x176, 0x17a, 0x17e, 0x181, 0x185,
  0x189, 0x18d, 0x191, 0x195, 0x199, 0x19c, 0x1a0, 0x1a4,
  0x1a8, 0x1ac, 0x1b0, 0x1b4, 0x1b8, 0x1bc, 0x1c0, 0x1c4,
  0x1c8, 0x1cc, 0x1d0, 0x1d4, 0x1d8, 0x1dc, 0x1e0, 0x1e4,
  0x1e8, 0x1ec, 0x1f0, 0x1f5, 0x1f9, 0x1fd, 0x201, 0x205,
  0x209, 0x20e, 0x212, 0x216, 0x21a, 0x21e, 0x223, 0x227,
  0x22b, 0x230, 0x234, 0x238, 0x23c, 0x241, 0x245, 0x249,
  0x24e, 0x252, 0x257, 0x25b, 0x25f, 0x264, 0x268, 0x26d,
  0x271, 0x276, 0x27a, 0x27f, 0x283, 0x288, 0x28c, 0x291,
  0x295, 0x29a, 0x29e, 0x2a3, 0x2a8, 0x2ac, 0x2b1, 0x2b5,
  0x2ba, 0x2bf, 0x2c4, 0x2c8, 0x2cd, 0x2d2, 0x2d6, 0x2db,
  0x2e0, 0x2e5, 0x2e9, 0x2ee, 0x2f3, 0x2f8, 0x2fd, 0x302,
  0x306, 0x30b, 0x310, 0x315, 0x31a, 0x31f, 0x324, 0x329,
  0x32e, 0x333, 0x338, 0x33d, 0x342, 0x347, 0x34c, 0x351,
  0x356, 0x35b, 0x360, 0x365, 0x36a, 0x370, 0x375, 0x37a,
  0x37f, 0x384, 0x38a, 0x38f, 0x394, 0x399, 0x39f, 0x3a4,
  0x3a9, 0x3ae, 0x3b4, 0x3b9, 0x3bf, 0x3c4, 0x3c9, 0x3cf,
  0x3d4, 0x3da, 0x3df, 0x3e4, 0x3ea, 0x3ef, 0x3f5, 0x3fa,
]);

const fn_note = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3];

const eg_stephi = [
  [0, 0, 0, 0],
  [1, 0, 0, 0],
  [1, 0, 1, 0],
  [1, 1, 1, 0],
];

const eg_am_shift = [7, 3, 1, 0];

const pg_detune = [16, 17, 19, 20, 22, 24, 27, 29];

const pg_lfo_sh1 = [
  [7, 7, 7, 7, 7, 7, 7, 7],
  [7, 7, 7, 7, 7, 7, 7, 7],
  [7, 7, 7, 7, 7, 7, 1, 1],
  [7, 7, 7, 7, 1, 1, 1, 1],
  [7, 7, 7, 1, 1, 1, 1, 0],
  [7, 7, 1, 1, 0, 0, 0, 0],
  [7, 7, 1, 1, 0, 0, 0, 0],
  [7, 7, 1, 1, 0, 0, 0, 0],
];

const pg_lfo_sh2 = [
  [7, 7, 7, 7, 7, 7, 7, 7],
  [7, 7, 7, 7, 2, 2, 2, 2],
  [7, 7, 7, 2, 2, 2, 7, 7],
  [7, 7, 2, 2, 7, 7, 2, 2],
  [7, 7, 2, 7, 7, 7, 2, 7],
  [7, 7, 7, 2, 7, 7, 2, 1],
  [7, 7, 7, 2, 7, 7, 2, 1],
  [7, 7, 7, 2, 7, 7, 2, 1],
];

/** Which register address each of the twelve slots answers to. */
const op_offset = [0x000, 0x001, 0x002, 0x100, 0x101, 0x102, 0x004, 0x005, 0x006, 0x104, 0x105, 0x106];
const ch_offset = [0x000, 0x001, 0x002, 0x100, 0x101, 0x102];

const lfo_cycles = [108, 77, 71, 67, 62, 44, 8, 5];

/** [op][line][connect]: what modulates what, and what reaches the output. */
const fm_algorithm = [
  [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1],
  ],
  [
    [0, 1, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [1, 1, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1],
  ],
  [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 1, 1, 1],
  ],
  [
    [0, 0, 1, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 0],
    [1, 1, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
  ],
];

const eg_num_attack = 0;
const eg_num_decay = 1;
const eg_num_sustain = 2;
const eg_num_release = 3;

/** C's `SIGN_EXTEND`: the low `bit` bits as a signed value. */
const signExtend = (bit: number, value: number) => (value & ((1 << bit) - 1)) - (value & (1 << bit));

/** The chip a Mega Drive had: the YM2612's DAC, or the YM3438's clean one. */
export type Ym2612Type = "ym2612" | "ym3438";

export class Ym2612 {
  /** Whether MOL/MOR carry the YM2612's ladder distortion. */
  readonly type: Ym2612Type;

  cycles = 0;
  channel = 0;
  mol = 0;
  mor = 0;
  // IO
  write_data = 0;
  write_a = 0;
  write_d = 0;
  write_a_en = 0;
  write_d_en = 0;
  write_busy = 0;
  write_busy_cnt = 0;
  write_fm_address = 0;
  write_fm_data = 0;
  write_fm_mode_a = 0;
  address = 0;
  data = 0;
  pin_test_in = 0;
  busy = 0;
  // LFO
  lfo_en = 0;
  lfo_freq = 0;
  lfo_pm = 0;
  lfo_am = 0;
  lfo_cnt = 0;
  lfo_inc = 0;
  lfo_quotient = 0;
  // Phase generator
  pg_fnum = 0;
  pg_block = 0;
  pg_kcode = 0;
  readonly pg_inc = new Uint32Array(24);
  readonly pg_phase = new Uint32Array(24);
  readonly pg_reset = new Uint8Array(24);
  pg_read = 0;
  // Envelope generator
  eg_cycle = 0;
  eg_cycle_stop = 0;
  eg_shift = 0;
  eg_shift_lock = 0;
  eg_timer_low_lock = 0;
  eg_timer = 0;
  eg_timer_inc = 0;
  eg_quotient = 0;
  eg_custom_timer = 0;
  eg_rate = 0;
  eg_ksv = 0;
  eg_inc = 0;
  eg_ratemax = 0;
  readonly eg_sl = new Uint8Array(2);
  eg_lfo_am = 0;
  readonly eg_tl = new Uint8Array(2);
  readonly eg_state = new Uint8Array(24);
  readonly eg_level = new Uint16Array(24);
  readonly eg_out = new Uint16Array(24);
  readonly eg_kon = new Uint8Array(24);
  readonly eg_kon_csm = new Uint8Array(24);
  readonly eg_kon_latch = new Uint8Array(24);
  readonly eg_csm_mode = new Uint8Array(24);
  readonly eg_ssg_enable = new Uint8Array(24);
  readonly eg_ssg_pgrst_latch = new Uint8Array(24);
  readonly eg_ssg_repeat_latch = new Uint8Array(24);
  readonly eg_ssg_hold_up_latch = new Uint8Array(24);
  readonly eg_ssg_dir = new Uint8Array(24);
  readonly eg_ssg_inv = new Uint8Array(24);
  readonly eg_read = new Uint32Array(2);
  eg_read_inc = 0;
  // FM
  readonly fm_op1 = [new Int16Array(2), new Int16Array(2), new Int16Array(2), new Int16Array(2), new Int16Array(2), new Int16Array(2)];
  readonly fm_op2 = new Int16Array(6);
  readonly fm_out = new Int16Array(24);
  readonly fm_mod = new Uint16Array(24);
  // Channel
  readonly ch_acc = new Int16Array(6);
  /** The nine-bit output of each channel, what the harness compares. */
  readonly ch_out = new Int16Array(6);
  ch_lock = 0;
  ch_lock_l = 0;
  ch_lock_r = 0;
  ch_read = 0;
  // Timers
  timer_a_cnt = 0;
  timer_a_reg = 0;
  timer_a_load_lock = 0;
  timer_a_load = 0;
  timer_a_enable = 0;
  timer_a_reset = 0;
  timer_a_load_latch = 0;
  timer_a_overflow_flag = 0;
  timer_a_overflow = 0;
  timer_b_cnt = 0;
  timer_b_subcnt = 0;
  timer_b_reg = 0;
  timer_b_load_lock = 0;
  timer_b_load = 0;
  timer_b_enable = 0;
  timer_b_reset = 0;
  timer_b_load_latch = 0;
  timer_b_overflow_flag = 0;
  timer_b_overflow = 0;
  // Registers
  readonly mode_test_21 = new Uint8Array(8);
  readonly mode_test_2c = new Uint8Array(8);
  mode_ch3 = 0;
  mode_kon_channel = 0;
  readonly mode_kon_operator = new Uint8Array(4);
  readonly mode_kon = new Uint8Array(24);
  mode_csm = 0;
  mode_kon_csm = 0;
  dacen = 0;
  dacdata = 0;
  readonly ks = new Uint8Array(24);
  readonly ar = new Uint8Array(24);
  readonly sr = new Uint8Array(24);
  readonly dt = new Uint8Array(24);
  readonly multi = new Uint8Array(24);
  readonly sl = new Uint8Array(24);
  readonly rr = new Uint8Array(24);
  readonly dr = new Uint8Array(24);
  readonly am = new Uint8Array(24);
  readonly tl = new Uint8Array(24);
  readonly ssg_eg = new Uint8Array(24);
  readonly fnum = new Uint16Array(6);
  readonly block = new Uint8Array(6);
  readonly kcode = new Uint8Array(6);
  readonly fnum_3ch = new Uint16Array(6);
  readonly block_3ch = new Uint8Array(6);
  readonly kcode_3ch = new Uint8Array(6);
  reg_a4 = 0;
  reg_ac = 0;
  readonly connect = new Uint8Array(6);
  readonly fb = new Uint8Array(6);
  readonly pan_l = new Uint8Array(6);
  readonly pan_r = new Uint8Array(6);
  readonly ams = new Uint8Array(6);
  readonly pms = new Uint8Array(6);
  status = 0;
  status_time = 0;

  constructor(type: Ym2612Type = "ym2612") {
    this.type = type;
    this.reset();
  }

  /** `OPN2_Reset`. */
  reset() {
    const keep = this.type;
    for (const key of Object.keys(this) as (keyof this)[]) {
      const v = this[key];
      if (typeof v === "number") (this as unknown as Record<string, unknown>)[key as string] = 0;
      else if (ArrayBuffer.isView(v)) (v as unknown as Uint8Array).fill(0);
      else if (Array.isArray(v)) for (const a of v as Int16Array[]) a.fill(0);
    }
    void keep;
    for (let i = 0; i < 24; i++) {
      this.eg_out[i] = 0x3ff;
      this.eg_level[i] = 0x3ff;
      this.eg_state[i] = eg_num_release;
      this.multi[i] = 1;
    }
    for (let i = 0; i < 6; i++) {
      this.pan_l[i] = 1;
      this.pan_r[i] = 1;
    }
  }

  /** `OPN2_Write`: a byte to one of the four ports, latched for the next cycles. */
  write(port: number, data: number) {
    port &= 3;
    this.write_data = ((port << 7) & 0x100) | (data & 0xff);
    if (port & 1) this.write_d |= 1;
    else this.write_a |= 1;
  }

  /** `OPN2_Read`: the status byte, busy and the timer flags. */
  read(port: number): number {
    if ((port & 3) === 0 || this.type === "ym3438") {
      if (this.mode_test_21[6]) {
        const slot = (this.cycles + 18) % 24;
        let testdata = ((this.pg_read & 0x01) << 15) | ((this.eg_read[this.mode_test_21[0]] & 0x01) << 14);
        if (this.mode_test_2c[4]) testdata |= this.ch_read & 0x1ff;
        else testdata |= this.fm_out[slot] & 0x3fff;
        this.status = this.mode_test_21[7] ? testdata & 0xff : testdata >> 8;
      } else {
        this.status = (this.busy << 7) | (this.timer_b_overflow_flag << 1) | this.timer_a_overflow_flag;
      }
      this.status_time = this.type === "ym2612" ? 300000 : 40000000;
    }
    return this.status_time ? this.status : 0;
  }

  private doIO() {
    this.write_a_en = (this.write_a & 0x03) === 0x01 ? 1 : 0;
    this.write_d_en = (this.write_d & 0x03) === 0x01 ? 1 : 0;
    this.write_a = (this.write_a << 1) & 0xff;
    this.write_d = (this.write_d << 1) & 0xff;
    this.busy = this.write_busy;
    this.write_busy_cnt = (this.write_busy_cnt + this.write_busy) & 0xff;
    this.write_busy = (this.write_busy && !(this.write_busy_cnt >> 5)) || this.write_d_en ? 1 : 0;
    this.write_busy_cnt &= 0x1f;
  }

  private doRegWrite() {
    let slot = this.cycles % 12;
    const channel = this.channel;
    if (this.write_fm_data) {
      if (op_offset[slot] === (this.address & 0x107)) {
        if (this.address & 0x08) slot += 12;
        switch (this.address & 0xf0) {
          case 0x30:
            this.multi[slot] = this.data & 0x0f;
            if (!this.multi[slot]) this.multi[slot] = 1;
            else this.multi[slot] <<= 1;
            this.dt[slot] = (this.data >> 4) & 0x07;
            break;
          case 0x40:
            this.tl[slot] = this.data & 0x7f;
            break;
          case 0x50:
            this.ar[slot] = this.data & 0x1f;
            this.ks[slot] = (this.data >> 6) & 0x03;
            break;
          case 0x60:
            this.dr[slot] = this.data & 0x1f;
            this.am[slot] = (this.data >> 7) & 0x01;
            break;
          case 0x70:
            this.sr[slot] = this.data & 0x1f;
            break;
          case 0x80:
            this.rr[slot] = this.data & 0x0f;
            this.sl[slot] = (this.data >> 4) & 0x0f;
            this.sl[slot] |= (this.sl[slot] + 1) & 0x10;
            break;
          case 0x90:
            this.ssg_eg[slot] = this.data & 0x0f;
            break;
          default:
            break;
        }
      }
      if (ch_offset[channel] === (this.address & 0x103)) {
        switch (this.address & 0xfc) {
          case 0xa0:
            this.fnum[channel] = (this.data & 0xff) | ((this.reg_a4 & 0x07) << 8);
            this.block[channel] = (this.reg_a4 >> 3) & 0x07;
            this.kcode[channel] = (this.block[channel] << 2) | fn_note[this.fnum[channel] >> 7];
            break;
          case 0xa4:
            this.reg_a4 = this.data & 0xff;
            break;
          case 0xa8:
            this.fnum_3ch[channel] = (this.data & 0xff) | ((this.reg_ac & 0x07) << 8);
            this.block_3ch[channel] = (this.reg_ac >> 3) & 0x07;
            this.kcode_3ch[channel] = (this.block_3ch[channel] << 2) | fn_note[this.fnum_3ch[channel] >> 7];
            break;
          case 0xac:
            this.reg_ac = this.data & 0xff;
            break;
          case 0xb0:
            this.connect[channel] = this.data & 0x07;
            this.fb[channel] = (this.data >> 3) & 0x07;
            break;
          case 0xb4:
            this.pms[channel] = this.data & 0x07;
            this.ams[channel] = (this.data >> 4) & 0x03;
            this.pan_l[channel] = (this.data >> 7) & 0x01;
            this.pan_r[channel] = (this.data >> 6) & 0x01;
            break;
          default:
            break;
        }
      }
    }

    if (this.write_a_en || this.write_d_en) {
      if (this.write_a_en) this.write_fm_data = 0;
      if (this.write_fm_address && this.write_d_en) this.write_fm_data = 1;
      if (this.write_a_en) {
        if ((this.write_data & 0xf0) !== 0x00) {
          this.address = this.write_data;
          this.write_fm_address = 1;
        } else {
          this.write_fm_address = 0;
        }
      }
      if (this.write_d_en && (this.write_data & 0x100) === 0) {
        switch (this.write_fm_mode_a) {
          case 0x21:
            for (let i = 0; i < 8; i++) this.mode_test_21[i] = (this.write_data >> i) & 0x01;
            break;
          case 0x22:
            this.lfo_en = (this.write_data >> 3) & 0x01 ? 0x7f : 0;
            this.lfo_freq = this.write_data & 0x07;
            break;
          case 0x24:
            this.timer_a_reg &= 0x03;
            this.timer_a_reg |= (this.write_data & 0xff) << 2;
            break;
          case 0x25:
            this.timer_a_reg &= 0x3fc;
            this.timer_a_reg |= this.write_data & 0x03;
            break;
          case 0x26:
            this.timer_b_reg = this.write_data & 0xff;
            break;
          case 0x27:
            this.mode_ch3 = (this.write_data & 0xc0) >> 6;
            this.mode_csm = this.mode_ch3 === 2 ? 1 : 0;
            this.timer_a_load = this.write_data & 0x01;
            this.timer_a_enable = (this.write_data >> 2) & 0x01;
            this.timer_a_reset = (this.write_data >> 4) & 0x01;
            this.timer_b_load = (this.write_data >> 1) & 0x01;
            this.timer_b_enable = (this.write_data >> 3) & 0x01;
            this.timer_b_reset = (this.write_data >> 5) & 0x01;
            break;
          case 0x28:
            for (let i = 0; i < 4; i++) this.mode_kon_operator[i] = (this.write_data >> (4 + i)) & 0x01;
            if ((this.write_data & 0x03) === 0x03) this.mode_kon_channel = 0xff;
            else this.mode_kon_channel = (this.write_data & 0x03) + ((this.write_data >> 2) & 1) * 3;
            break;
          case 0x2a:
            this.dacdata &= 0x01;
            this.dacdata |= ((this.write_data & 0xff) ^ 0x80) << 1;
            break;
          case 0x2b:
            this.dacen = (this.write_data & 0xff) >> 7;
            break;
          case 0x2c:
            for (let i = 0; i < 8; i++) this.mode_test_2c[i] = (this.write_data >> i) & 0x01;
            this.dacdata &= 0x1fe;
            this.dacdata |= this.mode_test_2c[3];
            this.eg_custom_timer = !this.mode_test_2c[7] && this.mode_test_2c[6] ? 1 : 0;
            break;
          default:
            break;
        }
      }
      if (this.write_a_en) this.write_fm_mode_a = this.write_data & 0x1ff;
    }

    if (this.write_fm_data) this.data = this.write_data & 0xff;
  }

  private phaseCalcIncrement() {
    const chan = this.channel;
    const slot = this.cycles;
    let fnum = this.pg_fnum;
    const fnum_h = fnum >> 4;
    const lfo = this.lfo_pm;
    let lfo_l = lfo & 0x0f;
    const pms = this.pms[chan];
    const dt = this.dt[slot];
    const dt_l = dt & 0x03;
    let detune = 0;
    let kcode = this.pg_kcode;

    fnum <<= 1;
    if (lfo_l & 0x08) lfo_l ^= 0x0f;
    let fm = (fnum_h >> pg_lfo_sh1[pms][lfo_l]) + (fnum_h >> pg_lfo_sh2[pms][lfo_l]);
    if (pms > 5) fm <<= pms - 5;
    fm >>= 2;
    if (lfo & 0x10) fnum -= fm;
    else fnum += fm;
    fnum &= 0xfff;

    let basefreq = (fnum << this.pg_block) >> 2;

    if (dt_l) {
      if (kcode > 0x1c) kcode = 0x1c;
      const block = kcode >> 2;
      const note = kcode & 0x03;
      const sum = block + 9 + ((dt_l === 3 ? 1 : 0) | (dt_l & 0x02));
      const sum_h = sum >> 1;
      const sum_l = sum & 0x01;
      detune = pg_detune[(sum_l << 2) | note] >> (9 - sum_h);
    }
    if (dt & 0x04) basefreq -= detune;
    else basefreq += detune;
    basefreq &= 0x1ffff;
    this.pg_inc[slot] = ((basefreq * this.multi[slot]) >> 1) & 0xfffff;
  }

  private phaseGenerate() {
    let slot = (this.cycles + 20) % 24;
    if (this.pg_reset[slot]) this.pg_inc[slot] = 0;
    slot = (this.cycles + 19) % 24;
    if (this.pg_reset[slot] || this.mode_test_21[3]) this.pg_phase[slot] = 0;
    this.pg_phase[slot] = (this.pg_phase[slot] + this.pg_inc[slot]) & 0xfffff;
  }

  private envelopeSSGEG() {
    const slot = this.cycles;
    let direction = 0;
    this.eg_ssg_pgrst_latch[slot] = 0;
    this.eg_ssg_repeat_latch[slot] = 0;
    this.eg_ssg_hold_up_latch[slot] = 0;
    if (this.ssg_eg[slot] & 0x08) {
      direction = this.eg_ssg_dir[slot];
      if (this.eg_level[slot] & 0x200) {
        if ((this.ssg_eg[slot] & 0x03) === 0x00) this.eg_ssg_pgrst_latch[slot] = 1;
        if ((this.ssg_eg[slot] & 0x01) === 0x00) this.eg_ssg_repeat_latch[slot] = 1;
        if ((this.ssg_eg[slot] & 0x03) === 0x02) direction ^= 1;
        if ((this.ssg_eg[slot] & 0x03) === 0x03) direction = 1;
      }
      if (this.eg_kon_latch[slot] && ((this.ssg_eg[slot] & 0x07) === 0x05 || (this.ssg_eg[slot] & 0x07) === 0x03)) {
        this.eg_ssg_hold_up_latch[slot] = 1;
      }
      direction &= this.eg_kon[slot];
    }
    this.eg_ssg_dir[slot] = direction;
    this.eg_ssg_enable[slot] = (this.ssg_eg[slot] >> 3) & 0x01;
    this.eg_ssg_inv[slot] = (this.eg_ssg_dir[slot] ^ (((this.ssg_eg[slot] >> 2) & 0x01) & ((this.ssg_eg[slot] >> 3) & 0x01))) & this.eg_kon[slot];
  }

  private envelopeADSR() {
    const slot = (this.cycles + 22) % 24;
    const nkon = this.eg_kon_latch[slot];
    const okon = this.eg_kon[slot];
    let nextstate = this.eg_state[slot];
    let inc = 0;
    this.eg_read[0] = this.eg_read_inc;
    this.eg_read_inc = this.eg_inc > 0 ? 1 : 0;

    this.pg_reset[slot] = (nkon && !okon) || this.eg_ssg_pgrst_latch[slot] ? 1 : 0;

    const kon_event = (nkon && !okon) || (okon && this.eg_ssg_repeat_latch[slot]);
    const koff_event = okon && !nkon;

    let level = this.eg_level[slot];
    let ssg_level = level;
    if (this.eg_ssg_inv[slot]) ssg_level = (512 - level) & 0x3ff;
    if (koff_event) level = ssg_level;
    let eg_off: number;
    if (this.eg_ssg_enable[slot]) eg_off = level >> 9;
    else eg_off = (level & 0x3f0) === 0x3f0 ? 1 : 0;
    let nextlevel = level;
    if (kon_event) {
      nextstate = eg_num_attack;
      if (this.eg_ratemax) nextlevel = 0;
      else if (this.eg_state[slot] === eg_num_attack && level !== 0 && this.eg_inc && nkon) inc = (~level << this.eg_inc) >> 5;
    } else {
      switch (this.eg_state[slot]) {
        case eg_num_attack:
          if (level === 0) nextstate = eg_num_decay;
          else if (this.eg_inc && !this.eg_ratemax && nkon) inc = (~level << this.eg_inc) >> 5;
          break;
        case eg_num_decay:
          if (level >> 4 === this.eg_sl[1] << 1) nextstate = eg_num_sustain;
          else if (!eg_off && this.eg_inc) {
            inc = 1 << (this.eg_inc - 1);
            if (this.eg_ssg_enable[slot]) inc <<= 2;
          }
          break;
        case eg_num_sustain:
        case eg_num_release:
          if (!eg_off && this.eg_inc) {
            inc = 1 << (this.eg_inc - 1);
            if (this.eg_ssg_enable[slot]) inc <<= 2;
          }
          break;
        default:
          break;
      }
      if (!nkon) nextstate = eg_num_release;
    }
    if (this.eg_kon_csm[slot]) nextlevel |= this.eg_tl[1] << 3;

    if (!kon_event && !this.eg_ssg_hold_up_latch[slot] && this.eg_state[slot] !== eg_num_attack && eg_off) {
      nextstate = eg_num_release;
      nextlevel = 0x3ff;
    }

    nextlevel += inc;

    this.eg_kon[slot] = this.eg_kon_latch[slot];
    this.eg_level[slot] = nextlevel & 0x3ff;
    this.eg_state[slot] = nextstate;
  }

  private envelopePrepare() {
    let inc = 0;
    const slot = this.cycles;

    let rate = (this.eg_rate << 1) + this.eg_ksv;
    if (rate > 0x3f) rate = 0x3f;

    const sum = ((rate >> 2) + this.eg_shift_lock) & 0x0f;
    if (this.eg_rate !== 0 && this.eg_quotient === 2) {
      if (rate < 48) {
        switch (sum) {
          case 12:
            inc = 1;
            break;
          case 13:
            inc = (rate >> 1) & 0x01;
            break;
          case 14:
            inc = rate & 0x01;
            break;
          default:
            break;
        }
      } else {
        inc = eg_stephi[rate & 0x03][this.eg_timer_low_lock] + (rate >> 2) - 11;
        if (inc > 4) inc = 4;
      }
    }
    this.eg_inc = inc;
    this.eg_ratemax = rate >> 1 === 0x1f ? 1 : 0;

    let rate_sel = this.eg_state[slot];
    if ((this.eg_kon[slot] && this.eg_ssg_repeat_latch[slot]) || (!this.eg_kon[slot] && this.eg_kon_latch[slot])) {
      rate_sel = eg_num_attack;
    }
    switch (rate_sel) {
      case eg_num_attack:
        this.eg_rate = this.ar[slot];
        break;
      case eg_num_decay:
        this.eg_rate = this.dr[slot];
        break;
      case eg_num_sustain:
        this.eg_rate = this.sr[slot];
        break;
      case eg_num_release:
        this.eg_rate = (this.rr[slot] << 1) | 0x01;
        break;
      default:
        break;
    }
    this.eg_ksv = this.pg_kcode >> (this.ks[slot] ^ 0x03);
    if (this.am[slot]) this.eg_lfo_am = this.lfo_am >> eg_am_shift[this.ams[this.channel]];
    else this.eg_lfo_am = 0;
    this.eg_tl[1] = this.eg_tl[0];
    this.eg_tl[0] = this.tl[slot];
    this.eg_sl[1] = this.eg_sl[0];
    this.eg_sl[0] = this.sl[slot];
  }

  private envelopeGenerate() {
    const slot = (this.cycles + 23) % 24;
    let level = this.eg_level[slot];
    if (this.eg_ssg_inv[slot]) level = 512 - level;
    if (this.mode_test_21[5]) level = 0;
    level &= 0x3ff;
    level += this.eg_lfo_am;
    if (!(this.mode_csm && this.channel === 2 + 1)) level += this.eg_tl[0] << 3;
    if (level > 0x3ff) level = 0x3ff;
    this.eg_out[slot] = level;
  }

  private updateLFO() {
    if ((this.lfo_quotient & lfo_cycles[this.lfo_freq]) === lfo_cycles[this.lfo_freq]) {
      this.lfo_quotient = 0;
      this.lfo_cnt = (this.lfo_cnt + 1) & 0xff;
    } else {
      this.lfo_quotient = (this.lfo_quotient + this.lfo_inc) & 0xff;
    }
    this.lfo_cnt &= this.lfo_en;
  }

  private fmPrepare() {
    let slot = (this.cycles + 6) % 24;
    const channel = this.channel;
    const op = (slot / 6) | 0;
    const connect = this.connect[channel];
    const prevslot = (this.cycles + 18) % 24;

    let mod1 = 0;
    let mod2 = 0;
    if (fm_algorithm[op][0][connect]) mod2 |= this.fm_op1[channel][0];
    if (fm_algorithm[op][1][connect]) mod1 |= this.fm_op1[channel][1];
    if (fm_algorithm[op][2][connect]) mod1 |= this.fm_op2[channel];
    if (fm_algorithm[op][3][connect]) mod2 |= this.fm_out[prevslot];
    if (fm_algorithm[op][4][connect]) mod1 |= this.fm_out[prevslot];
    // Bit16s: the sum, and the ORs above, live in sixteen bits.
    let mod = ((mod1 << 16) >> 16) + ((mod2 << 16) >> 16);
    mod = (mod << 16) >> 16;
    if (op === 0) {
      mod = mod >> (10 - this.fb[channel]);
      if (!this.fb[channel]) mod = 0;
    } else {
      mod >>= 1;
    }
    this.fm_mod[slot] = mod & 0xffff;

    slot = (this.cycles + 18) % 24;
    if (((slot / 6) | 0) === 0) {
      this.fm_op1[channel][1] = this.fm_op1[channel][0];
      this.fm_op1[channel][0] = this.fm_out[slot];
    }
    if (((slot / 6) | 0) === 2) this.fm_op2[channel] = this.fm_out[slot];
  }

  private chGenerate() {
    const slot = (this.cycles + 18) % 24;
    const channel = this.channel;
    const op = (slot / 6) | 0;
    const test_dac = this.mode_test_2c[5];
    let acc = this.ch_acc[channel];
    let add = test_dac;
    if (op === 0 && !test_dac) acc = 0;
    if (fm_algorithm[op][5][this.connect[channel]] && !test_dac) add += this.fm_out[slot] >> 5;
    let sum = acc + add;
    if (sum > 255) sum = 255;
    else if (sum < -256) sum = -256;
    if (op === 0 || test_dac) this.ch_out[channel] = this.ch_acc[channel];
    this.ch_acc[channel] = sum;
  }

  private chOutput() {
    const cycles = this.cycles;
    const slot = this.cycles;
    let channel = this.channel;
    const test_dac = this.mode_test_2c[5];
    let out: number;
    this.ch_read = this.ch_lock;
    if (slot < 12) channel++;
    if ((cycles & 3) === 0) {
      if (!test_dac) this.ch_lock = this.ch_out[channel];
      this.ch_lock_l = this.pan_l[channel];
      this.ch_lock_r = this.pan_r[channel];
    }
    if ((cycles >> 2 === 1 && this.dacen) || test_dac) {
      out = signExtend(8, this.dacdata);
    } else {
      out = this.ch_lock;
    }
    this.mol = 0;
    this.mor = 0;

    if (this.type === "ym2612") {
      const out_en = (cycles & 3) === 3 || test_dac;
      // The YM2612's DAC, as Nuked has it, marked "not verified" there.
      let sign = out >> 8;
      if (out >= 0) {
        out++;
        sign++;
      }
      this.mol = this.ch_lock_l && out_en ? out : sign;
      this.mor = this.ch_lock_r && out_en ? out : sign;
      this.mol *= 3;
      this.mor *= 3;
    } else {
      const out_en = (cycles & 3) !== 0 || test_dac;
      if (this.ch_lock_l && out_en) this.mol = out;
      if (this.ch_lock_r && out_en) this.mor = out;
    }
  }

  private fmGenerate() {
    const slot = (this.cycles + 19) % 24;
    const phase = (this.fm_mod[slot] + (this.pg_phase[slot] >> 10)) & 0x3ff;
    const quarter = phase & 0x100 ? (phase ^ 0xff) & 0xff : phase & 0xff;
    let level = logsinrom[quarter];
    level += this.eg_out[slot] << 2;
    if (level > 0x1fff) level = 0x1fff;
    let output = ((exprom[(level & 0xff) ^ 0xff] | 0x400) << 2) >> (level >> 8);
    if (phase & 0x200) output = (~output ^ (this.mode_test_21[4] << 13)) + 1;
    else output = output ^ (this.mode_test_21[4] << 13);
    output = signExtend(13, output);
    this.fm_out[slot] = output;
  }

  private doTimerA() {
    let load = this.timer_a_overflow;
    if (this.cycles === 2) {
      load |= !this.timer_a_load_lock && this.timer_a_load ? 1 : 0;
      this.timer_a_load_lock = this.timer_a_load;
      this.mode_kon_csm = this.mode_csm ? load : 0;
    }
    let time = this.timer_a_load_latch ? this.timer_a_reg : this.timer_a_cnt;
    this.timer_a_load_latch = load;
    if ((this.cycles === 1 && this.timer_a_load_lock) || this.mode_test_21[2]) time++;
    if (this.timer_a_reset) {
      this.timer_a_reset = 0;
      this.timer_a_overflow_flag = 0;
    } else {
      this.timer_a_overflow_flag |= this.timer_a_overflow & this.timer_a_enable;
    }
    this.timer_a_overflow = time >> 10;
    this.timer_a_cnt = time & 0x3ff;
  }

  private doTimerB() {
    let load = this.timer_b_overflow;
    if (this.cycles === 2) {
      load |= !this.timer_b_load_lock && this.timer_b_load ? 1 : 0;
      this.timer_b_load_lock = this.timer_b_load;
    }
    let time = this.timer_b_load_latch ? this.timer_b_reg : this.timer_b_cnt;
    this.timer_b_load_latch = load;
    if (this.cycles === 1) this.timer_b_subcnt = (this.timer_b_subcnt + 1) & 0xff;
    if ((this.timer_b_subcnt === 0x10 && this.timer_b_load_lock) || this.mode_test_21[2]) time++;
    this.timer_b_subcnt &= 0x0f;
    if (this.timer_b_reset) {
      this.timer_b_reset = 0;
      this.timer_b_overflow_flag = 0;
    } else {
      this.timer_b_overflow_flag |= this.timer_b_overflow & this.timer_b_enable;
    }
    this.timer_b_overflow = time >> 8;
    this.timer_b_cnt = time & 0xff;
  }

  private keyOn() {
    const slot = this.cycles;
    const chan = this.channel;
    this.eg_kon_latch[slot] = this.mode_kon[slot];
    this.eg_kon_csm[slot] = 0;
    if (this.channel === 2 && this.mode_kon_csm) {
      this.eg_kon_latch[slot] = 1;
      this.eg_kon_csm[slot] = 1;
    }
    if (this.cycles === this.mode_kon_channel) {
      this.mode_kon[chan] = this.mode_kon_operator[0];
      this.mode_kon[chan + 12] = this.mode_kon_operator[1];
      this.mode_kon[chan + 6] = this.mode_kon_operator[2];
      this.mode_kon[chan + 18] = this.mode_kon_operator[3];
    }
  }

  /** `OPN2_Clock`: one internal cycle, six of the input clock. */
  clock() {
    const slot = this.cycles;
    this.lfo_inc = this.mode_test_21[1];
    this.pg_read >>>= 1;
    this.eg_read[1] >>>= 1;
    this.eg_cycle = (this.eg_cycle + 1) & 0xff;
    if (this.cycles === 1 && this.eg_quotient === 2) {
      if (this.eg_cycle_stop) this.eg_shift_lock = 0;
      else this.eg_shift_lock = this.eg_shift + 1;
      this.eg_timer_low_lock = this.eg_timer & 0x03;
    }
    switch (this.cycles) {
      case 0:
        this.lfo_pm = this.lfo_cnt >> 2;
        if (this.lfo_cnt & 0x40) this.lfo_am = this.lfo_cnt & 0x3f;
        else this.lfo_am = this.lfo_cnt ^ 0x3f;
        this.lfo_am = (this.lfo_am << 1) & 0xff;
        break;
      case 1:
        this.eg_quotient = (this.eg_quotient + 1) % 3;
        this.eg_cycle = 0;
        this.eg_cycle_stop = 1;
        this.eg_shift = 0;
        this.eg_timer_inc |= this.eg_quotient >> 1;
        this.eg_timer = (this.eg_timer + this.eg_timer_inc) & 0xffff;
        this.eg_timer_inc = this.eg_timer >> 12;
        this.eg_timer &= 0xfff;
        break;
      case 2:
        this.pg_read = this.pg_phase[21] & 0x3ff;
        this.eg_read[1] = this.eg_out[0];
        break;
      case 13:
        this.eg_cycle = 0;
        this.eg_cycle_stop = 1;
        this.eg_shift = 0;
        this.eg_timer = (this.eg_timer + this.eg_timer_inc) & 0xffff;
        this.eg_timer_inc = this.eg_timer >> 12;
        this.eg_timer &= 0xfff;
        break;
      case 23:
        this.lfo_inc |= 1;
        break;
      default:
        break;
    }
    this.eg_timer &= ~(this.mode_test_21[5] << this.eg_cycle) & 0xffff;
    if (((this.eg_timer >> this.eg_cycle) | (this.pin_test_in & this.eg_custom_timer)) & this.eg_cycle_stop) {
      this.eg_shift = this.eg_cycle;
      this.eg_cycle_stop = 0;
    }

    this.doIO();
    this.doTimerA();
    this.doTimerB();
    this.keyOn();
    this.chOutput();
    this.chGenerate();
    this.fmPrepare();
    this.fmGenerate();
    this.phaseGenerate();
    this.phaseCalcIncrement();
    this.envelopeADSR();
    this.envelopeGenerate();
    this.envelopeSSGEG();
    this.envelopePrepare();

    if (this.mode_ch3) {
      switch (slot) {
        case 1:
          this.pg_fnum = this.fnum_3ch[1];
          this.pg_block = this.block_3ch[1];
          this.pg_kcode = this.kcode_3ch[1];
          break;
        case 7:
          this.pg_fnum = this.fnum_3ch[0];
          this.pg_block = this.block_3ch[0];
          this.pg_kcode = this.kcode_3ch[0];
          break;
        case 13:
          this.pg_fnum = this.fnum_3ch[2];
          this.pg_block = this.block_3ch[2];
          this.pg_kcode = this.kcode_3ch[2];
          break;
        case 19:
        default:
          this.pg_fnum = this.fnum[(this.channel + 1) % 6];
          this.pg_block = this.block[(this.channel + 1) % 6];
          this.pg_kcode = this.kcode[(this.channel + 1) % 6];
          break;
      }
    } else {
      this.pg_fnum = this.fnum[(this.channel + 1) % 6];
      this.pg_block = this.block[(this.channel + 1) % 6];
      this.pg_kcode = this.kcode[(this.channel + 1) % 6];
    }

    this.updateLFO();
    this.doRegWrite();
    this.cycles = (this.cycles + 1) % 24;
    this.channel = this.cycles % 6;

    if (this.status_time) this.status_time--;
  }
}
