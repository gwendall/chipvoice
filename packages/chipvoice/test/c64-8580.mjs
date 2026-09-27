import { c64Chip, SID_6581_PROFILE, SID_8580_PROFILE, ladderWeights } from '../dist/index.js';

/**
 * The 8580 profile and model, against the same plain facts `c64.mjs` checks
 * for the 6581: this is not a second parity harness (the conformance suite
 * traces the 8580 against reSID-fp for that), just that the public surface
 * for choosing it works and that it actually differs from the default in
 * the ways the sheet documents.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const V = (v) => 0xd400 + 7 * v;
const CLOCK = 985248;
const F = (hz) => Math.round((hz * 16777216) / CLOCK);

/** A chip of the given model, with writes four cycles apart from `start`, traced for `cycles`. */
function run(model, script, cycles) {
  const chip = c64Chip.digital({ model });
  const writes = [];
  let t = 100;
  const w = (addr, value) => { writes.push({ at: t, addr, value }); t += 4; };
  const at = (time) => { t = time; };
  script(w, at);
  chip.schedule(writes);
  const streams = [[], [], [], [], [], []];
  chip.trace(cycles, (cycle, voice, value) => streams[voice].push({ cycle, value }));
  return streams;
}

{
  check('digital() defaults to the 6581', c64Chip.digital().model === '6581');
  check('digital({ model: "8580" }) is the 8580', c64Chip.digital({ model: '8580' }).model === '8580');
  check('an unknown model falls back to the 6581', c64Chip.digital({ model: 'nope' }).model === '6581');
}

{
  check('the profiles say which model they go with', SID_6581_PROFILE.model === '6581' && SID_8580_PROFILE.model === '8580');
  check("the 8580's ladder is terminated with a 2R/R of 2.0, unlike the 6581's", SID_8580_PROFILE.ladderRatio === 2.0 && SID_8580_PROFILE.ladderTerminated === true && SID_6581_PROFILE.ladderTerminated === false);
  const ideal = ladderWeights(12, 2, true);
  const eighty580 = ladderWeights(12, SID_8580_PROFILE.ladderRatio, SID_8580_PROFILE.ladderTerminated);
  const linear = [...eighty580].every((w, i) => Math.abs(w - ideal[i]) < 1e-9);
  check("the 8580's ladder weights are exactly powers of two: a terminated 2R/R of 2.0 is a perfect ladder", linear);
}

{
  // Both curves are documented linear-ish rises from a few Hz to several
  // kHz, but they are not the same curve, and the 8580's is the plain,
  // exactly linear one `filter.cc` gives for it.
  check("the 8580's cutoff is a different curve from the 6581's", JSON.stringify(SID_6581_PROFILE.cutoff) !== JSON.stringify(SID_8580_PROFILE.cutoff));
  const [, lo8580] = SID_8580_PROFILE.cutoff[0];
  const [, hi8580] = SID_8580_PROFILE.cutoff.at(-1);
  check("the 8580's cutoff is documented as roughly 0-12.5kHz, linear in the register", Math.abs(hi8580 - 12500) < 1 && lo8580 < 10, `${lo8580} to ${hi8580} Hz`);
}

{
  const f = F(440);
  const combo6581 = run('6581', (w) => { w(V(0) + 6, 0xf0); w(V(0), f & 0xff); w(V(0) + 1, f >> 8); w(V(0) + 4, 0x71); }, 20000)[0];
  const combo8580 = run('8580', (w) => { w(V(0) + 6, 0xf0); w(V(0), f & 0xff); w(V(0) + 1, f >> 8); w(V(0) + 4, 0x71); }, 20000)[0];
  const differs = combo6581.length !== combo8580.length || combo6581.some((c, i) => c.value !== combo8580[i]?.value);
  check('pulse+sawtooth+triangle sounds different on the two models (the combined-waveform fit)', differs);
}

{
  // With no waveform selected, the output floats and then settles to zero;
  // the 8580 holds it roughly ten times longer than the 6581
  // (FLOATING_OUTPUT_TTL_6581R3 vs _8580R5 in reSID-fp's WaveformGenerator).
  const settleAt = (model, span) => {
    const chip = c64Chip.digital({ model });
    chip.schedule([
      { at: 100, addr: V(0) + 6, value: 0xf0 }, { at: 100, addr: V(0), value: 0x00 }, { at: 100, addr: V(0) + 1, value: 0x10 },
      { at: 100, addr: V(0) + 4, value: 0x11 },
      { at: 20000, addr: V(0) + 4, value: 0x01 },
    ]);
    const changes = [];
    chip.trace(span, (cycle, voice, value) => { if (voice === 0) changes.push({ cycle, value }); });
    return changes.at(-1);
  };
  const settle6581 = settleAt('6581', 200000);
  const settle8580 = settleAt('8580', 1100000);
  check('the floating waveform output settles to zero on both models', settle6581?.value === 0 && settle8580?.value === 0);
  check(
    'the 8580 holds a floating waveform output roughly ten times longer than the 6581',
    Boolean(settle6581) && Boolean(settle8580) && settle8580.cycle - 20000 > (settle6581.cycle - 20000) * 5,
    settle6581 && settle8580 ? `${settle6581.cycle - 20000} vs ${settle8580.cycle - 20000} cycles` : 'never settled',
  );
}

{
  // OSC3 (the register, `$D41B`) is only ever voice 3's; a sawtooth on it
  // lags the DAC's waveform output by one cycle on the 8580, and does not
  // on the 6581 (WaveformGenerator.h's tri_saw_pipeline).
  const f = F(220);
  const traceOsc3 = (model, cycles) => {
    const chip = c64Chip.digital({ model });
    chip.schedule([
      { at: 0, addr: V(2) + 6, value: 0xf0 }, { at: 0, addr: V(2), value: f & 0xff }, { at: 0, addr: V(2) + 1, value: f >> 8 },
      { at: 0, addr: V(2) + 4, value: 0x21 },
    ]);
    const osc3 = [];
    const output = [];
    for (let i = 0; i < cycles; i++) {
      chip.step();
      osc3.push(chip.read(0xd41b) << 4);
      output.push(chip.osc[2].output & 0xff0);
    }
    return { osc3, output };
  };
  const t6581 = traceOsc3('6581', 2000);
  const t8580 = traceOsc3('8580', 2000);
  const sameCycle6581 = t6581.osc3.every((v, i) => v === t6581.output[i]);
  const mismatches8580 = t8580.osc3.filter((v, i) => v !== t8580.output[i]).length;
  const laggedMatches8580 = t8580.osc3.slice(1).every((v, i) => v === t8580.output[i]);
  check('OSC3 equals the waveform output every cycle on the 6581 for a sawtooth', sameCycle6581);
  check('OSC3 lags the waveform output by one cycle on the 8580 for a sawtooth', mismatches8580 > 0 && laggedMatches8580, `${mismatches8580} same-cycle mismatches over ${t8580.osc3.length} cycles`);
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
