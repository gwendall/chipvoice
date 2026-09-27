import { OfflineDriver, mdChip, recordSong, renderSong, toVgm, validateSong, arrange } from '../dist/index.js';

/**
 * The Mega Drive's driver, as a 68000 program would have written it: a patch
 * once per channel, the frequency as block and F-number, a key-on; volume
 * as the carriers' levels without a retrigger; the chord on the PSG; the
 * noise clocked by tone 3. And the whole path on the third chip.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

function recorder() {
  const writes = [];
  const core = { schedule: (events) => writes.push(...events), load() {}, render() {}, setGain() {}, reset() {} };
  const driver = new OfflineDriver(core, mdChip);
  return { driver, writes, flush: () => driver.flush() };
}
const YM = 0xa04000;
const PSG = 0xc00011;
const MASTER = 53693175;

/** Register pairs on a port: [address, data] as the chip sees them. */
function pairs(writes, port) {
  const out = [];
  let address = -1;
  for (const w of writes.filter((x) => (x.addr & 0xfffffe) === YM + port).sort((a, b) => a.at - b.at)) {
    if (w.addr & 1) out.push([address, w.value]);
    else address = w.value;
  }
  return out;
}

// ---- power-on and an FM note

{
  const { driver, writes, flush } = recorder();
  driver.playNote('fm1', { note: 'A4', instrument: { volume: [15] }, duration: 0.05, at: 1 });
  flush();
  const power = pairs(writes.filter((w) => w.at < 1000000), 0);
  check('power-on turns the LFO off, channel 3 normal, the DAC off and every key off', power[0][0] === 0x22 && power[1][0] === 0x27 && power[2][0] === 0x2b && power.filter((p) => p[0] === 0x28).length === 6, power.map((p) => p[0].toString(16)).join(' '));
  const psgOff = writes.filter((w) => w.addr === PSG && w.at < 1000000).map((w) => w.value.toString(16)).join(' ');
  check('and silences the PSG', psgOff === '9f bf df ff', psgOff);

  const all = pairs(writes.filter((w) => w.at >= MASTER), 0);
  // The first frame ends at the key-on; what follows is the next frames.
  const note = all.slice(0, all.findIndex((p) => p[0] === 0x28 && p[1] === 0xf0) + 1);
  const addresses = note.map((p) => p[0]);
  check('an FM note keys off, loads a patch, sets the carriers, the pitch, then keys on', addresses[0] === 0x28 && note[0][1] === 0 && addresses.filter((a) => (a & 0xf0) === 0x30).length === 4 && addresses.includes(0xb0) && addresses[addresses.length - 3] === 0xa4 && addresses[addresses.length - 2] === 0xa0 && addresses[addresses.length - 1] === 0x28 && note[note.length - 1][1] === 0xf0, addresses.map((a) => a.toString(16)).join(' '));
  // A4 at 440 Hz: F = 144 * 440 * 2^21 / 7670453 = 17326 at block 0, 1083 at block 4.
  const fnum = Math.round((144 * 440 * 2 ** 21) / 7670453 / 16);
  const a4 = note.find((p) => p[0] === 0xa4);
  const a0 = note.find((p) => p[0] === 0xa0);
  check(`at block 4, F-number ${fnum}`, fnum === 1083 && a4[1] === ((4 << 3) | (fnum >> 8)) && a0[1] === (fnum & 0xff), `${a4[1].toString(16)} ${a0[1].toString(16)}`);
  const gaps = writes.filter((w) => w.at >= MASTER && (w.addr & 1) === 0).map((w) => w.at).slice(0, 5);
  check('spaced a busy flag apart', gaps.every((t, i) => i === 0 || t - gaps[i - 1] === 42 * 32), gaps.map((t, i) => (i ? t - gaps[i - 1] : 0)).join());
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('fm1', { note: 'A4', instrument: { volume: [15, 8], sustain: true }, duration: 0.5, at: 0 });
  flush();
  const frame1 = pairs(writes.filter((w) => w.at >= MASTER / 60 && w.at < MASTER / 30), 0);
  check('a volume change writes the carriers\' levels and nothing else', frame1.length === 2 && frame1.every((p) => (p[0] & 0xf0) === 0x40), frame1.map((p) => `${p[0].toString(16)}=${p[1]}`).join(' '));
  const later = writes.filter((w) => w.at >= MASTER / 30 && w.at < MASTER / 2);
  check('and a held note costs nothing after that', later.length === 0, `${later.length}`);
  const off = pairs(writes.filter((w) => w.at >= MASTER / 2), 0);
  check('the note ends with a key-off', off.length === 1 && off[0][0] === 0x28 && off[0][1] === 0, JSON.stringify(off));
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('fm1', { note: 'A4', instrument: { volume: [15] }, duration: 0.05, at: 0 });
  driver.playNote('fm1', { note: 'C5', instrument: { volume: [15] }, duration: 0.05, at: 1 });
  flush();
  const second = pairs(writes.filter((w) => w.at >= MASTER), 0);
  check('a second note with the same patch does not reload it', !second.some((p) => (p[0] & 0xf0) === 0x30), second.map((p) => p[0].toString(16)).join(' '));
}

