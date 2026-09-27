import { Spc700 } from '../dist/chips/snes/spc700.js';
import { Ssmp, IPL_ROM } from '../dist/chips/snes/ssmp.js';
import { SnesChip } from '../dist/chips/snes/dsp.js';

/**
 * The S-SMP wired to a real CPU: boots the actual 64-byte IPL ROM (Anomie's
 * doc) and checks it reaches the documented "signal ready" point, then
 * checks snapshot loading restores DSP registers, RAM, ports and timers
 * exactly, with no write side effects.
 */

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// Boot the IPL ROM for real: it should clear page 0, then park in the
// "-  CMP $F4,#$CC / BNE -" loop waiting for the 5A22, having already
// written $AA to $F4 and $BB to $F5 to signal readiness.
{
  const chip = new SnesChip();
  const ssmp = new Ssmp(chip);
  ssmp.control = 0x80; // ROM enabled, as it is on power-on/reset
  const cpu = new Spc700(ssmp);
  cpu.reset();
  check('reset PC points at the IPL ROM entry', cpu.pc === 0xffc0, `got $${cpu.pc.toString(16)}`);
  let steps = 0;
  while (steps < 2000 && !(chip.ram[0xf4] === 0xaa && chip.ram[0xf5] === 0xbb)) {
    cpu.step();
    steps++;
  }
  check('the boot ROM signals ready on $F4/$F5', chip.ram[0xf4] === 0xaa && chip.ram[0xf5] === 0xbb, `after ${steps} steps`);
  check('page 0 was cleared by the init loop', chip.ram[0x00] === 0 && chip.ram[0xff] === 0);
  // It should now be spinning on "CMP $F4,#$CC / BNE -" without progressing.
  const pcAtWait = cpu.pc;
  for (let i = 0; i < 20; i++) cpu.step();
  check('it parks waiting for the transfer signal', cpu.pc === pcAtWait);
}

// Snapshot loading: TEST/CONTROL/DSPADDR/ports/targets/timer-outputs come
// from the RAM dump's usual addresses; DSP registers are restored exactly;
// none of this should touch the event log or the port-clear/enable-edge
// logic a real write would trigger.
{
  const chip = new SnesChip();
  const ssmp = new Ssmp(chip);
  const ram = new Uint8Array(0x10000);
  ram[0xf0] = 0x12; // TEST
  ram[0xf1] = 0x85; // CONTROL: ROM enabled, T0 and T2 enabled, T1 not
  ram[0xf2] = 0x6c; // DSPADDR (FLG)
  ram[0xf4] = 0x11; ram[0xf5] = 0x22; ram[0xf6] = 0x33; ram[0xf7] = 0x44;
  ram[0xfa] = 0x10; ram[0xfb] = 0x20; ram[0xfc] = 0x30; // TnTARGET
  ram[0xfd] = 0x05; ram[0xfe] = 0x06; ram[0xff] = 0x07; // TnOUT, as a dumper would leave them
  ram[0x0200] = 0x42; // plain RAM, unrelated to any register
  const dspRegs = new Uint8Array(128);
  dspRegs[0x6c] = 0x60; // FLG: mute off, echo off, noise clock 0
  ssmp.loadSnapshot(ram, dspRegs);

  check('TEST restored', ssmp.test === 0x12);
  check('CONTROL restored', ssmp.control === 0x85);
  check('DSPADDR restored', ssmp.dspAddr === 0x6c);
  check('ports restored', ssmp.portsIn[0] === 0x11 && ssmp.portsIn[3] === 0x44);
  check('TnTARGET restored', ssmp.timers[0].target === 0x10 && ssmp.timers[2].target === 0x30);
  check('TnOUT restored', ssmp.timers[0].out === 5 && ssmp.timers[1].out === 6 && ssmp.timers[2].out === 7);
  check('T0 and T2 enabled, T1 not, per CONTROL', ssmp.timers[0].enabled && !ssmp.timers[1].enabled && ssmp.timers[2].enabled);
  check('plain RAM restored', chip.ram[0x0200] === 0x42);
  check('DSP register restored', chip.dsp.read(0x6c) === 0x60);
  check('no event captured by loading', ssmp.events.length === 0);
}

// The write-side $F2/$F3 protocol: a real CPU write captures an event
// stamped with the cycle it lands on, and reaches the live DSP so a
// following read sees it.
{
  const chip = new SnesChip();
  const ssmp = new Ssmp(chip);
  ssmp.dspAddr = 0x6c;
  ssmp.cycle = 100;
  ssmp.write(0xf3, 0x60);
  check('a $F3 write reaches the DSP', chip.dsp.read(0x6c) === 0x60);
  check('a $F3 write is captured with its cycle', ssmp.events.length === 1 && ssmp.events[0].at === 100 && ssmp.events[0].addr === 0xf3 && ssmp.events[0].value === 0x60);
  ssmp.write(0xf2, 0x7c);
  check('a $F2 write updates the latch and is captured', ssmp.dspAddr === 0x7c && ssmp.events[1].addr === 0xf2 && ssmp.events[1].value === 0x7c);
}

// TnOUT read clears to 0; the CONTROL port-clear bits zero the input ports.
{
  const chip = new SnesChip();
  const ssmp = new Ssmp(chip);
  ssmp.timers[0].out = 9;
  check('TnOUT clears on read', ssmp.read(0xfd) === 9 && ssmp.read(0xfd) === 0);
  ssmp.portsIn[0] = 0x11; ssmp.portsIn[1] = 0x22; ssmp.portsIn[2] = 0x33; ssmp.portsIn[3] = 0x44;
  ssmp.write(0xf1, 0x30); // bits 5 and 4: clear both port pairs
  check('CONTROL port-clear bits zero the input ports', ssmp.portsIn.every((v) => v === 0));
}

console.log(failures === 0 ? 'PASS  ssmp: boot ROM and snapshot loading' : `FAIL  ssmp: ${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;
