import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chipAy8910, chipAy8910Gme } from '../src/chips/ay8910.mjs';
import { ayumi } from '../src/oracles/ayumi.mjs';
import { gameMusicEmuAy } from '../src/oracles/game-music-emu-ay.mjs';
import { parseLog } from '../src/log.mjs';
import { compare } from '../src/compare.mjs';
import { ChangeStream } from '../src/change-stream.mjs';

/**
 * NEXT-15's own version of `test/vrc6-gate.mjs`'s negative test: a cheap
 * proof that each of `Ay8910`'s exact gates (`check:ay8910-core`,
 * `check:ay8910-core-gme`, `check:ay8910-edge`) would actually catch a real
 * regression, not pass only because nothing in the corpus happens to
 * exercise the path a bug would break.
 *
 * Same shape as `vrc6-gate.mjs`: calls `chip.trace()` and `oracle.trace()`
 * directly (what every gate script is built from) on a clean log and again
 * with the oracle side fed a deliberately corrupted copy, and asserts
 * `compare()` finds no divergence for the clean pair and a divergence for
 * the corrupted one. There is no `check:ay8910-flat-*`-style mutated-oracle
 * test here: unlike VRC6's pulse duty (`Vrc6Pulse.h`'s "chipvoice patch"),
 * nothing in either oracle here was patched to match this core - decision
 * 47 exists precisely because that patching was rejected as an option for
 * the noise LFSR disagreement, so there is no convention-mapping line to
 * prove the gate depends on.
 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const GATES = [
  { name: 'check:ay8910-core (Ayumi)', chip: chipAy8910, oracle: ayumi, log: 'corpus/ay8910/core/channel-a.log' },
  { name: 'check:ay8910-core-gme (Game_Music_Emu Ay_Apu)', chip: chipAy8910Gme, oracle: gameMusicEmuAy, log: 'corpus/ay8910/core/channel-a.log' },
  { name: 'check:ay8910-edge (Ayumi)', chip: chipAy8910, oracle: ayumi, log: 'corpus/ay8910/edge/tone-sweep.log' },
];

/**
 * Flips the low nibble of the LAST write's value - not VRC6's own bit-7
 * "enable" flip, since none of `Ay8910`'s own 16 registers has a single
 * dedicated enable bit the way VRC6's period-hi byte does. Every one of
 * this chip's fields that matters to a `core`/`edge` corpus script lives at
 * least partly in the low nibble (the mixer's six gate bits, both volume
 * registers' 4-bit fixed level, the envelope shape's 4-bit field, the
 * period-hi registers' 4-bit high nibble, the noise period's 5-bit field),
 * and XOR-ing all four low bits of an N-bit field (N <= 4) is guaranteed to
 * change its masked value - flipping every bit of a nibble can never
 * reproduce the same nibble, unlike a single bit flip that a mask can
 * happen to discard (`vrc6-gate.mjs`'s own comment documents exactly that
 * failure mode for a single-bit corruption there).
 */
function corruptLastWrite(writes) {
  const copy = writes.map((w) => ({ ...w }));
  const last = copy.length - 1;
  assert.ok(last >= 0, 'expected at least one write to corrupt');
  copy[last].value = (copy[last].value ^ 0x0f) & 0xff;
  return copy;
}

for (const gate of GATES) {
  const log = parseLog(fs.readFileSync(path.join(ROOT, gate.log), 'utf8'));
  const voices = gate.oracle.trusted.map((n) => gate.chip.voices.indexOf(n));

  const clean = ChangeStream.from(await gate.oracle.trace(log.writes, log.cycles, log.memory));
  const cleanOurs = ChangeStream.from(await gate.chip.trace(log.writes, log.cycles, log.memory));
  const cleanResult = compare(cleanOurs, clean, { cycles: log.cycles, voices });
  assert.equal(cleanResult.first, null, `${gate.name}: the unmodified log must not diverge`);

  const corrupted = corruptLastWrite(log.writes);
  const dirtyOurs = ChangeStream.from(await gate.chip.trace(log.writes, log.cycles, log.memory));
  const dirtyOracle = ChangeStream.from(await gate.oracle.trace(corrupted, log.cycles, log.memory));
  const dirtyResult = compare(dirtyOurs, dirtyOracle, { cycles: log.cycles, voices });
  assert.notEqual(dirtyResult.first, null, `${gate.name}: a one-sided corrupted write must diverge`);

  console.log(`ok - ${gate.name}: exact gate passes clean, catches a one-sided corrupted write`);
}
