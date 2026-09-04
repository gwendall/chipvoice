import type { Channel, Instrument, NoteSink } from "./driver.js";

/**
 * A small tracker, written the way this music was authored on the hardware:
 * one token per sixteenth note, four channels, instruments as per-frame tables.
 *
 * Tokens: a note name (`A4`, `F#3`), `.` to sustain, `=` to cut. Percussion uses
 * `K` kick, `S` snare, `H` hat, `O` open hat.
 */

export interface ChannelClaim {
  /** True when the music may write to this channel right now. */
  canPlay(channel: Channel, at: number): boolean;
}

export interface Pattern {
  bass: string;
  lead: string;
  /** One note per chord; the instrument arpeggiates it at frame rate. */
  chord: string;
  chordShape: number[][];
  perc: string;
}

/** One voice per percussion token. */
export interface PercussionKit {
  K: { note: number; instrument: Instrument; duration: number };
  S: { note: number; instrument: Instrument; duration: number };
  H: { note: number; instrument: Instrument; duration: number };
  O: { note: number; instrument: Instrument; duration: number };
}

export interface Song {
  /**
   * Stable name, used to decide whether `play` is a no-op.
   *
   * Reference equality was the test before, so any song built at call time -
   * a spread to change one field, which is the obvious way to derive a
   * variant - failed it and restarted the piece on every call.
   */
  id: string;
  bpm: number;
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
  private timer: number | null = null;
  private running = false;
  private chordSlot = 0;
  private currentTime: () => number;
  /** False when something else advances the clock and calls `pump`. */
  private live: boolean;

  constructor(
    apu: NoteSink,
    arbiter: ChannelClaim,
    currentTime: () => number,
    options: { live?: boolean } = {},
  ) {
    this.apu = apu;
    this.arbiter = arbiter;
    this.currentTime = currentTime;
    this.live = options.live ?? true;
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

  positionAt(time: number): { step: number; orderIndex: number } | null {
    if (!this.running) return null;
    let current: { step: number; orderIndex: number } | null = null;
    while (this.timeline.length > 0 && this.timeline[0].at <= time) {
      const entry = this.timeline[0];
      // Keep the last one that has already sounded: it is the one playing.
      if (this.timeline.length === 1 || this.timeline[1].at > time) {
        current = { step: entry.step, orderIndex: entry.orderIndex };
        break;
      }
      this.timeline.shift();
    }
    return current;
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
    const step = 60 / this.song.bpm / 4;
    const eighth = step * 2;
    // The scheduler runs up to 200ms ahead, so the grid anchor is usually in
    // the future. Walking forward from it only ever returns a later beat -
    // the first version could report one more than a whole eighth away, which
    // is worse than not quantising. Solve for the phase instead.
    const anchor = this.nextTime - step * (this.step % 2);
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

  play(song: Song) {
    if (this.song?.id === song.id && this.running) return;
    this.stop();
    this.song = song;
    this.compiled = song.patterns.map(compile);
    this.timeline.length = 0;
    this.orderIndex = 0;
    this.step = 0;
    this.chordSlot = 0;
    this.running = true;
    this.nextTime = this.currentTime() + 0.1;
    // A host with no timers - Node, during an offline render - drives `pump`
    // itself. Starting a timer there would schedule against a clock that never
    // advances and fill the queue with everything at once.
    if (typeof setTimeout === "function" && this.live) this.tick();
    else this.pump();
  }

  stop() {
    this.running = false;
    this.timeline.length = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.apu.stop("p1");
    this.apu.stop("p2");
    this.apu.stop("tri");
    this.song = null;
  }

  /**
   * Schedules everything due between now and the lookahead.
   *
   * Split out of the timer so it can be driven by something other than a
   * clock: offline rendering advances a counter and calls this, which is the
   * whole of what makes the same sequencer serve real time and a file.
   */
  pump() {
    if (!this.running || !this.song) return;
    const stepTime = 60 / this.song.bpm / 4;
    const lookahead = 0.2;
    const now = this.currentTime();

    // If we fell far behind (tab was hidden), resync rather than catching up.
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;

    while (this.nextTime < now + lookahead) {
      this.scheduleStep(this.nextTime, stepTime);
      this.timeline.push({
        at: this.nextTime,
        step: this.step,
        orderIndex: this.orderIndex,
      });
      this.nextTime += stepTime;
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

    const bass = pattern.bass.get(this.step);
    if (bass && bass.token !== "=" && this.arbiter.canPlay("tri", at)) {
      this.apu.playNote("tri", {
        note: bass.token,
        instrument: song.bass,
        duration: bass.length * stepTime * 0.94,
        at,
      });
    }

    const lead = pattern.lead.get(this.step);
    if (lead && this.arbiter.canPlay("p1", at)) {
      if (lead.token === "=") {
        this.apu.stop("p1", at);
      } else {
        this.apu.playNote("p1", {
          note: lead.token,
          instrument: song.lead,
          duration: lead.length * stepTime * 0.96,
          at,
          gain: song.gain,
          });
      }
    }

    const chord = pattern.chord.get(this.step);
    if (chord && chord.token !== "=" && this.arbiter.canPlay("p2", at)) {
      const shape =
        pattern.chordShape[this.chordSlot % pattern.chordShape.length];
      this.chordSlot++;
      this.apu.playNote("p2", {
        note: chord.token,
        instrument: { ...song.chord, arp: shape, arpLoop: true },
        duration: chord.length * stepTime * 0.98,
        at,
        gain: song.gain,
      });
    }

    const perc = pattern.perc.get(this.step);
    if (perc && this.arbiter.canPlay("noi", at)) {
      const kit = song.perc ?? DEFAULT_KIT;
      const voice = kit[perc.token as keyof PercussionKit];
      if (voice) {
        this.apu.playNote("noi", {
          note: voice.note,
          instrument: voice.instrument,
          duration: voice.duration,
          at,
        });
      }
    }
  }
}

