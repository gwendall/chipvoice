"""Independent mido ledger, intentionally separate from the SDK MIDI parser.
For freezing reviewed sources. Does not rewrite candidates. Raw note boundaries
are supported here; sustain-bearing references require explicit review.
"""
import sys,json,hashlib
from pathlib import Path
import mido
p=Path(sys.argv[1]);m=mido.MidiFile(p);notes=[];tempos={0:500000};end=0;events=[]
for track,rows in enumerate(m.tracks):
    tick=0
    for order,event in enumerate(rows):
        tick+=event.time
        events.append((tick,track,order,event))
    end=max(end,tick)
programs=[0]*16;active={}
for tick,track,order,event in sorted(events,key=lambda e:e[:3]):
    if event.type=='set_tempo':tempos[tick]=event.tempo
    elif event.type=='program_change':programs[event.channel]=event.program
    elif event.type=='control_change' and event.control==64 and event.value>=64:raise ValueError('Review sustain in the independent ledger before freezing')
    elif event.type=='note_on' and event.velocity:
        key=(event.channel,event.note)
        active.setdefault(key,[]).append(dict(part=f'track-{track}-ch-{event.channel+1}',tick=tick,pitch=event.note,velocity=event.velocity,program=programs[event.channel]))
    elif event.type in ('note_on','note_off'):
        key=(event.channel,event.note)
        if not active.get(key):raise ValueError(f'Unmatched note off: {key}')
        note=active[key].pop(0);note['endTick']=tick;notes.append(note)
if any(active.values()):raise ValueError('Unterminated notes')
print(json.dumps(dict(sourceSha256=hashlib.sha256(p.read_bytes()).hexdigest(),ticksPerBeat=m.ticks_per_beat,endTick=end,tempos=[dict(tick=t,microsecondsPerBeat=v)for t,v in sorted(tempos.items()) if t<end],notes=sorted(notes,key=lambda n:(n['part'],n['tick'],n['pitch'],n['endTick']))),indent=2))
