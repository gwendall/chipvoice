import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

/**
 * Generates this corpus's two fixture files: tiny, self-authored PSID tunes
 * (public domain, dedicated by their author to this ticket - not HVSC or any
 * other rip), each purpose-built to put one question to both chipvoice's own
 * `importPsid` and the libsidplayfp oracle (`native-oracle.mjs`) at once,
 * rather than relying on a found-in-the-wild tune's own incidental behaviour.
 *
 * `convention-probe`: INIT stores A, X, Y and the pulled processor status
 * straight to four SID registers, once, before doing anything else - the
 * calling convention itself, read back as a write-stream instead of inferred
 * from the file format document's prose.
 *
 * `frame-rate-probe`: INIT writes a start marker, then PLAY increments one
 * register every call for many frames - PLAY's own cadence (whether it is
 * called once a frame, at the tune's declared speed, cycle-accurately)
 * rather than INIT's argument registers.
 *
 * Run once; the output is committed (`files/*.sid`) like any other corpus
 * fixture, so this script is documentation of how they were made, not a
 * build step.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.join(HERE, 'files');

function u16be(n) { return [(n >> 8) & 0xff, n & 0xff]; }
function u32be(n) { return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]; }
function ascii32(s) { const b = Array.from(s).map((c) => c.charCodeAt(0)); while (b.length < 32) b.push(0); return b.slice(0, 32); }

/** A minimal PSID v2 header (`dataOffset` 0x7c), flags: PAL (bits 2-3 = 01),
 * MOS6581 (bits 4-5 = 01) - the file format's own bit layout, matching
 * `psid-import.ts`'s `clockFor`/`modelFor`. */
function psidHeader({ loadAddress, initAddress, playAddress, name }) {
  const bytes = [];
  bytes.push(...Array.from('PSID').map((c) => c.charCodeAt(0)));
  bytes.push(...u16be(2)); // version
  bytes.push(...u16be(0x7c)); // dataOffset
  bytes.push(...u16be(loadAddress));
  bytes.push(...u16be(initAddress));
  bytes.push(...u16be(playAddress));
  bytes.push(...u16be(1)); // songs
  bytes.push(...u16be(1)); // startSong
  bytes.push(...u32be(0)); // speed: bit 0 = 0, VIC-driven (50 Hz), for song 1
  bytes.push(...ascii32(name));
  bytes.push(...ascii32('chipvoice project'));
  bytes.push(...ascii32('2026 gwendall, CC0'));
  bytes.push(...u16be(0x14)); // flags: PAL, MOS6581
  bytes.push(0, 0); // startPage, pageLength: no hint
  bytes.push(0, 0); // secondSIDAddress, thirdSIDAddress: none
  if (bytes.length !== 0x7c) throw new Error(`header is ${bytes.length} bytes, expected 0x7c`);
  return Uint8Array.from(bytes);
}

function buildSid({ name, loadAddress, initAddress, playAddress, program }) {
  const header = psidHeader({ loadAddress, initAddress, playAddress, name });
  return Uint8Array.from([...header, ...program]);
}

const conventionProbe = buildSid({
  name: 'convention-probe',
  loadAddress: 0x1000, initAddress: 0x1000, playAddress: 0x1010,
  program: [
    // INIT @ $1000: record A, X, Y and P (via PHP/PLA) to $D400-$D403, once.
    0x8d, 0x00, 0xd4, // STA $D400
    0x8e, 0x01, 0xd4, // STX $D401
    0x8c, 0x02, 0xd4, // STY $D402
    0x08,             // PHP
    0x68,             // PLA
    0x8d, 0x03, 0xd4, // STA $D403
    0x60,             // RTS  ($100f)
    0xea,             // NOP padding to $1010
    // PLAY @ $1010: count calls into $D404, via a zero-page RAM counter
    // rather than `INC $D404` directly. A SID register INIT never touched
    // is write-only in a way real hardware approximates as "reads back
    // whatever byte was last driven on the whole chip's data bus, not just
    // this register's own last write" - chipvoice's own PsidEnvironment
    // models exactly that (one shared `sidBus` latch), but this fixture's
    // own oracle harness (`sidplayfp-harness.cpp`'s `TraceSid`) is a plain
    // per-register shadow instead, a simplification that would make an
    // `INC` on an untouched register read back two different values on the
    // two sides - a real difference in a passive C++ logger's own
    // fidelity, not a finding about INIT/PLAY's calling convention or
    // cycle timing, which is all this fixture means to isolate. Routing
    // the counter through plain RAM ($02, never a SID address) sidesteps
    // that entirely: both sides agree on every value, unconditionally.
    0xe6, 0x02,       // INC $02
    0xa5, 0x02,       // LDA $02
    0x8d, 0x04, 0xd4, // STA $D404
    0x60,             // RTS
  ],
});

const frameRateProbe = buildSid({
  name: 'frame-rate-probe',
  loadAddress: 0x1000, initAddress: 0x1000, playAddress: 0x1010,
  program: [
    // INIT @ $1000: a start marker ($D418 = $0F), then $D400 = 0.
    0xa9, 0x0f,       // LDA #$0F
    0x8d, 0x18, 0xd4, // STA $D418
    0xa9, 0x00,       // LDA #$00
    0x8d, 0x00, 0xd4, // STA $D400
    0x60,             // RTS  ($100b)
    0xea, 0xea, 0xea, 0xea, 0xea, // NOP padding to $1010
    // PLAY @ $1010: a deterministic per-frame ramp.
    0xee, 0x00, 0xd4, // INC $D400
    0x60,             // RTS
  ],
});

async function main() {
  await fs.promises.mkdir(FILES_DIR, { recursive: true });
  for (const [file, bytes] of [['convention-probe.sid', conventionProbe], ['frame-rate-probe.sid', frameRateProbe]]) {
    const target = path.join(FILES_DIR, file);
    await fs.promises.writeFile(target, bytes);
    console.log(`${file}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
  }
}

main();
