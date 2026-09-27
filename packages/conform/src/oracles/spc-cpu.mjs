import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceProcess } from '../change-stream.mjs';

/**
 * `play-spc`: blargg's own SPC700 (`SPC_CPU.h`, part of the same vendored
 * snes_spc as `oracles/snes-spc/main.cpp`'s S-DSP) playing a real `.spc`
 * snapshot, built natively and driven over stdin/stdout. Unlike `snesSpc`
 * (snes-spc.mjs), which takes a register-write log someone already produced,
 * this one takes the raw file and produces one itself - the reference for
 * `importSpc`'s new CPU and snapshot loader, not just its ported S-DSP. See
 * `oracles/snes-spc/play-spc.cpp` and `packages/conform/corpus/snes/spc/`.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/snes-spc/play-spc.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'play-spc');
const SOURCES = ['play-spc.cpp'];
const HEADERS = [
  'snes_spc/SPC_DSP.cpp', 'snes_spc/SPC_DSP.h',
  'snes_spc/SNES_SPC.cpp', 'snes_spc/SNES_SPC.h',
  'snes_spc/SNES_SPC_misc.cpp', 'snes_spc/SNES_SPC_state.cpp', 'snes_spc/SPC_CPU.h',
  'snes_spc/blargg_common.h', 'snes_spc/blargg_config.h', 'snes_spc/blargg_endian.h', 'snes_spc/blargg_source.h',
];

function build() {
  const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
  const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
  if (built > newest) return;
  fs.mkdirSync(path.dirname(BINARY), { recursive: true });
  const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I.', '-o', BINARY, ...SOURCES], { cwd: DIR, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`building play-spc failed:\n${result.stderr}`);
}

/**
 * Every DSP register write the reference CPU makes while playing `bytes`
 * (a whole `.spc` file, header and all) for `cycles` SPC cycles from the
 * snapshot's own start.
 *
 * @param {Uint8Array} bytes the raw .spc file
 * @param {number} cycles
 * @returns {{ cycle: number, reg: number, value: number }[]}
 */
export function spcCpuWrites(bytes, cycles) {
  build();
  // A bounded timeout, not a tuning knob: this call measures well under a
  // second on this repo's own arrangements (mario's full 88 s render is
  // under 500 ms), so 30 s is pure headroom, not a budget anyone should
  // expect to need. It exists only so a stuck pipe fails loudly with a
  // clear error instead of hanging a check (or CI) indefinitely - the same
  // "never hang, never truncate silently" rule `exportSpc` itself follows.
  const result = spawnSync(BINARY, [String(cycles), '--writes'], { input: Buffer.from(bytes), maxBuffer: 1 << 28, timeout: 30000 });
  if (result.error) throw new Error(`play-spc did not finish (${result.error.code === 'ETIMEDOUT' ? 'timed out after 30s' : result.error.message}):\n${result.stderr?.toString() ?? ''}`);
  if (result.status !== 0) throw new Error(`play-spc failed:\n${result.stderr?.toString() ?? ''}`);
  const text = result.stdout.toString('utf8');
  const writes = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [c, r, v] = line.split(' ');
    writes.push({ cycle: Number(c), reg: parseInt(r, 16), value: parseInt(v, 16) });
  }
  return writes;
}

/**
 * The reference CPU's output samples for `bytes` over `cycles`, as a
 * `ChangeStream` of two voices (0 = left, 1 = right) - the same shape
 * `chipSnes.trace()` (chips/snes.mjs) produces for chipvoice's own render,
 * so `compare()` (compare.mjs) can diff the two directly.
 *
 * @param {Uint8Array} bytes the raw .spc file
 * @param {number} cycles
 * @returns {Promise<import('../change-stream.mjs').ChangeStream>}
 */
export function spcCpuSamples(bytes, cycles) {
  build();
  return traceProcess(BINARY, [String(cycles), '--samples'], Buffer.from(bytes));
}
