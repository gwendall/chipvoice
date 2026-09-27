import { chips, getChip, type VoiceSpec, type ChipSpec } from "./chip.js";
import { nesChip } from "./chips/nes/index.js";
import { gbChip } from "./chips/gb/index.js";
import { mdChip } from "./chips/md/index.js";
import { snesChip } from "./chips/snes/index.js";
import { c64Chip } from "./chips/c64/index.js";
import { INTENTS } from "./score.js";
import { noteToFreq, FRAME_RATE, type Instrument } from "./driver.js";
import { DEFAULT_KIT, type Pattern, type PercussionKit, type Song } from "./sequencer.js";
import { loopSeconds } from "./render.js";
import { pitchRange } from './pitch-range.js';
import { registerCode, registerStepCents } from './register-math.js';

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
  /** Which grid step, zero-based, when it belongs to one. */
  step?: number;
  /** The token that caused it. */
  token?: string;
  /** The physical voice involved, when the diagnostic is about hardware
   * contention or a register limit rather than the role that reached it. */
  voice?: string;
  message: string;
  /**
   * True when the mistake produces no sound and no error - the class of fault
   * nothing else in the stack will ever report.
   */
  silent: boolean;
  /** What the song asked for, in the unit the message names. */
  measured?: number;
  /** What the hardware can actually do, in that same unit. */
  limit?: number;
}

