import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { vgmToWrites } from '../vgm.mjs';

/**
 * The YM2151 probe corpus: self-authored, CC0 register-stream .vgm files,
 * one register write per VGM command (`0x54 aa dd`), covering every
 * feature this port's core scope claims (see `docs/chips/ym2151.md`) plus a
 * handful of edge cases. Each script here is written twice, the same way
 * `generate-vgm-import.mjs` writes its two files: a `.vgm` under `source/`
 * (what a real player opens, with its SHA-256 recorded in `manifest.json`)
 * and the `.log` this harness actually runs, decoded from that same `.vgm`
 * by this project's own `vgmToWrites` (`packages/conform/src/vgm.mjs`) -
 * the "existing VGM import" the ticket names as this chip's register-stream
 * host - so a bug in that decoder would show up as a score against the
 * oracle, not just agree with itself.
 *
 * No real game or arcade rip is here or ever will be: every write below is
 * hand-composed for this corpus, and is released CC0 (see `README.md`
 * alongside the generated files).
 *
 * Every channel/slot register write is held apart from the next one by
 * `SETTLE` native cycles, comfortably past the settling time Nuked-OPM's
 * own two-port latch needs: the address-port write and the data-port write
 * that follows it are only actually applied once `OPM_Clock` has walked its
 * 32-cycle sweep back around to that register's own channel/slot index (up
 * to 32 calls, 64 native cycles at this chip's 2-cycles-per-`OPM_Clock`
 * rate - see `packages/chipvoice/src/chips/ym2151.ts`'s module doc comment
 * and `oracles/nuked-opm/README.md`), and a new address-port write before
 * that happens clears the pending one, silently dropping it
 * (`reg_data_ready = reg_data_ready && !write_a_en` in the vendored
 * `opm.c`). `SETTLE` (4000 cycles, about 2000 `OPM_Clock()` calls) is
 * comfortably clear of that window, so every script except the one that
 * means to hit it deliberately (`edge/write-clobber`) never does.
 *
 * `vgmToWrites`'s own decoder now enforces the same window by default
 * (`YM2151_SETTLE_CYCLES`, 64 native cycles - the same figure, empirically
 * confirmed against the vendored `opm.c`, see `packages/conform/src/vgm.mjs`'s
 * module doc comment) whether or not a script's own writes are spaced this
 * generously, so `write-clobber` alone passes `settleCycles: 4` to
 * `writeScript` to ask the decoder for the old, narrow spacing and keep
 * triggering the drop on purpose.
 */
const CLOCK = 3579545;
const SAMPLE_RATE = 44100;
const VGM_VERSION = 0x161;
const HEADER_SIZE = 0xc0;
const YM2151_COMMAND = 0x54;
const YM2151_CLOCK_OFFSET = 0x30;
const GENERATOR = 'packages/conform/src/corpus/generate-ym2151.mjs';

/** See the module doc comment: comfortably past the up-to-64-native-cycle settling window. */
const SETTLE = 4000;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus', 'ym2151');
const CORE_OUT = path.join(ROOT, 'core');
const EDGE_OUT = path.join(ROOT, 'edge');

/** A register writer with a cursor, in native (3579545 Hz) cycles - the same convention as `generate-vrc6.mjs`'s `writer()`. */
function writer() {
  const writes = [];
  let t = 0;
  return {
    writes,
    at(cycle) { t = cycle; },
    now() { return t; },
    reg(address, data) { writes.push({ at: t, reg: address & 0xff, data: data & 0xff }); },
    advance(cycles) { t += cycles; },
  };
}

/** The four channel registers: RL/FB/CONNECT (0x20), KC (0x28), KF (0x30), PMS/AMS (0x38). */
function channelRegs(w, channel, { rl = 3, fb = 0, connect = 0, kc = 0x4c, kf = 0, pms = 0, ams = 0 } = {}) {
  w.reg(0x20 | channel, (rl << 6) | ((fb & 7) << 3) | (connect & 7));
  w.advance(SETTLE);
  w.reg(0x28 | channel, kc & 0x7f);
  w.advance(SETTLE);
  w.reg(0x30 | channel, (kf & 0x3f) << 2);
  w.advance(SETTLE);
  w.reg(0x38 | channel, ((pms & 7) << 4) | (ams & 3));
  w.advance(SETTLE);
}

