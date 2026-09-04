import fs from 'node:fs';
import path from 'node:path';
import { chip2a03 } from './chips/2a03.mjs';
import { nesSndEmu } from './oracles/nes-snd-emu.mjs';
import { parseLog } from './log.mjs';
import { compare, dump } from './compare.mjs';

/**
 * conform: the harness.
 *
 *   conform <chip> --corpus <dir> --oracle <id> [--voices p1,p2,tri]
 *                  [--only <name>] [--json <file>] [--sheet <file>] [--report]
 *                  [--dump <voice>] [--baseline <file> [--write-baseline]]
 *
 * Every log in the corpus is run through the chip and through the oracle,
 * and their change streams are compared. One line per log says how many
 * cycles were identical and where the first divergence is, in a form a
 * person can act on without a debugger: the cycle, the voice, both values.
 * `--json` writes the numbers; `--sheet` writes them into the chip's sheet
 * between its parity markers. The exit code is 1 on any divergence unless
 * `--report` is given, or unless a `--baseline` is given, in which case it is
 * 1 only when a log's identical count fell below the baseline's: the check CI
 * runs, since an imperfect oracle diverges somewhere by design.
 */
const CHIPS = { '2a03': chip2a03 };
const ORACLES = { 'nes-snd-emu': nesSndEmu };

const args = process.argv.slice(2);
const chipId = args[0];
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const chip = CHIPS[chipId];
if (!chip) {
  console.error(`usage: conform <${Object.keys(CHIPS).join('|')}> --corpus <dir> --oracle <${Object.keys(ORACLES).join('|')}>`);
  process.exit(2);
}
const oracle = ORACLES[option('oracle', 'nes-snd-emu')];
const corpusDir = option('corpus', `corpus/${chipId}`);
const voiceNames = (option('voices', oracle.trusted.join(',')) ?? '').split(',').filter(Boolean);
const voices = voiceNames.map((n) => {
  const i = chip.voices.indexOf(n);
  if (i < 0) throw new Error(`no voice ${n} on ${chipId}`);
  return i;
});
const only = option('only', null);

const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.log') && (!only || f.includes(only))).sort();
if (files.length === 0) {
  console.error(`no logs in ${corpusDir}`);
  process.exit(2);
}

console.log(`${chip.id} against ${oracle.name}, on ${voiceNames.join(' ')}\n`);
const results = [];
let anyDivergence = false;
for (const file of files) {
  const log = parseLog(fs.readFileSync(path.join(corpusDir, file), 'utf8'));
  const ours = chip.trace(log.writes, log.cycles);
  const theirs = oracle.trace(log.writes, log.cycles);
  const result = compare(ours, theirs, { cycles: log.cycles, voices });
  const pct = (100 * result.identical) / result.cycles;
  const name = file.replace(/\.log$/, '');
  const edges = result.perVoice
    .map((e) => {
      const v = chip.voices[e.voice];
      const ident = ((100 * e.identical) / result.cycles).toFixed(2);
      const shift = e.shift !== 0 && e.aligned > e.exact ? `, ${e.aligned}/${e.b} at shift ${e.shift > 0 ? '+' : ''}${e.shift}` : '';
      const runs = e.runs.ours > 0 ? `, runs ${e.runs.ours}: ${e.runs.alignedTimes} on times, ${e.runs.alignedValues} on values, shift <= ${e.runs.maxShift}` : '';
      return `${v} ${ident}% ${e.exact}=${e.near}~${e.onlyA + e.onlyB}!${shift}${runs}`;
    })
    .join('  ');
  const dumpVoice = option('dump', null);
  if (dumpVoice && result.first) {
    const v = chip.voices.indexOf(dumpVoice);
    const f = result.perVoice.find((e) => e.voice === v);
    console.log(`\n${name}, ${dumpVoice} around cycle ${result.first.cycle} (ours | oracle)\n` + dump(ours, theirs, v, result.first.cycle) + '\n');
    void f;
  }
  if (result.first) {
    anyDivergence = true;
    const f = result.first;
    console.log(
      `FAIL  ${name.padEnd(24)} ${pct.toFixed(4).padStart(9)} %  first at cycle ${f.cycle}, ${chip.voices[f.voice]}: ours ${f.a}, oracle ${f.b}   ${edges}`,
    );
  } else {
    console.log(`PASS  ${name.padEnd(24)} ${pct.toFixed(4).padStart(9)} %   ${edges}`);
  }
  results.push({
    name,
    source: log.source ?? null,
    writes: log.writes.length,
    cycles: result.cycles,
    identical: result.identical,
    first: result.first,
    edges: result.perVoice.map((e) => ({ ...e, voice: chip.voices[e.voice] })),
  });
}

