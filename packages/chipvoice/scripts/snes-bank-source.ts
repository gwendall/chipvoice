// Original chipvoice factory sample recipes. Build time only; no game audio.
import { encodeBrr } from "../src/chips/snes/brr.js";
const RATE = 32000;
/** A single-cycle waveform of `length` samples: one period, looped. */
function cycle(length: number, shape: (phase: number) => number): Int16Array {
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, shape(i / length))) * 28000);
  return out;
}

/** A deterministic noise, the same on every machine. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000 * 2 - 1;
  };
}

/** Two blended exponential decays: a fast one for the punch, a slow one for the tail. */
function twoStage(t: number, fastRate: number, slowRate: number, fastWeight: number): number {
  return fastWeight * Math.exp(-t * fastRate) + (1 - fastWeight) * Math.exp(-t * slowRate);
}

/** A few milliseconds of decaying, high-passed noise: the transient click at an onset. */
function click(rnd: () => number, n: number, rate: number): Float64Array {
  const out = new Float64Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const white = rnd();
    const bright = white - last;
    last = white;
    out[i] = bright * Math.exp(-t * rate);
  }
  return out;
}

function kick(): Int16Array {
  const n = Math.round(RATE * 0.28);
  const out = new Int16Array(n);
  const rnd = noise(5);
  const clickPart = click(rnd, Math.min(n, Math.round(RATE * 0.006)), 500);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const hz = 46 + 130 * Math.exp(-t * 32);
    phase += (2 * Math.PI * hz) / RATE;
    const body = Math.sin(phase) * twoStage(t, 16, 4.2, 0.75);
    const attackClick = (clickPart[i] ?? 0) * 0.35;
    out[i] = Math.round(Math.max(-1, Math.min(1, body + attackClick)) * 30500);
  }
  return out;
}

function snare(): Int16Array {
  const n = Math.round(RATE * 0.24);
  const out = new Int16Array(n);
  const rndHiss = noise(7);
  const rndClick = noise(17);
  const clickPart = click(rndClick, Math.min(n, Math.round(RATE * 0.004)), 700);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const tone = (Math.sin(2 * Math.PI * 185 * t) + 0.4 * Math.sin(2 * Math.PI * 330 * t)) * twoStage(t, 34, 9, 0.7) * 0.42;
    const white = rndHiss();
    const bright = (white - last) * 0.6;
    last = white;
    const hiss = bright * twoStage(t, 32, 10, 0.55) * 0.62;
    const onset = (clickPart[i] ?? 0) * 0.3;
    out[i] = Math.round(Math.max(-1, Math.min(1, tone + hiss + onset)) * 30500);
  }
  return out;
}

function hat(seconds: number, seed: number): Int16Array {
  const n = Math.round(RATE * seconds);
  const out = new Int16Array(n);
  const rnd = noise(seed);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const white = rnd();
    // A first difference is a high-pass: the metal, not the sand.
    const bright = (white - last) * 0.5;
    last = white;
    out[i] = Math.round(Math.max(-1, Math.min(1, bright * Math.exp(-t * (6 / seconds)))) * 28000);
  }
  return out;
}

/** The bank: names the arranger uses. */
function legacyBank() {
  const rnd = noise(3);
  return [
    { name: "sine", loop: true, pcm: cycle(32, (p) => Math.sin(2 * Math.PI * p)) },
    { name: "tri", loop: true, pcm: cycle(32, (p) => (p < 0.5 ? 4 * p - 1 : 3 - 4 * p)) },
    { name: "saw", loop: true, pcm: cycle(32, (p) => 2 * p - 1) },
    { name: "square", loop: true, pcm: cycle(32, (p) => (p < 0.5 ? 0.8 : -0.8)) },
    { name: "sine64", loop: true, pcm: cycle(64, (p) => Math.sin(2 * Math.PI * p)) },
    { name: "square64", loop: true, pcm: cycle(64, (p) => (p < 0.5 ? 0.7 : -0.7)) },
    { name: "saw64", loop: true, pcm: cycle(64, (p) => 2 * p - 1) },
    { name: "kick", loop: false, pcm: kick() },
    { name: "snare", loop: false, pcm: snare() },
    { name: "hat", loop: false, pcm: hat(0.06, 11) },
    { name: "ohat", loop: false, pcm: hat(0.2, 13) },
    // A noise sample for a percussion voice that names none of the drums.
    { name: "noise", loop: true, pcm: (() => { const o = new Int16Array(256); for (let i = 0; i < 256; i++) o[i] = Math.round(rnd() * 20000); return o; })() },
  ].map(entry => ({ ...entry, baseHz:entry.name.endsWith("64") ? RATE/64 : ["sine","tri","saw","square"].includes(entry.name) ? RATE/32 : 0 }));
}

