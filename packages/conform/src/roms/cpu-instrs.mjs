import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GameBoy} from './gb.mjs';
import {Sm83} from '../../../chipvoice/dist/chips/gb/cpu.js';

/**
 * Runs blargg's `cpu_instrs` (behaviour, 11 individual ROMs) and
 * `instr_timing` (timing, one ROM) against the PACKAGE's own SM83 -
 * [`chips/gb/cpu.ts`](../../../chipvoice/src/chips/gb/cpu.ts), imported by
 * its dist path exactly the way `scores/gbs-corpus/corpus.mjs` reaches
 * `dist/index.js`, not this directory's separate, oracle-side `sm83.mjs`
 * (that one drives `dmg_sound` only, and is known to under-count CB-prefixed
 * RES/SET/rotate on `(HL)` by 4T; it must not be the thing these two suites
 * check). `gb.mjs`'s `GameBoy` already has everything both suites need - a
 * flat 32 KiB no-mapper ROM, a working TIMA/TMA/TAC timer, interrupts - by
 * way of its own accepted `cpuClass` option; the only addition made there
 * for this script is `$FF01`/`$FF02` serial capture, blargg's protocol for
 * both of these suites (an older shell than `dmg_sound`'s `$A000` one - see
 * both suites' own `readme.txt`, vendored alongside the ROMs).
 *
 *   node src/roms/cpu-instrs.mjs [--only <name>] [--json <file>] [--sheet <file>]
 *
 * A ROM is run until it either prints "Passed" or a failure line over
 * serial, or parks the CPU in a jump to itself with nothing conclusive said
 * (`HUNG`), or exhausts a thirty-second, real-hardware-time budget.
 * `instr_timing` is the one that actually settles the timing question
 * `scores/gbs-corpus/compare.mjs` raises against GME: it checks every
 * opcode's T-cycle count against real Game Boy hardware behaviour, not
 * against another emulator's.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'roms');
const GB_HZ = 4194304;
const BUDGET = 30 * GB_HZ;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const only = option('only', null);

/** Runs one ROM to a verdict: "Passed" or a failure line over serial, a
 * self-jump with nothing said (hung), or the budget (also hung). */
function runRom(rom) {
  const gb = new GameBoy(rom, {cpuClass: Sm83});
  gb.powerOn();
  const step = GB_HZ / 100;
  for (let ran = 0; ran < BUDGET; ran += step) {
    gb.run(step);
    if (/passed/i.test(gb.serial)) return {passed: true, hung: false, text: gb.serial.trim()};
    if (/failed/i.test(gb.serial)) return {passed: false, hung: false, text: gb.serial.trim()};
    if (gb.halted()) break;
  }
  return {passed: false, hung: true, text: gb.serial.trim()};
}

const suites = [
  {dir: 'cpu_instrs/individual', label: 'cpu_instrs'},
  {dir: 'instr_timing', label: 'instr_timing'},
];

const results = [];
for (const {dir, label} of suites) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  for (const file of fs.readdirSync(full).filter(f => f.endsWith('.gb')).sort()) {
    const name = `${label}/${file.replace(/\.gb$/, '')}`;
    if (only && !name.includes(only)) continue;
    const rom = new Uint8Array(fs.readFileSync(path.join(full, file)));
    const outcome = runRom(rom);
    const verdict = outcome.hung ? 'HUNG' : outcome.passed ? 'PASS' : 'FAIL';
    const said = outcome.text || (outcome.hung ? 'no verdict over serial' : 'nothing');
    console.log(`${verdict}  ${name.padEnd(28)} ${said}`);
    results.push({name, passed: outcome.passed, hung: outcome.hung, text: said});
  }
}

const passed = results.filter(r => r.passed).length;
console.log(`\n${passed} of ${results.length} passed`);

const jsonPath = option('json', null);
if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
  fs.writeFileSync(jsonPath, JSON.stringify({date: new Date().toISOString().slice(0, 10), passed, total: results.length, results}, null, 2) + '\n');
}

const sheetPath = option('sheet', null);
if (sheetPath) {
  const text = fs.readFileSync(sheetPath, 'utf8');
  const begin = text.indexOf('<!-- cpu-instrs:begin -->');
  const end = text.indexOf('<!-- cpu-instrs:end -->');
  if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no cpu-instrs markers`);
  const lines = [
    '<!-- cpu-instrs:begin -->',
    `Run by \`conform\`'s SM83 fixture on ${new Date().toISOString().slice(0, 10)}, against the package's own \`chips/gb/cpu.ts\`: ${passed} of ${results.length} pass.`,
    '',
    '| ROM | Result | What it said |',
    '| --- | --- | --- |',
    ...results.map(r => `| \`${r.name}\` | ${r.hung ? 'hung' : r.passed ? 'pass' : 'fail'} | ${r.text.replace(/\|/g, '\\|').replace(/\s+/g, ' ')} |`),
    '<!-- cpu-instrs:end -->',
  ];
  fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- cpu-instrs:end -->'.length));
}

process.exit(results.every(r => r.passed) ? 0 : 1);
