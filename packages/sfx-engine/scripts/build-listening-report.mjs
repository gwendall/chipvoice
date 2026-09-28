#!/usr/bin/env node
/**
 * Builds the self-contained listening report: every named preset rendered
 * at several seeds, encoded to Ogg Vorbis (via ffmpeg's native encoder),
 * next to one HTML page that plays them, grouped by family, with each
 * sound's recipe JSON (collapsible), measured LUFS/true peak/duration and
 * render time. Written outside this package (a scratchpad path, not
 * `dist`/`docs`), since it is quality evidence for a human to listen to,
 * not part of the shipped package.
 *
 * Tries 4 seeds per preset first; if the encoded audio's total size would
 * exceed the 15 MB budget, falls back to 2 seeds (both per this ticket's
 * brief). In practice these are short one-shot sounds (most under a
 * second) and Ogg's own per-file header overhead dominates a short clip's
 * size far more than its bitrate does, so 4 seeds fits comfortably - see
 * the printed total at the end.
 *
 *   pnpm listen
 *   pnpm listen -- --out /custom/path
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PRESETS, recipeForPreset, renderRecipe } from '../dist/index.js';

const DEFAULT_OUT = '/private/tmp/claude-501/-Users-gwendall-Code-chipvoice/1ff194c9-e1a3-4ca0-b5c9-8d9e17a71738/scratchpad/gs-02-engine/listen';
const argOut = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const OUT_DIR = argOut ?? DEFAULT_OUT;
const AUDIO_DIR = join(OUT_DIR, 'audio');
const SIZE_BUDGET_BYTES = 15 * 1024 * 1024;
const BITRATE = '96k';

const ffmpegProbe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (ffmpegProbe.status !== 0) {
  console.error('ffmpeg not found on PATH; the listening report needs it to encode Ogg Vorbis.');
  process.exit(1);
}

function f64ToStereoWav(left, right, sampleRate) {
  const n = left.length;
  const dataLen = n * 8;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    buf.writeFloatLE(left[i], 44 + i * 8);
    buf.writeFloatLE(right[i], 44 + i * 8 + 4);
  }
  return buf;
}

function encodeOgg(wavPath, oggPath) {
  const result = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-c:a', 'vorbis', '-b:a', BITRATE, '-strict', 'experimental', oggPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed encoding ${oggPath}:\n${result.stderr}`);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) total += statSync(join(dir, entry)).size;
  return total;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Renders every preset at `seeds`, encoding each to Ogg Vorbis under
 * `AUDIO_DIR`. Returns `{ families, totalBytes }` ready for the HTML
 * template. Wipes and rebuilds `AUDIO_DIR` each call, so a retry at fewer
 * seeds starts clean. */
function buildAudio(seeds) {
  rmSync(AUDIO_DIR, { recursive: true, force: true });
  mkdirSync(AUDIO_DIR, { recursive: true });

  const byFamily = new Map();
  for (const p of PRESETS) {
    if (!byFamily.has(p.family)) byFamily.set(p.family, []);
    const variants = [];
    for (const seed of seeds) {
      const recipe = recipeForPreset(p.id, seed, 48000);
      const rendered = renderRecipe(recipe);
      const wavPath = join(AUDIO_DIR, `${p.id}-seed${seed}.wav`);
      const oggName = `${p.id}-seed${seed}.ogg`;
      writeFileSync(wavPath, f64ToStereoWav(rendered.left, rendered.right, rendered.sampleRate));
      encodeOgg(wavPath, join(AUDIO_DIR, oggName));
      rmSync(wavPath);
      variants.push({
        seed,
        oggPath: `audio/${oggName}`,
        durationSeconds: rendered.durationSeconds,
        renderTimeMs: rendered.renderTimeMs,
        momentaryLufs: rendered.loudness.momentaryLufsAfter,
        truePeakDb: rendered.loudness.truePeakDbAfter,
        cappedByPeak: rendered.loudness.cappedByPeak,
        recipe,
      });
    }
    byFamily.get(p.family).push({ id: p.id, description: p.description, model: p.model, variants });
  }

  return { byFamily, totalBytes: dirSize(AUDIO_DIR) };
}

