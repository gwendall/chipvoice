/*
 * Copyright (C) 2007 Shay Green
 * Copyright (C) 2026 the chipvoice contributors, for the port
 *
 * This file is a port of snes_spc's SPC_DSP and is free software; you can
 * redistribute it and/or modify it under the terms of the GNU Lesser General
 * Public License as published by the Free Software Foundation; either version
 * 2.1 of the License, or (at your option) any later version. It is distributed
 * in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
 * the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Lesser General Public License for more details.
 *
 * With `chips/md/ym2612.ts`, one of the two files in the chipvoice package
 * that is not MIT.
 */

/**
 * The SNES's S-DSP, ported from snes_spc's "highly accurate" SPC_DSP.
 *
 * blargg's snes_spc (0.9.0, LGPL 2.1) emulates the DSP clock by clock: a
 * 32-phase pipeline, one phase per clock at 1024000 Hz, that decodes BRR,
 * interpolates, runs the envelopes, mixes eight voices, and runs the echo
 * through its FIR, producing one stereo sample every 32 clocks. It was
 * written against the hardware's own output and matches it; this is that code
 * in TypeScript, line for line, with blargg's names kept so the two can be
 * read side by side. snes_spc itself, built natively, is the oracle.
 *
 * The output is the DSP's digital stereo stream, the sixteen-bit words the
 * chip hands its DAC. That stream is what the harness compares: on this chip
 * the digital output *is* the chip's output, and a capture of it from a real
 * console is the same kind of thing.
 *
 * `run(clocks)` is `SPC_DSP::run`; `write` is `SPC_DSP::write`; the RAM is
 * the 64 KB the DSP shares with the SPC700, handed in by the chip around it.
 */

const initial_regs = new Uint8Array([
  0x45, 0x8b, 0x5a, 0x9a, 0xe4, 0x82, 0x1b, 0x78, 0x00, 0x00, 0xaa, 0x96, 0x89, 0x0e, 0xe0, 0x80,
  0x2a, 0x49, 0x3d, 0xba, 0x14, 0xa0, 0xac, 0xc5, 0x00, 0x00, 0x51, 0xbb, 0x9c, 0x4e, 0x7b, 0xff,
  0xf4, 0xfd, 0x57, 0x32, 0x37, 0xd9, 0x42, 0x22, 0x00, 0x00, 0x5b, 0x3c, 0x9f, 0x1b, 0x87, 0x9a,
  0x6f, 0x27, 0xaf, 0x7b, 0xe5, 0x68, 0x0a, 0xd9, 0x00, 0x00, 0x9a, 0xc5, 0x9c, 0x4e, 0x7b, 0xff,
  0xea, 0x21, 0x78, 0x4f, 0xdd, 0xed, 0x24, 0x14, 0x00, 0x00, 0x77, 0xb1, 0xd1, 0x36, 0xc1, 0x67,
  0x52, 0x57, 0x46, 0x3d, 0x59, 0xf4, 0x87, 0xa4, 0x00, 0x00, 0x7e, 0x44, 0x9c, 0x4e, 0x7b, 0xff,
  0x75, 0xf5, 0x06, 0x97, 0x10, 0xc3, 0x24, 0xbb, 0x00, 0x00, 0x7b, 0x7a, 0xe0, 0x60, 0x12, 0x0f,
  0xf7, 0x74, 0x1c, 0xe5, 0x39, 0x3d, 0x73, 0xc1, 0x00, 0x00, 0x7a, 0xb3, 0xff, 0x4e, 0x7b, 0xff,
]);

