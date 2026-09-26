import { MD_BANK, mdDrumStream, type MdBank, type MdDrumHit } from "./bank.js";
import {
  MD_DAC_HZ,
  type MdFmNote,
  type MdFmVoiceId,
  type MdNoiseHit,
  type MdPan,
  type MdPsgNote,
  type MdPsgVoiceId,
  type MdVibrato,
  type MdVoice,
} from "./native-driver.js";

/**
 * The tracker: a song for the native Mega Drive driver written as text, one
 * line per channel per section. A sixteenth note is the step.
 *
 * Melodic lines, tokens separated by spaces:
 *
 *     E5:4      the note E5 for four sixteenths (the length carries over: `E5:2 G5 A5` are all 2)
 *     r:4       a rest            -:4   the previous note held longer
 *     ^E5:4     scooped: bent up from a whole tone below, a guitarist's attack
 *     ~G5:2     slid into from the previous note without a new attack (legato)
 *     E5:4'     staccato (half the length)      E5:4!  accented      E5:8>  falls off at the end
 *     @mute     the following notes use this patch      %60  the following notes at 60% volume
 *     |         a bar line, checked
 *
 * Drum and noise lines take one letter a sixteenth, from the bank's
 * `drumLetters` and `noiseLetters`; `.` and `-` are silence. The default
 * bank's DAC letters are `k` kick, `s` snare, `S` loud snare, `x` both, `h`
 * `m` `l` toms; its noise letters `h` hat, `H` loud hat, `o` open hat, `c`
 * crash.
 */

export interface MdTrackerChannel {
  voice: MdFmVoiceId | MdPsgVoiceId | "noise" | "dac";
  /** FM and the DAC. */
  pan?: MdPan;
  /** The patch (FM) or instrument (PSG) the channel starts on, by its name in the bank. */
  patch?: string;
  /** Linear, scales every note. Default 1. */
  volume?: number;
  /** Semitones, fractions allowed: a detuned double of another channel. */
  transpose?: number;
  /** A delayed vibrato on notes of a quarter or longer. Defaults: `delay` 8 frames, `hz` 6.3, `depth` 0.3 semitones. */
  vibrato?: Partial<MdVibrato>;
  /**
   * An echo of another channel: its notes again `delay` steps later at
   * `volume`, in every section this channel leaves empty. A section that
   * writes its own line here (a harmony) keeps it, everywhere it is played.
   */
  echo?: { of: string; delay: number; volume: number };
  /** Noise only: doubles the DAC's snare with the bank's wires, replacing the noise hit on that step. */
  snareWires?: boolean;
}

/** A section: its length in bars, and a line per channel that plays in it. */
export interface MdTrackerSection {
  bars: number;
  [channel: string]: string | number | undefined;
}

export interface MdTrackerSong {
  bpm: number;
  /** Section names, played once in this order. */
  order: string[];
  /** The section the song loops back to, if it loops. */
  loop?: string;
  channels: Record<string, MdTrackerChannel>;
  sections: Record<string, MdTrackerSection>;
}

export interface MdTrackerOptions {
  /** Bars from the loop section played again after the end, so a loop can be cut where its second pass matches its first. */
  tailBars?: number;
  bank?: MdBank;
}

export interface MdArrangement {
  /** For `compileMdVoices`, in the channels' order. */
  voices: MdVoice[];
  /** Seconds a sixteenth. */
  step: number;
  /** Everything laid out, the tail included. */
  totalSeconds: number;
  /** Where the loop section starts, 0 without a loop. */
  loopStart: number;
  /** Where the order ends and the loop jumps back, without the tail. */
  loopEnd: number;
}

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

interface StepNote {
  at: number;
  len: number;
  gate: number;
  pitch: number;
  patch: string | undefined;
  vol: number;
  bend: boolean;
  glide: boolean;
  fall: boolean;
  sec?: string;
}