let seeds = [1, 2, 3, 4];
let { byFamily, totalBytes } = buildAudio(seeds);
if (totalBytes > SIZE_BUDGET_BYTES) {
  console.log(`4 seeds/preset produced ${(totalBytes / 1e6).toFixed(2)} MB, over the 15 MB budget; retrying with 2 seeds/preset.`);
  seeds = [1, 2];
  ({ byFamily, totalBytes } = buildAudio(seeds));
}
if (totalBytes > SIZE_BUDGET_BYTES) {
  console.error(`Even 2 seeds/preset produced ${(totalBytes / 1e6).toFixed(2)} MB, still over the 15 MB budget.`);
  process.exit(1);
}

const FAMILY_LABELS = {
  ui: 'UI', impact: 'Impact / hit', footstep: 'Footstep', whoosh: 'Whoosh / swing',
  explosion: 'Explosion', scifi: 'Sci-fi', magic: 'Magic / fantasy', pickup: 'Pickup / reward',
};
const FAMILY_ORDER = ['ui', 'impact', 'footstep', 'whoosh', 'explosion', 'scifi', 'magic', 'pickup'];

function renderPresetCard(preset) {
  const seedOptions = preset.variants.map((v) => `<option value="${v.seed}">seed ${v.seed}</option>`).join('');
  const dataAttr = esc(JSON.stringify(preset.variants));
  return `
    <div class="card" data-preset="${esc(preset.id)}" data-variants='${dataAttr}'>
      <div class="card-head">
        <span class="preset-id">${esc(preset.id)}</span>
        <span class="model-tag">${esc(preset.model)}</span>
      </div>
      <p class="desc">${esc(preset.description)}</p>
      <div class="controls">
        <audio controls preload="none"></audio>
        <select class="seed-select" aria-label="seed">${seedOptions}</select>
      </div>
      <div class="stats"></div>
      <details class="recipe">
        <summary>recipe JSON</summary>
        <pre class="recipe-json"></pre>
      </details>
    </div>`;
}

const sections = FAMILY_ORDER.filter((f) => byFamily.has(f)).map((family) => {
  const presets = byFamily.get(family);
  return `
  <section class="family" id="family-${family}">
    <h2>${esc(FAMILY_LABELS[family] ?? family)} <span class="count">(${presets.length})</span></h2>
    <div class="grid">
      ${presets.map(renderPresetCard).join('\n')}
    </div>
  </section>`;
}).join('\n');

