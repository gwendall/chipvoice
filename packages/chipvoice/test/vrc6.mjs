import {
  Vrc6Apu,
  VRC6_VOICES,
  NES_VRC6,
  NES_VRC6_VOICES,
  Vrc6NesCore,
  Vrc6NesDigital,
  Vrc6MixStage,
  VRC6_MIX_UNIT_GAIN,
  isVrc6Addr,
  nesVrc6Chip,
  getChip,
  chipFor,
  chips,
  CHIP_IDS,
} from '../dist/index.js';

/**
 * The VRC6 core against nesdev's "VRC6 audio" page, and the seam between it
 * and the plain 2A03.
 *
 * `packages/conform`'s `check:vrc6` is the register-log comparison against
 * Game_Music_Emu's oracle; this file pins the documented facts a harness
 * run alone would not show as clearly - the duty table, the worked saw
 * example, the frequency-scaling shift, halt, the enable edge - and proves
 * the combined chip's duplicated filter math (`vrc6-core.ts`'s module
 * comment explains why it is duplicated rather than shared) agrees with
 * the plain 2A03's own `NesOutputStage` when the VRC6 side is silent.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

const CLOCK = NES_VRC6.clockHz;

/** Runs a fresh `Vrc6Apu` with writes from `script(w)`, `w(addr, value, at)`. */
function run(script, cycles) {
  const chip = new Vrc6Apu();
  const writes = [];
  script((addr, value, at = 0) => writes.push({ at, addr, value }));
  chip.schedule(writes);
  const streams = [[], [], []];
  chip.trace(cycles, (cycle, voice, value) => streams[voice].push({ cycle, value }));
  return streams;
}

/**
 * Like `run`, but samples every cycle's raw voice values directly instead
 * of a sparse change stream. `trace`'s change stream drops the "off" span
 * before the first change and after the last, which biases any ratio taken
 * over the whole window; sampling every cycle here avoids that entirely, at
 * the cost of an array per voice per cycle (fine at test scale).
 */
function sample(script, cycles) {
  const chip = new Vrc6Apu();
  const writes = [];
  script((addr, value, at = 0) => writes.push({ at, addr, value }));
  chip.schedule(writes);
  const out = [0, 0, 0];
  const values = [[], [], []];
  for (let i = 0; i < cycles; i++) {
    chip.step();
    chip.outputs(out);
    values[0].push(out[0]);
    values[1].push(out[1]);
    values[2].push(out[2]);
  }
  return { chip, values };
}

/** The cycle index of every rising edge (0 -> nonzero) in a sampled series. */
function onsets(series) {
  const at = [];
  let last = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i] > 0 && last === 0) at.push(i);
    last = series[i];
  }
  return at;
}

/** Consecutive differences. */
function gapsOf(list) {
  const gaps = [];
  for (let i = 1; i < list.length; i++) gaps.push(list[i] - list[i - 1]);
  return gaps;
}

// --------------------------------------------------------------- registers

check('Vrc6Apu reports its three voices in order', VRC6_VOICES.join(',') === 'vp1,vp2,vsaw');

// -------------------------------------------------------------- pulse duty

// D 0-7 gives duty (D+1)/16, per nesdev's table; M gives 16/16 regardless
// of D. Measured by counting how many of 16 consecutive steps are "on" at
// a period long enough that one full duty cycle fits inside the trace.
for (let d = 0; d <= 7; d++) {
  const { values } = sample((w) => {
    w(0x9000, 0x0f | (d << 4)); // volume 15, duty d, mode off
    w(0x9001, 0xff); // period low
    w(0x9002, 0x80 | 0x00); // enable, period high 0 -> period 255, plenty of margin
  }, 16 * 256 * 3);
  const onCycles = values[0].filter((v) => v > 0).length;
  const measured = onCycles / values[0].length;
  const expected = (d + 1) / 16;
  check(`pulse duty D=${d} is ${d + 1}/16 of the cycle`, Math.abs(measured - expected) < 0.005, `measured ${measured.toFixed(4)}, expected ${expected.toFixed(4)}`);
}

