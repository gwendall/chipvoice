import type {ChipDefinition, NoteFrame} from './chip.js';
import type {MixReport} from './mix.js';

export interface MixFrames {frames: Pick<NoteFrame, 'at' | 'volume'>[]; until: number}

/** Bound the SNES factory driver's *internal* dry and feedback buses, before
 * master/output gain. Samples can reach full scale regardless of calibration.
 * Its FIR has sum(abs(taps))/128 = 172/128 and feedback = 56/128.
 * B <= (1/FIR - feedback)*128 bounds both FIR input and feedback writes.
 * 38 register units leaves integer rounding margin below that bound (39.26).
 * Other chips have different mixer models; this is not a universal limiter.
 * Native captures and mix:false never call this preparation-only function. */
export function balanceMixFrames(chip: ChipDefinition, notes: MixFrames[], report: MixReport): void {
  if (chip.spec.id !== 'snes') return;
  const clock = chip.spec.clockHz, attack = .03 * clock;
  // Gain-mode release decreases an 11-bit envelope at least once per sample.
  // 80 ms includes its <=64 ms lifetime and the driver's voice stagger.
  const tail = .08 * clock, changes = new Map<number, number>();
  const add = (at: number, delta: number) => changes.set(at, (changes.get(at) ?? 0) + delta);
  for (const note of notes) {
    let previous = 0, start = 0;
    for (const frame of note.frames) {
      const demand = Math.ceil(Math.max(0, Math.min(15, frame.volume)) * 31 / 15);
      if (demand !== previous) {
        if (previous) {add(start, previous); add(frame.at + .012 * clock, -previous);}
        start = frame.at; previous = demand;
      }
    }
    if (previous) {add(start, previous); add(note.until + tail + .012 * clock, -previous);}
  }
  let demand = 0;
  const events:{at:number;target:number}[]=[];
  let previousTarget=1;
  for(const [at,delta] of [...changes].sort(([a],[b])=>a-b)){
    const target=Math.min(1,38/Math.max(1,demand+=delta));
    if(target!==previousTarget){events.push({at,target});previousTarget=target;}
  }
  if (!events.some(e => e.target < 1)) return;
  // Include recovery/anticipation endpoints. Linear ramps stay below the
  // piecewise-constant bound; release never overshoots the next reduction.
  const times = [...new Set(events.flatMap((e,i) => [e.at, e.target<(events[i-1]?.target??1)?Math.max(0,e.at-attack):e.at+attack]))].sort((a, b) => a - b);
  let event = 0, target = 1;
  const gains = times.map(at => {
    while(event<events.length&&events[event].at<at)target=events[event++].target;
    const before=target;
    while(event<events.length&&events[event].at===at)target=events[event++].target;
    return Math.min(before,target); // Recovery starts after demand falls, never before.
  });
  for (let i = times.length - 2; i >= 0; i--) gains[i] = Math.min(gains[i], gains[i + 1] + (times[i + 1] - times[i]) / attack);
  for (let i = 1; i < times.length; i++) gains[i] = Math.min(gains[i], gains[i - 1] + (times[i] - times[i - 1]) / attack);
  const segment = (at: number) => {let lo = 0, hi = times.length; while (lo + 1 < hi) {const mid = (lo + hi) >>> 1; if (times[mid] <= at) lo = mid; else hi = mid;} return lo;};
  const value = (at: number, i: number) => i + 1 === times.length ? gains[i] : gains[i] + (gains[i + 1] - gains[i]) * Math.max(0, at - times[i]) / (times[i + 1] - times[i]);
  let belowResolution=false;
  for (const note of notes) {
   let first=segment(note.frames[0]?.at??0),last=first;
   for (let f = 0; f < note.frames.length; f++) {
    const frame = note.frames[f];
    if (frame.volume <= 0) continue;
    // A volume register holds until the next write, including release and
    // stagger. Budget the whole hold, not just the instant of the command.
    const start = frame.at, end = (note.frames[f + 1]?.at ?? note.until + tail) + .012 * clock;
    while(first+1<times.length&&times[first+1]<=start)first++;
    while(last+1<times.length&&times[last+1]<=end)last++;
    let gain = Math.min(value(start, first), value(end, last));
    for (let i = first + 1; i <= last; i++) gain = Math.min(gain, gains[i]);
    if (gain < 1) {frame.volume = Math.floor(frame.volume * 31 / 15 * gain) * 15 / 31;if(frame.volume===0)belowResolution=true;}
  }
  }
  if(belowResolution)report.diagnostics.push({part:'*',kind:'mix-bus-resolution',detail:'Some SNES levels fall below a volume step after shared headroom protection'});
  report.diagnostics.push({part: '*', kind: 'mix-bus-headroom', detail: 'Shared SNES dry and echo headroom reserved before internal mixing'});
}
