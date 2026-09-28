/**
 * A minimal ZIP writer: STORED entries only (no deflate), just enough for
 * `/api/v1/sounds/{id}.zip` and `/api/v1/packs/{id}.zip` to hand back every
 * variant/format plus a LICENSE file in one download. No zip library exists
 * anywhere in this monorepo, and the payload is already-compressed audio
 * (ogg/mp3), so STORED costs nothing real over DEFLATE while keeping this
 * file dependency-free and easy to verify byte for byte.
 *
 * Implements just PKZIP's classic (non-Zip64) local file header, central
 * directory record and end-of-central-directory record - fine for archives
 * well under the 4 GiB/65535-entry ceiling those 32-bit fields impose, which
 * every sound or pack download in this catalogue is.
 */

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS date/time packed the way ZIP's header expects: a fixed, arbitrary
 * timestamp, since a content-addressed archive's bytes should not depend on
 * wall-clock time (the same download built twice should hash the same). */
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

export interface ZipEntry {
  /** Forward-slash path inside the archive, e.g. "jump/jump-1.ogg". */
  name: string;
  data: Uint8Array;
}

function writeUint32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}
function writeUint16LE(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

/** Builds a complete .zip archive in memory from STORED entries. */
export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32LE(localView, 0, 0x04034b50);
    writeUint16LE(localView, 4, 20); // version needed
    writeUint16LE(localView, 6, 0); // flags
    writeUint16LE(localView, 8, 0); // method: stored
    writeUint16LE(localView, 10, DOS_TIME);
    writeUint16LE(localView, 12, DOS_DATE);
    writeUint32LE(localView, 14, crc);
    writeUint32LE(localView, 18, size);
    writeUint32LE(localView, 22, size);
    writeUint16LE(localView, 26, nameBytes.length);
    writeUint16LE(localView, 28, 0); // extra field length
    local.set(nameBytes, 30);

    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    writeUint32LE(centralView, 0, 0x02014b50);
    writeUint16LE(centralView, 4, 20); // version made by
    writeUint16LE(centralView, 6, 20); // version needed
    writeUint16LE(centralView, 8, 0); // flags
    writeUint16LE(centralView, 10, 0); // method: stored
    writeUint16LE(centralView, 12, DOS_TIME);
    writeUint16LE(centralView, 14, DOS_DATE);
    writeUint32LE(centralView, 16, crc);
    writeUint32LE(centralView, 20, size);
    writeUint32LE(centralView, 24, size);
    writeUint16LE(centralView, 28, nameBytes.length);
    writeUint16LE(centralView, 30, 0); // extra length
    writeUint16LE(centralView, 32, 0); // comment length
    writeUint16LE(centralView, 34, 0); // disk number start
    writeUint16LE(centralView, 36, 0); // internal attrs
    writeUint32LE(centralView, 38, 0); // external attrs
    writeUint32LE(centralView, 42, offset); // local header offset
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + entry.data.length;
  }

  const centralSize = centralParts.reduce((n, part) => n + part.length, 0);
  const centralOffset = offset;

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32LE(endView, 0, 0x06054b50);
  writeUint16LE(endView, 4, 0); // disk number
  writeUint16LE(endView, 6, 0); // disk with central dir
  writeUint16LE(endView, 8, entries.length);
  writeUint16LE(endView, 10, entries.length);
  writeUint32LE(endView, 12, centralSize);
  writeUint32LE(endView, 16, centralOffset);
  writeUint16LE(endView, 20, 0); // comment length

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}