{
  // Mode bit: constant output regardless of duty step, at the given volume -
  // exactly one rising edge (silence to volume) and no further transitions.
  const { values } = sample((w) => {
    w(0x9000, 0x80 | 0x30 | 0x0f); // mode=1, duty=3 (irrelevant), volume 15
    w(0x9001, 0x10);
    w(0x9002, 0x80);
  }, 2000);
  const changes = gapsOf([0, ...values[0]]).filter((g) => g !== 0).length;
  check('the mode bit outputs a constant volume with no duty transitions', changes === 1 && values[0].every((v) => v === 15 || v === 0));
}

// ------------------------------------------------------------- pulse period

// The change stream only shows a transition where the OUTPUT crosses the
// duty threshold, not every divider firing, so a non-zero duty confounds a
// direct firing-period measurement. Duty 0 sidesteps that: only step 0 (one
// of 16) is "on", so the 16-step super-period recurs once per rising edge,
// and dividing that gap by 16 recovers the single-firing period `t + 1`.
function pulsePeriod(t, controlByte) {
  const { values } = sample((w) => {
    w(0x9000, 0x0f); // duty 0, volume 15
    w(0x9001, t & 0xff);
    w(0x9002, 0x80 | (t >> 8));
    if (controlByte !== undefined) w(0x9003, controlByte);
  }, 16 * (t + 1) * (controlByte === 0x02 ? 16 : controlByte === 0x06 ? 256 : 1) * 3 + 100);
  const gaps = gapsOf(onsets(values[0]));
  return gaps.length > 0 && gaps.every((g) => g === gaps[0]) ? gaps[0] / 16 : NaN;
}

check('the pulse divider fires every (t + 1) cycles at t = 0', pulsePeriod(0) === 1);
check('the pulse divider fires every (t + 1) = 100 cycles at t = 99', pulsePeriod(99) === 100);

// -------------------------------------------------------- enable edge reset

{
  // Disabling forces output to 0; re-enabling resumes from step 15 (the
  // "beginning" of the 15-to-0 countdown), which for any duty < 15 is off,
  // so the very first sample after E is set again must read 0.
  const chip = new Vrc6Apu();
  chip.schedule([
    { at: 0, addr: 0x9000, value: 0x3f }, // duty 3, volume 15
    { at: 0, addr: 0x9001, value: 0x00 },
    { at: 0, addr: 0x9002, value: 0x80 }, // enabled, t = 0
  ]);
  let sawOn = false;
  chip.trace(40, (cycle, voice, value) => { if (voice === 0 && value > 0) sawOn = true; });
  check('the pulse turns on within its first duty sweep once enabled', sawOn);

  chip.schedule([{ at: 40, addr: 0x9002, value: 0x00 }]); // disable
  let disabledOutput = -1;
  chip.trace(20, (cycle, voice, value) => { if (voice === 0) disabledOutput = value; });
  check('disabling the pulse forces its output to 0', chip.pulse1.output() === 0);

  chip.schedule([{ at: 60, addr: 0x9002, value: 0x80 }]); // re-enable
  chip.step(); // land the re-enable write
  check('the sample immediately after re-enable is silent for duty < 15', chip.pulse1.output() === 0);
}

