import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const report=JSON.parse(await readFile(process.argv[2]??'.artifacts/automatic-mixing/before/report.json'));
const value=(chip,part)=>report.measurements.find(r=>r.chip===chip&&r.part===part).metrics.rmsDbFS;
const source=value('2a03','tri')-value('2a03','p2'),target=value('md','tri')-value('md','p2');
console.log({sourceBassRelativeDb:source,targetBassRelativeDb:target,changeDb:target-source});
// This musical fixture retains source foreground, rather than requiring exact
// timbre or global RMS identity across unlike chips. General holdouts are separate.
assert.ok(target<0,'Zelda adaptation reverses the source foreground: bass dominates the melody');
