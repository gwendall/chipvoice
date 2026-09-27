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
 * for what "matched" means here and why a cycle can differ within a small
 * tolerance without being a divergence.
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

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const noOracle = args.includes('--no-oracle');

/** The oracle's own INIT-phase register values, paired against ours by
 * address rather than by position (order-independent, in case a future
 * fixture's INIT does not write A/X/Y/P in that exact sequence) - only
 * meaningful for a fixture whose `sources.json` entry names its own
 * `registerNames` (currently just convention-probe.sid). */
function initRegisterTable(performance, oracleTrace, registerNames) {
  const theirs = parseTrace(oracleTrace).slice(1); // Drop the oracle's own pre-INIT $D418=$0F ceremony write.
  const oursInit = performance.events.slice(0, performance.initEventCount);
  const theirsInit = theirs.slice(0, performance.initEventCount);
  const oursByAddr = new Map(oursInit.map((e) => [e.addr & 0x1f, e.value]));
  const theirsByAddr = new Map(theirsInit.map((e) => [e.addr, e.value]));
  return Object.entries(registerNames).map(([addr, register]) => ({
    register, addr: Number(addr),
    ours: oursByAddr.get(Number(addr)) ?? null,
    oracle: theirsByAddr.get(Number(addr)) ?? null,
  }));
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
    comparison = comparePsidTrace(performance, trace);
    if (spec.registerNames) registers = initRegisterTable(performance, trace, spec.registerNames);
  }
  return {id, sha256: digest, events: performance.events.length, comparison, registers};
}

/** Kept to a small, fixed set of shapes (see docs/check-translations.py's
 * own `nsf-corpus` rule; this ticket's Japanese sync follows the same
 * convention for `psid-corpus`). */
function formatDivergence(comparison) {
  if (!comparison) return 'not compared';
  if (!comparison.firstDivergence) return 'none';
  const {phase, ours, oracle} = comparison.firstDivergence;
  if (!ours || !oracle) return `${phase} phase, cycle ${(ours ?? oracle).at}: one side has no more writes`;
  return `${phase} phase, cycle ${ours.at} vs ${oracle.at}, $${(ours.addr & 0x1f).toString(16)}: ${ours.value} vs ${oracle.value}`;
}

/** `register=value` when both sides agree, `register=ours/oracle` when they
 * do not (convention-probe.sid's own X and Y; see `sources.json`'s own
 * `purpose` for that fixture) - plain data, deliberately free of any word
 * `docs/check-translations.py`'s `psid-corpus` rule would need to translate. */
function formatRegisters(registers) {
  if (!registers) return '';
  return registers.map((r) => (r.ours === r.oracle ? `${r.register}=${r.ours}` : `${r.register}=${r.ours}/${r.oracle}`)).join(', ');
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
      '| Fixture | Events | Matched | First divergence | INIT registers |',
      '| --- | --- | --- | --- | --- |',
      ...results.map((r) => `| [${r.spec.title}](${r.spec.url}) | ${r.events} | ${r.comparison ? `${r.comparison.matched}/${r.comparison.total}` : 'not compared'} | ${formatDivergence(r.comparison)} | ${r.registers ? formatRegisters(r.registers) : '-'} |`),
      '<!-- psid-corpus:end -->',
    ];
    fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- psid-corpus:end -->'.length));
  }

  // frame-rate-probe.sid is meant to match in full (its own byte stream has
  // no register whose value is spec-undefined the way convention-probe's X
  // and Y are); convention-probe.sid is expected to stop at its own X
  // register (see sources.json's own `purpose`) and is never held to this
  // bar. A file matching zero real writes (before that expected stop, if
  // any) is not a partial divergence, something is structurally broken.
  const broken = results.filter((r) => r.comparison && r.comparison.matched === 0 && r.comparison.total > 0 && !r.spec.registerNames);
  if (broken.length) {
    console.error(`${broken.length} file(s) matched zero writes against the oracle; that is not a partial divergence, something is structurally wrong: ${broken.map((r) => r.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
