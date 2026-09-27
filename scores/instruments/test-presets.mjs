import assert from 'node:assert/strict';
import {buildPresets, CATALOGUE_CHIPS, DRUM_KEYS} from './presets.mjs';

// buildPresets() takes no randomness and no host input; the same built
// engine must give the same rows in the same order every time, since the
// site and the CI gate both depend on that to line an id up with its audio.
const a = buildPresets(), b = buildPresets();
assert.equal(a.length, b.length, 'buildPresets is deterministic in count');
assert.deepEqual(a, b, 'buildPresets is deterministic in content and order');

assert.equal(a.length, 89, 'one row per preset the public API exposes across all five chips');

const ids = a.map(p => p.id);
assert.equal(new Set(ids).size, ids.length, 'every preset id is unique');
for (const id of ids) assert.ok(/^[a-z0-9-]+$/.test(id), `${id} is a safe, lowercase, content-addressed filename stem`);

for (const chip of CATALOGUE_CHIPS) {
  const rows = a.filter(p => p.chip === chip.spec.id);
  for (const role of ['lead', 'chord', 'bass']) assert.ok(rows.some(p => p.role === role), `${chip.spec.id} has at least one ${role} preset`);
  const perc = rows.filter(p => p.role === 'perc');
  assert.equal(perc.length, Object.keys(DRUM_KEYS).length, `${chip.spec.id} has one preset per kit voice`);
  for (const token of Object.keys(DRUM_KEYS)) assert.ok(perc.some(p => p.token === token), `${chip.spec.id} has a ${token} preset`);
}

// Every melodic preset's representative program must itself resolve to the
// row's own instrument, and every program in its group must collapse onto
// that same instrument, or the row would misrepresent what a user actually
// picks. presets.mjs derives this from performanceInstrument() directly, so
// this doubles as a determinism check on that resolver, not just on grouping.
const {performanceInstrument} = await import('../../packages/chipvoice/dist/performance-palette.js');
for (const preset of a.filter(p => p.role !== 'perc')) {
  for (const program of preset.programs) {
    assert.deepEqual(performanceInstrument(preset.chip, preset.role, program), preset.instrument, `${preset.id}: program ${program} resolves to the group's instrument`);
  }
}

console.log('PASS instrument catalogue presets', a.length, 'presets,', ids.length, 'unique ids');
