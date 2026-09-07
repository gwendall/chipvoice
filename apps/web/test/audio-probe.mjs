/** Test-only common output tap; captures outgoing and incoming nodes together. */
export function installOutputProbe(){
 const buses=new WeakMap(),connect=AudioNode.prototype.connect;
 AudioNode.prototype.connect=function(destination,...args){
  if(destination===this.context.destination){
   let bus=buses.get(this.context);
   if(!bus){bus=this.context.createGain();connect.call(bus,destination);buses.set(this.context,bus);window.audioBus=bus;}
   return connect.call(this,bus,...args);
  }
  return connect.call(this,destination,...args);
 };
}
export async function outputRms(page){
 return page.evaluate(async()=>{
  const bus=window.audioBus,analyser=bus.context.createAnalyser();bus.connect(analyser);
  await new Promise(resolve=>setTimeout(resolve,120));
  const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);bus.disconnect(analyser);
  return Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
 });
}
/** Observe a bounded phrase, including authored opening rests. Wall time is
 * only a failure deadline: an overloaded device may advance audio slowly. */
export async function outputPhraseRms(page, threshold=.001){
 const start=await page.evaluate(()=>window.audioBus.context.currentTime),deadline=Date.now()+30000;
 let peak=0;
 do{
  peak=Math.max(peak,await outputRms(page));
  if(peak>threshold)break;
 }while(Date.now()<deadline&&await page.evaluate(start=>window.audioBus.context.currentTime-start,start)<8);
 return peak;
}