/**
 * The six slot registers for one operator: DT1/MUL (0x40), TL (0x60), KS/AR
 * (0x80), AMS-EN/D1R (0xa0), DT2/D2R (0xc0), D1L/RR (0xe0). `slot` is
 * `channel + 8 * op` with `op` 0=M1, 1=M2, 2=C1, 3=C2, the YM2151's own
 * operator numbering (also `mode_kon_operator`'s bit order, D3..D6 of
 * register 0x08 - see `keyOn` below).
 */
function slotRegs(w, slot, { dt1 = 0, mul = 0, tl = 0, ks = 0, ar = 31, ame = 0, d1r = 0, dt2 = 0, d2r = 0, d1l = 0, rr = 15 } = {}) {
  w.reg(0x40 | slot, ((dt1 & 7) << 4) | (mul & 15));
  w.advance(SETTLE);
  w.reg(0x60 | slot, tl & 0x7f);
  w.advance(SETTLE);
  w.reg(0x80 | slot, (ks << 6) | (ar & 31));
  w.advance(SETTLE);
  w.reg(0xa0 | slot, (ame << 7) | (d1r & 31));
  w.advance(SETTLE);
  w.reg(0xc0 | slot, ((dt2 & 3) << 6) | (d2r & 31));
  w.advance(SETTLE);
  w.reg(0xe0 | slot, ((d1l & 15) << 4) | (rr & 15));
  w.advance(SETTLE);
}

function slotFor(channel, op) { return channel + 8 * op; }

/** Register 0x08: D3..D6 key the four operators (M1, M2, C1, C2) of channel `channel` on or off; `ops` is a 4-bit mask, bit 0 = M1. */
function keyOn(w, channel, ops) {
  w.reg(0x08, ((ops & 15) << 3) | (channel & 7));
  w.advance(SETTLE);
}

/** Fully configures one channel's four operators the same way, so a script only has to vary the one thing it is testing. */
function defaultChannel(w, channel, chRegs, opRegs = {}) {
  channelRegs(w, channel, chRegs);
  for (let op = 0; op < 4; op++) slotRegs(w, slotFor(channel, op), { mul: 1, tl: 8, ar: 31, d1r: 6, d2r: 2, d1l: 4, rr: 8, ...opRegs });
}

/**
 * Builds a minimal single-chip VGM file from register-level writes (one
 * `0x54 aa dd` command per entry, `aa` the YM2151 register, `dd` its data),
 * at this chip's own 3579545 Hz clock and version 1.61 (the version
 * `packages/conform/src/vgm.mjs`'s `ym2151VgmToWrites` requires for the
 * clock field to be read) - a smaller version of `packages/chipvoice/src/vgm.ts`'s
 * `toVgm`, which this project's public package does not need a YM2151 entry
 * in (see `docs/DECISIONS.md`'s decision 51: no driver or arranger role for
 * this chip yet).
 *
 * @param {{ at: number, reg: number, data: number }[]} writes native-cycle-stamped register writes, in order
 * @param {number} cycles how long the file plays, in native cycles
 */
