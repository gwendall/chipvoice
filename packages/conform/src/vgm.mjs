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
 * @param {Uint8Array} bytes a .vgm, or a .vgz (gzipped)
 * @param {'2a03'|'dmg'} chip which machine's commands to keep
 */
export function vgmToWrites(bytes, chip = '2a03') {
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
