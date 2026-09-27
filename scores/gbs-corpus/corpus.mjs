import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {importGbs, parseGbsHeader} from '../../packages/chipvoice/dist/index.js';
import {compareGbsTrace} from './compare.mjs';

/**
 * Scores our own `importGbs` capture of a real GBS's INIT/PLAY register
 * writes against an independent GBS player, Game_Music_Emu's `Gbs_Emu`,
 * mirroring `scores/nsf-corpus/corpus.mjs`'s method for the 2A03: many
 * files, each **scored** (writes matched out of total, and the first
 * divergence's cycle and register) rather than asserted.
 *
 *   node scores/gbs-corpus/corpus.mjs [--json out.json] [--sheet docs/chips/dmg.md]
 *   node scores/gbs-corpus/corpus.mjs --no-oracle   # skip the GME comparison entirely (no network, no C++ build)
 *
 * `sources.json` lists only committed files: each with its title, author,
 * driver, source URL, licence, licence URL and SHA-256, and licensed
 * explicitly for redistribution (CC0, CC-BY, public domain, MIT, zlib or
 * similarly permissive) - never a commercial game rip. A gitignored
 * `.artifacts/gbs-private/` directory is scored the same way for an owner's
 * own local files; CI never populates it, and its results are excluded from
 * the committed JSON and the sheet.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FILES_DIR = path.join(HERE, 'files');
const ORACLE_DIR = path.join(ROOT, '.artifacts', 'gbs-corpus', 'gme-oracle');
const PRIVATE_DIR = path.join(ROOT, '.artifacts', 'gbs-private');
const ORACLE_REVISION = 'fe8da4b6d3876d7542c2fb69d94487e19836d678';

const run = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const noOracle = args.includes('--no-oracle');

/** The same VBlank/timer scheduling `gbs-import.ts` uses, needed here only
 * to tell the comparator where INIT's own writes end and PLAY's begin. */
function playPeriod(header) {
  const timerEnabled = (header.timerControl & 0x04) !== 0;
  if (!timerEnabled) return 70224;
  const shift = [10, 4, 6, 8][header.timerControl & 3];
  return (256 - header.timerModulo) << shift;
}

/** Runs `native-oracle-gbs.py`, retrying the whole build+render on failure:
 * this Mac's network drops TCP connects sometimes, and a half-finished
 * `git clone` from a dropped connection must not be reused on the next
 * attempt. */
