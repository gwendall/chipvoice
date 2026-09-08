// Explicit production smoke test: send only to the app-owned mailbox, redeem
// the newly received email, generate one private 10s song and withdraw it.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { Domani } from 'domani';
assert.equal(process.env.CHIPVOICE_EVAL_PRODUCTION, '1', 'Explicit production evaluation opt-in required');
assert.ok(process.env.DOMANI_API_KEY, 'Load the mailbox-scoped key from .env.local');
const base = 'https://chipvoice.dev', mailbox = 'hello@chipvoice.dev';
const mail = new Domani({ apiKey: process.env.DOMANI_API_KEY });
const configResponse = await fetch('https://domani.run/api/emails/' + encodeURIComponent(mailbox), { headers: { Authorization: 'Bearer ' + process.env.DOMANI_API_KEY } });
assert.equal(configResponse.status, 200);
const config = await configResponse.json();
assert.equal(config.address, mailbox);
assert.ok(!config.forward_to, 'Do not send test mail through a personal forwarding address');
const out = resolve('../../.artifacts/onboarding/production-' + Date.now());
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let created, generationId, signedIn = false;
try {
  const page = await context.newPage();
  await page.goto(base + '/create?compose=1#prompt');
  const form = page.locator('.prompt-composer');
  const prompt = 'A short original arcade fanfare: a singable rising melody, soft bass and sparse percussion, ending on the tonic. This private song tests the human sign-in journey.';
  await form.getByLabel('Music prompt').fill(prompt);
  await form.getByLabel('Song duration', { exact: true }).fill('10');
  await form.getByLabel('Email', { exact: true }).fill(mailbox);
  const since = new Date().toISOString();
  const sendResponse = page.waitForResponse(r => r.url() === base + '/api/auth/signin' && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  assert.equal((await sendResponse).status(), 202, 'Production provider must accept the login email');
  await form.getByText('Check your inbox', { exact: true }).waitFor();
  await form.screenshot({ path: out + '/email-sent.png' });
  console.log('Production mail accepted; waiting for the new inbound message.');
  let link;
  for (let i = 0; i < 60 && !link; i++) {
    const result = await mail.listEmailMessagesByAddress(mailbox, { direction: 'in', since, from: mailbox, subject: 'Sign in to chipvoice', limit: 5 });
    const received = result.messages?.find(m => m.direction === 'in' && new Date(m.created_at).getTime() >= new Date(since).getTime() && m.text?.includes('/api/auth/redeem'));
    if (received) link = received.text.match(/https:\/\/chipvoice\.dev\/api\/auth\/redeem[^\s]+/)?.[0];
    if (!link) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.ok(link, 'Provider acceptance alone is not evidence of inbox delivery');
  const emailTab = await context.newPage();
  // Never log, screenshot or save the token-bearing navigation URL.
  await emailTab.goto(link);
  assert.equal(new URL(emailTab.url()).pathname, '/create');
  const me = await context.request.get(base + '/api/me');
  assert.equal(me.status(), 200);
  assert.equal((await me.json()).email, mailbox); signedIn = true;
  await emailTab.getByRole('button', { name: 'Generate music', exact: true }).waitFor();
  assert.equal(await emailTab.getByLabel('Music prompt').inputValue(), prompt);
  assert.equal(await emailTab.getByLabel('Song duration', { exact: true }).inputValue(), '10');
  await emailTab.locator('.prompt-composer').screenshot({ path: out + '/authenticated-draft.png' });
  const again = await context.request.get(link, { maxRedirects: 0 });
  assert.match(again.headers().location, /signin=expired/);
  console.log('New inbound email received and redeemed; draft restored. Generating the private test song.');
  const generationResponse = emailTab.waitForResponse(r => r.url() === base + '/api/v1/generations' && r.request().method() === 'POST');
  await emailTab.getByRole('button', { name: 'Generate music', exact: true }).click();
  const accepted = await generationResponse;
  assert.equal(accepted.status(), 202);
  generationId = (await accepted.json()).id;
  const ready = emailTab.getByRole('link', { name: 'Open your generated song' });
  await ready.waitFor({ timeout: 240000 });
  created = (await ready.getAttribute('href')).split('/').at(-1);
  const songResponse = await context.request.get(base + '/api/v1/projects/' + created);
  assert.equal(songResponse.status(), 200);
  const song = await songResponse.json();
  assert.equal(song.visibility, 'private'); assert.equal(song.origin.method, 'prompt');
  const artists = await (await context.request.get(base + '/api/v1/profiles')).json();
  assert.ok(artists.items.some(artist => artist.id === song.profile.id), 'Song belongs to an artist owned by this signed-in account');
  const rendition = song.renditions.find(r => r.kind === 'full' && r.status === 'ready');
  assert.ok(rendition);
  const audio = await context.request.get(base + '/api/v1/jobs/' + rendition.id + '/audio?format=mp3');
  assert.equal(audio.status(), 200);
  const bytes = await audio.body();
  const measured = await emailTab.evaluate(async encoded => {
    const ctx = new AudioContext();
    try {
      const decoded = await ctx.decodeAudioData(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
      let peak = 0, energy = 0, count = 0;
      for (let c = 0; c < decoded.numberOfChannels; c++) for (const value of decoded.getChannelData(c)) { peak = Math.max(peak, Math.abs(value)); energy += value * value; count++; }
      return { duration: decoded.duration, peak, rms: Math.sqrt(energy / count) };
    } finally { await ctx.close(); }
  }, bytes.toString('base64'));
  assert.ok(measured.duration >= 9.5 && measured.peak > 0.001 && measured.peak <= 1);
  await writeFile(out + '/song.mp3', bytes);
  await emailTab.goto(base + '/library');
  await emailTab.getByText(song.title, { exact: true }).first().waitFor();
  await emailTab.screenshot({ path: out + '/library.png', fullPage: true });
  await writeFile(out + '/report.json', JSON.stringify({ receivedRealEmail: true, redeemedOnce: true, newTabPromptRestored: true, durationRestored: true, privateSong: created, creatorId: song.profile.id, title: song.title, origin: song.origin.method, libraryEntry: true, audio: measured, cleanup: 'Only this test publication and session are removed below' }, null, 2));
  console.log('PASS production human sign-in: inbox receipt, single-use login, saved prompt, private generation, library and decoded MP3.');
} finally {
  try {
  if (generationId && !created) {
    const pending = await (await context.request.get(base + '/api/v1/generations/' + generationId)).json();
    created = pending.projectId;
    if (!['ready', 'failed', 'cancelled'].includes(pending.status)) {
      const cancelled = await context.request.delete(base + '/api/v1/generations/' + generationId, { headers: { Origin: base } });
      if (cancelled.ok()) created = (await cancelled.json()).projectId ?? created;
    }
  }
  if (created) assert.equal((await context.request.delete(base + '/api/v1/projects/' + created, { headers: { Origin: base } })).status(), 200);
  if (signedIn) assert.equal((await context.request.delete(base + '/api/auth/session', { headers: { Origin: base } })).status(), 200);
  } finally { await browser.close(); }
}
