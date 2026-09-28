import { renderSfx, renderOnset, trimRender } from '../dist/index.js';

/**
 * `renderSfx` plays one `Chip.sfx()` call offline. Each check is on a signal
 * whose answer is known: a click on a noise voice, a held tone, a delay.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const throws = (f) => { try { f(); return false; } catch { return true; } };

const CLICK = { channel: 'noi', note: 8, duration: 0.05, instrument: { volume: [15, 12, 8, 4, 1], noiseMode: true } };
const TONE = (channel) => ({ channel, note: 'A4', duration: 0.1, instrument: { volume: [15, 15, 15, 15, 15, 15, 15, 15, 15, 15], sustain: true } });

// ---- the basics

{
  const r = renderSfx('2a03', CLICK);
  check('a render at the default rate', r.sampleRate === 44100);
  check('length follows the default seconds (duration + 0.5s tail)', r.left.length === Math.round(0.55 * 44100));
  check('something actually sounded', r.peak > 0);
  check('mono unless stereo is asked for', r.right === null);
  const s = renderSfx('2a03', CLICK, { stereo: true });
  check('stereo duplicates a mono chip', s.right && s.right.every((x, i) => x === s.left[i]));
}

// ---- delay, duration and the seconds override

{
  const at0 = renderSfx('2a03', CLICK, { sampleRate: 8000 });
  const delayed = renderSfx('2a03', { ...CLICK, delay: 0.02 }, { sampleRate: 8000 });
  const onsetShift = renderOnset(delayed) - renderOnset(at0);
  check('delay shifts the onset by the same amount', Math.abs(onsetShift - 0.02) < 0.002, `${onsetShift.toFixed(4)}s`);
  const short = renderSfx('2a03', { ...CLICK, seconds: 0.06 });
  check('an explicit seconds overrides the default tail', short.left.length === Math.round(0.06 * 44100));
  check('duration must be positive', throws(() => renderSfx('2a03', { ...CLICK, duration: 0 })));
  check('seconds must be positive', throws(() => renderSfx('2a03', { ...CLICK, seconds: -1 })));
}

// ---- sustained notes release after their duration, not before

{
  const held = renderSfx('2a03', TONE('p1'));
  const trimmed = trimRender(held);
  check('a sustained note is cut off at release, not held to the render end', trimmed.left.length < held.left.length);
  check('but the note itself fills its duration', trimmed.left.length >= Math.round(0.1 * held.sampleRate));
}

// ---- gain

{
  const full = renderSfx('2a03', CLICK);
  const half = renderSfx('2a03', CLICK, { gain: 0.39 });
  check('the chip gain scales the output', Math.abs(half.peak / full.peak - 0.5) < 0.02, (half.peak / full.peak).toFixed(3));
}

// ---- every chip renders, and a bad chip or channel is refused

{
  const CHANNELS = { '2a03': 'p2', dmg: 'ch2', md: 'psg1', snes: 'v1', c64: 'v1' };
  for (const [chip, channel] of Object.entries(CHANNELS)) {
    const r = renderSfx(chip, { ...TONE(channel), duration: 0.05 });
    check(`${chip} renders on its own voice (${channel})`, r.peak > 0);
  }
  check('an unknown chip is refused, by name', throws(() => renderSfx('atari2600', CLICK)));
  check('an unknown channel is refused, by name', throws(() => renderSfx('2a03', { ...CLICK, channel: 'p5' })));
}

// ---- the C64's two SID models actually differ

{
  const a = renderSfx('c64', { ...TONE('v1'), model: '6581' });
  const b = renderSfx('c64', { ...TONE('v1'), model: '8580' });
  let diff = 0;
  for (let i = 0; i < Math.min(a.left.length, b.left.length); i++) diff += Math.abs(a.left[i] - b.left[i]);
  check('the 6581 and 8580 models render differently', diff > 0);
}

// ---- a recipe is what it says it is: the same call, with the chip attached

{
  const recipe = { chip: '2a03', ...CLICK };
  const fromSpec = renderSfx('2a03', CLICK);
  const fromRecipe = renderSfx(recipe.chip, recipe);
  check('a recipe round-trips to an identical render', fromRecipe.left.length === fromSpec.left.length && fromRecipe.left.every((x, i) => x === fromSpec.left[i]));
  const mislabeled = renderSfx('2a03', { chip: 'not-a-real-chip', ...CLICK });
  check('the first argument always picks the chip, even over the recipe\'s own field', mislabeled.peak > 0);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