async function oracleTrace(gbsPath, seconds, track, attempts = 4) {
  await fs.promises.mkdir(ORACLE_DIR, {recursive: true});
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run('python3', [path.join(HERE, 'native-oracle-gbs.py'), gbsPath, ORACLE_DIR, String(seconds), String(track)]);
      return await readFile(path.join(ORACLE_DIR, 'gme-writes.txt'), 'utf8');
    } catch (error) {
      lastError = error;
      const repo = path.join(ORACLE_DIR, 'gme');
      if (fs.existsSync(repo)) {
        try { await run('git', ['-C', repo, 'rev-parse', 'HEAD']); }
        catch { await fs.promises.rm(repo, {recursive: true, force: true}); }
      }
      if (attempt < attempts) await new Promise(done => setTimeout(done, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`native-oracle-gbs.py failed after ${attempts} attempts: ${lastError.message}`);
}

async function scoreFile(id, file, spec, {expectedSha256} = {}) {
  const bytes = await readFile(file);
  const digest = sha256(bytes);
  if (expectedSha256 && digest !== expectedSha256) throw new Error(`${id}: ${file} does not match the committed SHA-256 (expected ${expectedSha256}, got ${digest})`);
  const header = parseGbsHeader(bytes);
  const track = spec.track ?? header.firstSong, seconds = spec.seconds ?? 60;
  const plan = importGbs(bytes, {track, seconds});
  const commands = plan.events.filter(e => e.at !== 0).length;
  let comparison = null;
  if (!noOracle) {
    const oracleSeconds = Math.ceil(plan.seconds) + 1;
    const trace = await oracleTrace(file, oracleSeconds, track - 1); // GME's tracks are zero-based
    comparison = compareGbsTrace(plan, playPeriod(header), trace);
  }
  return {id, sha256: digest, commands, title: header.title, comparison};
}

function formatDivergence(comparison) {
  if (!comparison) return 'not compared';
  if (!comparison.firstDivergence) return 'none';
  const {ours, gme} = comparison.firstDivergence;
  if (!ours || !gme) return `cycle ${(ours ?? gme).at}: one side has no more commands`;
  return `cycle ${ours.at} vs ${gme.at}, $${ours.addr.toString(16)}: ${ours.value} vs ${gme.value}`;
}

/** `matched` is address+value+cycle, all three; `valueMatched` drops the
 * cycle requirement, so it reports whether the CPU ran the program
 * correctly even on a file whose cycle timing disagrees with GME's own
 * (see `compare.mjs`'s docstring for why those can legitimately differ). */
function formatScore(comparison, commands) {
  if (!comparison) return `${commands} commands`;
  return `${comparison.matched}/${comparison.total} cycle-exact (${comparison.valueMatched}/${comparison.total} same value+order)`;
}

async function main() {
  const sources = JSON.parse(await readFile(path.join(HERE, 'sources.json'), 'utf8'));
  const results = [];
  for (const [id, spec] of Object.entries(sources)) {
    const result = await scoreFile(id, path.join(FILES_DIR, spec.file), spec, {expectedSha256: spec.sha256});
    results.push({...result, spec});
    const {comparison} = result;
    console.log(`${id}: ${formatScore(comparison, result.commands)}, first divergence: ${formatDivergence(comparison)}`);
  }

  const privateResults = [];
  if (fs.existsSync(PRIVATE_DIR)) {
    for (const name of await fs.promises.readdir(PRIVATE_DIR)) {
      if (!name.endsWith('.gbs')) continue;
      try {
        const result = await scoreFile(name, path.join(PRIVATE_DIR, name), {});
        privateResults.push({...result, name});
        const {comparison} = result;
        console.log(`[private] ${name}: ${formatScore(comparison, result.commands)}, first divergence: ${formatDivergence(comparison)}`);
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
      results: results.map(r => ({
        id: r.id, title: r.spec.title, author: r.spec.author, driver: r.spec.driver, url: r.spec.url, licence: r.spec.licence,
        commands: r.commands, matched: r.comparison?.matched ?? null, valueMatched: r.comparison?.valueMatched ?? null,
        total: r.comparison?.total ?? null, firstDivergence: r.comparison?.firstDivergence ?? null,
      })),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
  }

  const sheetPath = option('sheet', null);
  if (sheetPath) {
    const text = fs.readFileSync(sheetPath, 'utf8');
    const begin = text.indexOf('<!-- gbs-corpus:begin -->'), end = text.indexOf('<!-- gbs-corpus:end -->');
    if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no gbs-corpus markers`);
    const lines = [
      '<!-- gbs-corpus:begin -->',
      `Written by \`gbs-corpus:sheet\` on ${new Date().toISOString().slice(0, 10)}, against Game_Music_Emu revision \`${ORACLE_REVISION}\`.`,
      '',
      '| Song | Driver | Commands | Cycle-exact | Same value+order | First divergence |',
      '| --- | --- | --- | --- | --- | --- |',
      ...results.map(r => `| [${r.spec.title}](${r.spec.url}) | ${r.spec.driver} | ${r.commands} | ${r.comparison ? `${r.comparison.matched}/${r.comparison.total}` : 'not compared'} | ${r.comparison ? `${r.comparison.valueMatched}/${r.comparison.total}` : 'not compared'} | ${formatDivergence(r.comparison)} |`),
      '<!-- gbs-corpus:end -->',
    ];
    fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- gbs-corpus:end -->'.length));
  }

  // Cycle-exact agreement can legitimately be near zero (see compare.mjs on
  // GME's own CPU timing), so the structural check is on value+order instead
  // - a real player running the real program cannot land on zero of those.
  const broken = results.filter(r => r.comparison && r.comparison.valueMatched === 0 && r.comparison.total > 0);
  if (broken.length) {
    console.error(`${broken.length} file(s) matched zero commands (value+order) against GME; that is not a partial divergence, something is structurally wrong: ${broken.map(r => r.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
