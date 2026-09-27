import {Cpu6502} from '../packages/conform/src/roms/cpu6502.mjs';

/** Offline NSF v1/v2 adapter. Deliberately rejects hardware it does not execute.
 * This is a source extractor, never code loaded into the browser or SDK. */
export function captureNsf(bytes, {track = 0, frames = 12000} = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 128 || String.fromCharCode(...bytes.slice(0, 5)) !== 'NESM\x1a') throw new Error('Expected NSF v1 or v2');
  const version = bytes[5];
  if (version !== 1 && version !== 2) throw new Error('Expected NSF v1 or v2');
  // NSF2 keeps NSF v1's program-code layout; its version bump exists so that
  // optional NSFe-style metadata (track titles, an author string) can follow
  // the code, addressed by a 24-bit length at $7D-$7F instead of the code
  // running to the end of the file, and so that genuinely new playback
  // behaviours (a non-returning INIT, NSF2's own IRQ, a suppressed PLAY) can
  // be gated behind feature bits at $7C. None of those behaviours are
  // implemented here, so a v2 file that sets any of them is rejected rather
  // than silently misplayed; a v2 file that only carries metadata plays
  // exactly like v1, and the metadata itself is never loaded into memory.
  const nsf2Features = version === 2 ? bytes[124] : 0;
  if (nsf2Features & 0xf0) throw new Error('NSF2 non-returning INIT, its own IRQ, and a suppressed PLAY are not supported');
  const programLength = version === 2 ? bytes[125] | (bytes[126] << 8) | (bytes[127] << 16) : bytes.length - 128;
  if (!Number.isInteger(track) || track < 0 || track >= bytes[6]) throw new Error('Invalid NSF track');
  if (bytes[123] || (bytes[122] & 1)) throw new Error('Only NTSC 2A03 NSF is supported');
  if (!Number.isInteger(frames) || frames < 1 || frames > 20000) throw new Error('Invalid capture length');
  const ram = new Uint8Array(65536), load = view.getUint16(8, true);
  const banked = bytes.subarray(112, 120).some(Boolean);
  if (load < 0x8000 || (!banked && programLength + load > 65536) || programLength > 256 * 4096 || 128 + programLength > bytes.length) throw new Error('Unsupported NSF memory layout');
  const banks = bytes.slice(112, 120);
  const code = bytes.subarray(128, 128 + programLength);
  // Bank zero starts at the load address's 4 KiB offset, not at $8000.
  const rom = new Uint8Array(Math.ceil(((load & 0xfff) + programLength) / 4096) * 4096);
  rom.set(code, load & 0xfff);
  if (!banked) ram.set(code, load);
  // Legacy $411a (16666 us) denotes the NTSC video rate in this rip and
  // Game_Music_Emu. Preserve custom rates; record this interpretation explicitly.
  const clockHz = 1789773, speed = view.getUint16(110, true);
  // Game_Music_Emu (`Nsf_Emu::set_tempo_`) only takes this branch for a
  // custom (non-$411a) rate, and computes it as
  // `long(playback_rate * clock_rate_ / 1e6)`: a plain C++ integer
  // truncation of a slightly different NTSC clock constant
  // (1789772.72727, not 1789773). A file with a custom rate needs that
  // exact integer, not a floating-point approximation of it - Pently's demo
  // NSF sets this field to 16639, and its per-frame PLAY cycle drifts away
  // from GME's after a few frames without this.
  const standardRate = !speed || speed === 16666;
  const period = standardRate ? (262 * 341 * 4 - 2) / 12 : Math.trunc(speed * 1789772.72727 / 1e6);
  const events = [], calls = [];
  let cpu;
  const bus = {
    tick() {},
    read(addr) {
      if (banked && addr >= 0x8000) return rom[banks[(addr - 0x8000) >> 12] * 4096 + (addr & 0xfff)] ?? 0;
      if (addr >= 0x2000 && addr < 0x6000) throw new Error(`NSF reads unsupported hardware $${addr.toString(16)}`);
      return ram[addr < 0x2000 ? addr & 0x7ff : addr];
    },
    write(addr, value) {
      if (banked && addr >= 0x5ff8 && addr <= 0x5fff) banks[addr - 0x5ff8] = value;
      else if (addr >= 0x4000 && addr <= 0x4017 && addr !== 0x4014 && addr !== 0x4016) events.push({at: cpu.cycles, addr, value});
      else if (addr < 0x2000 || addr >= 0x6000 && addr < 0x8000) ram[addr < 0x2000 ? addr & 0x7ff : addr] = value;
      else throw new Error(`NSF writes unsupported hardware $${addr.toString(16)}`);
    },
  };
  cpu = new Cpu6502(bus);
  // Game_Music_Emu's own player (Nsf_Emu::start_track_) sets play_ready = 4:
  // it tolerates INIT running for up to four frame periods before the first
  // PLAY call, not just one. A driver that clears a large buffer or builds a
  // lookup table in INIT is legitimate, not a hang; only PLAY, which must
  // finish before the next frame's IRQ/NMI would call it again on real
  // hardware, keeps the tighter one-frame budget.
  const call = (address, budgetFrames = 1) => {
    cpu.s = 0xfd; cpu.push(0x4f); cpu.push(0xff); cpu.pc = address;
    const deadline = cpu.cycles + budgetFrames * period;
    while (cpu.pc !== 0x5000) {
      // The ROM-test CPU historically treats undocumented opcodes as NOP.
      // Source capture must fail instead of silently changing the music.
      cpu.strict = true;
      cpu.step();
      if (cpu.cycles > deadline) throw new Error(`NSF routine exceeded its ${budgetFrames}-frame budget`);
    }
  };
  for (let addr = 0x4000; addr <= 0x4013; addr++) events.push({at: 0, addr, value: 0});
  events.push({at: 0, addr: 0x4015, value: 15}, {at: 0, addr: 0x4017, value: 0x40});
  cpu.a = track; cpu.x = 0; cpu.y = 0;
  call(view.getUint16(10, true), 4);
  // The standard $411a rate's true per-frame length is a half-cycle
  // (357366 PPU clocks over 4 frames, "two fewer PPU clocks every four
  // frames"), so rounding `frame * period` to the nearest whole cycle
  // already reproduces Game_Music_Emu's own alternating carry sequence
  // (29781, 59561, 89342, 119122, ...) exactly. A custom rate's period is
  // already a whole number, so that rounding buys nothing; comparing a
  // custom-rate NSF (Pently's demo, at $411a=16639) against Game_Music_Emu
  // frame by frame shows every one of its PLAY calls, not just the first,
  // starts exactly one cycle later than this plain `ceil` gives - a small,
  // constant, file-wide offset, not drift, so it is corrected once here
  // rather than chased per event in the comparator.
  const origin = Math.ceil(cpu.cycles / period) * period + (standardRate ? 0 : 1);
  for (let frame = 0; frame < frames; frame++) {
    cpu.cycles = Math.round(origin + frame * period);
    const first = events.length;
    call(view.getUint16(12, true));
    calls.push({at: Math.round(origin + frame * period), first, end: events.length});
  }
  // DMC/DPCM sample playback reads cartridge memory at $C000-$FFFF directly
  // via DMA, driven by $4012/$4013/$4015 rather than any instruction this
  // capture ever sees; the register trace alone loses the sample bytes.
  // When the capture used DMC ($4015 written with bit 4 set), snapshot that
  // whole 16 KiB window through the same `bus.read` the CPU itself used, so
  // callers get the bytes back in `PerformancePlan.memory`'s own shape. This
  // is a snapshot at the end of the run, not a change log: for a file whose
  // bank registers move $C000-$FFFF's contents over time, an earlier DMC
  // read could have seen different bytes than this reflects. None of the
  // real NSFs this repo's corpus plays DMC from are bank-switched (checked
  // against their own headers), so that gap is a known, narrow limitation
  // rather than a silent one.
  let memory = [];
  if (events.some((e) => e.addr === 0x4015 && (e.value & 0x10) !== 0)) {
    const dmcBytes = new Uint8Array(0x4000);
    for (let i = 0; i < dmcBytes.length; i++) dmcBytes[i] = bus.read(0xc000 + i);
    memory = [{address: 0xc000, bytes: dmcBytes}];
  }
  return {chip: '2a03', clockHz, period, events, calls, cycles: Math.round(origin + frames * period), memory};
}
