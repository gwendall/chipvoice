import {
  Ay8910,
  AY8910_VOICES,
  Sunsoft5bAudio,
  NES_SUNSOFT5B,
  NES_SUNSOFT5B_VOICES,
  Sunsoft5bNesCore,
  Sunsoft5bNesDigital,
  Sunsoft5bMixStage,
  SUNSOFT5B_DAC,
  SUNSOFT5B_MIX_UNIT_GAIN,
  isSunsoft5bAddr,
  nesSunsoft5bChip,
  getChip,
  chipFor,
  chips,
  CHIP_IDS,
} from '../dist/index.js';

/**
 * `Ay8910` (`chips/ay8910.ts`) and its Sunsoft 5B host (`chips/nes/sunsoft5b.ts`,
 * `chips/nes/sunsoft5b-core.ts`) against nesdev's "Sunsoft 5B audio" page and
 * General Instrument's AY-3-8910/8912/8913 datasheet.
 *
 * `packages/conform`'s `check:ay8910-core`/`check:ay8910-core-gme`/
 * `check:ay8910-edge` are the register-log comparisons against Ayumi and
 * Game_Music_Emu's `Ay_Apu` (`docs/DECISIONS.md`'s decision 47 records which
 * oracle is trusted for which feature); this file pins the documented facts
 * a harness run alone would not show as clearly - the mixer's AND-gate
 * convention, the DAC-mode identity, the envelope's 16 shapes, the noise
 * LFSR's Galois-form period, the 5B's own $C000/$E000 port decode including
 * the DDDD-disable latch - and proves the combined chip's own logarithmic
 * mixing math and its seam with the plain 2A03 behave as documented.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

// Chip-internal register indices (0-15), matching `Ay8910.write`'s own
// addressing - not a CPU bus address. `packages/conform`'s
// `src/corpus/generate-ay8910.mjs` uses the same map and mixer convention;
// duplicated here rather than imported since the two packages do not share
// test helpers.
const REG = {
  toneALo: 0, toneAHi: 1, toneBLo: 2, toneBHi: 3, toneCLo: 4, toneCHi: 5,
  noise: 6, mixer: 7, volA: 8, volB: 9, volC: 10, envLo: 11, envHi: 12, envShape: 13,
};

/** R7's bit layout: bits 0-2 disable tone A/B/C, bits 3-5 disable noise
 * A/B/C, 0 = enabled (nesdev's own naming, inverted from what "disable"
 * suggests). Takes which generators are ENABLED, same shape as the corpus
 * generator's own helper. */
function mixer({ toneA = false, toneB = false, toneC = false, noiseA = false, noiseB = false, noiseC = false } = {}) {
  return (toneA ? 0 : 1) | (toneB ? 0 : 1 << 1) | (toneC ? 0 : 1 << 2) |
    (noiseA ? 0 : 1 << 3) | (noiseB ? 0 : 1 << 4) | (noiseC ? 0 : 1 << 5);
}
/** Every generator bit disabled: every channel forced into DAC mode. */
const DAC_ALL = mixer({});

function volReg(fixedVolume, envelopeOn = false) {
  return (envelopeOn ? 0x10 : 0) | (fixedVolume & 0x0f);
}

/** Runs a fresh `Ay8910` with writes from `script(w)`, `w(reg, value, at)`. */
function run(script, cycles, options) {
  const chip = new Ay8910(options);
  const writes = [];
  script((reg, value, at = 0) => writes.push({ at, addr: reg, value }));
  chip.schedule(writes);
  const streams = [[], [], []];
  chip.trace(cycles, (cycle, voice, value) => streams[voice].push({ cycle, value }));
  return streams;
}

/** Samples every cycle's raw voice values, `chan` (0-2) only, for tests that
 * need a dense series rather than a sparse change stream. */