{
  // "Immediately reset and halted" for the pulse (unlike the saw's divider,
  // which nesdev says explicitly keeps running through a disable): the
  // timer must freeze along with the step, so on re-enable there is no
  // leftover countdown to immediately consume the freshly reset step=15,
  // and it stays observable for the whole first firing period.
  const chip = new Vrc6Apu();
  chip.schedule([
    { at: 0, addr: 0x9000, value: 0x0f }, // duty 0, volume 15
    { at: 0, addr: 0x9001, value: 99 & 0xff },
    { at: 0, addr: 0x9002, value: 0x80 | (99 >> 8) },
  ]);
  chip.trace(30, () => {}); // well inside the first (t + 1) = 100-cycle firing
  check('the timer is mid-count, not at a reload boundary, before disabling', chip.pulse1.timer > 0);
  chip.schedule([{ at: 30, addr: 0x9002, value: 0x00 }]); // disable
  const frozenTimer = chip.pulse1.timer;
  chip.trace(1000, () => {}); // far past where a free-running timer would have reloaded
  check('a halted timer holds the exact value it had when disabled', chip.pulse1.timer === frozenTimer);
  check('the cycle count lines up with the re-enable write below', chip.cycle === 1030);
  chip.schedule([{ at: 1030, addr: 0x9002, value: 0x80 | (99 >> 8) }]); // re-enable
  chip.step();
  check('re-enabling resets the duty step to the beginning of the countdown (15)', chip.pulse1.step === 15);
  // The re-enabling `step()` call above both lands the edge (which sets
  // step = 15) and clocks the now-enabled divider once, so the timer ticks
  // down by exactly one from where disabling left it - not back to zero,
  // which is what a free-running timer would have done many times over in
  // the 1000 cycles it was disabled for. That one-tick move is the proof
  // the timer was frozen, not running, for the whole disabled span.
  check('and the timer resumed from where disabling froze it, not from a free-running position', chip.pulse1.timer === frozenTimer - 1);
}

// -------------------------------------------------------------------- saw

{
  // Nesdev's own worked example: A = $08, output sequence 0,1,2,3,4,5,6,0,...
  const streams = run((w) => {
    w(0xb000, 0x08);
    w(0xb001, 0x00);
    w(0xb002, 0x80); // enabled, t = 0
  }, 30);
  const values = streams[2].map((e) => e.value);
  check('the A = $08 saw example reproduces nesdev\'s worked sequence 1,2,3,4,5,6,0', values.slice(0, 7).join(',') === '1,2,3,4,5,6,0', values.join(','));
}

{
  // A > 42 overflows the 8-bit accumulator before the 7th (reset) step,
  // producing a non-monotonic ramp - nesdev's "distorted sound".
  const streams = run((w) => {
    w(0xb000, 50); // > floor(255/6) = 42
    w(0xb001, 0x00);
    w(0xb002, 0x80);
  }, 30);
  const values = streams[2].map((e) => e.value).slice(0, 6);
  let monotonic = true;
  for (let i = 1; i < values.length; i++) if (values[i] < values[i - 1]) monotonic = false;
  check('a saw rate above 42 overflows into a non-monotonic ramp', !monotonic, values.join(','));
}

{
  // f = CPU / (14 * (t + 1)): full saw period (7 accumulator steps, each 2
  // divider firings of (t+1) cycles) at t = 0 is 14 cycles.
  const streams = run((w) => {
    w(0xb000, 0x08);
    w(0xb001, 0x00);
    w(0xb002, 0x80);
  }, 14 * 5);
  const resets = streams[2].filter((e) => e.value === 0);
  const gaps = [];
  for (let i = 1; i < resets.length; i++) gaps.push(resets[i].cycle - resets[i - 1].cycle);
  check('the saw completes a full period every 14 * (t + 1) cycles at t = 0', gaps.length > 1 && gaps.every((g) => g === 14), JSON.stringify(gaps));
}

{
  // "If E is clear, the accumulator is forced to zero until E is again set."
  const chip = new Vrc6Apu();
  chip.schedule([
    { at: 0, addr: 0xb000, value: 0x08 },
    { at: 0, addr: 0xb001, value: 0x00 },
    { at: 0, addr: 0xb002, value: 0x80 },
  ]);
  chip.trace(50, () => {});
  check('the saw accumulates while enabled', chip.saw.accumulator > 0);
  chip.schedule([{ at: 50, addr: 0xb002, value: 0x00 }]);
  chip.trace(20, () => {});
  check('clearing E forces the saw accumulator to zero', chip.saw.accumulator === 0 && chip.saw.output() === 0);
}

// ---------------------------------------------------------- $9003: halt

