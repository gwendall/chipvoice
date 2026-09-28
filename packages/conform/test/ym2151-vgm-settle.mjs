import assert from 'node:assert/strict';
import { Ym2151 } from 'chipvoice';
import { vgmToWrites } from '../src/vgm.mjs';

/**
 * A regression test for the bug `packages/conform/src/vgm.mjs`'s module doc
 * comment (above `YM2151_COMMAND`) now documents: a real capture is free to
 * hold a dense run of zero-wait `0x54` commands - normal, since most
 * drivers issue several register writes per video frame with no VGM wait
 * between them - and the decoder's own write spacing has to keep every one
 * of them from being silently dropped by the real chip's busy/settle
 * window (`reg_data_ready = reg_data_ready && !write_a_en` in the vendored
 * `opm.c`; see also `packages/conform/src/corpus/generate-ym2151.mjs`'s own
 * module doc comment for the same 64-native-cycle figure).
 *
 * Sixteen distinct slots' TL registers, not sixteen writes to one register:
 * only the last write to a given register is ever observable in its final
 * state, so a dropped write among several to the *same* register can hide
 * behind whichever write happened to land last. Sixteen different slots
 * make every one of the sixteen writes independently checkable - `Ym2151`'s
 * own `sl_tl` array (a line-for-line port of `opm.c`'s `sl_tl`, the same
 * field this fix's own worst-case sweep against the vendored oracle read
 * back) after the run must hold every value, not just some of them.
 *
 * `vgmToWrites(bytes, 'ym2151', { settleCycles: 4 })` reproduces the old,
 * unconditional default (`YM2151_WRITE_GAP`, before this fix) and must lose
 * at least one of the sixteen - the proof this test exists to catch a real
 * regression, not just agree with itself. The decoder's own new default
 * (`YM2151_SETTLE_CYCLES`, 64 native cycles) must land every one.
 */
const CLOCK = 3579545;
const VGM_VERSION = 0x161;
const HEADER_SIZE = 0xc0;
const YM2151_CLOCK_OFFSET = 0x30;

/** A minimal single-chip VGM: every `[addr, data]` pair becomes one `0x54 aa dd` command, all at the same VGM sample - no wait bytes anywhere in the stream. */
function buildDenseVgm(commands) {
  const body = [];
  for (const [addr, data] of commands) body.push(0x54, addr, data);
  body.push(0x66);
  const file = new Uint8Array(HEADER_SIZE + body.length);
  const view = new DataView(file.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) file[offset + i] = text.charCodeAt(i);
  };
  ascii(0x00, 'Vgm ');
  view.setUint32(0x04, file.length - 4, true);
  view.setUint32(0x08, VGM_VERSION, true);
  view.setUint32(0x18, 100, true); // total samples: nominal, nextAddrCycle dominates cycles() below regardless
  view.setUint32(0x34, HEADER_SIZE - 0x34, true);
  view.setUint32(YM2151_CLOCK_OFFSET, CLOCK, true);
  file.set(body, HEADER_SIZE);
  return file;
}

const SLOTS = 16;
const commands = [];
const expected = new Map();
for (let slot = 0; slot < SLOTS; slot++) {
  const value = 10 + slot; // 10..25: nonzero, distinct, clear of TL's power-on-reset default (0)
  commands.push([0x60 | slot, value]); // TL, register 0x60 | slot
  expected.set(slot, value);
}
const bytes = buildDenseVgm(commands);

/**
 * Decodes `bytes` at the given `settleCycles`, drives a fresh `Ym2151` with
 * the result the same way `chips/ym2151.mjs`'s own `trace()` does (drain
 * every write whose cycle has come due, then one `clock()`), runs 256 more
 * native cycles past the last write (four full 32-tick/64-cycle sweeps -
 * comfortably past the worst case this fix's own sweep against the
 * vendored oracle found, 64) so every write still pending gets every
 * chance to land, and returns each target slot's final `sl_tl`.
 *
 * @param {number} [settleCycles]
 * @returns {Map<number, number>}
 */
function finalTl(settleCycles) {
  const decoded = vgmToWrites(bytes, 'ym2151', settleCycles !== undefined ? { settleCycles } : undefined);
  const chip = new Ym2151();
  const sorted = [...decoded.writes].sort((a, b) => a.at - b.at);
  const runTo = decoded.cycles + 256;
  let next = 0;
  for (let cycle = 0; cycle < runTo; cycle += 2) {
    while (next < sorted.length && sorted[next].at <= cycle) {
      chip.write(sorted[next].addr & 1, sorted[next].value & 0xff);
      next++;
    }
    chip.clock();
  }
  const result = new Map();
  for (const slot of expected.keys()) result.set(slot, chip.sl_tl[slot]);
  return result;
}

const withOldGap = finalTl(4);
const lostWithOldGap = [...expected].filter(([slot, value]) => withOldGap.get(slot) !== value);
assert.ok(
  lostWithOldGap.length > 0,
  `expected settleCycles: 4 (the old, unconditional default) to lose at least one of ${SLOTS} dense zero-wait writes, lost none`,
);

const withDefaultGap = finalTl();
const lostWithDefaultGap = [...expected].filter(([slot, value]) => withDefaultGap.get(slot) !== value);
assert.deepEqual(
  lostWithDefaultGap,
  [],
  `expected the decoder's own default settleCycles to land every one of ${SLOTS} dense zero-wait writes, lost slot(s) ${lostWithDefaultGap.map(([slot]) => slot).join(', ')}`,
);

console.log(
  `ok - ym2151-vgm-settle: a dense run of ${SLOTS} zero-wait 0x54 commands loses ${lostWithOldGap.length}/${SLOTS} writes at the old settleCycles: 4, 0/${SLOTS} at the decoder's own default`,
);
