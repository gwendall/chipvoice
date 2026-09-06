import type { Role } from "./chip.js";
import { FRAME_RATE, type Channel, type Instrument, type NoteSink } from "./driver.js";

/**
 * A small tracker, written the way this music was authored on the hardware:
 * one token per grid step (four per quarter note by default), four channels, instruments as per-frame tables.
 *
 * Tokens: a note name (`A4`, `F#3`), `.` to sustain, `=` to cut. Percussion uses
 * `K` kick, `S` snare, `H` hat, `O` open hat.
 */

export interface PlaybackPosition {
  step: number;
  orderIndex: number;
  /** Fraction of the current grid step already heard, from 0 to below 1. */
  progress?: number;
}

export interface ChannelClaim {
  /** True when the music may write to this channel right now. */
  canPlay(channel: Channel, at: number): boolean;
}

export interface Pattern {
  bass: string;
  lead: string;
  /** One root per chord; the chip allocates simultaneous voices or an arpeggio. */
  chord: string;
  chordShape: number[][];
  perc: string;
}

/** The 2A03's map of a song's roles onto its voices, the default. */
export const NES_ROLES: Record<Role, string> = { lead: "p1", chord: "p2", bass: "tri", perc: "noi" };

/** One voice per percussion token. */
/** A drum: a noise period on a chip whose kit is noise, a pitch on one whose drums are pitched. */
export interface Drum {
  note: number | string;
  instrument: Instrument;
  duration: number;
}

export interface PercussionKit {
  K: Drum;
  S: Drum;
  H: Drum;
  O: Drum;
}

export interface Song {
  /** Arrangement target, retained by arrange and honored by offline render. */
  chip?: string;
  /**
   * Stable name, used to decide whether `play` is a no-op.
   *
   * Reference equality was the test before, so any song built at call time -
   * a spread to change one field, which is the obvious way to derive a
   * variant - failed it and restarted the piece on every call.
   */
  id: string;
  bpm: number;
  /** Tracker steps per quarter note. Default 4; 12 preserves straight and triplet rhythms. */
  stepsPerBeat?: 4 | 12;
  patterns: Pattern[];
  order: number[];
  gain: number;
  lead: Instrument;
  chord: Instrument;
  bass: Instrument;
  /**
   * The kit. Optional, and DEFAULT_KIT when absent.
   *
   * These used to be written inline in the sequencer at fixed volumes the
   * song's own gain never reached, so a quiet piece could not have a quiet
   * kit. Writing the name entry theme, the drums were the sharpest thing in
   * it and the only fix available was to delete them.
   */
  perc?: PercussionKit;
}

/** What every song used before the kit was a parameter. */
export const DEFAULT_KIT: PercussionKit = {
  K: { note: 6, instrument: { volume: [13, 11, 8, 4, 2], slide: -1.6 }, duration: 0.09 },
  S: { note: 9, instrument: { volume: [12, 10, 7, 4, 2, 1] }, duration: 0.1 },
  H: { note: 13, instrument: { volume: [6, 3, 1], noiseMode: true }, duration: 0.05 },
  O: { note: 12, instrument: { volume: [8, 7, 6, 5, 4, 3, 2, 1], noiseMode: true }, duration: 0.14 },
};

/** The same kit played softly, for a screen that should not celebrate. */
export function softKit(scale: number): PercussionKit {
  const quieten = (i: Instrument): Instrument => ({
    ...i,
    volume: i.volume.map((v) => Math.max(0, Math.round(v * scale))),
  });
  return {
    K: { ...DEFAULT_KIT.K, instrument: quieten(DEFAULT_KIT.K.instrument) },
    S: { ...DEFAULT_KIT.S, instrument: quieten(DEFAULT_KIT.S.instrument) },
    H: { ...DEFAULT_KIT.H, instrument: quieten(DEFAULT_KIT.H.instrument) },
    O: { ...DEFAULT_KIT.O, instrument: quieten(DEFAULT_KIT.O.instrument) },
  };
}

