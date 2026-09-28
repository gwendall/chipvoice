import { Ym2151 } from '../dist/index.js';

/**
 * The YM2151 core against Nuked-OPM's own documented two-port write
 * protocol and pipeline settling window (`ym2151.ts`'s module comment and
 * `docs/chips/ym2151.md`'s "Known deviations" have the mechanism).
 *
 * `packages/conform`'s `check:ym2151-core`/`check:ym2151-edge` are the
 * register-log comparison against Nuked-OPM and, report-only, ymfm; this
 * file pins the facts a harness run alone does not show as directly - power
 * on state, that a key-on actually produces sound, that the eight
 * algorithms are not all the same formula, the two-port protocol itself,
 * and the settling window's drop - directly against the class's own fields,
 * which TypeScript's `private` does not hide at runtime.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

/** Comfortably past the up-to-32-`clock()`-call settling window a channel/slot register write needs to commit. */
const SETTLE = 40;

function clockN(chip, n) {
  for (let i = 0; i < n; i++) chip.clock();
}

/** One two-port register write: address port, a short gap, data port, then a full settle. */
function writeReg(chip, addr, data) {
  chip.write(0, addr & 0xff);
  clockN(chip, 4);
  chip.write(1, data & 0xff);
  clockN(chip, SETTLE);
}

/** The four channel registers, `generate-ym2151.mjs`'s own encoding. */
function channelRegs(chip, channel, { rl = 3, fb = 0, connect = 0, kc = 0x4c, kf = 0, pms = 0, ams = 0 } = {}) {
  writeReg(chip, 0x20 | channel, (rl << 6) | ((fb & 7) << 3) | (connect & 7));
  writeReg(chip, 0x28 | channel, kc & 0x7f);
  writeReg(chip, 0x30 | channel, (kf & 0x3f) << 2);
  writeReg(chip, 0x38 | channel, ((pms & 7) << 4) | (ams & 3));
}

/** The six slot (operator) registers, `generate-ym2151.mjs`'s own encoding. */
function slotRegs(chip, slot, { dt1 = 0, mul = 0, tl = 0, ks = 0, ar = 31, ame = 0, d1r = 0, dt2 = 0, d2r = 0, d1l = 0, rr = 15 } = {}) {
  writeReg(chip, 0x40 | slot, ((dt1 & 7) << 4) | (mul & 15));
  writeReg(chip, 0x60 | slot, tl & 0x7f);
  writeReg(chip, 0x80 | slot, (ks << 6) | (ar & 31));
  writeReg(chip, 0xa0 | slot, (ame << 7) | (d1r & 31));
  writeReg(chip, 0xc0 | slot, ((dt2 & 3) << 6) | (d2r & 31));
  writeReg(chip, 0xe0 | slot, ((d1l & 15) << 4) | (rr & 15));
}

const slotFor = (channel, op) => channel + 8 * op;

/** Register 0x08: D3..D6 key the four operators of `channel` on or off, `ops` a 4-bit mask. */
function keyOn(chip, channel, ops) {
  writeReg(chip, 0x08, ((ops & 15) << 3) | (channel & 7));
}

/** Configures one channel's four operators identically, loud and fast-attacking, so only `chRegs` varies. */
function defaultChannel(chip, channel, chRegs) {
  channelRegs(chip, channel, chRegs);
  for (let op = 0; op < 4; op++) {
    slotRegs(chip, slotFor(channel, op), { mul: op + 1, tl: op * 4, ar: 31, d1r: 4, d2r: 2, d1l: 6, rr: 8 });
  }
}

/** Runs `n` more `clock()` calls, collecting `dac_output[0]` (left) each time. */
function traceLeft(chip, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    chip.clock();
    out[i] = chip.dac_output[0];
  }
  return out;
}

// 1. Power-on state: `reset()` (the constructor's own first call) settles to silence.
{
  const chip = new Ym2151();
  const silentDac = chip.dac_output[0] === 0 && chip.dac_output[1] === 0;
  const zeroed = chip.noise_en === 0 && chip.noise_freq === 0 && chip.mode_kon_channel === 0
    && chip.write_busy === 0 && chip.timer_a_status === 0 && chip.ic === 0;
  check("reset() leaves dac_output silent and the fields no write has touched at zero", silentDac && zeroed);
}

