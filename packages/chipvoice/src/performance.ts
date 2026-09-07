import type {ChipDefinition, NoteFrame, RegisterEvent, Role} from './chip.js';
import type {Instrument} from './driver.js';
import {validatePortableTimbre,type PortableTimbre} from './portable-timbre.js';
import {mixInstrumentSignature} from './mix-calibration.js';
import {instrumentsFor} from './score.js';
import type {RenderResult} from './render.js';
import {performanceInstrument} from './performance-palette.js';
import {balanceMixFrames} from './mix-headroom.js';
import {voicesConflict,performanceVoices,instrumentFitsVoice} from './voice-resources.js';
import {pitchRange} from './pitch-range.js';
import {RegisterTransactions} from './register-transactions.js';
import {planMix,mixActivity,type MixOrigin,type PartMix,type MixOptions,type MixReport} from './mix.js';

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
  /** Source hardware controls, when independently identified by the importer. */
  origin?: MixOrigin;
  mix?: PartMix;
  id: string;
  name: string;
  role: Role;
  roleInference?: {confidence:'high'|'medium'|'low';reason:'channel'|'name'|'program'|'polyphony'|'register'|'monophony'|'override'};
  /** Higher values reserve voices first, including against earlier held notes. */
  priority: number;
  notes: PerformanceNote[];
  /** Reviewed, explicit patches override the generic role palette. */
  instruments?: Record<string, Instrument>;
  /** Measured source-patch projections, keyed like instruments (e.g. md:4). */
  portableTimbres?: Record<string, PortableTimbre>;
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
  mix?: MixReport;
  chip: string;
  seconds: number;
  loopStartSeconds: number;
  events: RegisterEvent[];
  memory: {address: number; bytes: Uint8Array}[];
  notes: PlannedNote[];
  /** Source-silent notes retained in the ledger without reserving hardware. */
  silentNotes?: {part:string;id:string}[];
  losses: PerformanceLoss[];
}
export interface PerformanceOptions {
  /** Automatic, calibrated part balance. false preserves legacy control levels. */
  mix?: false | MixOptions;
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
  let tick = -1, count = 0, expressionCount = 0;
  if (!score.tempos.length || score.tempos[0].tick !== 0) throw new Error('Tempo must start at tick zero');
  for (const tempo of score.tempos) {
    if (!int(tempo.tick) || tempo.tick <= tick || tempo.tick >= score.endTick || !int(tempo.microsecondsPerBeat) || tempo.microsecondsPerBeat < 1 || tempo.microsecondsPerBeat > 0xffffff) throw new Error('Invalid tempo map');
    tick = tempo.tick;
  }
  const ids = new Set<string>();
  for (const part of score.parts) {
    if (!part.id || ids.has(part.id) || !['lead','chord','bass','perc'].includes(part.role) || !Number.isFinite(part.priority)) throw new Error('Invalid or duplicate part');
    if(part.origin&&(typeof part.origin.chip!=='string'||typeof part.origin.voice!=='string'||part.origin.chip.length>64||part.origin.voice.length>64))throw new Error('Invalid mix origin');
    if(part.mix&&(part.mix.gainDb!==undefined&&(!Number.isFinite(part.mix.gainDb)||part.mix.gainDb< -96||part.mix.gainDb>12)||part.mix.importance!==undefined&&(!Number.isFinite(part.mix.importance)||part.mix.importance<0||part.mix.importance>1)))throw new Error('Invalid part mix');
    if(part.portableTimbres){
      if(Object.keys(part.portableTimbres).length>128)throw new Error('Too many portable timbres');
      for(const [key,timbre] of Object.entries(part.portableTimbres)){
        validatePortableTimbre(timbre);
        if(!part.instruments?.[key]||mixInstrumentSignature(part.instruments[key])!==timbre.sourceSignature)throw new Error('Stale portable timbre source');
      }
    }
    ids.add(part.id); const notes = new Set<string>();
    for (const note of part.notes) {
      if (++count > 100000 || !note.id || notes.has(note.id) || !int(note.tick) || !int(note.endTick) || note.endTick <= note.tick || note.endTick > score.endTick || !Number.isFinite(note.pitch) || note.pitch < 0 || note.pitch > 127 || !Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) throw new Error(`Invalid note in ${part.id}`);
      if(note.program!==undefined&&(!int(note.program)||note.program>127)||note.drum!==undefined&&(!int(note.drum)||note.drum>127))throw new Error('Invalid MIDI program or percussion key');
      notes.add(note.id); tick = note.tick - 1;
      for (const point of note.expression ?? []) {
        if(++expressionCount>200000)throw new Error('Performance exceeds 200,000 expression points');
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

const isPercussion=(part:PerformancePart,note:PerformanceNote)=>part.roleInference?.reason==='override'?part.role==='perc':note.drum!==undefined||part.role==='perc';
function sourceSilent(note:PerformanceNote):boolean{
  let gain=1,last=note.tick;
  for(const point of note.expression??[]){
    if(point.tick>last&&gain>0)return false;
    gain=point.gain??gain;last=point.tick;
  }
  return gain===0;
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
  const silentNotes:{part:string;id:string}[]=[];
  const queue = score.parts.flatMap(part => part.notes.filter(note=>{if(options.mix!==false&&sourceSilent(note)){silentNotes.push({part:part.id,id:note.id});return false;}return true;}).map(note => ({part, note}))).sort((a,b) => b.part.priority - a.part.priority || a.note.tick - b.note.tick || a.part.id.localeCompare(b.part.id) || a.note.pitch - b.note.pitch || a.note.id.localeCompare(b.note.id));
  const voicePlacement = (voice: string, start: number, end: number) => {
    const spans = sounding.get(voice) ?? [];
    let lo=0,hi=spans.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(spans[mid].start<start)lo=mid+1;else hi=mid;}
    return (lo>0&&spans[lo-1].end>start)||(lo<spans.length&&spans[lo].start<end) ? -1 : lo;
  };
  const placement = (voice:string,start:number,end:number) => chip.spec.voices.some(v=>voicesConflict(chip.spec,voice,v.id)&&voicePlacement(v.id,start,end)<0)?-1:voicePlacement(voice,start,end);
  const warned = new Set<string>();
  const loss = (part: PerformancePart, kind: string, detail: string) => {const key = `${part.id}:${kind}`; if (!warned.has(key)) {warned.add(key); losses.push({part: part.id, kind, detail});}};
  // Resolve once per part/program/drum, then carry the selected instrument
  // through allocation and encoding. Voice preference cannot discard a patch.
  const paletteCache = new Map<PerformancePart,Map<string,{inst:Instrument;drum:typeof instruments.perc['K'];explicit:boolean;portable?:PortableTimbre;pitchOffset:number}>>();
  const resolveInstrument = (part:PerformancePart,note:PerformanceNote) => {
    let cache=paletteCache.get(part);if(!cache){cache=new Map();paletteCache.set(part,cache);}
    const key=`${note.program??"default"}:${note.drum??-1}`;const cached=cache.get(key);if(cached)return cached;
    const percussion=isPercussion(part,note);
    const kitKey=note.drum===35||note.drum===36?'K':note.drum===38||note.drum===40?'S':note.drum===46?'O':'H';
    const drum=instruments.perc[kitKey],explicit=part.instruments?.[`${chip.spec.id}:${note.program}`]??part.instruments?.[chip.spec.id];
    const sourceKey=part.origin?`${part.origin.chip}:${note.program}`:undefined;
    const portable=!explicit&&!percussion&&sourceKey?part.portableTimbres?.[sourceKey]:undefined;
    // Native patch IDs are local identifiers, never General MIDI programs.
    const program=portable?.program??(part.origin?undefined:note.program);
    if(portable&&portable.confidence<.9)loss(part,'timbre-ambiguous','Source pitch was not stable across probes; the register pitch is retained');
    const base=explicit??(percussion?drum.instrument:performanceInstrument(chip.spec.id,part.role,program));
    // Wide pulses retain the fundamental of measured native tones; the
    // narrow decorative lead presets add too much unrelated high-frequency energy.
    const pulse=portable&&part.role!=='bass'&&['2a03','dmg'].includes(chip.spec.id)?{duty:portable.program===73?2:1}:{};
    const inst=portable?{...base,...pulse,volume:portable.envelope.map(v=>v*15),sustain:true}:base;
    const resolved={inst,drum,explicit:!!explicit,portable,pitchOffset:portable?.pitchOffset??0};
    if(!explicit&&part.origin?.chip==='md'&&sourceKey&&part.instruments?.[sourceKey]?.fm&&!percussion&&!portable)loss(part,'timbre-unmeasured','Native FM register pitch and timbre are unmeasured; prepare portableTimbres for faithful pitch conversion');
    cache.set(key,resolved);return resolved;
  };
  const allocated: {part: PerformancePart; note: PerformanceNote; voice: string; sound:ReturnType<typeof resolveInstrument>}[] = [];
  for (const {part, note} of queue) {
    const percussion = isPercussion(part,note);
    const preferred = chip.spec.roles[part.role],sound=resolveInstrument(part,note);
    if(options.mix!==false&&sound.portable?.rms===0){silentNotes.push({part:part.id,id:note.id});continue;}
    const choices = performanceVoices(chip.spec,sound.inst,percussion);
    const compatible=(v:typeof choices[number])=>instrumentFitsVoice(chip.spec,v,sound.inst);
    choices.sort((a,b) => Number(compatible(b))-Number(compatible(a))||Number(b.id === preferred) - Number(a.id === preferred));
    const voice = choices.find(v => placement(v.id,note.tick,note.endTick)>=0);
    if (!voice) {losses.push({part: part.id, note: note.id, kind: 'voice-omitted', detail: `No free ${percussion ? 'percussion' : 'pitched'} voice at tick ${note.tick}`}); continue;}
    const spans=sounding.get(voice.id)??[];
    spans.splice(placement(voice.id,note.tick,note.endTick),0,{start:note.tick,end:note.endTick});
    sounding.set(voice.id,spans);
    if(!compatible(voice))loss(part,'instrument-substitution','No compatible FM voice; the patch is replaced by a PSG tone');
    allocated.push({part,note,voice:voice.id,sound});
  }
  // Drivers cache chip state, so encode in chronological order after allocation.
  allocated.sort((a,b)=>a.note.tick-b.note.tick||a.part.id.localeCompare(b.part.id)||a.note.id.localeCompare(b.note.id));
  const referenceCache=new Map<Instrument,Map<number,Instrument>>();
  const referenceInstrument=(part:PerformancePart,note:PerformanceNote)=>{
    if(!part.origin)return undefined;
    const base=part.instruments?.[`${part.origin.chip}:${note.program}`]??part.instruments?.[part.origin.chip];
    if(!base||part.origin.chip!=='2a03')return base;
    const duty=note.expression?.find(p=>p.duty!==undefined)?.duty??(typeof base.duty==='number'?base.duty:2);
    let cache=referenceCache.get(base);if(!cache){cache=new Map();referenceCache.set(base,cache);}let sound=cache.get(duty);if(!sound){sound={...base,duty};cache.set(duty,sound);}return sound;
  };
  const prepared: {part:PerformancePart;note:PerformanceNote;voice:string;sound:ReturnType<typeof resolveInstrument>;frames:NoteFrame[];until:number}[]=[];
  for (const {part,note,voice,sound} of allocated) {
    const percussion=isPercussion(part,note);
    const at = time(note.tick), until = time(note.endTick);
    notes.push({part: part.id, id: note.id, voice, pitch: note.pitch + sound.pitchOffset + (percussion ? 0 : transpose), at, until});
    const {inst,drum}=sound;
    if (!sound.explicit) loss(part, 'palette-substitution', `Generic ${part.role} palette; original instrument is not certified`);
    if (inst.arp?.length || inst.pitch?.length || inst.slide || inst.vibrato) loss(part, 'instrument-effects-omitted', 'Palette arpeggio/vibrato/slide is omitted; only source expression is applied');
    if (percussion && ![35,36,38,40,42,44,46].includes(note.drum ?? -1)) loss(part, 'drum-substitution', 'Percussion mapped to the closest available kit sound');
    if (chip.spec.id === 'dmg' && note.expression?.some(p => p.gain !== undefined)) loss(part, 'envelope-approximation', 'Game Boy volume steps and hardware envelope constrain expression');
    const observedGain=options.mix!==false&&!sound.explicit&&!sound.portable&&!!part.origin&&note.expression?.some(point=>point.gain!==undefined);
    const points = (note.expression ?? []).map(p => ({...p, seconds: time(p.tick)}));
    if(!percussion){
      const range=pitchRange(chip.spec,chip.spec.voices.find(v=>v.id===voice)!,inst);
      if(range&&[0,...points.map(p=>p.pitch??0)].some(bend=>{const hz=440*2**((note.pitch+sound.pitchOffset+transpose+bend-69)/12);return hz<range[0]||hz>range[1];}))losses.push({part:part.id,note:note.id,kind:'pitch-range',detail:`Pitch or bend exceeds ${voice}'s register range; the hardware may clamp or silence it`});
    }
    const times = new Set<number>([at]);
    for (let frame = 1; at + frame / 60 < until; frame++) times.add(at + frame / 60);
    for (const point of points) times.add(point.seconds);
    const frames: NoteFrame[] = [];
    let p = 0, bend = 0, expressionGain = 1, duty = typeof inst.duty === 'number' ? inst.duty : 2, noisePeriod = typeof drum.note === 'number' ? drum.note : 9;
    for (const t of [...times].sort((a,b) => a-b)) {
      while (p < points.length && points[p].seconds <= t + 1e-10) {const point = points[p++]; bend = point.pitch ?? bend; expressionGain = point.gain ?? expressionGain; duty = point.duty ?? duty; noisePeriod = point.noisePeriod ?? noisePeriod;}
      const frame = Math.floor((t - at) * 60 + 1e-7);
      let volume = (observedGain?15:(inst.volume[Math.min(frame, inst.volume.length - 1)] ?? 0) * (inst.sustain || frame < inst.volume.length ? 1 : 0)) * note.velocity / 127 * expressionGain;
      frames.push({at: Math.round(t * chip.spec.clockHz), volume, freq: percussion && !inst.fm ? 0 : 440 * 2 ** ((note.pitch + sound.pitchOffset + (percussion?0:transpose) + bend - 69) / 12), period: noisePeriod, duty: Array.isArray(inst.duty) ? inst.duty[frame % inst.duty.length] : duty, noiseMode: inst.noiseMode ?? false, pitchOffset: 0, waveform: Array.isArray(inst.waveform) ? inst.waveform[Math.min(frame, inst.waveform.length - 1)] : inst.waveform ?? null, wave: inst.wave ?? null, fm: inst.fm ?? null, sample: inst.sample ?? null});
    }
    prepared.push({part,note,voice,sound,frames,until:Math.round(until*chip.spec.clockHz)});
  }
  const mixing=options.mix===false?null:planMix(chip,prepared.map(({part,note,voice,sound,frames,until})=>({part:part.id,role:part.role,voice,instrument:sound.inst,pitch:note.pitch+sound.pitchOffset+(isPercussion(part,note)?0:transpose),sourcePitch:note.pitch,sourceRms:sound.portable?.rms,start:time(note.tick),end:time(note.endTick),activity:mixActivity(frames,until,chip.spec.clockHz),origin:part.origin,referenceInstrument:referenceInstrument(part,note),mix:part.mix})),options.mix);
  for(let index=0;index<prepared.length;index++){
    const {frames,voice,note,part}=prepared[index];
    for(const frame of frames){
      if(mixing)frame.volume=mixing.level(index,frame.volume,frame.at/chip.spec.clockHz,frame.period,frame.freq>0?69+12*Math.log2(frame.freq/440):note.pitch+(isPercussion(part,note)?0:transpose));
      if(chip.spec.id!=='snes'&&!(mixing&&chip.spec.id==='md'&&voice.startsWith('fm')))frame.volume=Math.round(frame.volume);
    }
  }
  if(mixing)balanceMixFrames(chip,prepared,mixing.report);
  for(const {part,voice,frames,until} of prepared){
    if(selected&&!selected.has(part.id)||frames.every(frame=>frame.volume<=0))continue;
    bus.add(driver.note(voice,frames));bus.add(driver.noteOff(voice,until));
  }
  if (!options.allowLoss && losses.some(l => l.kind === 'voice-omitted')) throw new Error('Arrangement exceeds hardware voices; opt into allowLoss and inspect losses');
  const scheduled=bus.finish();
  if(scheduled.delayed)losses.push({part:'*',kind:'bus-timing',detail:`${scheduled.delayed} transactions serialized; maximum extra delay ${(scheduled.maxDelayCycles/chip.spec.clockHz*1000).toFixed(3)} ms`});
  if(mixing)for(const diagnostic of mixing.report.diagnostics)losses.push(diagnostic);
  return {...(mixing?{mix:mixing.report}:{}),chip: chip.spec.id, seconds, loopStartSeconds: time(score.loopStartTick ?? 0), events:scheduled.events, ...(silentNotes.length?{silentNotes}:{}), memory: driver.memory?.() ?? [], notes, losses};
}

/** Renders compiled commands, not a second interpretation of the score. */
export function renderPerformance(plan: PerformancePlan, chip: ChipDefinition, options: {sampleRate?: number; gain?: number; onProgress?: (fraction: number) => void} = {}): RenderResult {
  if (plan.chip !== chip.spec.id) throw new Error('Plan/chip mismatch');
  const sampleRate = options.sampleRate ?? 44100;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isFinite(plan.seconds) || plan.seconds <= 0 || plan.seconds > 600) throw new Error('Invalid render size');
  const core = chip.create(sampleRate); core.setGain(options.gain ?? .6);
  for (const block of plan.memory) core.load(block.address, block.bytes);
  core.schedule(plan.events);
  const total = Math.round(plan.seconds * sampleRate), left = new Float32Array(total), right = new Float32Array(total);
  options.onProgress?.(0);
  for (let offset = 0; offset < total; offset += 4096) {
    core.render(left.subarray(offset, offset + 4096), right.subarray(offset, offset + 4096), offset);
    options.onProgress?.(Math.min(offset + 4096,total) / total);
  }
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  return {sampleRate, left, right, seconds: total / sampleRate, peak};
}
