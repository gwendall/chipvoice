// Run against a generated report that includes SNES native and baseline WAVs.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
const url=process.argv[2]??'http://127.0.0.1:3041';
const out=resolve(process.argv[3]??'.artifacts/listening/browser');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:1100}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const Native=window.AudioContext;
    window.AudioContext=class extends Native {
      constructor(...args){
        super(...args);
        const analyser=this.createAnalyser();analyser.connect(this.destination);
        const createGain=this.createGain.bind(this);
        const starts=[];
        const createSource=this.createBufferSource.bind(this);
        this.createBufferSource=()=>{
          const source=createSource(),start=source.start.bind(source);
          source.start=(...args)=>{starts.push(args);return start(...args);};return source;
        };
        this.createGain=()=>{
          const gain=createGain(),connect=gain.connect.bind(gain);
          gain.connect=target=>connect(target===this.destination?analyser:target);return gain;
        };
        window.audioProbe=()=>{
          const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
          return {state:this.state,starts,rms:Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length)};
        };
      }
    };
  });
  await page.goto(url);
  await page.getByRole('combobox',{name:'Comparaison',exact:true}).selectOption('baseline');
  await page.getByRole('button',{name:'Écouter',exact:true}).click();
  await page.waitForFunction(()=>window.audioProbe?.().rms>.001);
  const first=await page.evaluate(()=>window.audioProbe());
  assert.equal(first.state,'running');assert.equal(first.starts.length,2);
  assert.deepEqual(first.starts[0],first.starts[1],'A/B must start at the same time and offset');
  await page.getByRole('button',{name:'B',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Lecture · B'));
  await page.getByRole('button',{name:'Masquer et tirer au sort'}).click();
  assert.equal(await page.locator('#measurements').isHidden(),true);
  await page.getByRole('textbox',{name:'Observations — instrument, note et instant précis'}).fill('Browser QA: exported blinded mapping');
  await page.getByRole('button',{name:'Enregistrer cette observation'}).click();
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Exporter les observations'}).click();
  await (await downloaded).saveAs(resolve(out,'notes.json'));
  await page.getByRole('button',{name:'Révéler',exact:true}).click();
  assert.equal(await page.locator('#measurements').isVisible(),true);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.screenshot({path:resolve(out,'desktop.png'),fullPage:true});
  await page.getByRole('combobox',{name:'Piste',exact:true}).selectOption('bass');
  await page.getByRole('button',{name:'Écouter',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Lecture'));
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.getByRole('combobox',{name:'Piste',exact:true}).selectOption('mix');
  await page.getByRole('combobox',{name:'Comparaison',exact:true}).selectOption('native');
  await page.getByRole('button',{name:'Écouter',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Lecture'));
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(out,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  const result={pass:true,audio:first,checks:['same-clock A/B','non-silent browser audio','blind/reveal','export notes','stems','native reference','mobile overflow'],errors};
  await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await browser.close();}
