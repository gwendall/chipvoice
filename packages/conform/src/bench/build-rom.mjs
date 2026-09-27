import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildScript } from './script.mjs';

/**
 * Builds the capture-day test ROM: an NROM (mapper 0) .nes image that plays
 * `script.mjs`'s writes on a real NES or Famicom.
 *
 *   node src/bench/build-rom.mjs [--out <file>] [--script <file>]
 *
 * A tiny, single-pass 6502 emitter - not a general assembler, since nothing
 * here needs a forward branch or a symbol table. The program is: disable
 * interrupts, set up the stack, then loop over every frame in the script,
 * waiting for the PPU's vblank flag before each one's writes. No PPU
 * register is ever written, so the PPU's own NMI stays off for the whole
 * run and the loop drives itself by polling $2002 instead of by an NMI
 * handler.
 *
 * Timing precision the script needs: one vblank per frame, in order, with
 * every write for a frame landing before the next vblank. It does not need
 * cycle-accurate placement within a frame - the segments are hundreds of
 * milliseconds long and `compare.mjs` locates everything from the sync
 * markers - so a polled wait is exactly as good as an NMI here and needs no
 * interrupt plumbing on either side, in the ROM or in the harness that runs
 * it.
 */
const ORIGIN = 0x8000;
const PRG_SIZE = 0x4000; // 16 KiB, one bank, mirrored across $8000-$FFFF

class Asm {
  constructor(origin) {
    this.origin = origin;
    this.bytes = [];
  }
  get pc() {
    return this.origin + this.bytes.length;
  }
  byte(b) {
    this.bytes.push(b & 0xff);
  }
  word(v) {
    this.byte(v & 0xff);
    this.byte((v >> 8) & 0xff);
  }
  sei() { this.byte(0x78); }
  cld() { this.byte(0xd8); }
  ldxImm(v) { this.byte(0xa2); this.byte(v); }
  txs() { this.byte(0x9a); }
  ldaImm(v) { this.byte(0xa9); this.byte(v); }
  ldaAbs(addr) { this.byte(0xad); this.word(addr); }
  staAbs(addr) { this.byte(0x8d); this.word(addr); }
  bpl(rel) { this.byte(0x10); this.byte(rel & 0xff); }
  jmpAbs(addr) { this.byte(0x4c); this.word(addr); }
  rti() { this.byte(0x40); }
}

/** LDA $2002; BPL back-to-LDA: spins until the vblank flag (bit 7) is set, and clears it. */
function emitWaitVblank(asm) {
  const start = asm.pc;
  asm.ldaAbs(0x2002);
  const afterBranch = asm.pc + 2;
  asm.bpl(start - afterBranch);
}

/** Assembles the ROM's PRG bytes from the script's frames. */
export function assemble(script) {
  const asm = new Asm(ORIGIN);
  asm.rti(); // an interrupt stub at $8000; never reached, since neither IRQ nor NMI is enabled
  const resetEntry = asm.pc;
  asm.sei();
  asm.cld();
  asm.ldxImm(0xff);
  asm.txs();

  const byFrame = new Map();
  for (const w of script.writes) {
    if (!byFrame.has(w.frame)) byFrame.set(w.frame, []);
    byFrame.get(w.frame).push(w);
  }
  for (let frame = 0; frame < script.totalFrames; frame++) {
    emitWaitVblank(asm);
    for (const w of byFrame.get(frame) ?? []) {
      asm.ldaImm(w.value);
      asm.staAbs(w.addr);
    }
  }
  const haltAt = asm.pc;
  asm.jmpAbs(haltAt); // park forever; `halted()` in the harness and any debugger recognises this

  if (asm.bytes.length > PRG_SIZE - 6) {
    throw new Error(`program is ${asm.bytes.length} bytes, past the ${PRG_SIZE - 6}-byte budget before the vectors`);
  }

  const prg = new Uint8Array(PRG_SIZE).fill(0xea); // NOP filler; unreachable
  prg.set(asm.bytes, 0);
  const vectors = PRG_SIZE - 6;
  const setVector = (offset, addr) => {
    prg[offset] = addr & 0xff;
    prg[offset + 1] = (addr >> 8) & 0xff;
  };
  setVector(vectors, ORIGIN); // NMI: the stub, unused since $2000's NMI-enable bit is never set
  setVector(vectors + 2, resetEntry); // RESET
  setVector(vectors + 4, ORIGIN); // IRQ/BRK: the stub, unused since I stays set throughout
  return prg;
}

/** Wraps a 16 KiB PRG bank as a minimal iNES file: NROM, no CHR-ROM (CHR RAM), no trainer. */
export function toINes(prg) {
  const header = new Uint8Array(16);
  header.set([0x4e, 0x45, 0x53, 0x1a], 0); // "NES\x1A"
  header[4] = 1; // one 16 KiB PRG bank
  header[5] = 0; // no CHR-ROM
  header[6] = 0; // mapper 0 (NROM), horizontal mirroring
  header[7] = 0;
  const rom = new Uint8Array(header.length + prg.length);
  rom.set(header, 0);
  rom.set(prg, header.length);
  return rom;
}

export function buildRom() {
  const script = buildScript();
  const prg = assemble(script);
  return { rom: toINes(prg), script };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outPath = option('out', path.join(ROOT, 'roms', 'bench', 'nes-analog-script.nes'));
  const scriptPath = option('script', path.join(ROOT, 'corpus', '2a03', 'hardware-script.json'));

  const { rom, script } = buildRom();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rom);
  const sha256 = crypto.createHash('sha256').update(rom).digest('hex');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(
    scriptPath,
    // The ROM's own hash travels with the script that built it, so the ROM a
    // capture day actually cartridges up can be checked against this file
    // (`shasum -a 256 roms/bench/nes-analog-script.nes`) without hand-typing
    // the hex anywhere - it is only ever read back, never retyped.
    JSON.stringify({ cpuHz: 1789773, rom: { file: path.relative(ROOT, outPath), sha256 }, totalFrames: script.totalFrames, writes: script.writes, segments: script.segments }, null, 2) + '\n',
  );
  console.log(`wrote ${outPath} (${rom.length} bytes)`);
  console.log(`wrote ${scriptPath} (${script.writes.length} writes over ${script.totalFrames} frames)`);
  console.log(`sha256 ${sha256}`);
}
