import type {Performance, PerformanceNote, PerformancePart} from './performance.js';
import {validatePerformance} from './performance.js';

type Event = {tick: number; track: number; order: number; status: number; data: number[]};
export interface MidiImportOptions {
  title?: string;
  /** Track/channel identifiers are listed in the returned parts. */
  parts?: Record<string, {name?: string; role?: PerformancePart['role']; priority?: number}>;
}

/** Bounded SMF 0/1 parser. Exact ticks, overlapping notes, running status,
 * tempo, velocity, sustain, volume, expression, pitch bend and RPN bend range.
 * Unsupported expression is reported, never claimed as original-game fidelity. */
export function importMidi(bytes: Uint8Array, options: MidiImportOptions = {}): Performance {
  if (bytes.length > 8 * 1024 * 1024) throw new Error('MIDI exceeds 8 MiB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0, limit = bytes.length;
  const need = (size: number) => {if (pos + size > limit) throw new Error('Truncated MIDI');};
  const u8 = () => {need(1); return bytes[pos++];};
  const u16 = () => {need(2); const n = view.getUint16(pos); pos += 2; return n;};
  const u32 = () => {need(4); const n = view.getUint32(pos); pos += 4; return n;};
  const text = (length: number) => {need(length); const s = new TextDecoder().decode(bytes.subarray(pos,pos+length)); pos += length; return s;};
  const variable = () => {let n = 0; for (let i = 0; i < 4; i++) {const b = u8(); n = n * 128 + (b & 127); if (!(b & 128)) return n;} throw new Error('Invalid MIDI variable integer');};
  if (text(4) !== 'MThd') throw new Error('Expected a MIDI file');
  const header = u32(); if (header < 6) throw new Error('Invalid MIDI header');
  need(header);
  const format = u16(), tracks = u16(), division = u16();
  if (format > 1 || !tracks || tracks > 256 || format === 0 && tracks !== 1 || !division || division & 0x8000) throw new Error('Only SMF 0/1 with musical PPQ timing is supported');
  pos += header - 6;
  const events: Event[] = [], names: string[] = [], notices = new Set<string>();
  let endTick = 0;
  const tempos = new Map<number, number>([[0,500000]]);
  for (let track = 0; track < tracks; track++) {
    limit = bytes.length;
    if (text(4) !== 'MTrk') throw new Error('Expected MIDI track');
    const length = u32(); need(length); limit = pos + length;
    let tick = 0, running = 0, order = 0, ended = false;
    while (pos < limit) {
      tick += variable(); if (!Number.isSafeInteger(tick)) throw new Error('MIDI tick overflow');
      let status = u8();
      if (status < 128) {if (!running) throw new Error('Missing running status'); pos--; status = running;}
      if (status === 0xff) {
        running = 0;
        const type = u8(), size = variable(); need(size);
        if (type === 0x2f) {if (size || pos !== limit) throw new Error('Invalid end-of-track'); ended = true;}
        else if (type === 3) {names[track] = text(size); continue;}
        else if (type === 0x51) {
          if (size !== 3) throw new Error('Invalid tempo event');
          const tempo = bytes[pos] * 65536 + bytes[pos+1] * 256 + bytes[pos+2];
          if (!tempo) throw new Error('Zero MIDI tempo');
          if (tempos.has(tick) && tempos.get(tick) !== tempo && !(tick === 0 && tempos.get(0) === 500000)) notices.add(`Conflicting tempo at tick ${tick}; last file-order event wins`);
          tempos.set(tick,tempo);
        }
        pos += size;
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0; const size = variable(); need(size); pos += size; notices.add('System-exclusive sound configuration is not reproduced');
      } else {
        if (status < 0x80 || status > 0xef) throw new Error('Invalid MIDI status');
        running = status;
        const size = (status >> 4) === 0xc || (status >> 4) === 0xd ? 1 : 2;
        const data = Array.from({length: size},u8);
        if (data.some(n => n > 127)) throw new Error('Invalid MIDI data byte');
        if (events.length >= 250000) throw new Error('Too many MIDI events');
        events.push({tick, track, order: order++, status, data});
      }
    }
    if (!ended) throw new Error('Missing end-of-track');
    endTick = Math.max(endTick,tick);
  }
  if (pos !== bytes.length) throw new Error('Trailing MIDI data');
  events.sort((a,b) => a.tick-b.tick || a.track-b.track || a.order-b.order);
  const parts = new Map<string,PerformancePart>();
  const channels = Array.from({length:16}, () => ({program:0, volume:1, expression:1, bend:0, range:2, rangeFine:0, rpnMSB:127, rpnLSB:127, pedal:false}));
  const active = new Map<string,{note: PerformanceNote; channel: number; down: boolean}[]>();
  let count = 0;
  const point = (channel: number, tick: number) => {
    const c = channels[channel];
    for (const rows of active.values()) for (const row of rows) if (row.channel === channel) {
      const next = {tick,pitch:c.bend*(c.range+c.rangeFine/100),gain:c.volume*c.expression};
      const expression = row.note.expression!;
      if (expression.at(-1)?.tick === tick) expression[expression.length-1] = next; else expression.push(next);
    }
  };
  const release = (channel: number, tick: number, all: boolean) => {
    for (const [key,rows] of active) {const keep = rows.filter(row => {if (row.channel !== channel || !all && row.down) return true; row.note.endTick=tick; return false;}); if (keep.length) active.set(key,keep); else active.delete(key);}
  };
  for (const event of events) {
    const channel = event.status & 15, kind = event.status >> 4, c = channels[channel], [a,b] = event.data, tick = event.tick;
    const key = `${channel}:${a}`;
    if (kind === 9 && b > 0) {
      const id = `track-${event.track}-ch-${channel+1}`;
      let part = parts.get(id);
      if (!part) {
        const name = names[event.track] || `Track ${event.track+1}`, override = options.parts?.[id];
        const role = override?.role ?? (channel === 9 ? 'perc' : /bass/i.test(name) || c.program >= 32 && c.program <= 39 ? 'bass' : /lead|melody/i.test(name) || parts.size === 0 ? 'lead' : 'chord');
        part = {id,name:override?.name ?? name,role,priority:override?.priority ?? ({lead:100,bass:80,perc:70,chord:50}[role]),notes:[]};
        parts.set(id,part);
        if (!override?.role) notices.add(`${id}: ${role} role inferred; review before publishing`);
      }
      const note: PerformanceNote = {id:`n${count++}`,tick,endTick:0,pitch:a,velocity:b,program:c.program,...(channel===9?{drum:a}:{}),expression:[{tick,pitch:c.bend*(c.range+c.rangeFine/100),gain:c.volume*c.expression}]};
      part.notes.push(note);
      const rows = active.get(key) ?? []; rows.push({note,channel,down:true}); active.set(key,rows);
    } else if (kind === 8 || kind === 9) {
      const rows = active.get(key), row = rows?.find(r => r.down);
      if (!row) throw new Error(`Unmatched note-off at tick ${tick}, channel ${channel+1}, pitch ${a}`);
      row.down = false;
      if (!c.pedal) {row.note.endTick=tick; const keep=rows!.filter(r=>r!==row); if (keep.length) active.set(key,keep); else active.delete(key);}
    } else if (kind === 0xc) c.program = a;
    else if (kind === 0xe) {c.bend = ((a+b*128)-8192)/8192; point(channel,tick);}
    else if (kind === 0xb) {
      if (a === 7) {c.volume=b/127; point(channel,tick);}
      else if (a === 11) {c.expression=b/127; point(channel,tick);}
      else if (a === 64) {c.pedal=b>=64; if (!c.pedal) release(channel,tick,false);}
      else if (a === 101) c.rpnMSB=b;
      else if (a === 100) c.rpnLSB=b;
      else if ((a === 6 || a === 38) && !c.rpnMSB && !c.rpnLSB) {if (a===6)c.range=b;else c.rangeFine=b;point(channel,tick);}
      else if (a === 120 || a === 123) {if (a===120)release(channel,tick,true);else {for (const rows of active.values())for (const row of rows)if(row.channel===channel)row.down=false;if(!c.pedal)release(channel,tick,true);}}
      else if (a === 121) {c.expression=1;c.bend=0;c.pedal=false;release(channel,tick,false);point(channel,tick);}
      else if (b !== 0 || a === 10 || a === 0 || a === 32) notices.add(`Channel ${channel+1}: controller ${a} is not reproduced`);
    } else if (kind === 0xa || kind === 0xd) notices.add(`Channel ${channel+1}: aftertouch is not reproduced`);
  }
  if (active.size) throw new Error('Unterminated MIDI notes or sustain pedal');
  if (!count || !endTick) throw new Error('MIDI has no playable notes');
  for (const part of parts.values()) for (const note of part.notes) note.expression = note.expression?.filter(p=>p.tick<note.endTick);
  const score: Performance = {version:1,title:options.title ?? names[0] ?? 'Imported MIDI',ticksPerBeat:division,endTick,tempos:[...tempos].filter(([tick])=>tick<endTick).sort((a,b)=>a[0]-b[0]).map(([tick,microsecondsPerBeat])=>({tick,microsecondsPerBeat})),parts:[...parts.values()],source:{kind:'midi',name:options.title??'Imported MIDI'},notices:[...notices]};
  score.midi={format,events};
  validatePerformance(score); return score;
}
