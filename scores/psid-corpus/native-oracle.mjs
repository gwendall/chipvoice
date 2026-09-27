import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

/**
 * Builds the pinned, independent PSID/RSID oracle in local artifacts, then
 * runs it against one file: libsidplayfp's own CPU + CIA + VIC + tune-loading
 * engine (GPL-2.0-or-later, decision 41), with a small original write-logger
 * (`sidplayfp-harness.cpp`) plugged in through its public
 * `SidConfig::sidEmulation` hook instead of a real SID emulation. Mirrors
 * `scores/arrangements/native-oracle.py`'s pinned-clone-and-build pattern,
 * minus cmake: libsidplayfp ships autotools, not cmake, and only a small,
 * fixed subset of its own source list (`CORE_SOURCES` below, copied from its
 * `Makefile.am`'s own `src_libsidplayfp_la_SOURCES`, minus the song-length
 * database and every hardware/reSID-fp builder - none of that is reachable
 * from a harness that never asks for real SID audio) is ever compiled.
 *
 * libsidplayfp's own build also needs two files this source tree does not
 * ship pre-built: `src/psiddrv.bin` and `src/sidtune/sidplayer{1,2}.bin`,
 * generated from their own committed `.a65` sources by `xa65` (a second,
 * separately pinned GPL-2.0 dependency, André Fachat's original cross
 * assembler) - see `Makefile.am`'s own `.a65.bin:` rule, reproduced here
 * exactly (assemble with `xa -R -G`, then the same `od`/`sed` pipeline).
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ORACLE_DIR = path.join(ROOT, '.artifacts', 'psid-corpus', 'sidplayfp-oracle');
const SIDPLAYFP_REVISION = 'ecd932b3ef87746008472bc7e65b0c419a483e02';
const XA65_REVISION = '3be092964c80b10564f600325b1e4ff455387140';

const run = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** `Makefile.am`'s own `src_libsidplayfp_la_SOURCES`, `.cpp` entries only,
 * minus `utils/SidDatabase.cpp` and `utils/iniParser.cpp` (the song-length
 * database; nothing here ever looks a tune up in it) and every builder
 * (`builders/*`; the harness supplies its own `sidemu` instead). */
const CORE_SOURCES = [
  'EventScheduler.cpp', 'player.cpp', 'psiddrv.cpp', 'reloc65.cpp', 'simpleMixer.cpp', 'sidemu.cpp',
  'c64/c64.cpp', 'c64/mmu.cpp',
  'c64/VIC_II/mos656x.cpp',
  'c64/CPU/mos6510.cpp', 'c64/CPU/mos6510debug.cpp',
  'c64/CIA/interrupt.cpp', 'c64/CIA/mos652x.cpp', 'c64/CIA/SerialPort.cpp', 'c64/CIA/timer.cpp', 'c64/CIA/tod.cpp',
  'sidplayfp/sidplayfp.cpp', 'sidplayfp/sidbuilder.cpp', 'sidplayfp/SidConfig.cpp', 'sidplayfp/SidInfo.cpp',
  'sidplayfp/SidTune.cpp', 'sidplayfp/SidTuneInfo.cpp',
  'sidtune/MUS.cpp', 'sidtune/p00.cpp', 'sidtune/prg.cpp', 'sidtune/PSID.cpp',
  'sidtune/SidTuneBase.cpp', 'sidtune/SidTuneTools.cpp',
];

/** Placeholder version numbers only: `sidversion.h.in`'s `@LIB_MAJOR@` etc.
 * are substituted by the release-packaging script this source tree does not
 * carry, and the numbers only ever reach a credits string nothing here
 * reads. */
const SIDVERSION_H = `#ifndef LIBSIDPLAYFP_VERSION_H\n#define LIBSIDPLAYFP_VERSION_H\n#ifndef SIDPLAYFP_H\n#  error Do not include directly.\n#endif\n#define LIBSIDPLAYFP_VERSION_MAJ 2\n#define LIBSIDPLAYFP_VERSION_MIN 0\n#define LIBSIDPLAYFP_VERSION_LEV 0\n#endif\n`;

async function ensureRepo(dir, url, revision, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (!fs.existsSync(dir)) {
        await run('git', ['clone', url, dir]);
        await run('git', ['-C', dir, 'checkout', revision]);
      }
      const head = (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
      if (head !== revision) throw new Error(`${dir}: expected ${revision}, got ${head}`);
      return;
    } catch (error) {
      lastError = error;
      if (fs.existsSync(dir)) await fs.promises.rm(dir, { recursive: true, force: true });
      if (attempt < attempts) await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`cloning ${url} failed after ${attempts} attempts: ${lastError.message}`);
}

/** Assembles one `.a65` source into the C-array-literal text file
 * `psiddrv.cpp`/`SidTuneBase.cpp` (via `sidplayer1.bin`/`sidplayer2.bin`)
 * `#include` directly - `Makefile.am`'s `.a65.bin:` rule, run by hand since
 * this build never runs `automake`. */