const gauss = new Int16Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2,
  2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5,
  6, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10,
  11, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 16, 16, 17, 17,
  18, 19, 19, 20, 20, 21, 21, 22, 23, 23, 24, 24, 25, 26, 27, 27,
  28, 29, 29, 30, 31, 32, 32, 33, 34, 35, 36, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
  58, 59, 60, 61, 62, 64, 65, 66, 67, 69, 70, 71, 73, 74, 76, 77,
  78, 80, 81, 83, 84, 86, 87, 89, 90, 92, 94, 95, 97, 99, 100, 102,
  104, 106, 107, 109, 111, 113, 115, 117, 118, 120, 122, 124, 126, 128, 130, 132,
  134, 137, 139, 141, 143, 145, 147, 150, 152, 154, 156, 159, 161, 163, 166, 168,
  171, 173, 175, 178, 180, 183, 186, 188, 191, 193, 196, 199, 201, 204, 207, 210,
  212, 215, 218, 221, 224, 227, 230, 233, 236, 239, 242, 245, 248, 251, 254, 257,
  260, 263, 267, 270, 273, 276, 280, 283, 286, 290, 293, 297, 300, 304, 307, 311,
  314, 318, 321, 325, 328, 332, 336, 339, 343, 347, 351, 354, 358, 362, 366, 370,
  374, 378, 381, 385, 389, 393, 397, 401, 405, 410, 414, 418, 422, 426, 430, 434,
  439, 443, 447, 451, 456, 460, 464, 469, 473, 477, 482, 486, 491, 495, 499, 504,
  508, 513, 517, 522, 527, 531, 536, 540, 545, 550, 554, 559, 563, 568, 573, 577,
  582, 587, 592, 596, 601, 606, 611, 615, 620, 625, 630, 635, 640, 644, 649, 654,
  659, 664, 669, 674, 678, 683, 688, 693, 698, 703, 708, 713, 718, 723, 728, 732,
  737, 742, 747, 752, 757, 762, 767, 772, 777, 782, 787, 792, 797, 802, 806, 811,
  816, 821, 826, 831, 836, 841, 846, 851, 855, 860, 865, 870, 875, 880, 884, 889,
  894, 899, 904, 908, 913, 918, 923, 927, 932, 937, 941, 946, 951, 955, 960, 965,
  969, 974, 978, 983, 988, 992, 997, 1001, 1005, 1010, 1014, 1019, 1023, 1027, 1032, 1036,
  1040, 1045, 1049, 1053, 1057, 1061, 1066, 1070, 1074, 1078, 1082, 1086, 1090, 1094, 1098, 1102,
  1106, 1109, 1113, 1117, 1121, 1125, 1128, 1132, 1136, 1139, 1143, 1146, 1150, 1153, 1157, 1160,
  1164, 1167, 1170, 1174, 1177, 1180, 1183, 1186, 1190, 1193, 1196, 1199, 1202, 1205, 1207, 1210,
  1213, 1216, 1219, 1221, 1224, 1227, 1229, 1232, 1234, 1237, 1239, 1241, 1244, 1246, 1248, 1251,
  1253, 1255, 1257, 1259, 1261, 1263, 1265, 1267, 1269, 1270, 1272, 1274, 1275, 1277, 1279, 1280,
  1282, 1283, 1284, 1286, 1287, 1288, 1290, 1291, 1292, 1293, 1294, 1295, 1296, 1297, 1297, 1298,
  1299, 1300, 1300, 1301, 1302, 1302, 1303, 1303, 1303, 1304, 1304, 1304, 1304, 1304, 1305, 1305,
]);

const simple_counter_range = 2048 * 5 * 3;

const counter_rates = [
  simple_counter_range + 1,
  2048, 1536,
  1280, 1024, 768,
  640, 512, 384,
  320, 256, 192,
  160, 128, 96,
  80, 64, 48,
  40, 32, 24,
  20, 16, 12,
  10, 8, 6,
  5, 4, 3,
  2,
  1,
];

const counter_offsets = [
  1, 0, 1040,
  536, 0, 1040,
  536, 0, 1040,
  536, 0, 1040,
  536, 0, 1040,
  536, 0, 1040,
  536, 0, 1040,
  536, 0, 1040,
  536, 0, 1040,
  536, 0, 1040,
  0,
  0,
];

// Register addresses.
const r_mvoll = 0x0c;
const r_evoll = 0x2c;
const r_kon = 0x4c;
const r_koff = 0x5c;
const r_flg = 0x6c;
const r_endx = 0x7c;
const r_efb = 0x0d;
const r_pmon = 0x2d;
const r_non = 0x3d;
const r_eon = 0x4d;
const r_dir = 0x5d;
const r_esa = 0x6d;
const r_edl = 0x7d;
const r_fir = 0x0f;

const v_voll = 0x00;
const v_pitchl = 0x02;
const v_pitchh = 0x03;
const v_srcn = 0x04;
const v_adsr0 = 0x05;
const v_adsr1 = 0x06;
const v_gain = 0x07;
const v_envx = 0x08;
const v_outx = 0x09;

const env_release = 0;
const env_attack = 1;
const env_decay = 2;
const env_sustain = 3;

const brr_buf_size = 12;
const brr_block_size = 9;
const echo_hist_size = 8;

