import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
const moduleFrom = async (options) => {
 const out=await build({bundle:true,platform:'node',format:'esm',write:false,...options});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const workers=[];
globalThis.Worker=class {sent=[];constructor(){workers.push(this);}postMessage(data){this.sent.push(data);}terminate(){}reply(request,data){this.onmessage({data:{id:request.id,...data}});}};
const sourceText=await readFile('../../packages/chipvoice/src/playback/ProgressivePlayback.ts','utf8');
const {PreviewSource,ProgressivePlayback}=await moduleFrom({stdin:{contents:sourceText+'\nexport {PreviewSource};',resolveDir:new URL('../../packages/chipvoice/src/playback/',import.meta.url).pathname,loader:'ts'}});
const meta={frames:1000,seconds:10,loopStartSeconds:0,losses:[],mix:null,native:false};
const chunk=(start,frames,value=0)=>({start,left:new Float32Array(frames).fill(value),right:new Float32Array(frames).fill(value)});
const source=new PreviewSource({},100),worker=workers.at(-1);worker.reply(worker.sent.at(-1),meta);await source.ready;
const stale=source.read(0,25).catch(e=>e.name),oldRead=worker.sent.at(-1);source.reload({gain:.5});const reload=worker.sent.at(-1);
worker.reply(oldRead,chunk(0,25,1));assert.equal(await stale,'AbortError');worker.reply(reload,meta);await source.ready;
const fresh=source.read(0,25),freshRead=worker.sent.at(-1);assert.equal(freshRead.type,'read');worker.reply(freshRead,chunk(0,25,.5));assert.equal((await fresh).left[0],.5);source.dispose();
const gain=()=>({gain:{value:0,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){},setTargetAtTime(){}},connect(){},disconnect(){}});
const context={currentTime:0,destination:{},createGain:gain,resume:async()=>{},createBuffer:(_,frames)=>({copyToChannel(){},getChannelData:()=>new Float32Array(frames)}),createBufferSource:()=>({connect(){},disconnect(){},start(){},stop(){}})};
const player=new ProgressivePlayback(context,()=>{},100);
let release;const fakeSource={meta,sampleRate:100,read:(start,frames)=>new Promise(resolve=>{release=()=>resolve(chunk(start,frames));})};
player.source=fakeSource;player.metadata=meta;player.playing=true;
player.seek(.8);player.pause();player.seek(.2);release();await new Promise(r=>setTimeout(r,0));
release();await new Promise(r=>setTimeout(r,0));assert.equal(player.phase(),.2,'latest paused seek wins');player.dispose();
const fakeBackend=`export const outputTime = ctx => ctx.currentTime; export class BufferPlayback {
 playing=false;loading=false;loop=true;error='';buffers=[];output={disconnect(){},connect(){}};
 constructor() {globalThis.backends.push(this);} setVolume(){}setLoop(v){this.loop=v;}
 async toggle(){this.playing=!this.playing;}pause(){this.playing=false;}phase(){return .3;}
 seek(){}cancelSelection(){}dispose(){}select(){return new Promise(r=>this.finish=r);}load(){return this.select();}
} export {BufferPlayback as ProgressivePlayback};`;
globalThis.backends=[];
const {ArrangementPlayback}=await moduleFrom({entryPoints:['src/audio/ArrangementPlayback.ts'],plugins:[{name:'backends',setup(b){b.onResolve({filter:/^(chipvoice|\.\/BufferPlayback\.mjs)$/},()=>({path:'backend',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:fakeBackend,loader:'js'}));}}]});
const arrangement=new ArrangementPlayback(context,()=>{}),[recording,preview]=globalThis.backends;
const pending=arrangement.selectPlan({},null,'new');await arrangement.toggle();preview.finish(true);await pending;
assert.equal(preview.playing,true,'Play during cross-engine preparation reaches incoming source');assert.equal(arrangement.playing,true);
arrangement.pause();const back=arrangement.select([],[]);await arrangement.toggle();recording.finish(true);await back;assert.equal(recording.playing,true,'symmetric handoff preserves Play');
const cancelled=arrangement.selectPlan({},null,'cancel');arrangement.cancelSelection();preview.finish(true);assert.equal(await cancelled,false);assert.equal(preview.playing,false,'cancelled hidden source stops');assert.equal(recording.playing,true);
arrangement.dispose();
console.log('PASS stale worker PCM isolation, latest paused seek, cross-engine Play intent and cancellation');
