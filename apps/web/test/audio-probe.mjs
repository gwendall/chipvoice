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
