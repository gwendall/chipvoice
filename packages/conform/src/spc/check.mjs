import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSpc, snesChip } from 'chipvoice';
import { chipSnes } from '../chips/snes.mjs';
import { spcCpuWrites, spcCpuSamples } from '../oracles/spc-cpu.mjs';
import { compare } from '../compare.mjs';
import { ChangeStream } from '../change-stream.mjs';

/**
 * check:spc - the one comparison `check:snes` cannot make.
 *
 *   node src/spc/check.mjs [--corpus <dir>]... [--only <name>] [--seconds <n>]
 *                          [--json <file>] [--sheet <file> [--marker spc]] [--report]
 *
 * `check:snes` (cli.mjs, oracle `snes-spc`) plays a register-write LOG
 * someone already produced, so it can only ever prove the S-DSP port itself
 * matches blargg's - it says nothing about the CPU, timers or snapshot
 * loader this ticket adds, since nothing upstream of the DSP is exercised.
 * This script starts from the actual `.spc` file instead, on both sides: our
 * own `importSpc` runs its new SPC700, and `play-spc` (built from the same
 * vendored snes_spc, but its real `SPC_CPU.h` this time, not just its S-DSP)
 * runs blargg's. Since the S-DSP itself is already known to match line for
 * line, any divergence found here can only come from the CPU, the timers or
 * the snapshot restore - which is the whole point of running it this way.
 *
 * Two things are compared, at the two levels the ticket asks for:
 *
 *  - The DSP register writes the CPU makes: sequence identity (register and
 *    value, in order) is the pass/fail signal. Cycle numbers are reported
 *    alongside for a person to read, not asserted equal in general: blargg's
 *    CPU "pre-charges" its cycle counter by a whole instruction's cost before
 *    running the instruction's body, so a write hook fired from inside, say,
 *    `MOV $F3,A`'s handler reports the cycle at the END of that instruction,
 *    while this package's own convention (documented in `spc700.ts`) is the
 *    cycle the write's own bus access is clocked on - a fixed, understood
 *    +1-for-the-last-access-of-an-instruction labelling difference, not a
 *    defect on either side (the CPU's own per-instruction cycle counts are
 *    checked directly, against Anomie's doc, in `packages/chipvoice/test/spc700.mjs`).
 *    `checkTimerPhase` below is the one exception: the corpus's
 *    `timer-phase.spc` (see its own README entry) exists specifically to
 *    exercise a timer counter read, and its cycle IS asserted there, exactly
 *    up to that same +1 - proof that `oracles/snes-spc/snes_spc/SNES_SPC.cpp`'s
 *    `fix_snapshot_timer_phase()` patch (DECISIONS.md #46) keeps holding,
 *    not just that the general per-file loop's content-only gate passes.
 *
 *  - The output samples: reusing `compare()` (compare.mjs), the same
 *    matched-cycles / first-divergence logic every other chip's check uses.
 *    This is the end-to-end number: it can only come out right if the
 *    snapshot was restored correctly AND the CPU drove the DSP correctly
 *    AND the DSP itself still matches, so it is the headline result.
 *
 * A default, committed corpus (`corpus/snes/spc`, redistributable files
 * only - see its README) plus any number of `--corpus <dir>` directories,
 * typically a local, gitignored one with real game rips for a person's own
 * testing; CI runs with only the default and never depends on the rest.
 */

const DEFAULT_CORPUS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../corpus/snes/spc');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.lastIndexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const optionAll = (name) => args.reduce((acc, a, i) => (a === `--${name}` ? [...acc, args[i + 1]] : acc), []);
const flag = (name) => args.includes(`--${name}`);

const corpusDirs = [DEFAULT_CORPUS, ...optionAll('corpus')];
const only = option('only', null);
const optionSeconds = option('seconds', null) ? Number(option('seconds', null)) : undefined;

/** Resolves `$F2`/`$F3` event pairs into `{ cycle, reg, value }`, exactly
 * the dispatch `chips/snes/dsp.ts`'s `SnesChip.write()` and play-spc's
 * `SPC_DSP_WRITE_HOOK` both apply: DSPADDR selects (masked to a byte),
 * DSPDATA writes the selected register when it names one that exists. */
function resolveWrites(events) {
  let selected;
  const writes = [];
  for (const e of events) {
    if (e.addr === 0xf2) selected = e.value & 0xff;
    else if (e.addr === 0xf3 && selected !== undefined && selected < 0x80) writes.push({cycle: e.at, reg: selected, value: e.value & 0xff});
  }
  return writes;
}

