import {importVgm} from '../packages/chipvoice/dist/index.js';

/** Identify repeated PCM attacks from the stream's own seek boundaries.
 * VGM can concatenate samples without another seek, so a silence-gap detector
 * alone merges consecutive kick/snare hits. Exact 32-byte attack matches
 * recover repetitions; no song-specific offsets or drum pattern is supplied.
 * Drum *family* classification is approximate, and is reported separately. */
export function extractDacPercussion(bytes){
 const values=[],times=[],seeks=[];
 importVgm(bytes,{onDacStream(){seeks.push(values.length);},onCommand(t,c,r,v){if(c===0x52&&r===0x2a){values.push(v);times.push(t);}}});
 const pcm=Buffer.from(values),prefixes=new Map(),starts=new Set(seeks);
 for(const at of seeks){
  const prefix=pcm.subarray(at,at+32);
  if(prefix.length===32&&new Set(prefix).size>4)prefixes.set(prefix.toString('hex'),prefix);
 }
 if(prefixes.size>128)throw Error('DAC analysis exceeds 128 sample attacks');
 for(const prefix of prefixes.values())for(let at=pcm.indexOf(prefix);at>=0;at=pcm.indexOf(prefix,at+32))starts.add(at);
 for(let i=1;i<times.length;i++)if(times[i]-times[i-1]>441)starts.add(i);
 const discarded=[];
 const offsets=[...starts].filter(i=>i<pcm.length).sort((a,b)=>a-b),notes=[],evidence=[];
 for(let i=0;i<offsets.length;i++){
  const from=offsets[i],to=offsets[i+1]??pcm.length,tick=times[from],endTick=times[to-1]+1;
  if(endTick<=tick)continue;
  let mean=0;for(let j=from;j<to;j++)mean+=pcm[j];mean/=(to-from);
  let energy=0,crossings=0;for(let j=from;j<to;j++){const x=pcm[j]-mean;energy+=x*x;if(j>from&&x*(pcm[j-1]-mean)<0)crossings++;}
  const rms=Math.sqrt(energy/(to-from)),crossHz=crossings/((endTick-tick)/44100);
  // Constant DAC holds are silence, even when their unsigned byte is not 128.
  if(rms<4){discarded.push({tick,endTick,rms,reason:'below -30 dBFS PCM activity floor'});continue;}
  const drum=crossHz<500?36:crossHz>1000?38:42;
  notes.push({id:`fm6-${notes.length}`,tick,endTick,pitch:drum,velocity:Math.min(127,Math.max(1,Math.round(127*rms/32))),drum});
  evidence.push({tick,endTick,samples:to-from,rms,crossHz,drum,confidence:crossHz<500||crossHz>1000?'family-heuristic':'ambiguous'});
 }
 return {notes,evidence,discarded,attackPrefixes:prefixes.size};
}
