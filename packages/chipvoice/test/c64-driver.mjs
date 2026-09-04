import { c64Chip } from '../dist/index.js';

/**
 * The C64's driver, checked write by write: what a note's first frame costs
 * and in what order, that a falling volume is one sustain write, that a
 * rising one gates again, that a waveform per frame reaches the control
 * register, that a note off keeps the waveform, and where a drum's noise
 * pitch lands.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const CLOCK = 985248;
const V = (v) => 0xd400 + 7 * v;
const frame = (at, over = {}) => ({ at, volume: 12, freq: 440, period: 0, duty: 1, noiseMode: false, pitchOffset: 0, wave: null, fm: null, sample: null, waveform: 'pulse', ...over });
const F = (hz) => Math.round((hz * 16777216) / CLOCK);

{
  const driver = c64Chip.driver();
  const events = driver.note('v1', [frame(1000)]);
  const regs = events.map((e) => e.addr - V(0));
  const f = F(440);
  check('a note\'s first frame writes the seven registers, the control last', regs.join(',') === '0,1,2,3,5,6,4', regs.join(','));
  check('the frequency, the pulse width for a 25 % duty, the fastest attack and decay, the volume as sustain, the pulse gated',
    events[0].value === (f & 0xff) && events[1].value === f >> 8 && events[2].value === 0x00 && events[3].value === 0x0c && events[4].value === 0x00 && events[5].value === 0xc1 && events[6].value === 0x41,
    events.map((e) => e.value.toString(16)).join(' '));
  check('writes are four cycles apart', events.every((e, i) => i === 0 || e.at - events[i - 1].at === 4));
}

{
  const driver = c64Chip.driver();
  const events = driver.note('v2', [frame(1000), frame(2000, { volume: 9 }), frame(3000, { volume: 9 }), frame(4000, { volume: 14 })]);
  const at = (t) => events.filter((e) => e.at >= t && e.at < t + 100);
  const falling = at(2000);
  const held = at(3000);
  const rising = at(4000);
  check('a falling volume is one sustain write', falling.length === 1 && falling[0].addr === V(1) + 6 && falling[0].value === 0x91, falling.map((e) => `${(e.addr - V(1))}=${e.value.toString(16)}`).join(' '));
  check('a held frame writes nothing', held.length === 0);
  check('a rising volume writes the sustain, then gates the voice off and on', rising.length === 3 && rising[0].value === 0xe1 && rising[1].addr === V(1) + 4 && rising[1].value === 0x40 && rising[2].value === 0x41, rising.map((e) => e.value.toString(16)).join(' '));
  check('voice 2\'s writes are staggered after voice 1\'s', events[0].at === 1000 + 48);
}

{
  const driver = c64Chip.driver();
  const events = driver.note('v3', [frame(1000, { waveform: 'pulse', freq: 1568, duty: 2, volume: 15 }), frame(2000, { waveform: 'noise', freq: 1568, volume: 12 })]);
  const second = events.filter((e) => e.at >= 2000);
  check('a waveform per frame: the snare\'s pulse becomes noise with the gate kept', second.some((e) => e.addr === V(2) + 4 && e.value === 0x81) && !second.some((e) => e.addr === V(2) + 4 && e.value === 0x80));
  const off = driver.noteOff('v3', 5000);
  check('a note off is the gate alone, the waveform kept', off.length === 1 && off[0].addr === V(2) + 4 && off[0].value === 0x80 && off[0].at === 5000 + 96);
  check('the noise pitch: the register for 1568 Hz clocks the noise at 25 kHz', Math.abs((F(1568) * CLOCK) / 1048576 - 25088) < 50, `${((F(1568) * CLOCK) / 1048576).toFixed(0)} Hz`);
}

{
  const driver = c64Chip.driver();
  const on = driver.powerOn();
  check('power-on: the volume full, nothing filtered, the cutoff at zero', on.length === 4 && on[0].addr === 0xd418 && on[0].value === 0x0f && on[1].addr === 0xd417 && on[1].value === 0);
  const tri = driver.note('v1', [frame(0, { waveform: 'triangle' })]);
  const saw = driver.note('v1', [frame(0, { waveform: 'sawtooth' })]);
  check('the triangle and the sawtooth reach the control register', tri.at(-1).value === 0x11 && saw.at(-1).value === 0x21);
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
