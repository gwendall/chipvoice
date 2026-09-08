import assert from 'node:assert/strict';
import {build} from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
const built = await build({entryPoints:['src/player/session.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {PlaybackSession} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const session=new PlaybackSession();
function source(key, ready=true) {
 const state={playing:false,ready,loading:!ready,error:'',volume:0,disposed:0,ended:false,position:0};
 const p={key,info:()=>({title:key,href:'/'}),playing:()=>state.playing,loading:()=>state.loading,error:()=>state.error,ready:()=>state.ready,
 duration:()=>60,position:()=>state.position,play:()=>{state.playing=true;},pause:()=>{state.playing=false;},restart:()=>{state.position=0;},
 seek:value=>{state.position=value;},ended:()=>state.ended,volume:value=>{state.volume=value;},dispose:()=>{state.disposed++;state.playing=false;}};
 session.attach(p);return {p,state};
}
const a=source('a');await session.play(a.p);assert.equal(session.active,a.p);assert.equal(a.state.volume,.8);
session.release(a.p);assert.equal(a.state.disposed,0,'navigation retains the active owner');
const b=source('b',false);await session.play(b.p);assert.equal(session.active,a.p);assert.equal(a.state.playing,true);assert.equal(b.state.volume,0,'pending source is inaudible');
const c=source('c',false);await session.play(c.p);assert.equal(b.state.playing,false,'new intent cancels old pending start');b.state.ready=true;b.state.loading=false;session.refresh();assert.equal(session.active,a.p);
c.state.error='render failed';c.state.loading=false;session.refresh();assert.equal(session.active,a.p);assert.equal(a.state.playing,true);assert.equal(session.error,'render failed');
session.release(b.p);session.release(c.p);assert.equal(b.state.disposed,1);assert.equal(c.state.disposed,1);
const d=source('d',false);await session.play(d.p);session.pause();d.state.ready=true;d.state.loading=false;session.refresh();assert.equal(d.state.playing,false);assert.equal(a.state.playing,false,'pause wins for both old and incoming recordings');
session.release(d.p);await session.play(a.p);
const e=source('e');await session.play(e.p);assert.equal(session.active,e.p);assert.equal(a.state.playing,false);assert.equal(a.state.volume,0);await new Promise(r=>setTimeout(r,70));assert.equal(a.state.disposed,1,'retired detached owner is freed');assert.equal(e.state.volume,.8);
session.release(e.p);assert.equal(e.state.disposed,0);session.setVolume(.3);assert.equal(e.state.volume,.3);
let next=[];const f=source('publication:first');session.setQueue([{id:'first',title:'First'},{id:'second',title:'Second'}],'first',track=>next.push(track.id));await session.play(f.p);f.state.playing=false;f.state.ended=true;session.refresh();session.refresh();assert.deepEqual(next,['second'],'a natural ending advances exactly once');
const blind=source('comparison');blind.p.info=()=>({title:'Masked',href:'/lab',blind:true});await session.play(blind.p);assert.equal(session.queue.length,0,'comparison clears auto-advance');
const stale=source('stale-pad',false);const intent=session.request(stale.p);session.pause();assert.equal(session.audition(stale.p,intent),false,'paused note preparation cannot take ownership');
const latest=source('latest-pad',false);const latestIntent=session.request(latest.p);session.release(latest.p);assert.equal(session.audition(latest.p,latestIntent),false,'detached note preparation cannot resurrect a disposed engine');
session.dispose();assert.equal(blind.state.disposed,1);assert.equal(session.active,null);
console.log('PASS persistent ownership: navigation, pending mute, replacement, failure, cancellation, disposal, queue, comparison');
