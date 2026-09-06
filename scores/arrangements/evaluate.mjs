import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {planPerformance,renderPerformance,toWav} from '../../packages/chipvoice/dist/index.js';
import {measureAudio,comparePcm} from '../../packages/conform/src/listening/metrics.mjs';
import {observeSnesMixer} from '../../packages/conform/src/listening/snes-mixer.mjs';
import {arrangementIds,arrangementChips,loadArrangement,checkArrangements} from './check.mjs';
const out='.artifacts/arrangements/evaluation';
await mkdir(out,{recursive:true});
const publication='apps/web/public/arrangement-data';await mkdir(publication,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const engine=createHash('sha256');
for(const name of (await readdir('packages/chipvoice/dist',{recursive:true})).filter(n=>n.endsWith('.js')).sort())engine.update(name).update(await readFile(`packages/chipvoice/dist/${name}`));
const report={version:1,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),engineSha256:engine.digest('hex'),evaluationSha256:hash(await readFile(new URL('./evaluate.mjs',import.meta.url))),sourceChecks:await checkArrangements(),createdAt:new Date().toISOString(),pieces:[]};
async function asset(id,audio){
 const metrics=measureAudio(audio);
 if(metrics.invalidSamples||metrics.clippedSamples)throw new Error(`${id}: invalid or clipped PCM`);
 const wav=toWav(audio),path=`${out}/${id}.wav`;await writeFile(path,wav);
 const encoded=spawnSync('ffmpeg',['-y','-v','error','-i',path,'-c:a','flac',`${publication}/${id}.flac`]);if(encoded.status)throw new Error(encoded.stderr.toString());
 return {file:`/arrangement-data/${id}.flac`,sha256:hash(await readFile(`${publication}/${id}.flac`)),sourceWavSha256:hash(wav),metrics};
}
for(const id of arrangementIds){
 const score=await loadArrangement(id),piece={id,title:score.title,source:score.source,notices:score.notices,scoreSha256:hash(await readFile(`scores/arrangements/${id}.json`)),parts:score.parts.map(p=>({id:p.id,name:p.name,role:p.role,notes:p.notes.length,priority:p.priority})),cases:[]};
 for(const chip of arrangementChips){
  const plan=id==='mario'&&chip.spec.id==='2a03'?JSON.parse(await readFile('scores/arrangements/mario-native.json')):planPerformance(score,chip,{allowLoss:true});
  const audio=renderPerformance(plan,chip),repeated=renderPerformance(plan,chip),repeat=comparePcm(audio,repeated,0);
  if(!repeat.ok)throw new Error(`${id}/${chip.spec.id}: nondeterministic audio`);
  let mixer;
  if(chip.spec.id==='snes'){
   const core=chip.digital();for(const block of plan.memory)core.load(block.address,block.bytes);core.schedule(plan.events);mixer=observeSnesMixer(core);core.trace(Math.round(plan.seconds*chip.spec.clockHz),()=>{});
   if(mixer.mainClampedAdditions||mixer.echoClampedAdditions)throw new Error(`${id}: internal SNES clipping: ${JSON.stringify(mixer)}`);
  }
  const row={chip:chip.spec.id,seconds:plan.seconds,loopStartSeconds:plan.loopStartSeconds,mode:id==='mario'&&chip.spec.id==='2a03'?'native-commands':'adaptation',notes:id==='mario'&&chip.spec.id==='2a03'?score.parts.reduce((sum,p)=>sum+p.notes.length,0):plan.notes.length,losses:plan.losses,repeat,mixer,asset:await asset(`${id}-${chip.spec.id}`,audio)};
  piece.cases.push(row);console.log(`PASS ${id}/${chip.spec.id}: ${plan.seconds.toFixed(2)}s, ${row.losses.filter(l=>l.kind==='voice-omitted').length} omitted, ${row.asset.metrics.rmsDbFS.toFixed(1)} dBFS RMS`);
 }
 if(id==='mario'){
  const manifest=JSON.parse(await readFile('.artifacts/arrangements/native-reference.json'));
  const evidence=JSON.parse(await readFile('scores/arrangements/references/mario.json'));
  if(manifest.sourceSha256!==score.source.sha256||manifest.oracleRevision!==evidence.oracleRevision||manifest.track!==0||manifest.sampleRate!==44100||manifest.channels!==2||manifest.encoding!=='s16le')throw new Error('Native reference provenance differs');
  const buffer=await readFile('.artifacts/arrangements/mario-gme.pcm'),frames=Math.round(piece.cases[0].seconds*44100),left=new Float32Array(frames),right=new Float32Array(frames);
  if(hash(buffer)!==manifest.pcmSha256||manifest.pcmSha256!==evidence.pcmSha256||hash(await readFile('.artifacts/arrangements/gme-writes.txt'))!==manifest.traceSha256||manifest.traceSha256!==evidence.traceSha256)throw new Error('Native reference PCM/trace checksum differs');
  if(buffer.length<frames*4)throw new Error('Incomplete GME reference');
  for(let i=0;i<frames;i++){left[i]=buffer.readInt16LE(i*4)/32768;right[i]=buffer.readInt16LE(i*4+2)/32768;}
  piece.reference={kind:'independent-nsf',title:'Independent NSF emulator',evidence,manifest,asset:await asset('mario-reference',{left,right,sampleRate:44100})};
 }
 report.pieces.push(piece);
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
}
await writeFile(`${publication}/report.json`,JSON.stringify(report,null,2)+'\n');
console.log('PASS full arrangements: complete mixes, deterministic PCM, internal SNES headroom and independent source ledgers');
