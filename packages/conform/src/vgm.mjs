import zlib from 'node:zlib';

/**
 * A VGM file, read into a register log.
 *
 * VGM is the chiptune world's exchange format: a log of register writes with
 * waits between them, in samples at 44100 Hz, for some fifty chips. Any NES
 * or Game Boy VGM - a rip of a real game, an export from a tracker, a file
 * this package wrote - is corpus material once its writes are on that
 * chip's own clock. The rounding on the way in is the format's, not ours: a
 * sample is about forty NES cycles (about twenty-three Game Boy cycles), and
 * the file does not say where inside it the write fell.
 *
 * Only the requested chip's own commands are kept. Everything else in the
 * file is stepped over by its length, so a file with a second chip in it
 * still yields that chip's part - this harness measures a score, it does
 * not claim to be a faithful player of every chip in a VGM the way
 * `chipvoice`'s own `importVgm` does.
 */
const SAMPLE_RATE = 44100;
const CHIPS = {
  '2a03': { hz: 1789773, offset: 0x84, command: 0xb4, base: 0x4000, last: 0x1f },
  dmg: { hz: 4194304, offset: 0x80, command: 0xb3, base: 0xff10, last: 0x2f },
};

/**
 * The YM2151's own VGM command, 0x54 `aa dd`: one register write, not an
 * address inside some larger memory-mapped range the way `2a03`/`dmg`'s
 * commands are - so unlike those two, `ym2151` is not in `CHIPS` above and
 * is handled directly in `vgmToWrites` below. Each command becomes two
 * register-log writes, address port then data port, matching `Ym2151.write`'s
 * own two-port protocol (`packages/chipvoice/src/chips/ym2151.ts`) - `addr`
 * 0 for the first, 1 for the second, the convention `oracles/nuked-opm/main.cpp`
 * and `chips/ym2151.mjs` both read.
 *
 * Two gaps, two different bugs. `YM2151_ADDR_DATA_GAP` (native cycles)
 * separates one command's own address write from its data write: both
 * engines that read this log drive the chip by draining every write whose
 * cycle has come due and only then calling one `clock()`/`OPM_Clock()` for
 * that cycle (`chips/ym2151.mjs`, `oracles/nuked-opm/main.cpp`); the chip's
 * own write path (`Ym2151.write`/`OPM_Write`) latches the byte into a
 * single `write_data` field shared by the address and data ports, only
 * sorted out on the next `clock()`. Two writes close enough to land in the
 * same `clock()` batch are both applied before that `clock()` ever runs, so
 * the data byte overwrites `write_data` before the address byte was ever
 * latched - the address-port write is lost (this is what a real CPU driving
 * the chip never does: writing the address port and the data port is two
 * separate bus cycles, never one). Two native cycles is already enough to
 * land address and data in different batches at `OPM_Clock`'s own
 * one-call-per-two-cycles rate; `YM2151_ADDR_DATA_GAP` doubles that for
 * margin.
 *
 * `YM2151_SETTLE_CYCLES` separates one command's data write from the next
 * command's address write - a different, larger window, empirically
 * confirmed (not guessed) against the vendored `opm.c` itself: a register
 * write is not applied to its channel/slot the instant the data write
 * lands, only once the internal 32-tick pipeline sweeps back around to that
 * register's own channel/slot index, and a new address-port write before
 * that happens cancels the pending one (`reg_data_ready = reg_data_ready &&
 * !write_a_en`, unconditional, in the vendored `opm.c`). Sweeping every one
 * of the 32 slots against every phase of that 32-tick/64-native-cycle
 * pipeline (writing a slot's TL, then an unrelated channel's register after
 * a candidate gap, then reading the TL back) found a worst case of exactly
 * 64 native cycles - the same figure `packages/conform/src/corpus/generate-ym2151.mjs`'s
 * own module comment already cites for the same mechanism. Below that, a
 * real capture with two 0x54 commands close together (a dense run of
 * zero-wait writes is normal - most drivers issue several register writes
 * per frame with no VGM wait between them) would silently lose the earlier
 * write, the way the real chip does when a driver does not poll busy - not
 * a bug in the decoder producing a wrong value, but silent, untraceable
 * data loss on import.
 *
 * `settleCycles` lets a caller ask for a narrower gap than the default
 * safe one - only `packages/conform/src/corpus/generate-ym2151.mjs`'s
 * `edge/write-clobber` probe does, deliberately, to keep exercising this
 * exact drop on purpose once the decoder's own default stopped causing it
 * by accident.
 */
