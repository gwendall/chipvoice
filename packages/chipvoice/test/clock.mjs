import { nesChip } from '../dist/index.js';

/**
 * The clocks, against the formulas.
 *
 * Each voice's rate follows from the CPU clock and its period register, and
 * those formulas are the best-documented facts about the chip. This drives
 * the core for one second of CPU cycles and counts what each timer did.
 *
 * It exists because the noise channel ran at half speed for a version: the
 * period table is in CPU cycles and the timer was decremented at the APU
 * rate, so every drum was an octave darker than the hardware, and nothing
 * anywhere said so. A formula is the cheapest oracle there is, and this is
 * the one test that would have caught it.
 */
const CPU_HZ = 1789773;

let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance * b;

/** Counts the times a unit's timer fired, by watching it hit zero. */
function countFires(unit) {
  const counter = { fires: 0 };
  const original = unit.clock.bind(unit);
  unit.clock = () => {
    if (unit.timer === 0) counter.fires++;
    original();
  };
  return counter;
}

function fresh() {
  return nesChip.create(44100);
}

// ---- the voices, one second each, against f = CPU / (16 (t + 1)) and friends

{
  const core = fresh();
  core.applyEvent({ ch: 'p1', period: 253, duty: 2, volume: 15, constant: true, length: 31, loop: true, trigger: true });
  core.applyEvent({ ch: 'tri', period: 253, linear: 127, length: 31, loop: true, trigger: true });
  core.applyEvent({ ch: 'noi', periodIndex: 15, mode: false, volume: 15, constant: true, length: 31, loop: true, trigger: true });
  const pulse = countFires(core.pulse1);
  const triangle = countFires(core.triangle);
  const noise = countFires(core.noise);
  for (let i = 0; i < CPU_HZ; i++) core.clockCPU();

  const pulseHz = pulse.fires / 8;
  const pulseWant = CPU_HZ / (16 * 254);
  check('pulse at t=253 runs at CPU / (16 (t + 1))', near(pulseHz, pulseWant, 0.005), `${pulseHz.toFixed(1)} Hz, want ${pulseWant.toFixed(1)}`);

  const triHz = triangle.fires / 32;
  const triWant = CPU_HZ / (32 * 254);
  check('triangle at t=253 runs at CPU / (32 (t + 1))', near(triHz, triWant, 0.005), `${triHz.toFixed(1)} Hz, want ${triWant.toFixed(1)}`);

  const noiseWant = CPU_HZ / 4068;
  check('noise at rate 15 shifts 440 times a second', near(noise.fires, noiseWant, 0.005), `${noise.fires} shifts, want ${noiseWant.toFixed(1)}`);
}

{
  const core = fresh();
  core.applyEvent({ ch: 'noi', periodIndex: 0, mode: false, volume: 15, constant: true, length: 31, loop: true, trigger: true });
  const noise = countFires(core.noise);
  for (let i = 0; i < CPU_HZ; i++) core.clockCPU();
  const want = CPU_HZ / 4;
  check('noise at rate 0 shifts every four CPU cycles', near(noise.fires, want, 0.005), `${noise.fires} shifts, want ${want.toFixed(0)}`);
}

// ---- the shift register itself: the taps decide the sequence length

function sequenceLength(mode) {
  const core = fresh();
  core.applyEvent({ ch: 'noi', periodIndex: 0, mode, volume: 15, constant: true, length: 31, loop: true, trigger: true });
  const start = core.noise.shift;
  // Rate 0 is two APU cycles a shift, so a shift every four CPU cycles.
  for (let shifts = 1; shifts <= 40000; shifts++) {
    for (let i = 0; i < 4; i++) core.clockCPU();
    if (core.noise.shift === start) return shifts;
  }
  return -1;
}

check('the long noise sequence is 32767 steps', sequenceLength(false) === 32767, `${sequenceLength(false)}`);
{
  const short = sequenceLength(true);
  // 93 or 31, depending on where the register starts: both are hardware.
  check('the short noise sequence is 93 or 31 steps', short === 93 || short === 31, `${short}`);
}

// ---- the frame counter: 240 Hz quarter frames, 120 Hz half frames, in phase

{
  const core = fresh();
  const quarters = [];
  const halves = [];
  let cycle = 0;
  const q = core.clockQuarterFrame.bind(core);
  const h = core.clockHalfFrame.bind(core);
  core.clockQuarterFrame = () => { quarters.push(cycle); q(); };
  core.clockHalfFrame = () => { halves.push(cycle); h(); };
  for (cycle = 1; cycle <= CPU_HZ; cycle++) core.clockCPU();

  // One percent: a second is 59.999 sequences, so the last one is cut short.
  check('quarter frames run at 240 Hz', near(quarters.length, 240, 0.01), `${quarters.length} a second`);
  check('half frames run at 120 Hz', near(halves.length, 120, 0.01), `${halves.length} a second`);
  // The sequence from nesdev, in CPU cycles: 7457, 14913, 22371, 29829.
  check('the first sequence lands on 7457, 14913, 22371, 29829', quarters.slice(0, 4).join() === '7457,14913,22371,29829', quarters.slice(0, 4).join());
  check('half frames fall on the second and fourth steps', halves.slice(0, 2).join() === '14913,29829', halves.slice(0, 2).join());
}

// ---- the event clock: a write lands on the cycle it names, at any position

{
  const core = fresh();
  const landed = [];
  const apply = core.applyEvent.bind(core);
  core.applyEvent = (ev) => { landed.push(core.cycle); apply(ev); };
  core.schedule([
    { at: 1000, ch: 'p1', period: 100 },
    { at: 123456, ch: 'p1', period: 200 },
  ]);
  core.render(new Float32Array(4096), null, 0);
  check('a write lands on the cycle it names', landed.join() === '1000,123456', landed.join());
}

{
  // A worklet that comes up mid-context renders from wherever the context is.
  // One second of samples has to be exactly one second of cycles, not a
  // float's idea of it, or a write stamped for that second lands a cycle off.
  const core = fresh();
  const landed = [];
  const apply = core.applyEvent.bind(core);
  core.applyEvent = (ev) => { landed.push(core.cycle); apply(ev); };
  core.schedule([{ at: CPU_HZ, ch: 'p1', period: 100 }]);
  core.render(new Float32Array(128), null, 44100);
  check('rendering from sample 44100 starts at cycle 1789773', landed.join() === String(CPU_HZ), landed.join());
}

{
  // The same event stream, rendered at two rates, applies its writes on the
  // same cycles: the stream does not know the sample rate, and nor should it.
  const landedAt = (rate) => {
    const core = nesChip.create(rate);
    const landed = [];
    const apply = core.applyEvent.bind(core);
    core.applyEvent = (ev) => { landed.push(core.cycle); apply(ev); };
    core.schedule([{ at: 29831, ch: 'noi', periodIndex: 3 }, { at: 700001, ch: 'tri', period: 50 }]);
    core.render(new Float32Array(Math.ceil(rate * 0.5)), null, 0);
    return landed.join();
  };
  const a = landedAt(44100);
  const b = landedAt(48000);
  check('the same cycles at 44100 and 48000', a === b && a === '29831,700001', `${a} vs ${b}`);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
