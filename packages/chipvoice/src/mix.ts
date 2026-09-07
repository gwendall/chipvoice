import type {ChipDefinition, Role} from './chip.js';
import type {Instrument} from './driver.js';
import {MixProfileBank,mixInstrumentSignature,mixProfileLevel,mixProfileControl,type MixProfile} from './mix-calibration.js';
import {MIX_FACTORY_PROFILES} from './mix-profiles.js';

export interface PartMix {
  /** Explicit author trim, separate from note velocity and timbre. */
  gainDb?: number;
  /** 0..1 musical prominence; omitted uses a conservative role default. */
  importance?: number;
}
export interface MixOrigin {chip:string;voice:string}
export interface MixOptions {profiles?:MixProfileBank;sampleRate?:number}
export interface MixDiagnostic {part:string;kind:string;detail:string}
export interface MixReport {version:1;calibratedNotes:number;fallbackNotes:number;diagnostics:MixDiagnostic[]}
export interface MixNote {
  part:string;role:Role;voice:string;instrument:Instrument;pitch:number;start:number;end:number;
  origin?:MixOrigin;referenceInstrument?:Instrument;mix?:PartMix;sourcePitch?:number;
  /** Audible control intervals, before calibration. Undefined means the full note. */
  activity?:readonly {start:number;end:number}[];
}

// A fixed, versioned factory collection is distinct from the bounded cache of
// user-supplied profiles. No song identity participates in either lookup.
const factory=new Map<string,MixProfile>();
const groupVoice=(chip:string,voice:string)=>chip==='md'&&/^fm[1-6]$/.test(voice)?'fm1':chip==='2a03'&&voice==='p2'?'p1':voice;
const key=(chip:string,voice:string,signature:string,rate:number)=>JSON.stringify([chip,groupVoice(chip,voice),signature,rate]);
for(const profile of MIX_FACTORY_PROFILES)factory.set(key(profile.chip,profile.voice,profile.signature,profile.sampleRate),profile);
const prominence:Record<Role,number>={lead:1,chord:.65,bass:.55,perc:.45};

/** One event timeline per musical role: file track grouping cannot change density.
 * Density depends only on voices actually
 * allocated and active at that instant, not future notes or omitted voices. */
function densityTimeline(notes:MixNote[]){
  const events=new Map<string,Map<number,number>>();
  for(const note of notes){
    if(note.mix?.importance===0)continue;
    let part=events.get(note.role);if(!part){part=new Map();events.set(note.role,part);}
    for(const span of note.activity??[{start:note.start,end:note.end}]){
      part.set(span.start,(part.get(span.start)??0)+1);part.set(span.end,(part.get(span.end)??0)-1);
    }
  }
  const result=new Map<string,{at:number;count:number;from:number;target:number}[]>();
  for(const [part,changes] of events){
    let count=0,previous:{at:number;count:number;from:number;target:number}|undefined;
    const segments=[...changes].sort(([a],[b])=>a-b).map(([at,change])=>{
      count+=change;const target=1/Math.sqrt(Math.max(1,count));
      const from=previous&&previous.count>0?previous.target+(previous.from-previous.target)*Math.exp(-(at-previous.at)/.03):target;
      const segment={at,count,from,target};previous=segment;return segment;
    });result.set(part,segments);
  }
  return result;
}

/** Compile the expensive identity/profile lookups once per selected sound.
 * Returned frame controls are local math; no audio render or network request.
 * Native plans never enter this module unless explicitly reconstructed. */