/** Sequence identity is the signal; cycles are reported, not asserted. */
function compareWrites(ours, oracle) {
  const n = Math.min(ours.length, oracle.length);
  let matched = 0;
  let first = null;
  while (matched < n && ours[matched].reg === oracle[matched].reg && ours[matched].value === oracle[matched].value) matched++;
  if (matched < ours.length || matched < oracle.length) {
    first = {index: matched, ours: ours[matched] ?? null, oracle: oracle[matched] ?? null};
  }
  return {oursCount: ours.length, oracleCount: oracle.length, matched, first};
}

// The same "+1 for the last access of an instruction" cycle-labelling
// difference this file's own top doc comment names - defined here too
// (check-export.mjs defines its own copy, for the same "not a dependency of
// each other" reason `resolveWrites` above already gives) so
// `checkTimerPhase` below can assert an exact number, not just describe one.
const KNOWN_WRITE_OFFSET = 1;

/**
 * The one exact cycle assertion this script makes: `corpus/snes/spc/
 * timer-phase.spc` (see its own README entry) is built so its single write
 * only happens once the CPU sees timer 0's counter turn non-zero - a direct
 * readout of the `fix_snapshot_timer_phase()` patch (SNES_SPC.cpp,
 * DECISIONS.md #46) this repository carries in the vendored oracle. A
 * correct oracle's write lands exactly `KNOWN_WRITE_OFFSET` cycles after
 * ours (the same benign label difference every other write in this corpus
 * already shows); the patch regressing would instead show the oracle's
 * write landing roughly 126 cycles too early, credited to the load-time
 * phantom prescaler period the patch removes. Returns `null` for any other
 * file - this is not a general-purpose check, only this fixture's own.
 */
function checkTimerPhase(file, oursWrites, oracleWrites) {
  if (path.basename(file) !== 'timer-phase.spc') return null;
  const ours = oursWrites[0] ?? null;
  const oracle = oracleWrites[0] ?? null;
  const diff = ours && oracle ? oracle.cycle - ours.cycle : null;
  return {ours, oracle, diff, ok: diff === KNOWN_WRITE_OFFSET};
}

let files = [];
for (const dir of corpusDirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.spc') && (!only || f.includes(only))).sort()) {
    files.push(path.join(dir, f));
  }
}
if (files.length === 0) {
  console.error(`no .spc files in ${corpusDirs.join(', ')}`);
  process.exit(2);
}

console.log(`chipvoice's SPC700 against play-spc (blargg's, from the same vendored snes_spc), on ${files.length} file(s)\n`);

const results = [];
let anyDivergence = false;
for (const file of files) {
  const name = path.relative(process.cwd(), file);
  const bytes = new Uint8Array(fs.readFileSync(file));
  const plan = importSpc(bytes, optionSeconds !== undefined ? {seconds: optionSeconds} : {});
  const cycles = Math.round(plan.seconds * snesChip.spec.clockHz);

  const oursWrites = resolveWrites(plan.events.slice(plan.restoreEvents));
  const oracleWrites = spcCpuWrites(bytes, cycles);
  const writes = compareWrites(oursWrites, oracleWrites);
  const timerPhase = checkTimerPhase(file, oursWrites, oracleWrites);

  const oursSamples = ChangeStream.from(chipSnes.trace(plan.events, cycles, plan.memory));
  const oracleSamples = ChangeStream.from(await spcCpuSamples(bytes, cycles));
  const samples = compare(oursSamples, oracleSamples, {cycles, voices: [0, 1]});

  const writesOk = writes.first === null && (timerPhase === null || timerPhase.ok);
  const samplesOk = samples.first === null;
  const pct = (100 * samples.identical) / samples.cycles;
  if (!writesOk || !samplesOk) anyDivergence = true;

  const line = [
    (writesOk && samplesOk ? 'PASS' : 'FAIL').padEnd(4),
    name.padEnd(28),
    `writes ${writes.matched}/${Math.max(writes.oursCount, writes.oracleCount)}`,
    `samples ${pct.toFixed(4)}%`,
  ];
  if (timerPhase) line.push(`timer-phase shim: ours ${fmtWrite(timerPhase.ours)}, oracle ${fmtWrite(timerPhase.oracle)} (diff ${timerPhase.diff}, expected ${KNOWN_WRITE_OFFSET})`);
  if (writes.first) line.push(`writes diverge at #${writes.first.index}: ours ${fmtWrite(writes.first.ours)}, oracle ${fmtWrite(writes.first.oracle)}`);
  if (timerPhase && !timerPhase.ok) line.push(`timer-phase shim regressed: expected the oracle's write ${KNOWN_WRITE_OFFSET} cycle(s) after ours, got ${timerPhase.diff}`);
  if (samples.first) line.push(`samples diverge at cycle ${samples.first.cycle} ${['left', 'right'][samples.first.voice]}: ours ${samples.first.a}, oracle ${samples.first.b}`);
  console.log(line.join('  '));

  results.push({
    name,
    seconds: plan.seconds,
    cycles,
    timerPhase,
    id666: plan.id666 ?? null,
    writes: {oursCount: writes.oursCount, oracleCount: writes.oracleCount, matched: writes.matched, first: writes.first},
    samples: {identical: samples.identical, cycles: samples.cycles, first: samples.first, perVoice: samples.perVoice.map((v) => ({...v, voice: ['left', 'right'][v.voice]}))},
  });
}

