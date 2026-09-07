import {readFile,writeFile} from 'node:fs/promises';
const path=process.argv[2]??'.artifacts/automatic-mixing/multilevel/report.json';
const report=JSON.parse(await readFile(path));
const cosine=(a,b)=>{let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):null;};
const envelope=(a,b)=>{const ma=a.reduce((s,v)=>s+v,0)/a.length,mb=b.reduce((s,v)=>s+v,0)/b.length;return cosine(a.map(v=>v-ma),b.map(v=>v-mb));};
const power=m=>m.spectrum.bands.map(b=>b.db===null?0:10**(b.db/10));
const comparisons=[];
for(const part of ['p2','p1','tri','noi']){const source=report.measurements.find(m=>m.chip==='2a03'&&m.part===part),target=report.measurements.find(m=>m.chip==='md'&&m.part===part);comparisons.push({part,rmsDifferenceDb:target.metrics.rmsDbFS-source.metrics.rmsDbFS,peakEnvelopeCorrelation:envelope(source.metrics.envelope,target.metrics.envelope),sourceMaxAdjacentStep:source.metrics.maxAdjacentStep,targetMaxAdjacentStep:target.metrics.maxAdjacentStep});}
const overlap=[];for(const chip of ['2a03','md']){const lead=report.measurements.find(m=>m.chip===chip&&m.part==='p2');for(const part of ['p1','tri','noi'])overlap.push({chip,part,leadSpectralPowerCosine:cosine(power(lead),power(report.measurements.find(m=>m.chip===chip&&m.part===part)))});}
const result={scope:'Zelda development excerpt. Peak-envelope correlation and coarse band-power cosine are descriptive proxies, not perceptual masking or click detection. Different hardware timbres need not have matching spectra.',comparisons,overlap};await writeFile('.artifacts/automatic-mixing/acoustic-diagnostics.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
