import { nesChip } from '../dist/index.js';

/**
 * The clocks, against the formulas, and the registers, against nesdev.
 *
 * Each voice's rate follows from the CPU clock and its period register, and
 * those formulas are the best-documented facts about the chip. This drives
 * the core through its register port - byte writes to $4000-$4017, the way a
 * program would - for one second of CPU cycles and counts what each timer did.
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

/** A powered-on chip: every voice enabled, the way a program's first write left it. */
function fresh() {
  const chip = nesChip.digital();
  chip.write(0x4015, 0x0f);
  return chip;
}

/** A powered-on core, for the tests that render samples. */
function freshCore(rate = 44100) {
  const core = nesChip.create(rate);
  core.chip.write(0x4015, 0x0f);
  return core;
}

const CYCLES_PER_SECOND = CPU_HZ;

// ---- the voices, one second each, against f = CPU / (16 (t + 1)) and friends

{
  const core = fresh();
  // Pulse 1: duty 2, halted, constant volume 15, sweep off with negate set,
  // period 253, length 31.
  core.write(0x4000, 0xbf);
  core.write(0x4001, 0x08);
  core.write(0x4002, 0xfd);
  core.write(0x4003, 0xf8);
  // Triangle: control flag, linear 127, period 253.
  core.write(0x4008, 0xff);
  core.write(0x400a, 0xfd);
  core.write(0x400b, 0xf8);
  // Noise: halted, constant 15, long mode, rate 15.
  core.write(0x400c, 0x3f);
  core.write(0x400e, 0x0f);
  core.write(0x400f, 0xf8);
  const pulse = countFires(core.pulse1);
  const triangle = countFires(core.triangle);
  const noise = countFires(core.noise);
  for (let i = 0; i < CYCLES_PER_SECOND; i++) core.clockCPU();

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
  core.write(0x400c, 0x3f);
  core.write(0x400e, 0x00);
  core.write(0x400f, 0xf8);
  const noise = countFires(core.noise);
  for (let i = 0; i < CYCLES_PER_SECOND; i++) core.clockCPU();
  const want = CPU_HZ / 4;
  check('noise at rate 0 shifts every four CPU cycles', near(noise.fires, want, 0.005), `${noise.fires} shifts, want ${want.toFixed(0)}`);
}

// ---- the shift register itself: the taps decide the sequence length

