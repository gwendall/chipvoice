import { chromium } from 'playwright';
import { renderSong } from '../dist/index.js';

/**
 * Offline and real time have to be the same chip.
 *
 * The engine now runs in two places: a worklet driven by the audio clock, and
 * Node driven by a counter. If they drift, everything downstream is a lie - a
 * shared MP3 is not what the person who made it heard, and the whole reason for
 * rendering on a server disappears.
 *
 * Comparing sample for sample is not the test to run: the browser starts its
 * context wherever it likes, so the two are offset by an unknown amount. What
 * must match is the character - loudness, how busy it is, where the energy
 * sits - and that is what this compares.
 */
const guard = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 120000);
guard.unref();

let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

const SONG = {
  id: 'parity', bpm: 152, order: [0], gain: 1,
  patterns: [{
    bass:  'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
    lead:  'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc:  'K . H . S . H . K . H K S . H .',
  }],
  lead: { duty: 1, volume: [15, 14, 13, 12, 11], sustain: true },
  chord: { duty: 0, volume: [9, 8, 7], sustain: true },
  bass: { volume: [15], sustain: true },
};

/**
 * RMS, peak, and crossings per sample: loudness, headroom, brightness.
 *
 * Per sample rather than per second on purpose. The browser capture reads the
 * analyser once a frame, and its windows overlap - so the captured stream is
 * longer than the time it covers, and anything measured against wall-clock
 * seconds comes out three times too high. A ratio does not care.
 */
function describe(samples) {
  let sumSquares = 0;
  let peak = 0;
  let crossings = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sumSquares += v * v;
    peak = Math.max(peak, Math.abs(v));
    if (i > 0 && (samples[i - 1] < 0) !== (v < 0)) crossings++;
  }
  return {
    rms: Math.round(Math.sqrt(sumSquares / samples.length) * 1000) / 1000,
    peak: Math.round(peak * 1000) / 1000,
    crossingRate: Math.round((crossings / samples.length) * 1000) / 1000,
  };
}

const offline = describe(renderSong(SONG, { seconds: 4, sampleRate: 44100 }).left);
console.log('offline ', JSON.stringify(offline));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:4181/test/parity/', { waitUntil: 'domcontentloaded' });
  await page.click('#go');
  const ok = await page
    .waitForFunction(() => window.captured, null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check('the browser captured the same song', ok, ok ? '' : 'no capture after 30s');
  if (!ok) throw new Error('stop');

  const live = describe(Float32Array.from(await page.evaluate(() => window.captured)));
  console.log('live    ', JSON.stringify(live));

  // Ten percent on loudness. The browser resamples if its context is not at
  // 44100, and its capture starts mid-note, so identity is not on offer -
  // but a chip that had drifted would be nowhere near this close.
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance * Math.max(a, b);
  check('the same loudness', near(offline.rms, live.rms, 0.15), `${offline.rms} vs ${live.rms}`);
  check('the same headroom', near(offline.peak, live.peak, 0.15), `${offline.peak} vs ${live.peak}`);
  check(
    'the same brightness',
    near(offline.crossingRate, live.crossingRate, 0.25),
    `${offline.crossingRate} vs ${live.crossingRate} crossings per sample`,
  );
} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
