import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {importVgm,mdChip} from '../../packages/chipvoice/dist/index.js';
const out='.artifacts/native-songs',oracle='packages/conform/oracles/nuked-opn2';await mkdir(out,{recursive:true});
execFileSync('cc',['-O2','-c',`${oracle}/ym3438.c`,'-o',`${out}/ym3438.o`]);execFileSync('c++',['-std=c++11','-O2','-I',oracle,'scores/arrangements/ym-native-oracle.cpp',`${out}/ym3438.o`,'-o',`${out}/ym-native-oracle`]);
const plan=importVgm(await readFile('scores/arrangements/sonic-native.vgm')),samples=Math.round(plan.seconds*44100);
const expected=await new Promise((resolve,reject)=>{const hash=createHash('sha256');let bytes=0;const child=spawn(`${out}/ym-native-oracle`,[`${out}/sonic-oracle/gme-writes.txt`,String(samples)],{stdio:['ignore','pipe','inherit']});child.stdout.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length;});child.on('error',reject);child.on('exit',code=>code?reject(Error(`Oracle exited ${code}`)):resolve({sha256:hash.digest('hex'),bytes}));});
const core=mdChip.digital();core.schedule(plan.events);const end=Math.round(plan.seconds*53693175),buffer=Buffer.alloc(65536),hash=createHash('sha256');let used=0,bytes=0;
while(core.cycle<end){core.run(Math.min(core.untilNext(),end-core.cycle));if(!core.ymTicked)continue;const ym=core.ym;for(let i=0;i<8;i++){buffer.writeInt16LE(i<6?ym.ch_out[i]:i===6?ym.mol:ym.mor,used);used+=2;}if(used===buffer.length){hash.update(buffer);bytes+=used;used=0;}}
if(used){hash.update(buffer.subarray(0,used));bytes+=used;}const actual={sha256:hash.digest('hex'),bytes};assert.deepEqual(actual,expected,'All six FM channels AND stereo DAC pins, every internal clock, full song');
const result={...actual,internalClocks:bytes/16,oracle:'Nuked-OPN2 1.0.12',scope:'Six FM channel values and both DAC pins after every internal clock; independent GME VGM decode, same documented bus write serialization. PSG and analog filtering are separate.'};await writeFile(`${out}/sonic-digital.json`,JSON.stringify(result,null,2)+'\n');console.log('PASS',result);
