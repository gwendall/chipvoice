import { gbChip } from '../dist/index.js';

/**
 * The Game Boy's clocks, against the formulas, and its registers, against
 * Pan Docs and blargg's "Game Boy Sound Operation".
 *
 * A pulse steps its duty every (2048 - f) * 4 T-cycles, so a tone is
 * 4194304 / (32 (2048 - f)) Hz; the wave channel steps its thirty-two samples
 * twice as fast; the noise register shifts every divisor << shift; the frame
 * sequencer runs at 512 Hz and clocks lengths at 256, the sweep at 128, the
 * envelopes at 64. The obscure part is what blargg's ROMs check, and they run
 * in the harness; this pins the plain part.
 */
const CLOCK = 4194304;

let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance * b;

/** A powered chip with every voice routed to both sides at full volume. */
function fresh() {
  const chip = gbChip.digital();
  chip.write(0xff26, 0x80);
  chip.write(0xff24, 0x77);
  chip.write(0xff25, 0xff);
  return chip;
}

/** Edges of one voice over some cycles. */
function edges(chip, voice, cycles) {
  const out = [];
  chip.trace(cycles, (c, v, value) => { if (v === voice) out.push([c, value]); });
  return out;
}

// ---- pulses

{
  // f = 1750: (2048 - 1750) * 4 = 1192 T-cycles a step, 8 steps, 439.9 Hz.
  const chip = fresh();
  chip.write(0xff11, 0x80); // duty 2, length 0
  chip.write(0xff12, 0xf0); // volume 15, no envelope
  chip.write(0xff13, 1750 & 0xff);
  chip.write(0xff14, 0x80 | (1750 >> 8));
  const e = edges(chip, 0, CLOCK);
  const rises = e.filter(([, v]) => v === 15).length;
  const want = CLOCK / (32 * (2048 - 1750));
  check('a pulse at f=1750 runs at 4194304 / (32 (2048 - f))', near(rises, want, 0.01), `${rises} periods a second, want ${want.toFixed(1)}`);
  check('at the volume NR12 gave it', e.every(([, v]) => v === 0 || v === 15));
}

{
  // The envelope: volume 15 down, period 1: one step per 64 Hz clock, gone in 15.
  const chip = fresh();
  chip.write(0xff11, 0x80);
  chip.write(0xff12, 0xf1);
  chip.write(0xff13, 0x00);
  chip.write(0xff14, 0x87);
  const levels = new Set();
  chip.trace(CLOCK / 2, (c, v, value) => { if (v === 0) levels.add(value); });
  check('the envelope walks the volume down to 0 in steps of one', [...levels].sort((a, b) => a - b).join() === '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', [...levels].join());
}

// ---- the wave channel

{
  // A ramp in wave RAM: samples 0 to 15 then 15 down to 0, at f = 1024:
  // (2048 - 1024) * 2 = 2048 T-cycles a sample. A trigger does not refill the
  // sample buffer, so the first sample out is the old buffer's, and the first
  // fetch is byte 0's low nibble: the edges run 1 to 15, then 14 down to 0.
  const chip = fresh();
  const ram = [];
  for (let i = 0; i < 8; i++) ram.push(((2 * i) << 4) | (2 * i + 1));
  for (let i = 0; i < 8; i++) ram.push(((15 - 2 * i) << 4) | (14 - 2 * i));
  ram.forEach((b, i) => chip.write(0xff30 + i, b));
  chip.write(0xff1a, 0x80);
  chip.write(0xff1c, 0x20); // full level
  chip.write(0xff1d, 0x00);
  chip.write(0xff1e, 0x84);
  const e = edges(chip, 2, 2048 * 40);
  const spacing = e.slice(2, 12).map(([c], i, a) => (i > 0 ? c - a[i - 1][0] : 0)).slice(1);
  check('the wave channel steps a sample every (2048 - f) * 2 cycles', spacing.every((s) => s === 2048), spacing.join());
  const values = e.slice(0, 30).map(([, v]) => v).join();
  const want = [...Array.from({ length: 15 }, (_, i) => i + 1), ...Array.from({ length: 15 }, (_, i) => 14 - i)].join();
  check('and plays wave RAM, high nibble first', values === want, values.slice(0, 60));
}

{
  const chip = fresh();
  for (let i = 0; i < 16; i++) chip.write(0xff30 + i, 0xff);
  chip.write(0xff1a, 0x80);
  chip.write(0xff1c, 0x60); // quarter
  chip.write(0xff1e, 0x80);
  let level = 0;
  chip.trace(8192, (c, v, value) => { if (v === 2) level = value; });
  check('NR32 at quarter level shifts a sample of 15 to 3', level === 3, `${level}`);
}

// ---- the noise

