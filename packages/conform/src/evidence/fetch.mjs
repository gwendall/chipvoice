import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Fetches the published hardware-evidence sources docs/HARDWARE-EVIDENCE.md
 * cites, into `.artifacts/hardware-evidence/<chip>/`, and checks each file's
 * bytes against the SHA-256 this manifest records.
 *
 *   node src/evidence/fetch.mjs            # every source
 *   node src/evidence/fetch.mjs nes c64     # only these chips' sources
 *   node src/evidence/fetch.mjs --check     # verify what is already local; fetch nothing
 *
 * Nothing here is committed: `.artifacts/` is gitignored, and the sources are
 * third-party recordings and data files whose licences range from public
 * domain to "no licence stated", so fetching on demand is what the catalogue
 * relies on rather than vendoring them. A file already present and correct is
 * left alone; a wrong or missing one is (re)downloaded. This Mac's network
 * drops TCP connects sometimes, so every download gets a few attempts with a
 * backoff before it is reported as failed.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, '.artifacts', 'hardware-evidence');
const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'manifest.json'), 'utf8'));

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const wanted = args.filter((a) => !a.startsWith('--'));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readLocal(file) {
  try {
    return await fs.promises.readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** One URL, a few attempts with a growing backoff before giving up. */
async function download(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
    }
  }
  throw new Error(`${url}: ${lastError.message}`);
}

async function main() {
  const sources = manifest.filter((s) => wanted.length === 0 || wanted.includes(s.chip));
  if (sources.length === 0) {
    console.error(`No manifest entries match: ${wanted.join(', ')}`);
    process.exit(2);
  }

  let ok = 0;
  let fetched = 0;
  const failed = [];

  for (const source of sources) {
    const dir = path.join(OUT, source.chip);
    const file = path.join(dir, source.filename);
    const existing = await readLocal(file);
    if (existing && sha256(existing) === source.sha256) {
      console.log(`PASS  ${source.chip}/${source.filename}  already correct`);
      ok++;
      continue;
    }
    if (checkOnly) {
      failed.push(`${source.chip}/${source.filename}: ${existing ? 'wrong hash locally' : 'not fetched'}`);
      continue;
    }
    try {
      const bytes = await download(source.url);
      const got = sha256(bytes);
      if (got !== source.sha256) {
        failed.push(`${source.chip}/${source.filename}: fetched but hash is ${got}, manifest says ${source.sha256}`);
        continue;
      }
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(file + '.tmp', bytes);
      await fs.promises.rename(file + '.tmp', file);
      console.log(`FETCHED  ${source.chip}/${source.filename}  from ${source.url}`);
      fetched++;
      ok++;
    } catch (error) {
      failed.push(`${source.chip}/${source.filename}: ${error.message}`);
    }
  }

  console.log(`\n${ok} of ${sources.length} sources verified locally (${fetched} freshly fetched).`);
  if (failed.length) {
    console.error(`${failed.length} failed:`);
    for (const line of failed) console.error(`  ${line}`);
    process.exit(1);
  }
}

main();
