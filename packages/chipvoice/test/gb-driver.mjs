import { OfflineDriver, gbChip, recordSong, renderSong, toVgm, validateSong } from '../dist/index.js';

/**
 * The Game Boy's driver, as a program on the hardware would have written it.
 *
 * The same instrument tables as the 2A03's, in the DMG's idiom: a volume
 * change retriggers a pulse, the bass is on the wave channel with its RAM
 * loaded while the channel is off, the noise's volume table becomes the
 * hardware envelope, silence keeps the DACs on. And the whole path: the same
 * song records, renders and exports on both chips.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const hex = (n) => '$' + n.toString(16).toUpperCase().padStart(2, '0');

function recorder() {
  const writes = [];
  const core = { schedule: (events) => writes.push(...events), load() {}, render() {}, setGain() {}, reset() {} };
  const driver = new OfflineDriver(core, gbChip);
  return { driver, writes, flush: () => driver.flush() };
}
const at = (writes, cycle) => writes.filter((w) => w.at === cycle);
const bytes = (ws) => ws.map((w) => `${w.addr.toString(16)}=${hex(w.value)}`).join(' ');
const CLOCK = 4194304;

// ---- power-on, and a pulse note

{
  const { driver, writes, flush } = recorder();
  driver.playNote('ch1', { note: 'A4', instrument: { duty: 1, volume: [15] }, duration: 0.05, at: 1 });
  flush();
  check('the first writes power the chip and open both sides at full volume', bytes(at(writes, 0)) === 'ff26=$80 ff24=$77 ff25=$FF', bytes(at(writes, 0)));
  // A4 at 440 Hz: 2048 - 4194304 / (32 * 440) = 1750, $6D6.
  const frame0 = at(writes, CLOCK);
  check('a pulse note writes no sweep, the duty, the envelope, the period, then the trigger', bytes(frame0) === 'ff10=$00 ff11=$40 ff12=$F0 ff13=$D6 ff14=$86', bytes(frame0));
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('ch2', { note: 'C5', instrument: { duty: 2, volume: [15, 12], sustain: true }, duration: 0.5, at: 0 });
  flush();
  const frame1 = at(writes, Math.round(CLOCK / 60));
  check('a volume change on a pulse rewrites the envelope and retriggers', bytes(frame1) === 'ff17=$C0 ff19=$87', bytes(frame1));
  const later = writes.filter((w) => w.at > CLOCK / 60 + 1 && w.at < CLOCK / 2);
  check('and a held note costs nothing after that', later.length === 0, `${later.length} later writes`);
  const off = writes.filter((w) => w.at >= CLOCK / 2);
  check('silence is volume 0 with the DAC on, and a trigger', bytes(off) === 'ff17=$08 ff19=$80', bytes(off));
}

// ---- the wave channel

{
  const { driver, writes, flush } = recorder();
  driver.playNote('ch3', { note: 'A2', instrument: { volume: [15], sustain: true }, duration: 0.1, at: 0 });
  flush();
  const frame0 = at(writes, 0).filter((w) => (w.addr >= 0xff1a && w.addr <= 0xff1e) || w.addr >= 0xff30);
  check('a wave note loads a triangle into RAM with the channel off, then plays it at full level', frame0.length === 22 && frame0[0].addr === 0xff1a && frame0[0].value === 0 && frame0[1].addr === 0xff30 && frame0[1].value === 0x01 && frame0[16].value === 0x10 && bytes(frame0.slice(17)) === 'ff1a=$80 ff1b=$00 ff1c=$20 ff1d=$AC ff1e=$85', bytes(frame0.slice(17)));
  driver.playNote('ch3', { note: 'A2', instrument: { volume: [7], sustain: true }, duration: 0.1, at: 1 });
  flush();
  const second = at(writes, CLOCK);
  check('the next note keeps the RAM and plays at half level', bytes(second) === 'ff1a=$80 ff1b=$00 ff1c=$40 ff1d=$AC ff1e=$85', bytes(second));
}

{
  const { driver, writes, flush } = recorder();
  const saw = Array.from({ length: 32 }, (_, i) => i >> 1);
  driver.playNote('ch3', { note: 'A2', instrument: { volume: [15], wave: saw }, duration: 0.05, at: 0 });
  flush();
  const ram = at(writes, 0).filter((w) => w.addr >= 0xff30);
  check('an instrument with a waveform loads it, two samples a byte', ram.length === 16 && ram[0].value === 0x00 && ram[1].value === 0x11 && ram[15].value === 0xff);
}

// ---- the noise

{
  const { driver, writes, flush } = recorder();
  driver.playNote('ch4', { note: 9, instrument: { volume: [12, 10, 7, 4, 2, 1] }, duration: 0.1, at: 0 });
  flush();
  const frame0 = at(writes, 0).filter((w) => w.addr >= 0xff20 && w.addr <= 0xff23);
  // 12 down to 1 over five frames: 2.2 levels a frame, an envelope period of 1.
  check('a noise drum becomes the hardware envelope from its first volume', bytes(frame0) === 'ff20=$00 ff21=$C1 ff22=$35 ff23=$80', bytes(frame0));
  const later = writes.filter((w) => w.at > 0 && w.at < 400000);
  check('and writes nothing per frame after that', later.length === 0, `${later.length} later writes`);
  const off = writes.filter((w) => w.at >= 400000);
  check('and ends at volume 0 with a trigger', bytes(off) === 'ff21=$08 ff23=$80', bytes(off));
}

// ---- the whole path

const SONG = {
  id: 'gb', bpm: 150, order: [0], gain: 1,
  patterns: [{
    bass: 'A1 . A1 . C2 . C2 . D2 . D2 . E2 . E2 .',
    lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc: 'K . H . S . H . K . H K S . H .',
  }],
  lead: { duty: 1, volume: [15, 14, 13, 12, 11], sustain: true, vibrato: { depth: 0.18, rate: 8, delay: 6 } },
  chord: { duty: 0, volume: [9, 8, 7], sustain: true },
  bass: { volume: [15], sustain: true },
};

{
  const { events, cycles } = recordSong(SONG, { seconds: 2, chip: 'dmg' });
  check('a song records on the Game Boy as writes to $FF10-$FF3F', events.length > 50 && events.every((e) => e.addr >= 0xff10 && e.addr <= 0xff3f), `${events.length} writes`);
  check('over cycles on the Game Boy clock', cycles === 2 * CLOCK, `${cycles}`);
  const voices = new Set(events.map((e) => (e.addr < 0xff24 ? Math.floor((e.addr - 0xff10) / 5) : -1)));
  check('and every voice is written', [0, 1, 2, 3].every((v) => voices.has(v)), [...voices].join());
  const vgm = toVgm(events, cycles, { chip: 'dmg', title: 'gb' });
  const view = new DataView(vgm.buffer);
  check('its VGM carries the DMG clock and 0xB3 writes', view.getUint32(0x80, true) === CLOCK && view.getUint32(0x84, true) === 0 && vgm[0xc0] === 0xb3, `${view.getUint32(0x80, true)}`);
}

{
  const result = renderSong(SONG, { seconds: 2, chip: 'dmg', stereo: true });
  let rms = 0;
  for (let i = 0; i < result.left.length; i++) rms += result.left[i] * result.left[i];
  rms = Math.sqrt(rms / result.left.length);
  check('the same song renders on the Game Boy, in stereo, and is not silent', result.right !== null && rms > 0.02 && result.peak < 1, `rms ${rms.toFixed(3)}, peak ${result.peak.toFixed(3)}`);
}

{
  const ok = validateSong({ ...SONG, chip: 'dmg' });
  check('the validator takes a Game Boy song', ok.ok, ok.issues.map((i) => i.message).join('; '));
  const bad = validateSong({ ...SONG, chip: 'sid' });
  check('and names the chips it knows for one it does not', !bad.ok && /2a03, dmg/.test(bad.issues[0].message), bad.issues[0].message);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
