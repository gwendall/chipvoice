import { encodeBrr, snesChip } from '../dist/index.js';

/**
 * The SNES's DSP against the formulas, and the BRR encoder against the DSP.
 *
 * The S-DSP is snes_spc's ported line for line, and the harness compares the
 * two sample for sample; this pins the plain facts: a looped waveform at a
 * pitch plays the frequency the register says, a key-off releases, the echo
 * comes back after the delay the register says, and what the encoder writes
 * decodes on the chip to within a few percent of what went in.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance * b;
const CLOCK = 1024000;

/** A chip with a directory at $0200 and one looped sine of 32 samples at $0400. */
function withSine(extra = []) {
  const chip = snesChip.digital();
  const sine = new Int16Array(32);
  for (let i = 0; i < 32; i++) sine[i] = Math.round(Math.sin((2 * Math.PI * i) / 32) * 26000);
  const brr = encodeBrr(sine, true);
  chip.load(0x0400, brr);
  chip.load(0x0200, new Uint8Array([0x00, 0x04, 0x00, 0x04]));
  const writes = [];
  let t = 0;
  const reg = (a, v) => { writes.push({ at: t, addr: 0xf2, value: a }, { at: t + 5, addr: 0xf3, value: v }); t += 10; };
  // Echo writes off: the buffer the DSP powers on with wraps over the samples.
  // Every voice released: the DSP powers on with some keyed on, on the noise.
  reg(0x6c, 0x20); reg(0x5c, 0xff); reg(0x5d, 0x02); reg(0x0c, 0x7f); reg(0x1c, 0x7f); reg(0x2c, 0); reg(0x3c, 0); reg(0x4d, 0); reg(0x3d, 0); reg(0x2d, 0);
  for (let v = 0; v < 8; v++) { reg(v * 0x10, 0); reg(v * 0x10 + 1, 0); }
  reg(0x5c, 0x00);
  for (const [a, v] of extra) reg(a, v);
  return { chip, writes, reg, at: (time) => { t = time; } };
}

{
  // 440 Hz on a 32-sample loop whose base is 1000 Hz: pitch = 440 * 4096 / 1000 = 1802.
  const { chip, writes, reg } = withSine();
  const pitch = Math.round((440 * 0x1000) / 1000);
  reg(0x04, 0); reg(0x05, 0xff); reg(0x06, 0xe0); reg(0x02, pitch & 0xff); reg(0x03, pitch >> 8); reg(0x00, 0x60); reg(0x01, 0x60); reg(0x4c, 0x01);
  chip.schedule(writes);
  let rises = 0;
  let last = 0;
  chip.trace(CLOCK, (c, v, value) => { if (v === 0) { if (value > 0 && last <= 0) rises++; last = value; } });
  check('a looped sine at the pitch for 440 Hz crosses zero 440 times a second', near(rises, 440, 0.01), `${rises}`);
}

{
  const { chip, writes, reg, at } = withSine();
  reg(0x04, 0); reg(0x05, 0xff); reg(0x06, 0xe0); reg(0x02, 0x00); reg(0x03, 0x10); reg(0x00, 0x7f); reg(0x01, 0x7f); reg(0x4c, 0x01);
  at(CLOCK / 4);
  reg(0x5c, 0x01);
  chip.schedule(writes);
  let peak = 0;
  let lastValue = 0;
  chip.trace(CLOCK / 2, (c, v, value) => { if (v === 0) { if (c < CLOCK / 4) peak = Math.max(peak, Math.abs(value)); lastValue = value; } });
  check('at full volume a sine reaches most of sixteen bits', peak > 16000, `${peak}`);
  check('and a key-off releases it to silence', lastValue === 0, `${lastValue}`);
}

