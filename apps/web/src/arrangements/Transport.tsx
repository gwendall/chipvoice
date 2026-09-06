'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {BufferPlayback} from '../audio/BufferPlayback.mjs';
import {Button} from '../ui/components';

export type Overview={seconds:number;loopStart:number;parts:{id:string;name:string;role:string;notes:number[][]}[]};
const colors=['#e8bc68','#98c9ad','#b6b2ee','#ec9c83','#99cbd8'];
const time=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;

/** Static note raster + one moving cursor. The long MIDI never becomes tens
 * of thousands of DOM nodes or gets redrawn on each animation frame. */
export function Transport({player,overview,seconds,part,pending,active,onLoop}:{player:BufferPlayback|null;overview:Overview|null;seconds:number;part:string;pending:boolean;active:boolean;onLoop:(loop:boolean)=>void}){
 const root=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),cursor=useRef<HTMLDivElement>(null),range=useRef<HTMLInputElement>(null),elapsed=useRef<HTMLOutputElement>(null);
 const dragging=useRef(false);
 const [loop,setLoop]=useState(true);
 const rows=useMemo(()=>overview?.parts.filter(p=>part==='mix'||p.id===part)??[],[overview,part]);
 const activity=useMemo(()=>rows.map(row=>{let end=0;return row.notes.map(n=>{end=Math.max(end,n[1]);return [n[0],end];});}),[rows]);
 useEffect(()=>{
  const node=canvas.current;if(!node)return;
  const draw=()=>{const width=node.clientWidth,height=Math.max(104,rows.length*34),ratio=window.devicePixelRatio||1;node.width=width*ratio;node.height=height*ratio;const ctx=node.getContext('2d')!;ctx.scale(ratio,ratio);
   for(let i=0;i<rows.length;i++){const top=i*34;ctx.fillStyle=i%2?'#263d32':'#22372d';ctx.fillRect(0,top,width,34);ctx.fillStyle=colors[i%colors.length];for(const n of rows[i].notes)ctx.fillRect(n[0]*width,top+26-(n[2]%24)*.8,Math.max(1,(n[1]-n[0])*width),3);}
   ctx.strokeStyle='#b5c2a133';ctx.lineWidth=1;for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(width*i/8,0);ctx.lineTo(width*i/8,height);ctx.stroke();}
  };
  draw();const observer=new ResizeObserver(draw);observer.observe(node);return()=>observer.disconnect();
 },[rows]);
 useEffect(()=>{
  if(!active)return;
  let raf=0,lastSecond=-1;const badges=root.current?.querySelectorAll<HTMLElement>('.score-part');
  const tick=()=>{const phase=player?.phase()??0;
   if(cursor.current)cursor.current.style.transform=`translateX(${phase*100}%)`;
   if(range.current&&!dragging.current)range.current.value=String(phase*1000);
   const second=Math.floor(phase*seconds);if(second!==lastSecond){lastSecond=second;if(elapsed.current)elapsed.current.textContent=time(second);range.current?.setAttribute('aria-valuetext',`${time(second)} of ${time(seconds)}`);}
   badges?.forEach((badge,i)=>{const notes=activity[i];let lo=0,hi=notes.length;while(lo<hi){const mid=(lo+hi)>>>1;if(notes[mid][0]<=phase)lo=mid+1;else hi=mid;}badge.dataset.sounding=String(!!player?.playing&&lo>0&&notes[lo-1][1]>phase);});
   raf=requestAnimationFrame(tick);
  };tick();return()=>cancelAnimationFrame(raf);
 },[player,seconds,activity,active]);
 const seek=(phase:number)=>{player?.seek(phase);};
 return <div ref={root} className="song-transport">
  <div className="song-time"><output ref={elapsed} aria-label="Elapsed time">0:00</output><span>{time(seconds)}</span></div>
  <input ref={range} className="song-seek" type="range" aria-label="Song position" min={0} max={1000} defaultValue={0} disabled={!player?.buffers.length} onPointerDown={()=>{dragging.current=true;}} onPointerUp={()=>{dragging.current=false;}} onPointerCancel={()=>{dragging.current=false;}} onBlur={()=>{dragging.current=false;}} onChange={e=>seek(Number(e.target.value)/1000)}/>
  <div className="transport-actions"><Button disabled={!player?.buffers.length} onClick={()=>player?.restart()}>↤ Restart</Button><Button aria-pressed={loop} onClick={()=>{const next=!loop;setLoop(next);onLoop(next);}}>↻ Loop {loop?'on':'off'}</Button><span>{pending?'Preparing your next sound…':'Click the score to jump. Solo a part below.'}</span></div>
  <div className="score-overview" aria-label="Source score" style={{minHeight:Math.max(104,rows.length*34)}}>
   <div className="score-labels">{rows.map((row,i)=><div key={row.id} className="score-part" style={{borderColor:colors[i%colors.length]}} title={row.name}>{row.name}</div>)}</div>
   <div className="score-notes" onPointerDown={e=>{if(e.button!==0||!player?.buffers.length)return;const rect=e.currentTarget.getBoundingClientRect();seek(Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)));}}>
    <canvas ref={canvas} style={{height:Math.max(104,rows.length*34)}} aria-hidden="true"/>
    <div ref={cursor} className="score-cursor" aria-hidden="true"><i/></div>
   </div>
  </div>
  <p className="score-caption">Allocated source notes · cursor follows audio output{overview&&overview.loopStart>0?' · loop preserves the introduction':''}</p>
 </div>;
}