/** C's `(int16_t) x`. */
const int16 = (x: number) => (x << 16) >> 16;
/** C's `(int8_t) x`. */
const int8 = (x: number) => (x << 24) >> 24;
/** `CLAMP16`: to sixteen bits, saturating. */
const clamp16 = (io: number) => (int16(io) !== io ? (io >> 31) ^ 0x7fff : io);

class Voice {
  /** Decoded samples, twice the size to simplify wrap handling. */
  readonly buf = new Int32Array(brr_buf_size * 2);
  buf_pos = 0;
  interp_pos = 0;
  brr_addr = 0;
  brr_offset = 0;
  /** Index of the voice's registers in `regs`. */
  base = 0;
  vbit = 0;
  kon_delay = 0;
  env_mode = env_release;
  env = 0;
  hidden_env = 0;
  t_envx_out = 0;
}

export class SDsp {
  readonly regs = new Uint8Array(128);
  /** The 64 KB the DSP shares with the SPC700. */
  ram: Uint8Array;
  readonly echo_hist = new Int32Array(echo_hist_size * 2 * 2);
  echo_hist_pos = 0;
  every_other_sample = 0;
  kon = 0;
  noise = 0;
  counter = 0;
  echo_offset = 0;
  echo_length = 0;
  phase = 0;
  kon_check = false;
  new_kon = 0;
  endx_buf = 0;
  envx_buf = 0;
  outx_buf = 0;
  t_pmon = 0;
  t_non = 0;
  t_eon = 0;
  t_dir = 0;
  t_koff = 0;
  t_brr_next_addr = 0;
  t_adsr0 = 0;
  t_brr_header = 0;
  t_brr_byte = 0;
  t_srcn = 0;
  t_esa = 0;
  t_echo_enabled = 0;
  t_dir_addr = 0;
  t_pitch = 0;
  t_output = 0;
  t_looped = 0;
  t_echo_ptr = 0;
  readonly t_main_out = new Int32Array(2);
  readonly t_echo_out = new Int32Array(2);
  readonly t_echo_in = new Int32Array(2);
  readonly voices: Voice[] = [];
  mute_mask = 0;
  /** The last sample the DSP handed its DAC, and whether one was produced by the last `run`. */
  outL = 0;
  outR = 0;
  sampleReady = false;

  constructor(ram: Uint8Array) {
    this.ram = ram;
    for (let i = 0; i < 8; i++) this.voices.push(new Voice());
    this.reset();
  }

  read(addr: number): number {
    return this.regs[addr & 0x7f];
  }

  write(addr: number, data: number) {
    addr &= 0x7f;
    data &= 0xff;
    this.regs[addr] = data;
    switch (addr & 0x0f) {
      case v_envx:
        this.envx_buf = data;
        break;
      case v_outx:
        this.outx_buf = data;
        break;
      case 0x0c:
        if (addr === r_kon) this.new_kon = data;
        if (addr === r_endx) {
          this.endx_buf = 0;
          this.regs[r_endx] = 0;
        }
        break;
      default:
        break;
    }
  }

  private init_counter() {
    this.counter = 0;
  }

  private run_counters() {
    if (--this.counter < 0) this.counter = simple_counter_range - 1;
  }

  private read_counter(rate: number): number {
    return (this.counter + counter_offsets[rate]) % counter_rates[rate];
  }

  private interpolate(v: Voice): number {
    const offset = (v.interp_pos >> 4) & 0xff;
    const fwd = 255 - offset;
    const rev = offset;
    const inAt = (v.interp_pos >> 12) + v.buf_pos;
    const buf = v.buf;
    let out = (gauss[fwd] * buf[inAt]) >> 11;
    out += (gauss[fwd + 256] * buf[inAt + 1]) >> 11;
    out += (gauss[rev + 256] * buf[inAt + 2]) >> 11;
    out = int16(out);
    out += (gauss[rev] * buf[inAt + 3]) >> 11;
    out = clamp16(out);
    out &= ~1;
    return out;
  }