export interface Measured {
  /** How long one time round takes, at the song's own tempo. */
  loopSeconds: number;
  /** Notes and drum hits per second, across every channel. */
  onsetsPerSecond: number;
  /** Melodic range in semitones. */
  range: number;
  /** Total grid steps in the order. */
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

/** Grid steps a token at `step` holds for: the distance to the next new
 * token - a note or a cut - or to the line's end. Mirrors the sequencer's own
 * `parseChannel`, which is what actually times a held note. */
function eventSteps(line: string[], step: number): number {
  let end = step + 1;
  while (end < line.length && line[end] === ".") end++;
  return end - step;
}

/**
 * What a song asks of one instrument that no note in particular caused: a
 * vibrato rate the frame clock cannot resolve, or a volume step the chip's
 * register rounds. Checked once per instrument rather than per pattern,
 * because the instrument - unlike a note's pitch - does not vary by step.
 */
function checkInstrument(instrument: Instrument | undefined, track: string, chip: ChipSpec, issues: Issue[], label = track) {
  if (!instrument) return;
  if (instrument.vibrato) {
    const { rate } = instrument.vibrato;
    if (!Number.isFinite(rate) || rate < MIN_VIBRATO_FRAMES) {
      issues.push({
        level: "warning", code: "vibrato_rate", track,
        message: `${label}'s vibrato rate is ${rate} frames a cycle, under the ${MIN_VIBRATO_FRAMES} the driver's ${FRAME_RATE}Hz frame clock can resolve without aliasing. Raise vibrato.rate.`,
        measured: rate, limit: MIN_VIBRATO_FRAMES, silent: false,
      });
    }
  }
  if (chip.id !== "snes") {
    const fraction = instrument.volume?.find((v) => Math.abs(v - Math.round(v)) > 1e-9);
    if (fraction !== undefined) {
      issues.push({
        level: "warning", code: "volume_step", track,
        message: `${label}'s volume table has ${fraction}, which ${chip.id} rounds to a whole step (${Math.round(fraction)}) before it ever reaches a register. Use integers 0-15, or accept the rounding.`,
        measured: fraction, limit: Math.round(fraction), silent: false,
      });
    }
  }
}

/**
 * The floor a loop has to clear before it wears through.
 *
 * Not a taste judgement: the boss theme in the game this came from was 5.7
 * seconds once and was heard ten times in a single fight. Fourteen is where
 * that stops being the first thing anybody notices.
 */
const MIN_LOOP_SECONDS = 14;

/**
 * A sine needs at least two samples a cycle to be a sine rather than noise -
 * the frame clock's own Nyquist floor. A vibrato slower than this is fine; one
 * faster aliases against the 60Hz frame it is read at, which no depth fixes.
 */
const MIN_VIBRATO_FRAMES = 2;

/**
 * Cents one register step may span before a slide reads as steps rather than
 * a glide. Half a semitone: coarser than that and the jump is the first thing
 * heard, not the pitch either side of it.
 */
const COARSE_REGISTER_CENTS = 50;

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
  if (s.stepsPerBeat !== undefined && s.stepsPerBeat !== 4 && s.stepsPerBeat !== 12) {
    return fail("stepsPerBeat must be 4 or 12");
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

  // Instrument-level diagnostics: the same three roles' tables, plus the
  // kit's own four drums, none of which vary by pattern or step.
  for (const track of ["lead", "chord", "bass"] as const) {
    checkInstrument((s as Song)[track], track, chip.spec, issues);
  }
  const kit = (s as Song).perc ?? DEFAULT_KIT;
  for (const letter of Object.keys(kit) as (keyof PercussionKit)[]) {
    checkInstrument(kit[letter]?.instrument, "perc", chip.spec, issues, `perc's ${letter}`);
  }

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

  const stepTime = 60 / song.bpm / (song.stepsPerBeat ?? 4);
  const hz = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

  for (const track of TRACKS) {
    const voice = voices.get(roles[track]);
    const instrument = track === 'perc' ? undefined : song[track];
    const range = voice && track !== 'perc' ? pitchRange(chip, voice, instrument) : null;
    const trackTokens = tokens(pattern[track]);
    let chordSlot = 0;
    trackTokens.forEach((token, step) => {
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
        const lowHz = hz(low), highHz = hz(high);
        const outOfRange = lowHz < range[0] || highHz > range[1];
        if (outOfRange) {
          const measured = lowHz < range[0] ? lowHz : highHz;
          const limit = lowHz < range[0] ? range[0] : range[1];
          issues.push({
            level: 'warning', code: 'pitch_range', pattern: patternIndex, track, step, token, voice: voice!.id, measured, limit,
            message: `${where}${token}${shape?.length ? ' with its chord intervals' : ''} exceeds ${chip.id}/${voice!.id}'s base pitch range (${range[0].toFixed(1)} to ${range[1].toFixed(1)} Hz). Transpose it or choose another machine; the driver can clamp or silence it. Pitch modulation is not included in this check.`,
            silent: false,
          });
        }

        // Modulation: what the instrument's vibrato and slide ask of this
        // note, checked against the same register the base pitch was.
        const vibrato = instrument?.vibrato;
        if (vibrato && !outOfRange) {
          const { depth } = vibrato;
          const upHz = hz(high + depth), downHz = hz(low - depth);
          if (upHz > range[1] || downHz < range[0]) {
            const measured = upHz > range[1] ? upHz : downHz;
            const limit = upHz > range[1] ? range[1] : range[0];
            issues.push({
              level: 'warning', code: 'vibrato_range', pattern: patternIndex, track, step, token, voice: voice!.id, measured, limit,
              message: `${where}${token}'s vibrato swings to ${measured.toFixed(1)} Hz, past ${chip.id}/${voice!.id}'s ${limit.toFixed(1)} Hz limit. Reduce vibrato.depth or move the note away from the edge of the range.`,
              silent: false,
            });
          } else {
            const center = registerCode(chip, voice!, hz(midi), instrument);
            const up = registerCode(chip, voice!, hz(midi + depth), instrument);
            const down = registerCode(chip, voice!, hz(midi - depth), instrument);
            if (center !== null && up === center && down === center) {
              issues.push({
                level: 'warning', code: 'vibrato_resolution', pattern: patternIndex, track, step, token, voice: voice!.id, measured: depth, limit: 0,
                message: `${where}${token}'s vibrato depth (${depth} semitones) is smaller than one ${chip.id}/${voice!.id} register step at this pitch, so the wobble quantizes to nothing. Raise vibrato.depth, or expect silence where you asked for motion.`,
                silent: false,
              });
            }
          }
        }

        const slide = instrument?.slide;
        if (slide) {
          const frames = Math.max(1, Math.round(eventSteps(trackTokens, step) * stepTime * FRAME_RATE));
          const endSemis = slide * (frames - 1);
          const slideLow = Math.min(low, low + endSemis), slideHigh = Math.max(high, high + endSemis);
          const slideLowHz = hz(slideLow), slideHighHz = hz(slideHigh);
          if (slideLowHz < range[0] || slideHighHz > range[1]) {
            const measured = slideLowHz < range[0] ? slideLowHz : slideHighHz;
            const limit = slideLowHz < range[0] ? range[0] : range[1];
            issues.push({
              level: 'warning', code: 'slide_range', pattern: patternIndex, track, step, token, voice: voice!.id, measured, limit,
              message: `${where}${token}'s slide reaches ${measured.toFixed(1)} Hz over ${frames} frames, past ${chip.id}/${voice!.id}'s ${limit.toFixed(1)} Hz limit. Shorten the note, flatten the slide, or move the starting pitch.`,
              silent: false,
            });
          } else {
            const stepCentsStart = registerStepCents(chip, voice!, hz(midi), instrument) ?? 0;
            const stepCentsEnd = registerStepCents(chip, voice!, hz(midi + endSemis), instrument) ?? 0;
            const worst = Math.max(stepCentsStart, stepCentsEnd);
            if (worst > COARSE_REGISTER_CENTS) {
              issues.push({
                level: 'warning', code: 'slide_resolution', pattern: patternIndex, track, step, token, voice: voice!.id, measured: worst, limit: COARSE_REGISTER_CENTS,
                message: `${where}${token}'s slide crosses a region of ${chip.id}/${voice!.id}'s table where one register step is ${worst.toFixed(0)} cents: the glide will audibly step there rather than glide. Keep the slide within a narrower octave, or expect stair-steps at that end.`,
                silent: false,
              });
            }
          }
        }
      }
    });

  }

