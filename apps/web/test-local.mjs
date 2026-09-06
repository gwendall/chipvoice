import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
// Every web check owns a production server and a disposable local database.
const directory = await mkdtemp(join(tmpdir(), 'chipvoice-web-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, VERCEL_ENV: 'preview', TURSO_DEV_DATABASE_URL: `file:${join(directory, 'songs.db')}`, TURSO_DEV_AUTH_TOKEN: '', DOMANI_API_KEY: '', API_URL: base, URL: base, SITE: base };
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(log);
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`Server did not start: ${log}`);
  for (const script of ['test-foundations.mjs', 'test-recording.mjs', 'test-creative.mjs', 'test-render-cache.mjs', 'test-api.mjs', 'test-auth-http.mjs', 'test-demo.mjs', 'test-creative-browser.mjs', 'test-audio-transitions.mjs', 'test-buffer-playback.mjs', 'test-lab.mjs']) {
    const child = spawn(process.execPath, [script], { env, stdio: 'inherit' });
    const code = await new Promise(resolve => child.on('exit', resolve));
    if (code !== 0) throw new Error(`${script} exited ${code}`);
  }
} catch (error) { console.error(error); console.error(log); process.exitCode = 1; }
finally { server.kill('SIGTERM'); await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve)); await rm(directory, { recursive: true, force: true }); }