// ---- the PSG and the noise

{
  const { driver, writes, flush } = recorder();
  driver.playNote('psg1', { note: 'A4', instrument: { volume: [15, 12] }, duration: 0.05, at: 0 });
  flush();
  const bytes = writes.filter((w) => w.addr === PSG && w.at >= 100000).map((w) => w.value.toString(16));
  // N = 254 = $FE: latch $8E, data $0F; volume 0.
  check('a PSG note is a latch, a data byte and the attenuation', bytes.slice(0, 3).join(' ') === '8e f 90', bytes.join(' '));
  check('and a volume change is one byte', bytes[3] === '93', bytes[3]);
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('noise', { note: 9, instrument: { volume: [12] }, duration: 0.05, at: 0 });
  flush();
  const bytes = writes.filter((w) => w.addr === PSG && w.at >= 100000).map((w) => w.value.toString(16));
  check('the noise sets tone 3 to the rate, white noise from tone 3, then its volume', bytes[0].startsWith('c') && bytes[2] === 'e7' && bytes[3] === 'f3', bytes.join(' '));
}

// ---- FM drums on channel 6 (perc: "punchy"): the noise voice, redirected

const KICK_PATCH = {
  algorithm: 7, feedback: 0,
  ops: [
    { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 10, sr: 0, sl: 2, rr: 8 },
    { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 10, sr: 0, sl: 2, rr: 8 },
    { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 10, sr: 0, sl: 2, rr: 8 },
    { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 10, sr: 0, sl: 2, rr: 8 },
  ],
};
/** A YM2612 F-number/block pair, decoded back to a frequency, to check the redirect's pitch without depending on the driver's own rounding. */
function decodeFmFreq(hi, lo) {
  const block = hi >> 3;
  const fnum = ((hi & 7) << 8) | lo;
  return (fnum * 7670453) / (144 * Math.pow(2, 21 - block));
}

{
  const low = recorder();
  low.driver.playNote('noise', { note: 0, instrument: { volume: [14], fm: KICK_PATCH }, duration: 0.05, at: 0 });
  low.flush();
  const high = recorder();
  high.driver.playNote('noise', { note: 15, instrument: { volume: [14], fm: KICK_PATCH }, duration: 0.05, at: 0 });
  high.flush();

  const psg = low.writes.filter((w) => w.addr === PSG && w.at >= 100000);
  check('an FM drum hit writes nothing to the PSG', psg.length === 0, `${psg.length} PSG writes`);

  const keyedOn = (writes) => pairs(writes.filter((w) => w.at >= 100000), 0).some((p) => p[0] === 0x28 && p[1] === 0xf6);
  check('it keys channel 6 (key index 6), the same channel the FM kit always plays', keyedOn(low.writes) && keyedOn(high.writes));

  const freqOf = (writes) => {
    const ch6 = pairs(writes.filter((w) => w.at >= 100000), 2);
    return decodeFmFreq(ch6.find((p) => p[0] === 0xa6)[1], ch6.find((p) => p[0] === 0xa2)[1]);
  };
  const f0 = freqOf(low.writes);
  const f15 = freqOf(high.writes);
  // The kit's base MIDI note is 24 (C1, 32.70 Hz) and each step is 3 semitones: period 15 lands on 24 + 45 = 69, A4, 440 Hz exactly.
  check('period 0 is a real low pitch, about C1', Math.abs(f0 - 32.7032) < 0.1, `${f0.toFixed(2)} Hz`);
  check('period 15 is a real pitch four octaves and a bit up, A4 at 440 Hz, not a fixed placeholder', Math.abs(f15 - 440) < 0.5, `${f15.toFixed(2)} Hz`);
}

// ---- the LFO: $22, ams/pms in $B4, and an operator's own am in $60

const LFO_OPS = [
  { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 0, sr: 0, sl: 0, rr: 15 },
  { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 0, sr: 0, sl: 0, rr: 15 },
  { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 0, sr: 0, sl: 0, rr: 15 },
  { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 0, sr: 0, sl: 0, rr: 15 },
];
const lfoPatch = (freq) => ({ algorithm: 0, feedback: 0, ops: LFO_OPS, pms: 5, lfoFrequency: freq });
const PLAIN_PATCH = { algorithm: 0, feedback: 0, ops: LFO_OPS };