function buildYm2151Vgm(writes, cycles, { title, notes } = {}) {
  const samples = (cycle) => Math.round((cycle * SAMPLE_RATE) / CLOCK);
  const total = samples(cycles);
  const body = [];
  let position = 0;
  const wait = (until) => {
    let n = until - position;
    while (n > 0) {
      if (n <= 16) { body.push(0x70 + n - 1); n = 0; }
      else if (n === 735) { body.push(0x62); n = 0; }
      else if (n === 882) { body.push(0x63); n = 0; }
      else { const chunk = Math.min(n, 0xffff); body.push(0x61, chunk & 0xff, chunk >> 8); n -= chunk; }
    }
    position = until;
  };
  for (const w of writes) {
    wait(samples(w.at));
    body.push(YM2151_COMMAND, w.reg, w.data);
  }
  wait(total);
  body.push(0x66);

  const gd3 = gd3Tag({ title, notes });
  const file = new Uint8Array(HEADER_SIZE + body.length + gd3.length);
  const view = new DataView(file.buffer);
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) file[offset + i] = text.charCodeAt(i); };
  ascii(0x00, 'Vgm ');
  view.setUint32(0x04, file.length - 4, true);
  view.setUint32(0x08, VGM_VERSION, true);
  view.setUint32(0x14, HEADER_SIZE + body.length - 0x14, true);
  view.setUint32(0x18, total, true);
  view.setUint32(0x24, SAMPLE_RATE, true);
  view.setUint32(0x34, HEADER_SIZE - 0x34, true);
  view.setUint32(YM2151_CLOCK_OFFSET, CLOCK, true);
  file.set(body, HEADER_SIZE);
  file.set(gd3, HEADER_SIZE + body.length);
  return file;
}

/** A minimal GD3 tag - a title and a note, the rest blank; the same shape as `toVgm`'s own `tag()`. */
function gd3Tag({ title = '', notes = '' } = {}) {
  const strings = [title, '', 'chipvoice YM2151 probe corpus', '', 'Yamaha YM2151', '', 'chipvoice project', '', '', 'chipvoice', notes];
  const chars = [];
  for (const s of strings) { for (let i = 0; i < s.length; i++) chars.push(s.charCodeAt(i)); chars.push(0); }
  const out = new Uint8Array(12 + chars.length * 2);
  const view = new DataView(out.buffer);
  out.set([0x47, 0x64, 0x33, 0x20], 0);
  view.setUint32(4, 0x100, true);
  view.setUint32(8, chars.length * 2, true);
  chars.forEach((c, i) => view.setUint16(12 + i * 2, c, true));
  return out;
}

