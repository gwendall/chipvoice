import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { compositionServer } from './test/composition-server.mjs';
const server = await compositionServer();
const browser = await chromium.launch({ headless: true });
const out = '../../.artifacts/session/avatar-layout';
await mkdir(out, { recursive: true });
const measurements = [];
try {
  for (const [locale, width] of [['en', 1440], ['en', 390], ['ja', 390]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const profile = { id: 'layout-artist', displayName: 'Pixel pilot', handle: 'pixel_pilot', avatar: { palette: 2, variant: 4 }, bio: '' };
    for (const path of ['/api/auth/session', '/api/v1/profile']) await page.route('**' + path, async route => {
      await gate;
      await route.fulfill({ json: path === '/api/v1/profile' ? profile : { revision: '', userId: 'layout-user', email: 'layout@example.test', profile } });
    });
    for (const path of ['/api/v1/profiles', '/api/v1/agents']) await page.route('**' + path, route => route.fulfill({ json: { items: [] } }));
    await page.route('**/api/v1/projects?*', route => route.fulfill({ json: { items: [], cursor: null } }));
    try {
      await page.goto(server.base + (locale === 'ja' ? '/ja' : '') + '/library');
      await page.locator('.community-header h1').waitFor();
      const frames = page.locator('header .avatar-thumbnail, .community-header .avatar-thumbnail');
      assert.equal(await frames.count(), 2, 'header and profile reserve their avatar before identity arrives');
      const geometry = () => page.evaluate(() => Object.fromEntries(['header .account-link', 'header nav', 'header .language-selector', '.community-header', '.community-header h1', 'header .avatar-thumbnail', '.community-header .avatar-thumbnail'].map(selector => {
        const el = document.querySelector(selector), { x, y, width, height } = el.getBoundingClientRect();
        return [selector, { x, y, width, height }];
      })));
      const before = await geometry();
      for (const frame of await frames.all()) {
        const style = await frame.evaluate(el => ({ aspect: getComputedStyle(el).aspectRatio, background: getComputedStyle(el).backgroundColor }));
        const [w, h] = style.aspect.split('/').map(Number);
        assert.equal(w / h, 1);
        assert.notEqual(style.background, 'rgba(0, 0, 0, 0)');
      }
      await page.screenshot({ path: `${out}/${locale}-${width}-loading.png`, timeout: 10000 });
      release();
      await page.locator('header .avatar-thumbnail svg').waitFor();
      await page.locator('.community-header .avatar-thumbnail svg').waitFor();
      const after = await geometry();
      assert.deepEqual(after, before, 'loading an avatar must not move or resize its frame, title or navigation');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `${out}/${locale}-${width}-ready.png`, timeout: 10000 });
      measurements.push({ locale, width, before, after });
    } finally { release(); await page.close(); }
  }
  await writeFile(out + '/geometry.json', JSON.stringify(measurements, null, 2));
  console.log('PASS avatar loading: identical frame, heading and navigation geometry before/after delayed identity in desktop, mobile and Japanese');
} finally { await browser.close(); await server.close(); }
