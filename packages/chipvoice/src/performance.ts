import type {ChipDefinition, NoteFrame, RegisterEvent, Role} from './chip.js';
import type {Instrument} from './driver.js';
import {instrumentsFor} from './score.js';
import type {RenderResult} from './render.js';
import {performanceInstrument} from './performance-palette.js';
import {pitchRange} from './pitch-range.js';
import {RegisterTransactions} from './register-transactions.js';

/** Exact source ticks, independent voices, and expression. The compact tracker
 * remains useful for composition; importing an arrangement must not flatten it. */
export interface Performance {
  version: 1;
  title: string;
  ticksPerBeat: number;
  endTick: number;
  loopStartTick?: number;
  tempos: {tick: number; microsecondsPerBeat: number}[];
  parts: PerformancePart[];
  source?: {kind: 'midi' | 'native'; name: string; sha256?: string; url?: string; description?: string};
  notices: string[];
  /** Original channel events retained for future expression adapters. */
  midi?: {format: number; events: {tick: number; track: number; order: number; status: number; data: number[]}[]};
}
export interface PerformancePart {
  id: string;
  name: string;
  role: Role;
  /** Higher values reserve voices first, including against earlier held notes. */
  priority: number;
  notes: PerformanceNote[];
  /** Reviewed, explicit patches override the generic role palette. */
  instruments?: Record<string, Instrument>;
}
export interface PerformanceNote {
  id: string;
  tick: number;
  endTick: number;
  /** MIDI semitones; fractional values preserve native timer tuning. */
  pitch: number;
  velocity: number;
  program?: number;
  /** GM percussion key. Undefined for pitched notes. */
  drum?: number;
  /** Absolute source ticks; values are held until the next point. */
  expression?: {tick: number; pitch?: number; gain?: number; duty?: number; noisePeriod?: number}[];
}
export interface PerformanceLoss {part: string; note?: string; kind: string; detail: string}
export interface PlannedNote {part: string; id: string; voice: string; pitch: number; at: number; until: number}
export interface PerformancePlan {
  chip: string;
  seconds: number;
  loopStartSeconds: number;
  events: RegisterEvent[];
  memory: {address: number; bytes: Uint8Array}[];
  notes: PlannedNote[];
  losses: PerformanceLoss[];
}
export interface PerformanceOptions {
  /** Preserve notes by default: callers must opt into reported voice omissions. */
  allowLoss?: boolean;
  tempoScale?: number;
  transpose?: number;
  /** Isolate parts after allocation, so soloing cannot change the arrangement. */
  parts?: string[];
}

export function validatePerformance(score: Performance): void {
  const int = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (score.version !== 1 || !int(score.ticksPerBeat) || !score.ticksPerBeat || !int(score.endTick) || !score.endTick || score.parts.length > 256) throw new Error('Invalid performance header');
  if (!int(score.loopStartTick ?? 0) || (score.loopStartTick ?? 0) >= score.endTick) throw new Error('Invalid loop start');
  let tick = -1, count = 0;
  if (!score.tempos.length || score.tempos[0].tick !== 0) throw new Error('Tempo must start at tick zero');
  for (const tempo of score.tempos) {
    if (!int(tempo.tick) || tempo.tick <= tick || tempo.tick >= score.endTick || !int(tempo.microsecondsPerBeat) || tempo.microsecondsPerBeat < 1 || tempo.microsecondsPerBeat > 0xffffff) throw new Error('Invalid tempo map');
    tick = tempo.tick;
  }
  const ids = new Set<string>();
  for (const part of score.parts) {
    if (!part.id || ids.has(part.id) || !['lead','chord','bass','perc'].includes(part.role) || !Number.isFinite(part.priority)) throw new Error('Invalid or duplicate part');
    ids.add(part.id); const notes = new Set<string>();
    for (const note of part.notes) {
      if (++count > 100000 || !note.id || notes.has(note.id) || !int(note.tick) || !int(note.endTick) || note.endTick <= note.tick || note.endTick > score.endTick || !Number.isFinite(note.pitch) || note.pitch < 0 || note.pitch > 127 || !Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) throw new Error(`Invalid note in ${part.id}`);
      notes.add(note.id); tick = note.tick - 1;
      for (const point of note.expression ?? []) {
        if (!int(point.tick) || point.tick < note.tick || point.tick >= note.endTick || point.tick <= tick || point.pitch !== undefined && (!Number.isFinite(point.pitch) || Math.abs(point.pitch) > 96) || point.gain !== undefined && (!Number.isFinite(point.gain) || point.gain < 0 || point.gain > 1) || point.duty !== undefined && (!int(point.duty) || point.duty > 3) || point.noisePeriod !== undefined && (!int(point.noisePeriod) || point.noisePeriod > 15)) throw new Error(`Invalid expression in ${note.id}`);
        tick = point.tick;
      }
    }
  }
}

