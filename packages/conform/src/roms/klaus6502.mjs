import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cpu6510, IllegalOpcodeError } from 'chipvoice';

/**
 * Runs Klaus Dormann's 6502 functional test and Bruce Clark's decimal-mode
 * test against `chipvoice`'s own `Cpu6510` - the PSID/RSID player's CPU -
 * to its own verdict, rather than against a second emulator: each program
 * checks itself, so there is nothing else to compare against. See
 * `roms/klaus-6502/README.md` for where the two binaries come from, their
 * licences and their SHA-256, and what each program's verdict means.
 *
 *   node src/roms/klaus6502.mjs [--sheet <file>]
 *
 * Both programs are loaded as a flat 64 KiB image at `$0000` and started at
 * `$0400`. The functional test's convention (and Bruce Clark's `trap`
 * macros, expanded the same way here) is a single instruction - `jmp *` or
 * a taken branch to its own address - that never advances the program
 * counter; the loop below catches that the instant it happens, by comparing
 * the PC before and after one `step()`, and the address it is stuck at is
 * the verdict: `$3469` is the documented pass address, anything else a
 * named failure. The decimal test has no trap convention (its own end is a
 * 65C02 `STP` byte `Cpu6510` does not implement, being an NMOS core), so the
 * loop instead stops the instant the PC reaches `DONE` (`$044b`) and reads
 * its `ERROR` byte (`$0b`) directly.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'roms', 'klaus-6502');
const START_PC = 0x0400;
/** Generous: the real functional-test run traps in well under ten million steps. */
const STEP_LIMIT = 200_000_000;

function load(name) {
  const bin = new Uint8Array(fs.readFileSync(path.join(ROOT, name)));
  const ram = new Uint8Array(0x10000);
  ram.set(bin);
  const bus = {
    read: (addr) => ram[addr & 0xffff],
    write: (addr, value) => { ram[addr & 0xffff] = value & 0xff; },
  };
  const cpu = new Cpu6510(bus);
  cpu.pc = START_PC;
  return { ram, cpu };
}

/** Steps until a self-jump/self-branch trap or an `IllegalOpcodeError`; never both. */
function runToTrap(cpu, steps) {
  for (let i = 0; i < steps; i++) {
    const before = cpu.pc;
    try {
      cpu.step();
    } catch (err) {
      if (err instanceof IllegalOpcodeError) return { trapPc: before, illegal: err, steps: i };
      throw err;
    }
    if (cpu.pc === before) return { trapPc: before, steps: i };
  }
  return { trapPc: null, steps };
}

function runFunctional() {
  const { cpu } = load('6502_functional_test.bin');
  const SUCCESS_PC = 0x3469;
  const { trapPc, illegal, steps } = runToTrap(cpu, STEP_LIMIT);
  if (illegal) {
    return { name: 'functional', passed: false, cycles: cpu.cycle, steps, text: `threw ${illegal.message} at pc=$${trapPc.toString(16)}` };
  }
  if (trapPc === null) {
    return { name: 'functional', passed: false, cycles: cpu.cycle, steps, text: `no trap in ${steps} steps` };
  }
  const passed = trapPc === SUCCESS_PC;
  return { name: 'functional', passed, cycles: cpu.cycle, steps, text: passed ? `success trap at $${trapPc.toString(16)}` : `stuck at $${trapPc.toString(16)}, not the documented success address $${SUCCESS_PC.toString(16)}` };
}

function runDecimal() {
  const { ram, cpu } = load('6502_decimal_test.bin');
  const DONE_PC = 0x044b;
  const ERROR_ADDR = 0x0b;
  let steps = 0;
  for (; steps < STEP_LIMIT && cpu.pc !== DONE_PC; steps++) cpu.step();
  const reached = cpu.pc === DONE_PC;
  const error = reached ? ram[ERROR_ADDR] : null;
  const passed = reached && error === 0;
  const text = !reached
    ? `never reached DONE ($${DONE_PC.toString(16)}) in ${steps} steps`
    : passed
      ? `all 130,050 decimal ADC/SBC cases matched the predicted result (ERROR=0)`
      : `ERROR=${error} at DONE: at least one decimal ADC/SBC case diverged from the predicted result`;
  return { name: 'decimal', passed, cycles: cpu.cycle, steps, text };
}

const results = [runFunctional(), runDecimal()];
for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.name.padEnd(12)} ${r.text} (${r.steps} steps, ${r.cycles} cycles)`);
const passed = results.filter((r) => r.passed).length;
console.log(`\n${passed} of ${results.length} passed`);

const args = process.argv.slice(2);
const sheetIdx = args.indexOf('--sheet');
const sheetPath = sheetIdx >= 0 ? args[sheetIdx + 1] : null;
if (sheetPath) {
  const text = fs.readFileSync(sheetPath, 'utf8');
  const begin = text.indexOf('<!-- cpu6510:begin -->');
  const end = text.indexOf('<!-- cpu6510:end -->');
  if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no cpu6510 markers`);
  const lines = [
    '<!-- cpu6510:begin -->',
    `Run by \`conform\`'s \`check:6510\` on ${new Date().toISOString().slice(0, 10)}: ${passed} of ${results.length} pass.`,
    '',
    '| Test | Result | What it said |',
    '| --- | --- | --- |',
    ...results.map((r) => `| \`${r.name}\` | ${r.passed ? 'pass' : 'fail'} | ${r.text.replace(/\|/g, '\\|')} |`),
    '<!-- cpu6510:end -->',
  ];
  fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- cpu6510:end -->'.length));
}

process.exit(results.every((r) => r.passed) ? 0 : 1);
