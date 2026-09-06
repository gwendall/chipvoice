import { chips, getChip, type VoiceSpec, type ChipSpec } from "./chip.js";
import { nesChip } from "./chips/nes/index.js";
import { gbChip } from "./chips/gb/index.js";
import { mdChip } from "./chips/md/index.js";
import { snesChip } from "./chips/snes/index.js";
import { c64Chip } from "./chips/c64/index.js";
import { INTENTS } from "./score.js";
import { noteToFreq } from "./driver.js";
import type { Pattern, Song } from "./sequencer.js";
import { loopSeconds } from "./render.js";
import { pitchRange } from './pitch-range.js';

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
  /** Stable diagnostic name when one is available. */
  code?: string;
  pattern?: number;
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
  const s = song as Partial<Song> & { chip?: string; intent?: unknown };

  const chipId = s.chip ?? "2a03";
  const chip = chipId === "2a03" ? nesChip : chipId === "dmg" ? gbChip : chipId === "md" ? mdChip : chipId === "snes" ? snesChip : chipId === "c64" ? c64Chip : getChip(chipId);
  if (!chip) {
    return fail(`unknown chip "${chipId}". This build knows: ${chips().map((c) => c.id).join(", ")}`);
  }
  const voices = new Map<string, VoiceSpec>(chip.spec.voices.map((v) => [v.id, v]));

  // An intent is a word per role, from the catalogue; a word that is not
  // there would silently be the default, which is the class of fault this
  // validator exists to name.
  if (s.intent !== undefined) {
    if (!s.intent || typeof s.intent !== "object") return fail("intent must be an object of role to word");
    for (const [role, word] of Object.entries(s.intent as Record<string, unknown>)) {
      const words = (INTENTS as Record<string, Record<string, string>>)[role];
      if (!Object.hasOwn(INTENTS, role)) {
        issues.push({ level: "error", message: `intent.${role}: no such role. The roles are ${Object.keys(INTENTS).join(", ")}`, silent: true });
      } else if (typeof word !== "string" || !Object.hasOwn(words, word)) {
        issues.push({ level: "error", track: role, message: `intent.${role}: "${String(word)}" is not a ${role} intent. This build knows: ${Object.keys(words).join(", ")}`, silent: true });
      }
    }
  }

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
    checkPattern(pattern, patternIndex, issues, voices, chip.spec, s as Song, s.patterns!.length > 1);
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
  /** Which voice each track lands on: the chip's map of the song's roles. */
  chip: ChipSpec,
  song: Song,
  numbered: boolean,
) {
  const where = numbered ? `pattern ${patternIndex}, ` : "";
  const roles = chip.roles;

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
  if (lengths.bass === 0) issues.push({ level: 'error', pattern: patternIndex, track: 'bass', message: `${where}a pattern needs at least one step; use dots for silence`, silent: false });

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
    const voice = voices.get(roles[track]);
    const instrument = track === 'perc' ? undefined : song[track];
    const range = voice && track !== 'perc' ? pitchRange(chip, voice, instrument) : null;
    let chordSlot = 0;
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

      const midi = midiOf(token);
      if (midi === null) {
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
      } else if (range) {
        const shape = track === 'chord' && Array.isArray(pattern.chordShape) && pattern.chordShape.length
          ? pattern.chordShape[chordSlot++ % pattern.chordShape.length] : instrument?.arp;
        let low = midi, high = midi;
        if (Array.isArray(shape)) for (const shift of shape) if (Number.isFinite(shift)) { low = Math.min(low, midi + shift); high = Math.max(high, midi + shift); }
        const hz = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
        if (hz(low) < range[0] || hz(high) > range[1]) issues.push({
          level: 'warning', code: 'pitch_range', pattern: patternIndex, track, step, token,
          message: `${where}${token}${shape?.length ? ' with its chord intervals' : ''} exceeds ${chip.id}/${voice!.id}'s base pitch range (${range[0].toFixed(1)}–${range[1].toFixed(1)} Hz). Transpose it or choose another machine; the driver can clamp or silence it. Pitch modulation is not included in this check.`,
          silent: false,
        });
      }
    });

  }

  if (!Array.isArray(pattern.chordShape) || pattern.chordShape.length === 0) {
    issues.push({
      level: "error",
      track: "chord",
      message:
        `${where}chordShape is missing. It lists the intervals each chord root is played with, ` +
        `in semitones: [[0,3,7]] is minor, [[0,4,7]] is major`,
      silent: false,
    });
  } else if (pattern.chordShape.some(shape => !Array.isArray(shape) || !shape.length || shape.some(n => !Number.isInteger(n)))) {
    issues.push({ level: 'error', pattern: patternIndex, track: 'chord', message: `${where}each chord shape must contain integer semitone offsets`, silent: false });
  }
  if (chip.chordVoices && Array.isArray(pattern.chordShape) && pattern.chordShape.some(shape => Array.isArray(shape) && shape.length > chip.chordVoices!.length)) {
    issues.push({ level: 'warning', code: 'chord_capacity', pattern: patternIndex, track: 'chord',
      message: `${where}${chip.id} has ${chip.chordVoices.length} chord voices. Larger shapes use a single-voice arpeggio so every interval is retained.`, silent: false });
  }
}

function measure(song: Song): Measured {
  let onsets = 0;
  let steps = 0;
  let low = Infinity, high = -Infinity;

  for (const index of song.order) {
    const pattern = song.patterns[index];
    steps += tokens(pattern.bass).length;
    for (const track of TRACKS) {
      for (const token of tokens(pattern[track])) {
        if (token === "." || token === "=") continue;
        onsets++;
        if (track !== "perc") {
          const midi = midiOf(token);
          if (midi !== null) { low = Math.min(low, midi); high = Math.max(high, midi); }
        }
      }
    }
  }

  const seconds = loopSeconds(song);
  return {
    loopSeconds: Math.round(seconds * 10) / 10,
    onsetsPerSecond: Math.round((onsets / seconds) * 10) / 10,
    range: Number.isFinite(low) ? high - low : 0,
    steps,
  };
}
