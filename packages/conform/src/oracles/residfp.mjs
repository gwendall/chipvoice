import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { traceProcess } from '../change-stream.mjs';

/**
 * reSID-fp, built natively and driven over a pipe: the SID's generators as
 * reverse-engineered from the die and from sampling real chips, run as a
 * 6581 or, `--model 8580`, as an 8580. Its two digital values per voice -
 * the waveform output and the envelope counter, before the DACs - are what
 * parity is measured on. GPL, and in the harness only; see
 * `oracles/residfp/README.md`. `trace()` streams its stdout through
 * `traceProcess` (change-stream.mjs) into a `ChangeStream` rather than
 * buffering the whole run as one string, since three sawtoothed voices for a
 * few seconds already change on nearly every cycle.
 *
 * One binary serves both models: `main.cpp` reads `--model` and calls
 * reSID-fp's own `SID::setChipModel`, so `build()` is shared and `oracleFor`
 * below only changes which flag `trace()`/`tables()` pass it.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/residfp/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'residfp');
const CORE = path.join(DIR, 'residfp');

/** The library's sources, minus its own test program. */
function sources() {
  const own = fs.readdirSync(CORE).filter((f) => f.endsWith('.cpp')).map((f) => path.join('residfp', f));
  const resample = fs.readdirSync(path.join(CORE, 'resample')).filter((f) => f.endsWith('.cpp') && f !== 'test.cpp').map((f) => path.join('residfp', 'resample', f));
  return [...own, ...resample];
}

function build() {
  const files = ['main.cpp', 'sidcxx11.h', ...sources(), ...fs.readdirSync(CORE).filter((f) => f.endsWith('.h')).map((f) => path.join('residfp', f))];
  const newest = Math.max(...files.map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
  const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
  if (built > newest) return;
  fs.mkdirSync(path.dirname(BINARY), { recursive: true });
  const objects = [];
  for (const src of ['main.cpp', ...sources()]) {
    const obj = path.join('build', src.replace(/[\\/]/g, '_').replace(/\.cpp$/, '.o'));
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-Iresidfp', '-c', src, '-o', obj], { cwd: DIR, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`building the oracle failed on ${src}:\n${result.stderr}`);
    objects.push(obj);
  }
  const link = spawnSync('c++', ['-O2', '-o', BINARY, ...objects], { cwd: DIR, encoding: 'utf8' });
  if (link.status !== 0) throw new Error(`linking the oracle failed:\n${link.stderr}`);
}

/** @param {'6581' | '8580'} model */
function oracleFor(model) {
  return {
    id: model === '8580' ? 'residfp-8580' : 'residfp',
    name: `reSID-fp (libsidplayfp, drfiemost), as an ${model}`,
    voices: ['osc1', 'osc2', 'osc3', 'env1', 'env2', 'env3'],
    trusted: ['osc1', 'osc2', 'osc3', 'env1', 'env2', 'env3'],

    build,

    /** The model's eight waveform tables, 4096 twelve-bit values each. */
    tables() {
      build();
      const result = spawnSync(BINARY, ['--tables', '--model', model], { encoding: 'utf8', maxBuffer: 1 << 26 });
      if (result.status !== 0) throw new Error(`the oracle failed: ${result.stderr}`);
      return result.stdout.trim().split('\n').map((line) => line.split(' ').map(Number));
    },

    /**
     * @param {{ at: number, addr: number, value: number }[]} writes
     * @param {number} cycles
     * @returns {Promise<import('../change-stream.mjs').ChangeStream>}
     */
    trace(writes, cycles) {
      build();
      const input = formatLog({ chip: 'c64', clock: 985248, cycles }, writes);
      return traceProcess(BINARY, ['--model', model], input);
    },
  };
}

export const residfp = oracleFor('6581');
/** The same oracle, as an 8580: the second block on the C64's sheet. */
export const residfp8580 = oracleFor('8580');
