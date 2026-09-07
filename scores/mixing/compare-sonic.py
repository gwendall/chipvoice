"""Descriptive frequency and stem balance evidence; no universal fidelity score."""
from pathlib import Path
import json
import numpy as np
from scipy.io import wavfile
from scipy.signal import welch,stft
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
out=Path('.artifacts/automatic-mixing/sonic-output')
def wav(p):
 rate,a=wavfile.read(p);assert rate==44100
 return a[:12*rate].astype(float)/32768

def metrics(a):
 f,p=welch(a,44100,axis=0,nperseg=8192);p=p.mean(axis=1)
 rms=np.sqrt(np.mean(a*a)); hi=np.sum(p[(f>=8000)&(f<=10000)]);total=np.sum(p)
 return dict(rmsDbFS=float(20*np.log10(rms)),highBandFraction=float(hi/total))
report={}
for name in ['mix','fm','dac','psg']:
 a=wav(out/(name+'.wav'));b=np.fromfile(out/(name+'-reference.pcm'),dtype='<i2').reshape(-1,2).astype(float)/32768
 report[name]={'ours':metrics(a),'reference':metrics(b)}
a=wav(Path('.artifacts/arrangements/evaluation/sonic-md.wav'));report['before']=metrics(a)
(out/'comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
fig,axes=plt.subplots(3,1,figsize=(12,8),sharex=True,sharey=True)
for ax,(title,a) in zip(axes,[('Before',a),('Filter before decimation',wav(out/'mix.wav')),('Independent GME',np.fromfile(out/'mix-reference.pcm',dtype='<i2').reshape(-1,2).astype(float)/32768)]):
 a=a.mean(axis=1);a/=np.sqrt(np.mean(a*a));f,t,z=stft(a,44100,nperseg=2048,noverlap=1536)
 ax.pcolormesh(t,f,20*np.log10(np.maximum(abs(z),1e-6)),vmin=-70,vmax=0,shading='auto',cmap='magma');ax.set_ylim(0,12000);ax.set_ylabel('Hz');ax.set_title(title)
axes[-1].set_xlabel('Seconds, unchanged source timing');fig.tight_layout();fig.savefig(out/'spectra.png',dpi=120)
