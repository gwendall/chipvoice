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

function kick(): Int16Array {
  const n = Math.round(RATE * 0.25);
  const out = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const hz = 40 + 110 * Math.exp(-t * 28);
    phase += (2 * Math.PI * hz) / RATE;
    out[i] = Math.round(Math.sin(phase) * Math.exp(-t * 9) * 30000);
  }
  return out;
}

function snare(): Int16Array {
  const n = Math.round(RATE * 0.2);
  const out = new Int16Array(n);
  const rnd = noise(7);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const tone = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5;
    const hiss = rnd() * Math.exp(-t * 14) * 0.6;
    out[i] = Math.round(Math.max(-1, Math.min(1, tone + hiss)) * 30000);
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
}
// Harmonic families, not recordings of acoustic instruments. The attack sheds
// upper partials into a periodic sustain. Whole-cycle boundaries make looping
// predictable; encoding still gets evaluated through the independent DSP.
const RECIPES: Recipe[] = [
  {name:'flute',period:64,attackCycles:16,harmonics:[1,.12,.19,.035,.035],transient:[.12,.12,.08,.02],swell:.18,sustain:.95,adsr1:0x9e,adsr2:0xc0},
  {name:'brass',period:64,attackCycles:16,harmonics:[1,.48,.32,.20,.14,.09,.05],transient:[0,.3,.28,.22,.18,.12],swell:.10,sustain:.85,adsr1:0xae,adsr2:0xa0},
  {name:'mallet',period:64,attackCycles:32,harmonics:[1,.08,.22,.03,.10],transient:[.1,.3,.65,.12,.4,.1,.22],swell:.018,sustain:.55,adsr1:0x8f,adsr2:0x80},
  {name:'harp',period:64,attackCycles:32,harmonics:[1,.25,.12,.08],transient:[.15,.55,.48,.30,.2,.15,.08],swell:.015,sustain:.5,adsr1:0x8f,adsr2:0xa0},
  {name:'strings',period:64,attackCycles:16,harmonics:[1,.38,.29,.18,.12,.08],transient:[0,.12,.1,.07],swell:.35,sustain:.95,adsr1:0x9c,adsr2:0xc0},
  {name:'picked-bass',period:128,attackCycles:8,harmonics:[1,.22,.12,.05],transient:[0,.5,.4,.18,.1],swell:.018,sustain:.8,adsr1:0x8f,adsr2:0xc0},
  {name:'reed-bass',period:128,attackCycles:8,harmonics:[1,.06,.4,.04,.16,.02,.06],transient:[0,.12,.18,.08],swell:.035,sustain:.7,adsr1:0x9f,adsr2:0xc0},
  {name:'synth-bass',period:128,attackCycles:8,harmonics:[1,.5,.26,.16,.08],transient:[0,.3,.3,.24,.15,.1],swell:.02,sustain:.65,adsr1:0x9f,adsr2:0xc0},
];
function instrument(recipe: Recipe) {
  const loopStart=recipe.period*recipe.attackCycles;
  const pcm=new Int16Array(loopStart+recipe.period*4);
  const partials=Math.max(recipe.harmonics.length,recipe.transient.length);
  const raw=new Float64Array(pcm.length);
  let peak=0;
  for(let i=0;i<pcm.length;i++){
    const position=Math.min(1,i/loopStart);
    const decay=(1-position)**3;
    const attack=Math.min(1,position/recipe.swell);
    const envelope=attack*(recipe.sustain+(1-recipe.sustain)*decay);
    let value=0;
    for(let partial=0;partial<partials;partial++){
      const amplitude=(recipe.harmonics[partial]??0)+(recipe.transient[partial]??0)*decay;
      value+=amplitude*Math.sin(2*Math.PI*(partial+1)*i/recipe.period);
    }
    raw[i]=envelope*value;peak=Math.max(peak,Math.abs(raw[i]));
  }
  for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(raw[i]*28000/peak);
  return {name:recipe.name,pcm,loop:true,loopStart,baseHz:RATE/recipe.period,adsr1:recipe.adsr1,adsr2:recipe.adsr2};
}
export function compileFactoryBank() {
  const entries=[...legacyBank().map(entry=>({...entry,loopStart:0,adsr1:0xff,adsr2:0xe0})),...RECIPES.map(instrument)];
  const encoded=entries.map(entry=>encodeBrr(entry.pcm,entry.loop,entry.loopStart));
  const image=new Uint8Array(0x400+encoded.reduce((size,bytes)=>size+bytes.length,0));
  const metadata=[];
  let address=0x400;
  for(let i=0;i<entries.length;i++){
    const entry=entries[i],bytes=encoded[i],loopAddress=address+(entry.loopStart/16)*9;
    image.set(bytes,address);
    const directory=0x200+i*4;
    image[directory]=address&255;image[directory+1]=address>>8;
    image[directory+2]=loopAddress&255;image[directory+3]=loopAddress>>8;
    metadata.push({name:entry.name,baseHz:entry.baseHz,loop:entry.loop,start:address,loopStart:loopAddress,bytes:bytes.length,adsr1:entry.adsr1,adsr2:entry.adsr2});
    address+=bytes.length;
  }
  if(address>0xe000)throw new Error('Factory bank overlaps the echo buffer');
  return {image,metadata};
}
