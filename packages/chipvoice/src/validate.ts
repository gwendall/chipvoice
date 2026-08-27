import { getChip, type VoiceSpec } from "./chip.js";
import { nesChip } from "./chips/nes/index.js";
import { noteToFreq } from "./driver.js";
import type { Pattern, Song } from "./sequencer.js";
import { loopSeconds } from "./render.js";

/**
 * Checks a song and says what is wrong in words somebody can act on.
 *
 * This exists because of one property of the format that makes it hostile to
 * anything writing songs without ears: **a mistyped note is silent.** A token
 * that is not a note name resolves to 0 Hz, the driver returns without
 * scheduling anything, and the result is a hole in the middle of a piece with
 * no error anywhere. A caller that gets a 200 and a track with a gap in it
 * cannot tell what happened.
 *
 * So every issue carries `silent`, which is the difference between "you made a
 * mistake" and "you made a mistake that produces no evidence".
 */
export type IssueLevel = "error" | "warning";

export interface Issue {
  level: IssueLevel;
  /** The channel it is on, when it belongs to one. */
  track?: string;
  /** Which sixteenth, zero-based, when it belongs to one. */
  step?: number;
  /** The token that caused it. */
  token?: string;
  message: string;
  /**
   * True when the mistake produces no sound and no error - the class of fault
   * nothing else in the stack will ever report.
   */
  silent: boolean;
}

export interface Measured {
  /** How long one time round takes, at the song's own tempo. */
  loopSeconds: number;
  /** Notes and drum hits per second, across every channel. */
  onsetsPerSecond: number;
  /** Melodic range in semitones. */
  range: number;
  /** Total sixteenths in the order. */
  steps: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  measured: Measured | null;
}

const PERCUSSION = new Set(["K", "S", "H", "O"]);
const TRACKS = ["bass", "lead", "chord", "perc"] as const;
type TrackName = (typeof TRACKS)[number];

/** Which voice each track lands on, for the 2A03's four. */
const TRACK_VOICE: Record<TrackName, string> = {
  bass: "tri",
  lead: "p1",
  chord: "p2",
  perc: "noi",
};

const tokens = (line: string) => line.trim().split(/\s+/).filter(Boolean);

function midiOf(token: string): number | null {
  const freq = noteToFreq(token);
  if (!freq) return null;
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

/**
 * The floor a loop has to clear before it wears through.
 *
 * Not a taste judgement: the boss theme in the game this came from was 5.7
 * seconds once and was heard ten times in a single fight. Fourteen is where
 * that stops being the first thing anybody notices.
 */
const MIN_LOOP_SECONDS = 14;

export function validateSong(song: unknown): ValidationResult {
  const issues: Issue[] = [];
  const fail = (message: string, silent = false): ValidationResult => {
    issues.push({ level: "error", message, silent });
    return { ok: false, issues, measured: null };
  };

  if (!song || typeof song !== "object") return fail("expected an object");
  const s = song as Partial<Song> & { chip?: string };

  const chipId = s.chip ?? "2a03";
  const chip = chipId === "2a03" ? nesChip : getChip(chipId);
  if (!chip) {
    return fail(`unknown chip "${chipId}". This build knows: 2a03`);
  }
  const voices = new Map<string, VoiceSpec>(chip.spec.voices.map((v) => [v.id, v]));

  if (typeof s.bpm !== "number" || !Number.isFinite(s.bpm)) {
    return fail("bpm must be a number");
  }
  if (s.bpm < 40 || s.bpm > 300) {
    issues.push({
      level: "error",
      message: `bpm ${s.bpm} is outside 40-300`,
      silent: false,
    });
  }
  if (!Array.isArray(s.patterns) || s.patterns.length === 0) {
    return fail("patterns must be a non-empty array");
  }
  if (!Array.isArray(s.order) || s.order.length === 0) {
    return fail("order must be a non-empty array of pattern indexes");
  }
  for (const index of s.order) {
    if (typeof index !== "number" || !s.patterns[index]) {
      return fail(`order references pattern ${index}, which does not exist`);
    }
  }

  s.patterns.forEach((pattern, patternIndex) => {
    checkPattern(pattern, patternIndex, issues, voices, s.patterns!.length > 1);
  });

  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) return { ok: false, issues, measured: null };

  const measured = measure(s as Song);
  if (measured.loopSeconds < MIN_LOOP_SECONDS) {
    issues.push({
      level: "warning",
      message:
        `the loop is ${measured.loopSeconds.toFixed(1)}s, under the ${MIN_LOOP_SECONDS}s floor. ` +
        `Anything shorter is heard as a repeat rather than as a piece - add patterns to the order, or lengthen them`,
      silent: false,
    });
  }

  return { ok: true, issues, measured };
}

