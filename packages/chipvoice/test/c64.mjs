import { c64Chip, RATE_COMPARE, ladderWeights, arrange, renderSong, recordSong } from '../dist/index.js';

/**
 * The C64's SID against the formulas.
 *
 * The harness compares the chip with reSID-fp cycle for cycle; this pins
 * the plain facts a datasheet states: the envelope's rate values, a pulse at
 * the frequency the register says, the noise's rate, the envelope's times,
 * sync and ring modulation doing something, the DAC ladders, and a score
 * that renders with the drums and the chord sharing a voice.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const CLOCK = 985248;
const V = (v) => 0xd400 + 7 * v;
const F = (hz) => Math.round((hz * 16777216) / CLOCK);

/** A chip with writes four cycles apart from `start`, traced for `cycles`. */
function run(script, cycles) {
  const chip = c64Chip.digital();
  const writes = [];
  let t = 100;
  const w = (addr, value) => { writes.push({ at: t, addr, value }); t += 4; };
  const at = (time) => { t = time; };
  script(w, at);
  chip.schedule(writes);
  const streams = [[], [], [], [], [], []];
  chip.trace(cycles, (cycle, voice, value) => streams[voice].push({ cycle, value }));
  return streams;
}

{
  const kevtris = [0x007f, 0x3000, 0x1e00, 0x0660, 0x0182, 0x5573, 0x000e, 0x3805, 0x2424, 0x2220, 0x090c, 0x0ecd, 0x010e, 0x23f7, 0x5237, 0x64a8];
  check('the rate register values derived from the periods are the sixteen kevtris read off the chip', RATE_COMPARE.every((v, i) => v === kevtris[i]), RATE_COMPARE.map((v) => v.toString(16)).join(' '));
}

{
  const f = F(440);
  const [osc1] = run((w) => { w(V(0) + 6, 0xf0); w(V(0), f & 0xff); w(V(0) + 1, f >> 8); w(V(0) + 3, 0x08); w(V(0) + 4, 0x41); }, CLOCK);
  const toggles = osc1.filter((c) => c.cycle > 100).length;
  check('a pulse at the register for 440 Hz toggles 880 times a second', Math.abs(toggles - 880) <= 2, `${toggles} toggles`);
  const [tri] = run((w) => { w(V(0) + 6, 0xf0); w(V(0), f & 0xff); w(V(0) + 1, f >> 8); w(V(0) + 4, 0x11); }, 20000);
  const [saw] = run((w) => { w(V(0) + 6, 0xf0); w(V(0), f & 0xff); w(V(0) + 1, f >> 8); w(V(0) + 4, 0x21); }, 20000);
  const triMax = Math.max(...tri.map((c) => c.value));
  const sawMax = Math.max(...saw.map((c) => c.value));
  check('a triangle reaches 0xffe and a sawtooth 0xfff', triMax === 0xffe && sawMax === 0xfff, `${triMax.toString(16)} ${sawMax.toString(16)}`);
}

{
  const f = 0x1000;
  const [osc1] = run((w) => { w(V(0) + 6, 0xf0); w(V(0), f & 0xff); w(V(0) + 1, f >> 8); w(V(0) + 4, 0x81); }, 200000);
  // The register shifts when bit 19 of the accumulator rises: every 2^20 / F
  // cycles. A shift that leaves the eight tapped bits as they were is no
  // change, so the changes are counted in multiples of the shift period.
  const changes = osc1.filter((c) => c.cycle > 200).map((c) => c.cycle);
  let shifts = 0;
  for (let i = 1; i < changes.length; i++) shifts += Math.round((changes[i] - changes[i - 1]) / (1048576 / f));
  const expected = (200000 - changes[0]) / (1048576 / f);
  check('the noise shifts at sixteen times the frequency the register would give a tone', Math.abs(shifts - expected) < expected * 0.02, `${shifts} shifts in ${changes.length} changes, ${expected.toFixed(0)} expected`);
}

{
  const f = F(440);
  const streams = run((w, at) => {
    w(V(0) + 5, 0x00); w(V(0) + 6, 0x80); w(V(0), f & 0xff); w(V(0) + 1, f >> 8); w(V(0) + 4, 0x41);
    at(50000); w(V(0) + 6, 0xf0); w(V(0) + 4, 0x40); w(V(0) + 4, 0x41);
    at(100000); w(V(0) + 4, 0x40);
  }, 200000);
  const env = streams[3];
  const full = env.find((c) => c.cycle > 100 && c.value === 0xff);
  const held = env.filter((c) => c.cycle > 20000 && c.cycle < 50000).map((c) => c.value);
  const fullAgain = env.find((c) => c.cycle > 50000 && c.value === 0xff);
  const zero = env.find((c) => c.cycle > 100000 && c.value === 0);
  check('the fastest attack reaches full scale in under 3 ms', full && full.cycle - 100 < 0.003 * CLOCK, full ? `${((full.cycle - 100) / CLOCK * 1000).toFixed(2)} ms` : 'never');
  check('sustain 8 holds at 0x88', held.length === 0 && env.filter((c) => c.cycle < 20000).at(-1)?.value === 0x88);
  check('the fastest release from full scale takes 6 to 8 ms', fullAgain && zero && zero.cycle - 100000 > 0.006 * CLOCK && zero.cycle - 100000 < 0.008 * CLOCK, zero ? `${((zero.cycle - 100000) / CLOCK * 1000).toFixed(2)} ms` : 'never');
}

