'use client';
import {useT} from '@/i18n/react';
import {SiteHeader, SiteFooter} from '@/ui/components';
import {MACHINES} from '../studio/machines';
import accuracyData from '@/data/accuracy-data.json';

/**
 * The shape `packages/conform/src/accuracy-data.mjs` writes to
 * `src/data/accuracy-data.json` - see that file and docs/CONFORMANCE.md.
 * Nothing here is typed by hand: every number on the page below comes
 * straight from this import.
 */
type Oracle = {marker: string; oracle: string; files: number; cycles: number; identical: number; diverging: number; firstDivergence: {file: string; cycle: number; voice: string; ours: number; theirs: number} | null};
type HardwareCombined = {unit: string; date: string; totalEntries: number; combinations: {name: string; exactEntries: number; wrongBits: number; totalBits: number}[]};
type Chip = {
  id: string; machine: string; chip: string; sheetPath: string; sheetUrl: string; status: 'unverified' | 'in progress' | 'verified';
  digitalParity: {oracles: Oracle[]; hardwareCombined: HardwareCombined | null};
  testRoms: {run: true; passed: number; total: number; date: string; results: {name: string; passed: boolean}[]} | null;
  analogStage: {label: 'none' | 'mixer' | 'profile'; measuredFraction: number; mixer: {date: string; floorDb: number; rows: {name: string; oursResidualDb: number; hardwareResidualDb: number}[]} | null};
  driverCoverage: {reached: number; voices: number};
};
const data = accuracyData as {generatedAt: string; chips: Chip[]};

const pct = (n: number) => `${(100 * n).toFixed(1)} %`;
/** A fixed, locale-independent grouping: this is a measurement, not user-facing localized text, and must render identically on the server and after hydration. */
const commas = (n: number) => n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function Accuracy() {
  const t = useT();
  return <><SiteHeader active="accuracy"/><main className="demo-main about-main accuracy-main">
    <span className="micro">{t("HOW WE CHECK")}</span>
    <h1>{t("Accuracy, chip by chip.")}</h1>
    <p>{t("Every number below comes from the conformance harness that runs before each release, never typed by hand. Four levels per chip: how closely the digital output matches a reference emulator, which community test ROMs pass, how closely the analog stage after the chip's DACs matches a real unit, and how much of the chip the shipped driver reaches. The method behind every section is in ")}<a href="https://github.com/gwendall/chipvoice/blob/main/docs/CONFORMANCE.md">{t("CONFORMANCE.md")}</a>{t(", and each chip's own sheet has the full detail.")}</p>
    {data.chips.map(chip => {
      const machine = MACHINES.find(m => m.id === chip.id);
      const combined = chip.digitalParity.hardwareCombined;
      return <section className="chip-accuracy" key={chip.id} aria-labelledby={`accuracy-${chip.id}`}>
        <div className="chip-accuracy-head">
          <h2 id={`accuracy-${chip.id}`}>{machine ? t(machine.name) : chip.machine} <span className="chip-accuracy-name">{chip.chip}</span></h2>
          <span className={`chip-accuracy-status status-${chip.status.replace(' ', '-')}`}>{t(chip.status)}</span>
        </div>
        <div className="accuracy-levels">
          <section className="accuracy-level">
            <h3>{t("Digital parity")}</h3>
            {chip.digitalParity.oracles.map(oracle => <div className="accuracy-oracle" key={oracle.marker}>
              <p>{t("Compared with {oracle}: {pct} identical ({identical} of {cycles} cycles), {diverging} of {files} logs with any divergence.", {oracle: oracle.oracle, pct: pct(oracle.identical / oracle.cycles), identical: commas(oracle.identical), cycles: commas(oracle.cycles), diverging: oracle.diverging, files: oracle.files})}</p>
              <p>{oracle.firstDivergence
                ? t("First divergence: {file}, cycle {cycle}, {voice} - ours {ours}, the oracle's {theirs}.", {file: oracle.firstDivergence.file, cycle: oracle.firstDivergence.cycle, voice: oracle.firstDivergence.voice, ours: oracle.firstDivergence.ours, theirs: oracle.firstDivergence.theirs})
                : t("First divergence: none, every measured cycle is identical.")}</p>
            </div>)}
            {combined && <div className="accuracy-oracle">
              <p>{t("Also checked against a real 6581 ({unit}): the combined-waveform bits before the DAC.", {unit: combined.unit})}</p>
              <ul>{combined.combinations.map(row => <li key={row.name}>{row.name}: {t("{pct} of entries exact ({exact} of {total}), {wrongBits} of {totalBits} bits differ.", {pct: pct(row.exactEntries / combined.totalEntries), exact: row.exactEntries, total: combined.totalEntries, wrongBits: row.wrongBits, totalBits: row.totalBits})}</li>)}</ul>
            </div>}
          </section>
          <section className="accuracy-level">
            <h3>{t("Test ROMs")}</h3>
            {chip.testRoms ? <details><summary>{t("{passed} of {total} test ROMs pass.", {passed: chip.testRoms.passed, total: chip.testRoms.total})}</summary><ul>{chip.testRoms.results.map(rom => <li key={rom.name}>{rom.name}: {rom.passed ? t("pass") : t("fail")}</li>)}</ul></details>
              : <p>{t("No community test ROM suite exists for this chip yet.")}</p>}
          </section>
          <section className="accuracy-level">
            <h3>{t("Analog stage")}</h3>
            <p>{chip.analogStage.label === 'none' ? t("Not measured yet. This stage is a placeholder, not a result.")
              : chip.analogStage.label === 'profile' ? t("A profile built from public documentation, unmeasured against a real unit.")
              : t("Measured against a real console's own recordings.")}</p>
            {chip.analogStage.mixer && <ul>{chip.analogStage.mixer.rows.map(row => <li key={row.name}>{row.name}: {t("{ours} dB (console {hardware} dB)", {ours: row.oursResidualDb.toFixed(1), hardware: row.hardwareResidualDb.toFixed(1)})}</li>)}</ul>}
          </section>
          <section className="accuracy-level">
            <h3>{t("Driver coverage")}</h3>
            <p>{t("The shipped driver reaches {reached} of the chip's {voices} voices.", {reached: chip.driverCoverage.reached, voices: chip.driverCoverage.voices})}</p>
          </section>
        </div>
        <a className="accuracy-sheet-link" href={chip.sheetUrl}>{t("Full sheet on GitHub ↗")}</a>
      </section>;
    })}
    <p className="accuracy-regenerate">{t("Regenerated on every push from the harness's own numbers: ")}<code>pnpm --filter chipvoice-conform status</code>{t(" writes this page's data file alongside the README board and every chip's sheet.")}</p>
  </main><SiteFooter/></>;
}
