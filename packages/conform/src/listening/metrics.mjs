/** Descriptive measurements, never a console-authenticity or musical quality score. */
const db = value => value > 0 ? 20*Math.log10(value) : null;
export function measureAudio({left,right,sampleRate}) {
  if(!left.length || right && right.length!==left.length) throw new Error('Invalid PCM channel lengths');
  let square=0,peak=0,dc=0,invalid=0,clipped=0,step=0,lr=0,ll=0,rr=0;
  const channels=right?[left,right]:[left],frames=left.length;
  const envelope=Array.from({length:100},()=>0);
  for(const samples of channels) for(let i=0;i<frames;i++){
    const value=samples[i];if(!Number.isFinite(value)){invalid++;continue;}
    square+=value*value;peak=Math.max(peak,Math.abs(value));dc+=value;
    if(Math.abs(value)>=1)clipped++;
    if(i)step=Math.max(step,Math.abs(value-samples[i-1]));
    const bucket=Math.min(99,Math.floor(i*100/frames));envelope[bucket]=Math.max(envelope[bucket],Math.abs(value));
  }
  if(right)for(let i=0;i<frames;i++){lr+=left[i]*right[i];ll+=left[i]*left[i];rr+=right[i]*right[i];}
  const rms=Math.sqrt(square/(frames*channels.length));
  return {frames,seconds:frames/sampleRate,sampleRate,channels:channels.length,invalidSamples:invalid,
    samplePeakDbFS:db(peak),rmsDbFS:db(rms),crestDb:rms>0?db(peak/rms):null,dc:dc/(frames*channels.length),
    clippedSamples:clipped,maxAdjacentStep:step,stereoCosine:right&&ll&&rr?lr/Math.sqrt(ll*rr):null,envelope};
}

/** Exact replay checks need aligned samples of the same score and render setup. */
export function comparePcm(a,b,tolerance=1e-7){
  if(a.sampleRate!==b.sampleRate||a.left.length!==b.left.length||!!a.right!==!!b.right)throw new Error('PCM shape differs');
  let maxDelta=0,firstSample=null,square=0;
  for(const channel of ['left','right'])if(a[channel])for(let i=0;i<a[channel].length;i++){
    const delta=Math.abs(a[channel][i]-b[channel][i]);
    if(!Number.isFinite(delta))return {ok:false,maxDelta:null,firstSample:i,rmsError:null};
    if(delta>tolerance&&(firstSample===null||i<firstSample))firstSample=i;maxDelta=Math.max(maxDelta,delta);square+=delta*delta;
  }
  return {ok:firstSample===null,maxDelta,firstSample,rmsError:Math.sqrt(square/(a.left.length*(a.right?2:1)))};
}

/** Averaged Hann-windowed power spectrum. Channels are measured separately,
 * so opposite-polarity stereo cannot masquerade as silence. No FFT dependency. */
export function spectrum({left,right,sampleRate}){
  const n=2048,re=new Float64Array(n),im=new Float64Array(n),power=new Float64Array(n/2+1);
  const window=Float64Array.from({length:n},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(n-1)));
  let count=0;
  for(const samples of right?[left,right]:[left])for(let frame=0;frame<8;frame++){
    const start=Math.floor(Math.max(0,samples.length-n)*frame/7);
    for(let i=0;i<n;i++){re[i]=(samples[start+i]??0)*window[i];im[i]=0;}
    for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){const value=re[i];re[i]=re[j];re[j]=value;}}
    for(let size=2;size<=n;size*=2){const angle=-2*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);
      for(let base=0;base<n;base+=size){let ar=1,ai=0;for(let j=0;j<size/2;j++){
        const odd=base+j+size/2,even=base+j,tr=ar*re[odd]-ai*im[odd],ti=ar*im[odd]+ai*re[odd];
        re[odd]=re[even]-tr;im[odd]=im[even]-ti;re[even]+=tr;im[even]+=ti;
        const next=ar*wr-ai*wi;ai=ar*wi+ai*wr;ar=next;
      }}
    }
    for(let i=0;i<power.length;i++)power[i]+=re[i]*re[i]+im[i]*im[i];count++;
  }
  let total=0,weighted=0;for(let i=1;i<power.length;i++){total+=power[i];weighted+=power[i]*i*sampleRate/n;}
  const bands=[];for(let band=0;band<64;band++){
    const low=20*(sampleRate/2/20)**(band/64),high=20*(sampleRate/2/20)**((band+1)/64);
    let sum=0,bins=0;for(let i=Math.max(1,Math.floor(low*n/sampleRate));i<Math.min(power.length,Math.ceil(high*n/sampleRate));i++){sum+=power[i];bins++;}
    bands.push({hz:Math.sqrt(low*high),db:sum>0?10*Math.log10(sum/Math.max(1,bins)/count/(n*n)):null});
  }
  return {centroidHz:total?weighted/total:null,bands};
}
