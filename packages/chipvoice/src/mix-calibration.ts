import type {ChipDefinition, NoteFrame} from './chip.js';
import type {Instrument} from './driver.js';
import {RegisterTransactions} from './register-transactions.js';

export const MIX_PROFILE_VERSION = 1;
export interface MixProfile {
  version: 1;
  chip: string;
  voice: string;
  signature: string;
  sampleRate: number;
  axis: 'pitch' | 'noise-period';
  positions: number[];
  durations: number[];
  /** Row-major position × duration × control, at unity chip gain. */
  controls: number[];
  stepped: boolean;
  rms: number[];
  peaks: number[];
}
export interface MixCalibrationOptions {
  pitches?: number[];
  durations?: number[];
  sampleRate?: number;
  controls?: number[];
}

/** Stable content identity, including custom patch/sample parameters. The
 * complete signature is compared, so a digest collision cannot select a patch. */
export function mixInstrumentSignature(instrument: Instrument): string {
  let nodes=0;
  const canonical = (value: unknown,depth=0): unknown => {
    if(++nodes>1024||depth>8||typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid or excessive instrument profile');
    if (Array.isArray(value)) return value.map(v=>canonical(v,depth+1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v,depth+1)]));
    return value;
  };
  // External amplitude envelopes are applied by the planner. Calibration
  // measures the instrument's response to a held unit-amplitude control.
  const {volume: _volume, sustain: _sustain, vibrato: _vibrato, pitch: _pitch, arp: _arp, slide: _slide, ...sound} = instrument;
  const signature=JSON.stringify(canonical(sound));
  if(signature.length>65536)throw new Error('Instrument profile exceeds 64 KiB');
  return signature;
}

/** Preparation/offline operation, never called from an AudioWorklet callback.
 * Explicit bounds cap work even for an unfamiliar user patch. */
export function calibrateMixInstrument(chip: ChipDefinition, voice: string, instrument: Instrument, options: MixCalibrationOptions = {}): MixProfile {
  const periodVoice=chip.spec.voices.find(v=>v.id===voice)?.notes==='period';
  const pitches=options.pitches??(periodVoice?[3,11]:[48,72]),durations=options.durations??[.125,.5],sampleRate=options.sampleRate??44100;
  const stepped=chip.spec.id==='dmg'&&voice==='ch3'||chip.spec.id==='2a03'&&voice==='tri';
  const controls=chip.spec.id==='dmg'&&voice==='ch3'?[0,1,6,11]:chip.spec.id==='2a03'&&voice==='tri'?[0,1]:options.controls??[0,1,7,15];
  const ordered=(values:number[],low:number,high:number)=>values.length>0&&values.every((v,i)=>Number.isFinite(v)&&v>=low&&v<=high&&(!i||v>values[i-1]));
  if(!chip.spec.voices.some(v=>v.id===voice)||!ordered(pitches,0,periodVoice?15:127)||!ordered(durations,.05,2)||pitches.length*durations.length*controls.length>256||!ordered(controls,0,15)||controls[0]!==0||pitches.length*durations.reduce((a,b)=>a+b,0)*controls.length>64||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>96000)throw new Error('Invalid or excessive mix calibration');
  const profile:MixProfile={version:1,chip:chip.spec.id,voice,signature:mixInstrumentSignature(instrument),sampleRate,controls:[...controls],stepped,axis:periodVoice?'noise-period':'pitch',positions:[...pitches],durations:[...durations],rms:[],peaks:[]};
  for(const pitch of pitches)for(const duration of durations)for(const control of controls){
    if(control===0){profile.rms.push(0);profile.peaks.push(0);continue;}
    const driver=chip.driver(),core=chip.create(sampleRate),bus=new RegisterTransactions(chip.spec.id);
    bus.add(driver.powerOn());
    const start=.05,frames:NoteFrame[]=[];
    for(let frame=0;frame/60<duration;frame++)frames.push({at:Math.round((start+frame/60)*chip.spec.clockHz),volume:control,freq:periodVoice?0:440*2**((pitch-69)/12),period:periodVoice?pitch:9,duty:typeof instrument.duty==='number'?instrument.duty:Array.isArray(instrument.duty)?instrument.duty[frame%instrument.duty.length]:2,noiseMode:instrument.noiseMode??false,pitchOffset:0,waveform:typeof instrument.waveform==='string'?instrument.waveform:Array.isArray(instrument.waveform)?instrument.waveform[Math.min(frame,instrument.waveform.length-1)]:null,wave:instrument.wave??null,fm:instrument.fm??null,sample:instrument.sample??null});
    bus.add(driver.note(voice,frames));bus.add(driver.noteOff(voice,Math.round((start+duration)*chip.spec.clockHz)));
    for(const block of driver.memory?.()??[])core.load(block.address,block.bytes);
    core.setGain(1);core.schedule(bus.finish().events);
    const total=Math.ceil((start+duration+.025)*sampleRate),left=new Float32Array(1024),right=new Float32Array(1024);
    let square=0,peak=0,count=0;
    for(let offset=0;offset<total;offset+=1024){const size=Math.min(1024,total-offset);core.render(left.subarray(0,size),right.subarray(0,size),offset);
      for(let i=0;i<size;i++)if(offset+i>=Math.round(start*sampleRate)&&offset+i<Math.round((start+duration)*sampleRate)){
        const l=left[i],r=right[i];if(!Number.isFinite(l)||!Number.isFinite(r))throw new Error('Invalid calibration PCM');
        square+=l*l+r*r;peak=Math.max(peak,Math.abs(l),Math.abs(r));count+=2;
      }
    }
    profile.rms.push(Number(Math.sqrt(square/count).toPrecision(7)));profile.peaks.push(Number(peak.toPrecision(7)));
  }
  return profile;
}

