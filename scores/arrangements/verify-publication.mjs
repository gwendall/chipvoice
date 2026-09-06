import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {arrangementIds,arrangementChips,loadArrangement,checkArrangements} from './check.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=path=>readFile(root+path);
export function validatePublication(report){
 assert.equal(report.version,1);
 assert.deepEqual(report.pieces.map(p=>p.id).sort(),[...arrangementIds].sort(),'complete source collection');
 for(const piece of report.pieces){
  assert.deepEqual(piece.cases.map(row=>row.chip).sort(),arrangementChips.map(c=>c.spec.id).sort(),'complete console matrix');
  for(const row of piece.cases){
   assert.ok(row.seconds>0&&row.notes>0);assert.equal(row.repeat.ok,true);assert.equal(row.asset.metrics.invalidSamples,0);assert.equal(row.asset.metrics.clippedSamples,0);
   assert.ok(Number.isFinite(row.asset.metrics.rmsDbFS)&&row.asset.metrics.rmsDbFS>-60,'audible mix');
   if(row.chip==='snes'){assert.equal(row.mixer.mainClampedAdditions,0);assert.equal(row.mixer.echoClampedAdditions,0);}
  }
  if(piece.id==='mario'){assert.equal(piece.reference.kind,'independent-nsf');assert.ok(piece.reference.evidence.musicCommands>0);}
 }
}
export async function verifyPublication(){
 const report=JSON.parse(await bytes('apps/web/public/arrangement-data/report.json'));validatePublication(report);
 const engine=createHash('sha256');
 for(const name of (await readdir(root+'packages/chipvoice/dist',{recursive:true})).filter(n=>n.endsWith('.js')).sort())engine.update(name).update(await bytes(`packages/chipvoice/dist/${name}`));
 assert.equal(report.engineSha256,engine.digest('hex'),'recordings match the built SDK');
 assert.equal(report.evaluationSha256,hash(await bytes('scores/arrangements/evaluate.mjs')),'evaluation method identity');
 assert.deepEqual(report.sourceChecks,await checkArrangements(),'source and register checks match publication');
 for(const piece of report.pieces){
  assert.equal(piece.scoreSha256,hash(await bytes(`scores/arrangements/${piece.id}.json`)),'complete source snapshot');
  const score=await loadArrangement(piece.id);assert.deepEqual(piece.source,score.source);
  const assets=piece.cases.map(row=>({asset:row.asset,seconds:row.seconds}));
  if(piece.reference){
   const reference=JSON.parse(await bytes(`scores/arrangements/references/${piece.id}.json`));
   assert.deepEqual(piece.reference.evidence,reference,'independent evidence pin');
   assert.equal(piece.reference.manifest.pcmSha256,reference.pcmSha256);assert.equal(piece.reference.manifest.traceSha256,reference.traceSha256);
   assets.push({asset:piece.reference.asset,seconds:piece.cases[0].seconds});
  }
  for(const {asset,seconds} of assets){
   assert.match(asset.file,/^\/arrangement-data\/[a-z0-9-]+\.flac$/);
   const path=root+'apps/web/public'+asset.file;assert.equal(hash(await readFile(path)),asset.sha256,'published bytes');
   const pcm=execFileSync('ffmpeg',['-v','error','-i',path,'-f','s16le','-ac','2','-ar','44100','-'],{maxBuffer:128*1024*1024});
   assert.equal(pcm.length,Math.round(seconds*44100)*4,'complete decoded duration');
   const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(44100,24);header.writeUInt32LE(176400,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
   assert.equal(hash(Buffer.concat([header,pcm])),asset.sourceWavSha256,'lossless encoding of the evaluated WAV');
  }
 }
 return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const report=await verifyPublication();
 for(const change of [r=>r.pieces.pop(),r=>r.pieces[0].cases.pop(),r=>r.pieces[0].cases[0].repeat.ok=false,r=>r.pieces[0].cases[0].asset.metrics.clippedSamples++,r=>r.pieces[0].cases.find(c=>c.chip==='snes').mixer.mainClampedAdditions++]){const invalid=structuredClone(report);change(invalid);assert.throws(()=>validatePublication(invalid));}
 console.log('PASS complete publication, current engine/source/evidence hashes, independent reference binding, lossless FLAC and full durations');
}
