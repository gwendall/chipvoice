import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, CHIPS, read } from './status-data.mjs';

/**
 * The data behind chipvoice.dev's public accuracy page (NEXT-12): the same
 * four levels CONFORMANCE.md and every chip's sheet describe - digital
 * parity, test ROMs, the analog stage, driver coverage - as one committed
 * JSON file, so the page never types a number.
 *
 *   node src/accuracy-data.mjs           # regenerate
 *   node src/accuracy-data.mjs --check   # fail if the committed file is stale
 *
 * Every number here comes from what the harness already wrote to
 * `corpus/<chip>` (the same files `status.mjs` reads for the README board) or
 * from the chip's own sheet's hand-written Status line, read narrowly for its
 * three-word vocabulary and nothing else - CONFORMANCE.md and TEMPLATE.md fix
 * that vocabulary, so this is reading a closed enum, not parsing prose. The
 * `analog`/`driver` fields on `CHIPS` (status-data.mjs) are the one
 * hand-maintained exception, same as the README board: no number says "the
 * filters want a unit's line-out", so those two words are kept by hand and
 * reused here rather than re-typed.
 */
const OUT = path.join(ROOT, '..', '..', 'apps', 'web', 'src', 'data', 'accuracy-data.json');
const SHEET_ROOT = path.join(ROOT, '..', '..');

/** The sheet's own Status line: "unverified", "in progress", or "verified". */
function sheetStatus(chip) {
  const text = fs.readFileSync(path.join(SHEET_ROOT, chip.sheet), 'utf8');
  const match = text.match(/\|\s*\*\*Status\*\*\s*\|\s*\*\*(unverified|in progress|verified)\*\*/);
  if (!match) throw new Error(`${chip.sheet}: no Status row matching unverified/in progress/verified`);
  return match[1];
}

/** One oracle's parity file (`parity.json` or `parity-<marker>.json`), the harness's own comparison. */
function parityEntry(chip, marker, file) {
  const p = read(file);
  if (!p) return null;
  const diverging = p.results.filter((r) => r.first !== null).length;
  const first = p.results.find((r) => r.first !== null);
  return {
    marker,
    oracle: p.oracle.name,
    files: p.files,
    cycles: p.cycles,
    identical: p.identical,
    diverging,
    firstDivergence: first
      ? { file: first.name, cycle: first.first.cycle, voice: chip.voices[first.first.voice] ?? String(first.first.voice), ours: first.first.a, theirs: first.first.b }
      : null,
  };
}

/** Every `parity*.json` this chip's corpus has, `parity.json` first. */
function digitalParity(chip) {
  const dir = path.join(ROOT, 'corpus', chip.id);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const oracles = [];
  const primary = parityEntry(chip, 'parity', path.join(dir, 'parity.json'));
  if (primary) oracles.push(primary);
  for (const name of files.sort()) {
    const m = name.match(/^parity-([\w-]+)\.json$/);
    if (!m) continue;
    const entry = parityEntry(chip, `parity-${m[1]}`, path.join(dir, name));
    if (entry) oracles.push(entry);
  }
  // c64 only: OSC3 against a real captured 6581, digital bits before its DAC
  // (docs/chips/c64.md "Combined waveforms against a real 6581") - hardware
  // evidence, not an oracle, so it is kept beside the oracle list rather than
  // inside it.
  const hw = read(path.join(dir, 'hardware-combined.json'));
  const hardwareCombined = hw
    ? {
        unit: hw.unit,
        date: hw.date,
        // The combined-waveform table has a fixed 4096 entries (OSC3's top
        // eight of the waveform generator's twelve bits, the sheet's own
        // constant); wrong-bit totals are eight per entry, computed rather
        // than repeated as a second typed number.
        totalEntries: 4096,
        combinations: hw.results.map((r) => ({ name: r.name, exactEntries: r.exact, wrongBits: r.bits, totalBits: 4096 * 8 })),
      }
    : null;
  return { oracles, hardwareCombined };
}

function testRoms(chip) {
  const r = read(path.join(ROOT, 'corpus', chip.id, 'roms.json'));
  if (!r) return null;
  return { run: true, passed: r.passed, total: r.total, date: r.date, results: r.results.map((x) => ({ name: x.name, passed: x.passed })) };
}

function analogStage(chip) {
  const raw = read(path.join(ROOT, 'corpus', chip.id, 'mixer.json'));
  return {
    label: chip.analog.label,
    measuredFraction: chip.analog.done,
    mixer: raw
      ? { date: raw.date, floorDb: raw.floor, rows: raw.results.filter((r) => r.hardware).map((r) => ({ name: r.name, oursResidualDb: r.ours.residual, hardwareResidualDb: r.hardware.residual })) }
      : null,
  };
}

export function buildAccuracyData() {
  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    chips: CHIPS.map((chip) => {
      const { oracles, hardwareCombined } = digitalParity(chip);
      const stage = analogStage(chip);
      return {
        id: chip.id,
        machine: chip.machine,
        chip: chip.chip,
        sheetPath: chip.sheet,
        sheetUrl: `https://github.com/gwendall/chipvoice/blob/main/${chip.sheet}`,
        status: sheetStatus(chip),
        digitalParity: { oracles, hardwareCombined },
        testRoms: testRoms(chip),
        analogStage: stage,
        driverCoverage: { reached: chip.driver.reached, voices: chip.driver.voices },
      };
    }),
  };
}

/** Renders and writes `apps/web/src/data/accuracy-data.json`. The only side effect in this file. */
export function writeAccuracyData() {
  const data = buildAccuracyData();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Accuracy page data written: ${data.chips.length} chips`);
  return data;
}

/** True when the committed file matches what the sources say right now. Used by `--check` and the CI staleness check. */
export function isStale() {
  const committed = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  const fresh = `${JSON.stringify(buildAccuracyData(), null, 2)}\n`;
  // The generation date is not itself evidence; comparing it would make the
  // check fail every day for no reason. Compare everything else.
  const strip = (text) => text.replace(/"generatedAt": "[\d-]+",\n/, '');
  return committed === null || strip(committed) !== strip(fresh);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    if (isStale()) {
      console.error('apps/web/src/data/accuracy-data.json is stale. Regenerate with: pnpm --filter chipvoice-conform status');
      process.exit(1);
    }
    console.log('apps/web/src/data/accuracy-data.json is up to date.');
  } else {
    writeAccuracyData();
  }
}
