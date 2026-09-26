import { mdChip, Sn76489, Ym2612 } from '../dist/index.js';

/**
 * The Mega Drive's chips against the formulas.
 *
 * The YM2612 is Nuked-OPN2 ported line for line, and the harness compares
 * the two cycle for cycle; this pins the plain facts a formula gives: a
 * carrier at an F-number plays the pitch the datasheet says, a key-off
 * releases, the DAC passes its byte. The PSG is from the documents: its tone
 * rate, its attenuator, its noise register's two sequences.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance * b;

const MASTER = 53693175;
const YM_INPUT = MASTER / 7;

// ---- the YM2612 on its own: a sine carrier

/** A patch of one carrier at full level, the rest silent; then a pitch and a key-on. */
function sine(ym, hz) {
  const pair = (address, value) => {
    ym.write(0, address);
    ym.clock();
    ym.write(1, value);
    for (let i = 0; i < 32; i++) ym.clock();
  };
  // OP1 to OP4 at register offsets 0, 8, 4, 12.
  for (const [offset, tl] of [[0, 0], [8, 127], [4, 127], [12, 127]]) {
    pair(0x30 + offset, 0x01); // multiple 1
    pair(0x40 + offset, tl);
    pair(0x50 + offset, 0x1f); // attack at once
    pair(0x60 + offset, 0x00);
    pair(0x70 + offset, 0x00);
    pair(0x80 + offset, 0x0f); // release fast
  }
  pair(0xb0, 0x07); // algorithm 7, no feedback
  pair(0xb4, 0xc0);
  let block = 0;
  let fnum = (144 * hz * 2 ** 21) / YM_INPUT;
  while (fnum >= 2048 && block < 7) { fnum /= 2; block++; }
  fnum = Math.round(fnum);
  pair(0xa4, (block << 3) | (fnum >> 8));
  pair(0xa0, fnum & 0xff);
  pair(0x28, 0xf0);
}

{
  const ym = new Ym2612();
  sine(ym, 440);
  // One second of internal cycles: the input clock over six.
  const cycles = Math.round(YM_INPUT / 6);
  let rises = 0;
  let last = 0;
  for (let i = 0; i < cycles; i++) {
    ym.clock();
    const v = ym.ch_out[0];
    if (v > 0 && last <= 0) rises++;
    last = v;
  }
  check('a carrier at the F-number for A4 crosses zero 440 times a second', near(rises, 440, 0.01), `${rises}`);
}

{
  const ym = new Ym2612();
  sine(ym, 220);
  for (let i = 0; i < 20000; i++) ym.clock();
  let peak = 0;
  for (let i = 0; i < 20000; i++) { ym.clock(); peak = Math.max(peak, Math.abs(ym.ch_out[0])); }
  check('at full level the channel output reaches the nine-bit edge', peak >= 200 && peak <= 256, `${peak}`);
  ym.write(0, 0x28); ym.clock(); ym.write(1, 0x00);
  for (let i = 0; i < 400000; i++) ym.clock();
  check('a key-off releases it to silence', ym.ch_out[0] === 0, `${ym.ch_out[0]}`);
}

{
  const ym = new Ym2612();
  const pair = (address, value) => { ym.write(0, address); ym.clock(); ym.write(1, value); for (let i = 0; i < 32; i++) ym.clock(); };
  pair(0x2b, 0x80);
  pair(0x2a, 0xc0);
  for (let i = 0; i < 48; i++) ym.clock();
  // The DAC's byte, centred on $80, reaches the pins in channel 6's slot.
  let seen = new Set();
  for (let i = 0; i < 24; i++) { ym.clock(); seen.add(ym.mol); }
  check('the DAC puts its byte on the pins', [...seen].some((v) => v > 100), [...seen].join());
}

// ---- the PSG

