import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Nes } from './nes.mjs';
import { GameBoy } from './gb.mjs';

/**
 * Runs blargg's APU test ROMs against the chips and prints what each one said.
 *
 *   node src/roms/run.mjs [--chip 2a03|dmg] [--only <name>] [--json <file>] [--sheet <file>]
 *
 * Every ROM under `roms/` is run for up to thirty seconds of emulated time.
 * The newer NES ones speak blargg's `$6000` protocol: `$80` there means
 * running, `$81` means it wants the reset button - which is given, an eighth
 * of a second later - and anything below `$80` is the result, 0 for passed
 * and otherwise the code the ROM's readme explains, with the text the ROM
 * wrote at `$6004`. The older ones print to the screen and park the CPU in a
 * jump to itself; their screen is read back and "Passed" or "Failed #n" is
 * the verdict. The Game Boy ones speak the same protocol at `$A000`.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'roms');
const CPU_HZ = 1789773;
const LIMIT = 30 * CPU_HZ;
const GB_HZ = 4194304;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const only = option('only', null);
const chip = option('chip', '2a03');

const SUITES = chip === 'dmg' ? ['dmg_sound'] : ['apu_test', 'apu_reset', 'dmc_tests', 'apu_2005'];
const EXT = chip === 'dmg' ? '.gb' : '.nes';

/** A dmg_sound ROM: the `$A000` protocol, no reset button, no screen to read. */
function runGameBoy(rom) {
  const gb = new GameBoy(rom);
  gb.powerOn();
  const step = GB_HZ / 100;
  for (let ran = 0; ran < 30 * GB_HZ; ran += step) {
    gb.run(step);
    const r = gb.result();
    if (r.valid && r.status !== 0x80) return { status: r.status, text: r.text, cycles: gb.cpu.cycles, resets: 0 };
    if (!r.valid && gb.halted()) break;
  }
  return { status: -1, text: gb.result().text, cycles: gb.cpu.cycles, resets: 0 };
}

const results = [];
for (const suite of SUITES) {
  const dir = path.join(ROOT, suite);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(EXT)).sort()) {
    const name = `${suite}/${file.replace(/\.(nes|gb)$/, '')}`;
    if (only && !name.includes(only)) continue;
    if (chip === 'dmg') {
      const outcome = runGameBoy(new Uint8Array(fs.readFileSync(path.join(dir, file))));
      const passed = outcome.status === 0;
      const verdict = outcome.status < 0 ? 'HUNG' : passed ? 'PASS' : 'FAIL';
      const detail = outcome.status < 0 ? `no result in thirty seconds${outcome.text ? `: ${outcome.text.replace(/\s+/g, ' ')}` : ''}` : `code ${outcome.status}${outcome.text ? `: ${outcome.text.replace(/\s+/g, ' ')}` : ''}`;
      console.log(`${verdict}  ${name.padEnd(32)} ${detail}`);
      results.push({ name, status: outcome.status, passed, text: outcome.text, resets: 0 });
      continue;
    }
    const rom = new Uint8Array(fs.readFileSync(path.join(dir, file)));
    const nes = new Nes(rom);
    nes.powerOn();
    let outcome = { status: -1, text: '', cycles: 0, resets: 0 };
    let started = false;
    const step = CPU_HZ / 100;
    for (let ran = 0; ran < LIMIT; ran += step) {
      nes.run(step);
      const r = nes.result();
      if (!r.valid) {
        if (nes.halted()) break;
        continue;
      }
      if (r.status === 0x80) { started = true; continue; }
      if (r.status === 0x81) {
        // The reset button, after at least a tenth of a second. The status
        // byte is put back to "running" here: the ROM rewrites it when it
        // has something new to say, and until then it must not read as a
        // second request.
        nes.run(CPU_HZ / 8);
        nes.reset();
        nes.wram[0] = 0x80;
        outcome.resets++;
        continue;
      }
      if (started || r.status < 0x80) {
        outcome = { ...outcome, status: r.status, text: r.text, cycles: nes.cpu.cycles };
        break;
      }
    }
    if (outcome.status < 0 && nes.halted()) {
      // An older ROM. The verdict is on the screen as "Passed", "Failed #n"
      // or a hex code where 1 is a pass - or, when the screen is blank, in
      // the beeps: a code is beeped that many times, and one beep is a pass.
      const text = nes.screenText();
      const failed = /failed\s*#?\s*(\d+)/i.exec(text);
      const hexCode = /^\s*\$([0-9A-Fa-f]{2})\s*$/.exec(text);
      const recent = nes.beeps.filter((c) => c > nes.cpu.cycles - 3 * CPU_HZ).length;
      let status;
      if (/passed/i.test(text)) status = 0;
      else if (failed) status = Number(failed[1]);
      else if (hexCode) status = parseInt(hexCode[1], 16) === 1 ? 0 : parseInt(hexCode[1], 16);
      else if (recent > 0) status = recent === 1 ? 0 : recent;
      else status = 1;
      const said = text || (recent > 0 ? `${recent} beep${recent === 1 ? '' : 's'}` : 'nothing');
      outcome = { ...outcome, status, text: said, cycles: nes.cpu.cycles };
    }
    const passed = outcome.status === 0;
    const verdict = outcome.status < 0 ? 'HUNG' : passed ? 'PASS' : 'FAIL';
    const detail = outcome.status < 0 ? 'no result in thirty seconds' : `code ${outcome.status}${outcome.text ? `: ${outcome.text.replace(/\s+/g, ' ')}` : ''}`;
    console.log(`${verdict}  ${name.padEnd(32)} ${detail}`);
    results.push({ name, status: outcome.status, passed, text: outcome.text, resets: outcome.resets });
  }
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed} of ${results.length} passed`);

const jsonPath = option('json', null);
if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ date: new Date().toISOString().slice(0, 10), passed, total: results.length, results }, null, 2) + '\n');
}

const sheetPath = option('sheet', null);
if (sheetPath) {
  const text = fs.readFileSync(sheetPath, 'utf8');
  const begin = text.indexOf('<!-- roms:begin -->');
  const end = text.indexOf('<!-- roms:end -->');
  if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no roms markers`);
  const lines = [
    '<!-- roms:begin -->',
    `Run by \`conform\`'s ${chip === 'dmg' ? 'SM83' : '6502'} fixture on ${new Date().toISOString().slice(0, 10)}: ${passed} of ${results.length} pass.`,
    '',
    '| ROM | Result | What it said |',
    '| --- | --- | --- |',
    ...results.map((r) => `| \`${r.name}\` | ${r.status < 0 ? 'hung' : r.passed ? 'pass' : `fail, code ${r.status}`} | ${r.text.replace(/\|/g, '\\|').replace(/\s+/g, ' ')} |`),
    '<!-- roms:end -->',
  ];
  fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- roms:end -->'.length));
}

process.exit(results.every((r) => r.passed) ? 0 : 1);