interface Recipe {
  name: string;
  period: number;
  attackCycles: number;
  harmonics: number[];
  transient: number[];
  swell: number;
  sustain: number;
  adsr1: number;
  adsr2: number;
  /** Length of the sustain loop, in cycles of `period`. Only pays off when `unison > 1`. */
  loopCycles: number;
  /** Detuned copies summed per harmonic. 1 leaves the harmonic exactly on pitch. */
  unison: number;
  /** Spread across the unison voices, in cents, at the fundamental. */
  detuneCents: number;
  /** Breath/pick noise blended into the attack only; fades to zero at the loop point. */
  noiseMix: number;
}
// Harmonic families, not recordings of acoustic instruments. The attack sheds
// upper partials into a periodic sustain. Whole-cycle boundaries make looping
// predictable; encoding still gets evaluated through the independent DSP.
//
// Every partial is a sum of one or more unison voices, each an integer number
// of cycles over the *loop*, not the period: for voice offset 0 that integer
// is exactly (partial+1)*loopCycles, the same frequency the period-based math
// would give, so the carrier is one continuous periodic function of loopCycles
// cycles across the whole sample - attack included - with no seam at the loop
// point. Detuned voices (offset != 0) are additional integers near that one,
// so they too repeat exactly every loopCycles cycles: a chorus-like slow beat
// between voices that is nonetheless a perfectly periodic BRR loop, not an
// approximation of one. Widening `unison`/`detuneCents` only pays for bytes
// when `loopCycles` is also raised enough to resolve the detune as distinct
// bins (bin spacing is baseHz/loopCycles); recipes with `unison: 1` keep
// `loopCycles` small since there is nothing for a longer loop to resolve.
const RECIPES: Recipe[] = [
  { name: 'flute', period: 64, attackCycles: 16, harmonics: [1, .12, .19, .035, .035], transient: [.12, .12, .08, .02], swell: .18, sustain: .95, adsr1: 0x9e, adsr2: 0xc0, loopCycles: 4, unison: 1, detuneCents: 0, noiseMix: .05 },
  { name: 'brass', period: 64, attackCycles: 18, harmonics: [1, .5, .34, .22, .16, .11, .07, .04], transient: [0, .32, .3, .24, .2, .14, .08], swell: .1, sustain: .85, adsr1: 0xae, adsr2: 0xa0, loopCycles: 168, unison: 3, detuneCents: 11, noiseMix: .07 },
  { name: 'mallet', period: 64, attackCycles: 32, harmonics: [1, .08, .22, .03, .1], transient: [.1, .3, .65, .12, .4, .1, .22], swell: .018, sustain: .55, adsr1: 0x8f, adsr2: 0x80, loopCycles: 4, unison: 1, detuneCents: 0, noiseMix: 0 },
  { name: 'harp', period: 64, attackCycles: 32, harmonics: [1, .25, .12, .08], transient: [.15, .55, .48, .3, .2, .15, .08], swell: .015, sustain: .5, adsr1: 0x8f, adsr2: 0xa0, loopCycles: 4, unison: 1, detuneCents: 0, noiseMix: 0 },
  { name: 'strings', period: 64, attackCycles: 20, harmonics: [1, .42, .32, .22, .16, .11, .07], transient: [0, .14, .12, .09], swell: .35, sustain: .95, adsr1: 0x9c, adsr2: 0xc0, loopCycles: 168, unison: 3, detuneCents: 13, noiseMix: .03 },
  { name: 'picked-bass', period: 128, attackCycles: 8, harmonics: [1, .26, .15, .07, .03], transient: [0, .5, .4, .18, .1], swell: .018, sustain: .8, adsr1: 0x8f, adsr2: 0xc0, loopCycles: 84, unison: 2, detuneCents: 8, noiseMix: .04 },
  { name: 'reed-bass', period: 128, attackCycles: 8, harmonics: [1, .06, .4, .04, .16, .02, .06], transient: [0, .12, .18, .08], swell: .035, sustain: .7, adsr1: 0x9f, adsr2: 0xc0, loopCycles: 4, unison: 1, detuneCents: 0, noiseMix: 0 },
  { name: 'synth-bass', period: 128, attackCycles: 8, harmonics: [1, .5, .26, .16, .08], transient: [0, .3, .3, .24, .15, .1], swell: .02, sustain: .65, adsr1: 0x9f, adsr2: 0xc0, loopCycles: 4, unison: 1, detuneCents: 0, noiseMix: 0 },
];

