import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildInputs } from './inputs.mjs';
import { compareEngines } from './compare.mjs';
import { renderParityEngineHash } from './provenance.mjs';

/**
 * MIX-14's CI-fast gate: Node against Chromium only. Firefox and WebKit need
 * binaries CI does not install (only `chromium`, same as the `browser`
 * job); running the full matrix is `pnpm render-parity:sheet`, for a person
 * to run locally and commit into `docs/RENDER-PARITY.md`. That doc also
 * records exactly what still needs a physical phone and real Safari.
 */
const root = resolve(import.meta.dirname, '../..');
let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const inputs = await buildInputs();
console.log(`Rendering ${inputs.length} fixed inputs in Node and Chromium...`);
const report = await compareEngines(inputs, ['chromium']);

for (const failure of report.selfCheckFailures) check(`node self-determinism: ${failure.id}`, false, JSON.stringify(failure));
if (report.selfCheckFailures.length === 0) check('node self-determinism: all inputs', true, `${report.node.length} inputs`);

const chromium = report.engines.chromium;
check('chromium launched', chromium.installed, chromium.installed ? chromium.version : chromium.reason);
if (chromium.installed) {
  for (const row of chromium.rows) {
    check(`chromium matches node: ${row.id}`, row.match, row.match ? '' : `sha256 ${row.sha256?.slice(0, 12)}`);
    if (row.diagnosis) console.log(`  diagnosis: first differing sample ${row.diagnosis.firstSample}, max abs difference ${row.diagnosis.maxDelta}, rms error ${row.diagnosis.rmsError}`);
  }
}

const fixturePath = resolve(root, 'apps/web/public/render-parity-data/inputs.json');
try {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const currentHash = await renderParityEngineHash();
  check('published render-parity fixture is current', fixture.engineSha256 === currentHash, fixture.engineSha256 === currentHash ? '' : 'run `pnpm render-parity:sheet` to regenerate it');
} catch (error) {
  check('published render-parity fixture is readable', false, error.message);
}

console.log(failures === 0 ? '\nPASS render parity (node vs chromium)' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