interface Event {
  step: number;
  token: string;
  length: number;
}

function parseChannel(text: string): Event[] {
  const tokens = text.trim().split(/\s+/);
  const events: Event[] = [];
  tokens.forEach((token, step) => {
    if (token === ".") return;
    events.push({ step, token, length: 0 });
  });
  events.forEach((e, i) => {
    const next = events[i + 1];
    e.length = (next ? next.step : tokens.length) - e.step;
  });
  return events;
}

interface CompiledPattern {
  bass: Map<number, Event>;
  lead: Map<number, Event>;
  chord: Map<number, Event>;
  chordShape: number[][];
  perc: Map<number, Event>;
  steps: number;
}

function index(events: Event[]) {
  return new Map(events.map((e) => [e.step, e]));
}

function compile(p: Pattern): CompiledPattern {
  return {
    bass: index(parseChannel(p.bass)),
    lead: index(parseChannel(p.lead)),
    chord: index(parseChannel(p.chord)),
    chordShape: p.chordShape,
    perc: index(parseChannel(p.perc)),
    steps: p.bass.trim().split(/\s+/).length,
  };
}

/**
 * Schedules the song ahead of the clock. setTimeout only decides *what* to
 * queue; the chip applies it on the cycle it names.
 */
export class Sequencer {
  private readonly apu: NoteSink;
  private readonly arbiter: ChannelClaim;
  private song: Song | null = null;
  private compiled: CompiledPattern[] = [];
  private orderIndex = 0;
  private step = 0;
  private nextTime = 0;
  private resumeProgress = 0;
  private timer: number | null = null;
  private running = false;
  private chordSlot = 0;
  private resumeStep = false;
  private currentTime: () => number;
  /** False when something else advances the clock and calls `pump`. */
  private live: boolean;
  /** Which voice each of the song's four lines plays on: the chip's map. */
  private readonly roles: Record<Role, string>;
  private readonly chordVoices: readonly string[];
  private chordInstrument: Instrument | null = null;

  constructor(
    apu: NoteSink,
    arbiter: ChannelClaim,
    currentTime: () => number,
    options: { live?: boolean; roles?: Record<Role, string>; chordVoices?: readonly string[] } = {},
  ) {
    this.apu = apu;
    this.arbiter = arbiter;
    this.currentTime = currentTime;
    this.live = options.live ?? true;
    this.roles = options.roles ?? NES_ROLES;
    this.chordVoices = options.chordVoices ? [...options.chordVoices] : [];
  }

  get isPlaying() {
    return this.running;
  }

  /**
   * Where the music is *heard*, not where it has been scheduled.
   *
   * The scheduler runs up to 200ms ahead, so `this.step` is the future. Any
   * playhead drawn from it leads the sound by a fifth of a second, which reads
   * as the display being broken rather than as latency.
   *
   * So every scheduled step is recorded with the time it will sound at, and
   * this walks that list to whatever is audible now. Steps already in the past
   * are dropped as they are passed, so the list stays at lookahead length
   * rather than growing for the life of the song.
   */
  private timeline: Array<{ at: number; step: number; orderIndex: number }> = [];

  /** Optional storage belongs to the caller; default calls return independent snapshots. */
  positionAt(time: number, into?: { step: number; orderIndex: number }): { step: number; orderIndex: number } | null {
    const entry = this.advanceTimeline(time);
    if (!entry) return null;
    if (!into) return { step: entry.step, orderIndex: entry.orderIndex };
    into.step = entry.step;
    into.orderIndex = entry.orderIndex;
    return into;
  }

  /** Read a nearby scheduled audio-clock position without consuming the live
   * timeline. Used to align an incoming engine while the old one keeps playing. */
  phaseAt(time: number): PlaybackPosition | null {
    if (!this.running || !this.song) return null;
    let entry: (typeof this.timeline)[number] | undefined;
    for (const candidate of this.timeline) {
      if (candidate.at > time) break;
      entry = candidate;
    }
    const duration = 60 / this.song.bpm / (this.song.stepsPerBeat ?? 4);
    if (!entry || time >= entry.at + duration) return null;
    return { step: entry.step, orderIndex: entry.orderIndex, progress: Math.max(0, (time - entry.at) / duration) };
  }