function sample(script, cycles, chan, options) {
  const chip = new Ay8910(options);
  const writes = [];
  script((reg, value, at = 0) => writes.push({ at, addr: reg, value }));
  chip.schedule(writes);
  const out = [0, 0, 0];
  const values = [];
  for (let i = 0; i < cycles; i++) {
    chip.step();
    chip.outputs(out);
    values.push(out[chan]);
  }
  return values;
}

// -------------------------------------------------------------- registers

check('Ay8910 reports its three voices in order', AY8910_VOICES.join(',') === 'a,b,c');

// ---------------------------------------------------------------- DAC mode

{
  // Both generators disabled for a channel forces gate = 1 unconditionally
  // ("DAC mode"): the raw output is `2V + 1` from the volume register alone,
  // regardless of the tone/noise period registers (left at their power-on
  // defaults here on purpose - a real driver never sets them for a pure DAC
  // channel either).
  const streams = run((w) => {
    w(REG.mixer, DAC_ALL);
    for (let v = 0; v <= 15; v++) w(REG.volA, volReg(v), v * 100);
  }, 1700);
  const values = streams[0].map((e) => e.value);
  const expected = Array.from({ length: 16 }, (_, v) => 2 * v + 1);
  check('DAC mode reports 2V + 1 for every fixed volume 0-15, in order', values.slice(0, 16).join(',') === expected.join(','), values.slice(0, 16).join(','));
}

{
  // A channel not in DAC mode (tone enabled) goes silent whenever the tone
  // bit is low, unlike DAC mode which never does for a nonzero volume - the
  // negative half of the DAC-mode fact above, proving the gate really is
  // conditional on both mixer bits, not just present in the register.
  const values = sample((w) => {
    w(REG.mixer, mixer({ toneA: true }));
    w(REG.toneALo, 4); w(REG.toneAHi, 0);
    w(REG.volA, volReg(15));
  }, 300, 0);
  const seenSilent = values.some((v) => v === 0);
  const seenLoud = values.some((v) => v === 31);
  check('with tone enabled (not DAC mode), the channel goes silent between duty toggles despite a nonzero volume', seenSilent && seenLoud);
}

// -------------------------------------------------------------- mixer gate

{
  // Tone-only: output alternates between 0 (gate closed) and 2V+1 (gate
  // open) at the tone divider's own rate - `outputs()`'s gate formula,
  // `(toneBit | toneDisabled) & (noiseLfsr | noiseDisabled) & 1`, read
  // directly off a period short enough to see several toggles.
  const values = sample((w) => {
    w(REG.mixer, mixer({ toneA: true }));
    w(REG.toneALo, 4); w(REG.toneAHi, 0);
    w(REG.volA, volReg(15));
  }, 200, 0);
  const seen = new Set(values);
  check('tone-only gate alternates between silent and the fixed DAC value', seen.has(0) && seen.has(31), [...seen].join(','));
}

{
  // Both tone and noise enabled for a channel: the gate is their AND, so it
  // can only ever be open when both the tone bit and the noise LFSR's low
  // bit are 1 - never open on a cycle where either alone is 0. Verified by
  // comparing against tone-only and noise-only runs of the identical
  // register setup (same periods, same volume), sampled with the chip's own
  // internals directly instead of re-deriving the gate formula.
  const toneOnly = sample((w) => {
    w(REG.mixer, mixer({ toneA: true }));
    w(REG.toneALo, 5); w(REG.toneAHi, 0);
    w(REG.noise, 3);
    w(REG.volA, volReg(15));
  }, 400, 0);
  const noiseOnly = sample((w) => {
    w(REG.mixer, mixer({ noiseA: true }));
    w(REG.toneALo, 5); w(REG.toneAHi, 0);
    w(REG.noise, 3);
    w(REG.volA, volReg(15));
  }, 400, 0);
  const both = sample((w) => {
    w(REG.mixer, mixer({ toneA: true, noiseA: true }));
    w(REG.toneALo, 5); w(REG.toneAHi, 0);
    w(REG.noise, 3);
    w(REG.volA, volReg(15));
  }, 400, 0);
  let andMatches = true;
  for (let i = 0; i < both.length; i++) {
    const expectedOpen = toneOnly[i] !== 0 && noiseOnly[i] !== 0;
    const actuallyOpen = both[i] !== 0;
    if (expectedOpen !== actuallyOpen) andMatches = false;
  }
  check('tone-and-noise gate is exactly the AND of the tone-only and noise-only gates', andMatches);
}

