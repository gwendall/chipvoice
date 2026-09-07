import assert from 'node:assert/strict';
import {MdOutputStage, MASTER_HZ} from '../dist/chips/md/dsp.js';
const internalRate=MASTER_HZ/42;
function magnitude(frequency,sampleRate){
 const stage=new MdOutputStage(sampleRate,{name:'probe',psgLevel:0,lowPassHz:2840,highPassHz:0,scale:1});
 const mute=[0,0,0,0],pair=[0,0];let cycle=0,re=0,im=0,count=0;
 for(let sample=0;sample<sampleRate/4;sample++){
  stage.begin();const end=Math.floor((sample+1)*internalRate/sampleRate);
  while(cycle<end){stage.add(Math.sin(2*Math.PI*frequency*cycle/internalRate),0,mute);cycle++;}
  const value=stage.end(1,pair)[0];
  if(sample>sampleRate/20){re+=value*Math.cos(2*Math.PI*frequency*sample/sampleRate);im-=value*Math.sin(2*Math.PI*frequency*sample/sampleRate);count++;}
 }
 return 2*Math.hypot(re,im)/count;
}
for(const rate of [44100,48000]){
 const low=magnitude(440,rate),ultrasonic=rate+9000,alias=magnitude(ultrasonic,rate);
 // An analog RC acts on the incoming pins before decimation. Filtering an
 // already aliased 9 kHz tone violates even this conservative continuous-time
 // RC bound, before counting the averaging window's additional attenuation.
 const rcBound=1/Math.sqrt(1+(ultrasonic/2840)**2);
 console.log({rate,low,alias,rcBound});
 assert.ok(low>.95&&low<1.01,'audio-band gain is preserved');
 const omega=2*Math.PI*ultrasonic/internalRate;
 const counts=[Math.floor(internalRate/rate),Math.ceil(internalRate/rate)];
 const boxBound=Math.max(...counts.map(n=>Math.abs(Math.sin(n*omega/2)/(n*Math.sin(omega/2)))));
 assert.ok(alias<rcBound*boxBound*1.5,'ultrasonic pin energy must be filtered before it folds into audible output');
}
console.log('PASS MD output: incoming ultrasonic pins are filtered before sample-rate reduction');