{
  // The echo: a burst on voice 0 with echo at EDL 2 comes back 32 ms later.
  // Writes are enabled once the power-on buffer has wrapped, at 250 ms.
  // Every FIR tap set: the ones the DSP powers on with are a captured state's.
  const { chip, writes, reg, at } = withSine([[0x2c, 0x7f], [0x3c, 0x7f], [0x0d, 0x00], [0x6d, 0xe0], [0x7d, 0x02], [0x4d, 0x01], [0x0f, 0x7f], [0x1f, 0], [0x2f, 0], [0x3f, 0], [0x4f, 0], [0x5f, 0], [0x6f, 0], [0x7f, 0]]);
  const start = Math.round(CLOCK * 0.25);
  at(start);
  reg(0x6c, 0x00);
  reg(0x04, 0); reg(0x05, 0xff); reg(0x06, 0xe0); reg(0x02, 0x00); reg(0x03, 0x10); reg(0x00, 0x40); reg(0x01, 0x40); reg(0x4c, 0x01);
  // A two-millisecond burst: keyed off almost at once, gone in ten.
  at(start + Math.round(CLOCK * 0.002));
  reg(0x5c, 0x01);
  chip.schedule(writes);
  // The burst's onset, the silence after it, and the echo's onset. The trace
  // reports changes, and a sine crosses zero, so silence is a zero that
  // lasts five milliseconds.
  let onset = -1;
  let zeroSince = -1;
  let echoAt = -1;
  chip.trace(start + Math.round(CLOCK * 0.2), (c, v, value) => {
    // Nothing before the burst counts: the voices the DSP powers on with
    // take a few milliseconds to release.
    if (v !== 0 || echoAt > 0 || c < start) return;
    if (onset < 0) {
      if (value !== 0) onset = c;
      return;
    }
    if (value === 0) zeroSince = c;
    else if (zeroSince > 0 && c - zeroSince >= CLOCK * 0.005) echoAt = c;
    else zeroSince = -1;
  });
  const ms = ((echoAt - onset) / CLOCK) * 1000;
  check('the echo brings a burst back a delay of 2 * 16 ms after it', onset > 0 && echoAt > 0 && ms > 30 && ms < 38, `${ms.toFixed(1)} ms`);
}

{
  // BRR: a sine encoded and decoded by the chip is the sine, near enough.
  const sine = new Int16Array(64);
  for (let i = 0; i < 64; i++) sine[i] = Math.round(Math.sin((2 * Math.PI * i) / 64) * 20000);
  const brr = encodeBrr(sine, true);
  check('encodes 64 samples as four 9-byte blocks, the last with the loop and end flags', brr.length === 36 && (brr[27] & 3) === 3 && (brr[0] & 3) === 0, `${brr.length} bytes, header ${brr[27].toString(16)}`);
  const chip = snesChip.digital();
  chip.load(0x0400, brr);
  chip.load(0x0200, new Uint8Array([0x00, 0x04, 0x00, 0x04]));
  const writes = [];
  let t = 0;
  const reg = (a, v) => { writes.push({ at: t, addr: 0xf2, value: a }, { at: t + 5, addr: 0xf3, value: v }); t += 10; };
  reg(0x6c, 0x20); reg(0x5c, 0xff); reg(0x5d, 0x02); reg(0x0c, 0x7f); reg(0x1c, 0x7f); reg(0x2c, 0); reg(0x3c, 0); reg(0x4d, 0); reg(0x3d, 0); reg(0x2d, 0);
  for (let v = 0; v < 8; v++) { reg(v * 0x10, 0); reg(v * 0x10 + 1, 0); }
  reg(0x5c, 0x00);
  // Pitch $1000: one sample per output sample, so the output is the decoded loop through the volume.
  reg(0x04, 0); reg(0x05, 0xff); reg(0x06, 0xe0); reg(0x02, 0x00); reg(0x03, 0x10); reg(0x00, 0x7f); reg(0x01, 0x7f); reg(0x4c, 0x01);
  chip.schedule(writes);
  const out = [];
  chip.trace(Math.round(CLOCK * 0.05), (c, v, value) => { if (v === 0) out.push(value); });
  let peak = 0;
  for (const s of out.slice(-200)) peak = Math.max(peak, Math.abs(s));
  check('and plays back near the amplitude that went in', peak > 17000 && peak < 21000, `peak ${peak} for 20000 in`);
}

check('the SNES has eight voices and a stereo stream', snesChip.spec.voices.length === 8 && snesChip.digital().voices.join() === 'left,right');

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