{
  const chip = fresh();
  chip.write(0xff21, 0xf0);
  chip.write(0xff22, 0x00); // divisor code 0 (8 T-cycles), shift 0
  chip.write(0xff23, 0x80);
  let shifts = 0;
  const original = chip.ch4.clock.bind(chip.ch4);
  chip.ch4.clock = () => { if (chip.ch4.timer === 1) shifts++; original(); };
  for (let i = 0; i < CLOCK; i++) chip.clockT();
  check('the noise shifts every 8 T-cycles at divisor 0, shift 0', near(shifts, CLOCK / 8, 0.001), `${shifts}`);
}

{
  // The 15-bit register repeats after 32767 shifts; the 7-bit one after 127.
  // In the short mode only the low seven bits cycle; the bits above them
  // carry the feedback down and never return to all ones.
  const length = (narrow) => {
    const chip = fresh();
    chip.write(0xff21, 0xf0);
    chip.write(0xff22, narrow ? 0x08 : 0x00);
    chip.write(0xff23, 0x80);
    const mask = narrow ? 0x7f : 0x7fff;
    const start = chip.ch4.lfsr & mask;
    for (let n = 1; n <= 40000; n++) {
      for (let i = 0; i < 8; i++) chip.clockT();
      if ((chip.ch4.lfsr & mask) === start) return n;
    }
    return -1;
  };
  check('the long noise sequence is 32767 steps', length(false) === 32767, `${length(false)}`);
  check('the short one is 127', length(true) === 127, `${length(true)}`);
}

// ---- the frame sequencer

{
  const chip = fresh();
  chip.write(0xff11, 0x80 | (64 - 10)); // length 10
  chip.write(0xff12, 0xf0);
  chip.write(0xff14, 0xc0); // trigger, length enabled
  // Ten length clocks at 256 Hz: the voice ends between 9 and 10 clocks in.
  let off = -1;
  for (let c = 0; c < CLOCK / 20 && off < 0; c++) { chip.clockT(); if (!chip.ch1.enabled) off = c; }
  const clocks = 256;
  check('a length of 10 ends the voice after ten 256 Hz clocks', off > (9 * CLOCK) / clocks && off <= (10 * CLOCK) / clocks + 8192, `at cycle ${off}`);
}

{
  // The extra clock: enabling the length counter on an NRx4 write when the
  // next frame step will not clock lengths counts it once at once.
  const chip = fresh();
  chip.write(0xff11, 0x80 | (64 - 1));
  chip.write(0xff12, 0xf0);
  chip.write(0xff14, 0x80); // trigger, length off: length 1 stays
  // Walk to just after a length-clocking step, so the next one does not.
  while (chip.frameStep % 2 !== 0) chip.clockT();
  chip.write(0xff14, 0x40); // enable, no trigger
  check('enabling the length when the next step will not clock it counts it at once, and ends a length of 1', chip.ch1.enabled === false, `enabled ${chip.ch1.enabled}, length ${chip.ch1.length}`);
}

{
  // The sweep: shift 1 upwards from 1024 steps to 1536 then 2304, which overflows and ends the voice.
  const chip = fresh();
  chip.write(0xff10, 0x11); // period 1, add, shift 1
  chip.write(0xff11, 0x80);
  chip.write(0xff12, 0xf0);
  chip.write(0xff13, 0x00);
  chip.write(0xff14, 0x84); // f = 1024
  const seen = new Set();
  for (let c = 0; c < CLOCK / 8; c++) { chip.clockT(); seen.add(chip.ch1.frequency); }
  check('the sweep steps the frequency by f >> shift each period', [...seen].join() === '1024,1536', [...seen].join());
  check('and an overflow past 2047 ends the voice', chip.ch1.enabled === false);
}

{
  // Overflow on trigger: with shift set, a trigger runs the calculation at once.
  const chip = fresh();
  chip.write(0xff10, 0x01); // period 0, add, shift 1
  chip.write(0xff11, 0x80);
  chip.write(0xff12, 0xf0);
  chip.write(0xff13, 0xff);
  chip.write(0xff14, 0x87); // f = 2047
  check('a trigger with a shift runs the overflow check at once', chip.ch1.enabled === false);
}

// ---- power and read-back

{
  const chip = fresh();
  chip.write(0xff11, 0xbf);
  chip.write(0xff26, 0x00);
  check('power off clears the registers', chip.read(0xff11) === 0x3f, chip.read(0xff11).toString(16));
  check('but the DMG keeps the length counters', chip.ch1.length === 1, `${chip.ch1.length}`);
  chip.write(0xff26, 0x80);
  check('NR52 reads power and the four voice flags', chip.read(0xff26) === 0xf0, chip.read(0xff26).toString(16));
  check('unused bits read as 1', chip.read(0xff10) === 0x80 && chip.read(0xff1a) === 0x7f && chip.read(0xff27) === 0xff);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
