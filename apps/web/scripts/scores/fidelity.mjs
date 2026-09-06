import {noteToFreq,arrange,nesChip,gbChip,mdChip,snesChip,c64Chip} from '../../../../packages/chipvoice/dist/index.js';
import {Sequencer} from '../../../../packages/chipvoice/dist/sequencer.js';

const pitch=token=>{const hz=noteToFreq(token);return hz?Math.round(69+12*Math.log2(hz/440)):null;};
/** Decode actual tracker boundaries, independently of the recipe compiler. */
export function scoreMelody(score){
 const notes=[],unexpectedRoles=[];const grid=score.stepsPerBeat??4;let offset=0;
 for(const index of score.order){
  const p=score.patterns[index],line=p.lead.trim().split(/\s+/);let active=null;
  for(let step=0;step<=line.length;step++){
   const token=line[step]??'=';if(token==='.')continue;
   if(active)notes.push([active.at,(offset+step)/grid,active.pitch]);
   const midi=pitch(token);active=midi===null?null:{at:(offset+step)/grid,pitch:midi};
  }
  for(const role of ['bass','chord','perc'])if(p[role].trim().split(/\s+/).some(t=>t!=='.'&&t!=='='))unexpectedRoles.push({pattern:index,role});
  offset+=p.bass.trim().split(/\s+/).length;
 }
 return {notes,beats:offset/grid,unexpectedRoles};
}
/** Align pitch sequences before checking absolute onset/release positions.
 * No octave folding, tempo fitting, or time warping can hide a wrong note. */
export function compareMelody(reference,actual){
 const a=reference.notes,b=actual.notes,n=a.length,m=b.length,dp=Array.from({length:n+1},()=>new Float64Array(m+1));
 for(let i=0;i<=n;i++)dp[i][0]=i;for(let j=0;j<=m;j++)dp[0][j]=j;
 const cost=(i,j)=>(a[i][2]===b[j][2]?0:1)+Math.min(.1,Math.abs(a[i][0]-b[j][0])*.001);
 for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+cost(i-1,j-1));
 let i=n,j=m;const missing=[],extra=[],wrongPitch=[],timing=[];let maxOnset=0,maxRelease=0,maxDuration=0;
 while(i||j){
  if(i&&j&&Math.abs(dp[i][j]-dp[i-1][j-1]-cost(i-1,j-1))<1e-8){
   const source=a[--i],rendered=b[--j];if(source[2]!==rendered[2])wrongPitch.push({referenceIndex:i,actualIndex:j,source:source[2],actual:rendered[2]});
   const onset=Math.abs(source[0]-rendered[0]),release=Math.abs(source[1]-rendered[1]);
   maxOnset=Math.max(maxOnset,onset);maxRelease=Math.max(maxRelease,release);maxDuration=Math.max(maxDuration,Math.abs((source[1]-source[0])-(rendered[1]-rendered[0])));
   if(onset>reference.timingToleranceBeats||release>reference.timingToleranceBeats)timing.push({referenceIndex:i,source,actual:rendered});
  }else if(i&&Math.abs(dp[i][j]-dp[i-1][j]-1)<1e-8)missing.push(--i);else extra.push(--j);
 }
 const durationMatches=Math.abs(actual.beats-reference.beats)<1e-8,unexpectedRoles=actual.unexpectedRoles??[];
 return {pass:!missing.length&&!extra.length&&!wrongPitch.length&&!timing.length&&durationMatches&&!unexpectedRoles.length,referenceNotes:n,actualNotes:m,missing,extra,wrongPitch,timing,durationMatches,unexpectedRoles,maxOnsetBeats:maxOnset,maxReleaseBeats:maxRelease,maxDurationBeats:maxDuration};
}
/** Observe the real sequencer's note sink on all five role maps. The tracker
 * lead articulation is 96% of the written duration; remove that declared gate
 * only for this notation comparison (not an audio-fidelity claim). */
export function scheduledMelody(score,chip){
 const song=arrange(score,chip.spec.id),notes=[],unexpectedRoles=[];const secondsPerBeat=60/song.bpm;
 const sink={playNote(channel,event){if(channel===chip.spec.roles.lead)notes.push([event.at/secondsPerBeat,(event.at+event.duration/.96)/secondsPerBeat,pitch(event.note)]);else unexpectedRoles.push(channel);},stop(){}};
 const seq=new Sequencer(sink,{canPlay:()=>true},()=>0,{live:false,roles:chip.spec.roles,chordVoices:chip.spec.chordVoices});
 // play() starts exactly at an explicit musical position and audio clock.
 seq.play(song,{step:0,orderIndex:0,progress:0},0);
 const beats=scoreMelody(score).beats;seq.pump(beats*secondsPerBeat-1e-7);seq.stop();
 return {notes,beats,unexpectedRoles};
}
export const fidelityChips=[nesChip,gbChip,mdChip,snesChip,c64Chip];