  private run_envelope(v: Voice) {
    let env = v.env;
    if (v.env_mode === env_release) {
      if ((env -= 0x8) < 0) env = 0;
      v.env = env;
    } else {
      let rate: number;
      let env_data = this.regs[v.base + v_adsr1];
      if (this.t_adsr0 & 0x80) {
        if (v.env_mode >= env_decay) {
          env--;
          env -= env >> 8;
          rate = env_data & 0x1f;
          if (v.env_mode === env_decay) rate = ((this.t_adsr0 >> 3) & 0x0e) + 0x10;
        } else {
          rate = (this.t_adsr0 & 0x0f) * 2 + 1;
          env += rate < 31 ? 0x20 : 0x400;
        }
      } else {
        env_data = this.regs[v.base + v_gain];
        const mode = env_data >> 5;
        if (mode < 4) {
          env = env_data * 0x10;
          rate = 31;
        } else {
          rate = env_data & 0x1f;
          if (mode === 4) {
            env -= 0x20;
          } else if (mode < 6) {
            env--;
            env -= env >> 8;
          } else {
            env += 0x20;
            if (mode > 6 && v.hidden_env >= 0x600) env += 0x8 - 0x20;
          }
        }
      }

      if (env >> 8 === env_data >> 5 && v.env_mode === env_decay) v.env_mode = env_sustain;

      v.hidden_env = env;

      if (env < 0 || env > 0x7ff) {
        env = env < 0 ? 0 : 0x7ff;
        if (v.env_mode === env_attack) v.env_mode = env_decay;
      }

      if (!this.read_counter(rate)) v.env = env;
    }
  }

  private decode_brr(v: Voice) {
    let nybbles = this.t_brr_byte * 0x100 + this.ram[(v.brr_addr + v.brr_offset + 1) & 0xffff];
    const header = this.t_brr_header;
    let pos = v.buf_pos;
    if ((v.buf_pos += 4) >= brr_buf_size) v.buf_pos = 0;
    const buf = v.buf;
    for (const end = pos + 4; pos < end; pos++, nybbles <<= 4) {
      let s = int16(nybbles) >> 12;
      const shift = header >> 4;
      s = (s << shift) >> 1;
      if (shift >= 0xd) s = (s >> 25) << 11;
      const filter = header & 0x0c;
      const p1 = buf[pos + brr_buf_size - 1];
      const p2 = buf[pos + brr_buf_size - 2] >> 1;
      if (filter >= 8) {
        s += p1;
        s -= p2;
        if (filter === 8) {
          s += p2 >> 4;
          s += (p1 * -3) >> 6;
        } else {
          s += (p1 * -13) >> 7;
          s += (p2 * 3) >> 4;
        }
      } else if (filter) {
        s += p1 >> 1;
        s += -p1 >> 5;
      }
      s = clamp16(s);
      s = int16(s * 2);
      buf[pos + brr_buf_size] = buf[pos] = s;
    }
  }

  private misc_27() {
    this.t_pmon = this.regs[r_pmon] & 0xfe;
  }

  private misc_28() {
    this.t_non = this.regs[r_non];
    this.t_eon = this.regs[r_eon];
    this.t_dir = this.regs[r_dir];
  }

  private misc_29() {
    if ((this.every_other_sample ^= 1) !== 0) this.new_kon &= ~this.kon;
  }

  private misc_30() {
    if (this.every_other_sample) {
      this.kon = this.new_kon;
      this.t_koff = this.regs[r_koff] | this.mute_mask;
    }
    this.run_counters();
    if (!this.read_counter(this.regs[r_flg] & 0x1f)) {
      const feedback = (this.noise << 13) ^ (this.noise << 14);
      this.noise = (feedback & 0x4000) ^ (this.noise >> 1);
    }
  }

  private voice_V1(v: Voice) {
    this.t_dir_addr = this.t_dir * 0x100 + this.t_srcn * 4;
    this.t_srcn = this.regs[v.base + v_srcn];
  }

  private voice_V2(v: Voice) {
    let entry = this.t_dir_addr;
    if (!v.kon_delay) entry += 2;
    this.t_brr_next_addr = this.ram[entry & 0xffff] | (this.ram[(entry + 1) & 0xffff] << 8);
    this.t_adsr0 = this.regs[v.base + v_adsr0];
    this.t_pitch = this.regs[v.base + v_pitchl];
  }

  private voice_V3a(v: Voice) {
    this.t_pitch += (this.regs[v.base + v_pitchh] & 0x3f) << 8;
  }

  private voice_V3b(v: Voice) {
    this.t_brr_byte = this.ram[(v.brr_addr + v.brr_offset) & 0xffff];
    this.t_brr_header = this.ram[v.brr_addr & 0xffff];
  }

