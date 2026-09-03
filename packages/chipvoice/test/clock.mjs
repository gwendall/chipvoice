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

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
