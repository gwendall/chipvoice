// Publish an already evaluated snapshot. No rendering or oracle build in CI.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../../..');
const input=resolve(root,process.argv[2]??'.artifacts/listening/snes-polyphony-reviewed/report.json');
const report=JSON.parse(await readFile(input,'utf8'));
if(report.version!==1||!report.cases.length||report.cases.some(row=>!row.technicalPass||!row.completeLoop||row.signalWarnings?.length))throw new Error('Only passing full-loop evaluation snapshots may be published');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const version=report.engineSha256.slice(0,12),relative=`/lab-data/${version}`;
const out=resolve(root,'apps/web/public'+relative);await mkdir(out,{recursive:true});
let files=0,bytes=0;
for(const row of report.cases)for(const collection of [row.assets,row.baseline??{}])for(const entry of Object.values(collection)){
 const wav=await readFile(resolve(dirname(input),entry.file));
 if(hash(wav)!==entry.sha256)throw new Error(`Source checksum mismatch: ${entry.file}`);
 const target=resolve(out,entry.sha256+'.flac');
 let exists=true;try{await access(target);}catch{exists=false;}
 if(!exists){
  execFileSync('ffmpeg',['-v','error','-i',resolve(dirname(input),entry.file),'-c:a','flac','-compression_level','8',target]);
  const decoded=execFileSync('ffmpeg',['-v','error','-i',target,'-f','s16le','-'],{maxBuffer:64*1024*1024});
  if(!decoded.equals(wav.subarray(44)))throw new Error('FLAC did not preserve the source PCM');
  files++;
 }
 const compressed=await readFile(target);bytes+=compressed.length;
 entry.sourceWavSha256=entry.sha256;entry.sha256=hash(compressed);entry.file=`${relative}/${entry.sourceWavSha256}.flac`;
}
report.publication={format:'FLAC',losslessFrom:'16-bit evaluation WAV',sourceReportSha256:hash(await readFile(input)),revision:report.revision};
await writeFile(resolve(root,'apps/web/public/lab-data/report.json'),JSON.stringify(report));
console.log(`Published ${files} unique lossless audio files; ${report.cases.length} evaluated compositions (${version}). Asset references total ${(bytes/1048576).toFixed(1)} MiB before deduplication.`);
