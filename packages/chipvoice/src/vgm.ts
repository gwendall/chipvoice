/**
 * VGM: the event stream, as a file every chiptune player and every piece of
 * real hardware with a VGM player understands.
 *
 * A VGM file is a log of register writes with waits between them, which is
 * what `RegisterEvent[]` already is. The only translation is the clock: VGM
 * waits are counted in samples at 44100 Hz, so each write's cycle is rounded
 * to the nearest of those. At the 2A03's clock that is a rounding of at most
 * twenty cycles, eleven microseconds, on the way out; the chip is not
 * consulted, so nothing else changes.
 *
 * Version 1.61 of the format, the one that added the NES APU and the Game
 * Boy's. Register writes are `0xB4 aa dd` for the 2A03 with `aa` the low
 * byte of the address, and `0xB3 aa dd` for the DMG with `aa` the offset
 * from `$FF10`. The header carries the chip's clock and the total length; a
 * GD3 tag at the end carries the names, because that is what a player shows.
 */

import type { RegisterEvent } from "./chip.js";
import { CPU_HZ } from "./chips/nes/dsp.js";
import { CLOCK_HZ as GB_HZ } from "./chips/gb/dsp.js";

const SAMPLE_RATE = 44100;
const VERSION = 0x161;
const HEADER = 0xc0;

export interface VgmOptions {
  /** Shown by players as the track's name. */
  title?: string;
  author?: string;
  /** The game or project the track is from. */
  game?: string;
  /** Free text, in the tag's notes field. */
  notes?: string;
  /**
   * Where playback returns to when the file ends, in cycles. Left out, the
   * file plays once.
   */
  loopAtCycle?: number;
  /** Which chip the writes are for: `"2a03"` (the default) or `"dmg"`. */
  chip?: string;
}

/** What each chip's writes look like in the file, and where its clock goes. */
const CHIPS: Record<string, { clock: number; command: number; base: number; last: number; clockOffset: number; system: string }> = {
  "2a03": { clock: CPU_HZ, command: 0xb4, base: 0x4000, last: 0x401f, clockOffset: 0x84, system: "Nintendo Entertainment System" },
  dmg: { clock: GB_HZ, command: 0xb3, base: 0xff10, last: 0xff3f, clockOffset: 0x80, system: "Nintendo Game Boy" },
};

/**
 * @param events register writes, stamped in the chip's cycles
 * @param cycles how long the file plays, in cycles: writes at or past it are dropped
 */
export function toVgm(events: RegisterEvent[], cycles: number, options: VgmOptions = {}): Uint8Array {
  const chip = CHIPS[options.chip ?? "2a03"];
  if (!chip) throw new Error(`no VGM format for chip: ${options.chip}`);
  const samples = (cycle: number) => Math.round((cycle * SAMPLE_RATE) / chip.clock);
  const total = samples(cycles);
  const writes = events
    .filter((e) => e.at < cycles && e.addr >= chip.base && e.addr <= chip.last)
    .map((e) => ({ at: samples(e.at), addr: (e.addr - chip.base) & 0xff, value: e.value & 0xff }))
    .sort((a, b) => a.at - b.at);

  const body: number[] = [];
  let position = 0;
  let loopOffset = -1;
  const loopAt = options.loopAtCycle === undefined ? -1 : samples(options.loopAtCycle);

  const wait = (until: number) => {
    let n = until - position;
    while (n > 0) {
      if (n <= 16) {
        body.push(0x70 + n - 1);
        n = 0;
      } else if (n === 735) {
        body.push(0x62);
        n = 0;
      } else if (n === 882) {
        body.push(0x63);
        n = 0;
      } else {
        const chunk = Math.min(n, 0xffff);
        body.push(0x61, chunk & 0xff, chunk >> 8);
        n -= chunk;
      }
    }
    position = until;
  };

  for (const w of writes) {
    if (loopAt >= 0 && loopOffset < 0 && w.at >= loopAt) {
      wait(loopAt);
      loopOffset = body.length;
    }
    wait(w.at);
    body.push(chip.command, w.addr, w.value);
  }
  if (loopAt >= 0 && loopOffset < 0) {
    wait(loopAt);
    loopOffset = body.length;
  }
  wait(total);
  body.push(0x66);

  const gd3 = tag(options, chip.system);
  const file = new Uint8Array(HEADER + body.length + gd3.length);
  const view = new DataView(file.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) file[offset + i] = text.charCodeAt(i);
  };

  ascii(0x00, "Vgm ");
  view.setUint32(0x04, file.length - 4, true);
  view.setUint32(0x08, VERSION, true);
  view.setUint32(0x14, HEADER + body.length - 0x14, true);
  view.setUint32(0x18, total, true);
  if (loopOffset >= 0) {
    view.setUint32(0x1c, HEADER + loopOffset - 0x1c, true);
    view.setUint32(0x20, total - loopAt, true);
  }
  view.setUint32(0x24, 60, true);
  view.setUint32(0x34, HEADER - 0x34, true);
  view.setUint32(chip.clockOffset, chip.clock, true);

  file.set(body, HEADER);
  file.set(gd3, HEADER + body.length);
  return file;
}

/**
 * The GD3 tag: eleven UTF-16 strings, most of them a title in two languages.
 * Players show the first one; a car stereo shows nothing without it.
 */
function tag(options: VgmOptions, system: string): Uint8Array {
  const strings = [
    options.title ?? "",
    "",
    options.game ?? "",
    "",
    system,
    "",
    options.author ?? "",
    "",
    "",
    "chipvoice",
    options.notes ?? "",
  ];
  const chars: number[] = [];
  for (const s of strings) {
    for (let i = 0; i < s.length; i++) chars.push(s.charCodeAt(i));
    chars.push(0);
  }
  const out = new Uint8Array(12 + chars.length * 2);
  const view = new DataView(out.buffer);
  out.set([0x47, 0x64, 0x33, 0x20], 0);
  view.setUint32(4, 0x100, true);
  view.setUint32(8, chars.length * 2, true);
  chars.forEach((c, i) => view.setUint16(12 + i * 2, c, true));
  return out;
}