const CORE_SCRIPTS = [
  {
    name: 'algorithms',
    notes: 'Channel 0 through all eight CONNECT algorithms (0-7), feedback fixed at 4 so op1 self-modulates the same way in each, four operators at distinct TL/MUL so the algorithms\' different summing is audible - key on, hold, key off, next algorithm.',
    writes: () => {
      const w = writer();
      let t = 0;
      for (let alg = 0; alg < 8; alg++) {
        w.at(t);
        defaultChannel(w, 0, { fb: 4, connect: alg, kc: 0x4c }, {});
        for (let op = 0; op < 4; op++) slotRegs(w, slotFor(0, op), { mul: op + 1, tl: op * 8, ar: 31, d1r: 4, d2r: 2, d1l: 6, rr: 8 });
        keyOn(w, 0, 0b1111);
        w.advance(4 * SETTLE);
        keyOn(w, 0, 0);
        t = w.now() + 2 * SETTLE;
      }
      return w.writes;
    },
  },
  {
    name: 'feedback',
    notes: 'Channel 1, CONNECT 7 (fully additive, so op1\'s own feedback is directly in the mix), FB stepped 0 through 7.',
    writes: () => {
      const w = writer();
      let t = 0;
      for (let fb = 0; fb < 8; fb++) {
        w.at(t);
        defaultChannel(w, 1, { fb, connect: 7, kc: 0x4c }, { mul: 1, tl: 4, ar: 31, d1r: 4, d2r: 2, d1l: 6, rr: 8 });
        keyOn(w, 1, 0b1111);
        w.advance(4 * SETTLE);
        keyOn(w, 1, 0);
        t = w.now() + 2 * SETTLE;
      }
      return w.writes;
    },
  },
  {
    name: 'detune-multiple',
    notes: 'Channel 2, one operator (C2, the audible carrier at CONNECT 7) stepped through DT1 0-7 at MUL 1, then MUL 0-15 at DT1 0, so both the detune table and the times-N/times-0.5 multiple path are each exercised on their own.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 2, { connect: 7, kc: 0x4c }, {});
      let t = w.now();
      for (let dt1 = 0; dt1 < 8; dt1++) {
        w.at(t);
        slotRegs(w, slotFor(2, 3), { mul: 1, dt1, tl: 4, ar: 31, d1r: 4, d2r: 2, d1l: 6, rr: 8 });
        keyOn(w, 2, 0b1111);
        w.advance(4 * SETTLE);
        keyOn(w, 2, 0);
        t = w.now() + SETTLE;
      }
      for (let mul = 0; mul < 16; mul++) {
        w.at(t);
        slotRegs(w, slotFor(2, 3), { mul, dt1: 0, tl: 4, ar: 31, d1r: 4, d2r: 2, d1l: 6, rr: 8 });
        keyOn(w, 2, 0b1111);
        w.advance(4 * SETTLE);
        keyOn(w, 2, 0);
        t = w.now() + SETTLE;
      }
      return w.writes;
    },
  },
  {
    name: 'envelope',
    notes: 'Channel 3, CONNECT 7, one operator through the envelope corners: AR 31/8/1, D1R/D2R/RR spanning slow to fast, D1L spanning shallow to deep, TL 0 and 96 - each combination keyed on long enough to move through attack into decay.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 3, { connect: 7, kc: 0x4c }, {});
      const corners = [
        { ar: 31, d1r: 20, d2r: 5, d1l: 2, rr: 12, tl: 0 },
        { ar: 8, d1r: 10, d2r: 2, d1l: 8, rr: 6, tl: 32 },
        { ar: 1, d1r: 1, d2r: 1, d1l: 15, rr: 1, tl: 96 },
      ];
      let t = w.now();
      for (const opRegs of corners) {
        w.at(t);
        slotRegs(w, slotFor(3, 3), { mul: 1, ...opRegs });
        keyOn(w, 3, 0b1111);
        w.advance(20 * SETTLE);
        keyOn(w, 3, 0);
        t = w.now() + 4 * SETTLE;
      }
      return w.writes;
    },
  },
  {
    name: 'lfo',
    notes: 'Channel 4, all four LFO waveforms (0x1b: saw, square, triangle, noise), a low and a high LFRQ, PMD and AMD both nonzero, PMS and AMS both nonzero on the channel - so pitch and amplitude modulation are both audible against every waveform.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 4, { connect: 7, pms: 5, ams: 2, kc: 0x4c }, { d1r: 2, d2r: 1, d1l: 2, rr: 6 });
      let t = w.now();
      for (let wave = 0; wave < 4; wave++) {
        for (const lfrq of [4, 120]) {
          w.at(t);
          w.reg(0x18, lfrq);
          w.advance(SETTLE);
          w.reg(0x19, 0x00 | 40); // PMD select (D7=0) = 40
          w.advance(SETTLE);
          w.reg(0x19, 0x80 | 40); // AMD select (D7=1) = 40
          w.advance(SETTLE);
          w.reg(0x1b, wave & 3);
          w.advance(SETTLE);
          keyOn(w, 4, 0b1111);
          w.advance(10 * SETTLE);
          keyOn(w, 4, 0);
          t = w.now() + 2 * SETTLE;
        }
      }
      return w.writes;
    },
  },
  {
    name: 'noise',
    notes: 'Channel 7 op4 (C2), the only slot the noise generator can replace: NE off (a plain tone, as a control), then NE on at NFRQ 0 and NFRQ 31.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 7, { connect: 7, kc: 0x4c }, {});
      let t = w.now();
      for (const [ne, nfrq] of [[0, 0], [1, 0], [1, 31]]) {
        w.at(t);
        w.reg(0x0f, (ne << 7) | (nfrq & 31));
        w.advance(SETTLE);
        keyOn(w, 7, 0b1111);
        w.advance(6 * SETTLE);
        keyOn(w, 7, 0);
        t = w.now() + 2 * SETTLE;
      }
      return w.writes;
    },
  },
  {
    name: 'keyon-per-operator',
    notes: 'Channel 5, CONNECT 7 (every operator directly in the mix): each of the four operators keyed on alone, then all four together, then released one at a time - proving the per-operator bits of register 0x08 gate independently.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 5, { connect: 7, kc: 0x4c }, {});
      let t = w.now();
      for (let op = 0; op < 4; op++) {
        w.at(t);
        keyOn(w, 5, 1 << op);
        w.advance(4 * SETTLE);
        keyOn(w, 5, 0);
        t = w.now() + 2 * SETTLE;
      }
      w.at(t);
      keyOn(w, 5, 0b1111);
      w.advance(4 * SETTLE);
      for (let op = 0; op < 4; op++) {
        keyOn(w, 5, 0b1111 & ~(1 << op));
        w.advance(2 * SETTLE);
      }
      return w.writes;
    },
  },
  {
    name: 'timers-csm',
    notes: 'Channel 6: Timer A loaded short, IRQEN and LOAD set, then CSM (0x14 bit 7) turned on with the channel\'s operators otherwise configured normally - CSM key-ons the channel itself on every Timer A overflow, audible as a repeating attack with no register 0x08 write.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 6, { connect: 7, kc: 0x4c }, { ar: 31, d1r: 20, d2r: 4, d1l: 8, rr: 10 });
      let t = w.now();
      w.at(t);
      w.reg(0x10, 0x03); // Timer A, high 8 bits
      w.advance(SETTLE);
      w.reg(0x11, 0x02); // Timer A, low 2 bits
      w.advance(SETTLE);
      w.reg(0x14, 0x03); // LOAD | IRQEN(A), CSM off - starts the timer
      w.advance(20 * SETTLE);
      w.reg(0x14, 0x83); // CSM on, same timer bits
      w.advance(60 * SETTLE);
      w.reg(0x14, 0x00); // CSM and timers off
      return w.writes;
    },
  },
  {
    name: 'stereo',
    notes: 'Two channels, one per side: channel 0 RL = left only (0x40 in the top two bits of 0x20), channel 1 RL = right only (0x80), then both switched to the other side and finally both off - stereo audible on the L/R change alone, register values otherwise identical.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 0, { rl: 1, connect: 7, kc: 0x30 }, {});
      defaultChannel(w, 1, { rl: 2, connect: 7, kc: 0x54 }, {});
      let t = w.now();
      w.at(t);
      keyOn(w, 0, 0b1111);
      keyOn(w, 1, 0b1111);
      w.advance(8 * SETTLE);
      w.reg(0x20, (2 << 6)); // channel 0: right only now
      w.advance(SETTLE);
      w.reg(0x21, (1 << 6)); // channel 1: left only now
      w.advance(8 * SETTLE);
      w.reg(0x20, 0); // channel 0: both off
      w.advance(SETTLE);
      w.reg(0x21, 0); // channel 1: both off
      w.advance(4 * SETTLE);
      keyOn(w, 0, 0);
      keyOn(w, 1, 0);
      return w.writes;
    },
  },
];