export function planMix(chip:ChipDefinition,notes:MixNote[],options:MixOptions={}) {
  const rate=options.sampleRate??44100,report:MixReport={version:1,calibratedNotes:0,fallbackNotes:0,diagnostics:[]};
  if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new Error('Invalid mix sample rate');
  for(const note of notes){
    if(!Object.hasOwn(prominence,note.role)||!note.part||!Number.isFinite(note.start)||!Number.isFinite(note.end)||note.end<=note.start||!Number.isFinite(note.pitch))throw new Error('Invalid mix note');
    if(note.mix?.gainDb!==undefined&&(!Number.isFinite(note.mix.gainDb)||note.mix.gainDb< -96||note.mix.gainDb>12)||note.mix?.importance!==undefined&&(!Number.isFinite(note.mix.importance)||note.mix.importance<0||note.mix.importance>1))throw new Error('Invalid part mix');
  }
  const warned=new Set<string>(),timeline=densityTimeline(notes);
  const warn=(part:string,kind:string,detail:string)=>{const id=part+':'+kind;if(!warned.has(id)){warned.add(id);report.diagnostics.push({part,kind,detail});}};
  const lookupCache=new Map<Instrument,Map<string,MixProfile|undefined>>();
  const lookup=(id:string,voice:string,instrument:Instrument)=>{
    let cache=lookupCache.get(instrument);if(!cache){cache=new Map();lookupCache.set(instrument,cache);}
    const address=id+':'+voice;if(cache.has(address))return cache.get(address);
    const signature=mixInstrumentSignature(instrument),profile=options.profiles?.find(id,voice,instrument,rate)??factory.get(key(id,voice,signature,rate));cache.set(address,profile);return profile;
  };
  const decisions=notes.map(note=>{
    const target=lookup(chip.spec.id,note.voice,note.instrument),source=note.origin&&note.referenceInstrument?lookup(note.origin.chip,note.origin.voice,note.referenceInstrument):undefined;
    if(target)report.calibratedNotes++;else{report.fallbackNotes++;warn(note.part,'mix-calibration','Instrument response is uncalibrated; conservative mix fallback');}
    if(note.origin&&!source)warn(note.part,'mix-source','Source loudness is uncalibrated; role balance is an approximation');
    const importance=note.mix?.importance??(source?1:prominence[note.role]);
    const trim=10**((note.mix?.gainDb??0)/20)*importance;
    if(chip.spec.id==='2a03'&&note.voice==='tri')warn(note.part,'mix-resolution','NES triangle has no amplitude control; requested attenuation may be unachievable');
    return {note,target,source,trim,headroomWarned:false,lastVolume:NaN,lastTarget:NaN,lastSource:NaN,lastDensity:NaN,lastLevel:0,changes:timeline.get(note.role)??[{at:note.start,count:0,from:1,target:1}]};
  });
  return {report,level(index:number,volume:number,at:number,noisePeriod=9,pitch?:number){
    const d=decisions[index],{note,target,source}=d;
    if(volume<=0)return 0;
    let lo=0,hi=d.changes.length;while(lo+1<hi){const m=(lo+hi)>>>1;if(d.changes[m].at<=at)lo=m;else hi=m;}
    const segment=d.changes[lo],densityGain=segment.from===segment.target?segment.target:segment.target+(segment.from-segment.target)*Math.exp(-Math.max(0,at-segment.at)/.03),duration=note.end-note.start;
    const targetPosition=target?.axis==='noise-period'?noisePeriod:pitch??note.pitch;
    const sourcePosition=source?.axis==='noise-period'?noisePeriod:(pitch??note.pitch)-note.pitch+(note.sourcePitch??note.pitch);
    if(volume===d.lastVolume&&targetPosition===d.lastTarget&&sourcePosition===d.lastSource&&densityGain===d.lastDensity)return d.lastLevel;
    d.lastVolume=volume;d.lastTarget=targetPosition;d.lastSource=sourcePosition;d.lastDensity=densityGain;
    let sourceControl=volume;
    if(source?.chip==='md'&&(source.voice.startsWith('psg')||source.voice==='noise'))sourceControl=15-Math.min(15,Math.max(0,Math.round(-20*Math.log10(Math.min(1,volume/15))/2)));
    const sourceRms=source?mixProfileLevel(source,sourcePosition,duration,false,sourceControl):.1*volume/15;
    const requested=sourceRms*d.trim*densityGain;
    if(target){
      const maximum=mixProfileLevel(target,targetPosition,duration);
      if(requested>maximum*1.001&&!d.headroomWarned){d.headroomWarned=true;warn(note.part,'mix-headroom','Requested balance exceeds instrument headroom; the control is capped');}
      return d.lastLevel=mixProfileControl(target,targetPosition,duration,requested);
    }
    // Unknown patches remain bounded and explicitly uncalibrated. No hidden
    // synchronous rendering is triggered by a live note or slider change.
    const amplitude=Math.max(0,Math.min(1,volume/15*.5*d.trim*densityGain));
    if(chip.spec.id==='md'&&(note.voice.startsWith('psg')||note.voice==='noise'))return d.lastLevel=amplitude<=0?0:15-Math.min(15,Math.max(0,Math.round(-20*Math.log10(amplitude)/2)));
    return d.lastLevel=amplitude*15;
  }};
}

/** Collapse positive frame controls into spans without counting silent holds. */
export function mixActivity(frames: readonly {at:number;volume:number}[], until:number, clock:number) {
  const spans:{start:number;end:number}[]=[];
  let start:number|undefined;
  for(const frame of frames){
    if(frame.volume>0&&start===undefined)start=frame.at/clock;
    else if(frame.volume<=0&&start!==undefined){spans.push({start,end:frame.at/clock});start=undefined;}
  }
  if(start!==undefined)spans.push({start,end:until/clock});
  return spans;
}
