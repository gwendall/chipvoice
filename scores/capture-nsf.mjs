import {Cpu6502} from '../packages/conform/src/roms/cpu6502.mjs';

/** Offline NSF v1 adapter. Deliberately rejects hardware it does not execute.
 * This is a source extractor, never code loaded into the browser or SDK. */
export function captureNsf(bytes, {track = 0, frames = 12000} = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 128 || String.fromCharCode(...bytes.slice(0, 5)) !== 'NESM\x1a' || bytes[5] !== 1) throw new Error('Expected NSF v1');
  if (!Number.isInteger(track) || track < 0 || track >= bytes[6]) throw new Error('Invalid NSF track');
  if (bytes.slice(112, 120).some(Boolean) || bytes[123] || (bytes[122] & 1)) throw new Error('Only unbanked NTSC 2A03 NSF is supported');
  if (!Number.isInteger(frames) || frames < 1 || frames > 20000) throw new Error('Invalid capture length');
  const ram = new Uint8Array(65536), load = view.getUint16(8, true);
  if (load < 0x8000 || bytes.length - 128 + load > 65536) throw new Error('Unsupported NSF memory layout');
  ram.set(bytes.subarray(128), load);
  // Legacy $411a (16666 us) denotes the NTSC video rate in this rip and
  // Game_Music_Emu. Preserve custom rates; record this interpretation explicitly.
  const clockHz = 1789773, speed = view.getUint16(110, true);
  const period = !speed || speed === 16666 ? (262 * 341 * 4 - 2) / 12 : speed * clockHz / 1e6;
  const events = [], calls = [];
  let cpu;
  const bus = {
    tick() {},
    read(addr) {
      if (addr >= 0x2000 && addr < 0x6000) throw new Error(`NSF reads unsupported hardware $${addr.toString(16)}`);
      return ram[addr < 0x2000 ? addr & 0x7ff : addr];
    },
    write(addr, value) {
      if (addr >= 0x4000 && addr <= 0x4017 && addr !== 0x4014 && addr !== 0x4016) events.push({at: cpu.cycles, addr, value});
      else if (addr < 0x2000 || addr >= 0x6000 && addr < 0x8000) ram[addr < 0x2000 ? addr & 0x7ff : addr] = value;
      else throw new Error(`NSF writes unsupported hardware $${addr.toString(16)}`);
    },
  };
  cpu = new Cpu6502(bus);
  const call = address => {
    cpu.s = 0xfd; cpu.push(0x4f); cpu.push(0xff); cpu.pc = address;
    const deadline = cpu.cycles + period;
    while (cpu.pc !== 0x5000) {
      // The ROM-test CPU historically treats undocumented opcodes as NOP.
      // Source capture must fail instead of silently changing the music.
      cpu.strict = true;
      cpu.step();
      if (cpu.cycles > deadline) throw new Error('NSF routine exceeded one frame');
    }
  };
  for (let addr = 0x4000; addr <= 0x4013; addr++) events.push({at: 0, addr, value: 0});
  events.push({at: 0, addr: 0x4015, value: 15}, {at: 0, addr: 0x4017, value: 0x40});
  cpu.a = track; cpu.x = 0; cpu.y = 0;
  call(view.getUint16(10, true));
  const origin = Math.ceil(cpu.cycles / period) * period;
  for (let frame = 0; frame < frames; frame++) {
    cpu.cycles = Math.round(origin + frame * period);
    const first = events.length;
    call(view.getUint16(12, true));
    calls.push({at: Math.round(origin + frame * period), first, end: events.length});
  }
  return {chip: '2a03', clockHz, period, events, calls, cycles: Math.round(origin + frames * period)};
}