/** Bounded cache; a caller can share calibrated profiles across phrases. */
export class MixProfileBank {
  private readonly profiles=new Map<string,MixProfile>();
  constructor(profiles: readonly MixProfile[] = [], readonly capacity=64){
    if(!Number.isInteger(capacity)||capacity<1||capacity>64)throw new Error('Mix profile cache is bounded at 64 entries');
    for(const profile of profiles)this.add(profile);
  }
  private key(chip:string,voice:string,signature:string,sampleRate:number){return JSON.stringify([chip,voice,signature,sampleRate]);}
  add(profile: MixProfile){
    if(profile.version!==MIX_PROFILE_VERSION||profile.rms.length!==profile.positions.length*profile.durations.length*profile.controls.length||profile.peaks.length!==profile.rms.length||!profile.rms.length||profile.rms.some(v=>!Number.isFinite(v)||v<0)||profile.peaks.some(v=>!Number.isFinite(v)||v<0))throw new Error('Invalid mix profile');
    const grid=(values:number[],maximum:number)=>values.length>0&&values.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=maximum&&(!i||v>values[i-1]));
    if(!['pitch','noise-period'].includes(profile.axis)||!grid(profile.positions,profile.axis==='pitch'?127:15)||!grid(profile.durations,2)||profile.durations[0]<.05||profile.rms.length>256||!grid(profile.controls,15)||profile.controls[0]!==0||typeof profile.stepped!=='boolean'||!Number.isInteger(profile.sampleRate)||profile.sampleRate<8000||profile.sampleRate>96000||typeof profile.signature!=='string'||profile.signature.length>65536)throw new Error('Invalid mix profile grid');
    const copy={...profile,positions:[...profile.positions],controls:[...profile.controls],durations:[...profile.durations],rms:[...profile.rms],peaks:[...profile.peaks]};
    Object.freeze(copy.controls);Object.freeze(copy.positions);Object.freeze(copy.durations);Object.freeze(copy.rms);Object.freeze(copy.peaks);Object.freeze(copy);
    const key=this.key(copy.chip,copy.voice,copy.signature,copy.sampleRate);this.profiles.delete(key);this.profiles.set(key,copy);
    while(this.profiles.size>this.capacity)this.profiles.delete(this.profiles.keys().next().value!);
  }
  find(chip:string,voice:string,instrument:Instrument,sampleRate=44100):MixProfile|undefined {
    return this.profiles.get(this.key(chip,voice,mixInstrumentSignature(instrument),sampleRate));
  }
  get size(){return this.profiles.size;}
}

/** Bilinear interpolation in pitch/noise period and duration, with explicit grid clamps. */
export function mixProfileLevel(profile:MixProfile,pitch:number,duration:number,peak=false,control=15):number {
  if(!Number.isFinite(pitch)||!Number.isFinite(duration)||duration<=0||!Number.isFinite(control))throw new Error('Invalid mix profile lookup');
  const positions=profile.positions,durations=profile.durations;
  let p=0,a=0;while(p+1<positions.length&&positions[p+1]<pitch)p++;while(a+1<durations.length&&durations[a+1]<duration)a++;
  const q=Math.min(p+1,positions.length-1),b=Math.min(a+1,durations.length-1);
  const x=p===q?0:Math.max(0,Math.min(1,(pitch-positions[p])/(positions[q]-positions[p])));
  const y=a===b?0:Math.max(0,Math.min(1,(duration-durations[a])/(durations[b]-durations[a])));
  const values=peak?profile.peaks:profile.rms,n=durations.length,levels=profile.controls,m=levels.length;
  let c=0;while(c+1<m&&levels[c+1]<=control)c++;
  const d=Math.min(c+1,m-1),z=profile.stepped||c===d?0:Math.max(0,Math.min(1,(control-levels[c])/(levels[d]-levels[c])));
  const pa=(p*n+a)*m,pb=(p*n+b)*m,qa=(q*n+a)*m,qb=(q*n+b)*m;
  return ((values[pa+c]*(1-z)+values[pa+d]*z)*(1-y)+(values[pb+c]*(1-z)+values[pb+d]*z)*y)*(1-x)+((values[qa+c]*(1-z)+values[qa+d]*z)*(1-y)+(values[qb+c]*(1-z)+values[qb+d]*z)*y)*x;
}

/** Invert a measured response, choosing a realizable step on stepped voices.
 * A triangle cannot become quieter without disappearing; retain its note and
 * disclose this limitation in the mix diagnostics rather than inventing gaps. */
export function mixProfileControl(profile:MixProfile,position:number,duration:number,rms:number):number {
  if(!Number.isFinite(rms)||rms<0)throw new Error('Invalid target loudness');
  if(rms===0)return 0;
  let previous=0,previousLevel=0;
  for(let i=1;i<profile.controls.length;i++){
    const control=profile.controls[i];
    const value=mixProfileLevel(profile,position,duration,false,control);
    if(value>=rms){
      if(profile.stepped)return previousLevel&&rms-previous<value-rms?previousLevel:control;
      return previousLevel+(control-previousLevel)*(value===previous?0:Math.max(0,Math.min(1,(rms-previous)/(value-previous))));
    }
    previous=value;previousLevel=control;
  }
  return profile.controls.at(-1)!;
}