function fmtWrite(w) {
  return w ? `reg $${w.reg.toString(16).padStart(2, '0')} = $${w.value.toString(16).padStart(2, '0')} @ cycle ${w.cycle}` : '(none)';
}

const totalSampleCycles = results.reduce((s, r) => s + r.samples.cycles, 0);
const totalIdentical = results.reduce((s, r) => s + r.samples.identical, 0);
const summary = {
  date: new Date().toISOString().slice(0, 10),
  oracle: 'play-spc (blargg\'s SPC700, vendored snes_spc)',
  files: results.length,
  writesDiverging: results.filter((r) => r.writes.first).length,
  samplesCycles: totalSampleCycles,
  samplesIdentical: totalIdentical,
  samplesDiverging: results.filter((r) => r.samples.first).length,
  results,
};
console.log(
  `\n${results.length} file(s): ${summary.writesDiverging} with a write-sequence divergence, ` +
    `${totalIdentical}/${totalSampleCycles} sample cycles identical (${((100 * totalIdentical) / totalSampleCycles).toFixed(4)} %), ` +
    `${summary.samplesDiverging} with a sample divergence`,
);

const jsonPath = option('json', null);
if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n');
}

const sheetPath = option('sheet', null);
if (sheetPath) writeSheet(sheetPath, summary, option('marker', 'spc'));

process.exit(anyDivergence && !flag('report') ? 1 : 0);

/** Same convention as `cli.mjs`'s own `writeSheet`: replaces the block
 * between `<!-- <marker>:begin -->` and `<!-- <marker>:end -->`, never the
 * prose around it. */
function writeSheet(file, summary, marker) {
  const text = fs.readFileSync(file, 'utf8');
  const open = `<!-- ${marker}:begin -->`;
  const close = `<!-- ${marker}:end -->`;
  const begin = text.indexOf(open);
  const end = text.indexOf(close);
  if (begin < 0 || end < 0) throw new Error(`${file} has no ${marker} markers`);
  const pct = (n, d) => (d === 0 ? '0' : ((100 * n) / d).toFixed(4));
  const lines = [
    open,
    `Written by \`check:spc\` on ${summary.date}, against ${summary.oracle}.`,
    '',
    '| | |',
    '| --- | --- |',
    `| Files | ${summary.files} |`,
    `| Write-sequence divergences | ${summary.writesDiverging} |`,
    `| Sample cycles identical | ${summary.samplesIdentical} / ${summary.samplesCycles} (${pct(summary.samplesIdentical, summary.samplesCycles)} %) |`,
    `| Files with a sample divergence | ${summary.samplesDiverging} |`,
    '',
    '| File | Writes | Samples | First divergence |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of summary.results) {
    const writesCell = `${r.writes.matched}/${Math.max(r.writes.oursCount, r.writes.oracleCount)}`;
    const samplesCell = `${pct(r.samples.identical, r.samples.cycles)} %`;
    const first = r.writes.first
      ? `writes #${r.writes.first.index}: ours ${fmtWrite(r.writes.first.ours)}, oracle ${fmtWrite(r.writes.first.oracle)}`
      : r.samples.first
        ? `samples, cycle ${r.samples.first.cycle} ${['left', 'right'][r.samples.first.voice]}: ours ${r.samples.first.a}, oracle ${r.samples.first.b}`
        : 'none';
    lines.push(`| ${r.name} | ${writesCell} | ${samplesCell} | ${first} |`);
  }
  lines.push(close);
  fs.writeFileSync(file, text.slice(0, begin) + lines.join('\n') + text.slice(end + close.length));
}
