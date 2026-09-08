// Exercise the human journey through actual HTTP mail delivery and redemption.
// The local provider is isolated: no external email or production account is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import { compositionServer } from './test/composition-server.mjs';
await build({ entryPoints: ['src/lib/signin-path.ts'], outfile: 'generated/test-signin-path.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { signInDestination } = await import('./generated/test-signin-path.mjs');
for (const bad of ['//evil.test', 'https://evil.test', '/\\evil.test', '/api/auth/session', '/%2f%2fevil.test', '/create\r\nLocation:evil', '/signin', '/create/../../api/me']) assert.equal(signInDestination(bad, 'en'), '/');
assert.equal(signInDestination('/create?compose=1#prompt', 'ja'), '/ja/create?compose=1#prompt');
const deliveries = [];
let fail = true;
const mail = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  assert.equal(req.url, '/api/emails/hello%40chipvoice.dev/send');
  assert.equal(req.headers.authorization, 'Bearer fixture-mail-key');
  const body = JSON.parse(Buffer.concat(chunks));
  await new Promise(resolve => setTimeout(resolve, 350));
  res.writeHead(fail ? 401 : 200, { 'Content-Type': 'application/json' });
  if (fail) res.end(JSON.stringify({ error: 'DO_NOT_LOG_THIS_SECRET', code: 'INVALID_API_KEY' }));
  else { deliveries.push(body); res.end(JSON.stringify({ id: 'mail-' + deliveries.length, status: 'sent' })); }
});
await new Promise(resolve => mail.listen(0, '127.0.0.1', resolve));
const server = await compositionServer({ mailBase: `http://127.0.0.1:${mail.address().port}` });
const out = resolve('../../.artifacts/onboarding/local');
await mkdir(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await context.newPage();
  let generationRequests = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/v1/generations')) generationRequests++; });
  const form = page.locator('.prompt-composer');
  await page.goto(server.base + '/create?compose=1#prompt');
  await form.getByLabel('Music prompt').fill('An uplifting arcade theme with a clear melody and warm bass.');
  await form.getByLabel('Song duration', { exact: true }).fill('10');
  await page.getByRole('heading', { name: 'Sign in to generate your song' }).waitFor();
  assert.equal(await form.getByRole('button', { name: 'Generate music', exact: true }).count(), 0);
  assert.equal(generationRequests, 0, 'no anonymous generation request before authentication');
  assert.match(await page.locator('header').getByRole('link', { name: 'Sign in', exact: true }).getAttribute('href'), /next=%2Fcreate/);
  await page.screenshot({ path: out + '/desktop-before-signin.png', fullPage: true });
  await form.getByLabel('Email', { exact: true }).fill('listener@example.test');
  await form.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  await form.getByRole('button', { name: 'Sending your link…' }).waitFor();
  await form.getByRole('alert').filter({ hasText: 'We could not send' }).waitFor();
  assert.equal(deliveries.length, 0);
  fail = false;
  await form.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  await form.getByText('Check your inbox', { exact: true }).waitFor();
  assert.equal(deliveries.length, 1);
  assert.equal(await form.getByRole('button', { name: 'Send another link' }).isDisabled(), true);
  await page.screenshot({ path: out + '/email-sent.png', fullPage: true });
  // Production links deliberately use the canonical host. Keep their exact
  // path/query but redeem only against this test's disposable local database.
  const deliveredLink = body => {
    const url = new URL(body.text.match(/https?:\/\/[^\s]+\/api\/auth\/redeem[^\s]+/)[0]);
    return server.base + url.pathname + url.search;
  };
  const link = deliveredLink(deliveries[0]);
  const emailTab = await context.newPage();
  await emailTab.goto(link);
  assert.equal(new URL(emailTab.url()).pathname, '/create');
  await emailTab.waitForLoadState('networkidle', { timeout: 10000 });
  await emailTab.locator('.prompt-composer').getByRole('button', { name: 'Generate music', exact: true }).waitFor();
  assert.equal(await emailTab.getByLabel('Music prompt').inputValue(), 'An uplifting arcade theme with a clear melody and warm bass.');
  assert.equal(await emailTab.getByLabel('Song duration', { exact: true }).inputValue(), '10');
  assert.equal(await emailTab.locator('.prompt-composer').evaluate(el => el.open), true);
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await form.getByRole('button', { name: 'Generate music', exact: true }).waitFor();
  await form.getByRole('button', { name: 'Generate music', exact: true }).click();
  await form.getByRole('link', { name: 'Open your generated song' }).waitFor({ timeout: 120000 });
  assert.equal(generationRequests, 1);
  const songPath = await form.getByRole('link', { name: 'Open your generated song' }).getAttribute('href');
  const project = await (await context.request.get(server.base + '/api/v1/projects/' + songPath.split('/').at(-1))).json();
  assert.equal(project.visibility, 'private');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + '/mobile-generated.png', fullPage: true });
  const repeated = await context.request.get(link, { maxRedirects: 0 });
  assert.match(repeated.headers().location, /^\/signin\?next=.*signin=expired$/);
  // A fresh browser cannot consume an already-used link or access the private song.
  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await anonymous.newPage();
  await mobile.goto(link);
  await mobile.getByRole('alert').filter({ hasText: 'expired or was already used' }).waitFor();
  await mobile.goto(server.base + '/ja/create?compose=1#prompt');
  await mobile.getByRole('heading', { name: 'ログインして曲を生成' }).waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: out + '/mobile-japanese.png', fullPage: true });
  await mobile.getByLabel("メールアドレス", { exact: true }).fill('japanese@example.test');
  await mobile.locator('.prompt-composer .signin-form button').click();
  await mobile.getByText('受信トレイをご確認ください', { exact: true }).waitFor();
  assert.equal(deliveries.length, 2);
  assert.match(deliveries[1].text, /30/);
  const jaLink = deliveredLink(deliveries[1]);
  await mobile.goto(jaLink);
  assert.equal(new URL(mobile.url()).pathname, '/ja/create');
  await mobile.getByRole('button', { name: "曲を生成", exact: true }).waitFor();
  assert.equal(server.logs().includes('DO_NOT_LOG_THIS_SECRET'), false);
  assert.equal(server.logs().includes('listener@example.test'), false);
  await writeFile(out + '/report.json', JSON.stringify({ providerFailure: true, loading: true, receivedMail: true, newTabDraftRecovery: true, originalTabRefresh: true, privateGeneration: true, usedLinkRejected: true, japaneseReturn: true, safeRedirects: true, secretRedaction: true }, null, 2));
  console.log('PASS human onboarding: mail failure/retry, receipt, new-tab draft recovery, generation, used links, Japanese, safe redirects and mobile');
} finally {
  await browser?.close();
  await server.close();
  mail.closeAllConnections();
  await new Promise(resolve => mail.close(resolve));
}
