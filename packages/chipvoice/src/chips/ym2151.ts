/*
 * Copyright (C) 2020, 2026 Nuke.YKT
 * Copyright (C) 2026 the chipvoice contributors, for the port
 *
 * This file is a port of Nuked OPM and is free software; you can
 * redistribute it and/or modify it under the terms of the GNU Lesser General
 * Public License as published by the Free Software Foundation; either version
 * 2.1 of the License, or (at your option) any later version. It is distributed
 * in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
 * the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Lesser General Public License for more details.
 *
 * This file is under LGPL-2.1-or-later, not this package's usual MIT; see
 * `docs/DECISIONS.md`'s decision 17 (the YM2612 precedent) and decision 51
 * (this port).
 */

/**
 * The Yamaha YM2151 (OPM), ported from Nuked-OPM.
 *
 * Nuked-OPM (Nuke.YKT, LGPL 2.1) was written from a YM2151 die shot (John
 * McMaster's decap) and is cycle-exact against it: every operator, envelope
 * step and LFO quirk is a transistor's behaviour rather than a formula. This
 * is that code in TypeScript, line for line, with Nuked's own field and
 * function names kept (snake_case fields, camelCase methods with the
 * `OPM_` prefix dropped) so the two can be read side by side and any
 * divergence the harness finds can be traced to a line. Nuked itself, built
 * natively, is the oracle for this core; see `docs/DECISIONS.md`'s decision
 * 51 and `packages/conform/oracles/nuked-opm/README.md`.
 *
 * What is here and what is not: the FM chip alone, at its internal clock -
 * `clock()` is `OPM_Clock`, one call per internal cycle, 32 cycles to a full
 * pipeline turn and 64 input clocks to a sample (the pipeline runs at half
 * the input clock, per Nuked-OPM's own README). `write()` is `OPM_Write`;
 * its data lands a few cycles later, as it does on the chip. Only the
 * YM2151 itself is modeled - Nuked-OPM's `opm_flags_ym2164` variant (the
 * YM2164/OPP, a different chip with a TL ramp and a wider register map) is
 * out of scope for this ticket, and every `chip->opp` branch of the
 * original C is simply the YM2151 (`opp = 0`) branch here, verbatim; the OPP
 * branches, and `OPP_TLRamp` itself, are not ported. A handful of struct
 * fields the original declares but never reads or writes at all
 * (`mix_op`, `eg_clockquotinent`, `eg_ams`, `nc_bit`, `kon_do`) are left out
 * too - dead state in the reference, confirmed by grepping every use.
 *
 * Nuked-OPM sums all eight channels into one shared stereo accumulator
 * (`mix`/`op_mix`), the way the real DAC's serial mixer does - the YM2151
 * has no per-channel output pin the way YM2612's `ch_out` is a real field of
 * that chip (see `chips/md/ym2612.ts`'s own doc comment); its only outputs
 * are the two DAC pins. Reading `dac_output` after every `clock()` is this
 * port's own convention, not a field Nuked-OPM's own API exposes by return
 * value, but the field itself is genuine (`OPM_Clock` copies it out through
 * its `output` pointer every cycle) - it updates only when `smp_sh1`/
 * `smp_sh2` fire, matching the sample-and-hold DAC. This is also why the
 * conformance harness compares two voices, L and R, not eight or ten: they
 * are the only outputs this chip actually has.
 *
 * Version 1.0 of Nuked-OPM, plus nothing.
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
  0x7fa, 0x7f5, 0x7ef, 0x7ea, 0x7e4, 0x7df, 0x7da, 0x7d4,
  0x7cf, 0x7c9, 0x7c4, 0x7bf, 0x7b9, 0x7b4, 0x7ae, 0x7a9,
  0x7a4, 0x79f, 0x799, 0x794, 0x78f, 0x78a, 0x784, 0x77f,
  0x77a, 0x775, 0x770, 0x76a, 0x765, 0x760, 0x75b, 0x756,
  0x751, 0x74c, 0x747, 0x742, 0x73d, 0x738, 0x733, 0x72e,
  0x729, 0x724, 0x71f, 0x71a, 0x715, 0x710, 0x70b, 0x706,
  0x702, 0x6fd, 0x6f8, 0x6f3, 0x6ee, 0x6e9, 0x6e5, 0x6e0,
  0x6db, 0x6d6, 0x6d2, 0x6cd, 0x6c8, 0x6c4, 0x6bf, 0x6ba,
  0x6b5, 0x6b1, 0x6ac, 0x6a8, 0x6a3, 0x69e, 0x69a, 0x695,
  0x691, 0x68c, 0x688, 0x683, 0x67f, 0x67a, 0x676, 0x671,
  0x66d, 0x668, 0x664, 0x65f, 0x65b, 0x657, 0x652, 0x64e,
  0x649, 0x645, 0x641, 0x63c, 0x638, 0x634, 0x630, 0x62b,
  0x627, 0x623, 0x61e, 0x61a, 0x616, 0x612, 0x60e, 0x609,
  0x605, 0x601, 0x5fd, 0x5f9, 0x5f5, 0x5f0, 0x5ec, 0x5e8,
  0x5e4, 0x5e0, 0x5dc, 0x5d8, 0x5d4, 0x5d0, 0x5cc, 0x5c8,
  0x5c4, 0x5c0, 0x5bc, 0x5b8, 0x5b4, 0x5b0, 0x5ac, 0x5a8,
  0x5a4, 0x5a0, 0x59c, 0x599, 0x595, 0x591, 0x58d, 0x589,
  0x585, 0x581, 0x57e, 0x57a, 0x576, 0x572, 0x56f, 0x56b,
  0x567, 0x563, 0x560, 0x55c, 0x558, 0x554, 0x551, 0x54d,
  0x549, 0x546, 0x542, 0x53e, 0x53b, 0x537, 0x534, 0x530,
  0x52c, 0x529, 0x525, 0x522, 0x51e, 0x51b, 0x517, 0x514,
  0x510, 0x50c, 0x509, 0x506, 0x502, 0x4ff, 0x4fb, 0x4f8,
  0x4f4, 0x4f1, 0x4ed, 0x4ea, 0x4e7, 0x4e3, 0x4e0, 0x4dc,
  0x4d9, 0x4d6, 0x4d2, 0x4cf, 0x4cc, 0x4c8, 0x4c5, 0x4c2,
  0x4be, 0x4bb, 0x4b8, 0x4b5, 0x4b1, 0x4ae, 0x4ab, 0x4a8,
  0x4a4, 0x4a1, 0x49e, 0x49b, 0x498, 0x494, 0x491, 0x48e,
  0x48b, 0x488, 0x485, 0x482, 0x47e, 0x47b, 0x478, 0x475,
  0x472, 0x46f, 0x46c, 0x469, 0x466, 0x463, 0x460, 0x45d,
  0x45a, 0x457, 0x454, 0x451, 0x44e, 0x44b, 0x448, 0x445,
  0x442, 0x43f, 0x43c, 0x439, 0x436, 0x433, 0x430, 0x42d,
  0x42a, 0x428, 0x425, 0x422, 0x41f, 0x41c, 0x419, 0x416,
  0x414, 0x411, 0x40e, 0x40b, 0x408, 0x406, 0x403, 0x400,
]);

/** Envelope generator: `eg_stephi[rate&3][timer&3]`. */
const eg_stephi = [
  [0, 0, 0, 0],
  [1, 0, 0, 0],
  [1, 0, 1, 0],
  [1, 1, 1, 0],
];

/** Phase generator detune table, indexed `(sum_l << 2) | note`. */
const pg_detune = new Uint32Array([16, 17, 19, 20, 22, 24, 27, 29]);

interface FreqEntry {
  basefreq: number;
  approxtype: number;
  slope: number;
}

