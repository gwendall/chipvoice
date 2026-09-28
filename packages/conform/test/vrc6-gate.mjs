import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chipVrc6, chipVrc6Combined } from '../src/chips/vrc6.mjs';
import { gameMusicEmu } from '../src/oracles/game-music-emu.mjs';
import { mesenVrc6 } from '../src/oracles/mesen-vrc6.mjs';
import { parseLog } from '../src/log.mjs';
import { compare } from '../src/compare.mjs';
import { ChangeStream } from '../src/change-stream.mjs';

/**
 * NEXT-14 round 2's own instruction: "Add a negative test per gate, run in
 * CI" - a cheap proof that each of VRC6's three exact gates
 * (`check:vrc6-core`, `check:vrc6-core-mesen`, `check:vrc6-edge-mesen`) would
 * actually catch a real regression, not pass only because nothing in the
 * corpus happens to exercise the path a bug would break.
 *
 * `cli.mjs` (the thing these three `package.json` scripts run) always feeds
 * the SAME parsed log to both `chip.trace()` and `oracle.trace()` - there is
 * no argv this test could pass it to make the two sides see different
 * writes, so a corruption applied to the log FILE and run once through
 * `cli.mjs` corrupts both sides identically and proves nothing (tried first;
 * see the corruption comment below for the specific case that silently
 * passed). This test instead calls `chip.trace()` and `oracle.trace()`
 * directly - the same two functions and the same `compare()` every gate
 * script is built from - one on the corpus log's own writes, the other on a
 * deliberately corrupted copy, and asserts `compare()` finds a divergence.
 * That is precisely what a real regression in the chip (or a break in the
 * oracle wrapper) would look like from the harness's own point of view: one
 * side no longer agreeing with the log the other side was given.
 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const GATES = [
  { name: 'check:vrc6-core (Game_Music_Emu)', chip: chipVrc6, oracle: gameMusicEmu, log: 'corpus/vrc6/core/pulse-levels.log' },
  { name: 'check:vrc6-core-mesen (Mesen 2)', chip: chipVrc6Combined, oracle: mesenVrc6, log: 'corpus/vrc6/core/pulse-levels.log' },
  { name: 'check:vrc6-edge-mesen (Mesen 2)', chip: chipVrc6Combined, oracle: mesenVrc6, log: 'corpus/vrc6/edge/saw-enable.log' },
];

/**
 * Flips bit 7 - the E (enable) bit every period-hi write in this corpus
 * packs alongside the period's own top nibble (`periodWrites()`,
 * `generate-vrc6.mjs`) - of the LAST write in the log, turning that
 * channel's final "stay enabled"/"stay disabled" state into its opposite for
 * the log's whole tail. Deliberately not a blanket bit-flip of the byte: an
 * earlier version of this test flipped every bit of `core/saw-rates.log`'s
 * last write (`$B000 = $3F`, the rate register) to `$C0` and found nothing
 * diverged, because both sides mask a rate register to 6 bits and `$3F`
 * (all six set) and `$C0` (none of the six set, after masking `$FF ^ $3F`'s
 * complement) both collapse to a rate of 0 - a real but unhelpful case for a
 * test that needs a guaranteed-visible divergence, not just a guaranteed
 * change of bytes on the wire.
 */
function corruptLastWrite(writes) {
  const copy = writes.map((w) => ({ ...w }));
  const last = copy.length - 1;
  assert.ok(last >= 0, 'expected at least one write to corrupt');
  copy[last].value = (copy[last].value ^ 0x80) & 0xff;
  return copy;
}

for (const gate of GATES) {
  const log = parseLog(fs.readFileSync(path.join(ROOT, gate.log), 'utf8'));

  const clean = ChangeStream.from(await gate.oracle.trace(log.writes, log.cycles, log.memory));
  const cleanOurs = ChangeStream.from(await gate.chip.trace(log.writes, log.cycles, log.memory));
  const cleanResult = compare(cleanOurs, clean, { cycles: log.cycles, voices: gate.oracle.trusted.map((n) => gate.chip.voices.indexOf(n)) });
  assert.equal(cleanResult.first, null, `${gate.name}: the unmodified log must not diverge`);

  const corrupted = corruptLastWrite(log.writes);
  const dirtyOurs = ChangeStream.from(await gate.chip.trace(log.writes, log.cycles, log.memory));
  const dirtyOracle = ChangeStream.from(await gate.oracle.trace(corrupted, log.cycles, log.memory));
  const dirtyResult = compare(dirtyOurs, dirtyOracle, { cycles: log.cycles, voices: gate.oracle.trusted.map((n) => gate.chip.voices.indexOf(n)) });
  assert.notEqual(dirtyResult.first, null, `${gate.name}: a one-sided corrupted write must diverge`);

  console.log(`ok - ${gate.name}: exact gate passes clean, catches a one-sided corrupted write`);
}