  // Voice budget: a drum and the chord landing on the same physical voice,
  // as the SID's v3 does, is not a mistake - the sequencer resolves it by
  // cutting the chord for the hit and resuming it after - but it is a fact
  // about the arrangement worth naming at the step it happens.
  if (roles.chord === roles.perc) {
    const chordTokens = tokens(pattern.chord);
    let chordSounding = false;
    const sounding: boolean[] = chordTokens.map((token) => {
      if (token === "=") chordSounding = false;
      else if (token !== ".") chordSounding = true;
      return chordSounding;
    });
    tokens(pattern.perc).forEach((token, step) => {
      if (PERCUSSION.has(token) && sounding[step]) {
        issues.push({
          level: 'warning', code: 'voice_share', pattern: patternIndex, track: 'perc', step, token, voice: roles.perc,
          message: `${where}${token} at step ${step} shares ${chip.id}'s ${roles.perc} with the chord; the chord tone is cut for the hit and resumes after it.`,
          silent: false,
        });
      }
    });
  }

  // A single percussion voice means one drum can cut another's decay short,
  // not just cut the chord's: the 2A03's one noise channel is the ticket's
  // own example, and every chip here has exactly one.
  {
    const kit = song.perc ?? DEFAULT_KIT;
    let previous: { step: number; token: string } | null = null;
    tokens(pattern.perc).forEach((token, step) => {
      if (!PERCUSSION.has(token)) return;
      if (previous) {
        const drum = kit[previous.token as keyof PercussionKit];
        const gapSeconds = (step - previous.step) * stepTime;
        if (drum && gapSeconds < drum.duration) {
          issues.push({
            level: 'warning', code: 'perc_voice', pattern: patternIndex, track: 'perc', step, token, voice: roles.perc,
            message: `${where}${token} at step ${step} arrives ${gapSeconds.toFixed(2)}s after the ${previous.token} at step ${previous.step}, inside its ${drum.duration}s decay. ${chip.id} has one ${roles.perc} voice, so the ${previous.token} is cut short. Space the hits at least ${drum.duration}s apart, or accept the cut.`,
            measured: gapSeconds, limit: drum.duration,
            silent: false,
          });
        }
      }
      previous = { step, token };
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
  if (chip.chordVoices && Array.isArray(pattern.chordShape)) {
    const largest = Math.max(0, ...pattern.chordShape.filter(shape => Array.isArray(shape)).map(shape => shape.length));
    if (largest > chip.chordVoices.length) {
      issues.push({
        level: 'warning', code: 'chord_capacity', pattern: patternIndex, track: 'chord', measured: largest, limit: chip.chordVoices.length,
        message: `${where}${chip.id} has ${chip.chordVoices.length} chord voices. Larger shapes use a single-voice arpeggio so every interval is retained.`, silent: false,
      });
    }
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