/** Phase generator frequency table, indexed by the key code's high 6 bits. */
const pg_freqtable: FreqEntry[] = [
  { basefreq: 1299, approxtype: 1, slope: 19 },
  { basefreq: 1318, approxtype: 1, slope: 19 },
  { basefreq: 1337, approxtype: 1, slope: 19 },
  { basefreq: 1356, approxtype: 1, slope: 20 },
  { basefreq: 1376, approxtype: 1, slope: 20 },
  { basefreq: 1396, approxtype: 1, slope: 20 },
  { basefreq: 1416, approxtype: 1, slope: 21 },
  { basefreq: 1437, approxtype: 1, slope: 20 },
  { basefreq: 1458, approxtype: 1, slope: 21 },
  { basefreq: 1479, approxtype: 1, slope: 21 },
  { basefreq: 1501, approxtype: 1, slope: 22 },
  { basefreq: 1523, approxtype: 1, slope: 22 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 1545, approxtype: 1, slope: 22 },
  { basefreq: 1567, approxtype: 1, slope: 22 },
  { basefreq: 1590, approxtype: 1, slope: 23 },
  { basefreq: 1613, approxtype: 1, slope: 23 },
  { basefreq: 1637, approxtype: 1, slope: 23 },
  { basefreq: 1660, approxtype: 1, slope: 24 },
  { basefreq: 1685, approxtype: 1, slope: 24 },
  { basefreq: 1709, approxtype: 1, slope: 24 },
  { basefreq: 1734, approxtype: 1, slope: 25 },
  { basefreq: 1759, approxtype: 1, slope: 25 },
  { basefreq: 1785, approxtype: 1, slope: 26 },
  { basefreq: 1811, approxtype: 1, slope: 26 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 1837, approxtype: 1, slope: 26 },
  { basefreq: 1864, approxtype: 1, slope: 27 },
  { basefreq: 1891, approxtype: 1, slope: 27 },
  { basefreq: 1918, approxtype: 1, slope: 28 },
  { basefreq: 1946, approxtype: 1, slope: 28 },
  { basefreq: 1975, approxtype: 1, slope: 28 },
  { basefreq: 2003, approxtype: 1, slope: 29 },
  { basefreq: 2032, approxtype: 1, slope: 30 },
  { basefreq: 2062, approxtype: 1, slope: 30 },
  { basefreq: 2092, approxtype: 1, slope: 30 },
  { basefreq: 2122, approxtype: 1, slope: 31 },
  { basefreq: 2153, approxtype: 1, slope: 31 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 2185, approxtype: 1, slope: 31 },
  { basefreq: 2216, approxtype: 0, slope: 31 },
  { basefreq: 2249, approxtype: 0, slope: 31 },
  { basefreq: 2281, approxtype: 0, slope: 31 },
  { basefreq: 2315, approxtype: 0, slope: 31 },
  { basefreq: 2348, approxtype: 0, slope: 31 },
  { basefreq: 2382, approxtype: 0, slope: 30 },
  { basefreq: 2417, approxtype: 0, slope: 30 },
  { basefreq: 2452, approxtype: 0, slope: 30 },
  { basefreq: 2488, approxtype: 0, slope: 30 },
  { basefreq: 2524, approxtype: 0, slope: 30 },
  { basefreq: 2561, approxtype: 0, slope: 30 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
  { basefreq: 0, approxtype: 0, slope: 16 },
];

/**
 * FM algorithm routing, `fm_algorithm[phase][row][algorithm]`: rows 0-1 are
 * M1's two modulation inputs, row 2 is C1's, rows 3-4 are the last
 * operator's two (only algorithm 7 uses a second one), row 5 is the
 * output-to-mixer gate. `phase` is `(op_counter+2)&3` for rows 0-4 and
 * `op_counter` itself for row 5 - `operatorPhase14()`/`channelDryTap()`
 * read row 5 that second way, matching `OPM_OperatorPhase14`.
 */
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

const lfo_counter2_table = new Uint16Array([
  0x0000, 0x4000, 0x6000, 0x7000,
  0x7800, 0x7c00, 0x7e00, 0x7f00,
  0x7f80, 0x7fc0, 0x7fe0, 0x7ff0,
  0x7ff8, 0x7ffc, 0x7ffe, 0x7fff,
]);

/** `OPM_KCToFNum`. */
function kcToFNum(kcode: number): number {
  const kcode_h = (kcode >> 4) & 63;
  const kcode_l = kcode & 15;
  const entry = pg_freqtable[kcode_h];
  let sum = 0;
  if (entry.approxtype) {
    for (let i = 0; i < 4; i++) {
      if (kcode_l & (1 << i)) sum += entry.slope >> (3 - i);
    }
  } else {
    const slope = entry.slope | 1;
    if (kcode_l & 1) sum += (slope >> 3) + 2;
    if (kcode_l & 2) sum += 8;
    if (kcode_l & 4) sum += slope >> 1;
    if (kcode_l & 8) {
      sum += slope;
      sum++;
    }
    if ((kcode_l & 12) === 12 && (entry.slope & 1) === 0) sum += 4;
  }
  return entry.basefreq + (sum >> 1);
}

/** `OPM_LFOApplyPMS`. */
function lfoApplyPMS(lfo: number, pms: number): number {
  let top = (lfo >> 4) & 7;
  if (pms !== 7) top >>= 1;
  const t = ((top & 6) === 6 && pms === 7) || ((top & 3) === 3 && pms >= 6) ? 1 : 0;

  let out = top + ((top >> 2) & 1) + t;
  out = out * 2 + ((lfo >> 4) & 1);

  if (pms === 7) out >>= 1;
  out &= 15;
  out = (lfo & 15) + out * 16;
  switch (pms) {
    case 0:
    default:
      out = 0;
      break;
    case 1:
      out = (out >> 5) & 3;
      break;
    case 2:
      out = (out >> 4) & 7;
      break;
    case 3:
      out = (out >> 3) & 15;
      break;
    case 4:
      out = (out >> 2) & 31;
      break;
    case 5:
      out = (out >> 1) & 63;
      break;
    case 6:
      out = (out & 255) << 1;
      break;
    case 7:
      out = (out & 255) << 2;
      break;
  }
  return out;
}

/** `OPM_CalcKCode`. */
function calcKCode(kcf: number, lfo: number, lfo_sign: number, dt: number): number {
  let overflow1 = 0;
  let overflow2 = 0;
  let negoverflow = 0;
  if (!lfo_sign) lfo = ~lfo;
  let sum = (kcf & 8191) + (lfo & 8191) + (lfo_sign ? 0 : 1);
  const cr = ((kcf & 255) + (lfo & 255) + (lfo_sign ? 0 : 1)) >> 8;
  if (sum & (1 << 13)) overflow1 = 1;
  sum &= 8191;
  if (lfo_sign && (((sum >> 6) & 3) === 3 || cr)) sum += 64;
  if (!lfo_sign && !cr && (lfo & 192) !== 0) {
    sum += -64 & 8191;
    negoverflow = 1;
  }
  if (sum & (1 << 13)) overflow2 = 1;
  sum &= 8191;
  if ((!lfo_sign && !overflow1) || (negoverflow && !overflow2)) sum = 0;
  if (lfo_sign && (overflow1 || overflow2)) sum = 8127;

  let t2 = sum & 63;
  if (dt === 2) t2 += 20;
  if (dt === 2 || dt === 3) t2 += 32;

  const b0 = (t2 >> 6) & 1;
  const b1 = dt === 2 ? 1 : 0;
  const b2 = (sum >> 6) & 1;
  const b3 = (sum >> 7) & 1;

  const w2 = b0 && b1 && b2 ? 1 : 0;
  const w3 = b0 && b3 ? 1 : 0;
  const w6 = (b0 && !w2 && !w3) || (b3 && !b0 && b1) ? 1 : 0;

  t2 &= 63;

  let t3 = (sum >> 6) + w6 + b1 + (w2 || w3 ? 2 : 0) + (dt === 3 ? 4 : 0) + (dt !== 0 ? 8 : 0);
  if (t3 & 128) {
    t2 = 63;
    t3 = 126;
  }
  sum = t3 * 64 + t2;
  return sum;
}

const eg_num_attack = 0;
const eg_num_decay = 1;
const eg_num_sustain = 2;
const eg_num_release = 3;

/** The low `bit + 1` bits of `value`, as a signed number (Nuked-OPM's own `out <<= N; out >>= N;` truncate-then-sign-extend idiom, folded into one step). */
const signExtend = (bit: number, value: number) => (value & ((1 << bit) - 1)) - (value & (1 << bit));

export class Ym2151 {
  cycles = 0;
  ic = 0;
  ic2 = 0;

  // IO
  write_data = 0;
  write_a = 0;
  write_a_en = 0;
  write_d = 0;
  write_d_en = 0;
  write_busy = 0;
  write_busy_cnt = 0;
  mode_address = 0;
  io_ct1 = 0;
  io_ct2 = 0;

  // LFO
  lfo_am_lock = 0;
  lfo_pm_lock = 0;
  lfo_counter1 = 0;
  lfo_counter1_of1 = 0;
  lfo_counter1_of2 = 0;
  lfo_counter2 = 0;
  lfo_counter2_load = 0;
  lfo_counter2_of = 0;
  lfo_counter2_of_lock = 0;
  lfo_counter2_of_lock2 = 0;
  lfo_counter3_clock = 0;
  lfo_counter3 = 0;
  lfo_counter3_step = 0;
  lfo_frq_update = 0;
  lfo_clock = 0;
  lfo_clock_lock = 0;
  lfo_clock_test = 0;
  lfo_test = 0;
  lfo_val = 0;
  lfo_val_carry = 0;
  lfo_out1 = 0;
  lfo_out2 = 0;
  lfo_out2_b = 0;
  lfo_mult_carry = 0;
  lfo_trig_sign = 0;
  lfo_saw_sign = 0;
  lfo_bit_counter = 0;

  // Envelope generator
  readonly eg_state = new Uint8Array(32);
  readonly eg_level = new Uint16Array(32);
  readonly eg_rate = new Uint8Array(2);
  readonly eg_sl = new Uint8Array(2);
  readonly eg_tl = new Uint8Array(3);
  readonly eg_zr = new Uint8Array(2);
  eg_timershift_lock = 0;
  eg_timer_lock = 0;
  eg_inchi = 0;
  eg_shift = 0;
  eg_clock = 0;
  eg_clockcnt = 0;
  eg_inc = 0;
  readonly eg_ratemax = new Uint8Array(2);
  eg_instantattack = 0;
  eg_inclinear = 0;
  eg_incattack = 0;
  eg_mute = 0;
  readonly eg_outtemp = new Uint16Array(2);
  readonly eg_out = new Uint16Array(2);
  eg_am = 0;
  eg_timercarry = 0;
  eg_timer = 0;
  eg_timer2 = 0;
  eg_timerbstop = 0;
  eg_serial = 0;
  eg_serial_bit = 0;
  eg_test = 0;

  // Phase generator
  readonly pg_fnum = new Uint16Array(32);
  readonly pg_kcode = new Uint8Array(32);
  readonly pg_inc = new Uint32Array(32);
  readonly pg_phase = new Uint32Array(32);
  readonly pg_reset = new Uint8Array(32);
  readonly pg_reset_latch = new Uint8Array(32);
  pg_serial = 0;

  // Operator
  op_phase_in = 0;
  op_mod_in = 0;
  op_phase = 0;
  readonly op_logsin = new Uint16Array(3);
  op_atten = 0;
  readonly op_exp = new Uint16Array(2);
  readonly op_pow = new Uint8Array(2);
  op_sign = 0;
  readonly op_out = new Int16Array(6);
  op_connect = 0;
  op_counter = 0;
  op_fbupdate = 0;
  op_fbshift = 0;
  op_c1update = 0;
  readonly op_modtable = new Uint8Array(5);
  readonly op_m1 = [
    new Int16Array(2), new Int16Array(2), new Int16Array(2), new Int16Array(2),
    new Int16Array(2), new Int16Array(2), new Int16Array(2), new Int16Array(2),
  ];
  readonly op_c1 = new Int16Array(8);
  readonly op_mod = new Int16Array(3);
  readonly op_fb = new Int16Array(2);
  op_mixl = 0;
  op_mixr = 0;

  // Mixer
  readonly mix = new Int32Array(2);
  readonly mix2 = new Int32Array(2);
  readonly mix_serial = new Uint32Array(2);
  mix_bits = 0;
  mix_top_bits_lock = 0;
  mix_sign_lock = 0;
  mix_sign_lock2 = 0;
  mix_exp_lock = 0;
  readonly mix_clamp_low = new Uint8Array(2);
  readonly mix_clamp_high = new Uint8Array(2);
  mix_out_bit = 0;

  // Output
  smp_so = 0;
  smp_sh1 = 0;
  smp_sh2 = 0;

  // Noise
  noise_lfsr = 0;
  noise_timer = 0;
  noise_timer_of = 0;
  noise_update = 0;
  noise_bit = 0;

  // Register set
  readonly mode_test = new Uint8Array(8);
  readonly mode_kon_operator = new Uint8Array(4);
  mode_kon_channel = 0;

  reg_address = 0;
  reg_address_ready = 0;
  reg_data = 0;
  reg_data_ready = 0;

  readonly ch_rl = new Uint8Array(8);
  readonly ch_fb = new Uint8Array(8);
  readonly ch_connect = new Uint8Array(8);
  readonly ch_kc = new Uint8Array(8);
  readonly ch_kf = new Uint8Array(8);
  readonly ch_pms = new Uint8Array(8);
  readonly ch_ams = new Uint8Array(8);

  readonly sl_dt1 = new Uint8Array(32);
  readonly sl_mul = new Uint8Array(32);
  readonly sl_tl = new Uint8Array(32);
  readonly sl_ks = new Uint8Array(32);
  readonly sl_ar = new Uint8Array(32);
  readonly sl_am_e = new Uint8Array(32);
  readonly sl_d1r = new Uint8Array(32);
  readonly sl_dt2 = new Uint8Array(32);
  readonly sl_d2r = new Uint8Array(32);
  readonly sl_d1l = new Uint8Array(32);
  readonly sl_rr = new Uint8Array(32);

  noise_en = 0;
  noise_freq = 0;

  // Timer
  timer_a_reg = 0;
  timer_b_reg = 0;
  timer_a_temp = 0;
  timer_a_do_reset = 0;
  timer_a_do_load = 0;
  timer_a_inc = 0;
  timer_a_val = 0;
  timer_a_of = 0;
  timer_a_load = 0;
  timer_a_status = 0;

  timer_b_sub = 0;
  timer_b_sub_of = 0;
  timer_b_inc = 0;
  timer_b_val = 0;
  timer_b_of = 0;
  timer_b_do_reset = 0;
  timer_b_do_load = 0;
  timer_b_temp = 0;
  timer_b_status = 0;
  timer_irq = 0;

  lfo_freq_hi = 0;
  lfo_freq_lo = 0;
  lfo_pmd = 0;
  lfo_amd = 0;
  lfo_wave = 0;

  timer_irqa = 0;
  timer_irqb = 0;
  timer_loada = 0;
  timer_loadb = 0;
  timer_reseta = 0;
  timer_resetb = 0;
  mode_csm = 0;

  nc_active = 0;
  nc_active_lock = 0;
  nc_sign = 0;
  nc_sign_lock = 0;
  nc_sign_lock2 = 0;
  nc_out = 0;
  op_mix = 0;

  kon_csm = 0;
  kon_csm_lock = 0;
  kon_chanmatch = 0;
  readonly kon = new Uint8Array(32);
  readonly kon2 = new Uint8Array(32);
  readonly mode_kon = new Uint8Array(32);

  // DAC
  dac_osh1 = 0;
  dac_osh2 = 0;
  dac_bits = 0;
  readonly dac_output = new Int32Array(2);

  constructor() {
    this.reset();
  }

  /** `OPM_Reset`, always in YM2151 (non-OPP) mode. */
  reset() {
    for (const key of Object.keys(this) as (keyof this)[]) {
      const v = this[key];
      if (typeof v === "number") (this as unknown as Record<string, unknown>)[key as string] = 0;
      else if (ArrayBuffer.isView(v)) (v as unknown as Uint8Array).fill(0);
      else if (Array.isArray(v)) for (const a of v as Int16Array[]) a.fill(0);
    }
    this.setIC(1);
    for (let i = 0; i < 32 * 64; i++) this.clock();
    this.setIC(0);
  }

  /** `OPM_Write`: a byte to the address port (0) or the data port (1). */
  write(port: number, data: number) {
    this.write_data = data & 0xff;
    if (this.ic) return;
    if (port & 1) this.write_d = 1;
    else this.write_a = 1;
  }

  /** `OPM_Read`: the status byte (or, in test mode, the debug taps). */
  read(port: number): number {
    if ((port & 1) === 0) return 0xff;
    if (this.mode_test[6]) {
      const testdata = (this.op_out[5] & 0xffff) | ((this.eg_serial_bit ^ 1) << 14) | ((this.pg_serial & 1) << 15);
      return this.mode_test[7] ? testdata & 255 : (testdata >> 8) & 0xff;
    }
    return (this.write_busy << 7) | (this.timer_b_status << 1) | this.timer_a_status;
  }

  /** `OPM_ReadIRQ`. */
  readIRQ(): number {
    return this.timer_irq;
  }

  /** `OPM_ReadCT1`. */
  readCT1(): number {
    if (this.mode_test[3]) return this.lfo_clock_test;
    return this.io_ct1;
  }

  /** `OPM_ReadCT2`. */
  readCT2(): number {
    return this.io_ct2;
  }

  /** `OPM_SetIC`. */
  setIC(ic: number) {
    ic = ic ? 1 : 0;
    if (this.ic !== ic) {
      this.ic = ic;
      if (!ic) this.cycles = 0;
    }
  }

  /** `OPM_Clock`: one internal cycle, in the reference's own dispatch order. */
  clock() {
    this.output();
    this.dac();
    this.mixer2();
    this.mixer();

    this.operatorPhase16();
    this.operatorPhase15();
    this.operatorPhase14();
    this.operatorPhase13();
    this.operatorPhase12();
    this.operatorPhase11();
    this.operatorPhase10();
    this.operatorPhase9();
    this.operatorPhase8();
    this.operatorPhase7();
    this.operatorPhase6();
    this.operatorPhase5();
    this.operatorPhase4();
    this.operatorPhase3();
    this.operatorPhase2();
    this.operatorPhase1();
    this.operatorCounter();

    this.envelopeTimer();
    this.envelopePhase6();
    this.envelopePhase5();
    this.envelopePhase4();
    this.envelopePhase3();
    this.envelopePhase2();
    this.envelopePhase1();

    this.phaseDebug();
    this.phaseGenerate();
    this.phaseCalcIncrement();
    this.phaseCalcFNumBlock();

    this.doTimerIRQ();
    this.doTimerA();
    this.doTimerB();
    this.doLFOMult();
    this.doLFO1();
    this.noise();
    this.keyOn2();
    this.doRegWrite();
    this.envelopeClock();
    this.noiseTimer();
    this.keyOn1();
    this.doIO();
    this.doTimerA2();
    this.doTimerB2();
    this.doLFO2();
    this.csm();
    this.noiseChannel();
    this.doIC();

    this.cycles = (this.cycles + 1) & 31;
  }

  /** `OPM_PhaseCalcFNumBlock`. */
  private phaseCalcFNumBlock() {
    const slot = (this.cycles + 7) & 31;
    const channel = slot & 7;
    const kcf = (this.ch_kc[channel] << 6) + this.ch_kf[channel];
    const lfo = this.lfo_pmd ? this.lfo_pm_lock : 0;
    const pms = this.ch_pms[channel];
    const dt = this.sl_dt2[slot];
    const lfo_pm = lfoApplyPMS(lfo & 127, pms);
    const kcode = calcKCode(kcf, lfo_pm, (lfo & 0x80) !== 0 && pms !== 0 ? 0 : 1, dt);
    const fnum = kcToFNum(kcode);
    const kcode_h = kcode >> 8;
    this.pg_fnum[slot] = fnum;
    this.pg_kcode[slot] = kcode_h;
  }

  /** `OPM_PhaseCalcIncrement`. */
  private phaseCalcIncrement() {
    const slot = this.cycles;
    const dt = this.sl_dt1[slot];
    const dt_l = dt & 3;
    let detune = 0;
    const multi = this.sl_mul[slot];
    let kcode = this.pg_kcode[slot];
    const fnum = this.pg_fnum[slot];
    let block = kcode >> 2;
    let basefreq = (fnum << block) >> 2;
    if (dt_l) {
      if (kcode > 0x1c) kcode = 0x1c;
      block = kcode >> 2;
      const note = kcode & 0x03;
      const sum = block + 9 + ((dt_l === 3 ? 1 : 0) | (dt_l & 0x02));
      const sum_h = sum >> 1;
      const sum_l = sum & 0x01;
      detune = pg_detune[(sum_l << 2) | note] >> (9 - sum_h);
    }
    if (dt & 0x04) basefreq -= detune;
    else basefreq += detune;
    basefreq &= 0x1ffff;
    let inc;
    if (multi) inc = basefreq * multi;
    else inc = basefreq >> 1;
    inc &= 0xfffff;
    this.pg_inc[slot] = inc;
  }

  /** `OPM_PhaseGenerate`. */
  private phaseGenerate() {
    let slot = (this.cycles + 27) & 31;
    this.pg_reset_latch[slot] = this.pg_reset[slot];
    slot = (this.cycles + 25) & 31;
    if (this.pg_reset_latch[slot]) this.pg_inc[slot] = 0;
    slot = (this.cycles + 24) & 31;
    if (this.pg_reset_latch[slot] || this.mode_test[3]) this.pg_phase[slot] = 0;
    this.pg_phase[slot] = (this.pg_phase[slot] + this.pg_inc[slot]) & 0xfffff;
  }

  /** `OPM_PhaseDebug`. */
  private phaseDebug() {
    this.pg_serial >>= 1;
    if (this.cycles === 5) this.pg_serial |= this.pg_phase[29] & 0x3ff;
  }

  /** `OPM_KeyOn1`. */
  private keyOn1() {
    const cycles = (this.cycles + 1) & 31;
    this.kon_chanmatch = 0;
    if (this.mode_kon_channel + 24 === cycles) this.kon_chanmatch = 1;
  }

  /** `OPM_KeyOn2`. */
  private keyOn2() {
    const slot = (this.cycles + 8) & 31;
    if (this.kon_chanmatch) {
      this.mode_kon[(slot + 0) & 31] = this.mode_kon_operator[0];
      this.mode_kon[(slot + 8) & 31] = this.mode_kon_operator[2];
      this.mode_kon[(slot + 16) & 31] = this.mode_kon_operator[1];
      this.mode_kon[(slot + 24) & 31] = this.mode_kon_operator[3];
    }
  }

  /** `OPM_EnvelopePhase1`. */
  private envelopePhase1() {
    const slot = (this.cycles + 2) & 31;
    const kon = this.mode_kon[slot] | this.kon_csm;
    this.kon2[slot] = this.kon[slot];
    this.kon[slot] = kon;
  }

  /** `OPM_EnvelopePhase2`. */
  private envelopePhase2() {
    const slot = this.cycles;
    const chan = slot & 7;
    let rate = 0;
    let sel = this.eg_state[slot];
    if (this.kon[slot] && !this.kon2[slot]) sel = eg_num_attack;
    switch (sel) {
      case eg_num_attack:
        rate = this.sl_ar[slot];
        break;
      case eg_num_decay:
        rate = this.sl_d1r[slot];
        break;
      case eg_num_sustain:
        rate = this.sl_d2r[slot];
        break;
      case eg_num_release:
        rate = this.sl_rr[slot] * 2 + 1;
        break;
      default:
        break;
    }
    if (this.ic) rate = 31;

    const zr = rate === 0 ? 1 : 0;

    let ksv = this.pg_kcode[slot] >> (this.sl_ks[slot] ^ 3);
    if (this.sl_ks[slot] === 0 && zr) ksv &= ~3;
    rate = rate * 2 + ksv;
    if (rate & 64) rate = 63;

    this.eg_tl[2] = this.eg_tl[1];
    this.eg_tl[1] = this.eg_tl[0];
    this.eg_tl[0] = this.sl_tl[slot];

    this.eg_sl[1] = this.eg_sl[0];
    this.eg_sl[0] = this.sl_d1l[slot];
    if (this.eg_sl[0] === 15) this.eg_sl[0] = 31;
    this.eg_zr[1] = this.eg_zr[0];
    this.eg_zr[0] = zr;
    this.eg_rate[1] = this.eg_rate[0];
    this.eg_rate[0] = rate;
    this.eg_ratemax[1] = this.eg_ratemax[0];
    this.eg_ratemax[0] = (rate >> 1) === 31 ? 1 : 0;
    const ams = this.sl_am_e[slot] ? this.ch_ams[chan] : 0;
    switch (ams) {
      default:
      case 0:
        this.eg_am = 0;
        break;
      case 1:
        this.eg_am = this.lfo_am_lock << 0;
        break;
      case 2:
        this.eg_am = this.lfo_am_lock << 1;
        break;
      case 3:
        this.eg_am = this.lfo_am_lock << 2;
        break;
    }
  }

  /** `OPM_EnvelopePhase3`. */
  private envelopePhase3() {
    const slot = (this.cycles + 31) & 31;
    this.eg_shift = (this.eg_timershift_lock + (this.eg_rate[0] >> 2)) & 15;
    this.eg_inchi = eg_stephi[this.eg_rate[0] & 3][this.eg_timer_lock & 3];

    this.eg_outtemp[1] = this.eg_outtemp[0];
    this.eg_outtemp[0] = this.eg_level[slot] + this.eg_am;
    if (this.eg_outtemp[0] & 1024) this.eg_outtemp[0] = 1023;
  }

  /** `OPM_EnvelopePhase4`. */
  private envelopePhase4() {
    const slot = (this.cycles + 30) & 31;
    let inc = 0;
    if (this.eg_clock & 2) {
      if (this.eg_rate[1] >= 48) {
        inc = this.eg_inchi + (this.eg_rate[1] >> 2) - 11;
        if (inc > 4) inc = 4;
      } else if (!this.eg_zr[1]) {
        switch (this.eg_shift) {
          case 12:
            inc = this.eg_rate[1] !== 0 ? 1 : 0;
            break;
          case 13:
            inc = (this.eg_rate[1] >> 1) & 1;
            break;
          case 14:
            inc = this.eg_rate[1] & 1;
            break;
        }
      }
    }
    this.eg_inc = inc;

    const kon = this.kon[slot] && !this.kon2[slot] ? 1 : 0;
    this.pg_reset[slot] = kon;
    this.eg_instantattack = this.eg_ratemax[1] && (kon || !this.eg_ratemax[1]) ? 1 : 0;

    const eg_off = (this.eg_level[slot] & 0x3f0) === 0x3f0 ? 1 : 0;
    const slreach = (this.eg_level[slot] >> 4) === this.eg_sl[1] << 1 ? 1 : 0;
    const eg_zero = this.eg_level[slot] === 0 ? 1 : 0;

    this.eg_mute = eg_off && this.eg_state[slot] !== eg_num_attack && !kon ? 1 : 0;
    this.eg_inclinear = 0;
    if (!kon && !eg_off) {
      switch (this.eg_state[slot]) {
        case eg_num_decay:
          if (!slreach) this.eg_inclinear = 1;
          break;
        case eg_num_sustain:
        case eg_num_release:
          this.eg_inclinear = 1;
          break;
      }
    }
    this.eg_incattack = this.eg_state[slot] === eg_num_attack && !this.eg_ratemax[1] && this.kon[slot] && !eg_zero ? 1 : 0;

    if (kon) {
      this.eg_state[slot] = eg_num_attack;
    } else if (!this.kon[slot]) {
      this.eg_state[slot] = eg_num_release;
    } else {
      switch (this.eg_state[slot]) {
        case eg_num_attack:
          if (eg_zero) this.eg_state[slot] = eg_num_decay;
          break;
        case eg_num_decay:
          if (eg_off) this.eg_state[slot] = eg_num_release;
          else if (slreach) this.eg_state[slot] = eg_num_sustain;
          break;
        case eg_num_sustain:
          if (eg_off) this.eg_state[slot] = eg_num_release;
          break;
        case eg_num_release:
          break;
      }
    }

    if (this.ic) this.eg_state[slot] = eg_num_release;
  }

  /** `OPM_EnvelopePhase5`. */
  private envelopePhase5() {
    const slot = (this.cycles + 29) & 31;
    let level = this.eg_level[slot];
    let step = 0;
    if (this.eg_instantattack) level = 0;
    if (this.eg_mute || this.ic) level = 0x3ff;
    if (this.eg_inc) {
      if (this.eg_inclinear) step |= 1 << (this.eg_inc - 1);
      if (this.eg_incattack) step |= (~this.eg_level[slot] << this.eg_inc) >> 5;
    }
    level += step;
    this.eg_level[slot] = level;

    this.eg_out[0] = this.eg_outtemp[1];
    this.eg_out[0] += this.eg_tl[2] << 3;
    if (this.eg_out[0] & 1024) this.eg_out[0] = 1023;

    if (this.eg_test) this.eg_out[0] = 0;

    this.eg_test = this.mode_test[5];
  }

  /**
   * `OPM_EnvelopePhase6`. `eg_serial_bit` reads the bit BEFORE this tick's
   * load/shift, not after: the reference takes it from the value `eg_serial`
   * already held coming into this tick, then updates `eg_serial` for the
   * next one to read. Doing the load/shift first, as an earlier port of this
   * function did, hands `noiseChannel` - the only real consumer, several
   * calls later in the same `clock()` - a bit one tick early, corrupting the
   * noise channel's mix whenever it is active.
   */
  private envelopePhase6() {
    this.eg_serial_bit = (this.eg_serial >> 9) & 1;
    if (this.cycles === 3) {
      this.eg_serial = this.eg_out[0] ^ 1023;
    } else {
      this.eg_serial <<= 1;
    }

    this.eg_out[1] = this.eg_out[0];
  }

  /** `OPM_EnvelopeClock`. */
  private envelopeClock() {
    this.eg_clock <<= 1;
    if ((this.eg_clockcnt & 2) !== 0 || this.mode_test[0]) this.eg_clock |= 1;
    if (this.ic || (this.cycles === 31 && (this.eg_clockcnt & 2) !== 0)) {
      this.eg_clockcnt = 0;
    } else if (this.cycles === 31) {
      this.eg_clockcnt++;
    }
  }

  /** `OPM_EnvelopeTimer`. */
  private envelopeTimer() {
    const cycle = (this.cycles + 31) & 15;
    const inc = ((this.cycles + 31) & 31) < 16 && (this.eg_clock & 1) !== 0 && (cycle === 0 || this.eg_timercarry) ? 1 : 0;
    const timerbit = (this.eg_timer >> cycle) & 1;
    const sum = timerbit + inc;
    const sum0 = sum & 1 && !this.ic ? 1 : 0;
    this.eg_timercarry = sum >> 1;
    this.eg_timer = (this.eg_timer & ~(1 << cycle)) | (sum0 << cycle);

    const cycle2 = (this.cycles + 30) & 15;

    this.eg_timer2 <<= 1;
    if ((this.eg_timer & (1 << cycle2)) !== 0 && !this.eg_timerbstop) this.eg_timer2 |= 1;

    if (this.eg_timer & (1 << cycle2)) this.eg_timerbstop = 1;

    if (cycle === 0 || this.ic2) this.eg_timerbstop = 0;

    if (this.cycles === 1 && (this.eg_clock & 1) !== 0) {
      this.eg_timershift_lock = 0;
      if (this.eg_timer2 & (8 + 32 + 128 + 512 + 2048 + 8192 + 32768)) this.eg_timershift_lock |= 1;
      if (this.eg_timer2 & (4 + 32 + 64 + 512 + 1024 + 8192 + 16384)) this.eg_timershift_lock |= 2;
      if (this.eg_timer2 & (4 + 8 + 16 + 512 + 1024 + 2048 + 4096)) this.eg_timershift_lock |= 4;
      if (this.eg_timer2 & (4 + 8 + 16 + 32 + 64 + 128 + 256)) this.eg_timershift_lock |= 8;
      this.eg_timer_lock = this.eg_timer;
    }
  }

  /** `OPM_OperatorPhase1`. */
  private operatorPhase1() {
    const slot = this.cycles;
    let mod = this.op_mod[2];
    this.op_phase_in = this.pg_phase[slot] >> 10;
    if (this.op_fbshift & 8) {
      if (this.op_fb[1] === 0) mod = 0;
      else mod = mod >> (9 - this.op_fb[1]);
    }
    this.op_mod_in = mod & 0xffff;
  }

  /** `OPM_OperatorPhase2`. */
  private operatorPhase2() {
    this.op_phase = (this.op_phase_in + this.op_mod_in) & 1023;
  }

  /** `OPM_OperatorPhase3`. */
  private operatorPhase3() {
    let phase = this.op_phase & 255;
    if (this.op_phase & 256) phase ^= 255;
    this.op_logsin[0] = logsinrom[phase];
    this.op_sign <<= 1;
    this.op_sign |= (this.op_phase >> 9) & 1;
  }

  /** `OPM_OperatorPhase4`. */
  private operatorPhase4() {
    this.op_logsin[1] = this.op_logsin[0];
  }

  /** `OPM_OperatorPhase5`. */
  private operatorPhase5() {
    this.op_logsin[2] = this.op_logsin[1];
  }

  /** `OPM_OperatorPhase6`. */
  private operatorPhase6() {
    this.op_atten = this.op_logsin[2] + (this.eg_out[1] << 2);
    if (this.op_atten & 4096) this.op_atten = 4095;
  }

  /** `OPM_OperatorPhase7`. */
  private operatorPhase7() {
    this.op_exp[0] = exprom[this.op_atten & 255];
    this.op_pow[0] = this.op_atten >> 8;
  }

  /** `OPM_OperatorPhase8`. */
  private operatorPhase8() {
    this.op_exp[1] = this.op_exp[0];
    this.op_pow[1] = this.op_pow[0];
  }

  /** `OPM_OperatorPhase9`. */
  private operatorPhase9() {
    let out = (this.op_exp[1] << 2) >> this.op_pow[1];
    if (this.mode_test[4]) out |= 0x2000;
    this.op_out[0] = out;
  }

  /** `OPM_OperatorPhase10`. */
  private operatorPhase10() {
    let out = this.op_out[0];
    if (this.op_sign & 64) {
      out ^= 0x3fff;
      out = (out + 1) & 0x3fff;
    }
    this.op_out[1] = signExtend(13, out);
  }

  /** `OPM_OperatorPhase11`. */
  private operatorPhase11() {
    this.op_out[2] = this.op_out[1];
  }

  /** `OPM_OperatorPhase12`. */
  private operatorPhase12() {
    this.op_out[3] = this.op_out[2];
  }

  /** `OPM_OperatorPhase13`. */
  private operatorPhase13() {
    const slot = (this.cycles + 20) & 31;
    const channel = slot & 7;
    this.op_out[4] = this.op_out[3];
    this.op_connect = this.ch_connect[channel];
  }

  /** `OPM_OperatorPhase14`. */
  private operatorPhase14() {
    const slot = (this.cycles + 19) & 31;
    const channel = slot & 7;
    this.op_mix = this.op_out[5] = this.op_out[4];
    this.op_fbupdate = this.op_counter === 0 ? 1 : 0;
    this.op_c1update = this.op_counter === 2 ? 1 : 0;
    this.op_fbshift <<= 1;
    this.op_fbshift |= this.op_counter === 2 ? 1 : 0;

    const phase = (this.op_counter + 2) & 3;
    this.op_modtable[0] = fm_algorithm[phase][0][this.op_connect];
    this.op_modtable[1] = fm_algorithm[phase][1][this.op_connect];
    this.op_modtable[2] = fm_algorithm[phase][2][this.op_connect];
    this.op_modtable[3] = fm_algorithm[phase][3][this.op_connect];
    this.op_modtable[4] = fm_algorithm[phase][4][this.op_connect];
    const rl = this.ch_rl[channel];
    this.op_mixl = fm_algorithm[this.op_counter][5][this.op_connect] && (rl & 1) !== 0 ? 1 : 0;
    this.op_mixr = fm_algorithm[this.op_counter][5][this.op_connect] && (rl & 2) !== 0 ? 1 : 0;
  }

  /** `OPM_OperatorPhase15`. */
  private operatorPhase15() {
    const slot = (this.cycles + 18) & 31;
    const ch = slot & 7;
    let mod1 = 0;
    let mod2 = 0;
    if (this.op_modtable[0]) mod2 |= this.op_m1[ch][0];
    if (this.op_modtable[1]) mod1 |= this.op_m1[ch][1];
    if (this.op_modtable[2]) mod1 |= this.op_c1[ch];
    if (this.op_modtable[3]) mod2 |= this.op_out[5];
    if (this.op_modtable[4]) mod1 |= this.op_out[5];
    const mod = (mod1 + mod2) >> 1;
    this.op_mod[0] = mod;
    if (this.op_fbupdate) {
      this.op_m1[ch][1] = this.op_m1[ch][0];
      this.op_m1[ch][0] = this.op_out[5];
    }
    if (this.op_c1update) this.op_c1[ch] = this.op_out[5];
  }

  /** `OPM_OperatorPhase16`. */
  private operatorPhase16() {
    const slot = (this.cycles + 17) & 31;
    this.op_mod[2] = this.op_mod[1];
    this.op_fb[1] = this.op_fb[0];

    this.op_mod[1] = this.op_mod[0];
    this.op_fb[0] = this.ch_fb[slot & 7];
  }

  /** `OPM_OperatorCounter`. */
  private operatorCounter() {
    if ((this.cycles & 7) === 4) this.op_counter++;
    if (this.cycles === 12) this.op_counter = 0;
  }

  /** `OPM_Mixer2`. */
  private mixer2() {
    const cycles = (this.cycles + 30) & 31;
    let bit;
    if (cycles < 16) bit = this.mix_serial[0] & 1;
    else bit = this.mix_serial[1] & 1;
    if ((this.cycles & 15) === 1) {
      this.mix_sign_lock = bit ^ 1;
      this.mix_top_bits_lock = (this.mix_bits >> 15) & 63;
    }
    if ((this.cycles & 15) === 7) {
      let top = this.mix_top_bits_lock;
      if (this.mix_sign_lock) top ^= 63;
      let ex;
      if (top & 32) ex = 7;
      else if (top & 16) ex = 6;
      else if (top & 8) ex = 5;
      else if (top & 4) ex = 4;
      else if (top & 2) ex = 3;
      else if (top & 1) ex = 2;
      else ex = 1;
      this.mix_sign_lock2 = this.mix_sign_lock;
      this.mix_exp_lock = ex;
    }
    this.mix_out_bit <<= 1;
    switch (this.cycles & 15) {
      case 0:
        this.mix_out_bit |= this.mix_sign_lock2 ^ 1;
        break;
      case 1:
        this.mix_out_bit |= (this.mix_exp_lock >> 0) & 1;
        break;
      case 2:
        this.mix_out_bit |= (this.mix_exp_lock >> 1) & 1;
        break;
      case 3:
        this.mix_out_bit |= (this.mix_exp_lock >> 2) & 1;
        break;
      default:
        if (this.mix_exp_lock) this.mix_out_bit |= (this.mix_bits >> (this.mix_exp_lock - 1)) & 1;
        break;
    }
    this.mix_bits >>= 1;
    this.mix_bits |= bit << 20;
  }

  /** `OPM_Output`. */
  private output() {
    const slot = (this.cycles + 27) & 31;
    this.smp_so = (this.mix_out_bit & 1) !== 0 ? 1 : 0;
    this.smp_sh1 = (slot & 24) === 8 && !this.ic ? 1 : 0;
    this.smp_sh2 = (slot & 24) === 24 && !this.ic ? 1 : 0;
  }

  /** `OPM_DAC`. */
  private dac() {
    if (this.dac_osh1 && !this.smp_sh1) {
      const exp = (this.dac_bits >> 10) & 7;
      const mant = ((this.dac_bits >> 0) & 1023) - 512;
      this.dac_output[1] = (mant << exp) >> 1;
    }
    if (this.dac_osh2 && !this.smp_sh2) {
      const exp = (this.dac_bits >> 10) & 7;
      const mant = ((this.dac_bits >> 0) & 1023) - 512;
      this.dac_output[0] = (mant << exp) >> 1;
    }
    this.dac_bits >>= 1;
    this.dac_bits |= this.smp_so << 12;
    this.dac_osh1 = this.smp_sh1;
    this.dac_osh2 = this.smp_sh2;
  }

  /** `OPM_Mixer`. */
  private mixer() {
    // Right channel
    this.mix_serial[1] >>>= 1;
    if (this.cycles === 13) this.mix_serial[1] |= (this.mix[1] & 1023) << 4;
    if (this.cycles === 14) {
      this.mix_serial[1] |= ((this.mix2[1] >> 10) & 31) << 13;
      this.mix_serial[1] |= (((this.mix2[1] >> 17) & 1) ^ 1) << 18;
      this.mix_clamp_low[1] = 0;
      this.mix_clamp_high[1] = 0;
      switch ((this.mix2[1] >> 15) & 7) {
        case 0:
        default:
          break;
        case 1:
        case 2:
        case 3:
          this.mix_clamp_high[1] = 1;
          break;
        case 4:
        case 5:
        case 6:
          this.mix_clamp_low[1] = 1;
          break;
        case 7:
          break;
      }
    }
    if (this.mix_clamp_low[1]) this.mix_serial[1] &= ~2;
    if (this.mix_clamp_high[1]) this.mix_serial[1] |= 2;

    // Left channel
    this.mix_serial[0] >>>= 1;
    if (this.cycles === 29) this.mix_serial[0] |= (this.mix[0] & 1023) << 4;
    if (this.cycles === 30) {
      this.mix_serial[0] |= ((this.mix2[0] >> 10) & 31) << 13;
      this.mix_serial[0] |= (((this.mix2[0] >> 17) & 1) ^ 1) << 18;
      this.mix_clamp_low[0] = 0;
      this.mix_clamp_high[0] = 0;
      switch ((this.mix2[0] >> 15) & 7) {
        case 0:
        default:
          break;
        case 1:
        case 2:
        case 3:
          this.mix_clamp_high[0] = 1;
          break;
        case 4:
        case 5:
        case 6:
          this.mix_clamp_low[0] = 1;
          break;
        case 7:
          break;
      }
    }
    if (this.mix_clamp_low[0]) this.mix_serial[0] &= ~2;
    if (this.mix_clamp_high[0]) this.mix_serial[0] |= 2;

    this.mix2[0] = this.mix[0];
    this.mix2[1] = this.mix[1];
    if (this.cycles === 13) this.mix[1] = 0;
    if (this.cycles === 29) this.mix[0] = 0;
    this.mix[0] += this.op_mix * this.op_mixl;
    this.mix[1] += this.op_mix * this.op_mixr;
  }

  /** `OPM_Noise`. */
  private noise() {
    const noise_step = this.ic || this.noise_update;
    let bit = 0;
    if (noise_step) {
      if (!this.ic) {
        const rst = (this.noise_lfsr & 0xffff) === 0 && this.noise_bit === 0 ? 1 : 0;
        const xr = ((this.noise_lfsr >> 2) & 1) ^ this.noise_bit;
        bit = rst | xr;
      }
      this.noise_bit = this.noise_lfsr & 1;
    } else {
      bit = this.noise_lfsr & 1;
    }
    this.noise_lfsr >>>= 1;
    this.noise_lfsr |= bit << 15;
  }

  /** `OPM_NoiseTimer`. */
  private noiseTimer() {
    let timer = this.noise_timer;
    this.noise_update = this.noise_timer_of;
    if ((this.cycles & 15) === 15) {
      timer++;
      timer &= 31;
    }
    if (this.ic || (this.noise_timer_of && (this.cycles & 15) === 15)) timer = 0;

    this.noise_timer_of = this.noise_timer === (this.noise_freq ^ 31) ? 1 : 0;
    this.noise_timer = timer;
  }

  /** `OPM_DoTimerA`. */
  private doTimerA() {
    let value = this.timer_a_val;
    value += this.timer_a_inc;
    this.timer_a_of = (value >> 10) & 1;
    if (this.timer_a_do_reset) value = 0;
    if (this.timer_a_do_load) value = this.timer_a_reg;
    this.timer_a_val = value & 1023;
  }

  /** `OPM_DoTimerA2`. */
  private doTimerA2() {
    if (this.cycles === 1) this.timer_a_load = this.timer_loada;
    this.timer_a_inc = this.mode_test[2] || (this.timer_a_load && this.cycles === 0) ? 1 : 0;
    this.timer_a_do_load = this.timer_a_of || (this.timer_a_load && this.timer_a_temp) ? 1 : 0;
    this.timer_a_do_reset = this.timer_a_temp;
    this.timer_a_temp = this.timer_a_load ? 0 : 1;
    if (this.timer_reseta || this.ic) {
      this.timer_a_status = 0;
    } else {
      this.timer_a_status |= this.timer_irqa && this.timer_a_of ? 1 : 0;
    }
    this.timer_reseta = 0;
  }

  /** `OPM_DoTimerB`, YM2151 (non-OPP) branch. */
  private doTimerB() {
    let value = this.timer_b_val;
    value += this.timer_b_inc;
    this.timer_b_of = (value >> 8) & 1;
    if (this.timer_b_do_reset) value = 0;
    if (this.timer_b_do_load) value = this.timer_b_reg;
    this.timer_b_val = value & 255;

    if (this.cycles === 0) this.timer_b_sub++;

    this.timer_b_sub_of = (this.timer_b_sub >> 4) & 1;
    this.timer_b_sub &= 15;

    if (this.ic) this.timer_b_sub = 0;
  }

  /** `OPM_DoTimerB2`. */
  private doTimerB2() {
    this.timer_b_inc = this.mode_test[2] || (this.timer_loadb && this.timer_b_sub_of) ? 1 : 0;
    this.timer_b_do_load = this.timer_b_of || (this.timer_loadb && this.timer_b_temp) ? 1 : 0;
    this.timer_b_do_reset = this.timer_b_temp;
    this.timer_b_temp = this.timer_loadb ? 0 : 1;
    if (this.timer_resetb || this.ic) {
      this.timer_b_status = 0;
    } else {
      this.timer_b_status |= this.timer_irqb && this.timer_b_of ? 1 : 0;
    }
    this.timer_resetb = 0;
  }

  /** `OPM_DoTimerIRQ`. */
  private doTimerIRQ() {
    this.timer_irq = this.timer_a_status || this.timer_b_status ? 1 : 0;
  }

  /** `OPM_DoLFOMult`. */
  private doLFOMult() {
    const ampm_sel = (this.lfo_bit_counter & 8) !== 0;
    const dp = ampm_sel ? this.lfo_pmd : this.lfo_amd;
    let bit = 0;

    this.lfo_out2_b = this.lfo_out2;

    switch (this.lfo_bit_counter & 7) {
      case 0:
        bit = (dp & 64) !== 0 && (this.lfo_out1 & 64) !== 0 ? 1 : 0;
        break;
      case 1:
        bit = (dp & 32) !== 0 && (this.lfo_out1 & 32) !== 0 ? 1 : 0;
        break;
      case 2:
        bit = (dp & 16) !== 0 && (this.lfo_out1 & 16) !== 0 ? 1 : 0;
        break;
      case 3:
        bit = (dp & 8) !== 0 && (this.lfo_out1 & 8) !== 0 ? 1 : 0;
        break;
      case 4:
        bit = (dp & 4) !== 0 && (this.lfo_out1 & 4) !== 0 ? 1 : 0;
        break;
      case 5:
        bit = (dp & 2) !== 0 && (this.lfo_out1 & 2) !== 0 ? 1 : 0;
        break;
      case 6:
        bit = (dp & 1) !== 0 && (this.lfo_out1 & 1) !== 0 ? 1 : 0;
        break;
    }

    let b1 = (this.lfo_out2 & 1) !== 0 ? 1 : 0;
    if ((this.lfo_bit_counter & 7) === 0) b1 = 0;
    let b2 = this.lfo_mult_carry;
    if ((this.cycles & 15) === 15) b2 = 0;
    const sum = bit + b1 + b2;
    this.lfo_out2 >>>= 1;
    this.lfo_out2 |= (sum & 1) << 15;
    this.lfo_mult_carry = sum >> 1;
  }

  /** `OPM_DoLFO1`. */
  private doLFO1() {
    let counter2 = this.lfo_counter2;
    const of_old = this.lfo_counter2_of;
    const ampm_sel = (this.lfo_bit_counter & 8) !== 0;
    counter2 += (this.lfo_counter1_of1 & 2) !== 0 || this.mode_test[3] ? 1 : 0;
    this.lfo_counter2_of = (counter2 >> 15) & 1;
    if (this.ic) counter2 = 0;
    if (this.lfo_counter2_load) counter2 = lfo_counter2_table[this.lfo_freq_hi];
    this.lfo_counter2 = counter2 & 32767;
    this.lfo_counter2_load = this.lfo_frq_update || of_old ? 1 : 0;
    this.lfo_frq_update = 0;
    if ((this.cycles & 15) === 12) this.lfo_counter1++;
    this.lfo_counter1_of1 <<= 1;
    this.lfo_counter1_of1 |= (this.lfo_counter1 >> 4) & 1;
    this.lfo_counter1 &= 15;
    if (this.ic) this.lfo_counter1 = 0;

    if ((this.cycles & 15) === 5) this.lfo_counter2_of_lock2 = this.lfo_counter2_of_lock;

    this.lfo_counter3 += this.lfo_counter3_clock;
    if (this.ic) this.lfo_counter3 = 0;

    this.lfo_counter3_clock = (this.cycles & 15) === 13 && this.lfo_counter2_of_lock2 ? 1 : 0;

    if ((this.cycles & 15) === 15 && (this.lfo_bit_counter & 7) === 0) {
      this.lfo_trig_sign = (this.lfo_val & 0x80) !== 0 ? 1 : 0;
      this.lfo_saw_sign = (this.lfo_val & 0x100) !== 0 ? 1 : 0;
    }

    const lfo_pm_sign = this.lfo_wave === 2 ? this.lfo_trig_sign : this.lfo_saw_sign;

    const x = this.lfo_clock && this.lfo_wave !== 3 && (this.cycles & 15) === 15 ? 1 : 0;
    const w2 = this.lfo_wave === 2 && x ? 1 : 0;
    const w3 = !this.ic && !this.mode_test[1] && (!this.lfo_clock_lock || this.lfo_wave !== 3) && (this.lfo_val & 0x8000) !== 0 ? 1 : 0;

    const mulm = ((this.cycles + 1) & 15) < 8 ? 1 : 0;

    let bb = ampm_sel ? this.lfo_saw_sign : this.lfo_wave !== 2 || !this.lfo_trig_sign ? 1 : 0;
    bb ^= w3;

    const sb = ampm_sel ? ((this.cycles & 15) === 6 ? 1 : 0) : !this.lfo_saw_sign ? 1 : 0;

    const mb = mulm && (this.lfo_wave === 1 ? sb : bb) ? 1 : 0;

    this.lfo_out1 <<= 1;
    this.lfo_out1 |= mb;

    const carry = x || ((this.cycles & 15) !== 15 && this.lfo_val_carry !== 0 && this.lfo_wave !== 3) ? 1 : 0;
    const sum = carry + w2 + w3;
    let lfo_bit = sum & 1;
    if (this.lfo_wave === 3 && this.lfo_clock_lock) {
      const noise = this.noise_lfsr & 1;
      lfo_bit |= noise;
    }
    this.lfo_val_carry = sum >> 1;
    this.lfo_val <<= 1;
    this.lfo_val |= lfo_bit;

    if ((this.cycles & 15) === 15 && (this.lfo_bit_counter & 7) === 7) {
      if (ampm_sel) {
        this.lfo_pm_lock = (this.lfo_out2_b >> 8) & 255;
        this.lfo_pm_lock ^= lfo_pm_sign << 7;
      } else {
        this.lfo_am_lock = (this.lfo_out2_b >> 8) & 255;
      }
    }

    if ((this.cycles & 15) === 14) this.lfo_bit_counter++;
    if ((this.cycles & 15) !== 12 && this.lfo_counter1_of2) this.lfo_bit_counter = 0;
    this.lfo_counter1_of2 = this.lfo_counter1 === 2 ? 1 : 0;
  }

  /** `OPM_DoLFO2`. */
  private doLFO2() {
    this.lfo_clock_test = this.lfo_clock;
    this.lfo_clock = this.lfo_counter2_of || this.lfo_test || this.lfo_counter3_step ? 1 : 0;
    if ((this.cycles & 15) === 14) {
      this.lfo_counter2_of_lock = this.lfo_counter2_of;
      this.lfo_clock_lock = this.lfo_clock;
    }
    this.lfo_counter3_step = 0;
    if (this.lfo_counter3_clock) {
      if ((this.lfo_counter3 & 1) === 0) this.lfo_counter3_step = (this.lfo_freq_lo & 8) !== 0 ? 1 : 0;
      else if ((this.lfo_counter3 & 2) === 0) this.lfo_counter3_step = (this.lfo_freq_lo & 4) !== 0 ? 1 : 0;
      else if ((this.lfo_counter3 & 4) === 0) this.lfo_counter3_step = (this.lfo_freq_lo & 2) !== 0 ? 1 : 0;
      else if ((this.lfo_counter3 & 8) === 0) this.lfo_counter3_step = (this.lfo_freq_lo & 1) !== 0 ? 1 : 0;
    }
    this.lfo_test = this.mode_test[2];
  }

  /** `OPM_CSM`. */
  private csm() {
    this.kon_csm = this.kon_csm_lock;
    if (this.cycles === 1) this.kon_csm_lock = this.timer_a_do_load && this.mode_csm ? 1 : 0;
  }

  /**
   * `OPM_NoiseChannel`. `nc_out` is `uint16_t` and `op_mix` is `int16_t` in
   * the reference (`opm.h`): both narrow on every store there, the low 16
   * bits kept and, for `op_mix`, read back signed. `nc_out` is shifted left
   * every cycle here (unlike the read-only-its-low-bit `mix_out_bit`, or
   * the right-shifting `dac_bits`), so without the explicit `& 0xffff` a
   * plain JS number keeps every bit ever shifted in - accumulating up to
   * its 32-bit int width instead of wrapping at 16 - and once that stale
   * high end reaches bit 15 it leaks into `op_mix` through `<< 2`, which a
   * real `int16_t` store would have already dropped. `<< 16 >> 16` is this
   * file's sign-extending int16 truncation, matching `op_atten`'s explicit
   * saturate a few functions up for the same reason: the width only the
   * struct field, not any operator here, would otherwise enforce.
   */
  private noiseChannel() {
    this.nc_active |= this.eg_serial_bit & 1;
    if (this.cycles === 13) this.nc_active = 0;
    this.nc_out = ((this.nc_out << 1) | (this.nc_sign ^ this.eg_serial_bit)) & 0xffff;
    this.nc_sign = this.nc_sign_lock ? 0 : 1;
    if (this.cycles === 12) {
      this.nc_active_lock = this.nc_active;
      this.nc_sign_lock2 = this.nc_active_lock && !this.nc_sign_lock ? 1 : 0;
      this.nc_sign_lock = this.noise_lfsr & 1;

      if (this.noise_en) {
        if (this.nc_sign_lock2) {
          this.op_mix = ((((this.nc_out & ~1) << 2) | -4089) << 16) >> 16;
        } else {
          this.op_mix = (((this.nc_out & ~1) << 2) << 16) >> 16;
        }
      }
    }
  }

  /** `OPM_DoIO`. */
  private doIO() {
    this.write_busy_cnt += this.write_busy;
    this.write_busy = ((!(this.write_busy_cnt >> 5) && this.write_busy && !this.ic ? 1 : 0) | this.write_d_en) & 1;
    this.write_busy_cnt &= 0x1f;
    if (this.ic) this.write_busy_cnt = 0;

    this.write_a_en = this.write_a;
    this.write_d_en = this.write_d;
    this.write_a = 0;
    this.write_d = 0;
  }

  /** `OPM_DoRegWrite`, YM2151 (non-OPP) branch. */
  private doRegWrite() {
    const cycles = this.cycles;
    const channel = cycles & 7;
    const slot = cycles;

    if (this.reg_data_ready) {
      // Channel
      if ((this.reg_address & 0xe7) === (0x20 | channel)) {
        switch (this.reg_address & 0x18) {
          case 0x00: // RL, FB, CONNECT
            this.ch_rl[channel] = this.reg_data >> 6;
            this.ch_fb[channel] = (this.reg_data >> 3) & 0x07;
            this.ch_connect[channel] = this.reg_data & 0x07;
            break;
          case 0x08: // KC
            this.ch_kc[channel] = this.reg_data & 0x7f;
            break;
          case 0x10: // KF
            this.ch_kf[channel] = this.reg_data >> 2;
            break;
          case 0x18: // PMS, AMS
            this.ch_pms[channel] = (this.reg_data >> 4) & 0x07;
            this.ch_ams[channel] = this.reg_data & 0x03;
            break;
          default:
            break;
        }
      }
      // Slot
      if ((this.reg_address & 0x1f) === slot) {
        switch (this.reg_address & 0xe0) {
          case 0x40: // DT1, MUL
            this.sl_dt1[slot] = (this.reg_data >> 4) & 0x07;
            this.sl_mul[slot] = this.reg_data & 0x0f;
            break;
          case 0x60: // TL
            this.sl_tl[slot] = this.reg_data & 0x7f;
            break;
          case 0x80: // KS, AR
            this.sl_ks[slot] = this.reg_data >> 6;
            this.sl_ar[slot] = this.reg_data & 0x1f;
            break;
          case 0xa0: // AMS-EN, D1R
            this.sl_am_e[slot] = this.reg_data >> 7;
            this.sl_d1r[slot] = this.reg_data & 0x1f;
            break;
          case 0xc0: // DT2, D2R
            this.sl_dt2[slot] = this.reg_data >> 6;
            this.sl_d2r[slot] = this.reg_data & 0x1f;
            break;
          case 0xe0: // D1L, RR
            this.sl_d1l[slot] = this.reg_data >> 4;
            this.sl_rr[slot] = this.reg_data & 0x0f;
            break;
          default:
            break;
        }
      }
    }

    // Mode write
    if (this.write_d_en) {
      if (this.mode_address === 1) {
        for (let i = 0; i < 8; i++) this.mode_test[i] = (this.write_data >> i) & 0x01;
      }
      switch (this.mode_address) {
        case 0x08:
          for (let i = 0; i < 4; i++) this.mode_kon_operator[i] = (this.write_data >> (i + 3)) & 0x01;
          this.mode_kon_channel = this.write_data & 0x07;
          break;
        case 0x0f:
          this.noise_en = this.write_data >> 7;
          this.noise_freq = this.write_data & 0x1f;
          break;
        case 0x10:
          this.timer_a_reg &= 0x03;
          this.timer_a_reg |= this.write_data << 2;
          break;
        case 0x11:
          this.timer_a_reg &= 0x3fc;
          this.timer_a_reg |= this.write_data & 0x03;
          break;
        case 0x12:
          this.timer_b_reg = this.write_data;
          break;
        case 0x14:
          this.mode_csm = (this.write_data >> 7) & 1;
          this.timer_irqb = (this.write_data >> 3) & 1;
          this.timer_irqa = (this.write_data >> 2) & 1;
          this.timer_resetb = (this.write_data >> 5) & 1;
          this.timer_reseta = (this.write_data >> 4) & 1;
          this.timer_loadb = (this.write_data >> 1) & 1;
          this.timer_loada = (this.write_data >> 0) & 1;
          break;
        case 0x18:
          this.lfo_freq_hi = this.write_data >> 4;
          this.lfo_freq_lo = this.write_data & 0x0f;
          this.lfo_frq_update = 1;
          break;
        case 0x19:
          if (this.write_data & 0x80) this.lfo_pmd = this.write_data & 0x7f;
          else this.lfo_amd = this.write_data;
          break;
        case 0x1b:
          this.lfo_wave = this.write_data & 0x03;
          this.io_ct1 = (this.write_data >> 6) & 0x01;
          this.io_ct2 = this.write_data >> 7;
          break;
      }
    }

    // Register data write
    this.reg_data_ready = this.reg_data_ready && !this.write_a_en ? 1 : 0;
    if (this.reg_address_ready && this.write_d_en) {
      this.reg_data = this.write_data;
      this.reg_data_ready = 1;
    }

    // Register address write
    this.reg_address_ready = this.reg_address_ready && !this.write_a_en ? 1 : 0;
    if (this.write_a_en && (this.write_data & 0xe0) !== 0) {
      this.reg_address = this.write_data;
      this.reg_address_ready = 1;
    }
    if (this.write_a_en) this.mode_address = this.write_data;
  }

  /** `OPM_DoIC`, YM2151 (non-OPP) branch. */
  private doIC() {
    const channel = this.cycles & 7;
    const slot = this.cycles;
    if (this.ic) {
      this.ch_rl[channel] = 0;
      this.ch_fb[channel] = 0;
      this.ch_connect[channel] = 0;
      this.ch_kc[channel] = 0;
      this.ch_kf[channel] = 0;
      this.ch_pms[channel] = 0;
      this.ch_ams[channel] = 0;

      this.sl_dt1[slot] = 0;
      this.sl_mul[slot] = 0;
      this.sl_tl[slot] = 0;
      this.sl_ks[slot] = 0;
      this.sl_ar[slot] = 0;
      this.sl_am_e[slot] = 0;
      this.sl_d1r[slot] = 0;
      this.sl_dt2[slot] = 0;
      this.sl_d2r[slot] = 0;
      this.sl_d1l[slot] = 0;
      this.sl_rr[slot] = 0;

      this.timer_a_reg = 0;
      this.timer_b_reg = 0;
      this.timer_irqa = 0;
      this.timer_irqb = 0;
      this.timer_loada = 0;
      this.timer_loadb = 0;
      this.mode_csm = 0;

      for (let i = 0; i < 8; i++) this.mode_test[i] = 0;
      this.noise_en = 0;
      this.noise_freq = 0;

      this.mode_kon_channel = 0;
      this.mode_kon_operator[0] = 0;
      this.mode_kon_operator[1] = 0;
      this.mode_kon_operator[2] = 0;
      this.mode_kon_operator[3] = 0;
      this.mode_kon[(slot + 8) & 31] = 0;

      this.lfo_pmd = 0;
      this.lfo_amd = 0;
      this.lfo_wave = 0;
      this.lfo_freq_hi = 0;
      this.lfo_freq_lo = 0;

      this.io_ct1 = 0;
      this.io_ct2 = 0;

      this.reg_address = 0;
      this.reg_data = 0;
    }
    this.ic2 = this.ic;
  }
}