// ---------------------------------------------------------- noise LFSR

// Nesdev's own text: "a 17-bit linear feedback shift register with taps at
// bits 16 and 13" - taken literally (shift right, XOR the bit shifted out
// into both tapped positions) this is the Galois form `ay8910.ts`'s `tick()`
// implements; `docs/DECISIONS.md`'s decision 47 records why this and not the
// Fibonacci form Ayumi uses. This reference recurrence is the same formula,
// written independently here rather than imported, so this test is a real
// check against the class and not a tautology against its own source.
function galoisNoiseShift(lfsr) {
  const feedback = lfsr & 1;
  return (lfsr >>> 1) ^ (feedback ? 0x12000 : 0);
}

{
  let lfsr = 1;
  let period = 0;
  do {
    lfsr = galoisNoiseShift(lfsr);
    period++;
  } while (lfsr !== 1 && period < 200000);
  check('the reference Galois recurrence from seed 1 is maximal-length: period 2^17 - 1 = 131071', period === 131071, `period ${period}`);
}

{
  // `Ay8910`'s own LFSR seeds to 1 (`noiseLfsr`'s own field comment: nesdev
  // does not document a reset seed, so this follows both oracles). With
  // tone disabled and noise enabled at period 1 (the fastest possible), and
  // a fixed non-envelope volume, the channel's raw output is 0 or 31
  // depending only on the LFSR's own low bit - sampled here for the LFSR's
  // entire 131071-shift period (prescale 1 so every cycle is one generator
  // tick, keeping the run to 2 * 131071 cycles instead of 16 times that).
  const shifts = 131071;
  const values = sample((w) => {
    w(REG.mixer, mixer({ noiseA: true }));
    w(REG.noise, 1);
    w(REG.volA, volReg(15));
  }, 2 * shifts + 2, 0, { prescale: 1 });

  // `values[2k + 1]` is the LFSR's bit right after its (k + 1)-th shift
  // (shifts land on odd sample indices at noise period 1, prescale 1: two
  // cycles per shift, the shift itself happening on the second); `values[0]`
  // still reflects the unshifted seed.
  check('the unshifted seed (bit 0 of 1) gates the channel open before the first shift', values[0] === 31);
  let matches = true;
  let lfsr = 1;
  for (let k = 0; k < shifts; k++) {
    lfsr = galoisNoiseShift(lfsr);
    const expected = (lfsr & 1) ? 31 : 0;
    if (values[2 * k + 1] !== expected) { matches = false; break; }
  }
  check(`the chip's own noise generator reproduces the reference Galois sequence for its entire ${shifts}-shift period`, matches);
  check('the LFSR returns to its seed exactly at the end of one full period, not before', lfsr === 1);
}

// ----------------------------------------------------------------- envelope

/** Maximal runs of `target` in a dense, one-sample-per-cycle series - used
 * below instead of fixed cycle indices, since the exact index a step lands
 * on depends on the prescale/envPeriod arithmetic (`Ay8910.tick()`'s own
 * doc comment) and hand-deriving it once already produced an off-by-one. */
function runsOf(values, target) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === target) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start !== -1) runs.push([start, values.length - 1]);
  return runs;
}