  private voice_V3c(v: Voice) {
    if (this.t_pmon & v.vbit) this.t_pitch += ((this.t_output >> 5) * this.t_pitch) >> 10;

    if (v.kon_delay) {
      if (v.kon_delay === 5) {
        v.brr_addr = this.t_brr_next_addr;
        v.brr_offset = 1;
        v.buf_pos = 0;
        this.t_brr_header = 0;
        this.kon_check = true;
      }
      v.env = 0;
      v.hidden_env = 0;
      v.interp_pos = 0;
      if (--v.kon_delay & 3) v.interp_pos = 0x4000;
      this.t_pitch = 0;
    }

    {
      let output = this.interpolate(v);
      if (this.t_non & v.vbit) output = int16(this.noise * 2);
      this.t_output = ((output * v.env) >> 11) & ~1;
      v.t_envx_out = (v.env >> 4) & 0xff;
    }

    if (this.regs[r_flg] & 0x80 || (this.t_brr_header & 3) === 1) {
      v.env_mode = env_release;
      v.env = 0;
    }

    if (this.every_other_sample) {
      if (this.t_koff & v.vbit) v.env_mode = env_release;
      if (this.kon & v.vbit) {
        v.kon_delay = 5;
        v.env_mode = env_attack;
      }
    }

    if (!v.kon_delay) this.run_envelope(v);
  }

  private voice_output(v: Voice, ch: number) {
    const amp = (this.t_output * int8(this.regs[v.base + v_voll + ch])) >> 7;
    this.t_main_out[ch] = clamp16(this.t_main_out[ch] + amp);
    if (this.t_eon & v.vbit) this.t_echo_out[ch] = clamp16(this.t_echo_out[ch] + amp);
  }

  private voice_V4(v: Voice) {
    this.t_looped = 0;
    if (v.interp_pos >= 0x4000) {
      this.decode_brr(v);
      if ((v.brr_offset += 2) >= brr_block_size) {
        v.brr_addr = (v.brr_addr + brr_block_size) & 0xffff;
        if (this.t_brr_header & 1) {
          v.brr_addr = this.t_brr_next_addr;
          this.t_looped = v.vbit;
        }
        v.brr_offset = 1;
      }
    }
    v.interp_pos = (v.interp_pos & 0x3fff) + this.t_pitch;
    if (v.interp_pos > 0x7fff) v.interp_pos = 0x7fff;
    this.voice_output(v, 0);
  }

  private voice_V5(v: Voice) {
    this.voice_output(v, 1);
    let endx_buf = this.regs[r_endx] | this.t_looped;
    if (v.kon_delay === 5) endx_buf &= ~v.vbit;
    this.endx_buf = endx_buf & 0xff;
  }

  private voice_V6(_v: Voice) {
    this.outx_buf = (this.t_output >> 8) & 0xff;
  }

  private voice_V7(v: Voice) {
    this.regs[r_endx] = this.endx_buf;
    this.envx_buf = v.t_envx_out;
  }

  private voice_V8(v: Voice) {
    this.regs[v.base + v_outx] = this.outx_buf;
  }

  private voice_V9(v: Voice) {
    this.regs[v.base + v_envx] = this.envx_buf;
  }

  private voice_V3(v: Voice) {
    this.voice_V3a(v);
    this.voice_V3b(v);
    this.voice_V3c(v);
  }

  private voice_V7_V4_V1(i: number) {
    this.voice_V7(this.voices[i]);
    this.voice_V1(this.voices[i + 3]);
    this.voice_V4(this.voices[i + 1]);
  }

  private voice_V8_V5_V2(i: number) {
    this.voice_V8(this.voices[i]);
    this.voice_V5(this.voices[i + 1]);
    this.voice_V2(this.voices[i + 2]);
  }

  private voice_V9_V6_V3(i: number) {
    this.voice_V9(this.voices[i]);
    this.voice_V6(this.voices[i + 1]);
    this.voice_V3(this.voices[i + 2]);
  }

  /** `ECHO_FIR(i)[ch]`: the echo history, oldest first, twice the size for wrap. */
  private fir(i: number, ch: number): number {
    return this.echo_hist[(this.echo_hist_pos + i) * 2 + ch];
  }

  private calc_fir(i: number, ch: number): number {
    return (this.fir(i + 1, ch) * int8(this.regs[r_fir + i * 0x10])) >> 6;
  }

