import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chipYm2151 } from '../src/chips/ym2151.mjs';
import { nukedOpm } from '../src/oracles/nuked-opm.mjs';
import { parseLog } from '../src/log.mjs';
import { compare } from '../src/compare.mjs';
import { ChangeStream } from '../src/change-stream.mjs';

/**
 * The same shape as `ay8910-gate.mjs`/`vrc6-gate.mjs`: a cheap proof that
 * `check:ym2151-core` and `check:ym2151-edge` (the only two exact gates this
 * chip has - `check:ym2151-*-ymfm-report` is `--report` only, decision 48,
 * and gets no negative test for the same reason `ay8910-gate.mjs` gives its
 * own report-only oracle none) would actually catch a real regression, not
 * pass only because the corpus happens not to exercise the path a bug would
 * break. Calls `chip.trace()`/`oracle.trace()` directly - what
 * `check:ym2151-*` is built from - on a clean log and again with the oracle
 * side fed a copy with one write corrupted, and asserts `compare()` finds no
 * divergence for the clean pair and a divergence for the corrupted one.
 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const GATES = [
  { name: 'check:ym2151-core', chip: chipYm2151, oracle: nukedOpm, log: 'corpus/ym2151/core/algorithms.log' },
  { name: 'check:ym2151-edge', chip: chipYm2151, oracle: nukedOpm, log: 'corpus/ym2151/edge/tl-ar-extremes.log' },
];

/**
 * Flips the low nibble of the first data-port write (`addr` 1), not the
 * log's own last entry: this chip's writes come in address/data pairs
 * (`vgm.mjs`'s `ym2151VgmToWrites`), and a write near the end of the log is
 * often too close to the log's end for a changed register to produce any
 * further DAC change before `cycles` runs out. The first data byte still has
 * every later write and the whole rest of the log to diverge over. XOR-ing
 * all four low bits is guaranteed to change the byte, the same reasoning
 * `ay8910-gate.mjs` uses for its own low-nibble flip.
 */
function corruptFirstDataWrite(writes) {
  const copy = writes.map((w) => ({ ...w }));
  const i = copy.findIndex((w) => w.addr === 1);
  assert.ok(i >= 0, 'expected at least one data-port write to corrupt');
  copy[i].value = (copy[i].value ^ 0x0f) & 0xff;
  return copy;
}

for (const gate of GATES) {
  const log = parseLog(fs.readFileSync(path.join(ROOT, gate.log), 'utf8'));
  const voices = gate.oracle.trusted.map((n) => gate.chip.voices.indexOf(n));

  const clean = ChangeStream.from(await gate.oracle.trace(log.writes, log.cycles, log.memory));
  const cleanOurs = ChangeStream.from(await gate.chip.trace(log.writes, log.cycles, log.memory));
  const cleanResult = compare(cleanOurs, clean, { cycles: log.cycles, voices });
  assert.equal(cleanResult.first, null, `${gate.name}: the unmodified log must not diverge`);

  const corrupted = corruptFirstDataWrite(log.writes);
  const dirtyOurs = ChangeStream.from(await gate.chip.trace(log.writes, log.cycles, log.memory));
  const dirtyOracle = ChangeStream.from(await gate.oracle.trace(corrupted, log.cycles, log.memory));
  const dirtyResult = compare(dirtyOurs, dirtyOracle, { cycles: log.cycles, voices });
  assert.notEqual(dirtyResult.first, null, `${gate.name}: a one-sided corrupted write must diverge`);

  console.log(`ok - ${gate.name}: exact gate passes clean, catches a one-sided corrupted write`);
}
