import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const harness = resolve(root, 'parity/harness.html');

const MIME = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.html': 'text/html', '.map': 'application/json' };

/**
 * Serves the harness page at `/` and the built package at `/dist/*`, on an
 * ephemeral port (`listen(0, ...)`), so nothing here collides with a port
 * anything else on this shared machine might be using. Mirrors
 * scores/render-parity/browser-render.mjs's own local static server -
 * see that file's doc comment for why: the harness imports `renderRecipe`
 * straight from `dist/index.js`, the same module Node imports, so this
 * never needs any app's build.
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
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
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
 * `installed: false` rather than throwing, so a caller missing one engine
 * can still run the rest of the matrix; `check.mjs` decides whether that is
 * a warning or a failure depending on whether it is running in CI.
 *
 * Follows this repo's (and CLAUDE.md's) Playwright discipline throughout:
 * `waitUntil: 'domcontentloaded'` never `'networkidle'`, a hard timeout
 * guard that force-closes the browser and server if a page ever hangs, and
 * `browser.close()`/`server.close()` in a `finally` block so nothing is
 * left running no matter how this exits.
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
    await page.goto(harnessUrl(port, perturb), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.renderParityReady === true, null, { timeout: 30000 });
    const results = await page.evaluate((data) => window.renderParityRun(data), inputs);
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
 * Takes the same optional `perturb` so a self-test's diagnosis pass
 * reproduces the same corrupted sample the initial pass saw.
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
    const raw = await page.evaluate((data) => window.renderParityRenderOne(data), input);
    return {
      sampleRate: raw.sampleRate,
      left: Float64Array.from(raw.left),
      right: Float64Array.from(raw.right),
    };
  } finally {
    clearTimeout(guard);
    await browser.close();
    server.close();
  }
}
