import { c64Chip } from '../dist/index.js';

/**
 * The C64's driver, checked write by write: what a note's first frame costs
 * and in what order, that a falling volume is one sustain write, that a
 * rising one gates again, that a waveform per frame reaches the control
 * register, that a note off keeps the waveform, where a drum's noise pitch
 * lands, that a filtered voice sets its own routing bit and sweeps the
 * cutoff frame by frame, that two voices fighting over the shared registers
 * resolve the way two writes to one byte always do, and that a per-frame
 * pulse width overrides the four fixed duties.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const CLOCK = 985248;
const V = (v) => 0xd400 + 7 * v;
const frame = (at, over = {}) => ({ at, volume: 12, freq: 440, period: 0, duty: 1, noiseMode: false, pitchOffset: 0, wave: null, fm: null, sample: null, waveform: 'pulse', filter: null, pulseWidth: null, ...over });
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

{
  const driver = c64Chip.driver();
  driver.powerOn();
  const events = driver.note('v1', [
    frame(1000, { filter: { mode: 'lowpass', resonance: 8, cutoff: 100 } }),
    frame(2000, { filter: { mode: 'lowpass', resonance: 8, cutoff: 500 } }),
    frame(3000, { filter: { mode: 'lowpass', resonance: 8, cutoff: 1000 } }),
  ]);
  const routing = events.find((e) => e.addr === 0xd417);
  const mode = events.find((e) => e.addr === 0xd418);
  const cutoffLow = events.filter((e) => e.addr === 0xd415);
  const cutoffHigh = events.filter((e) => e.addr === 0xd416);
  check('a filtered lead sets its own routing bit and the resonance, the volume bits kept',
    routing?.value === 0x81 && mode?.value === 0x1f, `${routing?.value.toString(16)} ${mode?.value.toString(16)}`);
  check('the cutoff sweeps frame by frame, low and high bytes both moving',
    cutoffLow.length === 2 && cutoffHigh.length === 3 && cutoffHigh[2].value === 1000 >> 3,
    cutoffHigh.map((e) => e.value).join(','));
}

{
  const driver = c64Chip.driver();
  driver.powerOn();
  const v1 = driver.note('v1', [frame(0, { filter: { mode: 'lowpass', resonance: 8, cutoff: 300 } })]);
  const v2 = driver.note('v2', [frame(100, { filter: { mode: 'lowpass', resonance: 15, cutoff: 480 } })]);
  const v1Routing = v1.find((e) => e.addr === 0xd417).value;
  const v2Routing = v2.find((e) => e.addr === 0xd417).value;
  check('one voice claims the filter: its own bit set, its resonance written', v1Routing === 0x81, v1Routing.toString(16));
  check('a second voice asking for the filter at once wins the shared registers but does not clear the first voice\'s bit',
    v2Routing === 0xf3, v2Routing.toString(16));
  const v1Released = driver.note('v1', [frame(200, { filter: null })]);
  const releasedRouting = v1Released.find((e) => e.addr === 0xd417)?.value;
  check('a voice that stops asking for the filter clears its own bit and leaves the shared registers otherwise alone',
    releasedRouting === 0xf2, releasedRouting?.toString(16));
}

{
  const driver = c64Chip.driver();
  const events = driver.note('v1', [frame(0, { duty: 1, pulseWidth: 200 }), frame(100, { duty: 1, pulseWidth: 3000 })]);
  const pwLow = events.filter((e) => e.addr === V(0) + 2);
  const pwHigh = events.filter((e) => e.addr === V(0) + 3);
  check('a pulse-width sweep overrides duty\'s four fixed steps with the raw register, frame by frame',
    pwLow.length === 2 && pwLow[0].value === 200 && pwLow[1].value === (3000 & 0xff) && pwHigh[1].value === 3000 >> 8,
    `${pwLow.map((e) => e.value).join(',')} / ${pwHigh.map((e) => e.value).join(',')}`);
}

{
  const driver = c64Chip.driver();
  const noFilter = driver.note('v1', [frame(0)]);
  check('a note with no filter touches neither the routing nor the mode register',
    !noFilter.some((e) => e.addr === 0xd417 || e.addr === 0xd418));
  const noteOff = driver.noteOff('v1', 500);
  check('a note off never touches the filter, only the gate', noteOff.length === 1 && noteOff[0].addr === V(0) + 4);
}

{
  // The bug PR #94's review found: `note()` gets a whole note at once, and
  // notes are dispatched in the order they start (as `performance.ts` and
  // the live APU path both do), not the order their writes land in time. A
  // long sweep dispatched first can finish writing every frame of itself
  // before a shorter, later-starting note that genuinely overlaps it is even
  // dispatched - so a naive dedup against "the last value this instance
  // wrote" compares a note's first frame against the wrong moment. Here the
  // lead's ten-frame sweep (cutoff 60 to 2047) is dispatched first, in full;
  // then a first bass note claims cutoff 480; then a second bass note, at
  // the sweep's midpoint, asks for that same 480 again - the exact value the
  // dedup's own state already holds, purely because the bass wrote it
  // itself last, not because it is still true. The time-ordered stream must
  // still carry the second bass note's own write.
  const driver = c64Chip.driver();
  driver.powerOn();
  const sweep = { mode: 'lowpass', resonance: 8 };
  const resonant = { mode: 'lowpass', resonance: 15, cutoff: 480 };
  const leadFrames = Array.from({ length: 10 }, (_, i) => frame(i * 1000, {
    filter: { ...sweep, cutoff: Math.round(60 + (2047 - 60) * (i / 9)) },
  }));
  // Dispatch order matches what `performance.ts` (and the live APU path)
  // actually does: by ascending note-start tick, not by when a write lands.
  // The lead's note starts at tick 0 and runs the whole span, so it is
  // dispatched, in full, before the bass's second note even though that
  // note's own ticks fall well inside the lead's still-sounding span.
  const lead = driver.note('v1', leadFrames);
  const bass1 = driver.note('v2', [frame(0, { filter: resonant })]);
  const bass2 = driver.note('v2', [frame(5500, { filter: resonant })]);

  const stream = [...lead, ...bass1, ...bass2].sort((a, b) => a.at - b.at);
  const bassStart = bass2[0].at; // v2's stagger already applied
  const bassEnd = Math.max(...bass2.map((e) => e.at)); // bass2's own writes span several cycles, the filter registers last
  check('the second bass note writes its own cutoff, not nothing',
    stream.some((e) => e.at >= bassStart && (e.addr === 0xd415 || e.addr === 0xd416)),
    JSON.stringify(stream.filter((e) => e.at >= bassStart)));

  let cutoffLow = 0, cutoffHigh = 0, routing = 0;
  for (const e of stream) {
    if (e.at > bassEnd) break;
    if (e.addr === 0xd415) cutoffLow = e.value;
    else if (e.addr === 0xd416) cutoffHigh = e.value;
    else if (e.addr === 0xd417) routing = e.value;
  }
  check('by the second bass note\'s own write, the time-ordered cutoff reads back as 480, not the sweep\'s mid-point',
    (cutoffLow | (cutoffHigh << 3)) === 480,
    `${cutoffLow | (cutoffHigh << 3)}`);
  check('$D417 at that moment routes both voices, the ones actually sounding',
    (routing & 0x03) === 0x03, routing.toString(16));
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
