import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

/**
 * Generates this corpus's one self-authored file (round 2, NEXT-14 item 3):
 * a tiny, hand-assembled NSF whose PLAY routine writes all three of VRC6's
 * oscillators - $9000-$9002 (pulse 1), $A000-$A002 (pulse 2), $B000-$B002
 * (sawtooth) - every frame, with values that change frame to frame so a
 * comparator has real content to line up, not a single static write.
 *
 * Every other file in `sources.json` is a real, independently authored,
 * redistribution-licensed NSF, and every one of them is 2A03-only - no VRC6
 * NSF this project found carries a licence this corpus's own convention
 * requires. This file exists to close that gap a different way: instead of
 * a found tune, a purpose-built probe (CC0, dedicated by its author to this
 * ticket, the same convention `scores/psid-corpus/make-fixtures.mjs` uses
 * for its two self-authored SID probes) that puts one question to the whole
 * pipeline at once - `capture-nsf.mjs`'s own routing of a real VRC6 NSF's
 * writes (this corpus's own reason to exist), `exportNsf`'s round-trip of
 * that capture (`nsf-export`'s corpus, which reads this same `sources.json`
 * and so replays this file too, no separate wiring needed), and, with
 * `scores/arrangements/native-oracle.py` now patching `Nes_Vrc6_Apu.cpp` as
 * well as `Nes_Apu.cpp`, Game_Music_Emu's own NSF player, `Nsf_Emu`,
 * actually playing a VRC6 file and being held to the exact same command and
 * frame-write gates as any 2A03 file here - not just the register-level
 * `Nes_Vrc6_Apu` oracle `packages/conform` already drives directly.
 *
 * Run once; the output is committed (`files/vrc6-probe.nsf`) like any other
 * corpus fixture, so this script is documentation of how it was made, not a
 * build step.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = path.join(HERE, 'files');

function asciiField(bytes, offset, length, text) {
  for (let i = 0; i < length; i++) bytes[offset + i] = i < text.length ? text.charCodeAt(i) : 0;
}

// INIT @ $8000: zero the frame counter ($00, plain RAM, never a VRC6
// address - the psid-corpus probes make the same choice for the same
// reason: an oracle's own passive register logger need not agree with this
// project's on the readback value of a write-only register, only on what
// was written, and routing the counter through RAM sidesteps that entirely).
const init = [
  0xa9, 0x00, // LDA #$00
  0x85, 0x00, // STA $00
  0x60,       // RTS
];

// PLAY @ $8000 + init.length: one write to every one of VRC6's nine
// audible registers ($9003/$A003/$B003 are the shared, oscillator-less
// halt/frequency-scaling register and its two unused mirrors - out of
// scope here the same way the rest of this ticket's corpus keeps them out,
// oracles/game-music-emu/README.md's own "known limits" section), each
// value derived from the frame counter so consecutive frames differ.
const play = [
  0xe6, 0x00,             // INC $00                    ; frame counter, wraps mod 256
  0xa5, 0x00,             // LDA $00
  0x8d, 0x01, 0x90,       // STA $9001                  ; pulse 1 period low = counter
  0xa9, 0x8f,             // LDA #$8F                   ; mode on, duty 0, volume 15
  0x8d, 0x00, 0x90,       // STA $9000                  ; pulse 1 control
  0xa9, 0x80,             // LDA #$80                   ; enable, period high 0
  0x8d, 0x02, 0x90,       // STA $9002                  ; pulse 1 enable/period-high
  0xa5, 0x00,             // LDA $00
  0x49, 0xff,             // EOR #$FF                   ; counted the other way, so pulse 2 tracks opposite pulse 1
  0x8d, 0x01, 0xa0,       // STA $A001                  ; pulse 2 period low
  0xa9, 0x6a,             // LDA #$6A                   ; duty 6/8, volume 10
  0x8d, 0x00, 0xa0,       // STA $A000                  ; pulse 2 control
  0xa9, 0x80,             // LDA #$80
  0x8d, 0x02, 0xa0,       // STA $A002                  ; pulse 2 enable/period-high
  0xa5, 0x00,             // LDA $00
  0x29, 0x3f,             // AND #$3F                   ; sawtooth's rate is only 6 bits
  0x8d, 0x00, 0xb0,       // STA $B000                  ; sawtooth accumulator rate
  0xa5, 0x00,             // LDA $00
  0x8d, 0x01, 0xb0,       // STA $B001                  ; sawtooth period low
  0xa9, 0x80,             // LDA #$80
  0x8d, 0x02, 0xb0,       // STA $B002                  ; sawtooth enable/period-high
  0x60,                   // RTS
];

const LOAD_ADDR = 0x8000;
const INIT_ADDR = LOAD_ADDR;
const PLAY_ADDR = LOAD_ADDR + init.length;

// One 4 KiB PRG page, identity-mapped (every bankswitch byte left 0), the
// same shape `scores/test-capture-nsf.mjs`'s own hand-authored VRC6 file
// uses.
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
asciiField(file, 14, 32, 'vrc6-probe');
asciiField(file, 46, 32, 'gwendall, chipvoice project');
asciiField(file, 78, 32, 'CC0 2026');
view.setUint16(110, 16666, true); // standard NTSC $411a rate
// file[112..119] (bankswitch): left 0, identity-mapping the one PRG page
view.setUint16(120, 19997, true); // PAL speed, unused (NTSC-only below)
file[122] = 0; // NTSC only
file[123] = 0x01; // expansion sound chip bitfield, bit 0 = VRC6
file.set(init, 128 + (INIT_ADDR - LOAD_ADDR));
file.set(play, 128 + (PLAY_ADDR - LOAD_ADDR));

async function main() {
  await fs.promises.mkdir(FILES_DIR, { recursive: true });
  const target = path.join(FILES_DIR, 'vrc6-probe.nsf');
  await fs.promises.writeFile(target, file);
  console.log(`vrc6-probe.nsf: ${file.length} bytes, sha256 ${createHash('sha256').update(file).digest('hex')}`);
}

main();