function sequenceLength(mode) {
  const core = fresh();
  core.write(0x400c, 0x3f);
  core.write(0x400e, mode ? 0x80 : 0x00);
  core.write(0x400f, 0xf8);
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

function frameClocks(core, cycles) {
  const quarters = [];
  const halves = [];
  let cycle = 0;
  const q = core.clockQuarterFrame.bind(core);
  const h = core.clockHalfFrame.bind(core);
  core.clockQuarterFrame = () => { quarters.push(cycle); q(); };
  core.clockHalfFrame = () => { halves.push(cycle); h(); };
  for (cycle = 1; cycle <= cycles; cycle++) core.clockCPU();
  return { quarters, halves };
}

{
  const { quarters, halves } = frameClocks(fresh(), CYCLES_PER_SECOND);
  // One percent: a second is 59.999 sequences, so the last one is cut short.
  check('quarter frames run at 240 Hz', near(quarters.length, 240, 0.01), `${quarters.length} a second`);
  check('half frames run at 120 Hz', near(halves.length, 120, 0.01), `${halves.length} a second`);
  // The sequence from nesdev, in CPU cycles: 7457, 14913, 22371, 29829.
  check('the first sequence lands on 7457, 14913, 22371, 29829', quarters.slice(0, 4).join() === '7457,14913,22371,29829', quarters.slice(0, 4).join());
  check('half frames fall on the second and fourth steps', halves.slice(0, 2).join() === '14913,29829', halves.slice(0, 2).join());
}

{
  // $4017 with bit 7: the 5-step sequence, clocked once as the reset lands
  // 3 or 4 cycles after the write, then 7457, 14913, 22371, 37281, over 37282.
  const core = fresh();
  core.write(0x4017, 0x80);
  const { quarters, halves } = frameClocks(core, 37282 + 4 + 7457);
  const reset = quarters[0];
  check('a $4017 write with bit 7 clocks the sequencer 3 or 4 cycles later', reset === 3 || reset === 4, `at cycle ${reset}`);
  const relative = quarters.slice(1, 6).map((c) => c - reset).join();
  check('the 5-step sequence lands on 7457, 14913, 22371, 37281, then 7457 again', relative === '7457,14913,22371,37281,44739', relative);
  const halfRelative = halves.slice(0, 3).map((c) => c - reset).join();
  check('its half frames are the reset, 14913 and 37281', halfRelative === '0,14913,37281', halfRelative);
}

// ---- the registers, against nesdev

{
  // $4003 restarts the duty sequence and loads the length counter, but only
  // while $4015 has the voice enabled; disabled, the counter is forced to 0.
  const core = fresh();
  core.write(0x4000, 0xbf);
  core.write(0x4002, 0xfd);
  core.write(0x4003, 0xf8);
  for (let i = 0; i < 1000; i++) core.clockCPU();
  const stepBefore = core.pulse1.step;
  core.write(0x4003, 0x08 | 0);
  check('$4003 restarts the pulse sequencer at step 0', stepBefore !== 0 && core.pulse1.step === 0, `was ${stepBefore}`);
  // The load lands when the cycle settles, after the frame counter has had
  // its say: blargg's len_reload_timing.
  core.clockCPU();
  check('and loads the length counter by the end of the cycle', core.pulse1.lengthCounter === 254, `${core.pulse1.lengthCounter}`);
  core.write(0x4015, 0x0e);
  check('clearing its $4015 bit forces the length counter to 0', core.pulse1.lengthCounter === 0, `${core.pulse1.lengthCounter}`);
  core.write(0x4003, 0xf8);
  core.clockCPU();
  check('and a load while disabled is ignored', core.pulse1.lengthCounter === 0, `${core.pulse1.lengthCounter}`);
}

{
  // The sweep's mute: with negate clear and no shift, the target period is
  // twice the period, and anything at $400 or above is silent. Writing $08
  // to $4001 is what every driver on the hardware did about it.
  const sounding = (sweep) => {
    const core = fresh();
    core.write(0x4000, 0xbf);
    core.write(0x4001, sweep);
    core.write(0x4002, 0x00);
    core.write(0x4003, 0xf8 | 0x04); // period $400
    let heard = false;
    for (let i = 0; i < 40000; i++) {
      core.clockCPU();
      if (core.pulse1.output() > 0) { heard = true; break; }
    }
    return heard;
  };
  check('a pulse at period $400 is muted with $4001 = $00', sounding(0x00) === false);
  check('and sounds with $4001 = $08', sounding(0x08) === true);
}

// ---- the DMC: a level nudged by bits from memory, at the rate table's pace

{
  // Seventeen bytes of ones at $C000, looping at rate 15 - 54 cycles a bit -
  // raise the level by 2 a bit from 0 to 126, where it stops: 63 bits, 3402
  // cycles. Rate 0 is 428 cycles a bit.
  const chip = fresh();
  chip.load(0xc000, new Uint8Array(17).fill(0xff));
  chip.write(0x4010, 0x4f);
  chip.write(0x4012, 0x00);
  chip.write(0x4013, 0x01);
  chip.write(0x4015, 0x1f);
  const changes = [];
  chip.trace(5000, (cycle, voice, value) => { if (voice === 4) changes.push([cycle, value]); });
  check('the DMC raises its level by 2 a bit', changes.length >= 63 && changes[0][1] === 2 && changes[62][1] === 126, `${changes.length} changes, first ${JSON.stringify(changes[0])}`);
  check('at rate 15, 54 cycles a bit', changes.length > 2 && changes[2][0] - changes[1][0] === 54, `${changes[2]?.[0] - changes[1]?.[0]}`);
  check('and stops at 126', changes.every((c) => c[1] <= 126) && changes[changes.length - 1][1] === 126);
}

{
  // Zeros lower it; $4011 sets it outright; clearing the $4015 bit lets the
  // byte in the shift register play out and then holds the level.
  const chip = fresh();
  chip.load(0xc000, new Uint8Array(17).fill(0x00));
  chip.write(0x4011, 0x40);
  chip.write(0x4010, 0x40);
  chip.write(0x4012, 0x00);
  chip.write(0x4013, 0x01);
  chip.write(0x4015, 0x1f);
  // The output unit starts silent and its first eight-bit cycle has to run
  // out before the buffer is taken, so the first byte plays after eight bit
  // periods: 3424 cycles at rate 0.
  const levels = [];
  chip.trace(428 * 20, (cycle, voice, value) => { if (voice === 4) levels.push([cycle, value]); });
  check('$4011 sets the level at once', levels[0][0] === 0 && levels[0][1] === 64, `${JSON.stringify(levels[0])}`);
  check('and zeros lower it by 2 a bit at 428 cycles, from the ninth bit period on', levels[1][0] === 8 * 428 && levels[1][1] === 62 && levels[2][0] - levels[1][0] === 428 && levels.length >= 11, `${JSON.stringify(levels.slice(1, 3))}, ${levels.length} changes`);
  // Clearing the bit drops what is left to read; the byte in the shift
  // register and the one already buffered play out, up to sixteen bits, and
  // then the level holds.
  chip.write(0x4015, 0x0f);
  const before = chip.dmc.level;
  const after = [];
  chip.trace(428 * 24, (cycle, voice, value) => { if (voice === 4) after.push(value); });
  check('clearing the $4015 bit plays out at most the two bytes in hand, then holds', after.length <= 16 && after.length > 0 && chip.dmc.level === before - 2 * after.length, `${after.length} more steps`);
}

// ---- the event clock: a write lands on the cycle it names, at any position

{
  const core = freshCore();
  const landed = [];
  const apply = core.chip.applyEvent.bind(core.chip);
  core.chip.applyEvent = (ev) => { landed.push(core.chip.cycle); apply(ev); };
  core.schedule([
    { at: 1000, addr: 0x4002, value: 100 },
    { at: 123456, addr: 0x4002, value: 200 },
  ]);
  core.render(new Float32Array(4096), null, 0);
  check('a write lands on the cycle it names', landed.join() === '1000,123456', landed.join());
}

{
  // A worklet that comes up mid-context renders from wherever the context is.
  // One second of samples has to be exactly one second of cycles, not a
  // float's idea of it, or a write stamped for that second lands a cycle off.
  const core = freshCore();
  const landed = [];
  const apply = core.chip.applyEvent.bind(core.chip);
  core.chip.applyEvent = (ev) => { landed.push(core.chip.cycle); apply(ev); };
  core.schedule([{ at: CPU_HZ, addr: 0x4002, value: 100 }]);
  core.render(new Float32Array(128), null, 44100);
  check('rendering from sample 44100 starts at cycle 1789773', landed.join() === String(CPU_HZ), landed.join());
}

{
  // The same event stream, rendered at two rates, applies its writes on the
  // same cycles: the stream does not know the sample rate, and nor should it.
  const landedAt = (rate) => {
    const core = freshCore(rate);
    const landed = [];
    const apply = core.chip.applyEvent.bind(core.chip);
    core.chip.applyEvent = (ev) => { landed.push(core.chip.cycle); apply(ev); };
    core.schedule([{ at: 29831, addr: 0x400e, value: 3 }, { at: 700001, addr: 0x400a, value: 50 }]);
    core.render(new Float32Array(Math.ceil(rate * 0.5)), null, 0);
    return landed.join();
  };
  const a = landedAt(44100);
  const b = landedAt(48000);
  check('the same cycles at 44100 and 48000', a === b && a === '29831,700001', `${a} vs ${b}`);
}

// ---- the trace: the change stream parity is measured on

{
  // Pulse 1 at period 253, duty 2: step 0 of the sequence is 0 and step 1 is
  // 1. A fresh timer is 0, so the first APU clock reloads it and steps at
  // once - the edge to 15 is on cycle 0 - and the sequence then runs at 2 (t
  // + 1) = 508 CPU cycles a step, so the edge back to 0 is four steps later.
  const chip = nesChip.digital();
  chip.schedule([
    { at: 0, addr: 0x4015, value: 0x0f },
    { at: 0, addr: 0x4000, value: 0xbf },
    { at: 0, addr: 0x4001, value: 0x08 },
    { at: 0, addr: 0x4002, value: 0xfd },
    { at: 0, addr: 0x4003, value: 0xf8 },
  ]);
  const changes = [];
  chip.trace(6000, (cycle, voice, value) => changes.push([cycle, voice, value]));
  const first = changes[0];
  const second = changes[1];
  check('the trace reports the first pulse edge on the first clock', first && first[1] === 0 && first[2] === 15 && first[0] === 0, JSON.stringify(first));
  check('and the next edge four steps later', second && second[2] === 0 && second[0] - first[0] === 4 * 508, JSON.stringify(second));
  check('and nothing on the silent voices', changes.every((c) => c[1] === 0), `${changes.length} changes`);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