{
  const f1 = F(440);
  const f2 = F(440 * 1.5);
  const plain = run((w) => { w(V(1) + 6, 0xf0); w(V(1), f2 & 0xff); w(V(1) + 1, f2 >> 8); w(V(1) + 4, 0x21); }, 100000)[1];
  const synced = run((w) => {
    w(V(0) + 6, 0xf0); w(V(0), f1 & 0xff); w(V(0) + 1, f1 >> 8); w(V(0) + 4, 0x11);
    w(V(1) + 6, 0xf0); w(V(1), f2 & 0xff); w(V(1) + 1, f2 >> 8); w(V(1) + 4, 0x23);
  }, 100000)[1];
  // A sawtooth's drops are its period: synced, they come at the source's period.
  const drops = (s) => s.filter((c, i) => i > 0 && c.value < s[i - 1].value - 0x800).map((c) => c.cycle);
  const period = (d) => (d.length > 2 ? (d[d.length - 1] - d[1]) / (d.length - 2) : 0);
  const plainPeriod = period(drops(plain));
  const syncedPeriod = period(drops(synced));
  check('a synced voice takes the period of its source', Math.abs(syncedPeriod - 16777216 / f1) < 2 && Math.abs(plainPeriod - 16777216 / f2) < 2, `${plainPeriod.toFixed(0)} then ${syncedPeriod.toFixed(0)} cycles`);
  const ring = run((w) => {
    w(V(0) + 6, 0xf0); w(V(0), f1 & 0xff); w(V(0) + 1, f1 >> 8); w(V(0) + 4, 0x11);
    w(V(1) + 6, 0xf0); w(V(1), f2 & 0xff); w(V(1) + 1, f2 >> 8); w(V(1) + 4, 0x15);
  }, 100000)[1];
  const tri = run((w) => { w(V(1) + 6, 0xf0); w(V(1), f2 & 0xff); w(V(1) + 1, f2 >> 8); w(V(1) + 4, 0x11); }, 100000)[1];
  const differs = ring.length !== tri.length || ring.some((c, i) => c.value !== tri[i].value || c.cycle !== tri[i].cycle);
  check('a ring-modulated triangle is not the plain one', differs);
}

{
  const ideal = ladderWeights(12, 2, true);
  const kinked = ladderWeights(12, 2.2, false);
  const powers = [...ideal].every((w, i) => Math.abs(w - 2 ** i) < 1e-9);
  const sum = [...kinked].reduce((a, b) => a + b, 0);
  const off = [...kinked].some((w, i) => Math.abs(w - 2 ** i) > 0.01 * 2 ** i);
  check("a perfect ladder's weights are powers of two; the 6581's sum to the same full scale and are not", powers && Math.abs(sum - 4095) < 1e-6 && off, `6581 top bit ${kinked[11].toFixed(1)} of 2048`);
}

{
  const score = {
    id: 'test', bpm: 152, order: [0], gain: 1,
    patterns: [{ bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .', lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .', chord: 'A3 . . . . . . . . . . . . . . .', chordShape: [[0, 3, 7]], perc: 'K . H . S . H . K . H K S . H .' }],
  };
  const r = renderSong(arrange(score, 'c64'), { seconds: 2, chip: 'c64' });
  const { events } = recordSong(arrange(score, 'c64'), { seconds: 2, chip: 'c64' });
  const v3 = events.filter((e) => e.addr >= V(2) && e.addr <= V(2) + 6).sort((a, b) => a.at - b.at);
  // A gate on voice 3 is a drum's or the chord's: the kit's drums are the
  // triangle, the noise, or a pulse pitched far above the chord. Neither
  // may open while the other sounds.
  let hi = 0;
  let sounding = null;
  let overlap = false;
  let drums = 0;
  let chords = 0;
  for (const e of v3) {
    if (e.addr === V(2) + 1) hi = e.value;
    if (e.addr !== V(2) + 4) continue;
    if (!(e.value & 1)) {
      sounding = null;
      continue;
    }
    const drum = (e.value & 0x90) !== 0 || hi >= 0x40;
    const who = drum ? 'drum' : 'chord';
    if (sounding && sounding !== who) overlap = true;
    if (!sounding) {
      if (drum) drums++;
      else chords++;
    }
    sounding = who;
  }
  check('a score renders on the chip with the drums and the chord both on voice 3, never at once', r.peak > 0.2 && r.peak <= 1 && !overlap && drums > 0 && chords > 0, `peak ${r.peak.toFixed(2)}, ${drums} drum gates, ${chords} chord gates`);
}

if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
