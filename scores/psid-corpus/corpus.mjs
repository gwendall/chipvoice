import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {importPsid} from '../../packages/chipvoice/dist/index.js';
import {comparePsidTrace, parseTrace} from './compare.mjs';
import {runOracle} from './native-oracle.mjs';

/**
 * Scores this corpus's PSID/RSID fixtures against the libsidplayfp oracle
 * (`native-oracle.mjs`), one file at a time - `../nsf-corpus/corpus.mjs`'s
 * own design, grown for PSID's own two-phase (INIT then PLAY) comparator
 * instead of NSF's single-shift one. See `compare.mjs`'s own doc comment
 * for what "matched" means here (address/value content, plus INIT-phase
 * cycle position); PLAY-phase cycle position is a separate measurement,
 * gated below by `PLAY_TOLERANCE`/`CIA_CYCLE_BOUND`, one per fixture
 * family, not folded into "matched" itself.
 *
 *   node scores/psid-corpus/corpus.mjs [--json out.json] [--sheet docs/chips/c64.md]
 *   node scores/psid-corpus/corpus.mjs --no-oracle   # skip the libsidplayfp build+run entirely
 *
 * `sources.json` lists only committed files. Both fixtures here are
 * self-authored (CC0, this ticket's own), purpose-built to put one narrow
 * question to both engines at once rather than relying on a found tune's
 * own incidental behaviour - see each entry's own `purpose`. A real,
 * independently-authored PSID corpus (mirroring nsf-corpus's homebrew/demo
 * NSFs) is future work once a redistributable, small-enough source is
 * found; HVSC and commercial rips are never eligible (decision 41).
 *
 * A gitignored `.artifacts/psid-private/` directory is scored the same way
 * nsf-corpus's own `.artifacts/nsf-private/` is, for an owner's own local,
 * non-redistributable files - never written to the sheet or the committed
 * JSON, and never populated by CI.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FILES_DIR = path.join(HERE, 'files');
const PRIVATE_DIR = path.join(ROOT, '.artifacts', 'psid-private');
const ORACLE_REVISION = 'ecd932b3ef87746008472bc7e65b0c419a483e02';

// PLAY-phase cycle position is never gated by `compare.mjs` itself (see its
// own doc comment); the bound belongs here, one per fixture family, because
// it is corpus policy, not comparator mechanics. Measured directly against
// this revision: convention-probe.sid and frame-rate-probe.sid deviate by
// at most 2 cycles, gt2-dojo.sid and gt2-hyperspace-alt.sid by 3 - real,
// bounded per-line VIC-II/CIA jitter around the nominal frame period that
// this environment's own simplified once-a-frame raster pulse does not
// reproduce cycle for cycle, not a growing drift. PLAY_TOLERANCE is set to
// the highest of those four measurements, not a round number, so any of the
// four regressing past its own true best case is still caught here.
//
// Both gt2-hyperspace-alt.sid's 5-cycle-then-3-cycle measurement and the CIA
// bound below moved together, and for the same reason: `setupVic()` used to
// start both `cycleInFrame` (the once-a-frame VBI IRQ pulse) and
// `rasterCycle` (badline placement) at cycle 0, well before the real
// cold-start reaches a tune's own INIT (see `PAL_INIT_RASTER_PHASE` in
// `psid-import.ts`). Starting both at that real phase together - not
// `rasterCycle` alone, which was tried first and reverted (see
// docs/BACKLOG.md's NEXT-09 follow-up) - fixed the CIA-timed fixtures
// without regressing the VBI-timed ones, which is why PLAY_TOLERANCE only
// tightens here (5 to 3) rather than trading one family off against another.
const PLAY_TOLERANCE = 3;

// The two CIA-timed fixtures (gt2-sanction-cia.sid, gt2-consultant-alt-cia.sid)
// have a second, understood source of PLAY-phase cycle deviation on top of
// that same per-line jitter: a CIA timer's own dispatch period is not a
// multiple of the VIC-II badline's own DMA-steal recurrence
// (`BADLINE_STEAL_CYCLES = 43` in `psid-import.ts`), so which PLAY calls
// land near a badline - and how many badlines this environment's own
// once-a-frame raster model crosses versus libsidplayfp's real per-line one
// - varies call to call before the pattern repeats. Measured directly
// against this revision, with `PAL_INIT_RASTER_PHASE` applied: 43 and 42
// cycles at this corpus's default budget, 44 cycles for both files across a
// 20-second/~31000-event capture (4x that budget) - a stable ceiling
// matching one badline period, not a growing drift. This replaces a much
// larger, now-understood 128-cycle deviation (see docs/chips/c64.md's "Known
// limits", docs/BACKLOG.md's NEXT-09 follow-up, and scores/psid-corpus/
// README.md for the full account, including what was tried first and why it
// was reverted): that number came from `rasterCycle` and `cycleInFrame`
// starting at the wrong phase, not from a larger amount of real jitter. The
// bound below keeps the same shape as before - N badline periods, a real
// margin over the measured one, plus the same PLAY_TOLERANCE jitter every
// other fixture already allows - just with N brought down from 3 to 2, not a
// number picked to make today's measurement pass.
const CIA_TIMED = new Set(['gt2-sanction-cia', 'gt2-consultant-alt-cia']);
const CIA_CYCLE_BOUND = 2 * 43 + PLAY_TOLERANCE; // 89
const cycleBoundFor = (id) => (CIA_TIMED.has(id) ? CIA_CYCLE_BOUND : PLAY_TOLERANCE);
// Exported for test-corpus.mjs alone (no live oracle involved): a fast check
// that these two gates actually reject the old, pre-`PAL_INIT_RASTER_PHASE`
// measurements, not just today's.
export {PLAY_TOLERANCE, CIA_CYCLE_BOUND, cycleBoundFor};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const noOracle = args.includes('--no-oracle');

/** The oracle's own INIT-phase register values, paired against ours by
 * address rather than by position (order-independent, in case a future
 * fixture's INIT does not write A/X/Y/P in that exact sequence) - only
 * meaningful for a fixture whose `sources.json` entry names its own
 * `registerNames` (currently just convention-probe.sid). */