  /** Nearest grid step at the live audio clock; halfway rounds forward.
   * Uses the audible step's timestamp, not the lookahead cursor or a UI frame.
   * Startup and gaps after timer suspension have no recordable position. */
  quantizedPosition(time: number): { step: number; orderIndex: number } | null {
    const entry = this.advanceTimeline(time);
    if (!entry || !this.song) return null;
    const duration = 60 / this.song.bpm / (this.song.stepsPerBeat ?? 4);
    if (time >= entry.at + duration) return null;
    let step = entry.step, orderIndex = entry.orderIndex;
    if (time >= entry.at + duration / 2) {
      step++;
      if (step === this.compiled[this.song.order[orderIndex]].steps) {
        step = 0;
        orderIndex = (orderIndex + 1) % this.song.order.length;
      }
    }
    return { step, orderIndex };
  }

  private advanceTimeline(time: number) {
    if (!this.running) return null;
    while (this.timeline.length > 0 && this.timeline[0].at <= time) {
      const entry = this.timeline[0];
      // Keep the last one that has already sounded: it is the one playing.
      if (this.timeline.length === 1 || this.timeline[1].at > time) {
        return entry;
      }
      this.timeline.shift();
    }
    return null;
  }

  /**
   * The piece actually loaded and scheduling, by name.
   *
   * Not "the piece that should be playing". A first version of the soundtrack
   * test asked the audio layer what the current scene and sector resolve to,
   * which is a question it can answer correctly while the sequencer is still
   * grinding through the previous song - and it passed against a build with
   * the sector-change path deleted.
   */
  get songId(): string | null {
    return this.running ? (this.song?.id ?? null) : null;
  }

  /**
   * The next eighth-note boundary at or after `from`, or null when nothing is
   * playing.
   *
   * Rez's cheapest trick: a player's own sounds snap to the beat, so somebody
   * with no rhythm still sounds like a musician. The hard half was already
   * done here - the APU is cycle-exact and the sequencer knows the bar -
   * and nothing was using it.
   */
  nextEighth(from: number): number | null {
    if (!this.running || !this.song) return null;
    const step = 60 / this.song.bpm / (this.song.stepsPerBeat ?? 4);
    const halfBeatSteps = (this.song.stepsPerBeat ?? 4) / 2;
    const eighth = 60 / this.song.bpm / 2;
    // The scheduler runs up to 200ms ahead, so the grid anchor is usually in
    // the future. Walking forward from it only ever returns a later beat -
    // the first version could report one more than a whole eighth away, which
    // is worse than not quantising. Solve for the phase instead.
    let elapsedSteps = this.step;
    for (let i = 0; i < this.orderIndex; i++) elapsedSteps += this.compiled[this.song.order[i]].steps;
    const anchor = this.nextTime - step * (elapsedSteps % halfBeatSteps);
    const beats = Math.ceil((from - anchor) / eighth);
    return anchor + beats * eighth;
  }

  /*
   * There used to be a sector drift here: the tempo rose 2.8% and the key
   * climbed a semitone every three sectors, on the reasoning that an endless
   * procedural game cannot have one theme per sector and a single loop wears
   * through.
   *
   * Both halves of that reasoning stopped being true. The run is five sectors
   * and then it is over, and there are five pieces now. What the drift did to
   * them was deform them: sector three is written at 156 and sector two at
   * 160, and the drift played the third at 165 against the second's 164 -
   * inverting the intended order. It also pushed sector five past every boss
   * theme in the game, which makes the last fight arrive as a lull.
   *
   * So the tempo is what the piece says, and the key is what it was written
   * in. See Decisions.
   */