  private echo_read(ch: number) {
    const at = (this.t_echo_ptr + ch * 2) & 0xffff;
    const s = int16(this.ram[at] | (this.ram[(at + 1) & 0xffff] << 8));
    this.echo_hist[this.echo_hist_pos * 2 + ch] = s >> 1;
    this.echo_hist[(this.echo_hist_pos + 8) * 2 + ch] = s >> 1;
  }

  private echo_22() {
    if (++this.echo_hist_pos >= echo_hist_size) this.echo_hist_pos = 0;
    this.t_echo_ptr = (this.t_esa * 0x100 + this.echo_offset) & 0xffff;
    this.echo_read(0);
    this.t_echo_in[0] = this.calc_fir(0, 0);
    this.t_echo_in[1] = this.calc_fir(0, 1);
  }

  private echo_23() {
    this.t_echo_in[0] += this.calc_fir(1, 0) + this.calc_fir(2, 0);
    this.t_echo_in[1] += this.calc_fir(1, 1) + this.calc_fir(2, 1);
    this.echo_read(1);
  }

  private echo_24() {
    this.t_echo_in[0] += this.calc_fir(3, 0) + this.calc_fir(4, 0) + this.calc_fir(5, 0);
    this.t_echo_in[1] += this.calc_fir(3, 1) + this.calc_fir(4, 1) + this.calc_fir(5, 1);
  }

  private echo_25() {
    let l = this.t_echo_in[0] + this.calc_fir(6, 0);
    let r = this.t_echo_in[1] + this.calc_fir(6, 1);
    l = int16(l);
    r = int16(r);
    l += int16(this.calc_fir(7, 0));
    r += int16(this.calc_fir(7, 1));
    l = clamp16(l);
    r = clamp16(r);
    this.t_echo_in[0] = l & ~1;
    this.t_echo_in[1] = r & ~1;
  }

  private echo_output(ch: number): number {
    const out =
      int16((this.t_main_out[ch] * int8(this.regs[r_mvoll + ch * 0x10])) >> 7) +
      int16((this.t_echo_in[ch] * int8(this.regs[r_evoll + ch * 0x10])) >> 7);
    return clamp16(out);
  }

  private echo_26() {
    this.t_main_out[0] = this.echo_output(0);
    let l = this.t_echo_out[0] + int16((this.t_echo_in[0] * int8(this.regs[r_efb])) >> 7);
    let r = this.t_echo_out[1] + int16((this.t_echo_in[1] * int8(this.regs[r_efb])) >> 7);
    l = clamp16(l);
    r = clamp16(r);
    this.t_echo_out[0] = l & ~1;
    this.t_echo_out[1] = r & ~1;
  }

  private echo_27() {
    let l = this.t_main_out[0];
    let r = this.echo_output(1);
    this.t_main_out[0] = 0;
    this.t_main_out[1] = 0;
    if (this.regs[r_flg] & 0x40) {
      l = 0;
      r = 0;
    }
    this.outL = l;
    this.outR = r;
    this.sampleReady = true;
  }

  private echo_28() {
    this.t_echo_enabled = this.regs[r_flg];
  }

  private echo_write(ch: number) {
    if (!(this.t_echo_enabled & 0x20)) {
      const at = (this.t_echo_ptr + ch * 2) & 0xffff;
      const s = this.t_echo_out[ch];
      this.ram[at] = s & 0xff;
      this.ram[(at + 1) & 0xffff] = (s >> 8) & 0xff;
    }
    this.t_echo_out[ch] = 0;
  }

  private echo_29() {
    this.t_esa = this.regs[r_esa];
    if (!this.echo_offset) this.echo_length = (this.regs[r_edl] & 0x0f) * 0x800;
    this.echo_offset += 4;
    if (this.echo_offset >= this.echo_length) this.echo_offset = 0;
    this.echo_write(0);
    this.t_echo_enabled = this.regs[r_flg];
  }

  private echo_30() {
    this.echo_write(1);
  }