function initRegisterTable(performance, oracleTrace, registerNames, undefinedRegisters) {
  const theirs = parseTrace(oracleTrace).slice(1); // Drop the oracle's own pre-INIT $D418=$0F ceremony write.
  const oursInit = performance.events.slice(0, performance.initEventCount);
  const theirsInit = theirs.slice(0, performance.initEventCount);
  const oursByAddr = new Map(oursInit.map((e) => [e.addr & 0x1f, e.value]));
  const theirsByAddr = new Map(theirsInit.map((e) => [e.addr, e.value]));
  const undefinedNames = new Set(undefinedRegisters ?? []);
  return Object.entries(registerNames).map(([addr, register]) => ({
    register, addr: Number(addr), undefined: undefinedNames.has(register),
    ours: oursByAddr.get(Number(addr)) ?? null,
    oracle: theirsByAddr.get(Number(addr)) ?? null,
  }));
}

/** Turns a fixture's own `undefinedRegisters` (register names, matching
 * `registerNames`' values) into the SID address offsets `comparePsidTrace`'s
 * own `ignoreAddrs` needs - kept as one field in `sources.json` so the two
 * never drift apart. */
function undefinedAddrs(spec) {
  if (!spec.undefinedRegisters || !spec.registerNames) return new Set();
  const names = new Set(spec.undefinedRegisters);
  return new Set(Object.entries(spec.registerNames).filter(([, name]) => names.has(name)).map(([addr]) => Number(addr)));
}

async function scoreFile(id, file, spec, {expectedSha256} = {}) {
  const bytes = await readFile(file);
  const digest = sha256(bytes);
  if (expectedSha256 && digest !== expectedSha256) throw new Error(`${id}: ${file} does not match the committed SHA-256 (expected ${expectedSha256}, got ${digest})`);
  const seconds = spec.seconds ?? 5;
  const performance = importPsid(bytes, {seconds});
  let comparison = null, registers = null;
  if (!noOracle) {
    // A whole extra second of oracle cycles past our own capture's own
    // `seconds` budget: `../nsf-corpus/corpus.mjs`'s own margin, for the
    // same reason - the oracle's cold-start ceremony and its own
    // differently-phased first raster IRQ (see compare.mjs) both eat into
    // its nominal budget before a single tune-authored PLAY cycle ticks,
    // and a whole extra second comfortably outlasts both.
    const cycles = Math.round(seconds * performance.clockHz) + Math.round(performance.clockHz);
    const {trace} = await runOracle(file, cycles);
    comparison = comparePsidTrace(performance, trace, {ignoreAddrs: undefinedAddrs(spec)});
    if (spec.registerNames) registers = initRegisterTable(performance, trace, spec.registerNames, spec.undefinedRegisters);
  }
  return {id, sha256: digest, events: performance.events.length, comparison, registers};
}