/** Compiles a tempo map once. Binary lookup avoids walking it for every frame. */
export function performanceClock(score: Performance, tempoScale = 1): (tick: number) => number {
  if (!Number.isFinite(tempoScale) || tempoScale < .1 || tempoScale > 10) throw new Error('Invalid tempo scale');
  const segments = score.tempos.map(t => ({...t, seconds: 0, slope: t.microsecondsPerBeat / 1e6 / score.ticksPerBeat / tempoScale}));
  for (let i = 1; i < segments.length; i++) segments[i].seconds = segments[i - 1].seconds + (segments[i].tick - segments[i - 1].tick) * segments[i - 1].slope;
  return tick => {
    let lo = 0, hi = segments.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (segments[mid].tick <= tick) lo = mid; else hi = mid; }
    const t = segments[lo]; return t.seconds + (tick - t.tick) * t.slope;
  };
}

/** One allocation/encoding path for CLI evaluation, workers and SDK callers.
 * Returns the musical omissions; it never adds a note, chord or backing part. */
export function planPerformance(score: Performance, chip: ChipDefinition, options: PerformanceOptions = {}): PerformancePlan {
  validatePerformance(score);
  const transpose = options.transpose ?? 0;
  if (!Number.isFinite(transpose) || Math.abs(transpose) > 48) throw new Error('Invalid transpose');
  const time = performanceClock(score, options.tempoScale), seconds = time(score.endTick);
  if (seconds > 600) throw new Error('Performance exceeds ten minutes');
  const driver = chip.driver(), bus = new RegisterTransactions(chip.spec.id), notes: PlannedNote[] = [], losses: PerformanceLoss[] = [];
  bus.add(driver.powerOn());
  const instruments = instrumentsFor(chip.spec.id, undefined);
  const sounding = new Map<string, {start: number; end: number}[]>(), selected = options.parts && new Set(options.parts);
  const voices = chip.spec.voices.filter(v => v.notes !== 'sample' && !(chip.spec.id === 'md' && v.id === 'psg3'));
  const queue = score.parts.flatMap(part => part.notes.map(note => ({part, note}))).sort((a,b) => b.part.priority - a.part.priority || a.note.tick - b.note.tick || a.part.id.localeCompare(b.part.id) || a.note.pitch - b.note.pitch || a.note.id.localeCompare(b.note.id));
  const placement = (voice: string, start: number, end: number) => {
    const spans = sounding.get(voice) ?? [];
    let lo=0,hi=spans.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(spans[mid].start<start)lo=mid+1;else hi=mid;}
    return (lo>0&&spans[lo-1].end>start)||(lo<spans.length&&spans[lo].start<end) ? -1 : lo;
  };
  const warned = new Set<string>();
  const loss = (part: PerformancePart, kind: string, detail: string) => {const key = `${part.id}:${kind}`; if (!warned.has(key)) {warned.add(key); losses.push({part: part.id, kind, detail});}};
  const allocated: {part: PerformancePart; note: PerformanceNote; voice: string}[] = [];
  for (const {part, note} of queue) {
    const percussion = note.drum !== undefined || part.role === 'perc';
    const preferred = chip.spec.roles[part.role];
    const choices = voices.filter(v => chip.spec.id === 'snes' || (percussion ? v.notes === 'period' || chip.spec.id === 'c64' : v.notes === 'pitch'));
    choices.sort((a,b) => Number(b.id === preferred) - Number(a.id === preferred));
    const voice = choices.find(v => placement(v.id,note.tick,note.endTick)>=0);
    if (!voice) {losses.push({part: part.id, note: note.id, kind: 'voice-omitted', detail: `No free ${percussion ? 'percussion' : 'pitched'} voice at tick ${note.tick}`}); continue;}
    const spans=sounding.get(voice.id)??[];
    spans.splice(placement(voice.id,note.tick,note.endTick),0,{start:note.tick,end:note.endTick});
    sounding.set(voice.id,spans);
    allocated.push({part,note,voice:voice.id});
  }
  // Drivers cache chip state, so encode in chronological order after allocation.
  allocated.sort((a,b)=>a.note.tick-b.note.tick||a.part.id.localeCompare(b.part.id)||a.note.id.localeCompare(b.note.id));
  for (const {part,note,voice} of allocated) {
    const percussion=note.drum!==undefined||part.role==='perc';
    const at = time(note.tick), until = time(note.endTick);
    notes.push({part: part.id, id: note.id, voice, pitch: note.pitch + (percussion ? 0 : transpose), at, until});
    if (selected && !selected.has(part.id)) continue;
    const kitKey = note.drum === 35 || note.drum === 36 ? 'K' : note.drum === 38 || note.drum === 40 ? 'S' : note.drum === 46 ? 'O' : 'H';
    const drum = instruments.perc[kitKey];
    const inst = part.instruments?.[`${chip.spec.id}:${note.program}`] ?? part.instruments?.[chip.spec.id] ?? (percussion ? drum.instrument : performanceInstrument(chip.spec.id,part.role,note.program));
    if (!part.instruments?.[chip.spec.id]) loss(part, 'palette-substitution', `Generic ${part.role} palette; original instrument is not certified`);
    if (inst.arp?.length || inst.pitch?.length || inst.slide || inst.vibrato) loss(part, 'instrument-effects-omitted', 'Palette arpeggio/vibrato/slide is omitted; only source expression is applied');
    if (percussion && ![35,36,38,40,42,44,46].includes(note.drum ?? -1)) loss(part, 'drum-substitution', 'Percussion mapped to the closest available kit sound');
    if (chip.spec.id === 'dmg' && note.expression?.some(p => p.gain !== undefined)) loss(part, 'envelope-approximation', 'Game Boy volume steps and hardware envelope constrain expression');
    const points = (note.expression ?? []).map(p => ({...p, seconds: time(p.tick)}));
    if(!percussion){
      const range=pitchRange(chip.spec,chip.spec.voices.find(v=>v.id===voice)!,inst);
      if(range&&[0,...points.map(p=>p.pitch??0)].some(bend=>{const hz=440*2**((note.pitch+transpose+bend-69)/12);return hz<range[0]||hz>range[1];}))losses.push({part:part.id,note:note.id,kind:'pitch-range',detail:`Pitch or bend exceeds ${voice}'s register range; the hardware may clamp or silence it`});
    }
    const times = new Set<number>([at]);
    for (let frame = 1; at + frame / 60 < until; frame++) times.add(at + frame / 60);
    for (const point of points) times.add(point.seconds);
    const frames: NoteFrame[] = [];
    let p = 0, bend = 0, expressionGain = 1, duty = typeof inst.duty === 'number' ? inst.duty : 2, noisePeriod = typeof drum.note === 'number' ? drum.note : 9;
    for (const t of [...times].sort((a,b) => a-b)) {
      while (p < points.length && points[p].seconds <= t + 1e-10) {const point = points[p++]; bend = point.pitch ?? bend; expressionGain = point.gain ?? expressionGain; duty = point.duty ?? duty; noisePeriod = point.noisePeriod ?? noisePeriod;}
      const frame = Math.floor((t - at) * 60 + 1e-7);
      const volume = (inst.volume[Math.min(frame, inst.volume.length - 1)] ?? 0) * (inst.sustain || frame < inst.volume.length ? 1 : 0) * note.velocity / 127 * expressionGain;
      frames.push({at: Math.round(t * chip.spec.clockHz), volume: chip.spec.id === 'snes' ? volume : Math.round(volume), freq: percussion ? 0 : 440 * 2 ** ((note.pitch + transpose + bend - 69) / 12), period: noisePeriod, duty: Array.isArray(inst.duty) ? inst.duty[frame % inst.duty.length] : duty, noiseMode: inst.noiseMode ?? false, pitchOffset: 0, waveform: Array.isArray(inst.waveform) ? inst.waveform[Math.min(frame, inst.waveform.length - 1)] : inst.waveform ?? null, wave: inst.wave ?? null, fm: inst.fm ?? null, sample: inst.sample ?? null});
    }
    bus.add(driver.note(voice, frames));
    bus.add(driver.noteOff(voice, Math.round(until * chip.spec.clockHz)));
  }
  if (!options.allowLoss && losses.some(l => l.kind === 'voice-omitted')) throw new Error('Arrangement exceeds hardware voices; opt into allowLoss and inspect losses');
  const scheduled=bus.finish();
  if(scheduled.delayed)losses.push({part:'*',kind:'bus-timing',detail:`${scheduled.delayed} transactions serialized; maximum extra delay ${(scheduled.maxDelayCycles/chip.spec.clockHz*1000).toFixed(3)} ms`});
  return {chip: chip.spec.id, seconds, loopStartSeconds: time(score.loopStartTick ?? 0), events:scheduled.events, memory: driver.memory?.() ?? [], notes, losses};
}

/** Renders compiled commands, not a second interpretation of the score. */
export function renderPerformance(plan: PerformancePlan, chip: ChipDefinition, options: {sampleRate?: number; gain?: number} = {}): RenderResult {
  if (plan.chip !== chip.spec.id) throw new Error('Plan/chip mismatch');
  const sampleRate = options.sampleRate ?? 44100;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isFinite(plan.seconds) || plan.seconds <= 0 || plan.seconds > 600) throw new Error('Invalid render size');
  const core = chip.create(sampleRate); core.setGain(options.gain ?? .6);
  for (const block of plan.memory) core.load(block.address, block.bytes);
  core.schedule(plan.events);
  const total = Math.round(plan.seconds * sampleRate), left = new Float32Array(total), right = new Float32Array(total);
  for (let offset = 0; offset < total; offset += 4096) core.render(left.subarray(offset, offset + 4096), right.subarray(offset, offset + 4096), offset);
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  return {sampleRate, left, right, seconds: total / sampleRate, peak};
}
