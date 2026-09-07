import {validatePerformance} from '../packages/chipvoice/dist/index.js';

/** Musical observer for PORTS and the score display. Raw VGM commands, not
 * these inferred intervals, remain the native playback and verification source.
 * Supports normal six-channel FM and PSG; special FM modes fail explicitly. */
export function vgmPerformance(plan,{title,source}) {
 const endTick=Math.round(plan.seconds*44100),parts=Array.from({length:10},(_,i)=>({id:i<6?`fm${i+1}`:i<9?`psg${i-5}`:'noise',name:i===0?'Melody · FM 1':i===1?'Bass · FM 2':i===5?'Drums · DAC':i<6?`Harmony · FM ${i+1}`:i<9?`Harmony · PSG ${i-5}`:'PSG noise',role:i===0?'lead':i===1?'bass':i===5||i===9?'perc':'chord',priority:i===0?100:i===1?90:i===5?80:60-i,notes:[],instruments:{}}));
 const regs=new Uint8Array(512),latches=[0,0],frequency=new Uint16Array(6),active=Array(10).fill(null),period=new Uint16Array(3),attenuation=new Uint8Array(4).fill(15),patches=new Map();
 let high=0,psgLatch=0,lastDac=-Infinity;
 const pitch=hz=>69+12*Math.log2(hz/440);
 const finish=(i,t)=>{if(active[i]){active[i].endTick=t;active[i]=null;}};
 const start=(i,t,p,extra={})=>{finish(i,t);if(!Number.isFinite(p)||p<0||p>127)return;const n={id:`${parts[i].id}-${parts[i].notes.length}`,tick:t,endTick,pitch:p,velocity:127,...extra};parts[i].notes.push(n);active[i]=n;};
 const expression=(i,t,p,gain)=>{const n=active[i];if(!n)return;const point={tick:t,pitch:p-n.pitch,...(gain===undefined?{}:{gain})};n.expression??=[];const prev=n.expression.at(-1);if(prev?.tick===t)n.expression[n.expression.length-1]=point;else if(!prev||prev.pitch!==point.pitch||prev.gain!==point.gain)n.expression.push(point);};
 const fmPitch=i=>pitch((frequency[i]&2047)*7670453/144/2**(21-((frequency[i]>>11)&7)));
 const patch=i=>{const base=Math.floor(i/3)*256+i%3,r=n=>regs[base+n];return {algorithm:r(0xb0)&7,feedback:r(0xb0)>>3&7,ams:r(0xb4)>>4&3,pms:r(0xb4)&7,ops:[0,8,4,12].map(o=>({dt:r(0x30+o)>>4&7,mul:r(0x30+o)&15,tl:r(0x40+o)&127,ks:r(0x50+o)>>6,ar:r(0x50+o)&31,am:!!(r(0x60+o)&128),dr:r(0x60+o)&31,sr:r(0x70+o)&31,sl:r(0x80+o)>>4,rr:r(0x80+o)&15}))};};
 for(const e of plan.events){const tick=Math.round(e.at*44100/53693175);if(tick>=endTick)break;
  if(e.addr===0xc00011){const v=e.value;if(v&128)psgLatch=v>>4&7;const ch=psgLatch>>1,i=ch+6;
   if(psgLatch&1){attenuation[ch]=v&15;if(attenuation[ch]===15)finish(i,tick);else if(ch<3){const p=pitch(3579545/(32*period[ch]));if(!active[i])start(i,tick,p);expression(i,tick,p,10**(-attenuation[ch]/10));}}
   else if(ch<3){period[ch]=v&128?(period[ch]&0x3f0)|(v&15):(period[ch]&15)|((v&63)<<4);if(!(v&128)&&active[i]){const p=pitch(3579545/(32*period[ch]));if(Math.abs(p-active[i].pitch)>.5)start(i,tick,p);expression(i,tick,p,10**(-attenuation[ch]/10));}}
   else if(attenuation[ch]<15)start(i,tick,42,{drum:42});
   continue;
  }
  const port=e.addr&2?1:0;if(!(e.addr&1)){latches[port]=e.value;continue;}const reg=latches[port],value=e.value;regs[port*256+reg]=value;
  if(!port&&reg===0x27&&(value&0xc0))throw Error('Portable observer does not support special FM mode');
  if(reg>=0xa4&&reg<=0xa6)high=value;
  if(reg>=0xa0&&reg<=0xa2){const i=port*3+reg-0xa0;frequency[i]=(high<<8)|value;if(active[i])expression(i,tick,fmPitch(i));}
  if(!port&&reg===0x28){const i=(value&3)+(value&4?3:0);if(i>=6)continue;if(!(value&0xf0))finish(i,tick);else{const fm=patch(i),key=JSON.stringify(fm);if(!patches.has(key))patches.set(key,patches.size);const program=patches.get(key);parts[i].instruments[`md:${program}`]={volume:[15],sustain:true,fm};start(i,tick,fmPitch(i),{program});}}
  if(!port&&reg===0x2a&&(regs[0x2b]&128)){
   // A silence in the DAC stream separates bursts; this is an observation,
   // not a claim to recover the game's drum names or sample boundaries.
   if(tick-lastDac>441){if(active[5])finish(5,Math.min(tick,lastDac+1));start(5,tick,36,{drum:36});}
   lastDac=tick;
  }
 }
 if(active[5])finish(5,Math.min(endTick,lastDac+1));
 for(const p of parts){p.notes=p.notes.filter(n=>n.endTick>n.tick);for(const n of p.notes)if(n.expression)n.expression=n.expression.filter(x=>x.tick<n.endTick);}
 const score={version:1,title,ticksPerBeat:44100,endTick,loopStartTick:Math.round(plan.loopStartSeconds*44100),tempos:[{tick:0,microsecondsPerBeat:1000000}],parts:parts.filter(p=>p.notes.length),source,notices:['Native playback retains every FM/PSG/DAC command. The score display and cross-console ports infer notes from register activity.','Portable FM intervals preserve key-on/off and frequency changes; envelopes, stereo, release tails and DAC drum identities are not an exact transcription.']};
 validatePerformance(score);return score;
}
