import { chromium } from '/Users/gwendall/Code/redburner/node_modules/playwright/index.mjs';

/**
 * The playground has to make a sound, and firing has to take a channel away
 * from the music.
 *
 * That second one is the whole reason this library exists, and no assertion
 * about state can see it: a build whose arbiter never claims anything plays the
 * chord and the shot together, and looks perfect from the outside. So this
 * measures the output node the library exposes.
 */
const URL_ = process.env.URL || 'http://localhost:4173/';
const guard = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 90000);
guard.unref();

let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);

  await page.click('#play');
  const started = await page
    .waitForFunction(() => !!window.chipvoice, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('the chip starts', started, started ? '' : 'no chip after 15s');
  if (!started) throw new Error('nothing below would mean anything');

  // Tap the node the library hands out, which is what it exposes it for.
  await page.evaluate(() => {
    const chip = window.chipvoice;
    const node = chip.audioContext.createAnalyser();
    node.fftSize = 2048;
    chip.output.connect(node);
    const buf = new Float32Array(node.fftSize);
    window.__peak = () => {
      node.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      return peak;
    };
  });

  const sample = (ms) => page.evaluate(async (d) => {
    let peak = 0;
    const until = performance.now() + d;
    while (performance.now() < until) {
      await new Promise((r) => setTimeout(r, 20));
      peak = Math.max(peak, window.__peak());
    }
    return Math.round(peak * 1000) / 1000;
  }, ms);

  await page.waitForTimeout(600);
  const playing = await sample(900);
  check('and the song is audible', playing > 0.01, `peak ${playing}`);
  check('the sequencer reports it', await page.evaluate(() => window.chipvoice.playing));

  // --------------------------------------------------------- channel stealing
  //
  // The claim this library is built on. Fire repeatedly and read pulse 2's
  // availability: while an effect holds it, the music must not be able to.
  const stolen = await page.evaluate(async () => {
    const chip = window.chipvoice;
    const at = chip.currentTime;
    chip.sfx('p2', {
      note: 'B6',
      instrument: { duty: 0, volume: [13, 12, 10, 8, 5, 2], slide: -3.4 },
      duration: 0.2,
    });
    // Read the arbiter through the only door it has: the sequencer asks the
    // same question before every note it schedules.
    const during = chip.canPlay ? chip.canPlay('p2', at + 0.05) : null;
    const after = chip.canPlay ? chip.canPlay('p2', at + 0.4) : null;
    return { during, after };
  });
  check(
    'an effect takes pulse 2 from the music',
    stolen.during === false && stolen.after === true,
    JSON.stringify(stolen),
  );

  // ------------------------------------------------------------------- the URL
  await page.click('#share');
  await page.waitForTimeout(300);
  const hash = await page.evaluate(() => location.hash.length);
  check('the song goes into the URL', hash > 40, `${hash} chars`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => document.getElementById('bass').value.trim().length);
  check('and comes back from it', restored > 40, `${restored} chars of bass`);

  // A hand-mangled link must not produce an empty page.
  await page.goto(URL_ + '#not-base64-at-all', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const fallback = await page.evaluate(() => document.getElementById('lead').value.trim().length);
  check('a broken link falls back to the default song', fallback > 40, `${fallback} chars`);

  check('no page errors anywhere', errors.length === 0, errors.slice(0, 2).join(' | '));

} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
