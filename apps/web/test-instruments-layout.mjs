import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
// A bounded layout check for the instrument catalogue page: no page render,
// no server request per NEXT-05's own audio - this reads the already-built
// `presets`/plots straight off the page at the two widths the ticket asks
// for, English and Japanese, and closes the browser in `finally` even on
// failure or timeout (see `test-avatar-layout.mjs` for the same shape).
const base = process.env.SITE ?? 'http://127.0.0.1:3074';
if (!base.startsWith('http://127.0.0.1:')) throw Error('This test only ever loads a local disposable server.');
const out = '../../.artifacts/session/instruments-layout';
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true});
try {
  for (const [locale, width] of [['en', 390], ['en', 1280], ['ja', 1280]]) {
    const page = await browser.newPage({viewport: {width, height: 1000}});
    try {
      await page.goto(base + (locale === 'ja' ? '/ja' : '') + '/instruments', {waitUntil: 'domcontentloaded', timeout: 20000});
      await page.locator('.instrument-card').first().waitFor({timeout: 20000});
      const cards = await page.locator('.instrument-card').count();
      assert.ok(cards > 80, `${locale}@${width}: expected the full catalogue, saw ${cards} cards`);
      const plots = await page.locator('.instrument-card').first().locator('svg.instrument-plot').count();
      assert.equal(plots, 2, `${locale}@${width}: each card plots an envelope and a spectrum`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 0, `${locale}@${width}: page overflows horizontally by ${overflow}px`);
      await page.screenshot({path: `${out}/${locale}-${width}.png`, fullPage: false, timeout: 10000});
    } finally { await page.close(); }
  }
  console.log('PASS instrument catalogue layout: full card grid, both plots, no horizontal overflow at 390px and 1280px, English and Japanese');
} finally {
  await browser.close();
}