{
  const chip = new Vrc6Apu();
  chip.schedule([
    { at: 0, addr: 0x9000, value: 0x4f },
    { at: 0, addr: 0x9001, value: 0x00 },
    { at: 0, addr: 0x9002, value: 0x80 },
    { at: 0, addr: 0x9003, value: 0x01 }, // halt
  ]);
  let changed = false;
  chip.trace(200, (cycle, voice) => { if (voice === 0) changed = true; });
  check('halt stops the pulse divider from ever firing', !changed);

  chip.schedule([{ at: 200, addr: 0x9003, value: 0x00 }]); // release halt
  let resumed = false;
  chip.trace(20, (cycle, voice) => { if (voice === 0) resumed = true; });
  check('clearing halt lets the oscillator resume', resumed);
}

// ------------------------------------------------------- $9003: 16x / 256x

{
  const t = 99;
  const p16 = pulsePeriod(t, 0x02);
  check('the 16x flag rescales the period by a 4-bit right shift', p16 === (t >> 4) + 1, `measured ${p16}, expected ${(t >> 4) + 1}`);

  const p256 = pulsePeriod(t, 0x06); // both 16x and 256x set: 256x wins
  check('the 256x flag overrides 16x and rescales by an 8-bit right shift', p256 === (t >> 8) + 1, `measured ${p256}, expected ${(t >> 8) + 1}`);
}

// ------------------------------------------------------------ negative test

{
  // A cheap proof the parity gate this unlocks would bite: two Vrc6Apu
  // instances driven by the same log except one write is corrupted must
  // diverge somewhere in their traces.
  const good = () => run((w) => {
    w(0xb000, 0x08); w(0xb001, 0x00); w(0xb002, 0x80);
    w(0x9000, 0x4f); w(0x9001, 0x10); w(0x9002, 0x80);
  }, 200);
  const corrupted = () => run((w) => {
    // A rate one step away (0x09) still floors to the same output>>3
    // sequence as 0x08 for six adds under 256 - not a useful corruption -
    // so this uses a rate far enough away to diverge from the first step.
    w(0xb000, 0x30);
    w(0xb001, 0x00); w(0xb002, 0x80);
    w(0x9000, 0x4f); w(0x9001, 0x10); w(0x9002, 0x80);
  }, 200);
  const a = JSON.stringify(good());
  const b = JSON.stringify(corrupted());
  check('a corrupted saw-rate write changes the trace (the gate has something to catch)', a !== b);
}

// -------------------------------------------------- the combined chip

check('NES_VRC6 lists the 2A03\'s five voices plus the VRC6\'s three', NES_VRC6.voices.length === 8 && NES_VRC6_VOICES.length === 8);
check('the id is not in the studio\'s CHIP_IDS: no picker/arranger reach yet (decision 38)', !CHIP_IDS.includes('2a03-vrc6'));
check('the registry knows the chip', getChip('2a03-vrc6') === nesVrc6Chip && chipFor('2a03-vrc6') === nesVrc6Chip);
check('chips() includes it', chips().some((s) => s.id === '2a03-vrc6'));

check('isVrc6Addr recognises every VRC6 register and nothing outside those blocks', [0x9000, 0x9001, 0x9002, 0x9003, 0xa000, 0xa001, 0xa002, 0xb000, 0xb001, 0xb002].every(isVrc6Addr)
  && ![0x4000, 0x8fff, 0x9004, 0xa003, 0xb003, 0xc000].some(isVrc6Addr));

{
  const digital = new Vrc6NesDigital();
  const events = [];
  for (let v = 0; v < 3; v++) events.push({ at: 0, addr: 0x4015, value: 0x0f });
  events.push({ at: 0, addr: 0x4000, value: 0x3f }, { at: 0, addr: 0x4002, value: 0x00 }, { at: 0, addr: 0x4003, value: 0x80 });
  events.push({ at: 0, addr: 0xb000, value: 0x08 }, { at: 0, addr: 0xb001, value: 0x00 }, { at: 0, addr: 0xb002, value: 0x80 });
  digital.schedule(events);
  const seen = new Set();
  digital.trace(100, (cycle, voice) => seen.add(voice));
  check('the combined digital chip reports changes on both the 2A03 side (0-4) and the VRC6 side (5-7)', [...seen].some((v) => v < 5) && [...seen].some((v) => v >= 5), [...seen].sort((a, b) => a - b).join(','));
}

