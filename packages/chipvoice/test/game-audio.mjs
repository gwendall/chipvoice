import { trimRender, scaleRender, levelRender, packSprite, renderOnset, renderMdEvents, compileMdVoices, MD_PATCHES, MD1_PROFILE, MD_BRIGHT_PROFILE } from '../dist/index.js';

/**
 * The steps between a render and the files a game ships: trim, level, pack
 * the effects into a sprite, measure the onset. Each on a signal whose answer
 * is known, and none writes to its input.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const SR = 1000;
/** A render from a function of the sample index. */
function signal(n, f, stereo = true) {
  const left = Float32Array.from({ length: n }, (_, i) => f(i));
  const right = stereo ? Float32Array.from({ length: n }, (_, i) => f(i) * 0.5) : null;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), right ? Math.abs(right[i]) : 0);
  return { sampleRate: SR, left, right, seconds: n / SR, peak };
}

// ---- trim

{
  // a tone for 200 samples, then silence
  const r = signal(1000, (i) => (i < 200 ? Math.sin(i / 3) * 0.8 : 0));
  const before = r.left.slice();
  const t = trimRender(r);
  check('trims where the sound dies, plus the fade', t.left.length === 200 + 5, `${t.left.length} samples`);
  check('the fade ends on zero', t.left.at(-1) === 0 && t.right.at(-1) === 0);
  check('the input is left alone', r.left.length === 1000 && r.left.every((x, i) => x === before[i]));
  check('seconds and peak follow the new length', t.seconds === t.left.length / SR && t.peak > 0.7 && t.peak <= 0.8);
  const tail = signal(1000, (i) => (i < 200 ? 1 : i < 400 ? 0.01 : 0));
  check('a tail 40 dB down is kept over the default -60 dB floor', trimRender(tail).left.length === 400 + 5);
  check('and cut with a -30 dB floor', trimRender(tail, { floorDb: -30 }).left.length === 200 + 5);
  const m = trimRender(signal(300, (i) => (i < 100 ? 1 : 0), false), { fadeSeconds: 0.01 });
  check('mono renders, and the fade length', m.right === null && m.left.length === 110);
}

// ---- scale and level

{
  const r = signal(100, (i) => (i % 2 ? 0.5 : -0.25));
  const s = scaleRender(r, 2);
  check('scale multiplies every sample and the peak', s.left[1] === 1 && s.right[1] === 0.5 && s.peak === 1 && r.left[1] === 0.5);
  const p = levelRender(r, { peak: 0.89 });
  check('without a loudness, the peak is the target', Math.abs(p.peak - 0.89) < 1e-6);
  // RMS of the square: both channels, left ±0.5/0.25 and right half that
  const rms = Math.sqrt((0.5 ** 2 + 0.25 ** 2 + 0.25 ** 2 + 0.125 ** 2) / 4);
  const l = levelRender(r, { peak: 0.95, rmsDb: -20 });
  check('a loudness under the ceiling is reached', Math.abs(l.left[1] - 0.5 * (0.1 / rms)) < 1e-6);
  const c = levelRender(r, { peak: 0.6, rmsDb: 0 });
  check('a loudness past the ceiling stops at the ceiling', Math.abs(c.peak - 0.6) < 1e-6);
  const z = levelRender(signal(10, () => 0), { peak: 1, rmsDb: -10 });
  check('silence stays silence, no NaN', z.left.every((x) => x === 0));
}

// ---- the sprite

{
  const a = signal(100, () => 0.5), b = signal(50, () => -0.5), c = signal(30, () => 0.25, false);
  const { render, sprites } = packSprite([['a', a], ['b', b], ['c', c]], { gapSeconds: 0.01 });
  check('gaps before, between and after', render.left.length === 10 + 100 + 10 + 50 + 10 + 30 + 10);
  check('offsets and durations in seconds', sprites.a.start === 0.01 && sprites.a.duration === 0.1 && sprites.b.start === 0.12 && sprites.c.start === 0.18 && sprites.c.duration === 0.03);
  check('each sound where its offset says', render.left[10] === 0.5 && render.left[109] === 0.5 && render.left[110] === 0 && render.left[120] === -0.5);
  check('a mono part fills both sides of a stereo sprite', render.right[180] === 0.25);
  const throws = (f) => { try { f(); return false; } catch { return true; } };
  check('a name given twice is refused', throws(() => packSprite([['a', a], ['a', b]])));
  check('mixed sample rates are refused', throws(() => packSprite([['a', a], ['b', { ...b, sampleRate: 2000 }]])));
  check('the default gap is 0.15 seconds', packSprite([['a', a]]).sprites.a.start === 0.15);
}

// ---- onset

{
  const r = signal(1000, (i) => (i < 40 ? 0 : i < 50 ? 0.1 : 0.8));
  check('the onset is the first sample at a quarter of the opening\'s peak', renderOnset(r) === 50 / SR);
  check('a lower fraction finds the quiet lead-in', renderOnset(r, { fraction: 0.1 }) === 40 / SR);
  check('the window bounds the search', renderOnset(r, { windowSeconds: 0.045 }) === 40 / SR);
  check('silence starts at zero', renderOnset(signal(100, () => 0)) === 0);
}

// ---- the render itself

{
  const { events } = compileMdVoices([{ voice: 'noise', hits: [{ at: 0, until: 0.3, envelope: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], rate: 1 }] }]);
  const dull = renderMdEvents(events, { seconds: 0.3, profile: MD1_PROFILE });
  const bright = renderMdEvents(events, { seconds: 0.3, profile: MD_BRIGHT_PROFILE });
  /** Energy in the sample-to-sample difference: the top end. */
  const top = (x) => { let e = 0; for (let i = 1; i < x.length; i++) e += (x[i] - x[i - 1]) ** 2; return e; };
  check('the bright profile keeps the top a Model 1 filters out', top(bright.left) > 4 * top(dull.left), `${(top(bright.left) / top(dull.left)).toFixed(1)}x`);
  check('the render is stereo, the asked length, peak measured', bright.right && bright.left.length === Math.round(0.3 * 44100) && bright.peak > 0);
  const quiet = renderMdEvents(events, { seconds: 0.3, profile: MD_BRIGHT_PROFILE, gain: 0.39 });
  check('gain scales the chip\'s output', Math.abs(quiet.peak / bright.peak - 0.5) < 0.01, (quiet.peak / bright.peak).toFixed(3));
  const tone = renderMdEvents(compileMdVoices([{ voice: 'fm1', notes: [{ at: 0, until: 0.2, pitch: 69, patch: MD_PATCHES.bell }] }]).events, { seconds: 1, sampleRate: 22050 });
  const t = trimRender(tone);
  check('a bell rendered then trimmed ends before the second is out', t.left.length < tone.left.length && t.sampleRate === 22050);
  const throws = (f) => { try { f(); return false; } catch { return true; } };
  check('a render with no length is refused', throws(() => renderMdEvents(events, { seconds: 0 })));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
