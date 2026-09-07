import type {PerformancePart} from './performance.js';

export const rolePriority = {lead:100,bass:80,perc:70,chord:50};

/** File order is not musical evidence. Inspect all notes, including program
 * changes, before choosing a role. Ambiguous monophonic lines stay candidates
 * for melody; callers can override every inference. No part is invented. */
export function inferMidiRole(part: PerformancePart, percussion: boolean): void {
  const choose = (role:PerformancePart['role'],confidence:'high'|'medium'|'low',reason:NonNullable<PerformancePart['roleInference']>['reason']) => {
    part.role=role;part.priority=rolePriority[role];part.roleInference={confidence,reason};
  };
  const name=part.name.toLowerCase();
  if(percussion)return choose('perc','high','channel');
  if(/\bbass\b|ベース|低音/.test(name))return choose('bass','high','name');
  if(/\blead\b|\bmelody\b|mélodie|メロディ/.test(name))return choose('lead','high','name');
  if(/\bchords?\b|\bharmony\b|\bpad\b|accord|和音|コード/.test(name))return choose('chord','high','name');
  const programs=new Set(part.notes.map(n=>n.program??0));
  if([...programs].every(p=>p>=32&&p<=39))return choose('bass','high','program');
  let duration=0,pitch=0,polyphonic=0,active=0,last=0;
  const changes=new Map<number,number>();
  for(const note of part.notes){const length=note.endTick-note.tick;duration+=length;pitch+=length*note.pitch;changes.set(note.tick,(changes.get(note.tick)??0)+1);changes.set(note.endTick,(changes.get(note.endTick)??0)-1);}
  for(const [tick,delta]of [...changes].sort(([a],[b])=>a-b)){if(active>1)polyphonic+=(tick-last)*active;active+=delta;last=tick;}
  if(polyphonic/Math.max(1,duration)>.2)return choose('chord','medium','polyphony');
  if(pitch/Math.max(1,duration)<48)return choose('bass','medium','register');
  if([...programs].every(p=>p>=80&&p<=87))return choose('lead','medium','program');
  choose('lead','low','monophony');
}
