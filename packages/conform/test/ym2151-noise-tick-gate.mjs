import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ym2151 } from 'chipvoice';
import { chipYm2151 } from '../src/chips/ym2151.mjs';
import { nukedOpm } from '../src/oracles/nuked-opm.mjs';
import { parseLog } from '../src/log.mjs';
import { compare } from '../src/compare.mjs';
import { ChangeStream } from '../src/change-stream.mjs';

/**
 * `ym2151-gate.mjs` proves `check:ym2151-core`/`-edge` would catch a
 * one-sided corrupted *log*, but that only shows `compare()` itself can see
 * an injected difference - not that the gate would catch a real bug in the
 * port. This test reintroduces the exact bug `envelopePhase6`'s own doc
 * comment (`packages/chipvoice/src/chips/ym2151.ts`) describes: an earlier
 * port did the `eg_serial` load/shift *before* reading `eg_serial_bit`
 * instead of after, handing `noiseChannel` - the bit's only real consumer -
 * a value one tick early. Monkey-patches `Ym2151.prototype.envelopePhase6`
 * with that ordering, then asserts the noise-driving scripts from both
 * exact gates (`check:ym2151-core`'s `noise.log`, `check:ym2151-edge`'s
 * `noise-nfrq-sweep.log`) diverge against the trusted Nuked-OPM oracle while
 * patched, and both still pass unpatched (the prototype is restored between
 * runs, and a fresh `Ym2151` is constructed for every trace either way, so
 * order cannot leak state between the two).
 */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const GATES = [
  { name: 'check:ym2151-core', log: 'corpus/ym2151/core/noise.log' },
  { name: 'check:ym2151-edge', log: 'corpus/ym2151/edge/noise-nfrq-sweep.log' },
];

/** The one-tick-late `eg_serial_bit` ordering this ticket found and fixed earlier - reintroduced here on purpose, and only here. */
function buggyEnvelopePhase6() {
  if (this.cycles === 3) {
    this.eg_serial = this.eg_out[0] ^ 1023;
  } else {
    this.eg_serial <<= 1;
  }
  this.eg_serial_bit = (this.eg_serial >> 9) & 1;
  this.eg_out[1] = this.eg_out[0];
}

const original = Ym2151.prototype.envelopePhase6;
assert.equal(typeof original, 'function', 'expected Ym2151.prototype.envelopePhase6 to exist to patch');

async function runGate(gate) {
  const log = parseLog(fs.readFileSync(path.join(ROOT, gate.log), 'utf8'));
  const voices = nukedOpm.trusted.map((n) => chipYm2151.voices.indexOf(n));
  const oracle = ChangeStream.from(await nukedOpm.trace(log.writes, log.cycles, log.memory));
  const ours = ChangeStream.from(await chipYm2151.trace(log.writes, log.cycles, log.memory));
  return compare(ours, oracle, { cycles: log.cycles, voices });
}

for (const gate of GATES) {
  const clean = await runGate(gate);
  assert.equal(clean.first, null, `${gate.name}: the unpatched port must not diverge on ${gate.log}`);
}

Ym2151.prototype.envelopePhase6 = buggyEnvelopePhase6;
try {
  for (const gate of GATES) {
    const dirty = await runGate(gate);
    assert.notEqual(
      dirty.first,
      null,
      `${gate.name}: the one-tick-late eg_serial_bit bug must diverge on ${gate.log}`,
    );
  }
} finally {
  Ym2151.prototype.envelopePhase6 = original;
}

// The prototype must come back exactly as found, so no later test in the same process sees the bug.
assert.equal(Ym2151.prototype.envelopePhase6, original, 'expected envelopePhase6 to be restored');
for (const gate of GATES) {
  const restored = await runGate(gate);
  assert.equal(restored.first, null, `${gate.name}: must not diverge again once envelopePhase6 is restored`);
}

console.log('ok - ym2151-noise-tick-gate: the one-tick-late eg_serial_bit bug diverges on both noise scripts, the real port passes both');
