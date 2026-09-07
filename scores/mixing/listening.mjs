import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const out='.artifacts/automatic-mixing/listening';await mkdir(out,{recursive:true});
const report=JSON.parse(await readFile('.artifacts/automatic-mixing/development/report.json'));
const keys=[],rows=[];
for(const chip of ['2a03','dmg','md','snes','c64'])for(const index of [0,12,13]){
 const item=report.cases[index*5+['2a03','dmg','md','snes','c64'].indexOf(chip)];
 const id=rows.length,swap=(id*17+3)%2,assign=swap?['automatic','legacy']:['legacy','automatic'];
 const peakRatios=item.measurements.map(m=>10**((m.metrics.samplePeakDbFS-m.metrics.rmsDbFS)/20));
 const target=Math.min(10**(-30/20),.8/Math.max(...peakRatios));
 for(const [choice,mode] of assign.entries()){
  const m=item.measurements.find(m=>m.mode===mode),gain=target/10**(m.metrics.rmsDbFS/20);
  const done=spawnSync('ffmpeg',['-y','-v','error','-i',`.artifacts/automatic-mixing/development/${index}-${chip}-${mode}.wav`,'-af',`volume=${gain}`,`${out}/${id}-${choice}.wav`]);if(done.status)throw Error(done.stderr.toString());
 }
 keys.push({id,assign});rows.push({id,title:item.title,chip});
}
await writeFile(`${out}/key.json`,JSON.stringify(keys,null,2));
await writeFile(`${out}/index.html`,`<!doctype html><meta charset="utf-8"><title>Chipvoice blind mix comparison</title><style>body{font:18px system-ui;max-width:760px;margin:40px auto;padding:20px;background:#f4f1e8;color:#23221f}section{padding:24px 0;border-bottom:1px solid #bbb}button,select{font:inherit;padding:10px}audio{display:block;margin:10px 0}</style><h1>Level-controlled mix comparison</h1><p>A and B use matched RMS, with shared headroom. Listen for musical foreground, transients, masking and pumping. RMS matching does not guarantee equal perceived loudness. No preference is preselected. Results stay local.</p><main></main><button id="export">Export observations</button><script>const rows=${JSON.stringify(rows)};for(const row of rows){const section=document.createElement('section');section.innerHTML='<h2>'+row.title+' · '+row.chip+'</h2>';for(let choice=0;choice<2;choice++){const label=document.createElement('label');label.textContent=choice?'B':'A';const audio=document.createElement('audio');audio.controls=true;audio.src=row.id+'-'+choice+'.wav';label.append(audio);section.append(label);}const vote=document.createElement('select');vote.dataset.id=row.id;for(const [value,text] of [['','Choose after listening'],['a','Prefer A'],['b','Prefer B'],['same','No preference'],['problem','Both have a problem']])vote.add(new Option(text,value));section.append(vote);document.querySelector('main').append(section);}document.querySelector('#export').onclick=()=>{const observations=[...document.querySelectorAll('select')].filter(e=>e.value).map(e=>({id:Number(e.dataset.id),preference:e.value}));const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify({observations},null,2)],{type:'application/json'}));link.download='listening-observations.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);};</script>`);
console.log('Prepared 15 blinded, level-controlled pairs; no human observations have been recorded.');
