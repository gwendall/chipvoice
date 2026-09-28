import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLog } from '../log.mjs';
import { traceProcess } from '../change-stream.mjs';

/**
 * Aaron Giles's ymfm, built natively and driven over a pipe: a second,
 * independent YM2151 model, not derived from a die shot the way Nuked-OPM
 * is - written from the public documentation and other emulators' behaviour,
 * and tuned against real hardware captures. It is not cycle-exact the way
 * Nuked-OPM is: its own `generate()` produces one finished sample per call
 * from the register state at that instant, with no notion of where inside a
 * sample a write landed, so `oracles/ymfm/main.cpp` batches writes to the
 * sample period they fall in rather than interleaving them cycle by cycle.
 * Where the two oracles disagree, Nuked-OPM (the die-shot-derived source)
 * is the one this project's core is ported from and the one its gate must
 * be exact against - see `docs/DECISIONS.md`'s decision 48 and decision 51.
 * This oracle's own gate is report-only; see `oracles/ymfm/README.md`.
 */
const DIR = path.dirname(fileURLToPath(new URL('../../oracles/ymfm/main.cpp', import.meta.url)));
const BINARY = path.join(DIR, 'build', 'ymfm');
const SOURCES = ['main.cpp', 'src/ymfm_opm.cpp'];
const HEADERS = ['src/ymfm.h', 'src/ymfm_fm.h', 'src/ymfm_fm.ipp', 'src/ymfm_opm.h'];

export const ymfm = {
  id: 'ymfm',
  name: 'ymfm (Aaron Giles)',
  voices: ['l', 'r'],
  /**
   * Both voices, by default - but this oracle is never gated exact (see the
   * module doc comment above): every `check:ym2151-ymfm` script run passes
   * `--report`, the same convention `game-music-emu-ay.mjs` documents for
   * an oracle whose divergence is known and not a bug to chase.
   */
  trusted: ['l', 'r'],

  build() {
    const newest = Math.max(...[...SOURCES, ...HEADERS].map((f) => fs.statSync(path.join(DIR, f)).mtimeMs));
    const built = fs.existsSync(BINARY) ? fs.statSync(BINARY).mtimeMs : 0;
    if (built > newest) return;
    fs.mkdirSync(path.dirname(BINARY), { recursive: true });
    const result = spawnSync('c++', ['-O2', '-std=c++17', '-w', '-I./src', '-o', BINARY, 'main.cpp', 'src/ymfm_opm.cpp'], { cwd: DIR, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`building the oracle failed:\n${result.stderr}`);
  },

  /**
   * @param {{ at: number, addr: number, value: number }[]} writes
   * @param {number} cycles
   * @returns {Promise<import('../change-stream.mjs').ChangeStream>}
   */
  trace(writes, cycles) {
    this.build();
    const input = formatLog({ chip: 'ym2151', clock: 3579545, cycles }, writes);
    return traceProcess(BINARY, [], input);
  },
};