const EDGE_SCRIPTS = [
  {
    name: 'key-on-while-releasing',
    notes: 'Channel 0, one operator: keyed on, keyed off partway through decay (entering release), then keyed back on again while still in release, before it has reached silence - the envelope generator\'s restart-from-release path.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 0, { connect: 7, kc: 0x4c }, { ar: 25, d1r: 15, d2r: 4, d1l: 6, rr: 4 });
      let t = w.now();
      w.at(t);
      keyOn(w, 0, 0b1111);
      w.advance(6 * SETTLE);
      keyOn(w, 0, 0); // into release
      w.advance(3 * SETTLE); // still releasing, not yet silent
      keyOn(w, 0, 0b1111); // key back on mid-release
      w.advance(10 * SETTLE);
      keyOn(w, 0, 0);
      return w.writes;
    },
  },
  {
    name: 'tl-ar-extremes',
    notes: 'Channel 1, one operator, the four corners of TL x AR: TL 127 (maximum attenuation, at the edge of silence) with AR 31 (fastest attack), and TL 0 (no attenuation) with AR 0 (an attack so slow it barely moves in this log\'s span) - the two extremes most likely to expose an off-by-one at either table\'s edge.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 1, { connect: 7, kc: 0x4c }, {});
      let t = w.now();
      for (const [tl, ar] of [[127, 31], [0, 0]]) {
        w.at(t);
        slotRegs(w, slotFor(1, 3), { mul: 1, tl, ar, d1r: 8, d2r: 2, d1l: 6, rr: 8 });
        keyOn(w, 1, 0b1111);
        w.advance(10 * SETTLE);
        keyOn(w, 1, 0);
        t = w.now() + 2 * SETTLE;
      }
      return w.writes;
    },
  },
  {
    name: 'dt2-mul-zero',
    notes: 'Channel 2, one operator: DT2 (the LFO-independent detune, values 0-3) stepped at MUL 0 - the "times 0.5" path (`inc = basefreq >> 1` in `OPM_PhaseCalcIncrement` when `multi` is 0), which interacts with DT2\'s own frequency-number shift ahead of it in a way a MUL >= 1 script never reaches.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 2, { connect: 7, kc: 0x4c }, {});
      let t = w.now();
      for (let dt2 = 0; dt2 < 4; dt2++) {
        w.at(t);
        slotRegs(w, slotFor(2, 3), { mul: 0, dt2, tl: 4, ar: 31, d1r: 4, d2r: 2, d1l: 6, rr: 8 });
        keyOn(w, 2, 0b1111);
        w.advance(6 * SETTLE);
        keyOn(w, 2, 0);
        t = w.now() + 2 * SETTLE;
      }
      return w.writes;
    },
  },
  {
    name: 'lfo-test-reset',
    notes: 'The test register (0x01), whose D1 bit resets the LFO\'s own free-running counter (`OPM_DoRegWrite`\'s `mode_test[1]` path): the LFO is left running for a while, the test bit is set then cleared, and channel 3 (LFO depth turned up) is keyed on around the reset so the phase discontinuity is in the trace.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 3, { connect: 7, pms: 6, ams: 3, kc: 0x4c }, { d1r: 2, d2r: 1, d1l: 2, rr: 6 });
      let t = w.now();
      w.at(t);
      w.reg(0x18, 60); // LFRQ
      w.advance(SETTLE);
      w.reg(0x19, 0x00 | 90); // PMD
      w.advance(SETTLE);
      w.reg(0x19, 0x80 | 90); // AMD
      w.advance(SETTLE);
      w.reg(0x1b, 2); // triangle
      w.advance(SETTLE);
      keyOn(w, 3, 0b1111);
      w.advance(20 * SETTLE); // let the LFO run a while, unreset
      w.reg(0x01, 0x02); // test bit D1: reset the LFO counter
      w.advance(SETTLE);
      w.reg(0x01, 0x00); // release the reset, LFO free-runs again
      w.advance(20 * SETTLE);
      keyOn(w, 3, 0);
      return w.writes;
    },
  },
  {
    name: 'noise-nfrq-sweep',
    notes: 'Channel 7 op4, NE held on, NFRQ stepped through every value 0-31 - the full range, not just the two corners `core/noise` already covers.',
    writes: () => {
      const w = writer();
      defaultChannel(w, 7, { connect: 7, kc: 0x4c }, {});
      let t = w.now();
      for (let nfrq = 0; nfrq < 32; nfrq++) {
        w.at(t);
        w.reg(0x0f, 0x80 | nfrq);
        w.advance(SETTLE);
        keyOn(w, 7, 0b1111);
        w.advance(3 * SETTLE);
        keyOn(w, 7, 0);
        t = w.now() + SETTLE;
      }
      return w.writes;
    },
  },
  {
    name: 'write-clobber',
    notes: 'The settling-time behaviour this file\'s own header comment describes, deliberately triggered rather than avoided: two address/data register writes back to back on the very same VGM sample (zero native cycles apart, nowhere near the up-to-64-cycle settling window the first one would need) - so the first write (AR on op C2 of channel 4) is silently dropped and only the second (a harmless RL/FB/CONNECT write to channel 0) lands, per `reg_data_ready = reg_data_ready && !write_a_en` in the vendored `opm.c`. Both oracles model this the same way it happens on real silicon, since it falls out of the two-port protocol itself rather than being a special case either emulator added - a divergence here would mean one of them added special-case handling nuked-opm.c does not have. `packages/conform/src/vgm.mjs`\'s decoder now spaces every other command a full `YM2151_SETTLE_CYCLES` apart by default specifically so a real capture\'s own zero-wait runs do not lose a write this way by accident - so this probe alone asks for the old, narrow `settleCycles: 4` explicitly (see `vgmToWrites`\'s `settleCycles` option) to keep triggering the drop on purpose.',
    settleCycles: 4,
    writes: () => {
      const w = writer();
      defaultChannel(w, 4, { connect: 7, kc: 0x4c }, {});
      defaultChannel(w, 0, { connect: 0, kc: 0x30 }, {});
      let t = w.now();
      w.at(t);
      // Clobbered: this AR write's data half never latches.
      w.reg(0x80 | slotFor(4, 3), 31);
      w.reg(0x20, (3 << 6) | (2 << 3) | 1); // same sample: clears reg_data_ready before the AR write above can land
      w.advance(SETTLE);
      keyOn(w, 4, 0b1111);
      keyOn(w, 0, 0b1111);
      w.advance(8 * SETTLE);
      keyOn(w, 4, 0);
      keyOn(w, 0, 0);
      return w.writes;
    },
  },
];

