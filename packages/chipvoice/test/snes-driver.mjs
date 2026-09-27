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
  // FLG's low bits are the noise clock ($1f, fastest): set in this very first write, alongside
  // the echo-write-disable bit (0x20), since a note can start at the song's own time zero.
  check('and sets the directory, the volumes, the echo and every voice\'s envelope, with echo writes off, the noise clock set and every voice released first', power[1][0] === 0x5c && power[1][1] === 0xff && by[0x5c] === 0x00 && by[0x6c] === 0x3f && by[0x5d] === 0x02 && by[0x0c] === 0x60 && by[0x7d] === 3 && by[0x4d] === 0 && by[0x05] === 0xff && by[0x75] === 0xff, JSON.stringify(by));
  const enable = regs(writes.filter((w) => w.at >= 200000 && w.at < CLOCK));
  check('and turns echo writes on a quarter second later, once the power-on buffer has wrapped, repeating the same noise clock', JSON.stringify(enable) === JSON.stringify([[0x2c,0],[0x3c,0],[0x6c,0x1f]]), JSON.stringify(enable));
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
  check('and NON stays off for a BRR drum', note.some(([r, v]) => r === 0x3d && v === 0), note.map((p) => `${p[0].toString(16)}=${p[1].toString(16)}`).join(' '));
}

{
  // A hat with the kit's default noiseMode routes voice 3 to the DSP's own noise: NON gets that
  // voice's bit, and the source is the bank's "noise" carrier, not the "hat" BRR sample.
  const { driver, writes, flush } = recorder();
  driver.playNote('v3', { note: 13, instrument: { volume: [10, 7, 4], sample: 'hat', noiseMode: true }, duration: 0.05, at: 0 });
  flush();
  const note = regs(writes.filter((w) => w.at >= 1000 && w.at < CLOCK / 60));
  const by = Object.fromEntries(note);
  check('a hat with noiseMode routes its voice to NON and the noise sample', by[0x34] === 11 && by[0x3d] === 0x08, note.map((p) => `${p[0].toString(16)}=${p[1].toString(16)}`).join(' '));
}

{
  // The same hat with noiseMode explicitly off keeps the BRR sample and NON clear: the escape
  // hatch back to a recorded burst for a caller who wants one.
  const { driver, writes, flush } = recorder();
  driver.playNote('v3', { note: 13, instrument: { volume: [10, 7, 4], sample: 'hat', noiseMode: false }, duration: 0.05, at: 0 });
  flush();
  const note = regs(writes.filter((w) => w.at >= 1000 && w.at < CLOCK / 60));
  const by = Object.fromEntries(note);
  check('a hat with noiseMode off keeps the BRR sample and leaves NON clear', by[0x34] === 9 && by[0x3d] === 0, note.map((p) => `${p[0].toString(16)}=${p[1].toString(16)}`).join(' '));
}

{
  // Two hats in the kit's own order: the noise-routed hat, then a BRR drum on the same voice.
  // NON must drop back to 0 at the drum's own key-on so it plays its decoded sample, not noise.
  const { driver, writes, flush } = recorder();
  driver.playNote('v3', { note: 13, instrument: { volume: [10, 7, 4], sample: 'hat', noiseMode: true }, duration: 0.05, at: 0 });
  driver.playNote('v3', { note: 6, instrument: { volume: [15, 12, 9], sample: 'kick' }, duration: 0.15, at: 0.1 });
  flush();
  const secondAt = 0.1 * CLOCK;
  const second = regs(writes.filter((w) => w.at >= secondAt + 1000 && w.at < secondAt + CLOCK / 60));
  const by = Object.fromEntries(second);
  check('a BRR drum after a noise hat on the same voice clears NON again', by[0x3d] === 0, second.map((p) => `${p[0].toString(16)}=${p[1].toString(16)}`).join(' '));
}

{
  // A hat at 100ms, well inside the 250ms power-on echo settling this driver
  // gates other things behind, has to sound like real noise from the start:
  // the DSP's own core, not the register-capturing stub, since this checks
  // rendered samples rather than register writes. `sustain: true` holds the
  // volume table's last frame instead of letting it fall to 0 after one
  // frame, so a silenced voice's own decaying output-stage filter cannot be
  // mistaken for noise. A frozen LFSR under a held envelope is a single step
  // the DC-blocking high-pass then decays smoothly and monotonically to
  // zero; real noise keeps flipping sign every few samples. Counting sign
  // changes in the sample-to-sample difference tells those apart where a
  // plain "how many distinct floats" count cannot, since a filter's smooth
  // decay visits a different float almost every sample too.
  const core = snesChip.create(44100);
  core.setGain(0.78);
  const driver = new OfflineDriver(core, snesChip);
  driver.playNote('v3', { note: 13, instrument: { volume: [10], sample: 'hat', noiseMode: true, sustain: true }, duration: 0.4, at: 0.1 });
  driver.flush();
  const left = new Float32Array(Math.round(0.6 * 44100));
  core.render(left, null, 0);
  const from = Math.round(0.15 * 44100);
  const to = Math.round(0.2 * 44100);
  let signChanges = 0;
  let last = left[from] - left[from - 1];
  for (let i = from + 1; i < to; i++) {
    const d = left[i] - left[i - 1];
    if ((d > 0) !== (last > 0)) signChanges++;
    last = d;
  }
  check('a hat played inside the power-on window still sounds like noise, not a frozen envelope step', signChanges > 100, `${signChanges} sign changes over ${to - from} samples`);
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
  check('and the kit defaults its hats to the DSP\'s own noise', song.perc.H.instrument.noiseMode === true && song.perc.O.instrument.noiseMode === true && song.perc.K.instrument.noiseMode === undefined);
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
