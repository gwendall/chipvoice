import { OfflineDriver, nesChip } from '../dist/index.js';

/**
 * The driver, as a program on the hardware would have written it.
 *
 * The driver's job is to turn a note into byte writes on $4000-$4017, and
 * this checks that what it writes is what a NES needed: the sweep byte that
 * keeps low notes audible, a phase restart only where the hardware forces
 * one, and silence through the channel's own registers rather than $4015.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const hex = (n) => '$' + n.toString(16).toUpperCase().padStart(2, '0');

/** Records what the driver writes, without a chip behind it. */
function recorder() {
  const writes = [];
  const core = {
    schedule: (events) => writes.push(...events),
    load() {},
    render() {},
    setGain() {},
    reset() {},
  };
  const driver = new OfflineDriver(core);
  return { driver, writes, flush: () => driver.flush() };
}

const at = (writes, cycle) => writes.filter((w) => w.at === cycle);
const bytes = (ws) => ws.map((w) => `${w.addr.toString(16)}=${hex(w.value)}`).join(' ');

// ---- power-on, and a note's first frame

{
  const { driver, writes, flush } = recorder();
  driver.playNote('p1', { note: 'A4', instrument: { duty: 1, volume: [15] }, duration: 0.05, at: 1 });
  flush();
  const first = writes[0];
  check('the first write enables the four voices', first.at === 0 && first.addr === 0x4015 && first.value === 0x0f, bytes([first]));

  const frame0 = at(writes, 1789773);
  check(
    'a pulse note writes control, sweep, period low, then period high with the length',
    bytes(frame0) === '4000=$7F 4001=$08 4002=$FD 4003=$F8',
    bytes(frame0),
  );
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('tri', { note: 'A1', instrument: { volume: [15], sustain: true }, duration: 0.05, at: 0 });
  flush();
  const frame0 = at(writes, 0).filter((w) => w.addr !== 0x4015);
  // A1 is 55 Hz: a triangle period of 1016, $3F8.
  check('a triangle note writes the control flag with linear 127, then its period', bytes(frame0) === '4008=$FF 400a=$F8 400b=$FB', bytes(frame0));
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('noi', { note: 9, instrument: { volume: [12, 8], noiseMode: true }, duration: 0.05, at: 0 });
  flush();
  const frame0 = at(writes, 0).filter((w) => w.addr !== 0x4015);
  check('a noise note writes volume, mode and rate, then the length', bytes(frame0) === '400c=$3C 400e=$89 400f=$F8', bytes(frame0));
}

// ---- a held note costs nothing; a change costs one write

{
  const { driver, writes, flush } = recorder();
  driver.playNote('p2', { note: 'C5', instrument: { duty: 2, volume: [15], sustain: true }, duration: 0.5, at: 0 });
  flush();
  const later = writes.filter((w) => w.at > 0 && w.addr !== 0x4004 && w.addr !== 0x4015);
  check('a flat sustained pulse note writes nothing after its first frame', later.length === 0, `${later.length} later writes`);
}

{
  // A4 is period 253; a vibrato of 0.18 semitones swings it past 255. The
  // high byte changes, and $4003 would restart the phase - the click a NES
  // makes. The driver goes through the sweep unit instead, as the hardware's
  // own drivers did: low byte to $FF or $00, a sweep of shift 7 in the right
  // direction, a $4017 write that clocks it at once, then the sweep disarmed
  // and the real low byte written.
  const { driver, writes, flush } = recorder();
  driver.playNote('p1', { note: 'A4', instrument: { duty: 1, volume: [15], sustain: true, vibrato: { depth: 0.18, rate: 8 } }, duration: 0.5, at: 0 });
  flush();
  const restarts = writes.filter((w) => w.at > 0 && w.addr === 0x4003);
  const clocks = writes.filter((w) => w.at > 0 && w.addr === 0x4017 && w.value === 0xc0);
  check('a vibrato across the period high byte never writes $4003 again', restarts.length === 0 && clocks.length > 0, `${restarts.length} restarts, ${clocks.length} sweep clocks`);
  const first = clocks[0].at - 12;
  const sequence = writes.filter((w) => w.at >= first && w.at <= first + 24).map((w) => `${w.at - first}:${w.addr.toString(16)}=${hex(w.value)}`).join(' ');
  check('in blargg\'s sequence, spaced as a CPU spaces it', /^0:4017=\$40 4:4002=\$(FF|00) 8:4001=\$8(7|F) 12:4017=\$C0 20:4001=\$08 24:4002=\$[0-9A-F]{2}$/.test(sequence), sequence);
}

{
  // A slide of more than a high byte a frame has no smooth road: $4003, and
  // the click, as on a NES. An octave a frame from A2 (period 1015) jumps the
  // high byte from 3 to 7 at once.
  const { driver, writes, flush } = recorder();
  driver.playNote('p2', { note: 'A2', instrument: { duty: 0, volume: [15], sustain: true, slide: -12 }, duration: 0.1, at: 0 });
  flush();
  const restarts = writes.filter((w) => w.at > 0 && w.addr === 0x4007);
  check('a fast slide still restarts through $4007 where the high byte jumps by more than one', restarts.length > 0, `${restarts.length} restarts`);
}

// ---- silence, through the channel's own registers

{
  const { driver, writes, flush } = recorder();
  driver.playNote('p1', { note: 'A4', instrument: { volume: [15] }, duration: 0.1, at: 0 });
  driver.stop('noi', 0.2);
  flush();
  const off = writes.filter((w) => w.at === Math.round(0.1 * 1789773));
  check('a pulse note ends with a constant volume of 0', bytes(off) === '4000=$30', bytes(off));
  const noiseOff = writes.filter((w) => w.at === Math.round(0.2 * 1789773));
  check('stopping the noise writes the same', bytes(noiseOff) === '400c=$30', bytes(noiseOff));
  check('$4015 is never written again', writes.filter((w) => w.addr === 0x4015).length === 1);
}

{
  // The triangle has no volume. It is silenced by reloading its linear
  // counter with 0, which the next quarter frame does, and $400B keeps the
  // period high bits it had, so the last milliseconds keep their pitch.
  const core = nesChip.create(44100);
  const driver = new OfflineDriver(core);
  driver.playNote('tri', { note: 'A1', instrument: { volume: [15], sustain: true }, duration: 0.1, at: 0 });
  driver.flush();
  const buffer = new Float32Array(Math.round(44100 * 0.098));
  core.render(buffer, null, 0);
  const periodBefore = core.chip.triangle.period;
  check('the triangle plays until its note ends', core.chip.triangle.linearCounter > 0 && core.chip.triangle.period === 1016, `linear ${core.chip.triangle.linearCounter}, period ${core.chip.triangle.period}`);
  // Past the note off, plus a quarter frame.
  core.render(new Float32Array(Math.round(44100 * 0.008)), null, buffer.length);
  const stepThen = core.chip.triangle.step;
  core.render(new Float32Array(4410), null, buffer.length + Math.round(44100 * 0.008));
  check('within a quarter frame of the end its linear counter is 0', core.chip.triangle.linearCounter === 0, `${core.chip.triangle.linearCounter}`);
  check('and the sequencer holds where it stopped', core.chip.triangle.step === stepThen, `${stepThen} then ${core.chip.triangle.step}`);
  check('at the period it had', core.chip.triangle.period === periodBefore, `${core.chip.triangle.period}`);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
