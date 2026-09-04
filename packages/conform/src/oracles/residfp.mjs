import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';

/**
 * reSID-fp, built natively and driven over a pipe: the SID's generators as
 * reverse-engineered from the die and from sampling real chips, run as a
 * 6581. Its two digital values per voice - the waveform output and the
 * envelope counter, before the DACs - are what parity is measured on. GPL,
 * and in the harness only; see `oracles/residfp/README.md`.
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

export const residfp = {
  id: 'residfp',
  name: 'reSID-fp (libsidplayfp, drfiemost), as a 6581',
  voices: ['osc1', 'osc2', 'osc3', 'env1', 'env2', 'env3'],
  trusted: ['osc1', 'osc2', 'osc3', 'env1', 'env2', 'env3'],

  build() {
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
  },

  /** The 6581's eight waveform tables, 4096 twelve-bit values each. */
  tables() {
    this.build();
    const result = spawnSync(BINARY, ['--tables'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (result.status !== 0) throw new Error(`the oracle failed: ${result.stderr}`);
    return result.stdout.trim().split('\n').map((line) => line.split(' ').map(Number));
  },

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   */
  trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'c64', clock: 985248, cycles }, writes);
    const result = spawnSync(BINARY, [], { input, encoding: 'utf8', maxBuffer: 1 << 30 });
    if (result.status !== 0) throw new Error(`the oracle failed: ${result.stderr}`);
    const changes = [];
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      const [cycle, voice, value] = line.split(' ').map(Number);
      changes.push({ cycle, voice, value });
    }
    return changes;
  },
};