{
  // Any write to R13 restarts the envelope from segment 0, even the same
  // shape value again ("Writing the shape register resets the envelope" -
  // nesdev). Shape 0 (C0 A0 a0 H0): a single down-ramp from 31 to 0, then
  // holds at 0 forever - envelope bit set, DAC mode so the gate never
  // interferes, period 1 (the fastest ramp), the host's own default
  // prescale (16) so the ramp's timing matches how a real driver would see
  // it (`tick()`'s doc comment: the first tick lands at cycle 15).
  const values = sample((w) => {
    w(REG.mixer, DAC_ALL);
    w(REG.envLo, 1); w(REG.envHi, 0);
    w(REG.volA, volReg(0, true));
    w(REG.envShape, 0);
  }, 560, 0);
  check('envelope shape 0 starts at 31 (full), before the first tick lands', values[0] === 31);
  let monotonic = true;
  for (let i = 1; i < values.length; i++) if (values[i] > values[i - 1]) monotonic = false;
  check('envelope shape 0 never rises, only ramps down or holds', monotonic);
  const zeroRuns = runsOf(values, 0);
  check('envelope shape 0 reaches 0 exactly once and holds there for the rest of the run', zeroRuns.length === 1 && zeroRuns[0][1] === values.length - 1, JSON.stringify(zeroRuns));
}

{
  // Shape 8 (C1 A0 a0 H0): a repeating down-ramp, sawtooth - it touches 0
  // and immediately restarts at 31, unlike shape 0's single hold.
  const values = sample((w) => {
    w(REG.mixer, DAC_ALL);
    w(REG.envLo, 1); w(REG.envHi, 0);
    w(REG.volA, volReg(0, true));
    w(REG.envShape, 8);
  }, 1200, 0);
  const zeroRuns = runsOf(values, 0);
  check('envelope shape 8 (continue) touches 0 more than once - it restarts instead of holding', zeroRuns.length >= 2, JSON.stringify(zeroRuns));
  const peakRuns = runsOf(values, 31);
  check('envelope shape 8 returns to 31 after each 0, more than once', peakRuns.length >= 2, JSON.stringify(peakRuns));
}

{
  // Shape 14 (C1 A1 a1 H0), "/\/\": ramps up then down, alternating forever
  // - the classic AY/YM triangle envelope, never holding at either end.
  const values = sample((w) => {
    w(REG.mixer, DAC_ALL);
    w(REG.envLo, 1); w(REG.envHi, 0);
    w(REG.volA, volReg(0, true));
    w(REG.envShape, 14);
  }, 1600, 0);
  const peakRuns = runsOf(values, 31);
  const troughRuns = runsOf(values, 0);
  check('envelope shape 14 reaches its peak (31) more than once, proving it alternates rather than holding', peakRuns.length >= 2, JSON.stringify(peakRuns));
  check('envelope shape 14 reaches its trough (0) more than once, proving it alternates rather than holding', troughRuns.length >= 2, JSON.stringify(troughRuns));
}

{
  // The envelope-vs-fixed-volume select bit (register bit 4, "R8-R10's own
  // `0x10` bit"): the same channel reports its envelope position when set,
  // its fixed `2V + 1` when clear - re-derived here as a single toggle so
  // the two paths are proven to share one channel, not just tested apart.
  const values = sample((w) => {
    w(REG.mixer, DAC_ALL);
    w(REG.envLo, 1000); w(REG.envHi, 0); // slow enough to hold near 31 for a while
    w(REG.envShape, 14);
    w(REG.volA, volReg(7, false), 0); // fixed volume 7 first
    w(REG.volA, volReg(0, true), 50); // then envelope-driven
  }, 60, 0);
  check('the fixed-volume path reports 2V + 1 while the envelope bit is clear', values[10] === 2 * 7 + 1, values[10]);
  check('the same channel switches to the envelope position once the envelope bit is set', values[55] !== 2 * 7 + 1, values[55]);
}

// ------------------------------------------------ generators never halt