/** Kept to a small, fixed set of shapes (see docs/check-translations.py's
 * own `nsf-corpus` rule; this ticket's Japanese sync follows the same
 * convention for `psid-corpus`). */
/** `ours.at` is shown after its own shift is added back in (not raw): a
 * value-only divergence that lands on the exact same aligned cycle would
 * otherwise print as a huge, misleading cycle gap (the oracle's own
 * thousands-of-cycles cold-start prelude, still present in the raw number).
 * See `compare.mjs`'s own doc comment for what the shift removes. */
function formatDivergence(comparison) {
  if (!comparison) return 'not compared';
  if (!comparison.firstDivergence) return 'none';
  const {phase, ours, oracle, shift} = comparison.firstDivergence;
  if (!ours || !oracle) return `${phase} phase, cycle ${(ours ?? oracle).at}: one side has no more writes`;
  return `${phase} phase, cycle ${ours.at + shift} vs ${oracle.at}, $${(ours.addr & 0x1f).toString(16)}: ${ours.value} vs ${oracle.value}`;
}

/** PLAY-phase cycle position, reported separately from content matching
 * (see `compare.mjs`'s own doc comment): "0 cycles" when every PLAY-phase
 * write lands exactly where the oracle's own does after `playShift`, or the
 * measured maximum deviation and how many of the fixture's PLAY-phase
 * writes carry any deviation at all - never gated here, just shown; the
 * actual per-fixture bound (`PLAY_TOLERANCE`/`CIA_CYCLE_BOUND`) is applied
 * separately, in `main`'s own gate below. */
function formatCycleDeviation(comparison) {
  if (!comparison) return 'not compared';
  if (!comparison.playTotal) return '-';
  if (comparison.maxCycleDeviation === 0) return '0 cycles';
  return `max ${comparison.maxCycleDeviation} cycles (${comparison.deviatingEvents}/${comparison.playTotal} events off)`;
}

/** `register=value` when both sides agree, `register=ours/oracle` when they
 * do not, `register=undefined by spec` for a register `sources.json`'s own
 * `undefinedRegisters` names (convention-probe.sid's own X and Y - never
 * scored against the oracle at all, see `compare.mjs`'s own `ignoreAddrs`,
 * so there is no ours/oracle pair to show) - plain data, deliberately free
 * of any word `docs/check-translations.py`'s `psid-corpus` rule would need
 * to translate beyond that one fixed phrase. */
function formatRegisters(registers) {
  if (!registers) return '';
  return registers.map((r) => {
    if (r.undefined) return `${r.register}=undefined by spec`;
    return r.ours === r.oracle ? `${r.register}=${r.ours}` : `${r.register}=${r.ours}/${r.oracle}`;
  }).join(', ');
}

