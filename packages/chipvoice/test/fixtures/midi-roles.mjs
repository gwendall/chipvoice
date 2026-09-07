const variable=n=>{const bytes=[n&127];while(n>>=7)bytes.unshift((n&127)|128);return bytes;};
const chunk=(type,data)=>{const header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(data.length,4);return Buffer.concat([header,Buffer.from(data)]);};
const track=(channel,pitches,duration)=>chunk('MTrk',[0,0xc0|channel,80,...pitches.flatMap(p=>[0,0x90|channel,p,100]),...variable(duration),0x80|channel,pitches[0],0,...pitches.slice(1).flatMap(p=>[0,0x80|channel,p,0]),0,0xff,0x2f,0]);
export function roleMidi(accompanimentFirst=false,duration=96){const melody=track(0,[72],duration),harmony=track(1,[48,52,55],duration);return Buffer.concat([chunk('MThd',[0,1,0,2,0,96]),...(accompanimentFirst?[harmony,melody]:[melody,harmony])]);}
