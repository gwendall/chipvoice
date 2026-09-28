import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

/**
 * Generates this corpus's Sunsoft 5B fixture (NEXT-15, the same
 * self-authored-probe convention `make-vrc6-probe.mjs` established in round
 * 2 of NEXT-14): a tiny, hand-assembled NSF whose PLAY routine writes all
 * fourteen of the AY-3-8910/YM2149's sound registers (R0-R13; R14/R15, the
 * chip's I/O ports, are not audio and Game_Music_Emu's own Nes_Fme7_Apu does
 * not model them at all - `reg_count = 14` in its own state struct) every
 * frame, through the Sunsoft 5B's own two-port bus ($C000 selects a
 * register, $E000 writes it), with values that change frame to frame so a
 * comparator has real content to line up.
 *
 * Every other file in `sources.json` is a real, independently authored,
 * redistribution-licensed NSF, and every one of them is 2A03-only or, since
 * round 2 of NEXT-14, VRC6 (`vrc6-probe`) - no Sunsoft 5B NSF this project
 * found carries a licence this corpus's own convention requires. This file
 * closes that gap the same way: a purpose-built probe (CC0, dedicated by its
 * author to this ticket) that puts one question to the whole pipeline at
 * once - `capture-nsf.mjs`'s own routing of a real 5B NSF's writes (this
 * corpus's own reason to exist), `exportNsf`'s round-trip of that capture
 * (`nsf-export`'s corpus, which reads this same `sources.json` and so
 * replays this file too, no separate wiring needed), and, with
 * `scores/arrangements/native-oracle.py` now patching `Nsf_Emu.cpp` itself
 * (not `Nes_Fme7_Apu.cpp` - see that script's own comment for why),
 * Game_Music_Emu's own NSF player, `Nsf_Emu`, actually playing a 5B file and
 * being held to the exact same command and frame-write gates as any 2A03 or
 * VRC6 file here - not just the register-level `Ay8910`/`Ay_Apu` oracles
 * `packages/conform` already drives directly.
 *
 * Run once; the output is committed (`files/sunsoft5b-probe.nsf`) like any
 * other corpus fixture, so this script is documentation of how it was made,
 * not a build step.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.join(HERE, 'files');

function asciiField(bytes, offset, length, text) {
  for (let i = 0; i < length; i++) bytes[offset + i] = i < text.length ? text.charCodeAt(i) : 0;
}

// INIT @ $8000: zero the frame counter ($00, plain RAM, never a 5B address -
// the same choice make-vrc6-probe.mjs and the psid-corpus probes make, for
// the same reason: an oracle's own passive register logger need not agree
// with this project's on the readback value of a write-only register, only
// on what was written, and routing the counter through RAM sidesteps that
// entirely).
const init = [
  0xa9, 0x00, // LDA #$00
  0x85, 0x00, // STA $00
  0x60,       // RTS
];

// PLAY @ $8000 + init.length: one write to every one of the 5B's fourteen
// sound registers, each a $C000 (select) / $E000 (data) pair, each value
// derived from the frame counter so consecutive frames differ. R14/R15 (the
// I/O ports) are out of scope, the same way VRC6's $9003/$A003/$B003 stay
// out of this ticket's probe - not audio, and, for R14/R15 specifically, not
// modelled by Game_Music_Emu's Nes_Fme7_Apu at all.
function regWrite(reg, valueOps) {
  return [
    0xa9, reg,         // LDA #<reg>
    0x8d, 0x00, 0xc0,  // STA $C000              ; select register
    ...valueOps,
    0x8d, 0x00, 0xe0,  // STA $E000              ; write it
  ];
}
const play = [
  0xe6, 0x00, // INC $00                          ; frame counter, wraps mod 256

  // R0/R1: channel A tone period (12 bits split fine/coarse)
  ...regWrite(0x00, [0xa5, 0x00]),                         // fine = counter
  ...regWrite(0x01, [0xa5, 0x00, 0x29, 0x0f]),              // coarse = counter & $0F

  // R2/R3: channel B tone period, counted the other way so it tracks
  // opposite channel A (the same trick make-vrc6-probe.mjs uses for pulse 2)
  ...regWrite(0x02, [0xa5, 0x00, 0x49, 0xff]),              // fine = counter EOR $FF
  ...regWrite(0x03, [0xa5, 0x00, 0x49, 0xff, 0x29, 0x0f]),  // coarse = (counter EOR $FF) & $0F

  // R4/R5: channel C tone period, a third derived value
  ...regWrite(0x04, [0xa5, 0x00, 0x29, 0x3f]),              // fine = counter & $3F
  ...regWrite(0x05, [0xa5, 0x00, 0x29, 0x0f]),              // coarse = counter & $0F

  // R6: noise period, 5 bits
  ...regWrite(0x06, [0xa5, 0x00, 0x29, 0x1f]),              // counter & $1F

  // R7: mixer (tone/noise enables, active-low, plus I/O direction bits this
  // probe never uses as I/O)
  ...regWrite(0x07, [0xa5, 0x00]),                          // counter, unmasked

  // R8/R9/R10: channel A/B/C volume and envelope mode (5 bits: 4-bit level
  // plus the M bit)
  ...regWrite(0x08, [0xa5, 0x00, 0x29, 0x1f]),              // counter & $1F
  ...regWrite(0x09, [0xa5, 0x00, 0x49, 0xff, 0x29, 0x1f]),  // (counter EOR $FF) & $1F
  ...regWrite(0x0a, [0xa5, 0x00, 0x29, 0x0f]),              // counter & $0F

  // R11/R12: envelope period (16 bits split fine/coarse)
  ...regWrite(0x0b, [0xa5, 0x00]),                          // fine = counter
  ...regWrite(0x0c, [0xa5, 0x00, 0x49, 0xff]),              // coarse = counter EOR $FF

  // R13: envelope shape (4 bits; a write here also restarts the envelope on
  // real hardware, which this probe exercises every frame on purpose)
  ...regWrite(0x0d, [0xa5, 0x00, 0x29, 0x0f]),              // counter & $0F

  0x60, // RTS
];

const LOAD_ADDR = 0x8000;
const INIT_ADDR = LOAD_ADDR;
const PLAY_ADDR = LOAD_ADDR + init.length;

// One 4 KiB PRG page, identity-mapped (every bankswitch byte left 0), the
// same shape make-vrc6-probe.mjs uses.
const PAGE_SIZE = 4096;
const file = new Uint8Array(128 + PAGE_SIZE);
const view = new DataView(file.buffer);
file.set([0x4e, 0x45, 0x53, 0x4d, 0x1a], 0); // "NESM" 0x1A
file[5] = 1; // version
file[6] = 1; // total songs
file[7] = 1; // starting song (1-based)
view.setUint16(8, LOAD_ADDR, true);
view.setUint16(10, INIT_ADDR, true);
view.setUint16(12, PLAY_ADDR, true);
asciiField(file, 14, 32, 'sunsoft5b-probe');
asciiField(file, 46, 32, 'gwendall, chipvoice project');
asciiField(file, 78, 32, 'CC0 2026');
view.setUint16(110, 16666, true); // standard NTSC $411a rate
// file[112..119] (bankswitch): left 0, identity-mapping the one PRG page
view.setUint16(120, 19997, true); // PAL speed, unused (NTSC-only below)
file[122] = 0; // NTSC only
file[123] = 0x20; // expansion sound chip bitfield, bit 5 = Sunsoft 5B
file.set(init, 128 + (INIT_ADDR - LOAD_ADDR));
file.set(play, 128 + (PLAY_ADDR - LOAD_ADDR));

async function main() {
  await fs.promises.mkdir(FILES_DIR, { recursive: true });
  const target = path.join(FILES_DIR, 'sunsoft5b-probe.nsf');
  await fs.promises.writeFile(target, file);
  console.log(`sunsoft5b-probe.nsf: ${file.length} bytes, sha256 ${createHash('sha256').update(file).digest('hex')}`);
}

main();