/**
 * Integer cycle-offsets for `n` unison voices, one bin apart, centred on
 * zero. An even count has no exact centre bin, so it uses `[-1, 1]` rather
 * than `[0, 1]`: two voices equally off pitch in opposite directions, not
 * one exactly on pitch and one carrying the whole detune. That keeps a
 * pitch estimator (this file's own build check, and a portable score's own
 * tuner) reading the *centre* of the pair, not biased toward the one voice
 * that happened to land on the nominal frequency.
 */
function unisonOffsets(n: number): number[] {
  if (n <= 1) return [0];
  if (n === 2) return [-1, 1];
  const out: number[] = [];
  const start = -Math.floor((n - 1) / 2);
  for (let i = 0; i < n; i++) out.push(start + i);
  return out;
}

function instrument(recipe: Recipe) {
  const loopSampleOffset = recipe.period * recipe.attackCycles;
  const loopLength = recipe.period * recipe.loopCycles;
  const pcm = new Int16Array(loopSampleOffset + loopLength);
  const partials = Math.max(recipe.harmonics.length, recipe.transient.length);
  const offsets = unisonOffsets(recipe.unison);
  // Bin width is RATE/loopLength = baseHz/loopCycles; a `detuneCents` step at
  // the fundamental is baseHz*(2^(cents/1200)-1) Hz, so in bins that step is
  // loopCycles*(2^(cents/1200)-1) - independent of RATE and of `period`.
  const spreadBins = recipe.unison > 1 && recipe.detuneCents > 0
    ? Math.max(1, Math.round(recipe.loopCycles * (Math.pow(2, recipe.detuneCents / 1200) - 1)))
    : 0;
  const rnd = noise(recipe.name.length * 101 + 13);
  const raw = new Float64Array(pcm.length);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const position = Math.min(1, i / loopSampleOffset);
    const decay = (1 - position) ** 3;
    const attack = Math.min(1, position / recipe.swell);
    const envelope = attack * (recipe.sustain + (1 - recipe.sustain) * decay);
    let value = 0;
    for (let partial = 0; partial < partials; partial++) {
      const amplitude = (recipe.harmonics[partial] ?? 0) + (recipe.transient[partial] ?? 0) * decay;
      if (amplitude === 0) continue;
      let voiceSum = 0;
      for (const offset of offsets) {
        const bin = (partial + 1) * recipe.loopCycles + offset * spreadBins;
        voiceSum += Math.sin((2 * Math.PI * bin * i) / loopLength);
      }
      value += (amplitude * voiceSum) / offsets.length;
    }
    const breath = recipe.noiseMix > 0 ? rnd() * recipe.noiseMix * decay : 0;
    raw[i] = envelope * (value + breath);
    peak = Math.max(peak, Math.abs(raw[i]));
  }
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round((raw[i] * 28000) / peak);
  return { name: recipe.name, pcm, loop: true, loopSampleOffset, baseHz: RATE / recipe.period, adsr1: recipe.adsr1, adsr2: recipe.adsr2 };
}

export function compileFactoryBank() {
  const entries=[...legacyBank().map(entry=>({...entry,loopSampleOffset:0,adsr1:0xff,adsr2:0xe0})),...RECIPES.map(instrument)];
  const encoded=entries.map(entry=>encodeBrr(entry.pcm,entry.loop,entry.loopSampleOffset));
  const image=new Uint8Array(0x400+encoded.reduce((size,bytes)=>size+bytes.length,0));
  const metadata=[];
  let address=0x400;
  for(let i=0;i<entries.length;i++){
    const entry=entries[i],bytes=encoded[i],loopAddress=address+(entry.loopSampleOffset/16)*9;
    image.set(bytes,address);
    const directory=0x200+i*4;
    image[directory]=address&255;image[directory+1]=address>>8;
    image[directory+2]=loopAddress&255;image[directory+3]=loopAddress>>8;
    metadata.push({name:entry.name,baseHz:entry.baseHz,loop:entry.loop,start:address,loopAddress,bytes:bytes.length,adsr1:entry.adsr1,adsr2:entry.adsr2});
    address+=bytes.length;
  }
  if(address>0xe000)throw new Error('Factory bank overlaps the echo buffer');
  return {image,metadata,entries,encoded};
}