async function main() {
  const sources = JSON.parse(await readFile(path.join(HERE, 'sources.json'), 'utf8'));
  const results = [];
  for (const [id, spec] of Object.entries(sources)) {
    const result = await scoreFile(id, path.join(FILES_DIR, spec.file), spec, {expectedSha256: spec.sha256});
    results.push({...result, spec});
    const {comparison, registers} = result;
    const score = comparison ? `${comparison.matched}/${comparison.total}` : `${result.events} events`;
    console.log(`${id}: ${score} matched, first divergence: ${formatDivergence(comparison)}${registers ? ` [${formatRegisters(registers)}]` : ''}`);
  }

  const privateResults = [];
  if (fs.existsSync(PRIVATE_DIR)) {
    for (const name of await fs.promises.readdir(PRIVATE_DIR)) {
      if (!name.endsWith('.sid')) continue;
      try {
        const result = await scoreFile(name, path.join(PRIVATE_DIR, name), {});
        privateResults.push({...result, name});
        const {comparison} = result;
        const score = comparison ? `${comparison.matched}/${comparison.total}` : `${result.events} events`;
        console.log(`[private] ${name}: ${score} matched, first divergence: ${formatDivergence(comparison)}`);
      } catch (error) {
        console.log(`[private] ${name}: FAILED - ${error.message}`);
      }
    }
  }
  if (privateResults.length) console.log(`${privateResults.length} private file(s) scored locally; excluded from the committed JSON and the sheet.`);

  const jsonPath = option('json', null);
  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
    const payload = {
      date: new Date().toISOString().slice(0, 10),
      oracleRevision: ORACLE_REVISION,
      results: results.map((r) => ({
        id: r.id, title: r.spec.title, author: r.spec.author, url: r.spec.url, licence: r.spec.licence,
        purpose: r.spec.purpose, events: r.events,
        matched: r.comparison?.matched ?? null, total: r.comparison?.total ?? null,
        firstDivergence: r.comparison?.firstDivergence ?? null, registers: r.registers ?? null,
        maxCycleDeviation: r.comparison?.maxCycleDeviation ?? null,
        deviatingEvents: r.comparison?.deviatingEvents ?? null,
        playTotal: r.comparison?.playTotal ?? null,
        cycleBound: r.comparison ? cycleBoundFor(r.id) : null,
      })),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
  }

  const sheetPath = option('sheet', null);
  if (sheetPath) {
    const text = fs.readFileSync(sheetPath, 'utf8');
    const begin = text.indexOf('<!-- psid-corpus:begin -->'), end = text.indexOf('<!-- psid-corpus:end -->');
    if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no psid-corpus markers`);
    const lines = [
      '<!-- psid-corpus:begin -->',
      `Written by \`psid-corpus:sheet\` on ${new Date().toISOString().slice(0, 10)}, against libsidplayfp revision \`${ORACLE_REVISION}\`.`,
      '',
      '| Fixture | Events | Matched | PLAY cycle deviation | First divergence | INIT registers |',
      '| --- | --- | --- | --- | --- | --- |',
      ...results.map((r) => `| [${r.spec.title}](${r.spec.url}) | ${r.events} | ${r.comparison ? `${r.comparison.matched}/${r.comparison.total}` : 'not compared'} | ${formatCycleDeviation(r.comparison)} | ${formatDivergence(r.comparison)} | ${r.registers ? formatRegisters(r.registers) : '-'} |`),
      '<!-- psid-corpus:end -->',
    ];
    fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- psid-corpus:end -->'.length));
  }

  // Content (address and value, plus INIT-phase cycle position) is gated
  // exactly: every fixture is meant to match in full, not just avoid zero.
  // A spec-undefined register (convention-probe.sid's own X and Y) is
  // excluded from `total` entirely by `ignoreAddrs` (see sources.json's own
  // `undefinedRegisters` and `purpose`), not counted as a divergence, so
  // there is no fixture this bar excludes; a regression on any file, down
  // to a single write, fails here instead of only a total-loss one.
  const contentBroken = results.filter((r) => r.comparison && r.comparison.matched !== r.comparison.total);
  if (contentBroken.length) {
    console.error(`${contentBroken.length} file(s) did not match the oracle's own address/value sequence (and INIT-phase cycle position) in full: ${contentBroken.map((r) => `${r.id} (${r.comparison.matched}/${r.comparison.total})`).join(', ')}`);
    process.exitCode = 1;
  }

  // PLAY-phase cycle position is gated separately, and by a different bound
  // per fixture: PLAY_TOLERANCE for everything but the two CIA-timed files,
  // which are held to the wider, mechanism-derived CIA_CYCLE_BOUND instead
  // (see both constants' own comments above). A regression past either
  // bound is a real, new problem; today's own measurements sit at or under
  // both (3 cycles across the four PLAY_TOLERANCE fixtures against a bound
  // of 3; 43 cycles across the two CIA fixtures against a bound of 89).
  const cycleBroken = results.filter((r) => r.comparison && r.comparison.maxCycleDeviation > cycleBoundFor(r.id));
  if (cycleBroken.length) {
    console.error(`${cycleBroken.length} file(s) exceeded their own PLAY-phase cycle-position bound: ${cycleBroken.map((r) => `${r.id} (max ${r.comparison.maxCycleDeviation}c > ${cycleBoundFor(r.id)}c)`).join(', ')}`);
    process.exitCode = 1;
  }
}

// Only when run as a CLI, not when imported (test-corpus.mjs imports
// PLAY_TOLERANCE/CIA_CYCLE_BOUND/cycleBoundFor alone, and must not trigger a
// full, oracle-building corpus run as a side effect of that import).
if (import.meta.url === `file://${process.argv[1]}`) main();
