import { OfflineDriver, snesChip, recordSong, renderSong, validateSong, arrange } from '../dist/index.js';

/**
 * The SNES's driver, as an SPC700 program would have written it: the bank
 * of samples into RAM first, then a note as a source, a pitch, two volumes
 * and a key-on; a volume table as the voice's volumes, frame by frame; a
 * note off as the voice's own GAIN, since KOFF is shared. And the whole
 * path on the fourth chip.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

function recorder() {
  const writes = [];
  const loaded = [];
  const core = { schedule: (events) => writes.push(...events), load: (a, b) => loaded.push({ address: a, bytes: b }), render() {}, setGain() {}, reset() {} };
  const driver = new OfflineDriver(core, snesChip);
  return { driver, writes, loaded, flush: () => driver.flush() };
}
const CLOCK = 1024000;

/** DSP register writes as [register, value], in time order. */
function regs(writes) {
  const out = [];
  let selected = -1;
  for (const w of [...writes].sort((a, b) => a.at - b.at)) {
    if (w.addr === 0xf2) selected = w.value;
    else if (w.addr === 0xf3) out.push([selected, w.value]);
  }
  return out;
}

{
  const { driver, writes, loaded, flush } = recorder();
  driver.playNote('v0', { note: 'A4', instrument: { volume: [15] }, duration: 0.05, at: 1 });
  flush();
  check('power-on loads the bank into RAM, directory first', loaded.length === 1 && loaded[0].address === 0x0200 && loaded[0].bytes.length > 4000, `${loaded[0]?.bytes.length} bytes at ${loaded[0]?.address.toString(16)}`);
  const power = regs(writes.filter((w) => w.at < 100000));
  const by = Object.fromEntries(power.map(([r, v]) => [r, v]));
  check('and sets the directory, the volumes, the echo and every voice\'s envelope, with echo writes off and every voice released first', power[1][0] === 0x5c && power[1][1] === 0xff && by[0x5c] === 0x00 && by[0x6c] === 0x20 && by[0x5d] === 0x02 && by[0x0c] === 0x60 && by[0x7d] === 3 && by[0x4d] === 0xf7 && by[0x05] === 0xff && by[0x75] === 0xff, JSON.stringify(by));
  const enable = regs(writes.filter((w) => w.at >= 200000 && w.at < CLOCK));
  check('and turns echo writes on a quarter second later, once the power-on buffer has wrapped', JSON.stringify(enable) === JSON.stringify([[0x2c,0x1c],[0x3c,0x1c],[0x6c,0]]), JSON.stringify(enable));
  const note = regs(writes.filter((w) => w.at >= CLOCK && w.at < CLOCK + CLOCK / 60));
  // A4 on the 32-sample triangle: pitch = 440 * 4096 / 1000 = 1802 = $70A.
  check('a note sets the source, the envelope, the pitch, the volumes, then keys on', note.map((p) => p[0]).join(',') === '4,5,6,2,3,0,1,76' && note[3][1] === 0x0a && note[4][1] === 0x07 && note[5][1] === 31 && note[7][1] === 0x01, note.map((p) => `${p[0].toString(16)}=${p[1].toString(16)}`).join(' '));
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('v1', { note: 'C5', instrument: { volume: [15, 8], sustain: true }, duration: 0.5, at: 0 });
  flush();
  const frame1 = regs(writes.filter((w) => w.at >= CLOCK / 60 && w.at < CLOCK / 30));
  check('a volume change writes the voice\'s two volumes and nothing else', frame1.length === 2 && frame1[0][0] === 0x10 && frame1[1][0] === 0x11 && frame1[0][1] === Math.round((8 * 31) / 15), JSON.stringify(frame1));
  // Up to the quarter second where power-on turns the echo writes on.
  const later = writes.filter((w) => w.at >= CLOCK / 30 && w.at < CLOCK / 5);
  check('and a held note costs nothing after that', later.length === 0, `${later.length}`);
  const off = regs(writes.filter((w) => w.at >= CLOCK / 2));
  check('a note ends by switching the voice to a fast GAIN decrease', off.length === 2 && off[0][0] === 0x17 && off[0][1] === 0xbf && off[1][0] === 0x15 && off[1][1] === 0x7f, JSON.stringify(off));
}

{
  const { driver, writes, flush } = recorder();
  driver.playNote('v3', { note: 9, instrument: { volume: [14, 10, 6], sample: 'snare' }, duration: 0.1, at: 0 });
  flush();
  const note = regs(writes.filter((w) => w.at >= 1000 && w.at < CLOCK / 60));
  check('a drum is its sample at pitch $1000', note[0][0] === 0x34 && note[0][1] === 8 && note[3][1] === 0x00 && note[4][1] === 0x10, note.map((p) => `${p[0].toString(16)}=${p[1].toString(16)}`).join(' '));
}

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
  const song = arrange(SCORE, 'snes');
  check('the arranger names samples for every role', song.lead.sample === 'flute' && song.bass.sample === 'picked-bass' && song.chord.sample === 'harp' && song.perc.K.instrument.sample === 'kick');
  const { events, cycles, memory } = recordSong(song, { seconds: 2, chip: 'snes' });
  check('a song records as writes to $F2 and $F3 with the bank in memory', events.length > 100 && events.every((e) => e.addr === 0xf2 || e.addr === 0xf3) && memory.length === 1, `${events.length} writes, ${memory.length} blocks`);
  check('over cycles on the SPC700 clock', cycles === 2 * CLOCK);
}

{
  const result = renderSong(arrange(SCORE, 'snes'), { seconds: 2, chip: 'snes', stereo: true });
  let rms = 0;
  for (let i = 0; i < result.left.length; i++) rms += result.left[i] * result.left[i];
  rms = Math.sqrt(rms / result.left.length);
  check('the same song renders on the SNES, in stereo, and is not silent', result.right !== null && rms > 0.02 && result.peak < 1, `rms ${rms.toFixed(3)}, peak ${result.peak.toFixed(3)}`);
}

{
  const ok = validateSong({ ...SCORE, chip: 'snes', intent: { bass: 'hollow' } });
  check('the validator takes a SNES song', ok.ok, ok.issues.map((i) => i.message).join('; '));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