const totalCycles = results.reduce((s, r) => s + r.cycles, 0);
const totalIdentical = results.reduce((s, r) => s + r.identical, 0);
const summary = {
  chip: chip.id,
  oracle: { id: oracle.id, name: oracle.name },
  voices: voiceNames,
  date: new Date().toISOString().slice(0, 10),
  files: results.length,
  cycles: totalCycles,
  identical: totalIdentical,
  diverging: results.filter((r) => r.first).length,
  results,
};
console.log(
  `\n${results.length} logs, ${totalCycles} cycles, ${totalIdentical} identical (${((100 * totalIdentical) / totalCycles).toFixed(4)} %), ${summary.diverging} diverging`,
);
console.log('per voice: identical %; edges exact= near~ unmatched!; the constant shift that lines the most edges up; runs of edges, and how many line up under a shift of their own on step times and on values');

/*
 * The baseline: parity must not regress.
 *
 * A run with an imperfect oracle diverges somewhere by design, so "no
 * divergence" cannot be what CI checks. What it checks is that no log's
 * identical count fell below the last committed run, per voice. Improving is
 * fine and expected; the baseline is rewritten by hand with --write-baseline
 * when a change is meant, and the diff of it is the change's evidence.
 */
const baselinePath = option('baseline', null);
let regressed = false;
if (baselinePath && fs.existsSync(baselinePath) && !flag('write-baseline')) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  for (const r of results) {
    const was = baseline.results.find((b) => b.name === r.name);
    if (!was) continue;
    for (const e of r.edges) {
      const then = was.edges.find((b) => b.voice === e.voice);
      if (then && e.identical < then.identical) {
        regressed = true;
        console.log(`REGRESSION  ${r.name} ${e.voice}: ${e.identical} identical cycles, was ${then.identical}`);
      }
    }
  }
  if (!regressed) console.log(`no regression against ${baselinePath}`);
}
if (baselinePath && flag('write-baseline')) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`baseline written to ${baselinePath}`);
}

const jsonPath = option('json', null);
if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n');
}

const sheetPath = option('sheet', null);
if (sheetPath) writeSheet(sheetPath, summary, chip);

process.exit(regressed || (anyDivergence && !flag('report') && !baselinePath) ? 1 : 0);

/**
 * Replaces the block between `<!-- parity:begin -->` and `<!-- parity:end -->`
 * in a sheet with the numbers. The prose around it stays a person's.
 */
function writeSheet(file, summary, chip) {
  const text = fs.readFileSync(file, 'utf8');
  const begin = text.indexOf('<!-- parity:begin -->');
  const end = text.indexOf('<!-- parity:end -->');
  if (begin < 0 || end < 0) throw new Error(`${file} has no parity markers`);
  const pct = (n, d) => (d === 0 ? '0' : ((100 * n) / d).toFixed(4));
  const lines = [
    '<!-- parity:begin -->',
    `Written by \`conform\` on ${summary.date}, against ${summary.oracle.name}, on ${summary.voices.join(', ')}.`,
    '',
    '| | |',
    '| --- | --- |',
    `| Oracle | ${summary.oracle.name} |`,
    `| Corpus | ${summary.files} logs, ${summary.cycles} cycles |`,
    `| Identical cycles | ${summary.identical} / ${summary.cycles} (${pct(summary.identical, summary.cycles)} %) |`,
    `| Logs with a divergence | ${summary.diverging} |`,
    '',
    '| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of summary.results) {
    const first = r.first
      ? `cycle ${r.first.cycle}, ${chip.voices[r.first.voice]}: ours ${r.first.a}, oracle ${r.first.b}`
      : 'none';
    const edges = r.edges
      .map((e) => `${e.voice} ${pct(e.identical, r.cycles)} %, ${e.exact}/${e.near}/${e.onlyA + e.onlyB}${e.shift !== 0 && e.aligned > e.exact ? ` (${e.aligned} at ${e.shift > 0 ? '+' : ''}${e.shift})` : ''}${e.runs.ours > 0 ? `; runs ${e.runs.ours}: ${e.runs.alignedTimes} on times, ${e.runs.alignedValues} on values, shift <= ${e.runs.maxShift}` : ''}`)
      .join('; ');
    lines.push(`| ${r.name} | ${pct(r.identical, r.cycles)} % | ${first} | ${edges} |`);
  }
  lines.push('<!-- parity:end -->');
  fs.writeFileSync(file, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- parity:end -->'.length));
}
