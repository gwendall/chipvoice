import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chipVrc6, chipVrc6Combined } from '../src/chips/vrc6.mjs';
import { gameMusicEmu } from '../src/oracles/game-music-emu.mjs';
import { mesenVrc6, CYCLE_OFFSET } from '../src/oracles/mesen-vrc6.mjs';
import { parseLog, formatLog } from '../src/log.mjs';
import { compare } from '../src/compare.mjs';
import { ChangeStream, traceProcess } from '../src/change-stream.mjs';

/**
 * NEXT-14 round 2's own instruction: "Add a negative test per gate, run in
 * CI" - a cheap proof that each of VRC6's exact gates (`check:vrc6-core`,
 * `check:vrc6-core-mesen`, `check:vrc6-edge-mesen`, and, since round 3,
 * `check:vrc6-flat-mesen`) would actually catch a real regression, not pass
 * only because nothing in the corpus happens to exercise the path a bug
 * would break.
 *
 * `cli.mjs` (the thing these `package.json` scripts run) always feeds the
 * SAME parsed log to both `chip.trace()` and `oracle.trace()` - there is no
 * argv this test could pass it to make the two sides see different writes,
 * so a corruption applied to the log FILE and run once through `cli.mjs`
 * corrupts both sides identically and proves nothing (tried first; see the
 * corruption comment below for the specific case that silently passed). This
 * test instead calls `chip.trace()` and `oracle.trace()` directly - the same
 * two functions and the same `compare()` every gate script is built from -
 * one on the corpus log's own writes, the other on a deliberately corrupted
 * copy, and asserts `compare()` finds a divergence. That is precisely what a
 * real regression in the chip (or a break in the oracle wrapper) would look
 * like from the harness's own point of view: one side no longer agreeing
 * with the log the other side was given.
 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const GATES = [
  { name: 'check:vrc6-core (Game_Music_Emu)', chip: chipVrc6, oracle: gameMusicEmu, log: 'corpus/vrc6/core/pulse-levels.log' },
  { name: 'check:vrc6-core-mesen (Mesen 2)', chip: chipVrc6Combined, oracle: mesenVrc6, log: 'corpus/vrc6/core/pulse-levels.log' },
  { name: 'check:vrc6-edge-mesen (Mesen 2)', chip: chipVrc6Combined, oracle: mesenVrc6, log: 'corpus/vrc6/edge/saw-enable.log' },
  { name: 'check:vrc6-flat-mesen (Mesen 2, pulse mapping)', chip: chipVrc6Combined, oracle: mesenVrc6, log: 'corpus/vrc6/script-duty.log' },
];

/**
 * Flips bit 7 - the E (enable) bit every period-hi write in this corpus
 * packs alongside the period's own top nibble (`periodWrites()`,
 * `generate-vrc6.mjs`) - of the LAST write in the log, turning that
 * channel's final "stay enabled"/"stay disabled" state into its opposite for
 * the log's whole tail. Deliberately not a blanket bit-flip of the byte: an
 * earlier version of this test flipped every bit of `core/saw-rates.log`'s
 * last write (`$B000 = $3F`, the rate register) to `$C0` and found nothing
 * diverged, because both sides mask a rate register to 6 bits and `$3F`
 * (all six set) and `$C0` (none of the six set, after masking `$FF ^ $3F`'s
 * complement) both collapse to a rate of 0 - a real but unhelpful case for a
 * test that needs a guaranteed-visible divergence, not just a guaranteed
 * change of bytes on the wire.
 */
function corruptLastWrite(writes) {
  const copy = writes.map((w) => ({ ...w }));
  const last = copy.length - 1;
  assert.ok(last >= 0, 'expected at least one write to corrupt');
  copy[last].value = (copy[last].value ^ 0x80) & 0xff;
  return copy;
}

for (const gate of GATES) {
  const log = parseLog(fs.readFileSync(path.join(ROOT, gate.log), 'utf8'));

  const clean = ChangeStream.from(await gate.oracle.trace(log.writes, log.cycles, log.memory));
  const cleanOurs = ChangeStream.from(await gate.chip.trace(log.writes, log.cycles, log.memory));
  const cleanResult = compare(cleanOurs, clean, { cycles: log.cycles, voices: gate.oracle.trusted.map((n) => gate.chip.voices.indexOf(n)) });
  assert.equal(cleanResult.first, null, `${gate.name}: the unmodified log must not diverge`);

  const corrupted = corruptLastWrite(log.writes);
  const dirtyOurs = ChangeStream.from(await gate.chip.trace(log.writes, log.cycles, log.memory));
  const dirtyOracle = ChangeStream.from(await gate.oracle.trace(corrupted, log.cycles, log.memory));
  const dirtyResult = compare(dirtyOurs, dirtyOracle, { cycles: log.cycles, voices: gate.oracle.trusted.map((n) => gate.chip.voices.indexOf(n)) });
  assert.notEqual(dirtyResult.first, null, `${gate.name}: a one-sided corrupted write must diverge`);

  console.log(`ok - ${gate.name}: exact gate passes clean, catches a one-sided corrupted write`);
}

