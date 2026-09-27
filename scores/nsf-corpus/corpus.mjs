import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {captureNsf} from '../capture-nsf.mjs';
import {compareNsfTrace} from './compare.mjs';

/**
 * Grows Mario's and Zelda's one-song native-command proof (decision 29,
 * `scores/arrangements/compare-native.mjs`) into a corpus: many real NSFs,
 * each replayed through `capture-nsf.mjs`'s own offline 6502 and compared,
 * command by command, against the pinned Game_Music_Emu oracle
 * (`scores/arrangements/native-oracle.py`, reused unmodified here). Unlike
 * Mario's exact-cycle assertion, this reports a score per file - commands
 * matched out of total, and the first divergence's cycle and register - so
 * a driver quirk or a genuine hardware gap becomes a documented finding
 * instead of a thrown assertion.
 *
 *   node scores/nsf-corpus/corpus.mjs [--json out.json] [--sheet docs/chips/2a03.md]
 *   node scores/nsf-corpus/corpus.mjs --no-oracle   # skip the GME comparison entirely (no network, no C++ build)
 *
 * `sources.json` lists only committed files: homebrew/demo NSFs whose licence
 * explicitly allows redistribution (CC0, CC-BY, public domain, or similarly
 * permissive), each with its source URL, licence, author and SHA-256 next to
 * it. Files placed in the gitignored `.artifacts/nsf-private/` directory are
 * scored too (for an owner's own local, non-redistributable files) but never
 * written to the sheet or the committed JSON; CI never populates that
 * directory, so it contributes nothing there.
 *
 * Every corpus file here is 2A03-only NTSC. Expansion-audio NSFs (VRC6,
 * VRC7, FDS, N163, Sunsoft 5B, MMC5) are out of scope for this ticket
 * (NEXT-14 covers those chips) and are rejected by `capture-nsf.mjs` itself.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FILES_DIR = path.join(HERE, 'files');
const ORACLE_DIR = path.join(ROOT, '.artifacts', 'nsf-corpus', 'gme-oracle');
const PRIVATE_DIR = path.join(ROOT, '.artifacts', 'nsf-private');
const ORACLE_REVISION = 'fe8da4b6d3876d7542c2fb69d94487e19836d678';

const run = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const noOracle = args.includes('--no-oracle');

/** Runs `native-oracle.py`, retrying the whole build+render on failure: this
 * Mac's network drops TCP connects sometimes, and a half-finished `git
 * clone` from a dropped connection must not be reused on the next attempt. */
async function oracleTrace(nsfPath, seconds, track, attempts = 4) {
  await fs.promises.mkdir(ORACLE_DIR, {recursive: true});
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run('python3', [path.join(ROOT, 'scores/arrangements/native-oracle.py'), nsfPath, ORACLE_DIR, String(seconds), String(track)]);
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
  throw new Error(`native-oracle.py failed after ${attempts} attempts: ${lastError.message}`);
}

async function scoreFile(id, file, spec, {expectedSha256} = {}) {
  const bytes = await readFile(file);
  const digest = sha256(bytes);
  if (expectedSha256 && digest !== expectedSha256) throw new Error(`${id}: ${file} does not match the committed SHA-256 (expected ${expectedSha256}, got ${digest})`);
  const frames = spec.frames ?? 300, track = spec.track ?? 0;
  const capture = captureNsf(bytes, {frames, track});
  const commands = capture.events.filter(e => e.at !== 0).length;
  let comparison = null;
  if (!noOracle) {
    const seconds = Math.ceil((frames * capture.period) / capture.clockHz) + 1;
    const trace = await oracleTrace(file, seconds, track);
    comparison = compareNsfTrace(capture, trace);
  }
  return {id, sha256: digest, commands, comparison};
}

/** Kept to a small, fixed set of shapes (translated verbatim in
 * docs/check-translations.py's `nsf-corpus` rule); free-form interpolated
 * prose here would need a new translation rule per shape. */
function formatDivergence(comparison) {
  if (!comparison) return 'not compared';
  if (!comparison.firstDivergence) return 'none';
  const {ours, gme} = comparison.firstDivergence;
  if (!ours || !gme) return `cycle ${(ours ?? gme).at}: one side has no more commands`;
  return `cycle ${ours.at} vs ${gme.at}, $${ours.addr.toString(16)}: ${ours.value} vs ${gme.value}`;
}

async function main() {
  const sources = JSON.parse(await readFile(path.join(HERE, 'sources.json'), 'utf8'));
  const results = [];
  for (const [id, spec] of Object.entries(sources)) {
    const result = await scoreFile(id, path.join(FILES_DIR, spec.file), spec, {expectedSha256: spec.sha256});
    results.push({...result, spec});
    const {comparison} = result;
    const score = comparison ? `${comparison.matched}/${comparison.total}` : `${result.commands} commands`;
    console.log(`${id}: ${score} matched, first divergence: ${formatDivergence(comparison)}`);
  }

  const privateResults = [];
  if (fs.existsSync(PRIVATE_DIR)) {
    for (const name of await fs.promises.readdir(PRIVATE_DIR)) {
      if (!name.endsWith('.nsf')) continue;
      try {
        const result = await scoreFile(name, path.join(PRIVATE_DIR, name), {});
        privateResults.push({...result, name});
        const {comparison} = result;
        const score = comparison ? `${comparison.matched}/${comparison.total}` : `${result.commands} commands`;
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
      results: results.map(r => ({
        id: r.id, title: r.spec.title, author: r.spec.author, driver: r.spec.driver, url: r.spec.url, licence: r.spec.licence,
        commands: r.commands, matched: r.comparison?.matched ?? null, total: r.comparison?.total ?? null,
        firstDivergence: r.comparison?.firstDivergence ?? null,
      })),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
  }

  const sheetPath = option('sheet', null);
  if (sheetPath) {
    const text = fs.readFileSync(sheetPath, 'utf8');
    const begin = text.indexOf('<!-- nsf-corpus:begin -->'), end = text.indexOf('<!-- nsf-corpus:end -->');
    if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no nsf-corpus markers`);
    const lines = [
      '<!-- nsf-corpus:begin -->',
      `Written by \`nsf-corpus:sheet\` on ${new Date().toISOString().slice(0, 10)}, against Game_Music_Emu revision \`${ORACLE_REVISION}\`.`,
      '',
      '| Song | Driver | Commands | Matched | First divergence |',
      '| --- | --- | --- | --- | --- |',
      ...results.map(r => `| [${r.spec.title}](${r.spec.url}) | ${r.spec.driver} | ${r.commands} | ${r.comparison ? `${r.comparison.matched}/${r.comparison.total}` : 'not compared'} | ${formatDivergence(r.comparison)} |`),
      '<!-- nsf-corpus:end -->',
    ];
    fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- nsf-corpus:end -->'.length));
  }

  const broken = results.filter(r => r.comparison && r.comparison.matched === 0 && r.comparison.total > 0);
  if (broken.length) {
    console.error(`${broken.length} file(s) matched zero commands against GME; that is not a partial divergence, something is structurally wrong: ${broken.map(r => r.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main();
