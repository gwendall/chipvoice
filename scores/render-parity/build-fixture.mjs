import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildInputs } from './inputs.mjs';
import { renderInputNode } from './node-render.mjs';
import { planToJSON } from './serialize.mjs';
import { renderParityEngineHash } from './provenance.mjs';

/**
 * Writes the fixture the render-parity lab page fetches: the fixed input set
 * (a shorter excerpt than the sheet's own, so a phone does not have to
 * download the full six seconds of every piece) plus Node's own reference
 * hash for each one. The page renders the same plans itself and reports
 * match or mismatch against these numbers - see `apps/web/src/lab/RenderParity.tsx`.
 */
const WEB_EXCERPT_SECONDS = 2;
const root = resolve(import.meta.dirname, '../..');
const outFile = resolve(root, 'apps/web/public/render-parity-data/inputs.json');

const inputs = await buildInputs({ excerptSeconds: WEB_EXCERPT_SECONDS });
const entries = inputs.map(input => {
  const { sha256, peak } = renderInputNode(input);
  return { id: input.id, kind: input.kind, chip: input.chip, title: input.title, seconds: input.plan.seconds, plan: planToJSON(input.plan), node: { sha256, peak } };
});

const fixture = {
  version: 1,
  // The revision alone identifies exactly which build this fixture came
  // from (it is what `check.mjs` compares against a fresh `renderParityEngineHash()`);
  // a regeneration timestamp would churn on every run without saying
  // anything the revision does not already say, so it is left out.
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  engineSha256: await renderParityEngineHash(),
  nodeVersion: process.version,
  sampleRate: 44100,
  inputs: entries,
};

await mkdir(resolve(root, 'apps/web/public/render-parity-data'), { recursive: true });
// Unindented: a phone fetches this file, and one number per line (the
// naive `JSON.stringify(fixture, null, 2)`) cost 166,000 lines and 3.1MB
// for no reason a person reading it needed - nobody hand-edits it either
// (build-fixture.mjs's own header says so).
const json = JSON.stringify(fixture);
await writeFile(outFile, json);
console.log(`PASS render-parity fixture: ${entries.length} inputs, ${(json.length / 1024).toFixed(0)}KB, written to ${outFile}`);