{
  // With the VRC6 side silent, Vrc6MixStage must agree with the plain
  // 2A03's own NesOutputStage bit for bit - the proof the duplicated
  // filter math (vrc6-core.ts) stayed faithful to dsp.ts's.
  const sampleRate = 44100;
  const stage = new Vrc6MixStage(sampleRate, [90, 440], 14000, 2.9);
  // Re-derive the reference the same way dsp.ts's NesOutputStage does, so
  // this test does not need dsp.ts's non-exported class.
  const hp1Coef = Math.exp((-2 * Math.PI * 90) / sampleRate);
  const hp2Coef = Math.exp((-2 * Math.PI * 440) / sampleRate);
  const lpCoef = 1 - Math.exp((-2 * Math.PI * 14000) / sampleRate);
  let hp1 = 0, hp2 = 0, lp = 0, lastIn1 = 0, lastIn2 = 0, primed = false;
  const referenceEnd = (sum, count, gain) => {
    let sample = count > 0 ? sum / count : 0;
    if (!primed) { primed = true; lastIn1 = sample; }
    const hp1Out = hp1Coef * (hp1 + sample - lastIn1); lastIn1 = sample; hp1 = hp1Out; sample = hp1Out;
    const hp2Out = hp2Coef * (hp2 + sample - lastIn2); lastIn2 = sample; hp2 = hp2Out; sample = hp2Out;
    lp += lpCoef * (sample - lp); sample = lp;
    return Math.max(-1, Math.min(1, sample * gain * 2.9));
  };
  const mixPulses = (p1, p2) => { const sum = p1 + p2; return sum === 0 ? 0 : 95.88 / (8128 / sum + 100); };
  const mixTnd = (tri, noi, dmc) => { const denom = tri / 8227 + noi / 12241 + dmc / 22638; return denom === 0 ? 0 : 159.79 / (1 / denom + 100); };

  let allMatch = true;
  const rng = (seed) => { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; }; };
  const next = rng(7);
  for (let sample = 0; sample < 200; sample++) {
    stage.begin();
    let sum = 0, count = 0;
    const cyclesThisSample = 1 + (next() % 40);
    for (let c = 0; c < cyclesThisSample; c++) {
      const p1 = next() % 16, p2 = next() % 16, tri = next() % 16, noi = next() % 16, dmc = next() % 128;
      stage.add(p1, p2, tri, noi, dmc, 0, 0, 0); // VRC6 side silent
      sum += mixPulses(p1, p2) + mixTnd(tri, noi, dmc);
      count++;
    }
    const got = stage.end(1);
    const want = referenceEnd(sum, count, 1);
    if (Math.abs(got - want) > 1e-12) allMatch = false;
  }
  check('Vrc6MixStage matches the plain 2A03\'s DAC and filter math exactly when the VRC6 side is silent', allMatch);
}

{
  const core = new Vrc6NesCore(44100);
  core.schedule([
    { at: 0, addr: 0x4015, value: 0x0f },
    { at: 0, addr: 0x4000, value: 0x3f },
    { at: 0, addr: 0x4002, value: 0x00 },
    { at: 0, addr: 0x4003, value: 0x40 },
    { at: 0, addr: 0xb000, value: 0x08 },
    { at: 0, addr: 0xb001, value: 0x00 },
    { at: 0, addr: 0xb002, value: 0x80 },
  ]);
  const left = new Float32Array(4410);
  core.render(left, null, 0);
  let finite = true, nonZero = false, inRange = true;
  for (const s of left) {
    if (!Number.isFinite(s)) finite = false;
    if (s !== 0) nonZero = true;
    if (s < -1 || s > 1) inRange = false;
  }
  check('Vrc6NesCore renders finite, bounded, non-silent audio with both sides driven', finite && nonZero && inRange);
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
