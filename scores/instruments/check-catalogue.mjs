import assert from 'node:assert/strict';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {catalogueEngineHash, catalogueEngineModules} from './provenance.mjs';

/**
 * The cheap half of the catalogue's CI gate: hash the built engine again (no
 * rendering) and compare it against what `apps/web/src/data/instrument-catalogue.json`
 * was measured with. A mismatch means a chip's core, driver or the
 * performance planner moved since `pnpm instruments:build` last ran, so the
 * committed numbers no longer describe what the engine actually does.
 */
const root = resolve(import.meta.dirname, '../..');
const dataFile = resolve(root, 'apps/web/src/data/instrument-catalogue.json');
const data = JSON.parse(await readFile(dataFile, 'utf8'));
assert.equal(await catalogueEngineHash(), data.engineSha256, 'the instrument catalogue matches the current engine and measurement method; run `pnpm instruments:build`');
assert.equal(data.presets.length, 89, 'the catalogue should have one row per preset the public API exposes');
console.log('PASS instrument catalogue provenance', data.presets.length, 'presets');

// The hash only earns "regenerate when it matters" if it actually reaches
// every chip generate.mjs renders and stays put when an unrelated file merely
// exists under chips/**. Prove both, not just assert a manifest match.
const modules = await catalogueEngineModules();
for (const expected of [
  'chips/nes/dsp.js', 'chips/nes/driver.js',
  'chips/gb/dsp.js', 'chips/gb/driver.js',
  'chips/md/driver.js', 'chips/md/ym2612.js', 'chips/md/sn76489.js',
  'chips/snes/driver.js', 'chips/snes/sdsp.js',
  'chips/c64/driver.js', 'chips/c64/sid.js',
  // The probe instruments and the planner/renderer the catalogue measures.
  'performance-palette.js', 'performance.js', 'render.js',
]) assert.ok(modules.includes(expected), `catalogue hash must reach ${expected}`);
console.log('PASS catalogue hash reaches every chip generate.mjs renders', modules.length, 'modules');

// A file under chips/** that nothing imports (a new chip's file-format
// player, dropped in by a sibling PR before anything wires it up) must not
// move the hash. Prove it by actually adding one to the built dist, not by
// reasoning about esbuild's tree-shaking from the outside.
const unusedFile = resolve(root, 'packages/chipvoice/dist/chips/snes/_catalogue-hash-proof-unused.js');
try {
  await writeFile(unusedFile, '// Nothing imports this file; it exists only to prove the catalogue hash ignores unreached modules.\nexport const unused=1;\n');
  assert.equal(await catalogueEngineHash(), data.engineSha256, 'an unreached file under chips/** must not move the catalogue hash');
} finally {
  await unlink(unusedFile).catch(() => {});
}
console.log('PASS an unreached file under chips/** leaves the catalogue hash unchanged');