// 2. A full key-on, algorithm 7 (additive), produces a non-silent, changing trace.
{
  const chip = new Ym2151();
  defaultChannel(chip, 0, { fb: 0, connect: 7, kc: 0x4c });
  keyOn(chip, 0, 0b1111);
  const trace = traceLeft(chip, 4000);
  const nonSilent = trace.some((v) => v !== 0);
  const changing = new Set(trace).size > 1;
  check('a full key-on across all four operators, algorithm 7, is non-silent and changes over time', nonSilent && changing);
}

// 3. The eight CONNECT algorithms, same operator registers otherwise, produce eight distinct traces.
{
  const traces = [];
  for (let alg = 0; alg < 8; alg++) {
    const chip = new Ym2151();
    defaultChannel(chip, 0, { fb: 4, connect: alg, kc: 0x4c });
    keyOn(chip, 0, 0b1111);
    traces.push(traceLeft(chip, 2000).join(','));
  }
  const distinct = new Set(traces).size;
  check('the eight CONNECT algorithms produce eight distinct traces', distinct === 8, `${distinct}/8 distinct`);
}

// 4. write(0, address) then write(1, data) is the two-port protocol; a stray data write with no preceding address write does nothing.
{
  const chip = new Ym2151();
  writeReg(chip, 0x0f, 0x80); // NE=1, NFRQ=0: register 0x0f, a mode register with no settling delay.
  const applied = chip.noise_en === 1;

  const stray = new Ym2151();
  // mode_address is 0 straight out of reset (no address-port write has ever landed); a data-port
  // write alone must not be read as register 0 (which is not a mode-register case) or as 0x0f.
  stray.write(1, 0x80);
  clockN(stray, SETTLE);
  const ignored = stray.noise_en === 0;

  check('write(0, address) then write(1, data) applies the register; a lone data write does not', applied && ignored);
}

// 5. The settling window: a second address-port write before the pending data half commits drops it; one spaced past it lands.
{
  const slot = slotFor(0, 0); // channel 0, operator M1.
  const tlAddr = 0x60 | slot;
  const otherAddr = 0x60 | slotFor(1, 0); // a different slot's TL register, just to occupy the address port.

  const dropped = new Ym2151();
  writeReg(dropped, tlAddr, 0x10); // baseline, fully settled.
  dropped.write(0, tlAddr);
  clockN(dropped, 4);
  dropped.write(1, 0x55); // the pending data half.
  clockN(dropped, 2); // well inside the up-to-32-clock() settling window: no commit yet.
  dropped.write(0, otherAddr); // a new address-port write arrives before that commit.
  clockN(dropped, SETTLE);
  const wasDropped = dropped.sl_tl[slot] === 0x10;

  const landed = new Ym2151();
  writeReg(landed, tlAddr, 0x10);
  landed.write(0, tlAddr);
  clockN(landed, 4);
  landed.write(1, 0x55);
  clockN(landed, SETTLE); // past the settling window before anything else touches the address port.
  landed.write(0, otherAddr);
  clockN(landed, SETTLE);
  const didLand = landed.sl_tl[slot] === 0x55;

  check('a second address-port write inside the settling window drops the pending data half; one spaced past it lands', wasDropped && didLand);
}

// 6. A corrupted register write changes the trace - the parity gate this unlocks has something to catch.
{
  const clean = new Ym2151();
  defaultChannel(clean, 0, { fb: 4, connect: 5, kc: 0x4c });
  keyOn(clean, 0, 0b1111);
  const cleanTrace = traceLeft(clean, 2000);

  const dirty = new Ym2151();
  channelRegs(dirty, 0, { rl: 3, fb: 4, connect: 5, kc: 0x4c });
  for (let op = 0; op < 4; op++) {
    const opts = { mul: op + 1, tl: op * 4, ar: 31, d1r: 4, d2r: 2, d1l: 6, rr: 8 };
    if (op === 0) opts.tl ^= 0x0f; // one corrupted byte, op0's TL.
    slotRegs(dirty, slotFor(0, op), opts);
  }
  keyOn(dirty, 0, 0b1111);
  const dirtyTrace = traceLeft(dirty, 2000);

  const diverges = cleanTrace.some((v, i) => v !== dirtyTrace[i]);
  check('a corrupted register write changes the trace', diverges);
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