const YM2151_COMMAND = 0x54;
const YM2151_CLOCK_OFFSET = 0x30;
const YM2151_ADDR_DATA_GAP = 4;
/** See the module doc comment above `YM2151_COMMAND`: the empirically-confirmed worst case is exactly 64. */
const YM2151_SETTLE_CYCLES = 64;

/**
 * @param {Uint8Array} bytes a .vgm, or a .vgz (gzipped)
 * @param {'2a03'|'dmg'|'ym2151'} chip which machine's commands to keep
 * @param {{ settleCycles?: number }} [options] `ym2151` only - see the module
 *   doc comment above `YM2151_COMMAND`. Defaults to `YM2151_SETTLE_CYCLES`.
 */
export function vgmToWrites(bytes, chip = '2a03', options) {
  if (chip === 'ym2151') return ym2151VgmToWrites(bytes, options);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(zlib.gunzipSync(bytes));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'Vgm ') throw new Error('not a VGM file');
  const version = view.getUint32(0x08, true);
  const totalSamples = view.getUint32(0x18, true);
  const dataOffset = version >= 0x150 ? 0x34 + view.getUint32(0x34, true) : 0x40;
  const spec = CHIPS[chip];
  if (!spec) throw new Error(`unsupported chip ${chip}`);
  const clock = version >= 0x161 && dataOffset > spec.offset ? view.getUint32(spec.offset, true) : 0;
  if (!clock) throw new Error(`no ${chip === '2a03' ? 'NES APU' : 'Game Boy DMG'} in this file`);
  const loopOffset = view.getUint32(0x1c, true) ? 0x1c + view.getUint32(0x1c, true) : -1;

  const cycles = (sample) => Math.round((sample * spec.hz) / SAMPLE_RATE);
  const writes = [];
  const memory = [];
  let sample = 0;
  let loopAtCycle = -1;
  let at = dataOffset;
  while (at < bytes.length) {
    if (at === loopOffset) loopAtCycle = cycles(sample);
    const op = bytes[at];
    if (op === spec.command) {
      const reg = bytes[at + 1];
      // A register past the chip's own range is the format's, for a second
      // chip or (on the NES) the Famicom Disk System; not this chip's part.
      if (reg <= spec.last) writes.push({ at: cycles(sample), addr: spec.base + reg, value: bytes[at + 2] });
      at += 3;
    } else if (op === 0x61) {
      sample += bytes[at + 1] | (bytes[at + 2] << 8);
      at += 3;
    } else if (op === 0x62) { sample += 735; at += 1; }
    else if (op === 0x63) { sample += 882; at += 1; }
    else if (op >= 0x70 && op <= 0x7f) { sample += op - 0x70 + 1; at += 1; }
    else if (op === 0x66) break;
    else if (op === 0x67) {
      // A data block: 0x67 0x66 tt ss ss ss ss, then ss bytes. Type 0xC2 is
      // "NES APU RAM write": a 16-bit address, then the rest is data for it -
      // the DMC's DPCM samples, delivered the same way `importVgm` reads them.
      const type = bytes[at + 2];
      const length = view.getUint32(at + 3, true);
      if (chip === '2a03' && type === 0xc2 && length >= 2) {
        memory.push({ address: bytes[at + 7] | (bytes[at + 8] << 8), bytes: bytes.slice(at + 9, at + 7 + length) });
      }
      at += 7 + length;
    } else if (op >= 0x80 && op <= 0x8f) { sample += op - 0x80; at += 1; }
    else if (op === 0x4f || op === 0x50) at += 2;
    else if (op >= 0x51 && op <= 0x5f) at += 3;
    else if (op >= 0xa0 && op <= 0xbf) at += 3;
    else if (op >= 0xc0 && op <= 0xdf) at += 4;
    else if (op >= 0xe0 && op <= 0xff) at += 5;
    else if (op === 0x90 || op === 0x91) at += 5;
    else if (op === 0x92) at += 6;
    else if (op === 0x93) at += 11;
    else if (op === 0x94) at += 2;
    else if (op === 0x95) at += 5;
    else if (op >= 0x30 && op <= 0x3f) at += 2;
    else if (op >= 0x40 && op <= 0x4e) at += version >= 0x160 ? 3 : 2;
    else throw new Error(`unknown VGM command $${op.toString(16)} at ${at}`);
  }
  return { writes, cycles: cycles(totalSamples), loopAtCycle, clock, memory };
}

