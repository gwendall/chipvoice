import { buildInputs } from './inputs.mjs';
import { compareEngines } from './compare.mjs';

/**
 * The local cross-engine determinism gate: Node against every named browser
 * engine, all three (Chromium, Firefox, WebKit) by default. This is
 * local-only tooling, deliberately not wired into `.github/workflows/ci.yml`
 * (see docs/GAMESOUNDS-ENGINE.md's determinism section and this package's
 * brief) - a missing engine locally is only a warning, never a failure.
 * Mirrors scores/render-parity/check.mjs's shape, minus that file's
 * published-fixture-currency check (this package has no published site
 * fixture to keep in sync).
 *
 *   pnpm parity:check                 # all three
 *   node parity/check.mjs chromium firefox
 */
const isCI = process.env.CI === 'true' || process.env.CI === '1';
const engineNames = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];

let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const inputs = buildInputs();
console.log(`Rendering ${inputs.length} fixed inputs in Node and ${engineNames.join(', ')}...`);
const report = await compareEngines(inputs, engineNames);

for (const failure of report.selfCheckFailures) check(`node self-determinism: ${failure.id}`, false, JSON.stringify(failure));
if (report.selfCheckFailures.length === 0) check('node self-determinism: all inputs', true, `${report.node.length} inputs`);

for (const engineName of engineNames) {
  const engine = report.engines[engineName];
  if (!engine.installed) {
    if (isCI) check(`${engineName} launched`, false, engine.reason);
    else console.log(`WARN  ${engineName} not installed locally (${engine.reason}); skipping it. Run \`pnpm exec playwright install ${engineName}\` to add it.`);
    continue;
  }
  check(`${engineName} launched`, true, engine.version);
  let mismatches = 0;
  for (const row of engine.rows) {
    if (!row.match) mismatches++;
    check(`${engineName} matches node: ${row.id}`, row.match, row.match ? '' : `sha256 ${row.sha256?.slice(0, 12) ?? '(none)'}`);
    if (row.diagnosis) console.log(`  diagnosis: first differing sample ${row.diagnosis.firstSample}, max abs difference ${row.diagnosis.maxDelta}, rms error ${row.diagnosis.rmsError}`);
  }
  if (mismatches === 0) console.log(`  ${engineName}: 0/${engine.rows.length} mismatches`);
}

console.log(failures === 0 ? `\nPASS render parity (node vs ${engineNames.join(', ')}), ${inputs.length} inputs` : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