function checkPattern(
  pattern: Pattern,
  patternIndex: number,
  issues: Issue[],
  voices: Map<string, VoiceSpec>,
  numbered: boolean,
) {
  const where = numbered ? `pattern ${patternIndex}, ` : "";

  if (!pattern || typeof pattern !== "object") {
    issues.push({ level: "error", message: `${where}not an object`, silent: false });
    return;
  }

  for (const track of TRACKS) {
    if (typeof pattern[track] !== "string") {
      issues.push({
        level: "error",
        track,
        message: `${where}${track} is missing. All four channels are required, even empty: a line of dots`,
        silent: false,
      });
      return;
    }
  }

  const lengths = Object.fromEntries(
    TRACKS.map((track) => [track, tokens(pattern[track]).length]),
  ) as Record<TrackName, number>;

  /*
   * Pattern length comes from the bass line, which is what makes a bar in five
   * possible - and what makes a longer lead line lose its tail every loop, with
   * nothing anywhere reporting it.
   */
  for (const track of TRACKS) {
    if (track === "bass") continue;
    if (lengths[track] !== lengths.bass) {
      issues.push({
        level: "error",
        track,
        message:
          `${where}${track} has ${lengths[track]} tokens against the bass line's ${lengths.bass}. ` +
          `Pattern length comes from the bass, so ` +
          (lengths[track] > lengths.bass
            ? `the last ${lengths[track] - lengths.bass} are dropped every loop`
            : `the last ${lengths.bass - lengths[track]} steps of this channel are silent`),
        silent: true,
      });
    }
  }

  for (const track of TRACKS) {
    const voice = voices.get(TRACK_VOICE[track]);
    tokens(pattern[track]).forEach((token, step) => {
      if (token === "." || token === "=") return;

      if (track === "perc") {
        if (!PERCUSSION.has(token)) {
          issues.push({
            level: "error",
            track,
            step,
            token,
            message: `not a drum. Use K kick, S snare, H hat, O open hat`,
            silent: true,
          });
        }
        return;
      }

      if (midiOf(token) === null) {
        issues.push({
          level: "error",
          track,
          step,
          token,
          message:
            `not a note name. A note is a letter A-G, an optional # or b, then an octave: ` +
            `A4, F#3, Bb2. Use . to hold and = to cut`,
          // The whole reason this validator exists: an unparsed note is
          // scheduled as nothing at all, so the only evidence is a hole.
          silent: true,
        });
      }
    });

    void voice;
  }

  if (!Array.isArray(pattern.chordShape) || pattern.chordShape.length === 0) {
    issues.push({
      level: "error",
      track: "chord",
      message:
        `${where}chordShape is missing. It is the arpeggio each chord note is played as, ` +
        `in semitones: [[0,3,7]] is minor, [[0,4,7]] is major`,
      silent: false,
    });
  }
}

function measure(song: Song): Measured {
  let onsets = 0;
  let steps = 0;
  const pitches: number[] = [];

  for (const index of song.order) {
    const pattern = song.patterns[index];
    steps += tokens(pattern.bass).length;
    for (const track of TRACKS) {
      for (const token of tokens(pattern[track])) {
        if (token === "." || token === "=") continue;
        onsets++;
        if (track !== "perc") {
          const midi = midiOf(token);
          if (midi !== null) pitches.push(midi);
        }
      }
    }
  }

  const seconds = loopSeconds(song);
  return {
    loopSeconds: Math.round(seconds * 10) / 10,
    onsetsPerSecond: Math.round((onsets / seconds) * 10) / 10,
    range: pitches.length > 0 ? Math.max(...pitches) - Math.min(...pitches) : 0,
    steps,
  };
}