/**
 * Second, separate negative test for `check:vrc6-flat-mesen`: not a
 * corrupted corpus log (the GATES loop above already covers that, for this
 * gate too), but a mutated ORACLE - proof that the specific algebraic
 * mapping in `Vrc6Pulse.h`'s "chipvoice patch" comment (see
 * docs/chips/vrc6.md's "The pulse mapping") is what makes the gate exact,
 * not merely that some edit to that file would be noticed by something.
 *
 * Builds a second `mesen-vrc6` binary from the exact same vendored/shim
 * sources `oracles/mesen-vrc6.mjs` does, but shadows only `Vrc6Pulse.h` with
 * a copy of the live, patched file whose one changed line is flipped to a
 * DIFFERENT, deliberately wrong comparison: `_step > (uint8_t)(15 -
 * _dutyCycle)`, the mapping's own inequality reversed. (Not the fully
 * unmapped original, `_step <= _dutyCycle` - round 2's own baseline numbers
 * already prove that one diverges; reversing the inequality instead checks
 * that the exact direction the mapping derives, not just the presence of a
 * mapping-shaped line, is what the gate depends on.) The shadow directory is
 * listed on the compiler's include path BEFORE `-Ivendor`, so `Vrc6Audio.h`'s
 * own `#include "NES/Mappers/Audio/Vrc6Pulse.h"` resolves to the shadow copy,
 * not the real, patched one.
 */
{
  const MESEN_DIR = path.join(ROOT, 'oracles/mesen');
  const MESEN_SOURCES = [
    'main-vrc6.cpp',
    'vendor/NES/APU/NesApu.cpp',
    'vendor/NES/APU/DeltaModulationChannel.cpp',
    'vendor/NES/APU/BaseExpansionAudio.cpp',
    'shim/NES/NesCpu.cpp',
  ];

  const realHeader = fs.readFileSync(path.join(MESEN_DIR, 'vendor/NES/Mappers/Audio/Vrc6Pulse.h'), 'utf8');
  const mappedLine = 'return _step >= (uint8_t)(15 - _dutyCycle) ? _volume : 0;';
  assert.ok(realHeader.includes(mappedLine), 'expected the live Vrc6Pulse.h to still carry the mapped condition this test mutates');
  const wrongLine = 'return _step > (uint8_t)(15 - _dutyCycle) ? _volume : 0;';
  const wrongHeader = realHeader.replace(mappedLine, wrongLine);

  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vrc6-wrong-mapping-'));
  try {
    const shadowDir = path.join(scratchRoot, 'NES/Mappers/Audio');
    fs.mkdirSync(shadowDir, { recursive: true });
    fs.writeFileSync(path.join(shadowDir, 'Vrc6Pulse.h'), wrongHeader);

    const wrongBinary = path.join(scratchRoot, 'mesen-vrc6-wrong');
    const built = spawnSync('c++', ['-O2', '-std=c++17', '-w', `-I${scratchRoot}`, '-Ishim', '-Ivendor', '-o', wrongBinary, ...MESEN_SOURCES], {
      cwd: MESEN_DIR,
      encoding: 'utf8',
    });
    assert.equal(built.status, 0, `building the deliberately-wrong-mapping oracle failed:\n${built.stderr}`);

    const log = parseLog(fs.readFileSync(path.join(ROOT, 'corpus/vrc6/script-duty.log'), 'utf8'));
    const input = formatLog({ chip: 'vrc6', clock: 1789773, cycles: log.cycles }, log.writes);
    const wrongStream = ChangeStream.from(await traceProcess(wrongBinary, [], input));
    for (let i = 0; i < wrongStream.length; i++) wrongStream.cycle[i] += CYCLE_OFFSET;
    const ours = ChangeStream.from(await chipVrc6Combined.trace(log.writes, log.cycles, log.memory));
    const result = compare(ours, wrongStream, { cycles: log.cycles, voices: [0] });
    assert.notEqual(result.first, null, 'check:vrc6-flat-mesen: a deliberately wrong pulse mapping must diverge from chipvoice');

    console.log('ok - check:vrc6-flat-mesen: a deliberately wrong pulse mapping (reversed inequality) diverges from chipvoice');
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
}