function writeScript(dir, { name, notes, writes, settleCycles }) {
  fs.mkdirSync(path.join(dir, 'source'), { recursive: true });
  const all = writes();
  const last = all.reduce((m, w) => Math.max(m, w.at), 0);
  const cycles = last + 8 * SETTLE;
  const bytes = buildYm2151Vgm(all, cycles, {
    title: `chipvoice YM2151 probe: ${name}`,
    notes: `${notes} Self-authored, CC0, generated by ${GENERATOR}. No external material.`,
  });
  const vgmPath = path.join(dir, 'source', `${name}.vgm`);
  fs.writeFileSync(vgmPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const filename = `source/${name}.vgm`;
  const entry = { chip: 'ym2151', filename, source: GENERATOR, licence: 'CC0-1.0 (chipvoice project; self-generated, no external material)', sha256, note: notes };
  const next = [...manifest.filter((e) => e.filename !== filename), entry].sort((a, b) => a.filename.localeCompare(b.filename));
  fs.writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n');

  const decoded = vgmToWrites(bytes, 'ym2151', settleCycles !== undefined ? { settleCycles } : undefined);
  const text = formatLog(
    {
      name,
      chip: 'ym2151',
      clock: decoded.clock,
      cycles: decoded.cycles,
      source: `${filename}, decoded by packages/conform/src/vgm.mjs`,
      notes: `${notes} Self-authored, CC0; see manifest.json.`,
    },
    decoded.writes,
  );
  fs.writeFileSync(path.join(dir, `${name}.log`), text);
  console.log(`${path.basename(dir).padEnd(6)} ${name.padEnd(24)} ${String(decoded.writes.length).padStart(5)} writes, ${(decoded.cycles / decoded.clock).toFixed(2)} s, sha256 ${sha256.slice(0, 16)}`);
}

for (const script of CORE_SCRIPTS) writeScript(CORE_OUT, script);
for (const script of EDGE_SCRIPTS) writeScript(EDGE_OUT, script);
