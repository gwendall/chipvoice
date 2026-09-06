import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateCollection,ensureFlac} from './scripts/publish-lab.mjs';
const report=JSON.parse(await readFile(new URL('public/lab-data/report.json',import.meta.url),'utf8'));
validateCollection(report);
for(const change of [r=>r.cases.pop(),r=>delete r.cases[0].assets.bass,r=>{r.cases[0].completeLoop=false;},r=>delete r.cases.find(row=>row.chip==='snes').assets.native,r=>{r.cases[0]=r.cases[1];}]){const invalid=structuredClone(report);change(invalid);assert.throws(()=>validateCollection(invalid));}
// Validate reused encoded assets too: an interrupted encoder must be repaired.
const directory=await mkdtemp(join(tmpdir(),'chipvoice-publication-'));
try{
 const source=join(directory,'tone.wav'),target=join(directory,'tone.flac');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.05','-c:a','pcm_s16le','-f','wav',source]);
 // Our publishing input is the canonical 44-byte-header WAV produced by toWav.
 const pcm=execFileSync('ffmpeg',['-v','error','-i',source,'-f','s16le','-']);
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(44100,24);header.writeUInt32LE(88200,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);await writeFile(source,Buffer.concat([header,pcm]));
 await ensureFlac(source,target);await writeFile(target,'interrupted encoder');await ensureFlac(source,target);
 assert.ok(execFileSync('ffmpeg',['-v','error','-i',target,'-f','s16le','-']).equals(pcm));
}finally{await rm(directory,{recursive:true,force:true});}
console.log('PASS publication rejects incomplete matrices and repairs an interrupted cached FLAC before publishing');
