import { recordSong, toVgm } from '../dist/index.js';

/**
 * The VGM file, read back the way a player reads it.
 *
 * A file is worth nothing until something else opens it, so this parses what
 * `toVgm` wrote with the format's own rules - the header offsets, the wait
 * commands, the GD3 tag - and checks that the writes come back on the
 * samples they were rounded to, in order, with the right bytes.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};

const CPU_HZ = 1789773;
const SONG = {
  id: 'vgm', bpm: 152, order: [0], gain: 1,
  patterns: [{
    bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
    lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc: 'K . H . S . H . K . H K S . H .',
  }],
  lead: { duty: 1, volume: [15, 14, 13], sustain: true },
  chord: { duty: 0, volume: [9, 8, 7], sustain: true },
  bass: { volume: [15], sustain: true },
};

const { events, cycles } = recordSong(SONG, { seconds: 2 });
check('recordSong records a song\'s writes', events.length > 100 && cycles === 2 * CPU_HZ, `${events.length} writes over ${cycles} cycles`);
check('and the first one enables the voices', events[0].at === 0 && events[0].addr === 0x4015 && events[0].value === 0x0f);

const file = toVgm(events, cycles, { title: 'vgm test', author: 'the test', loopAtCycle: CPU_HZ });
const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
const ascii = (at, n) => String.fromCharCode(...file.subarray(at, at + n));

check('the file starts with the magic', ascii(0, 4) === 'Vgm ');
check('and says its length', view.getUint32(4, true) === file.length - 4);
check('version 1.61, which added the NES APU', view.getUint32(8, true) === 0x161);
check('the NES APU clock is in the header', view.getUint32(0x84, true) === CPU_HZ);
const total = view.getUint32(0x18, true);
check('total samples is two seconds at 44100', total === 88200, `${total}`);
check('the loop points one second in', view.getUint32(0x20, true) === 44100, `${view.getUint32(0x20, true)} loop samples`);

// Walk the commands the way a player does.
let at = 0x34 + view.getUint32(0x34, true);
const dataStart = at;
const loopOffset = 0x1c + view.getUint32(0x1c, true);
let sample = 0;
let loopSample = -1;
const writes = [];
let ended = false;
while (at < file.length && !ended) {
  if (at === loopOffset) loopSample = sample;
  const op = file[at];
  if (op === 0xb4) {
    writes.push({ at: sample, addr: 0x4000 + file[at + 1], value: file[at + 2] });
    at += 3;
  } else if (op === 0x61) {
    sample += file[at + 1] | (file[at + 2] << 8);
    at += 3;
  } else if (op === 0x62) { sample += 735; at += 1; }
  else if (op === 0x63) { sample += 882; at += 1; }
  else if (op >= 0x70 && op <= 0x7f) { sample += op - 0x70 + 1; at += 1; }
  else if (op === 0x66) { ended = true; at += 1; }
  else { check(`unknown command $${op.toString(16)} at ${at}`, false); break; }
}
check('the data ends with the end command', ended);
check('the waits add up to the total', sample === total, `${sample}`);
check('the loop lands on one second', loopSample === 44100, `${loopSample}`);
check('every write came back', writes.length === events.length, `${writes.length} of ${events.length}`);
const rounded = events.map((e) => ({ at: Math.round((e.at * 44100) / CPU_HZ), addr: e.addr, value: e.value }));
const same = writes.every((w, i) => w.at === rounded[i].at && w.addr === rounded[i].addr && w.value === rounded[i].value);
check('on the sample each cycle rounds to, in order, with its bytes', same);

// The tag.
const gd3At = 0x14 + view.getUint32(0x14, true);
check('a GD3 tag follows the data', ascii(gd3At, 4) === 'Gd3 ' && gd3At === at);
const text = [];
let p = gd3At + 12;
let current = '';
while (p < file.length) {
  const c = view.getUint16(p, true);
  p += 2;
  if (c === 0) { text.push(current); current = ''; } else current += String.fromCharCode(c);
}
check('with the title, the system and the author', text[0] === 'vgm test' && text[4] === 'Nintendo Entertainment System' && text[6] === 'the test', JSON.stringify(text.slice(0, 7)));
check('and chipvoice as the converter', text[9] === 'chipvoice');
void dataStart;

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