{
  // Nesdev is explicit that disabling via the mixer only silences the
  // output - it never stops the tone/noise/envelope counters. Proven here
  // by disabling a channel mid-count, running far past where its period
  // would have reloaded many times over, then re-enabling and checking the
  // very next sample is not the "just reloaded" phase a halted-and-reset
  // counter would show.
  const chip = new Ay8910();
  chip.schedule([
    { at: 0, addr: REG.mixer, value: mixer({ toneA: true }) },
    { at: 0, addr: REG.toneALo, value: 10 },
    { at: 0, addr: REG.toneAHi, value: 0 },
    { at: 0, addr: REG.volA, value: volReg(15) },
  ]);
  chip.trace(25, () => {}); // partway through the first period
  chip.schedule([{ at: 25, addr: REG.mixer, value: mixer({}) }]); // disable (DAC mode, volume still 15 so output would be 31 if it were the gate holding it open)
  const out = [0, 0, 0];
  chip.step();
  chip.outputs(out);
  check('disabling a channel forces its output to the DAC value, not the last gated value', out[0] === 31); // both bits off = DAC mode per the gate formula, not silence
  // Run far past many free periods' worth of cycles while disabled, then
  // switch back to tone-only: if the counter had been frozen at the exact
  // phase it was disabled at (rather than continuing to run), re-enabling
  // at a cycle count that is not a multiple of the 10-cycle period would
  // still show a value inherited from a frozen phase; running past many
  // periods and confirming the tone bit has flipped an odd number of times
  // relative to a fresh count is the simplest external proof it kept going.
  chip.trace(999, () => {});
  chip.schedule([{ at: chip.cycle, addr: REG.mixer, value: mixer({ toneA: true }) }]);
  const freshChip = new Ay8910();
  freshChip.schedule([
    { at: 0, addr: REG.mixer, value: mixer({ toneA: true }) },
    { at: 0, addr: REG.toneALo, value: 10 },
    { at: 0, addr: REG.toneAHi, value: 0 },
    { at: 0, addr: REG.volA, value: volReg(15) },
  ]);
  freshChip.trace(25 + 1 + 999, () => {});
  const outAfter = [0, 0, 0];
  chip.step();
  chip.outputs(outAfter);
  const freshOut = [0, 0, 0];
  freshChip.outputs(freshOut);
  check('the tone divider kept counting through the whole disabled span, landing on the same phase a never-disabled run would', outAfter[0] === freshOut[0], `${outAfter[0]} vs ${freshOut[0]}`);
}

// ------------------------------------------------------- negative test

{
  // A cheap proof the parity gate this unlocks would bite: two `Ay8910`
  // instances driven by the same log except one write is corrupted must
  // diverge somewhere in their traces. Tone-only, two periods far enough
  // apart to produce a different toggle count within the same window (not
  // just a shifted phase of the same count), same reasoning as
  // `test/vrc6.mjs`'s own negative test.
  const good = () => run((w) => {
    w(REG.mixer, mixer({ toneA: true }));
    w(REG.toneALo, 12); w(REG.toneAHi, 0);
    w(REG.volA, volReg(15));
  }, 2000);
  const corrupted = () => run((w) => {
    w(REG.mixer, mixer({ toneA: true }));
    w(REG.toneALo, 50); w(REG.toneAHi, 0);
    w(REG.volA, volReg(15));
  }, 2000);
  const a = JSON.stringify(good());
  const b = JSON.stringify(corrupted());
  check('a corrupted tone-period write changes the trace (the gate has something to catch)', a !== b);
}

// -------------------------------------------------- Sunsoft5bAudio's ports

{
  // $C000 selects one of 16 registers (low nibble); $E000 writes it. A
  // round trip through the two CPU-mapped ports must land the same register
  // state `Ay8910.write` would from a direct chip-index call.
  const host = new Sunsoft5bAudio();
  host.schedule([
    { at: 0, addr: 0xc000, value: REG.volA },
    { at: 0, addr: 0xe000, value: volReg(9) },
  ]);
  host.trace(5, () => {});
  check('a $C000 select followed by an $E000 write lands on the selected register', host.ay.regs[REG.volA] === volReg(9));
}

