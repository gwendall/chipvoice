import { Nes } from '../roms/nes.mjs';
import { NTSC_FRAME, CPU_HZ } from './script.mjs';

/**
 * Runs the bench ROM to completion on the harness's 6502, the same fixture
 * `roms:*` uses, and returns every register write it made, stamped with the
 * cycle the harness's own vblank model put it on.
 *
 * This is the one place both `render.mjs` (which needs the write log to
 * render from) and the CI fidelity check (which needs to diff it against
 * `script.mjs`'s intent) run the ROM, so the two can never disagree about
 * what "running it" means.
 */
export function runRom(rom, totalFrames) {
  const nes = new Nes(rom);
  nes.powerOn();
  const budget = (totalFrames + 10) * NTSC_FRAME;
  const step = Math.floor(CPU_HZ / 100);
  let ran = 0;
  while (ran < budget) {
    nes.run(step);
    ran += step;
    if (nes.halted()) break;
  }
  if (!nes.halted()) throw new Error(`the ROM did not halt within ${totalFrames} frames' budget - it is missing its final jump, or a vblank wait never resolved`);
  return { log: nes.log, cycles: nes.cpu.cycles };
}