  play(song: Song, position?: PlaybackPosition, at?: number) {
    if (!position && this.song?.id === song.id && this.running) return;
    this.stop();
    this.song = song;
    this.chordInstrument = this.chordVoices.length ? { ...song.chord, arp: undefined } : null;
    this.compiled = song.patterns.map(compile);
    this.timeline.length = 0;
    this.orderIndex = 0;
    this.step = 0;
    if (position) {
      this.orderIndex = Math.max(0, Math.min(song.order.length - 1, position.orderIndex));
      this.step = Math.max(0, Math.min(this.compiled[song.order[this.orderIndex]].steps - 1, position.step));
    }
    this.chordSlot = 0;
    if (position) {
      const chords = this.compiled[song.order[this.orderIndex]].chord;
      this.chordSlot = [...chords.values()].filter(e => e.step < this.step && e.token !== "=").length;
      const held = [...chords.values()].filter(e => e.step < this.step).at(-1);
      if (!chords.has(this.step) && held && held.token !== "=" && this.chordSlot > 0) this.chordSlot--;
    }
    this.resumeStep = !!position;
    this.resumeProgress = Math.max(0, Math.min(.999999, position?.progress ?? 0));
    this.running = true;
    this.nextTime = at ?? this.currentTime() + 0.1;
    // A host with no timers - Node, during an offline render - drives `pump`
    // itself. Starting a timer there would schedule against a clock that never
    // advances and fill the queue with everything at once.
    if (typeof setTimeout === "function" && this.live) this.tick();
    else this.pump();
  }

  stop() {
    const wasRunning = this.running;
    this.running = false;
    this.timeline.length = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.apu.stop(this.roles.lead);
    this.apu.stop(this.roles.chord);
    for (const voice of this.chordVoices) if (voice !== this.roles.chord) this.apu.stop(voice);
    this.apu.stop(this.roles.bass);
    if (wasRunning) this.apu.stop(this.roles.perc);
    this.song = null;
    this.chordInstrument = null;
  }

  /**
   * Schedules everything due between now and the lookahead.
   *
   * Split out of the timer so it can be driven by something other than a
   * clock: offline rendering advances a counter and calls this, which is the
   * whole of what makes the same sequencer serve real time and a file.
   */
  pump(until?: number) {
    if (!this.running || !this.song) return;
    const stepTime = 60 / this.song.bpm / (this.song.stepsPerBeat ?? 4);
    const lookahead = 0.2;
    const now = this.currentTime();

    // If we fell far behind (tab was hidden), resync rather than catching up.
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;

    this.advanceTimeline(now);
    while (this.nextTime < (until ?? now + lookahead)) {
      this.scheduleStep(this.nextTime, stepTime);
      this.resumeStep = false;
      this.timeline.push({
        at: this.nextTime - this.resumeProgress * stepTime,
        step: this.step,
        orderIndex: this.orderIndex,
      });
      this.nextTime += stepTime * (1 - this.resumeProgress);
      this.resumeProgress = 0;
      this.step++;
      const pattern = this.compiled[this.song.order[this.orderIndex]];
      if (this.step >= pattern.steps) {
        this.step = 0;
        this.orderIndex = (this.orderIndex + 1) % this.song.order.length;
        this.chordSlot = 0;
      }
    }
  }

  private tick = () => {
    if (!this.running) return;
    this.pump();
    this.timer = setTimeout(this.tick, 40) as unknown as number;
  };