{
  // "DDDD RRRR" - the high nibble of a $C000 write is not a don't-care: any
  // nonzero D disables the $E000 data port until the next $C000 write
  // clears it, nesdev's "(like the original YM2149F)". Tested at the
  // `Sunsoft5bAudio` unit level, distinct from `test/nsf.mjs`'s end-to-end
  // NSF round-trip exercise of the same quirk.
  const host = new Sunsoft5bAudio();
  host.schedule([
    { at: 0, addr: 0xc000, value: REG.volA }, // select 8, D = 0: writes enabled
    { at: 0, addr: 0xe000, value: volReg(3) }, // lands
    { at: 10, addr: 0xc000, value: 0x10 | REG.volA }, // re-select 8, but D = 1: writes disabled
    { at: 10, addr: 0xe000, value: volReg(15) }, // must be dropped
    { at: 20, addr: 0xc000, value: REG.volA }, // re-select 8, D = 0 again: writes resume
    { at: 20, addr: 0xe000, value: volReg(15) }, // lands
  ]);
  host.trace(11, () => {});
  check('a nonzero D nibble on $C000 latches, dropping the following $E000 write', host.ay.regs[REG.volA] === volReg(3));
  host.trace(10, () => {});
  check('a later $C000 write with D clear re-enables $E000, and the next write lands', host.ay.regs[REG.volA] === volReg(15));
}

{
  // Any address outside the two 8KB-mirrored pages ($C000-$DFFF,
  // $E000-$FFFF) is not decoded at all - a no-op, not a crash.
  const host = new Sunsoft5bAudio();
  host.write(0x4015, 0xff);
  host.write(0x8000, 0xff);
  check('an address outside the 5B\'s two sound ports does nothing', host.ay.regs.every((r) => r === 0));
}

// -------------------------------------------------- the combined chip

check('NES_SUNSOFT5B lists the 2A03\'s five voices plus the 5B\'s three', NES_SUNSOFT5B.voices.length === 8 && NES_SUNSOFT5B_VOICES.length === 8);
check('the id is not in the studio\'s CHIP_IDS: no picker/arranger reach yet (decision 38)', !CHIP_IDS.includes('2a03-sunsoft5b'));
check('the registry knows the chip', getChip('2a03-sunsoft5b') === nesSunsoft5bChip && chipFor('2a03-sunsoft5b') === nesSunsoft5bChip);
check('chips() includes it', chips().some((s) => s.id === '2a03-sunsoft5b'));

check('isSunsoft5bAddr recognises both sound ports and nothing outside them', [0xc000, 0xd000, 0xdfff, 0xe000, 0xf000, 0xffff].every(isSunsoft5bAddr)
  && ![0x4000, 0x8000, 0xbfff, 0x4015].some(isSunsoft5bAddr));

{
  const digital = new Sunsoft5bNesDigital();
  const events = [];
  for (let v = 0; v < 3; v++) events.push({ at: 0, addr: 0x4015, value: 0x0f });
  events.push({ at: 0, addr: 0x4000, value: 0x3f }, { at: 0, addr: 0x4002, value: 0x00 }, { at: 0, addr: 0x4003, value: 0x80 });
  events.push({ at: 0, addr: 0xc000, value: REG.mixer }, { at: 0, addr: 0xe000, value: mixer({ toneA: true }) });
  events.push({ at: 0, addr: 0xc000, value: REG.toneALo }, { at: 0, addr: 0xe000, value: 8 });
  events.push({ at: 0, addr: 0xc000, value: REG.volA }, { at: 0, addr: 0xe000, value: volReg(15) });
  digital.schedule(events);
  const seen = new Set();
  digital.trace(200, (cycle, voice) => seen.add(voice));
  check('the combined digital chip reports changes on both the 2A03 side (0-4) and the 5B side (5-7)', [...seen].some((v) => v < 5) && [...seen].some((v) => v >= 5), [...seen].sort((a, b) => a - b).join(','));
}