  /** One clock: the phase the chip is at, then the next. */
  private step() {
    const v = this.voices;
    switch (this.phase) {
      case 0: this.voice_V5(v[0]); this.voice_V2(v[1]); break;
      case 1: this.voice_V6(v[0]); this.voice_V3(v[1]); break;
      case 2: this.voice_V7_V4_V1(0); break;
      case 3: this.voice_V8_V5_V2(0); break;
      case 4: this.voice_V9_V6_V3(0); break;
      case 5: this.voice_V7_V4_V1(1); break;
      case 6: this.voice_V8_V5_V2(1); break;
      case 7: this.voice_V9_V6_V3(1); break;
      case 8: this.voice_V7_V4_V1(2); break;
      case 9: this.voice_V8_V5_V2(2); break;
      case 10: this.voice_V9_V6_V3(2); break;
      case 11: this.voice_V7_V4_V1(3); break;
      case 12: this.voice_V8_V5_V2(3); break;
      case 13: this.voice_V9_V6_V3(3); break;
      case 14: this.voice_V7_V4_V1(4); break;
      case 15: this.voice_V8_V5_V2(4); break;
      case 16: this.voice_V9_V6_V3(4); break;
      case 17: this.voice_V1(v[0]); this.voice_V7(v[5]); this.voice_V4(v[6]); break;
      case 18: this.voice_V8_V5_V2(5); break;
      case 19: this.voice_V9_V6_V3(5); break;
      case 20: this.voice_V1(v[1]); this.voice_V7(v[6]); this.voice_V4(v[7]); break;
      case 21: this.voice_V8(v[6]); this.voice_V5(v[7]); this.voice_V2(v[0]); break;
      case 22: this.voice_V3a(v[0]); this.voice_V9(v[6]); this.voice_V6(v[7]); this.echo_22(); break;
      case 23: this.voice_V7(v[7]); this.echo_23(); break;
      case 24: this.voice_V8(v[7]); this.echo_24(); break;
      case 25: this.voice_V3b(v[0]); this.voice_V9(v[7]); this.echo_25(); break;
      case 26: this.echo_26(); break;
      case 27: this.misc_27(); this.echo_27(); break;
      case 28: this.misc_28(); this.echo_28(); break;
      case 29: this.misc_29(); this.echo_29(); break;
      case 30: this.misc_30(); this.voice_V3c(v[0]); this.echo_30(); break;
      case 31: this.voice_V4(v[0]); this.voice_V1(v[2]); break;
      default: break;
    }
    this.phase = (this.phase + 1) & 31;
  }

  /** `SPC_DSP::run`: so many clocks, one phase each. */
  run(clocks: number) {
    this.sampleReady = false;
    for (let i = 0; i < clocks; i++) this.step();
  }

  private soft_reset_common() {
    this.noise = 0x4000;
    this.echo_hist_pos = 0;
    this.every_other_sample = 1;
    this.echo_offset = 0;
    this.phase = 0;
    this.init_counter();
  }

  soft_reset() {
    this.regs[r_flg] = 0xe0;
    this.soft_reset_common();
  }

  /** `SPC_DSP::load`: registers as given, every other piece of state fresh. */
  load(regs: Uint8Array) {
    this.regs.set(regs.subarray(0, 128));
    this.echo_hist.fill(0);
    this.echo_hist_pos = 0;
    this.every_other_sample = 0;
    this.kon = 0;
    this.noise = 0;
    this.counter = 0;
    this.echo_offset = 0;
    this.echo_length = 0;
    this.phase = 0;
    this.kon_check = false;
    this.new_kon = 0;
    this.endx_buf = 0;
    this.envx_buf = 0;
    this.outx_buf = 0;
    this.t_pmon = this.t_non = this.t_eon = this.t_dir = this.t_koff = 0;
    this.t_brr_next_addr = this.t_adsr0 = this.t_brr_header = this.t_brr_byte = this.t_srcn = this.t_esa = this.t_echo_enabled = 0;
    this.t_dir_addr = this.t_pitch = this.t_output = this.t_looped = this.t_echo_ptr = 0;
    this.t_main_out.fill(0);
    this.t_echo_out.fill(0);
    this.t_echo_in.fill(0);
    for (let i = 0; i < 8; i++) {
      const v = this.voices[i];
      v.buf.fill(0);
      v.buf_pos = 0;
      v.interp_pos = 0;
      v.brr_addr = 0;
      v.brr_offset = 1;
      v.base = i * 0x10;
      v.vbit = 1 << i;
      v.kon_delay = 0;
      v.env_mode = env_release;
      v.env = 0;
      v.hidden_env = 0;
      v.t_envx_out = 0;
    }
    this.new_kon = this.regs[r_kon];
    this.t_dir = this.regs[r_dir];
    this.t_esa = this.regs[r_esa];
    this.soft_reset_common();
  }

  reset() {
    this.load(initial_regs);
  }
}