async function assembleA65(xa, a65Path, binPath) {
  const o65Path = `${binPath}.o65`;
  await run(xa, ['-R', '-G', a65Path, '-o', o65Path]);
  const { stdout } = await run('od', ['-v', '-An', '-tx1', o65Path]);
  const bytes = stdout.trim().split(/\s+/).filter(Boolean);
  // The Makefile's own rule folds this to eight bytes a line via `sed`; the
  // exact column width is cosmetic (this only ever feeds a C array
  // initializer, `psiddrv.cpp`'s own `#include "psiddrv.bin"`), kept anyway
  // so a diff against a real `make dist` tarball's own copy stays readable.
  const lines = [];
  for (let i = 0; i < bytes.length; i += 8) {
    lines.push(bytes.slice(i, i + 8).map((byte) => `0x${byte},`).join(' '));
  }
  await fs.promises.writeFile(binPath, `${lines.join('\n')}\n`);
  await fs.promises.rm(o65Path, { force: true });
}

async function buildXa65() {
  const dir = path.join(ORACLE_DIR, 'xa65');
  await ensureRepo(dir, 'https://github.com/fachat/xa65.git', XA65_REVISION);
  const bin = path.join(dir, 'xa', 'xa');
  if (!fs.existsSync(bin)) await run('make', [], { cwd: path.join(dir, 'xa') });
  return bin;
}

async function buildSidplayfp(xa) {
  const dir = path.join(ORACLE_DIR, 'sidplayfp');
  await ensureRepo(dir, 'https://github.com/libsidplayfp/libsidplayfp.git', SIDPLAYFP_REVISION);
  const src = path.join(dir, 'src');

  await assembleA65(xa, path.join(src, 'psiddrv.a65'), path.join(src, 'psiddrv.bin'));
  await assembleA65(xa, path.join(src, 'sidtune', 'sidplayer1.a65'), path.join(src, 'sidtune', 'sidplayer1.bin'));
  await assembleA65(xa, path.join(src, 'sidtune', 'sidplayer2.a65'), path.join(src, 'sidtune', 'sidplayer2.bin'));
  await fs.promises.writeFile(path.join(src, 'sidplayfp', 'sidversion.h'), SIDVERSION_H);

  const buildDir = path.join(ORACLE_DIR, 'build');
  await fs.promises.mkdir(buildDir, { recursive: true });
  // `sidcxx11.h` normally reads HAVE_CXX17 etc. from a `config.h` autoconf
  // generates; this build never runs `configure`, so they are supplied
  // directly - accurate for the `-std=c++17` this compiles with.
  const cxxFlags = [
    '-O2', '-std=c++17', '-w', '-DHAVE_CXX17', '-DNDEBUG',
    '-DPACKAGE=\"libsidplayfp\"', '-DVERSION=\"2.0.0\"', '-DPACKAGE_URL=\"https://github.com/libsidplayfp/libsidplayfp\"',
    '-I', src,
  ];
  const objects = [];
  for (const rel of CORE_SOURCES) {
    const obj = path.join(buildDir, `${rel.replace(/[\\/]/g, '_').replace(/\.cpp$/, '')}.o`);
    if (!fs.existsSync(obj) || fs.statSync(obj).mtimeMs < fs.statSync(path.join(src, rel)).mtimeMs) {
      await run('c++', [...cxxFlags, '-c', path.join(src, rel), '-o', obj]);
    }
    objects.push(obj);
  }
  const harnessSrc = path.join(HERE, 'sidplayfp-harness.cpp');
  const harnessObj = path.join(buildDir, 'sidplayfp-harness.o');
  await run('c++', [...cxxFlags, '-c', harnessSrc, '-o', harnessObj]);
  const binary = path.join(ORACLE_DIR, 'sidplayfp-harness');
  await run('c++', ['-O2', '-o', binary, harnessObj, ...objects]);
  return { binary, harnessSrc };
}

/** Builds (or reuses a cached build of) the oracle, then runs it against
 * `sidPath` for `cycles` C64 clock cycles on 1-based `song` (0 keeps the
 * tune's own default). Returns `{trace, manifest}`; `manifest` records every
 * SHA-256 a reader would need to check this run's own provenance, the same
 * fields `native-oracle.py`'s own `native-reference.json` records. */
export async function runOracle(sidPath, cycles, song = 0) {
  await fs.promises.mkdir(ORACLE_DIR, { recursive: true });
  const xa = await buildXa65();
  const { binary, harnessSrc } = await buildSidplayfp(xa);
  const args = [sidPath, String(cycles)];
  if (song) args.push(String(song));
  const { stdout: trace } = await run(binary, args, { maxBuffer: 1024 * 1024 * 64 });
  const manifest = {
    sidplayfpRevision: SIDPLAYFP_REVISION,
    xa65Revision: XA65_REVISION,
    sourceSha256: sha256(await fs.promises.readFile(sidPath)),
    harnessSourceSha256: sha256(await fs.promises.readFile(harnessSrc)),
    cycles, song,
  };
  return { trace, manifest };
}
