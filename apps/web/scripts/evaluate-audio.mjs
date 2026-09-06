import {build} from '../../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import {arrange,renderSong,recordSong,loopSeconds,toWav,nesChip,gbChip,mdChip,snesChip,c64Chip,validateSong} from 'chipvoice';
import {measureAudio,comparePcm,spectrum} from '../../../packages/conform/src/listening/metrics.mjs';
import {snesReference} from '../../../packages/conform/src/listening/snes-reference.mjs';
import {mkdir,readFile,writeFile,copyFile,access,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),option=(key,fallback)=>{const index=args.indexOf('--'+key);return index<0?fallback:args[index+1];};
const root=resolve(import.meta.dirname,'../../..');
const chips={nes:nesChip,'2a03':nesChip,dmg:gbChip,md:mdChip,snes:snesChip,c64:c64Chip};
const ids=option('chips','2a03,dmg,md,snes,c64').split(',');
if(ids.some(id=>!chips[id]))throw new Error('Unknown chip');
if(new Set(ids.map(id=>chips[id].spec.id)).size!==ids.length)throw new Error('Duplicate chip');
const out=resolve(root,option('out','.artifacts/listening/current'));
// Evidence directories are immutable: an iteration must use a new --out.
try{await access(resolve(out,'report.json'));throw new Error('Choose a new --out; an evaluation report already exists there.');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(out,{recursive:true});
const built=await build({entryPoints:[resolve(root,'apps/web/src/studio/presets.ts')],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {PRESETS}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
let presets=PRESETS;
if(option('scores',null)){const score=JSON.parse(await readFile(resolve(root,option('scores')),'utf8'));presets=Array.isArray(score)?score:[{id:'custom',title:score.title??'Custom',song:score}];}
if(option('preset',null))presets=presets.filter(preset=>preset.id===option('preset'));
if(!presets.length||presets.some(preset=>!/^[-a-zA-Z0-9_]+$/.test(preset.id)))throw new Error('No matching presets or invalid preset ID');
if(new Set(presets.map(preset=>preset.id)).size!==presets.length)throw new Error('Duplicate preset ID');
const secondsOption=option('seconds',null);if(secondsOption!==null&&(!Number.isFinite(Number(secondsOption))||Number(secondsOption)<=0||Number(secondsOption)>30))throw new Error('seconds must be in (0,30]');
const ffmpeg=spawnSync('ffmpeg',['-version'],{encoding:'utf8'});
const ffmpegVersion=ffmpeg.status===0?ffmpeg.stdout.split('\n')[0]:null;
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const diff=execFileSync('git',['diff','--binary','HEAD'],{cwd:root});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fingerprints(directory, prefix = '') {
 const files = {};
 for (const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
  const name = prefix + item.name;
  if (item.isDirectory()) Object.assign(files,await fingerprints(resolve(directory,item.name),name+'/'));
  else if (/\.(m?js|html|cpp|h)$/.test(name)) files[name] = hash(await readFile(resolve(directory,item.name)));
 }
 return files;
}
const engineFiles = await fingerprints(resolve(root,'packages/chipvoice/dist'));
const oracleSourceFiles = await fingerprints(resolve(root,'packages/conform/oracles/snes-spc'));
const harnessFiles = await fingerprints(resolve(root,'packages/conform/src/listening'));
harnessFiles['evaluate-audio.mjs'] = hash(await readFile(import.meta.filename));
const baselineFile=option('baseline',null),baseline=baselineFile?JSON.parse(await readFile(resolve(root,baselineFile),'utf8')):null;
if(baseline&&baseline.version!==1)throw new Error('Unsupported baseline report version');
const report={version:1,baseline:baseline?{revision:baseline.revision,engineSha256:baseline.engineSha256,reportSha256:hash(await readFile(resolve(root,baselineFile)))}:null,engineSha256:hash(JSON.stringify(engineFiles)),engineFiles,harnessFiles,oracleSourceFiles,createdAt:new Date().toISOString(),revision,workingDiffSha256:hash(diff),sourceSha256:hash(built.outputFiles[0].text),ffmpegVersion,sampleRate:44100,cases:[],notes:['No authenticity score. Technical pass is not a musical endorsement.','Isolated parts may not sum to the full mix because voices and nonlinear stages interact.','SNES native reference tests our actual score/registers/RAM against native snes_spc; it is not a game soundtrack or a line-out capture.']};
const roles=['lead','chord','bass','perc'];
const loudness=file=>{
 if(!ffmpegVersion)return null;
 const result=spawnSync('ffmpeg',['-hide_banner','-nostats','-i',file,'-af','loudnorm=I=-23:TP=-1:LRA=7:print_format=json','-f','null','-'],{encoding:'utf8',maxBuffer:1024*1024});
 if(result.status!==0)throw new Error(`Loudness analysis failed for ${file}`);
 const match=result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);if(!match)throw new Error('Missing loudness measurements');
 const data=JSON.parse(match[0]);const number=value=>Number.isFinite(Number(value))?Number(value):null;
 return {integratedLUFS:number(data.input_i),truePeakDbTP:number(data.input_tp),loudnessRangeLU:number(data.input_lra)};
};
async function asset(audio,name){
 const bytes=toWav(audio),file=resolve(out,name);await writeFile(file,bytes);
 return {file:name,sha256:hash(bytes),metrics:measureAudio(audio),spectrum:spectrum(audio),loudness:loudness(file)};
}
let failed=false;
for(const preset of presets)for(const id of ids){
 const chip=chips[id],song=arrange(preset.song,chip.spec.id),validation=validateSong(song);
 if(!validation.ok)throw new Error(`Invalid score ${preset.id}/${id}: ${JSON.stringify(validation.issues)}`);
 const seconds=secondsOption===null?Math.min(30,loopSeconds(song)):Number(secondsOption);
 const audio=renderSong(song,{seconds,stereo:true}),log=recordSong(song,{seconds});
 const core=chip.create(44100);core.setGain(.78);for(const block of log.memory)core.load?.(block.address,block.bytes);core.schedule(log.events);
 const replay={sampleRate:44100,left:new Float32Array(audio.left.length),right:new Float32Array(audio.left.length)};core.render(replay.left,replay.right,0);
 const score={...preset.song,chip:chip.spec.id};await writeFile(resolve(out,`${preset.id}-${id}-score.json`),JSON.stringify(score,null,2));
 const row={id:`${preset.id}-${id}`,preset:preset.id,title:preset.title,chip:chip.spec.id,seconds,completeLoop:seconds>=loopSeconds(song),scoreSha256:hash(JSON.stringify(score)),issues:validation.issues,replay:comparePcm(audio,replay),assets:{mix:await asset(audio,`${preset.id}-${id}-mix.wav`)}};
 if(!args.includes('--mix-only'))for(const role of roles){
  const isolated={...score,patterns:score.patterns.map(pattern=>({...pattern,...Object.fromEntries(roles.filter(other=>other!==role).map(other=>[other,pattern[other].trim().split(/\s+/).map(()=>'.').join(' ')]))}))};
  row.assets[role]=await asset(renderSong(arrange(isolated),{seconds,stereo:true}),`${preset.id}-${id}-${role}.wav`);
 }
 if(chip.spec.id==='snes'&&!args.includes('--skip-oracle')){
  const reference=snesReference(log);row.oracle=reference.comparison;row.assets.native=await asset(reference.audio,`${preset.id}-${id}-native.wav`);
 }
 if(baseline){const previous=baseline.cases.find(item=>item.id===row.id);if(previous){
  if(previous.scoreSha256!==row.scoreSha256||previous.seconds!==row.seconds||baseline.sampleRate!==report.sampleRate)throw new Error(`Baseline score/options differ for ${row.id}; do not attribute this comparison to the engine alone.`);
  row.baseline={};for(const [role,entry]of Object.entries(previous.assets)){
   const source=resolve(dirname(resolve(root,baselineFile)),entry.file);const bytes=await readFile(source);if(hash(bytes)!==entry.sha256)throw new Error('Baseline WAV hash mismatch');
   const file=`baseline-${row.id}-${role}.wav`;await copyFile(source,resolve(out,file));row.baseline[role]={...entry,file};
  }
 }}
 row.signalWarnings = [];
 if (row.oracle?.mixer.mainClampedAdditions) row.signalWarnings.push('SNES voice sum clips before master volume');
 if (row.oracle?.mixer.echoClampedAdditions) row.signalWarnings.push('SNES echo input sum clips');
 if (Object.values(row.assets).some(entry=>entry.metrics.clippedSamples)) row.signalWarnings.push('PCM exceeds WAV range');
 row.technicalPass=row.replay.ok&&(!row.oracle||row.oracle.ok)&&Object.values(row.assets).every(entry=>entry.metrics.invalidSamples===0);
 failed||=!row.technicalPass;report.cases.push(row);
 console.log(`${row.technicalPass?'PASS':'FAIL'} ${row.id}: replay Δ=${row.replay.maxDelta}${row.oracle?`, native oracle ${row.oracle.ok?'exact':'DIFF'}`:''}; ${row.assets.mix.loudness?.integratedLUFS??'unmeasured'} LUFS${row.signalWarnings.length ? '; WARN: '+row.signalWarnings.join(', ') : ''}`);
}
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
await writeFile(resolve(out,'report.js'),'window.REPORT='+JSON.stringify(report).replace(/</g,'\\u003c')+';');
await build({entryPoints:[resolve(root,'packages/conform/src/listening/player.js')],bundle:true,format:'esm',outfile:resolve(out,'player.js'),logLevel:'silent'});
for(const file of ['index.html','levels.mjs'])await copyFile(resolve(root,'packages/conform/src/listening',file),resolve(out,file));
console.log(`Report: ${out}/index.html\nServe: python3 -m http.server 3040 --bind 127.0.0.1 --directory ${JSON.stringify(out)}`);
if(failed)process.exitCode=1;