  private scheduleStep(at: number, stepTime: number) {
    const song = this.song!;
    const pattern = this.compiled[song.order[this.orderIndex]];

    const { lead: leadVoice, chord: chordVoice, bass: bassVoice, perc: percVoice } = this.roles;
    const event = (line: Map<number, Event>) => {
      const hit = line.get(this.step);
      if (hit || !this.resumeStep) return hit;
      const previous = [...line.values()].filter(e => e.step < this.step).at(-1);
      return previous ? { ...previous, length: previous.length - (this.step - previous.step) } : undefined;
    };
    const bass = event(pattern.bass);
    if (bass && bass.token !== "=" && this.arbiter.canPlay(bassVoice, at)) {
      this.apu.playNote(bassVoice, {
        note: bass.token,
        instrument: song.bass,
        duration: (bass.length - this.resumeProgress) * stepTime * 0.94,
        at,
      });
    }

    const lead = event(pattern.lead);
    if (lead && this.arbiter.canPlay(leadVoice, at)) {
      if (lead.token === "=") {
        this.apu.stop(leadVoice, at);
      } else {
        this.apu.playNote(leadVoice, {
          note: lead.token,
          instrument: song.lead,
          duration: (lead.length - this.resumeProgress) * stepTime * 0.96,
          at,
          gain: song.gain,
          });
      }
    }

    const chord = event(pattern.chord);
    if (chord?.token === "=" && this.chordVoices.length) {
      for (const voice of this.chordVoices) if (this.arbiter.canPlay(voice, at)) this.apu.stop(voice, at);
    }
    if (chord && chord.token !== "=" && (this.chordVoices.length || this.arbiter.canPlay(chordVoice, at))) {
      const shape =
        pattern.chordShape[this.chordSlot % pattern.chordShape.length];
      this.chordSlot++;
      if (this.chordVoices.length && shape.length <= this.chordVoices.length) {
        // Divide the chord's amplitude budget, not its pitch, across voices.
        // A borrowed voice never shifts the shape assigned to the next chord.
        const gain = song.gain / shape.length;
        for (let tone = 0; tone < shape.length; tone++) {
          const voice = this.chordVoices[tone];
          if (this.arbiter.canPlay(voice, at)) this.apu.playNote(voice, {
            note: chord.token, detune: shape[tone], instrument: this.chordInstrument!,
            duration: (chord.length - this.resumeProgress) * stepTime * 0.98, at, gain,
          });
        }
      } else if (this.arbiter.canPlay(chordVoice, at)) {
        const instrument = { ...song.chord, arp: shape, arpLoop: true };
        const play = (start: number, duration: number) => {
          if (duration < 1 / FRAME_RATE) return;
          this.apu.playNote(chordVoice, { note: chord.token, instrument, duration, at: start, gain: song.gain });
        };
        if (chordVoice !== percVoice) {
          play(at, (chord.length - this.resumeProgress) * stepTime * 0.98);
        } else {
          // One voice for both, as on a SID: a drum cuts the chord, and the
          // chord comes back after it, until the next drum or its own end. A
          // segment ends a frame before the drum so its note off cannot land
          // on the drum's gate.
          const kit = song.perc ?? DEFAULT_KIT;
          const drumAt = (step: number) => {
            const hit = pattern.perc.get(step);
            return hit ? kit[hit.token as keyof PercussionKit] : undefined;
          };
          let s = 0;
          while (s < chord.length) {
            let start = at + Math.max(0, s - this.resumeProgress) * stepTime;
            const hit = s === 0 && this.resumeProgress > 0 ? undefined : drumAt(this.step + s);
            if (hit) start += (Math.max(1, Math.round(hit.duration * FRAME_RATE)) + 1) / FRAME_RATE;
            let e = s + 1;
            while (e < chord.length && !drumAt(this.step + e)) e++;
            let duration: number;
            if (e < chord.length) duration = (Math.floor((at + (e - this.resumeProgress) * stepTime - start) * FRAME_RATE) - 1) / FRAME_RATE;
            else duration = at + (chord.length - this.resumeProgress) * stepTime * 0.98 - start;
            play(start, duration);
            s = e;
          }
        }
      }
    }

    const perc = pattern.perc.get(this.step);
    if (perc && this.resumeProgress === 0 && this.arbiter.canPlay(percVoice, at)) {
      const kit = song.perc ?? DEFAULT_KIT;
      const voice = kit[perc.token as keyof PercussionKit];
      if (voice) {
        this.apu.playNote(percVoice, {
          note: voice.note,
          instrument: voice.instrument,
          duration: voice.duration,
          at,
        });
      }
    }
  }
}
