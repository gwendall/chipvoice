// Publish an already evaluated snapshot. No rendering or oracle build in CI.
import {readFile,writeFile,mkdir,access,rename,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateCollection(report){
 const chips=['2a03','dmg','md','snes','c64'],presets=['overworld','boss','midnight'],roles=['mix','lead','chord','bass','perc'];
 if(report.version!==1||report.cases?.length!==chips.length*presets.length)throw new Error('Publication requires all three presets on all five consoles');
 for(const preset of presets)for(const chip of chips){
  const rows=report.cases.filter(row=>row.preset===preset&&row.chip===chip),row=rows[0];
  if(rows.length!==1||!row.technicalPass||!row.completeLoop||!row.replay?.ok||row.signalWarnings?.length||roles.some(role=>!row.assets?.[role]))throw new Error(`Missing or failed full-loop/stem evidence: ${preset}/${chip}`);
  if(chip==='snes'&&(!row.oracle?.ok||!row.assets.native||roles.some(role=>!row.baseline?.[role])))throw new Error(`Missing native or before/after SNES evidence: ${preset}`);
 }
}
export async function ensureFlac(source,target){
 const wav=await readFile(source);
 const verify=file=>execFileSync('ffmpeg',['-v','error','-i',file,'-f','s16le','-'],{maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}).equals(wav.subarray(44));
 let valid=false;try{await access(target);valid=verify(target);}catch{}
 if(!valid){
  const temporary=target+'.tmp';
  try{
   execFileSync('ffmpeg',['-v','error','-y','-i',source,'-c:a','flac','-compression_level','8','-f','flac',temporary]);
   if(!verify(temporary))throw new Error('FLAC did not preserve the source PCM');
   await rename(temporary,target);
  }finally{await rm(temporary,{force:true});}
 }
 return readFile(target);
}
export async function publish(input){
 const report=JSON.parse(await readFile(input,'utf8'));validateCollection(report);
 const version=report.engineSha256.slice(0,12),relative=`/lab-data/${version}`;
 const out=resolve(root,'apps/web/public'+relative);await mkdir(out,{recursive:true});
 const verified=new Map();
 for(const row of report.cases)for(const collection of [row.assets,row.baseline??{}])for(const entry of Object.values(collection)){
  const source=resolve(dirname(input),entry.file),wav=await readFile(source);
  if(hash(wav)!==entry.sha256)throw new Error(`Source checksum mismatch: ${entry.file}`);
  const sourceHash=entry.sha256;
  if(!verified.has(sourceHash)){
   const compressed=await ensureFlac(source,resolve(out,sourceHash+'.flac'));
   verified.set(sourceHash,{hash:hash(compressed),bytes:compressed.length});
  }
  entry.sourceWavSha256=sourceHash;entry.sha256=verified.get(sourceHash).hash;entry.file=`${relative}/${sourceHash}.flac`;
 }
 report.publication={format:'FLAC',losslessFrom:'16-bit evaluation WAV',sourceReportSha256:hash(await readFile(input)),revision:report.revision};
 const manifest=resolve(root,'apps/web/public/lab-data/report.json');
 await writeFile(manifest+'.tmp',JSON.stringify(report));await rename(manifest+'.tmp',manifest);
 console.log(`Published ${verified.size} verified lossless recordings; ${report.cases.length} compositions (${version}), ${(Array.from(verified.values()).reduce((total,value)=>total+value.bytes,0)/1048576).toFixed(1)} MiB.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await publish(resolve(root,process.argv[2]??'.artifacts/listening/snes-polyphony-reviewed/report.json'));