{
  // The 5B's DAC is logarithmic, 1.5dB per step - a constant ratio between
  // consecutive non-silent indices, not the linear "raw unit" scale VRC6's
  // DAC uses.
  const ratio = SUNSOFT5B_DAC[31] / SUNSOFT5B_DAC[30];
  const expected = 10 ** (1.5 / 20);
  check('SUNSOFT5B_DAC steps by exactly 1.5dB (in amplitude) between consecutive indices', Math.abs(ratio - expected) < 1e-12, `${ratio} vs ${expected}`);
  check('SUNSOFT5B_DAC index 31 is normalized to peak amplitude 1', SUNSOFT5B_DAC[31] === 1);
  check('envelope levels 0 and 1 are both silent (nesdev)', SUNSOFT5B_DAC[0] === 0 && SUNSOFT5B_DAC[1] === 0);
}

{
  // Sanity: the combined mix stage never inverts the 5B side the way VRC6's
  // is documented to (nesdev states no such inversion for the 5B). Read
  // `stage.sum` directly (a plain field once compiled, `private` being
  // TypeScript-only) rather than through `end()`, whose high-pass stage
  // would otherwise decay a constant level toward 0 on the very first call
  // (`lastIn1` primes to the first sample itself) and hide the sign being
  // checked here - the same technique and the same reasoning
  // `test/vrc6.mjs`'s own maximum-volume sign test uses.
  const sampleRate = 44100;
  const stage = new Sunsoft5bMixStage(sampleRate, [90, 440], 14000, 2.9);
  stage.begin();
  stage.add(0, 0, 0, 0, 0, 31, 31, 31); // all three 5B channels at max, 2A03 silent
  const preFilterSum = stage.sum;
  check('a 5B-only sample at maximum level pulls the mix in the positive direction, not inverted (nesdev states no inversion for the 5B, unlike VRC6)', preFilterSum > 0, preFilterSum);
  const v = stage.end(1);
  check('the filtered, gain-applied sample stays finite and in range', Number.isFinite(v) && v >= -1 && v <= 1, v);
  check('SUNSOFT5B_MIX_UNIT_GAIN is a positive, finite placeholder gain (see sunsoft5b-core.ts\'s own doc comment)', Number.isFinite(SUNSOFT5B_MIX_UNIT_GAIN) && SUNSOFT5B_MIX_UNIT_GAIN > 0);
}

{
  const core = new Sunsoft5bNesCore(44100);
  core.schedule([
    { at: 0, addr: 0x4015, value: 0x0f },
    { at: 0, addr: 0x4000, value: 0x3f },
    { at: 0, addr: 0x4002, value: 0x00 },
    { at: 0, addr: 0x4003, value: 0x40 },
    { at: 0, addr: 0xc000, value: REG.mixer },
    { at: 0, addr: 0xe000, value: mixer({ toneA: true }) },
    { at: 0, addr: 0xc000, value: REG.toneALo },
    { at: 0, addr: 0xe000, value: 8 },
    { at: 0, addr: 0xc000, value: REG.volA },
    { at: 0, addr: 0xe000, value: volReg(15) },
  ]);
  const left = new Float32Array(4410);
  core.render(left, null, 0);
  let finite = true, nonZero = false, inRange = true;
  for (const s of left) {
    if (!Number.isFinite(s)) finite = false;
    if (s !== 0) nonZero = true;
    if (s < -1 || s > 1) inRange = false;
  }
  check('Sunsoft5bNesCore renders finite, bounded, non-silent audio with both sides driven', finite && nonZero && inRange);
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