{
  const { driver, writes, flush } = recorder();
  driver.playNote('fm1', { note: 'A4', instrument: { volume: [15], fm: lfoPatch(5) }, duration: 0.05, at: 0 });
  flush();
  const on = pairs(writes.filter((w) => w.at >= 100000), 0).find((p) => p[0] === 0x22);
  check('a patch with a pitch sensitivity turns the LFO on, at its own rate', on && on[1] === (0x08 | 5), on && on[1].toString(16));
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('fm2', { note: 'A4', instrument: { volume: [15], fm: lfoPatch(5) }, duration: 0.05, at: 0 });
  driver.playNote('fm1', { note: 'A4', instrument: { volume: [15], fm: lfoPatch(1) }, duration: 0.05, at: 1 });
  driver.playNote('fm1', { note: 'A4', instrument: { volume: [15], fm: PLAIN_PATCH }, duration: 0.05, at: 2 });
  driver.playNote('fm2', { note: 'A4', instrument: { volume: [15], fm: PLAIN_PATCH }, duration: 0.05, at: 3 });
  flush();
  const lfoWrites = (from, to) => pairs(writes.filter((w) => w.at >= from && w.at < to), 0).filter((p) => p[0] === 0x22).map((p) => p[1]);
  check('one channel wanting it sets the chip-wide rate to its own', JSON.stringify(lfoWrites(100000, MASTER)) === JSON.stringify([0x08 | 5]), lfoWrites(100000, MASTER).join());
  check('a lower-numbered channel that also wants it takes the rate over: the LFO is one oscillator for the chip', JSON.stringify(lfoWrites(MASTER, 2 * MASTER)) === JSON.stringify([0x08 | 1]), lfoWrites(MASTER, 2 * MASTER).join());
  check('once it gives the LFO up, the still-loaded channel below it keeps it going', JSON.stringify(lfoWrites(2 * MASTER, 3 * MASTER)) === JSON.stringify([0x08 | 5]), lfoWrites(2 * MASTER, 3 * MASTER).join());
  check('and it turns off once nothing loaded asks for it', JSON.stringify(lfoWrites(3 * MASTER, 4 * MASTER)) === JSON.stringify([0]), lfoWrites(3 * MASTER, 4 * MASTER).join());
}

{
  const { driver, writes, flush } = recorder();
  const patch = { algorithm: 0, feedback: 0, ops: [{ ...LFO_OPS[0], am: true }, LFO_OPS[1], LFO_OPS[2], LFO_OPS[3]], ams: 3, lfoFrequency: 2 };
  driver.playNote('fm1', { note: 'A4', instrument: { volume: [15], fm: patch }, duration: 0.05, at: 1 });
  flush();
  const p0 = pairs(writes.filter((w) => w.at >= MASTER), 0);
  const op1 = p0.find((p) => p[0] === 0x60);
  check('an operator\'s own am sets bit 7 of $60', op1 && (op1[1] & 0x80) !== 0, op1 && op1[1].toString(16));
  const pan = p0.find((p) => p[0] === 0xb4);
  check('and ams is written into $B4 alongside pan', pan && ((pan[1] >> 4) & 3) === 3, pan && pan[1].toString(16));
}

// ---- the whole path

const SCORE = {
  bpm: 150, order: [0],
  patterns: [{
    bass: 'A1 . A1 . C2 . C2 . D2 . D2 . E2 . E2 .',
    lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc: 'K . H . S . H . K . H K S . H .',
  }],
};

{
  const song = arrange(SCORE, 'md');
  check('the arranger gives the lead and the bass FM patches and the chord none', song.lead.fm && song.bass.fm && !song.chord.fm);
  const { events, cycles } = recordSong(song, { seconds: 2, chip: 'md' });
  check('a song records as writes to the YM2612\'s ports and the PSG', events.length > 100 && events.every((e) => (e.addr & 0xfffffc) === YM || e.addr === PSG), `${events.length}`);
  check('over cycles on the master clock', cycles === 2 * MASTER);
  const vgm = toVgm(events, cycles, { chip: 'md', title: 'md' });
  const view = new DataView(vgm.buffer);
  const body = vgm.subarray(0xc0);
  check('its VGM carries both clocks and YM2612 and PSG commands', view.getUint32(0x2c, true) === 7670453 && view.getUint32(0x0c, true) === 3579545 && body.includes(0x52) && body.includes(0x50), `${view.getUint32(0x2c, true)}`);
}

{
  const result = renderSong(arrange(SCORE, 'md'), { seconds: 2, chip: 'md', stereo: true });
  let rms = 0;
  for (let i = 0; i < result.left.length; i++) rms += result.left[i] * result.left[i];
  rms = Math.sqrt(rms / result.left.length);
  check('the same song renders on the Mega Drive, in stereo, and is not silent', result.right !== null && rms > 0.02 && result.peak < 1, `rms ${rms.toFixed(3)}, peak ${result.peak.toFixed(3)}`);
}

{
  const ok = validateSong({ ...SCORE, chip: 'md', intent: { lead: 'bright' } });
  check('the validator takes a Mega Drive song', ok.ok, ok.issues.map((i) => i.message).join('; '));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
