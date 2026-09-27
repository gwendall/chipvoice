import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildInputs } from './inputs.mjs';
import { compareEngines } from './compare.mjs';
import { renderParityEngineHash } from './provenance.mjs';

/**
 * MIX-14's gate: Node against every named browser engine, all three
 * (Chromium, Firefox, WebKit) by default. In CI (`process.env.CI`) a
 * missing engine is a failure - `.github/workflows/ci.yml`'s `render-parity`
 * job installs all three, so a missing one there means the install step
 * itself broke, not a person's workstation choosing not to bother. Locally,
 * a missing engine is only a warning, so `pnpm render-parity:check chromium`
 * (or any subset, from `process.argv`) still works without installing the
 * rest.
 *
 *   pnpm render-parity:check              # all three
 *   node scores/render-parity/check.mjs chromium firefox
 */
const root = resolve(import.meta.dirname, '../..');
const isCI = process.env.CI === 'true' || process.env.CI === '1';
const engineNames = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];

let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const inputs = await buildInputs();
console.log(`Rendering ${inputs.length} fixed inputs in Node and ${engineNames.join(', ')}...`);
const report = await compareEngines(inputs, engineNames);

for (const failure of report.selfCheckFailures) check(`node self-determinism: ${failure.id}`, false, JSON.stringify(failure));
if (report.selfCheckFailures.length === 0) check('node self-determinism: all inputs', true, `${report.node.length} inputs`);

for (const engineName of engineNames) {
  const engine = report.engines[engineName];
  if (!engine.installed) {
    // In CI every named engine was just installed by the workflow, so a
    // missing one is a real failure, not a shrug. Locally it usually just
    // means `pnpm exec playwright install <engine>` was never run.
    if (isCI) check(`${engineName} launched`, false, engine.reason);
    else console.log(`WARN  ${engineName} not installed locally (${engine.reason}); skipping it. Run \`pnpm exec playwright install ${engineName}\` to add it.`);
    continue;
  }
  check(`${engineName} launched`, true, engine.version);
  for (const row of engine.rows) {
    check(`${engineName} matches node: ${row.id}`, row.match, row.match ? '' : `sha256 ${row.sha256?.slice(0, 12)}`);
    if (row.diagnosis) console.log(`  diagnosis: first differing sample ${row.diagnosis.firstSample}, max abs difference ${row.diagnosis.maxDelta}, rms error ${row.diagnosis.rmsError}`);
  }
}

const fixturePath = resolve(root, 'apps/web/public/render-parity-data/inputs.json');
try {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const currentHash = await renderParityEngineHash();
  check('published render-parity fixture is current', fixture.engineSha256 === currentHash, fixture.engineSha256 === currentHash ? '' : 'run `pnpm render-parity:fixture` to regenerate it');
} catch (error) {
  check('published render-parity fixture is readable', false, error.message);
}

console.log(failures === 0 ? `\nPASS render parity (node vs ${engineNames.join(', ')})` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
