#!/usr/bin/env node
// Download from Chipvoice. No dependencies; credentials stay in environment variables.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i]?.replace(/^--/, '');
  if (!['prompt','project','target','seconds','visibility','out','parent'].includes(name) || !process.argv[i + 1]) throw Error('Use --prompt TEXT or --project FILE, with --target, --seconds, --visibility and --out');
  options[name] = process.argv[i + 1];
}
if (!!options.prompt === !!options.project) throw Error('Choose exactly one of --prompt or --project');
const key = process.env.CHIPVOICE_API_KEY;
if (!key) throw Error('Set CHIPVOICE_API_KEY after the owner authorizes your artist; see /skill.md');
const base = new URL(process.env.CHIPVOICE_URL || 'https://chipvoice.dev');
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1','localhost'].includes(base.hostname))) throw Error('Use HTTPS or a local test server');
const directory = resolve(options.out || 'chipvoice-song');
await mkdir(directory, { recursive: true });
const deadline = Date.now() + 720000;
async function api(path, method = 'GET', body, requestKey) {
  const response = await fetch(new URL(path, base), {
    method, headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(requestKey ? { 'Idempotency-Key': requestKey } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  if (!response.ok) throw Error('Chipvoice HTTP ' + response.status + ': ' + (value.error || 'request failed') + '. Keep this output directory to retry safely.');
  return value;
}
const profile = await api('/api/v1/profile');
if (options.visibility === 'public' && !profile.handle) throw Error('Set your artist handle with PUT /api/v1/profile before public sharing');
const capabilities = await api('/api/v1/capabilities');
const visibility = options.visibility || 'private';
if (!['private','unlisted','public'].includes(visibility)) throw Error('Choose private, unlisted or public');
const target = options.target || 'md';
if (options.prompt && !capabilities.targets.some(item => item.id === target)) throw Error('Choose a target from /api/v1/capabilities');
const body = options.prompt ? { prompt: options.prompt, target, durationSeconds: Number(options.seconds || 60), visibility }
  : { project: JSON.parse(await readFile(options.project, 'utf8')), visibility, ...(options.parent ? { parentId: options.parent } : {}) };
const fingerprint = createHash('sha256').update(JSON.stringify({ base: base.origin, artist: profile.id, body })).digest('hex');
const stateFile = resolve(directory, 'request.json');
let state;
try { state = JSON.parse(await readFile(stateFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (state && state.fingerprint !== fingerprint) throw Error('This output directory belongs to another request. Choose another --out directory');
state ||= { fingerprint, key: randomUUID() };
await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
let publication, render;
async function wait(path, initial, done) {
  let value = initial, previous;
  while (!done(value)) {
    if (['failed','cancelled'].includes(value.status) || ['failed','cancelled'].includes(value.mp3Status)) throw Error('The request ended as ' + value.status + ': ' + (value.error || 'no audio produced'));
    if (Date.now() >= deadline) throw Error('The request timed out. Re-run with this directory to resume; do not create a duplicate');
    if (value.status !== previous) { console.error(value.status); previous = value.status; }
    await new Promise(resolve => setTimeout(resolve, 2000));
    value = await api(path);
  }
  return value;
}
if (options.prompt) {
  const initial = await api('/api/v1/generations', 'POST', body, state.key);
  const generated = await wait('/api/v1/generations/' + encodeURIComponent(initial.id), initial, job => job.status === 'ready');
  publication = generated.project; render = generated.render;
} else {
  publication = await api('/api/v1/projects', 'POST', body, state.key);
  const initial = await api('/api/v1/projects/' + encodeURIComponent(publication.id) + '/render', 'POST', { kind: 'full' });
  render = await wait('/api/v1/jobs/' + encodeURIComponent(initial.id), initial, job => job.status === 'ready' && job.mp3Status === 'ready');
}
const audio = await fetch(new URL('/api/v1/jobs/' + encodeURIComponent(render.id) + '/audio?format=mp3', base), { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(60000) });
if (!audio.ok || !audio.headers.get('content-type')?.includes('audio/mpeg')) throw Error('The full MP3 download failed; retry with this output directory');
const mp3 = resolve(directory, 'song.mp3');
await writeFile(mp3, new Uint8Array(await audio.arrayBuffer()));
await writeFile(resolve(directory, 'project.json'), JSON.stringify(publication.project, null, 2));
const result = { title: publication.title, projectId: publication.id, songUrl: new URL('/p/' + publication.id, base).href, artistUrl: profile.handle ? new URL('/u/' + profile.handle, base).href : null, visibility: publication.visibility, origin: publication.origin, mp3 };
await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