{
  const psg = new Sn76489();
  // 440 Hz: N = 3579545 / (32 * 440) = 254.
  psg.write(0x80 | (254 & 0x0f));
  psg.write(254 >> 4);
  psg.write(0x90); // full volume
  let rises = 0;
  let last = 0;
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 3579545; i++) {
    psg.clock();
    psg.outputs(out);
    if (out[0] > 0 && last === 0) rises++;
    last = out[0];
  }
  check('a PSG tone at N = 254 plays 440 Hz', near(rises, 440, 0.01), `${rises}`);
  check('at the attenuator\'s full level', out[0] === 15 || out[0] === 0);
}

{
  const psg = new Sn76489();
  psg.write(0xe4); // white, rate 0
  psg.write(0xf0);
  const start = psg.lfsr;
  let n = 0;
  for (let i = 0; i < 60000; i++) {
    for (let k = 0; k < 16 * 32; k++) psg.clock();
    n++;
    if (psg.lfsr === start) break;
  }
  // Sixteen bits with taps at 0 and 3 is not a maximal register: from its
  // reset value it repeats after 7 * 8191 shifts, which is what the taps
  // give and what MAME's model of the Sega PSG computes.
  check('the white noise register repeats after 57337 shifts', n === 57337, `${n}`);
  psg.write(0xe0); // periodic, rate 0
  const start2 = psg.lfsr;
  let m = 0;
  for (let i = 0; i < 100; i++) {
    for (let k = 0; k < 16 * 32; k++) psg.clock();
    m++;
    if (psg.lfsr === start2) break;
  }
  check('and the periodic one after 16', m === 16, `${m}`);
}

{
  // Rate 3 clocks the noise from tone 2's period register, not from tone 2's
  // own counter (see the comments in sn76489.ts). SMS Power's notes give the
  // resulting "periodic noise" frequency range as 6.8 Hz to 6991 Hz for
  // register values $3ff and $001, an independently stated number to check
  // against rather than a restatement of this file's own formula.
  const rate3Hz = (period) => {
    const psg = new Sn76489();
    psg.write(0xc0 | (period & 0x0f));
    psg.write((period >> 4) & 0x3f);
    psg.write(0xe3); // periodic noise, rate 3
    let rises = 0;
    let bit = psg.lfsr & 1;
    for (let i = 0; i < 3579545; i++) {
      psg.clock();
      const next = psg.lfsr & 1;
      if (next === 1 && bit === 0) rises++;
      bit = next;
    }
    return rises;
  };
  const fast = rate3Hz(1);
  const slow = rate3Hz(1023);
  check('rate 3 at register $001 gives the documented 6991 Hz', fast === 6991, `${fast}`);
  check('and register $3ff gives about the documented 6.8 Hz', near(slow, 6.8, 0.15), `${slow}`);
}

{
  // The noise's own counter is independent of tone 2's: changing tone 2's
  // period mid-count does not move the noise's next reload, only what it
  // reloads to the next time it reaches zero.
  const psg = new Sn76489();
  const tone2 = (period) => {
    psg.write(0xc0 | (period & 0x0f));
    psg.write((period >> 4) & 0x3f);
  };
  tone2(5);
  psg.write(0xe3); // periodic noise, rate 3
  const shifts = [];
  let last = psg.lfsr;
  for (let tick = 1; tick <= 60; tick++) {
    if (tick === 3) tone2(9); // mid-count: between the 1st reload (tick 1) and the 2nd (tick 6)
    for (let k = 0; k < 16; k++) psg.clock();
    if (psg.lfsr !== last) { shifts.push(tick); last = psg.lfsr; }
  }
  // At a steady period of 5, shifts land every 10 ticks: 6, 16, 26, .... The
  // reload already under way at tick 1 keeps counting down on the old
  // period and still reloads at tick 6, but that reload reads tone 2's
  // period as it now is (9), so every reload after it, and every other
  // shift, keeps that new spacing instead.
  check(
    "a tone 2 change mid-count moves the noise's next period, not its next reload",
    shifts.join() === [6, 24, 42, 60].join(),
    shifts.join(),
  );
}

{
  const chip = mdChip.digital();
  check('the Mega Drive has ten voices', chip.voices.length === 10 && chip.voices[0] === 'fm1' && chip.voices[9] === 'noise');
  check('on the master clock', mdChip.spec.clockHz === MASTER);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
