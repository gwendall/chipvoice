import { buildInputs } from './inputs.mjs';
import { compareEngines } from './compare.mjs';

/**
 * Proves the render-parity gate actually catches a real difference, instead
 * of only ever reporting PASS because nothing has diverged yet. Corrupts one
 * float, at a known index, in one named input's browser render only -
 * through `harness.html`'s `selfTestPerturb` query flag, which nothing in a
 * normal `check.mjs`/`sheet.mjs` run ever sets - and asserts three things:
 * the perturbed row is reported as a mismatch, its diagnosis names exactly
 * that sample index as the first difference, and every other input still
 * matches (the corruption is scoped to the one input asked for, not a
 * broken comparison that would fail everything).
 *
 *   pnpm render-parity:self-test
 */
const engineName = process.argv[2] ?? 'chromium';
let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const inputs = await buildInputs();
const perturb = { id: inputs[0].id, sampleIndex: 100, channel: 'left', delta: 0.25 };

console.log(`Rendering ${inputs.length} fixed inputs in Node and ${engineName}, with sample ${perturb.sampleIndex} of "${perturb.id}" deliberately perturbed by ${perturb.delta} in the browser...`);
const report = await compareEngines(inputs, [engineName], { perturb });

const engine = report.engines[engineName];
if (!engine.installed) {
  console.log(`FAIL  ${engineName} not installed (${engine.reason}); the self-test needs it to prove the gate bites`);
  process.exit(1);
}

const perturbedRow = engine.rows.find(r => r.id === perturb.id);
const otherRows = engine.rows.filter(r => r.id !== perturb.id);

check('perturbed input is reported as a mismatch', !!perturbedRow && !perturbedRow.match);
check('diagnosis names the perturbed sample as the first difference', perturbedRow?.diagnosis?.firstSample === perturb.sampleIndex, `got ${perturbedRow?.diagnosis?.firstSample}, expected ${perturb.sampleIndex}`);
check('diagnosis reports a nonzero max difference', (perturbedRow?.diagnosis?.maxDelta ?? 0) > 0, `got ${perturbedRow?.diagnosis?.maxDelta}`);
check('every other input still matches (the perturbation is scoped to one input)', otherRows.every(r => r.match), `${otherRows.filter(r => !r.match).length}/${otherRows.length} unexpectedly mismatched`);

console.log(failures === 0
  ? `\nPASS render-parity self-test: a single perturbed sample in ${engineName} is caught and correctly diagnosed`
  : `\n${failures} FAILURE(S): the render-parity gate did not catch its own planted difference`);
process.exit(failures === 0 ? 0 : 1);
