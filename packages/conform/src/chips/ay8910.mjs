import { Ay8910 } from 'chipvoice';
import { ChangeStream } from '../change-stream.mjs';

/**
 * chipvoice's AY-3-8910/YM2149 core (`Ay8910`, `packages/chipvoice/src/chips/ay8910.ts`),
 * fed the log's writes on their cycles (the chip's own 0-15 register index,
 * not a CPU address - `Ay8910.write`'s own addressing), its three channels'
 * raw 0-31 output index collected into a `ChangeStream`.
 *
 * This is the standalone digital chip, not the Sunsoft 5B cartridge chip
 * (`nes/sunsoft5b-core.ts`): the harness compares the shared AY/YM core in
 * isolation, the same split `vrc6.mjs` makes for VRC6. The 5B's own
 * $C000/$E000 register-select port pair (including the DDDD-disable quirk)
 * is not an AY/YM behaviour at all - it is exercised by
 * `packages/chipvoice/test/sunsoft5b.mjs` and the NSF round-trip tests
 * against nesdev's text directly, not against either oracle here.
 */
export const chipAy8910 = {
  id: 'ay8910',
  clock: 1789773,
  /** In trace order: channels A, B, C. */
  voices: ['a', 'b', 'c'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {ChangeStream}
   */
  trace(writes, cycles) {
    const chip = new Ay8910();
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = new ChangeStream();
    chip.trace(cycles, (cycle, voice, value) => changes.push(cycle, voice, value));
    return changes;
  },
};

/**
 * `Ay_Apu.cpp`'s own 16-entry, ~1.5 dB/step amplitude table (Game_Music_Emu,
 * `oracles/game-music-emu/gme/Ay_Apu.cpp`), copied verbatim from its own
 * comment ("With channels tied together and 1K resistor to ground... output
 * nearly matches logarithmic curve") and rounded the same way its `ENTRY`
 * macro does (`byte(n * 255 + 0.5)`, an unsigned-byte truncating cast, which
 * for a non-negative value is `Math.trunc`, not `Math.round` - they agree
 * here since every `n * 255 + 0.5` below lands comfortably clear of a
 * `.5` boundary of its own).
 */
const AY_AMP_TABLE = [
  0.0, 0.007813, 0.011049, 0.015625, 0.022097, 0.03125, 0.044194, 0.0625, 0.088388, 0.125, 0.176777, 0.25, 0.353553,
  0.5, 0.707107, 1.0,
].map((n) => Math.trunc(n * 255 + 0.5));

/**
 * The same digital chip, compared in `Ay_Apu`'s own units instead of
 * chipvoice's raw index - Game_Music_Emu's `Ay_Apu` applies its amplitude
 * table before a value ever reaches the `Blip_Buffer` recorder this harness
 * reads back (`oracles/game-music-emu/main-ay.cpp`'s own comment explains
 * why: the raw pre-table index is private state with no public accessor),
 * so this is a second `CHIPS` entry, not a third argument to
 * `chipAy8910.trace()`, for the same reason `vrc6-combined` is
 * (`cli.mjs`'s own comment: what is measured changes shape, not just which
 * reference implementation runs).
 *
 * Only meaningful for a log that never turns the envelope on
 * (`docs/chips/sunsoft5b.md`'s own note on why: `AY_AMP_TABLE` only covers
 * the 16 fixed-volume levels, not the YM2149's 32-level envelope curve, and
 * `Ay_Apu`'s own envelope model runs at a different rate besides - see
 * `oracles/game-music-emu-ay.mjs`'s own "known limits"). A log that does is
 * still accepted here (nothing in this file checks R8-R10's bit 4), but its
 * output is not a meaningful comparison and no corpus script relies on one.
 *
 * Gate on/off (`out !== 0`) is unambiguous even for volume 0: `Ay8910`'s own
 * raw index is `2V + 1` for a fixed volume, never 0, so a raw index of
 * exactly 0 only ever means the mixer gated the channel off - see
 * `Ay8910.outputs`'s own doc comment.
 */
export const chipAy8910Gme = {
  id: 'ay8910-gme-amp',
  clock: 1789773,
  voices: ['a', 'b', 'c'],

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {ChangeStream}
   */
  trace(writes, cycles) {
    const chip = new Ay8910();
    chip.schedule(writes.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
    const changes = new ChangeStream();
    const out = [0, 0, 0];
    const last = [0, 0, 0];
    for (let i = 0; i < cycles; i++) {
      const cycle = chip.cycle;
      chip.step();
      chip.outputs(out);
      for (let ch = 0; ch < 3; ch++) {
        const gate = out[ch] !== 0;
        const value = gate ? AY_AMP_TABLE[chip.regs[8 + ch] & 0x0f] : 0;
        if (value !== last[ch]) {
          last[ch] = value;
          changes.push(cycle, ch, value);
        }
      }
    }
    return changes;
  },
};
