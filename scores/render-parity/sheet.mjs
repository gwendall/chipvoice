import { execFileSync } from 'node:child_process';
import { buildInputs } from './inputs.mjs';
import { compareEngines } from './compare.mjs';
import { writeRenderParityDocs } from './write-doc.mjs';

/**
 * The full local MIX-14 matrix: Node against Chromium, Firefox and WebKit.
 * Firefox and WebKit need their binaries installed once
 * (`pnpm exec playwright install firefox webkit`); a browser without a
 * binary is reported as not installed rather than failing the run, so this
 * still produces a sheet with whatever engines are actually available.
 *
 *   pnpm render-parity:sheet
 */
const inputs = await buildInputs();
console.log(`Rendering ${inputs.length} fixed inputs in Node, Chromium, Firefox and WebKit...`);
const report = await compareEngines(inputs, ['chromium', 'firefox', 'webkit']);

if (report.selfCheckFailures.length) {
  console.error(`Node self-determinism failed for ${report.selfCheckFailures.length} input(s):`, report.selfCheckFailures);
  process.exit(1);
}

// Rebuilds the site's own fixture (a shorter excerpt, published for the lab
// page) so the sheet and what a visitor's browser checks stay in step.
await import('./build-fixture.mjs');

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// Written before the mismatch check below: a divergence belongs in the
// sheet, not hidden by exiting before it is recorded.
await writeRenderParityDocs(report, { revision, createdAt: new Date().toISOString(), webUrl: 'https://chipvoice.dev/lab/render-parity' });

let mismatchedEngines = 0;
for (const name of ['chromium', 'firefox', 'webkit']) {
  const engine = report.engines[name];
  if (!engine?.installed) { console.log(`${name}: not installed locally (${engine?.reason ?? 'skipped'})`); continue; }
  const mismatches = engine.rows.filter(r => !r.match).length;
  if (mismatches > 0) {
    mismatchedEngines++;
    for (const row of engine.rows.filter(r => !r.match)) {
      console.log(`  ${name} MISMATCH ${row.id}: sha256 ${row.sha256?.slice(0, 12)}${row.diagnosis ? `, first differing sample ${row.diagnosis.firstSample}, max abs difference ${row.diagnosis.maxDelta}` : ''}`);
    }
  }
  console.log(`${name} ${engine.version}: ${mismatches === 0 ? `all ${engine.rows.length} inputs match Node` : `${mismatches}/${engine.rows.length} mismatch`}`);
}

if (mismatchedEngines > 0) {
  console.log(`\nFAIL render-parity sheet: ${mismatchedEngines} engine(s) diverged from Node (written to docs/RENDER-PARITY.md and docs/RENDER-PARITY_ja.md anyway)`);
  process.exit(1);
}
console.log('\nPASS render-parity sheet written to docs/RENDER-PARITY.md and docs/RENDER-PARITY_ja.md');
