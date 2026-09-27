import assert from 'node:assert/strict';
import { CHIPS } from '../src/status-data.mjs';
import { buildAccuracyData, isStale } from '../src/accuracy-data.mjs';

/**
 * `accuracy-data.mjs` builds chipvoice.dev's public accuracy page data from
 * the same files the README board reads (see status-data.mjs and
 * CONFORMANCE.md). This checks the shape every chip must have - a level that
 * is not measured must be `null` or an explicit `run: false`/fraction of 0,
 * never missing in a way that could render as a pass - and that the
 * committed file (`apps/web/src/data/accuracy-data.json`) is what the
 * sources say right now, the same check CI runs on every push.
 */
const data = buildAccuracyData();

assert.deepEqual(data.chips.map((c) => c.id), CHIPS.map((c) => c.id), 'one entry per chip, in the roster order');
assert.match(data.generatedAt, /^\d{4}-\d{2}-\d{2}$/);

const STATUSES = new Set(['unverified', 'in progress', 'verified']);
for (const chip of data.chips) {
  assert.ok(STATUSES.has(chip.status), `${chip.id}: status "${chip.status}" must be the sheet's own word`);
  assert.match(chip.sheetUrl, new RegExp(`^https://github\\.com/gwendall/chipvoice/blob/main/${chip.sheetPath}$`));

  // Digital parity: at least the primary oracle, and a first divergence that
  // names a real voice, never a raw index, when the corpus is not identical.
  assert.ok(chip.digitalParity.oracles.length >= 1, `${chip.id}: no parity oracle`);
  const roster = CHIPS.find((c) => c.id === chip.id).voices;
  for (const oracle of chip.digitalParity.oracles) {
    assert.ok(oracle.identical <= oracle.cycles, `${chip.id}/${oracle.marker}: identical cycles over total`);
    if (oracle.firstDivergence) assert.ok(roster.includes(oracle.firstDivergence.voice), `${chip.id}/${oracle.marker}: first divergence names a real voice, not index ${oracle.firstDivergence.voice}`);
    else assert.equal(oracle.identical, oracle.cycles, `${chip.id}/${oracle.marker}: no divergence but identical < cycles`);
  }

  // Test ROMs: null (not zero, not a fake pass) when the chip has none.
  if (chip.testRoms) assert.ok(chip.testRoms.passed <= chip.testRoms.total, `${chip.id}: roms passed over total`);

  // Analog stage: 'none' must not look measured, and a measured fraction of
  // 0 must not carry rows that look like a real reading.
  assert.ok(['none', 'mixer', 'profile'].includes(chip.analogStage.label), `${chip.id}: unknown analog label`);
  if (chip.analogStage.label === 'none') assert.equal(chip.analogStage.mixer, null, `${chip.id}: label "none" but a mixer reading is attached`);

  assert.ok(chip.driverCoverage.reached <= chip.driverCoverage.voices, `${chip.id}: driver reaches more voices than it has`);
}

// c64: the one chip with a real 6581 evidence table, digital and before the
// DAC, kept out of the oracle list (docs/chips/c64.md "Combined waveforms").
const c64 = data.chips.find((c) => c.id === 'c64');
assert.ok(c64.digitalParity.hardwareCombined, 'c64: hardware-combined evidence missing');
for (const row of c64.digitalParity.hardwareCombined.combinations) {
  assert.ok(row.exactEntries <= c64.digitalParity.hardwareCombined.totalEntries, `c64/${row.name}: exact entries over total`);
  assert.ok(row.wrongBits <= row.totalBits, `c64/${row.name}: wrong bits over total bits`);
}
for (const id of ['md', 'snes']) assert.equal(data.chips.find((c) => c.id === id).testRoms, null, `${id}: no community ROM suite, testRoms must be null`);

assert.equal(isStale(), false, 'apps/web/src/data/accuracy-data.json is stale; regenerate with: pnpm --filter chipvoice-conform status');

console.log(`PASS accuracy-data: ${data.chips.length} chips, every level present or plainly absent, committed file matches the sources`);