/**
 * The YM2151's own walk of the command stream: `0x54 aa dd` is one register
 * write, not an address inside some chip's larger memory-mapped range, so
 * it does not fit `CHIPS`' `{offset, command, base, last}` shape above and
 * is walked separately here. Every other command is stepped over by its
 * length, the same as the main loop; an unmodeled one throws by name
 * (`docs/DECISIONS.md`'s decision 44) rather than being silently skipped.
 *
 * @param {{ settleCycles?: number }} [options]
 */
function ym2151VgmToWrites(bytes, { settleCycles = YM2151_SETTLE_CYCLES } = {}) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(zlib.gunzipSync(bytes));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'Vgm ') throw new Error('not a VGM file');
  const version = view.getUint32(0x08, true);
  const totalSamples = view.getUint32(0x18, true);
  const dataOffset = version >= 0x150 ? 0x34 + view.getUint32(0x34, true) : 0x40;
  const clock = version >= 0x161 && dataOffset > YM2151_CLOCK_OFFSET ? view.getUint32(YM2151_CLOCK_OFFSET, true) : 0;
  if (!clock) throw new Error('no YM2151 in this file');
  const loopOffset = view.getUint32(0x1c, true) ? 0x1c + view.getUint32(0x1c, true) : -1;

  const cycles = (sample) => Math.round((sample * clock) / SAMPLE_RATE);
  const writes = [];
  let sample = 0;
  let loopAtCycle = -1;
  let at = dataOffset;
  // The next cycle a command's address-port write may land on, so back-to-back
  // commands (no VGM wait between them) still get `settleCycles` apart from
  // each other, not just `YM2151_ADDR_DATA_GAP` apart from their own
  // data-port write - see the module doc comment above `YM2151_COMMAND`.
  let nextAddrCycle = 0;
  while (at < bytes.length) {
    if (at === loopOffset) loopAtCycle = cycles(sample);
    const op = bytes[at];
    if (op === YM2151_COMMAND) {
      const addrCycle = Math.max(cycles(sample), nextAddrCycle);
      const dataCycle = addrCycle + YM2151_ADDR_DATA_GAP;
      writes.push({ at: addrCycle, addr: 0, value: bytes[at + 1] });
      writes.push({ at: dataCycle, addr: 1, value: bytes[at + 2] });
      nextAddrCycle = dataCycle + settleCycles;
      at += 3;
    } else if (op === 0x61) {
      sample += bytes[at + 1] | (bytes[at + 2] << 8);
      at += 3;
    } else if (op === 0x62) { sample += 735; at += 1; }
    else if (op === 0x63) { sample += 882; at += 1; }
    else if (op >= 0x70 && op <= 0x7f) { sample += op - 0x70 + 1; at += 1; }
    else if (op === 0x66) break;
    else if (op === 0x67) {
      const length = view.getUint32(at + 3, true);
      at += 7 + length;
    } else if (op >= 0x80 && op <= 0x8f) { sample += op - 0x80; at += 1; }
    else if (op === 0x4f || op === 0x50) at += 2;
    else if (op >= 0x51 && op <= 0x5f) at += 3;
    else if (op >= 0xa0 && op <= 0xbf) at += 3;
    else if (op >= 0xc0 && op <= 0xdf) at += 4;
    else if (op >= 0xe0 && op <= 0xff) at += 5;
    else if (op === 0x90 || op === 0x91) at += 5;
    else if (op === 0x92) at += 6;
    else if (op === 0x93) at += 11;
    else if (op === 0x94) at += 2;
    else if (op === 0x95) at += 5;
    else if (op >= 0x30 && op <= 0x3f) at += 2;
    else if (op >= 0x40 && op <= 0x4e) at += version >= 0x160 ? 3 : 2;
    else throw new Error(`unknown VGM command $${op.toString(16)} at ${at}`);
  }
  // `Math.max` against `nextAddrCycle`: a dense run of zero-wait commands at
  // the very end of the file can push the last data-port write past the
  // sample-derived total, and a driver that stops at `cycles` would drop it.
  return { writes, cycles: Math.max(cycles(totalSamples), nextAddrCycle), loopAtCycle, clock, memory: [] };
}
