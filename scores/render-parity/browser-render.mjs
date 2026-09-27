import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { planToJSON } from './serialize.mjs';

const root = resolve(import.meta.dirname, '../..');
const dist = resolve(root, 'packages/chipvoice/dist');
const harness = resolve(root, 'scores/render-parity/harness.html');

const MIME = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.html': 'text/html', '.wasm': 'application/wasm' };

/**
 * Serves the harness page at `/` and the built package at `/dist/*`, on an
 * ephemeral port (`listen(0, ...)`), so nothing here collides with a port
 * anything else on this shared machine might be using. Nothing under
 * `apps/web` is served: the harness imports `renderPerformance` straight
 * from `dist/index.js`, the same module Node imports, so this never needs
 * the site's build at all.
 */
async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname === '/' ? harness : url.pathname.startsWith('/dist/') ? resolve(dist, '.' + url.pathname.slice('/dist'.length)) : null;
      if (!path || !path.startsWith(url.pathname === '/' ? root : dist)) { res.writeHead(404).end(); return; }
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  return server;
}

const ENGINES = { chromium, firefox, webkit };

/**
 * The harness URL, carrying the self-test perturbation flag when one is
 * given. `perturb` is `{id, sampleIndex, channel, delta}`: never set by a
 * normal comparison run, only by `self-test.mjs` proving the gate actually
 * fails on a real difference (see `harness.html`'s `selfTestPerturb`).
 */
function harnessUrl(port, perturb) {
  const url = new URL(`http://127.0.0.1:${port}/`);
  if (perturb) url.searchParams.set('selfTestPerturb', `${perturb.id}:${perturb.sampleIndex}:${perturb.channel ?? 'left'}:${perturb.delta}`);
  return url.toString();
}

/**
 * Renders the fixed input set inside one Playwright browser engine and
 * returns each input's PCM hash, the same shape Node's own render produces.
 * A browser without a locally installed binary resolves with
 * `installed: false` rather than throwing, so a caller that is missing one
 * engine (a workstation without Firefox/WebKit installed yet) can still run
 * the rest of the matrix; `check.mjs` decides whether that is a warning or a
 * failure depending on whether it is running in CI.
 */
export async function renderInBrowser(engineName, inputs, { perturb } = {}) {
  const engineType = ENGINES[engineName];
  if (!engineType) throw new Error(`unknown browser engine: ${engineName}`);
  const server = await startServer();
  const port = server.address().port;
  let browser;
  try {
    browser = await engineType.launch();
  } catch (error) {
    server.close();
    return { engine: engineName, installed: false, reason: error.message.split('\n')[0] };
  }
  // A hard budget: a hung page must not leave a browser process behind on a
  // shared machine (the exact failure mode CLAUDE.md's Playwright rules
  // exist to prevent).
  const guard = setTimeout(() => { void browser.close(); server.close(); }, 90000);
  try {
    const page = await browser.newPage();
    // domcontentloaded, not networkidle: the harness page has no continuous
    // rendering, but networkidle is still the wrong default to reach for.
    await page.goto(harnessUrl(port, perturb), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.renderParityReady === true, null, { timeout: 30000 });
    const payload = inputs.map(input => ({ id: input.id, chip: input.chip, plan: planToJSON(input.plan) }));
    const results = await page.evaluate(data => window.renderParityRun(data), payload);
    const version = browser.version();
    return { engine: engineName, installed: true, version, results };
  } finally {
    clearTimeout(guard);
    await browser.close();
    server.close();
  }
}

/**
 * Re-renders one input in one browser engine and returns its raw PCM, for
 * diagnosing a hash that has already come back different from Node's -
 * `renderInBrowser` deliberately does not carry samples for the whole set.
 * Takes the same optional `perturb` as `renderInBrowser` so a self-test's
 * diagnosis pass reproduces the same corrupted sample the initial pass saw,
 * instead of re-rendering a clean, misleadingly matching buffer.
 */
export async function renderOneInBrowser(engineName, input, { perturb } = {}) {
  const engineType = ENGINES[engineName];
  if (!engineType) throw new Error(`unknown browser engine: ${engineName}`);
  const server = await startServer();
  const port = server.address().port;
  const browser = await engineType.launch();
  const guard = setTimeout(() => { void browser.close(); server.close(); }, 60000);
  try {
    const page = await browser.newPage();
    await page.goto(harnessUrl(port, perturb), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.renderParityReady === true, null, { timeout: 30000 });
    const payload = { id: input.id, chip: input.chip, plan: planToJSON(input.plan) };
    const raw = await page.evaluate(data => window.renderParityRenderOne(data), payload);
    return {
      sampleRate: raw.sampleRate,
      left: Float32Array.from(raw.left),
      right: raw.right ? Float32Array.from(raw.right) : null,
    };
  } finally {
    clearTimeout(guard);
    await browser.close();
    server.close();
  }
}
