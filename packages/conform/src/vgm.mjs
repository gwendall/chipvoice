import zlib from 'node:zlib';

/**
 * A VGM file, read into a register log.
 *
 * VGM is the chiptune world's exchange format: a log of register writes with
 * waits between them, in samples at 44100 Hz, for some fifty chips. Any NES
 * VGM - a rip of a real game, an export from a tracker, a file this package
 * wrote - is corpus material once its writes are on the 2A03's clock. The
 * rounding on the way in is the format's, not ours: a sample is about forty
 * cycles, and the file does not say where inside it the write fell.
 *
 * Only the NES APU's commands are kept. Everything else in the file is
 * stepped over by its length, so a file with a second chip in it still
 * yields the NES's part.
 */
const CPU_HZ = 1789773;
const SAMPLE_RATE = 44100;

/** @param {Uint8Array} bytes a .vgm, or a .vgz (gzipped) */
export function vgmToWrites(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(zlib.gunzipSync(bytes));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'Vgm ') throw new Error('not a VGM file');
  const version = view.getUint32(0x08, true);
  const totalSamples = view.getUint32(0x18, true);
  const dataOffset = version >= 0x150 ? 0x34 + view.getUint32(0x34, true) : 0x40;
  const clock = version >= 0x161 && dataOffset > 0x84 ? view.getUint32(0x84, true) : 0;
  if (!clock) throw new Error('no NES APU in this file');
  const loopOffset = view.getUint32(0x1c, true) ? 0x1c + view.getUint32(0x1c, true) : -1;

  const cycles = (sample) => Math.round((sample * CPU_HZ) / SAMPLE_RATE);
  const writes = [];
  let sample = 0;
  let loopAtCycle = -1;
  let at = dataOffset;
  while (at < bytes.length) {
    if (at === loopOffset) loopAtCycle = cycles(sample);
    const op = bytes[at];
    if (op === 0xb4) {
      const reg = bytes[at + 1];
      // Registers above $1F are the format's own, for sample RAM.
      if (reg <= 0x1f) writes.push({ at: cycles(sample), addr: 0x4000 + reg, value: bytes[at + 2] });
      at += 3;
    } else if (op === 0x61) {
      sample += bytes[at + 1] | (bytes[at + 2] << 8);
      at += 3;
    } else if (op === 0x62) { sample += 735; at += 1; }
    else if (op === 0x63) { sample += 882; at += 1; }
    else if (op >= 0x70 && op <= 0x7f) { sample += op - 0x70 + 1; at += 1; }
    else if (op === 0x66) break;
    else if (op === 0x67) {
      // A data block: 0x67 0x66 tt ss ss ss ss, then ss bytes.
      at += 7 + view.getUint32(at + 3, true);
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
  return { writes, cycles: cycles(totalSamples), loopAtCycle, clock };
}
