import { OfflineDriver, snesChip, renderSong, recordSong, arrange } from '../dist/index.js';

/**
 * `ChipCreateOptions.space`: the SNES's echo as a reachable, validated
 * choice, not a hidden constant. `driver()` builds the SPC700 program's own
 * register writes, so this checks those writes directly - the same way
 * `snes.mjs` checks the DSP itself against the formulas - plus the
 * resulting audio for the one thing a register comparison cannot show: that
 * "room" actually leaves something audible behind after a note releases,
 * and "dry" does not.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const CLOCK = 1024000;

function regs(writes) {
  const out = [];
  let selected = -1;
  for (const w of [...writes].sort((a, b) => a.at - b.at)) {
    if (w.addr === 0xf2) selected = w.value;
    else if (w.addr === 0xf3) out.push([selected, w.value]);
  }
  return out;
}
function powerOnRegs(options) {
  const writes = [];
  const core = { schedule: (events) => writes.push(...events), load() {}, render() {}, setGain() {}, reset() {} };
  const driver = new OfflineDriver(core, snesChip, () => 0, options);
  driver.flush();
  return regs(writes);
}
const finalValues = (writes) => Object.fromEntries(writes.map(([r, v]) => [r, v]));

{
  const bare = powerOnRegs(undefined);
  const by = finalValues(bare);
  check('no options is dry: EVOL, EFB and EON all end at zero', by[0x2c] === 0 && by[0x3c] === 0 && by[0x0d] === 0 && by[0x4d] === 0, JSON.stringify(by));
}
{
  const bare = JSON.stringify(powerOnRegs(undefined));
  check('{ space: "dry" } writes the identical register stream as no options at all', JSON.stringify(powerOnRegs({ space: 'dry' })) === bare);
  check('an unrecognised space name falls back to dry rather than throwing or guessing', JSON.stringify(powerOnRegs({ space: 'cathedral' })) === bare);
  check('a stray model option alongside space does not disturb the fallback', JSON.stringify(powerOnRegs({ model: 'nonsense', space: undefined })) === bare);
}
{
  const room = finalValues(powerOnRegs({ space: 'room' }));
  // Pitched voices (every bit but v3, the kit's percussion voice) only; 48 ms
  // delay fits the echo buffer below 64 KB at ESA $E0 (see driver.ts and
  // docs/chips/snes.md); feedback and return level are the measured choice
  // in docs/SNES-PALETTE.md, recorded as decision 53 in docs/DECISIONS.md.
  check('"room" enables echo on the pitched voices only, not the kit voice', room[0x4d] === 0xf7, `EON $${room[0x4d]?.toString(16)}`);
  check('"room" sets a nonzero return level and feedback', room[0x2c] > 0 && room[0x3c] > 0 && room[0x0d] > 0, JSON.stringify(room));
  check('"room" keeps the same 48 ms delay (EDL 3) the factory bank was measured against', room[0x7d] === 3, `EDL ${room[0x7d]}`);
}
{
  // EON must never turn on before the power-on echo buffer has had time to
  // wrap, in either space - the hazard the "dry" docs already describe.
  const writes = [];
  const core = { schedule: (events) => writes.push(...events), load() {}, render() {}, setGain() {}, reset() {} };
  const driver = new OfflineDriver(core, snesChip, () => 0, { space: 'room' });
  driver.flush();
  const beforeWrap = regs(writes.filter((w) => w.at < Math.round(0.2 * CLOCK)));
  check('EON stays off until the power-on buffer has wrapped, even in "room"', beforeWrap.every(([r, v]) => r !== 0x4d || v === 0), JSON.stringify(beforeWrap.filter(([r]) => r === 0x4d)));
}

function renderNote(space) {
  const core = snesChip.create(32000);
  const driver = new OfflineDriver(core, snesChip, () => 0, space ? { space } : {});
  core.setGain(0.78);
  // Starts after the power-on echo buffer has wrapped (250 ms) and releases
  // quickly, so anything still moving well after release is the echo tail,
  // not the note itself decaying.
  driver.playNote('v0', { note: 'C5', instrument: { sample: 'brass', volume: [15], sustain: true }, duration: 0.05, at: 0.35 });
  driver.flush();
  const left = new Float32Array(Math.round(1.2 * 32000));
  core.render(left, null, 0);
  return left;
}
const rms = (data, from, to) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (to - from));
};
{
  const dry = renderNote(undefined);
  const room = renderNote('room');
  // 0.5-0.7 s: well past the note's own release (it is inaudible by 0.42 s;
  // see snes.mjs's own release measurement) and past the 48 ms echo delay
  // from the note's last sound, so only an authored echo is still audible.
  const dryTail = rms(dry, 16000, 22400);
  const roomTail = rms(room, 16000, 22400);
  check('dry leaves no audible tail once the note has released', dryTail < 1e-6, `${dryTail}`);
  check('room leaves an audible echo tail long after the note has released', roomTail > 1e-4 && roomTail > dryTail * 1000, `dry ${dryTail} room ${roomTail}`);
}

{
  // The public render API takes the same option, and a caller who never
  // mentions it gets exactly the driver's own default.
  const song = arrange({ id: 's', bpm: 120, order: [0], gain: 1, patterns: [{ lead: 'C5 . . .', bass: '. . . .', chord: '. . . .', perc: '. . . .', chordShape: [[0, 4, 7]] }] }, 'snes');
  const bare = renderSong(song, { chip: 'snes', seconds: 0.3, stereo: true });
  const dryOption = renderSong(song, { chip: 'snes', space: 'dry', seconds: 0.3, stereo: true });
  check('renderSong with no space matches renderSong with space: "dry"', bare.left.every((v, i) => v === dryOption.left[i]));
  const roomOption = renderSong(song, { chip: 'snes', space: 'room', seconds: 0.3, stereo: true });
  check('renderSong with space: "room" renders something different from dry', !bare.left.every((v, i) => v === roomOption.left[i]));
  // A chip with no echo hardware ignores the option instead of failing.
  const other = arrange({ id: 's2', bpm: 120, order: [0], gain: 1, patterns: [{ lead: 'C5 . . .', bass: '. . . .', chord: '. . . .', perc: '. . . .' }] }, '2a03');
  const nes = renderSong(other, { chip: '2a03', space: 'room', seconds: 0.3 });
  check('a chip with no echo hardware ignores an unrecognised space rather than throwing', nes.left.length > 0);
  // recordSong takes the same option and produces a different register stream for room.
  const dryRecord = recordSong(song, { chip: 'snes', seconds: 0.3 });
  const roomRecord = recordSong(song, { chip: 'snes', space: 'room', seconds: 0.3 });
  check('recordSong threads space through to the driver too', JSON.stringify(dryRecord.events) !== JSON.stringify(roomRecord.events));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
