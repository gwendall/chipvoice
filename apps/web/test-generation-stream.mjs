import assert from 'node:assert/strict';
import { build } from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
await build({stdin:{contents:"export * from './src/lib/composition/model';export * from './src/lib/composition/score';",resolveDir:process.cwd()},outfile:'generated/test-generation-stream.mjs',bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const {openAIModel,compositionProject,PROVIDER_REFUSAL_CODES}=await import('./generated/test-generation-stream.mjs');
const config={apiKey:'fixture',endpoint:'http://localhost/responses',model:'fixture',maxTokens:24000};
const originalFetch=globalThis.fetch;
const encoder=new TextEncoder();
const body={status:'completed',model:'fixture',output:[{type:'message',content:[{type:'output_text',text:'{"title":"星"}'}]}],usage:{output_tokens:8}};
const event=value=>`data: ${JSON.stringify(value)}\r\n\r\n`;
try {
  let finish;
  globalThis.fetch=async(_,options)=>{
    assert.equal(JSON.parse(options.body).stream,true,'request must stream instead of waiting silently for the entire score');
    return new Response(new ReadableStream({start(controller){
      const bytes=encoder.encode(': heartbeat\r\n\r\n'+event({type:'response.output_text.delta',delta:'{"title":"星"}'}));
      for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));
      finish=()=>{controller.enqueue(encoder.encode(event({type:'response.completed',response:body})));controller.close();};
    }}),{headers:{'Content-Type':'text/event-stream'}});
  };
  const updates=[];
  const result=openAIModel(config).generate({instructions:'fixture',prompt:'fixture',schema:{},signal:new AbortController().signal,onProgress:value=>{updates.push(value);finish();}});
  assert.deepEqual((await result).value,{title:'星'});
  assert.ok(updates.some(value=>value.outputCharacters>0),'progress arrives before the completed response');
  for (const [payload, code] of [
    [event({type:'response.output_text.delta',delta:'partial'}), 'model_stream_interrupted'],
    [event({type:'response.incomplete',response:{status:'incomplete'}}), 'model_incomplete'],
    [event({type:'response.failed',response:{status:'failed'}}), 'model_error'],
    [event({type:'error',message:'PRIVATE_PROVIDER_MESSAGE'}), 'model_error'],
    ['data: not-json\n\n', 'model_stream_interrupted'],
  ]) {
    globalThis.fetch=async()=>new Response(payload,{headers:{'Content-Type':'text/event-stream'}});
    await assert.rejects(openAIModel(config).generate({instructions:'',prompt:'',schema:{},signal:new AbortController().signal}), error=>error.code===code && !error.message.includes('PRIVATE_PROVIDER_MESSAGE'));
  }
  // Decision 61: a provider refusal is named by its identifiers only, whatever shape carries it.
  const credit={type:'insufficient_quota',code:'credit_balance_exhausted',message:'PRIVATE_PROVIDER_MESSAGE',param:null};
  const originalWarn=console.warn, logged=[];
  console.warn=(...args)=>logged.push(JSON.stringify(args));
  try {
    for (const [label, response, code, status] of [
      ['credit error event (the 2026-10-06 shape)', ()=>new Response(event({type:'error',error:credit})+event({type:'response.failed',response:{status:'failed',error:{code:'credit_balance_exhausted',message:'PRIVATE_PROVIDER_MESSAGE'}}})), 'composition_unavailable', 503],
      ['credit on response.failed', ()=>new Response(event({type:'response.failed',response:{status:'failed',error:{code:'credit_balance_exhausted',message:'PRIVATE_PROVIDER_MESSAGE'}}})), 'composition_unavailable', 503],
      ['credit as an HTTP error body', ()=>new Response(JSON.stringify({error:{...credit,code:'insufficient_quota'}}),{status:429}), 'composition_unavailable', 503],
      ['rate limit, flat error event', ()=>new Response(event({type:'error',code:'rate_limit_exceeded',message:'PRIVATE_PROVIDER_MESSAGE'})), 'composition_rate_limited', 503],
      ['rate limit as an HTTP error body', ()=>new Response(JSON.stringify({error:{type:'requests',code:'rate_limit_exceeded',message:'PRIVATE_PROVIDER_MESSAGE'}}),{status:429}), 'composition_rate_limited', 503],
      ['unknown code keeps the old answer', ()=>new Response(event({type:'error',error:{type:'server_error',code:'server_error',message:'PRIVATE_PROVIDER_MESSAGE'}})), 'model_error', 502],
      ['credit after output already streamed did work', ()=>new Response(event({type:'response.output_text.delta',delta:'{"ti'})+event({type:'error',error:credit})), 'model_error', 502],
      ['unreadable HTTP error body', ()=>new Response('PRIVATE_PROVIDER_MESSAGE',{status:500}), 'model_error', 502],
    ]) {
      globalThis.fetch=async()=>response();
      await assert.rejects(openAIModel(config).generate({instructions:'',prompt:'',schema:{},signal:new AbortController().signal}), error=>error.code===code && error.status===status && !error.message.includes('PRIVATE_PROVIDER_MESSAGE'), label);
    }
  } finally {console.warn=originalWarn;}
  assert.ok(logged.some(line=>line.includes('Composition provider failure') && line.includes('credit_balance_exhausted') && line.includes('error_event')),'the provider identifiers reach the server log');
  assert.ok(logged.every(line=>!line.includes('PRIVATE_PROVIDER_MESSAGE')),'a provider message never reaches the server log');
  assert.deepEqual([...PROVIDER_REFUSAL_CODES].sort(),['composition_rate_limited','composition_unavailable']);
  console.log('PASS provider refusals for credit or rate are named by code, logged by identifier, and never relay the provider message');
  const timeout = new AbortController();
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){timeout.signal.addEventListener('abort',()=>controller.error(new TypeError('terminated')),{once:true});}}));
  const timedRequest=openAIModel(config).generate({instructions:'',prompt:'',schema:{},signal:timeout.signal});
  timeout.abort(new DOMException('deadline','TimeoutError'));
  await assert.rejects(timedRequest,error=>error.name==='TimeoutError','a terminated provider stream preserves the actual timeout reason');
  const compact={title:'Pattern test',description:'',bpm:120,patterns:[{length:1920,notes:[[0,240,72,80],[960,480,76,70]]}],parts:[{name:'Lead',role:'lead',program:80,priority:100,importance:1,clips:[{pattern:0,tick:0,repeats:4,transpose:0},{pattern:0,tick:7680,repeats:1,transpose:2}]}]};
  const request={prompt:'fixture',durationSeconds:10,target:'md',loop:false,visibility:'private'};
  const expanded=compositionProject(compact,request).source.performance;
  assert.equal(expanded.endTick,9600);
  assert.deepEqual(expanded.parts[0].notes.map(n=>[n.tick,n.endTick,n.pitch]), [[0,240,72],[960,1440,76],[1920,2160,72],[2880,3360,76],[3840,4080,72],[4800,5280,76],[5760,6000,72],[6720,7200,76],[7680,7920,74],[8640,9120,78]]);
  const ensemble=structuredClone(compact);
  ensemble.parts.push({...ensemble.parts[0],name:'Bass',role:'bass',program:38,clips:[{pattern:0,tick:0,repeats:4,transpose:-24}]});
  assert.equal(compositionProject(ensemble,request).source.performance.parts[1].notes[0].pitch,48,'parts can share and transpose the same motif');
  for (const mutate of [s=>s.patterns=Array.from({length:17},()=>s.patterns[0]),s=>s.patterns[0].notes=Array.from({length:25},()=>[0,1,72,80]),s=>s.parts[0].clips[0].repeats=64,s=>s.parts[0].clips[0].pattern=31,s=>s.patterns[0].notes[0][1]=2000,s=>s.patterns[0].notes[0][2]=128,s=>s.patterns[0].notes[0][3]=0]) {
    const bad=structuredClone(compact);mutate(bad);
    assert.throws(()=>compositionProject(bad,request),error=>error.code==='invalid_composition');
  }
  console.log('PASS bounded pattern expansion: exact notes, timing, transposition, references and ranges');
  console.log('PASS generation provider streams progress before completion, including split UTF-8 and CRLF');
} finally {globalThis.fetch=originalFetch;}