const totalPresets = PRESETS.length;
const totalVariants = totalPresets * seeds.length;
const generatedAt = new Date().toISOString();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>sfx-engine listening report</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: #14161a; color: #e6e6e6;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  header { max-width: 960px; margin: 0 auto 24px; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header p { margin: 4px 0; color: #9aa0a6; }
  nav { max-width: 960px; margin: 0 auto 24px; display: flex; flex-wrap: wrap; gap: 8px; }
  nav a {
    color: #c9d1d9; text-decoration: none; background: #1e2228; border: 1px solid #2c313a;
    border-radius: 6px; padding: 4px 10px; font-size: 12px;
  }
  nav a:hover { background: #262b33; }
  section.family { max-width: 960px; margin: 0 auto 32px; }
  section.family h2 { font-size: 16px; border-bottom: 1px solid #2c313a; padding-bottom: 8px; }
  .count { color: #9aa0a6; font-weight: normal; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
  .card { background: #1a1d23; border: 1px solid #2c313a; border-radius: 8px; padding: 12px; }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .preset-id { font-weight: 600; font-family: ui-monospace, monospace; font-size: 13px; }
  .model-tag { font-size: 11px; color: #9aa0a6; }
  .desc { margin: 6px 0 10px; color: #b7bcc3; font-size: 12.5px; }
  .controls { display: flex; align-items: center; gap: 8px; }
  .controls audio { flex: 1; height: 32px; }
  .seed-select { background: #22262d; color: #e6e6e6; border: 1px solid #2c313a; border-radius: 4px; padding: 4px; font-size: 12px; }
  .stats { margin-top: 8px; font-family: ui-monospace, monospace; font-size: 11.5px; color: #9aa0a6; display: flex; flex-wrap: wrap; gap: 10px; }
  .stats b { color: #e6e6e6; }
  details.recipe { margin-top: 8px; }
  details.recipe summary { cursor: pointer; font-size: 12px; color: #8ab4f8; }
  .recipe-json {
    margin: 6px 0 0; padding: 8px; background: #0e1013; border-radius: 6px; overflow-x: auto;
    font-size: 11px; max-height: 220px; white-space: pre-wrap; word-break: break-word;
  }
  footer { max-width: 960px; margin: 32px auto; color: #6b7078; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>sfx-engine listening report</h1>
  <p>${totalPresets} presets &times; ${seeds.length} seed${seeds.length > 1 ? 's' : ''} (${seeds.join(', ')}) = ${totalVariants} renders, ${(totalBytes / 1e6).toFixed(2)} MB of Ogg Vorbis. Generated ${esc(generatedAt)}.</p>
  <p>House loudness convention: at most -18 LUFS momentary, true peak at most -1 dBTP (peak cap wins when tighter). Every card below shows the seed's own measured values, not a target.</p>
  <p>Cut from this ticket's scope: the stretch families (water, fire, door, mechanical) were left out to keep depth over breadth on the required families; voices, animals and music are out of scope entirely (see docs/GAMESOUNDS-ENGINE.md).</p>
</header>
<nav>
  ${FAMILY_ORDER.filter((f) => byFamily.has(f)).map((f) => `<a href="#family-${f}">${esc(FAMILY_LABELS[f] ?? f)} (${byFamily.get(f).length})</a>`).join('\n  ')}
</nav>
${sections}
<footer>sfx-engine, packages/sfx-engine in the chipvoice monorepo. Every sound here is rendered offline from a recipe (model + params) and an integer seed; the same recipe and seed render bit-identical PCM in Node, Chromium, Firefox and WebKit (see parity/check.mjs).</footer>
<script>
function formatStats(v) {
  const peak = v.cappedByPeak ? ' (peak-capped)' : '';
  return '<span>LUFS <b>' + v.momentaryLufs.toFixed(2) + '</b></span>' +
    '<span>true peak <b>' + v.truePeakDb.toFixed(2) + ' dBTP</b>' + peak + '</span>' +
    '<span>duration <b>' + v.durationSeconds.toFixed(3) + 's</b></span>' +
    '<span>render <b>' + v.renderTimeMs.toFixed(2) + ' ms</b></span>';
}
document.querySelectorAll('.card').forEach((card) => {
  const variants = JSON.parse(card.dataset.variants);
  const audio = card.querySelector('audio');
  const select = card.querySelector('.seed-select');
  const stats = card.querySelector('.stats');
  const recipeJson = card.querySelector('.recipe-json');
  function show(seed) {
    const v = variants.find((x) => String(x.seed) === String(seed)) ?? variants[0];
    audio.src = v.oggPath;
    stats.innerHTML = formatStats(v);
    recipeJson.textContent = JSON.stringify(v.recipe, null, 2);
  }
  select.addEventListener('change', () => show(select.value));
  show(variants[0].seed);
});
</script>
</body>
</html>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'index.html'), html);

console.log(`Listening report written to ${OUT_DIR}`);
console.log(`  ${totalPresets} presets x ${seeds.length} seeds (${seeds.join(', ')}) = ${totalVariants} Ogg Vorbis files, ${(totalBytes / 1e6).toFixed(2)} MB total (budget 15 MB).`);
console.log(`  Open ${join(OUT_DIR, 'index.html')} in a browser.`);
