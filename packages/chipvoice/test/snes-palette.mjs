import assert from 'node:assert/strict';
import {arrange,renderSong,snesChip,OfflineDriver} from '../dist/index.js';
import {FACTORY_SAMPLES} from '../dist/chips/snes/bank-inline.js';
import {encodeBrr} from '../dist/chips/snes/brr.js';
const silent={bpm:144,order:[0],patterns:[{lead:'. . . .',bass:'. . . .',chord:'. . . .',perc:'. . . .',chordShape:[[0,4,7]]}]};
assert.equal(renderSong(arrange(silent,'snes'),{seconds:.5,stereo:true}).peak,0,'Sample RAM must never leak through power-on echo reads');
const ram=snesChip.driver().memory()[0];
assert.ok(ram.address+ram.bytes.length<=0xe000,'Bank must fit below echo RAM');
assert.throws(()=>encodeBrr(new Int16Array(32),true,3),/loop start/);
assert.throws(()=>encodeBrr(new Int16Array(32),true,32),/loop start/);
const families=FACTORY_SAMPLES.filter(entry=>entry.loopStart>entry.start);
assert.equal(families.length,8);
const rms=(data,from,to)=>{
  let sum=0;for(let i=from;i<to;i++)sum+=data[i]*data[i];return Math.sqrt(sum/(to-from));
};
function note(sample,hz,rate=32000){
  const core=snesChip.create(rate),driver=new OfflineDriver(core,snesChip,()=>0);
  core.setGain(.78);
  driver.playNote('v0',{note:hz,instrument:{sample,volume:[15],sustain:true},duration:1.6,at:.1});driver.flush();
  // Isolate the sample loop from feedback history and its own quantization.
  core.schedule([{at:270000,addr:0xf2,value:0x2c},{at:270005,addr:0xf3,value:0},
    {at:270010,addr:0xf2,value:0x3c},{at:270015,addr:0xf3,value:0}]);
  const left=new Float32Array(Math.round(1.5*rate));core.render(left,null,0);return left;
}
const results=[];
for(const entry of families){
  const data=note(entry.name,entry.baseHz);
  assert.ok(rms(data,32000,40000)>.003,`${entry.name} sustain is inaudibly low`);
  const loopFrames=(entry.start+entry.bytes-entry.loopStart)/9*16;
  let delta=0;for(let i=32000;i<40000;i++)delta=Math.max(delta,Math.abs(data[i]-data[i+loopFrames]));
  assert.ok(delta<1e-5,`${entry.name}: sustain loop repeats its attack or is unstable (${delta})`);
  const loopOffset=entry.loopStart-ram.address;
  assert.equal((ram.bytes[loopOffset]>>2)&3,0,'A loop entry must decode independently of the attack history');
  // Autocorrelation around the expected period, with parabolic interpolation.
  // Test low/mid/high playback, not just the pitch register's computed number.
  let worstCents=0;
  for(const hz of [110,440,880]){
    const samples=note(entry.name,hz,44100),period=44100/hz;
    const correlation=lag=>{
      let cross=0,leftPower=0,rightPower=0;
      for(let i=44100;i<56000;i++){
        cross+=samples[i]*samples[i+lag];leftPower+=samples[i]**2;rightPower+=samples[i+lag]**2;
      }
      return cross/Math.sqrt(leftPower*rightPower);
    };
    let best=-Infinity,bestLag=0;
    for(let lag=Math.floor(period*.97);lag<=Math.ceil(period*1.03);lag++){
      const value=correlation(lag);if(value>best){best=value;bestLag=lag;}
    }
    const before=correlation(bestLag-1),after=correlation(bestLag+1);
    const offset=.5*(before-after)/(before-2*best+after);
    const measured=44100/(bestLag+offset),cents=Math.abs(1200*Math.log2(measured/hz));
    assert.ok(cents<5,`${entry.name}/${hz}Hz is detuned ${cents.toFixed(2)} cents`);worstCents=Math.max(worstCents,cents);
  }
  results.push({sample:entry.name,loopDelta:delta,maxPitchErrorCents:Number(worstCents.toFixed(2))});
}
console.log('PASS SNES silent startup, eight stable attack/sustain samples and measured tuning:',JSON.stringify(results));
