import { chromium } from 'playwright';

/**
 * The playground has to make a sound, show where it is, and show a channel
 * being taken.
 *
 * That last one is the whole reason this library exists, and no assertion about
 * a status line can see it: a build whose arbiter never claims anything plays
 * the chord and the shot together and looks perfect from outside. So this reads
 * the arbiter through the door the library opens for it, and the playhead
 * through the position the sequencer reports.
 */
const URL_ = process.env.URL || 'http://localhost:4174/';
const guard = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 90000);
guard.unref();

let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

const openPage = async (width, height) => {
  const mobile = width < 720;
  const page = await browser.newPage({
    viewport: { width, height },
    hasTouch: mobile,
    isMobile: mobile,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  return { page, errors };
};

try {
  const { page, errors } = await openPage(1200, 860);

  // ------------------------------------------------------------------ sound
  await page.click('.transport .primary');
  const started = await page
    .waitForFunction(() => !!window.chipvoice, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('the chip starts', started, started ? '' : 'no chip after 15s');
  if (!started) throw new Error('nothing below would mean anything');

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
  check('and the song is audible', (await sample(900)) > 0.01);

  // -------------------------------------------------------------- playhead
  //
  // The thing the first version of this page did not have: pressing play made
  // a sound and changed nothing on screen, which reads as a broken page.
  const walked = await page.evaluate(async () => {
    const seen = new Set();
    const until = performance.now() + 1600;
    while (performance.now() < until) {
      await new Promise((r) => setTimeout(r, 40));
      const cell = document.querySelector('.cell.at');
      if (cell) seen.add(cell.getAttribute('aria-label'));
    }
    return seen.size;
  });
  check('the playhead moves', walked > 3, `${walked} distinct steps`);

  // -------------------------------------------------- the channel being taken
  const stolen = await page.evaluate(async () => {
    const chip = window.chipvoice;
    const at = chip.currentTime;
    document.querySelector('.transport .fire').click();
    await new Promise((r) => setTimeout(r, 60));
    return {
      during: chip.canPlay('p2', at + 0.05),
      after: chip.canPlay('p2', at + 0.5),
      rowMarked: !!document.querySelector('.row.taken'),
    };
  });
  check(
    'firing takes pulse 2 from the music',
    stolen.during === false && stolen.after === true,
    JSON.stringify(stolen),
  );
  check('and the row says so', stolen.rowMarked, JSON.stringify(stolen));

  // ------------------------------------------------------------------ zoom
  const zoomed = await page.evaluate(async () => {
    const grid = document.querySelector('.grid');
    const before = getComputedStyle(grid).getPropertyValue('--cell').trim();
    document.querySelector('.zoom button[aria-label="Zoom out"]').click();
    await new Promise((r) => setTimeout(r, 120));
    const after = getComputedStyle(grid).getPropertyValue('--cell').trim();
    return { before, after };
  });
  check('zooming out narrows the cells', zoomed.before !== zoomed.after, JSON.stringify(zoomed));

  // ------------------------------------------------------------------ mute
  const muteState = await page.evaluate(async () => {
    document.querySelector('.row .row-mute').click();
    await new Promise((r) => setTimeout(r, 200));
    return !!document.querySelector('.row.muted');
  });
  check('a row can be muted', muteState);
  await page.evaluate(() => document.querySelector('.row .row-mute').click());

  // ------------------------------------------------------------- keyboard
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const stoppedBySpace = await page.evaluate(() => !window.chipvoice.playing);
  check('space stops it', stoppedBySpace);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  check('and starts it', await page.evaluate(() => window.chipvoice.playing));

  // ------------------------------------------------------------------- URL
  //
  // The draft link: the whole song in a fragment, no account, no storage. It is
  // still here alongside saving, because the two are for different moments -
  // one is a scratch you can throw away, the other is a publication.
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.transport button')];
    const draft = buttons.find((b) => /draft link/i.test(b.textContent));
    if (draft) draft.click();
  });
  await page.waitForTimeout(300);
  const hash = await page.evaluate(() => location.hash.length);
  check('the song goes into the URL', hash > 40, `${hash} chars`);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const cells = await page.evaluate(() => document.querySelectorAll('.cell.note').length);
  check('and comes back from it', cells > 20, `${cells} notes`);

  await page.goto(URL_ + '#not-base64-at-all', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const fallback = await page.evaluate(() => document.querySelectorAll('.cell.note').length);
  check('a broken link falls back to the default song', fallback > 20, `${fallback} notes`);

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();

  // ----------------------------------------------------------------- phone
  //
  // The transport has to be reachable without scrolling, on the device where
  // the grid is tallest relative to the screen.
  const { page: phone, errors: phoneErrors } = await openPage(390, 780);
  const fixed = await phone.evaluate(() => {
    const bar = document.querySelector('.transport');
    const rect = bar.getBoundingClientRect();
    return {
      position: getComputedStyle(bar).position,
      onScreen: rect.bottom <= window.innerHeight + 1 && rect.top < window.innerHeight,
    };
  });
  check('the transport is fixed and on screen', fixed.position === 'fixed' && fixed.onScreen, JSON.stringify(fixed));

  // Sixty-four steps at the phone's opening zoom: enough of the pattern to see
  // the bar you are editing, rather than a keyhole.
  const visible = await phone.evaluate(() => {
    const grid = document.querySelector('.grid');
    const cell = parseFloat(getComputedStyle(grid).getPropertyValue('--cell'));
    const label = parseFloat(getComputedStyle(grid).getPropertyValue('--label'));
    return Math.floor((grid.clientWidth - label) / cell);
  });
  check('a phone opens on enough of the pattern', visible >= 20, `${visible} of 64 steps`);

  const noSideScroll = await phone.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  check('the page itself does not scroll sideways', noSideScroll);
  check('no page errors on a phone', phoneErrors.length === 0, phoneErrors.slice(0, 2).join(' | '));

} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
