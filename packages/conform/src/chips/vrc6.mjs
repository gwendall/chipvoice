import { Vrc6Apu, NES_VRC6 } from 'chipvoice';
import { ChangeStream } from '../change-stream.mjs';

/**
 * chipvoice's VRC6, as the harness drives it: the digital chip alone
 * (`Vrc6Apu`, `packages/chipvoice/src/chips/nes/vrc6.ts`), fed the log's
 * writes on their cycles, its three voices' changes collected straight into
 * a `ChangeStream` (change-stream.mjs) rather than one object per change.
 *
 * This is the standalone chip, not the combined `2a03-vrc6` cartridge chip
 * (`vrc6-core.ts`): the harness compares one expansion audio chip's own
 * register-in, value-out behaviour against Game_Music_Emu's own isolated
 * `Nes_Vrc6_Apu`, the same split the 2A03/VRC6 mixing stage makes in
 * `vrc6-core.ts` for the same reason - mixing is not this chip's job.
 */
export const chipVrc6 = {
  id: 'vrc6',
  clock: NES_VRC6.clockHz,
  /** In trace order: the two pulses, then the sawtooth. */
  voices: ['vp1', 'vp2', 'vsaw'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {ChangeStream}
   */
  trace(writes, cycles) {
    const chip = new Vrc6Apu();
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = new ChangeStream();
    chip.trace(cycles, (cycle, voice, value) => changes.push(cycle, voice, value));
    return changes;
  },
};

/**
 * The same digital chip, its three voices pre-summed into one, matching the
 * one number real Mesen's own `Vrc6Audio::ClockAudio` ever exposes:
 * `_pulse1.GetVolume() + _pulse2.GetVolume() + _saw.GetVolume()`, then scaled
 * by 15 (`AddExpansionAudioDelta(AudioChannel::VRC6, delta * 15)`) - real
 * Mesen never instruments the three oscillators separately the way
 * chipvoice's own `Vrc6Apu.trace()` (above) or Game_Music_Emu's `main.cpp`
 * do, because its mixer only ever sees the mapper's one combined line. A
 * second `CHIPS` entry, not a third argument to `chipVrc6.trace()`, for the
 * same reason `c64-8580` is a second entry rather than a flag on `chipC64`
 * (see cli.mjs's own comment): the oracle side changes AND what is being
 * measured changes shape (one voice instead of three), not just which
 * reference implementation runs.
 */
export const chipVrc6Combined = {
  id: 'vrc6-combined',
  clock: NES_VRC6.clockHz,
  /** One voice: the two pulses and the sawtooth, already summed. */
  voices: ['sum'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {ChangeStream}
   */
  trace(writes, cycles) {
    const chip = new Vrc6Apu();
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = new ChangeStream();
    const out = [0, 0, 0];
    let last = 0;
    for (let i = 0; i < cycles; i++) {
      const cycle = chip.cycle;
      chip.step();
      chip.outputs(out);
      const sum = (out[0] + out[1] + out[2]) * 15;
      if (sum !== last) {
        last = sum;
        changes.push(cycle, 0, sum);
      }
    }
    return changes;
  },
};