function parseLine(line: string, patch: string | undefined, known: Record<string, unknown>, where: string) {
  const notes: StepNote[] = [];
  let pos = 0;
  let dur = 4;
  let cur = { patch, vol: 1 };
  for (const tok of line.trim().split(/\s+/).filter(Boolean)) {
    if (tok === "|") {
      if (pos % 16) throw new Error(`${where}: bar line at step ${pos}`);
      continue;
    }
    if (tok[0] === "@") {
      cur = { ...cur, patch: tok.slice(1) };
      if (!known[cur.patch!]) throw new Error(`${where}: no patch ${tok}`);
      continue;
    }
    if (tok[0] === "%") {
      cur = { ...cur, vol: Number(tok.slice(1)) / 100 };
      continue;
    }
    const m = /^([\^~]?)([A-G][#b]?-?\d|r|-)(?::(\d+))?(['!>]*)$/.exec(tok);
    if (!m) throw new Error(`${where}: bad token ${tok}`);
    if (m[3]) dur = Number(m[3]);
    const [, pre, body, , post] = m;
    if (body === "r") {
      pos += dur;
      continue;
    }
    if (body === "-") {
      const last = notes[notes.length - 1];
      if (!last) throw new Error(`${where}: tie with nothing`);
      last.len += dur;
      last.gate = last.len;
      pos += dur;
      continue;
    }
    notes.push({
      at: pos, len: dur, gate: post.includes("'") ? dur / 2 : dur, pitch: midi(body),
      patch: cur.patch, vol: cur.vol * (post.includes("!") ? 1.26 : 1),
      bend: pre === "^", glide: pre === "~", fall: post.includes(">"),
    });
    pos += dur;
  }
  return { notes, steps: pos };
}

function letters(line: string) {
  return line.replace(/[\s|]/g, "");
}

/**
 * Lays a song out: `order` once, then `tailBars` more bars from the loop
 * section. Returns the driver's voices and where the loop is.
 *
 * ```ts
 * const song = arrangeMdTracker({
 *   bpm: 160, order: ["A"], loop: "A",
 *   channels: { lead: { voice: "fm1", patch: "lead" }, drums: { voice: "dac" } },
 *   sections: { A: { bars: 1, lead: "E5:4 G5 B5 A5", drums: "k...s...k.k.s..." } },
 * }, { tailBars: 1 });
 * const { events } = compileMdVoices(song.voices);
 * ```
 */
export function arrangeMdTracker(song: MdTrackerSong, options: MdTrackerOptions = {}): MdArrangement {
  const bank = options.bank ?? MD_BANK;
  const step = 60 / song.bpm / 4;
  const order = [...song.order];
  const loopIndex = song.loop ? order.indexOf(song.loop) : -1;
  if (song.loop && loopIndex < 0) throw new Error("loop section not in order");
  let tail = options.tailBars ?? 0;
  for (let i = loopIndex; tail > 0 && loopIndex >= 0; i = i + 1 < song.order.length ? i + 1 : loopIndex) {
    order.push(song.order[i]);
    tail -= song.sections[song.order[i]].bars;
  }
  const tracks: Record<string, StepNote[]> = {};
  const drumHits: { at: number; drum: string; vol: number }[] = [];
  const noiseHits: { at: number; inst: string }[] = [];
  let pos = 0;
  let loopStartStep = 0;
  let endStep = 0;
  const ranges: { name: string; start: number; end: number }[] = [];
  order.forEach((name, idx) => {
    const sec = song.sections[name];
    if (!sec) throw new Error(`no section ${name}`);
    const steps = sec.bars * 16;
    if (idx === loopIndex) loopStartStep = pos;
    if (idx === song.order.length) endStep = pos;
    ranges.push({ name, start: pos, end: pos + steps });
    for (const [id, ch] of Object.entries(song.channels)) {
      const line = sec[id];
      if (line == null) continue;
      if (typeof line !== "string") throw new Error(`${name}.${id}: not a line`);
      const where = `${name}.${id}`;
      if (ch.voice === "dac") {
        const s = letters(line);
        if (s.length !== steps) throw new Error(`${where}: ${s.length} steps, want ${steps}`);
        for (let i = 0; i < s.length; i++) {
          if (s[i] === "." || s[i] === "-") continue;
          const hit = bank.drumLetters[s[i]];
          if (!hit) throw new Error(`${where}: bad drum ${s[i]}`);
          for (const [drum, vol] of hit) drumHits.push({ at: i + pos, drum, vol });
        }
      } else if (ch.voice === "noise") {
        const s = letters(line);
        if (s.length !== steps) throw new Error(`${where}: ${s.length} steps, want ${steps}`);
        for (let i = 0; i < s.length; i++) {
          if (s[i] === "." || s[i] === "-") continue;
          const inst = bank.noiseLetters[s[i]];
          if (!inst) throw new Error(`${where}: bad noise ${s[i]}`);
          noiseHits.push({ at: i + pos, inst });
        }
      } else {
        const p = parseLine(line, ch.patch, ch.voice.startsWith("fm") ? bank.patches : bank.psg, where);
        if (p.steps !== steps) throw new Error(`${where}: ${p.steps} steps, want ${steps}`);
        (tracks[id] ??= []).push(...p.notes.map((n) => ({ ...n, at: n.at + pos, sec: name })));
      }
    }
    pos += steps;
  });
  // The order's end: where the tail starts, or the end when there is none.
  if (order.length === song.order.length) endStep = pos;
  // The snare's wires on the noise channel too.
  if (Object.values(song.channels).some((c) => c.voice === "noise" && c.snareWires)) {
    const snares = new Set(drumHits.filter((h) => h.drum === bank.snareWires.drum).map((h) => h.at));
    for (let i = noiseHits.length - 1; i >= 0; i--) if (snares.has(noiseHits[i].at)) noiseHits.splice(i, 1);
    for (const at of snares) noiseHits.push({ at, inst: bank.snareWires.noise });
  }
  const totalSteps = pos;

  // Echoes: a copy of another channel, later and quieter, dropped where the section writes its own.
  for (const [id, ch] of Object.entries(song.channels)) {
    if (!ch.echo) continue;
    const echo = ch.echo;
    const own = tracks[id] ?? [];
    const ownSecs = new Set(own.map((n) => n.sec));
    const src = tracks[echo.of] ?? [];
    const owned = ranges.filter((r) => ownSecs.has(r.name));
    const copies = src
      .map((n) => ({ ...n, at: n.at + echo.delay, vol: n.vol * echo.volume }))
      .filter((n) => !owned.some((r) => n.at >= r.start && n.at < r.end));
    tracks[id] = [...own, ...copies].filter((n) => n.at < totalSteps).sort((a, b) => a.at - b.at);
    // A copy never overlaps the next note it would run into.
    const t = tracks[id];
    for (let i = 0; i + 1 < t.length; i++) if (t[i].at + t[i].gate > t[i + 1].at) t[i].gate = t[i + 1].at - t[i].at;
  }

  const secs = (s: number) => s * step;
  const voices: MdVoice[] = [];
  for (const [id, ch] of Object.entries(song.channels)) {
    if (ch.voice === "noise") {
      const hits = noiseHits.sort((a, b) => a.at - b.at);
      voices.push({
        voice: "noise",
        hits: hits.map((h, i): MdNoiseHit => {
          const inst = bank.noise[h.inst];
          if (!inst) throw new Error(`${id}: no noise instrument ${h.inst}`);
          const hit: MdNoiseHit = { at: secs(h.at), until: secs(hits[i + 1]?.at ?? h.at + 16), envelope: inst.envelope, volume: ch.volume ?? 1 };
          if (inst.rate !== undefined) hit.rate = inst.rate;
          if (inst.fixed !== undefined) hit.fixed = inst.fixed;
          if (inst.white !== undefined) hit.white = inst.white;
          return hit;
        }),
      });
    } else if (ch.voice === "dac") {
      const hits: MdDrumHit[] = drumHits.map((h) => ({ at: secs(h.at), drum: h.drum, volume: h.vol * (ch.volume ?? 1) }));
      voices.push({ voice: "dac", pan: ch.pan, stream: mdDrumStream(hits, MD_DAC_HZ, secs(totalSteps) + 1, bank.drums) });
    } else {
      const fm = ch.voice.startsWith("fm");
      const vibrato = ch.vibrato;
      const notes = (tracks[id] ?? []).map((n) => {
        const t0 = secs(n.at);
        const t1 = secs(n.at + n.gate);
        const frames = Math.round((t1 - t0) * 60);
        const base = {
          at: t0, until: t1, pitch: n.pitch + (ch.transpose ?? 0), volume: n.vol * (ch.volume ?? 1),
          bend: n.bend ? 2 : 0, bendFrames: 4, glide: n.glide ? 4 : 0,
          vibrato: vibrato && n.gate >= 4 ? { delay: vibrato.delay ?? 8, hz: vibrato.hz ?? 6.3, depth: vibrato.depth ?? 0.3 } : null,
          fall: n.fall ? 3 : 0, fallAt: n.fall ? Math.max(0, frames - 8) : null,
        };
        if (fm) {
          const patch = n.patch === undefined ? undefined : bank.patches[n.patch];
          if (!patch) throw new Error(`${n.sec}.${id}: no FM patch ${n.patch ?? "(none set)"}`);
          return { ...base, patch } satisfies MdFmNote;
        }
        const inst = n.patch === undefined ? undefined : bank.psg[n.patch];
        if (!inst) throw new Error(`${n.sec}.${id}: no PSG instrument ${n.patch ?? "(none set)"}`);
        return { ...base, envelope: inst.envelope, hold: inst.hold } satisfies MdPsgNote;
      });
      if (fm) voices.push({ voice: ch.voice as MdFmVoiceId, pan: ch.pan, notes: notes as MdFmNote[] });
      else voices.push({ voice: ch.voice as MdPsgVoiceId, notes: notes as MdPsgNote[] });
    }
  }
  return { voices, step, totalSeconds: totalSteps * step, loopStart: loopStartStep * step, loopEnd: endStep * step };
}
