/** Stored ZIP entries (no compression), for small, bounded audio bundles.
 * PKWARE APPNOTE 4.3.7/4.3.12/4.3.16:
 * https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT */
export function zip(files: { name: string; bytes: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const entries = files.map(file => ({ ...file, nameBytes: encoder.encode(file.name) }));
  const size = entries.reduce((n, file) => n + 76 + file.nameBytes.length * 2 + file.bytes.length, 22);
  if (entries.length >= 65535 || size >= 0xffffffff || entries.some(f => f.nameBytes.length > 65535)) throw new Error('Export bundle is too large.');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  let offset = 0;
  const central: { file: typeof entries[number]; at: number; crc: number }[] = [];
  for (const file of entries) {
    let crc = 0xffffffff;
    for (const byte of file.bytes) crc = (crc >>> 8) ^ CRC[(crc ^ byte) & 0xff];
    crc = (crc ^ 0xffffffff) >>> 0;
    central.push({ file, at: offset, crc });
    view.setUint32(offset, 0x04034b50, true); view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x800, true); view.setUint16(offset + 12, 0x21, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, file.bytes.length, true); view.setUint32(offset + 22, file.bytes.length, true);
    view.setUint16(offset + 26, file.nameBytes.length, true);
    bytes.set(file.nameBytes, offset + 30); offset += 30 + file.nameBytes.length;
    bytes.set(file.bytes, offset); offset += file.bytes.length;
  }
  const start = offset;
  for (const { file, at, crc } of central) {
    view.setUint32(offset, 0x02014b50, true); view.setUint16(offset + 4, 20, true); view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x800, true); view.setUint16(offset + 14, 0x21, true);
    view.setUint32(offset + 16, crc, true);
    view.setUint32(offset + 20, file.bytes.length, true); view.setUint32(offset + 24, file.bytes.length, true);
    view.setUint16(offset + 28, file.nameBytes.length, true); view.setUint32(offset + 42, at, true);
    bytes.set(file.nameBytes, offset + 46); offset += 46 + file.nameBytes.length;
  }
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, entries.length, true); view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, offset - start, true); view.setUint32(offset + 16, start, true);
  return bytes;
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
