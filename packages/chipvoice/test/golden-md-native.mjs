import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { arrangeMdTracker, compileMdVoices, renderMdEvents, MD_BRIGHT_PROFILE } from '../dist/index.js';

/**
 * The native Mega Drive driver, locked: a tracker song on every voice (five
 * FM channels with pan, echo, bends, slides and falls, the DAC's drums, the
 * noise with the snare's wires, two PSG tones), its register writes and its
 * render hashed and compared with the hashes on file. A game ships audio
 * rendered from these writes; a change here changes its files. The file is
 * written on the first run.
 */
const FILE = new URL('./golden-md-native.json', import.meta.url);

const SONG = {
  bpm: 160, order: ['A', 'B'], loop: 'A',
  channels: {
    lead: { voice: 'fm1', pan: 'C', patch: 'lead', vibrato: {}, volume: 0.52 },
    echo: { voice: 'fm2', pan: 'R', patch: 'lead', vibrato: {}, echo: { of: 'lead', delay: 3, volume: 0.3 } },
    bass: { voice: 'fm3', patch: 'bass', volume: 0.7 },
    gtr: { voice: 'fm4', pan: 'L', patch: 'mute', volume: 0.63 },
    gtr2: { voice: 'fm5', pan: 'R', patch: 'mute', volume: 0.63, transpose: 0.08 },
    drums: { voice: 'dac' },
    hats: { voice: 'noise', volume: 0.9, snareWires: true },
    arp: { voice: 'psg1', patch: 'arp', volume: 0.16 },
    psg: { voice: 'psg2', patch: 'pluck', volume: 0.2 },
  },
  sections: {
    A: {
      bars: 1,
      lead: "^E5:3 G5:3 B5:4 A5:2 G5:2 F#5:2",
      bass: 'E2:1 E2 E3 E2 E2 E2 E3 E2 E2 E2 E3 E2 E2 E3 E2 E3',
      gtr: '@crunch E3:3 E3:3 E3:2 @mute E3:1 E3 E3:2 E3:1 E3 E3:2',
      gtr2: '@crunch E3:3 E3:3 E3:2 @mute E3:1 E3 E3:2 E3:1 E3 E3:2',
      drums: 'k.k.s..kk.k.S...',
      hats: 'h.h.h.h.h.h.h.hH',
      arp: 'E5:1 G5 B5 G5 E5 G5 B5 G5 E5 G5 B5 G5 E5 G5 B5 G5',
    },
    B: {
      bars: 1,
      lead: "~A5:4 B5:4' C6:8>",
      echo: '@twin %75 C5:8 E5:8',
      bass: 'C2:2 C3 C2 C3 D2 D3 D2 D3',
      gtr: '@crunch C3:16',
      gtr2: '@crunch C3:16',
      drums: 'x...s...xhml....',
      hats: 'o.......c.......',
      psg: 'E6:4 D6:4 C6:8',
    },
  },
};

const a = arrangeMdTracker(SONG, { tailBars: 1 });
const { events, lateCycles } = compileMdVoices(a.voices);
const ev = createHash('sha256');
const b = Buffer.alloc(12);
for (const e of events) { b.writeDoubleLE(e.at, 0); b.writeUInt32LE(e.addr, 8); ev.update(b); ev.update(Uint8Array.of(e.value)); }
const r = renderMdEvents(events, { seconds: a.totalSeconds, profile: MD_BRIGHT_PROFILE, gain: 0.9 });
const pcm = createHash('sha256');
pcm.update(Buffer.from(r.left.buffer));
pcm.update(Buffer.from(r.right.buffer));
const current = { events: events.length, lateCycles, eventsSha256: ev.digest('hex'), renderSha256: pcm.digest('hex'), peak: Number(r.peak.toFixed(4)) };

if (process.argv.includes('--update') || !existsSync(FILE)) {
  writeFileSync(FILE, JSON.stringify(current, null, 2) + '\n');
  console.log(`golden-md-native.json written: ${current.events} events ${current.eventsSha256.slice(0, 16)}, render ${current.renderSha256.slice(0, 16)}  peak ${current.peak}`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(FILE, 'utf8'));
const okEvents = expected.eventsSha256 === current.eventsSha256 && expected.events === current.events && expected.lateCycles === current.lateCycles;
const okRender = expected.renderSha256 === current.renderSha256;
console.log(`${okEvents ? 'PASS' : 'FAIL'}  the native driver writes byte for byte what it did  ${current.events} events ${current.eventsSha256.slice(0, 16)}${okEvents ? '' : `, expected ${expected.events} ${expected.eventsSha256.slice(0, 16)}`}`);
console.log(`${okRender ? 'PASS' : 'FAIL'}  and renders byte for byte what it did  ${current.renderSha256.slice(0, 16)}${okRender ? '' : `, expected ${expected.renderSha256.slice(0, 16)}`}  peak ${current.peak} (was ${expected.peak})`);
if (!okEvents || !okRender) console.log('If this was meant, run with --update and say in the commit what moved and why.');
process.exit(okEvents && okRender ? 0 : 1);
