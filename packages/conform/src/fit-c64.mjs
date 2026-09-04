import { combinedWaveform, COMBINED_6581 } from 'chipvoice';
import { residfp } from './oracles/residfp.mjs';

/**
 * Fits the SID's combined-waveform model against the oracle's tables.
 *
 *   node src/fit-c64.mjs            # score the parameters the chip ships
 *   node src/fit-c64.mjs --search   # look for better ones from where they are
 *
 * The model has six numbers per combination and 4096 entries to match; the
 * search is a coordinate descent on each number with a shrinking step,
 * which is enough for a fit that starts near. Prints one line per
 * combination: how many entries match, and the parameters.
 */
const tables = residfp.tables();
const search = process.argv.includes('--search');
const KEYS = ['bias', 'pull', 'top', 'below', 'above', 'mix'];

function score(model, wf) {
  const table = tables[wf];
  let ok = 0;
  for (let i = 0; i < 4096; i++) if (combinedWaveform(model, wf, i) === table[i]) ok++;
  return ok;
}

const results = {};
for (const wf of [3, 5, 6, 7]) {
  let model = { ...COMBINED_6581[wf] };
  let best = score(model, wf);
  if (search) {
    for (let step = 0.05; step > 0.0002; step /= 2) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const key of KEYS) {
          for (const delta of [step, -step]) {
            const candidate = { ...model, [key]: Number((model[key] + delta).toFixed(6)) };
            const s = score(candidate, wf);
            if (s > best) {
              best = s;
              model = candidate;
              improved = true;
            }
          }
        }
      }
    }
  }
  results[wf] = { match: best, model };
  console.log(`waveform ${wf}: ${best}/4096 match (${((100 * best) / 4096).toFixed(2)} %)  ${JSON.stringify(model)}`);
}
