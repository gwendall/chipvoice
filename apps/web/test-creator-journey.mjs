// The agent child sees only the downloaded public helper, its own grant and its score.
// The controller supplies a dedicated owner fixture; it never simulates email delivery.
import assert from 'node:assert/strict';
import { build } from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { compositionServer, fixtureScore } from './test/composition-server.mjs';
const production = process.env.CHIPVOICE_EVAL_PRODUCTION === '1';
if (production) {
  assert.equal(process.env.CHIPVOICE_EVAL_SITE, 'https://chipvoice.dev');
  assert.ok(process.env.TURSO_DATABASE_URL?.startsWith('libsql://'));
  process.env.VERCEL_ENV = 'production';
}
const server = production ? null : await compositionServer();
if (server) Object.assign(process.env, server.env);
const base = production ? 'https://chipvoice.dev' : server.base;
const out = resolve('../../.artifacts/creator-journey/' + (production ? 'production-' : 'local-') + Date.now());
await mkdir(out, { recursive: true });
await build({ stdin: { contents: "export * from './src/lib/auth';export * from './src/lib/db';export * from './src/lib/composition/score';", resolveDir: process.cwd() }, outfile: 'generated/creator-journey.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const internal = await import('./generated/creator-journey.mjs');
const suffix = randomUUID().slice(0, 8), handle = 'soundcheck_' + suffix;
const owner = await internal.createKey('chipvoice-e2e-' + suffix + '@example.test', 'Temporary authorized end-to-end test');
let cookie, agentToken, agentId, browser;
const created = new Set();
async function http(method, path, body, credential = agentToken, extra = {}) {
  const response = await fetch(base + path, { method, headers: { ...(credential ? credential.startsWith('cv_') ? { Authorization: 'Bearer ' + credential } : { Cookie: credential, Origin: base } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
async function ok(...args) { const r = await http(...args); assert.ok(r.status >= 200 && r.status < 300, 'HTTP ' + r.status + ': ' + JSON.stringify(r.data)); return r.data; }
async function helper(args) {
  const result = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(out, 'compose.mjs'), ...args], { env: { PATH: process.env.PATH, CHIPVOICE_API_KEY: agentToken, CHIPVOICE_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject); child.on('exit', code => {
      assert.ok(!stdout.includes(agentToken) && !stderr.includes(agentToken), 'The agent credential must not be printed');
      if (code) reject(Error('Agent helper failed: ' + stderr)); else resolvePromise(JSON.parse(stdout));
    });
  });
  created.add(result.projectId);
  assert.ok((await readFile(result.mp3)).byteLength > 1000);
  return result;
}
try {
  const skill = await (await fetch(base + '/skill.md')).text();
  assert.ok(skill.includes('/skill/compose.mjs') && skill.includes('generate') && skill.includes('PATCH /api/v1/projects/'));
  const openapi = await (await fetch(base + '/.well-known/openapi.json')).json();
  assert.ok(openapi.paths['/api/v1/generations']?.post && openapi.paths['/api/v1/projects/{id}']?.patch);
  const script = await fetch(base + '/skill/compose.mjs'); assert.equal(script.status, 200);
  await writeFile(resolve(out, 'compose.mjs'), await script.text());
  const magic = await internal.createMagicLink(owner.id);
  const redeemed = await fetch(base + '/api/auth/redeem?token=' + encodeURIComponent(magic), { redirect: 'manual' });
  cookie = redeemed.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const artist = await ok('POST', '/api/v1/profiles', undefined, cookie);
  const pair = await ok('POST', '/api/v1/agent-requests', { label: 'Chipvoice end-to-end conductor', scopes: ['generate','projects:read','projects:write','render','evaluate','profile:write'] }, null);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const [name, value] = cookie.split('='); await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/connect?code=' + pair.userCode);
  await page.getByRole('button', { name: 'Review access', exact: true }).click();
  await page.getByLabel('Artist', { exact: true }).selectOption(artist.id);
  await page.getByLabel('Username', { exact: true }).fill(handle);
  await page.getByLabel('Display name', { exact: true }).fill('Chipvoice soundcheck');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Profile saved.' }).waitFor();
  await page.getByRole('button', { name: 'Authorize this agent', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Access authorized.' }).waitFor();
  const grant = await ok('POST', '/api/v1/agent-requests/token', { requestToken: pair.requestToken }, null);
  agentToken = grant.accessToken;
  const identity = await ok('GET', '/api/v1/agent'); agentId = identity.id;
  assert.equal(grant.profileId, artist.id);
  await ok('PUT', '/api/v1/profile', { handle, displayName: 'Chipvoice soundcheck', bio: 'An explicitly identified automated API and browser test artist.', avatar: { palette: 2, variant: 4 } });
  const promptArgs = ['--prompt', 'An original space courier theme with a clear melody, arpeggiated harmony, gentle bass and sparse percussion, a contrasting middle and a resolved ending.', '--target', 'md', '--seconds', production ? '30' : '10', '--out', resolve(out, 'prompt')];
  const generated = await helper(promptArgs);
  const retried = await helper(promptArgs); assert.equal(retried.projectId, generated.projectId);
  let song = await ok('GET', '/api/v1/projects/' + generated.projectId);
  assert.equal(song.profile.id, artist.id); assert.equal(song.origin.method, 'prompt'); assert.equal(song.visibility, 'private');
  assert.equal((await http('GET', '/api/v1/projects/' + song.id, undefined, null)).status, 404);
  const savedRendition = song.renditions.find(r => r.kind === 'full' && r.status === 'ready').id;
  await page.goto(base + '/p/' + song.id);
  await page.getByText('Prompt-generated', { exact: false }).waitFor();
  await page.getByLabel('Song visibility', { exact: true }).selectOption('public');
  await page.getByRole('status').filter({ hasText: 'Your song is public' }).waitFor();
  song = await ok('GET', '/api/v1/projects/' + song.id, undefined, null);
  assert.equal(song.generation, undefined); assert.equal(song.origin.method, 'prompt'); assert.equal(song.profile.handle, handle);
  assert.equal(song.renditions.find(r => r.kind === 'full').id, savedRendition, 'Publication reuses existing audio');
  const listing = await ok('GET', '/api/v1/projects?handle=' + handle, undefined, null);
  assert.ok(listing.items.some(p => p.id === song.id && p.origin.method === 'prompt'));
  const direct = internal.compositionProject(fixtureScore(10), { prompt: 'Direct API fixture', target: 'md', durationSeconds: 10, loop: false, visibility: 'public' });
  direct.title = 'Direct soundcheck ' + suffix;
  await writeFile(resolve(out, 'direct.json'), JSON.stringify(direct));
  const directResult = await helper(['--project', resolve(out, 'direct.json'), '--visibility', 'public', '--out', resolve(out, 'direct')]);
  assert.equal(directResult.origin.method, 'direct');
  assert.equal((await http('PATCH', '/api/v1/projects/' + directResult.projectId, { visibility: 'private' }, null)).status, 401);
  const otherArtist = await ok('POST', '/api/v1/profiles', undefined, cookie);
  const isolated = await ok('POST', '/api/v1/projects', { project: direct, visibility: 'private', profileId: otherArtist.id }, cookie, { 'Idempotency-Key': 'isolated-' + suffix }); created.add(isolated.id);
  assert.equal((await http('PATCH', '/api/v1/projects/' + isolated.id, { visibility: 'public' })).status, 404, 'Agent cannot publish another artist on the same owner account');
  const directSong = await ok('GET', '/api/v1/projects/' + directResult.projectId, undefined, null);
  assert.equal(directSong.profile.id, artist.id);
  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const listener = await anonymous.newPage();
  await listener.goto(base + '/u/' + handle);
  await listener.getByText('Direct composition', { exact: true }).waitFor();
  await listener.getByText('Prompt-generated', { exact: false }).waitFor();
  assert.ok(await listener.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await listener.screenshot({ path: resolve(out, 'artist-mobile.png'), fullPage: true });
  await listener.setViewportSize({ width: 1440, height: 1000 });
  await listener.screenshot({ path: resolve(out, 'artist-desktop.png'), fullPage: true });
  await listener.goto(base + '/p/' + song.id);
  await listener.getByRole('heading', { name: song.title, exact: true }).waitFor();
  assert.equal(await listener.getByText('Composition prompt', { exact: true }).count(), 0);
  await listener.getByRole('button',{name:'Play',exact:true}).click();
  await listener.waitForFunction(() => Number(document.querySelector('.persistent-player input[type=range]')?.value) > 0);
  await listener.getByRole('button',{name:'Pause',exact:true}).click();
  const mp3 = await readFile(generated.mp3);
  const decoded = await listener.evaluate(async bytes => { const ctx = new AudioContext(); try { const buffer = await ctx.decodeAudioData(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)).buffer); let peak = 0, energy = 0, samples = 0; for (let c = 0; c < buffer.numberOfChannels; c++) for (const sample of buffer.getChannelData(c)) { peak = Math.max(peak, Math.abs(sample)); energy += sample * sample; samples++; } return { duration: buffer.duration, peak, rms: Math.sqrt(energy / samples) }; } finally { await ctx.close(); } }, mp3.toString('base64'));
  assert.ok(Math.abs(decoded.duration - (production ? 30 : 10)) < .25);
  assert.ok(decoded.rms > 0.00001 && decoded.peak < 1, 'The complete MP3 is audible and remains within full scale');
  await listener.screenshot({ path: resolve(out, 'song-desktop.png'), fullPage: true });
  await ok('PATCH', '/api/v1/projects/' + song.id, { visibility: 'unlisted' });
  assert.equal((await http('GET', '/api/v1/projects/' + song.id, undefined, null)).status, 200);
  assert.ok(!(await ok('GET', '/api/v1/projects?handle=' + handle, undefined, null)).items.some(p => p.id === song.id));
  await ok('PATCH', '/api/v1/projects/' + song.id, { visibility: 'private' });
  assert.equal((await fetch(base + '/api/v1/jobs/' + savedRendition + '/audio?format=mp3')).status, 404);
  await ok('PATCH', '/api/v1/projects/' + song.id, { visibility: 'public' });
  const remix = structuredClone(song.project); remix.title = 'Derived soundcheck ' + suffix; remix.source.performance.parts[0].notes[0].pitch++;
  const derived = await ok('POST', '/api/v1/projects', { project: remix, parentId: song.id, visibility: 'public' }, agentToken, { 'Idempotency-Key': 'derived-' + suffix }); created.add(derived.id);
  assert.equal(derived.origin.method, 'prompt-derived');
  assert.equal((await http('POST', '/api/v1/projects', { project: direct, origin: { method: 'prompt' } }, agentToken, { 'Idempotency-Key': 'spoof-' + suffix })).status, 422);
  const mine = await ok('GET', '/api/v1/projects?mine=1'); assert.ok(mine.items.some(p => p.id === song.id));
  await page.goto(base + '/library'); await page.getByRole('link', { name: song.title, exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'library-mobile.png'), fullPage: true });
  // The web form uses the same generation API and preserves the currently edited song.
  await page.goto(base + '/create');
  await page.getByText('Compose from a prompt', { exact: true }).click();
  const title = await page.getByLabel('Song title', { exact: true }).inputValue();
  await page.getByLabel('Music prompt', { exact: true }).fill('An original calm music-box melody with a gentle bass and a clear ending.');
  await page.getByLabel('Song duration', { exact: true }).fill('10');
  await page.locator('.prompt-composer select').selectOption(artist.id);
  await page.getByRole('button', { name: 'Generate music', exact: true }).click();
  await page.locator('.prompt-composer progress').waitFor();
  await page.screenshot({ path: resolve(out, 'prompt-progress-mobile.png'), fullPage: true });
  await page.waitForFunction(() => sessionStorage.getItem('chipvoice-prompt-job'));
  await page.reload();
  const ready = page.getByRole('link', { name: 'Open your generated song', exact: false });
  await ready.waitFor({ timeout: 300000 });
  const webId = (await ready.getAttribute('href')).split('/').at(-1); created.add(webId);
  assert.equal(await page.getByLabel('Song title', { exact: true }).inputValue(), title);
  assert.equal((await ok('GET', '/api/v1/projects/' + webId)).profile.id, artist.id);
  await page.screenshot({ path: resolve(out, 'prompt-ready-mobile.png'), fullPage: true });
  await page.goto(base + '/ja/u/' + handle);
  await page.getByText('直接作曲', { exact: true }).waitFor();
  await page.getByText('プロンプトで生成', { exact: false }).first().waitFor();
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ environment: production ? 'production' : 'local simulated provider', skillDiscovery: true, pairingInBrowser: true, ownerFixture: 'Dedicated test owner; email delivery not simulated or claimed', creatorId: artist.id, creatorHandle: handle, prompt: { title: song.title, id: song.id, audio: decoded }, directId: directResult.projectId, inheritedOrigin: true, publicPrivateUnlisted: true, existingRenderReused: true, webPrompt: true, unchangedDraft: true, credentialsNeverPrinted: true, cleanup: 'Test publications withdrawn after the run' }, null, 2));
  console.log('PASS creator journey: served skill/helper, browser pairing, prompt/direct MP3 in agent context, creator attribution, origin/lineage, visibility, library, EN/JA desktop/mobile and web generation. Artifacts: ' + out);
} catch (error) {
  for (const [i, context] of (browser?.contexts() ?? []).entries()) for (const [j, page] of context.pages().entries()) {
    try { await page.screenshot({ path: resolve(out, 'failure-' + i + '-' + j + '.png'), fullPage: true }); console.error('Page failure:', new URL(page.url()).pathname, (await page.locator('body').innerText()).slice(0, 2500)); } catch {}
  }
  throw error;
} finally {
  // Only this run's explicitly identified fixtures are withdrawn; no other account is touched.
  if (cookie) {
    for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
      try { const id = await page.evaluate(() => sessionStorage.getItem('chipvoice-prompt-job')); if (id) await http('DELETE', '/api/v1/generations/' + id, undefined, cookie); } catch {}
    }
    try { const own = await ok('GET', '/api/v1/projects?mine=1', undefined, cookie); for (const p of own.items) created.add(p.id); } catch {}
  }
  for (const id of created) { try { await http('DELETE', '/api/v1/projects/' + id, undefined, cookie); } catch {} }
  if (agentId && cookie) { try { await http('DELETE', '/api/v1/agents/' + agentId, undefined, cookie); } catch {} }
  if (cookie) { try { await http('DELETE', '/api/keys/' + owner.id, undefined, cookie); await http('DELETE', '/api/auth/session', undefined, cookie); } catch {} }
  await browser?.close();
  await (await internal.db()).close();
  await server?.close();
}
