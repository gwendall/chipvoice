/**
 * Whole-song acoustic checks (GEN-03).
 *
 * `validateSong`/`validateProject` (packages/chipvoice/src/validate.ts and
 * project.ts) check a score before it ever makes a sound: a mistyped note, a
 * vibrato the frame clock cannot resolve, a voice budget an arrangement
 * exceeds. None of that reads the rendered audio, so none of it can see a
 * fault that only exists in the samples: the mixer clipping on a section the
 * plan-level check never renders, a whole part gone quiet for no scored
 * reason, a render that stops mid-note, or a loop seam that pops.
 *
 * These checks are the acoustic complement, run once after the full song has
 * rendered (`apps/web/src/lib/composition/jobs.ts`). They are pure: given
 * decoded PCM and the few facts nothing else has (the declared duration, the
 * loop intent, and - only when available - which part had notes scheduled in
 * a given window), they return `Finding`s. They never touch a chip, a driver
 * or an OpenAI request, so they are exercised entirely with synthetic PCM in
 * `apps/web/test-whole-song-checks.mjs`.
 *
 * Every threshold below is chosen against a number this repository already
 * measured, not invented for this file: see the comment beside each constant.
 */

export interface DecodedAudio {
  left: Float32Array;
  right: Float32Array | null;
  sampleRate: number;
}

export type FindingLevel = "warning" | "error";

export interface Finding {
  /** Stable diagnostic name, one per check below. */
  code: string;
  level: FindingLevel;
  /** The affected span of the rendered song, in seconds from its start. */
  startSeconds: number;
  endSeconds: number;
  /** The part this finding can be pinned to, only when exactly one part's
   * scored notes explain the window; omitted when ambiguous or unknown. */
  voice?: string;
  measured: number;
  limit: number;
  message: string;
}

/** A part's scored activity, already converted to seconds by the caller
 * (`performanceClock`, from the `chipvoice` package this module never
 * imports). Each range is one note's [start, end); overlapping/unsorted
 * ranges are fine. */
export interface PartActivity {
  id: string;
  ranges: [number, number][];
}

export interface WholeSongContext {
  /** What the request asked for (`durationSeconds` in the generation
   * request); compared against what actually rendered. */
  durationSeconds: number;
  /** Whether the model was asked for a seamless loop rather than a resolved
   * ending; the loop-seam check only applies then. */
  loop: boolean;
  /** Per-part note schedules, when the caller has them. Enables naming a
   * voice in a `silence_gap` finding; omitted entirely, every silence is
   * reported without a `voice`. */
  parts?: PartActivity[];
}

/** Decodes the one WAV shape this project ever writes: `toWav`
 * (packages/chipvoice/src/render.ts) always emits 16-bit PCM behind a
 * 44-byte header, mono or stereo. `project-render-worker.ts` relies on the
 * same pinned shape; this is an independent, pure reader of it; it does not
 * import the engine. */
export function decodeWav(bytes: Uint8Array): DecodedAudio {
  if (bytes.length < 44) throw new Error("WAV too short to contain a header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0) !== 0x52494646 || // "RIFF"
    view.getUint16(20, true) !== 1 || // PCM
    view.getUint16(34, true) !== 16 || // 16-bit
    view.getUint32(36) !== 0x64617461 // "data"
  )
    throw new Error("Unsupported WAV: expected pinned 16-bit PCM with a 44-byte header");
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const frames = view.getUint32(40, true) / (2 * channels);
  if (![1, 2].includes(channels) || !Number.isSafeInteger(frames) || 44 + frames * channels * 2 !== bytes.length)
    throw new Error("Invalid WAV frame count");
  const left = new Float32Array(frames);
  const right = channels === 2 ? new Float32Array(frames) : null;
  for (let i = 0; i < frames; i++) {
    left[i] = view.getInt16(44 + i * channels * 2, true) / 32768;
    if (right) right[i] = view.getInt16(46 + i * channels * 2, true) / 32768;
  }
  return { left, right, sampleRate };
}

const dbfs = (amplitude: number) => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity);

/** One second of RMS/peak per window, in amplitude (0..1). `windowSeconds`
 * defaults to one second: fine enough to find a gap inside a song, coarse
 * enough that a single held note or a normal beat of rest never fills one. */
function windows(audio: DecodedAudio, windowSeconds: number): { rms: number; peak: number }[] {
  const size = Math.max(1, Math.round(windowSeconds * audio.sampleRate));
  const channels = audio.right ? [audio.left, audio.right] : [audio.left];
  const out: { rms: number; peak: number }[] = [];
  for (let start = 0; start < audio.left.length; start += size) {
    const end = Math.min(audio.left.length, start + size);
    let square = 0, peak = 0, count = 0;
    for (const channel of channels)
      for (let i = start; i < end; i++) {
        const value = channel[i];
        square += value * value;
        peak = Math.max(peak, Math.abs(value));
        count++;
      }
    out.push({ rms: count ? Math.sqrt(square / count) : 0, peak });
  }
  return out;
}

/** Any sample at or past full scale, anywhere in the song. Zero tolerance:
 * the automatic mixer's whole job is staying under 1.0 (decision: "Mix
 * adaptation uses the existing automatic mixer", LOCAL-COMPOSITION.md), and
 * every measured real trial so far reports "zero clipped samples"
 * (GENERATIVE-COMPOSITION.md). The opening-two-seconds evaluation already
 * catches this in the first two seconds; this extends the same zero-tolerance
 * bar to the rest of the render. Adjacent clipped samples within
 * `CLIP_MERGE_SECONDS` are reported as one run, so a single loud transient
 * is one finding, not one per sample. */
const CLIP_MERGE_SECONDS = 0.05;
function checkClipping(audio: DecodedAudio): Finding[] {
  const channels = audio.right ? [audio.left, audio.right] : [audio.left];
  const gap = Math.round(CLIP_MERGE_SECONDS * audio.sampleRate);
  const findings: Finding[] = [];
  let runStart = -1, runEnd = -1, runCount = 0;
  const flush = () => {
    if (runStart < 0) return;
    findings.push({
      code: "clipping", level: "error",
      startSeconds: runStart / audio.sampleRate, endSeconds: (runEnd + 1) / audio.sampleRate,
      measured: runCount, limit: 0,
      message: `${runCount} sample${runCount === 1 ? "" : "s"} at or past full scale between ${(runStart / audio.sampleRate).toFixed(2)}s and ${((runEnd + 1) / audio.sampleRate).toFixed(2)}s`,
    });
    runStart = -1; runEnd = -1; runCount = 0;
  };
  for (let i = 0; i < audio.left.length; i++) {
    const clipped = channels.some((channel) => Math.abs(channel[i]) >= 1);
    if (clipped) {
      if (runStart >= 0 && i - runEnd > gap) flush();
      if (runStart < 0) runStart = i;
      runEnd = i; runCount++;
    }
  }
  flush();
  return findings;
}

/** A window's peak far louder than the song's own typical window, while also
 * close enough to full scale to be the thing a listener notices: a genuine
 * blow-up, not ordinary dynamics (a drum hit, a climactic chord). The median
 * of one-second peaks is the "typical" level, robust to the one loud section
 * a piece is allowed to have; +12dB is a 4x amplitude jump past that, and
 * -9dBFS keeps the floor from firing on a song that is simply loud
 * throughout with no headroom left to blow. Both must hold. */
const LEVEL_WINDOW_SECONDS = 1;
const LEVEL_JUMP_MARGIN_DB = 12;
const LEVEL_JUMP_FLOOR_DBFS = -9;
function checkLevelJumps(audio: DecodedAudio): Finding[] {
  const perWindow = windows(audio, LEVEL_WINDOW_SECONDS);
  if (perWindow.length < 3) return [];
  const sorted = perWindow.map((w) => w.peak).slice().sort((a, b) => a - b);
  const medianDb = dbfs(sorted[Math.floor(sorted.length / 2)]);
  const findings: Finding[] = [];
  perWindow.forEach((w, i) => {
    const peakDb = dbfs(w.peak);
    if (peakDb >= LEVEL_JUMP_FLOOR_DBFS && peakDb - medianDb >= LEVEL_JUMP_MARGIN_DB)
      findings.push({
        code: "level_jump", level: "warning",
        startSeconds: i * LEVEL_WINDOW_SECONDS, endSeconds: (i + 1) * LEVEL_WINDOW_SECONDS,
        measured: Math.round(peakDb * 10) / 10, limit: Math.round((medianDb + LEVEL_JUMP_MARGIN_DB) * 10) / 10,
        message: `peak ${peakDb.toFixed(1)} dBFS here against a ${medianDb.toFixed(1)} dBFS typical window: a ${(peakDb - medianDb).toFixed(1)}dB jump`,
      });
  });
  return findings;
}

/** A run of near-silent one-second windows longer than a bar can plausibly
 * be at rest. `SILENCE_RMS` (~-60dBFS) is the "activity" floor
 * `eval-composition.mjs` already uses to call a window musically active.
 * `MIN_SILENCE_SECONDS` clears the longest ordinary written rest: a whole
 * 4/4 bar at the slowest tempo `validateSong` accepts (40 BPM) is 6s, so two
 * full bars of deliberate silence still pass; past that, nothing in the
 * generated corpus (packages/conform aside) rests that long on purpose. When
 * `context.parts` is supplied, a run is named to the one part whose notes
 * cover it, if exactly one does - a real dropout, not just a written rest. */
const SILENCE_RMS = 0.001;
const MIN_SILENCE_SECONDS = 10;
function checkSilenceGaps(audio: DecodedAudio, context: WholeSongContext): Finding[] {
  const perWindow = windows(audio, 1);
  const findings: Finding[] = [];
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart < 0) return;
    const seconds = end - runStart;
    if (seconds >= MIN_SILENCE_SECONDS) {
      const active = context.parts?.filter((part) =>
        part.ranges.some(([from, until]) => from < end && until > runStart),
      );
      const voice = active?.length === 1 ? active[0].id : undefined;
      findings.push({
        code: "silence_gap", level: "warning",
        startSeconds: runStart, endSeconds: end, ...(voice ? { voice } : {}),
        measured: Math.round(seconds * 10) / 10, limit: MIN_SILENCE_SECONDS,
        message: voice
          ? `${seconds.toFixed(1)}s silent from ${runStart.toFixed(1)}s while only "${voice}" had scheduled notes there`
          : active !== undefined && active.length === 0
            ? `${seconds.toFixed(1)}s silent from ${runStart.toFixed(1)}s with no part scheduled there either (a written rest, unusually long)`
            : `${seconds.toFixed(1)}s silent from ${runStart.toFixed(1)}s`,
      });
    }
    runStart = -1;
  };
  perWindow.forEach((w, i) => {
    const silent = w.rms <= SILENCE_RMS;
    if (silent && runStart < 0) runStart = i;
    if (!silent) flush(i);
  });
  flush(perWindow.length);
  return findings;
}

/** Whether the last stretch of the song is heading toward silence: either it
 * already is quiet (below `ENDING_FLOOR_DBFS`), or it dropped at least
 * `ENDING_MIN_DECAY_DB` from its own recent loudest point. Failing both
 * covers the two symptoms GEN-03 names together: a note truncated mid-decay
 * reads exactly like a tail that never decays once you only have the
 * samples, not the score - both are "the ending stayed loud". The floor
 * (-36dBFS) sits between the -60dBFS silence floor above and ordinary
 * playing level, matching a faded release tail rather than full silence; the
 * 12dB decay bar is the same "clearly audible change" margin the level-jump
 * check above uses, applied downward instead of up.
 *
 * Only applies when the request did not ask for a loop: `compositionInstructions`
 * tells the model to write "an ending with a short release" precisely when
 * `loop` is false, and "a seamless loop" otherwise (score.ts). A loop is
 * rendered for one time round on purpose and is never meant to fade - every
 * one of the repo's own hand-authored arrangements (mario/zelda/sonic,
 * scores/arrangements/*.json) is exactly this shape, and flags here until
 * this check is gated on the same intent the loop-seam check already is. */
const ENDING_WINDOW_SECONDS = 0.5;
const ENDING_TAIL_SECONDS = 3;
const ENDING_FLOOR_DBFS = -36;
const ENDING_MIN_DECAY_DB = 12;
function checkEndingDecay(audio: DecodedAudio, context: WholeSongContext): Finding[] {
  if (context.loop) return [];
  const totalSeconds = audio.left.length / audio.sampleRate;
  if (totalSeconds <= ENDING_WINDOW_SECONDS) return [];
  const perWindow = windows(audio, ENDING_WINDOW_SECONDS);
  const finalWindow = perWindow[perWindow.length - 1];
  const finalDb = dbfs(finalWindow.rms);
  const tailWindows = Math.max(1, Math.round(ENDING_TAIL_SECONDS / ENDING_WINDOW_SECONDS));
  const tail = perWindow.slice(Math.max(0, perWindow.length - tailWindows));
  const peakDb = Math.max(...tail.map((w) => dbfs(w.rms)));
  const decayDb = peakDb - finalDb;
  if (finalDb <= ENDING_FLOOR_DBFS || decayDb >= ENDING_MIN_DECAY_DB) return [];
  return [{
    code: "abrupt_ending", level: "warning",
    startSeconds: totalSeconds - ENDING_TAIL_SECONDS, endSeconds: totalSeconds,
    measured: Math.round(finalDb * 10) / 10, limit: ENDING_FLOOR_DBFS,
    message: `the final ${ENDING_WINDOW_SECONDS}s sits at ${finalDb.toFixed(1)} dBFS, only ${decayDb.toFixed(1)}dB under its own last ${ENDING_TAIL_SECONDS}s peak: it neither faded out nor reached a resolved quiet ending`,
  }];
}

/** Only meaningful when the prompt asked for a seamless loop
 * (`compositionInstructions` writes "seamless loop" vs. "a short release
 * before the end" - LOOP is musical intent the model was given, not a
 * verified guarantee; LOCAL-COMPOSITION.md already says so). Two independent
 * failures at the seam where the render's last sample meets its first:
 * - a level jump: the loop end and loop start should sit at a similar
 *   loudness relative to how much this particular song's own level already
 *   moves window-to-window, or the seam is audible as a jump every repeat.
 *   `typicalJumpDb` is the same-window-size (0.3s) adjacent-window dB delta
 *   through the song's own interior, at the 90th percentile: a "how much
 *   this song's level ordinarily moves" baseline, the same relative-to-its-own-
 *   material idea `typicalStep` already uses below for the click test. A flat
 *   absolute dB bar does not work here: corpus measurement against
 *   scores/arrangements/*.json (mario/zelda/sonic, run under a loop
 *   assumption for calibration) found a well-known seamless loop (zelda)
 *   sitting at 0-4.6dB against its own interior p90 of 4.7-6.1dB on every
 *   chip - safely inside its own ordinary variation - while excerpts with no
 *   declared loop intent (mario) swung 33-37dB, past even their own interior
 *   maximum. `LOOP_LEVEL_JUMP_MARGIN` is how far past that baseline counts as
 *   a step rather than ordinary movement; `LOOP_LEVEL_JUMP_FLOOR_DB` keeps a
 *   near-silent, barely-moving song from flagging on a fraction of a dB.
 * - a click: the single step across the seam far larger than any step the
 *   rest of the song ever takes sample-to-sample. `typicalStep` is the RMS of
 *   the interior's own adjacent-sample deltas (an "expected step" at this
 *   sample rate and this material); a floor keeps a near-silent seam from
 *   flagging on any nonzero step at all. */
const LOOP_WINDOW_SECONDS = 0.3;
const LOOP_LEVEL_JUMP_MARGIN = 2;
const LOOP_LEVEL_JUMP_FLOOR_DB = 6;
const LOOP_CLICK_RATIO = 6;
const LOOP_CLICK_FLOOR = 0.04;
function checkLoopSeam(audio: DecodedAudio, context: WholeSongContext): Finding[] {
  if (!context.loop) return [];
  const frames = audio.left.length;
  const windowFrames = Math.max(1, Math.round(LOOP_WINDOW_SECONDS * audio.sampleRate));
  if (frames < windowFrames * 2) return [];
  const channels = audio.right ? [audio.left, audio.right] : [audio.left];
  const totalSeconds = frames / audio.sampleRate;
  const findings: Finding[] = [];

  const rmsOf = (start: number, end: number) => {
    let square = 0, count = 0;
    for (const channel of channels) for (let i = start; i < end; i++) { square += channel[i] * channel[i]; count++; }
    return Math.sqrt(square / count);
  };
  const perWindow = windows(audio, LOOP_WINDOW_SECONDS);
  const interiorDeltas: number[] = [];
  for (let i = 1; i < perWindow.length; i++) {
    const a = dbfs(perWindow[i - 1].rms), b = dbfs(perWindow[i].rms);
    if (Number.isFinite(a) && Number.isFinite(b)) interiorDeltas.push(Math.abs(a - b));
  }
  interiorDeltas.sort((a, b) => a - b);
  const typicalJumpDb = interiorDeltas.length ? interiorDeltas[Math.floor(0.9 * (interiorDeltas.length - 1))] : 0;
  const jumpLimit = Math.max(LOOP_LEVEL_JUMP_FLOOR_DB, typicalJumpDb * LOOP_LEVEL_JUMP_MARGIN);

  const startDb = dbfs(rmsOf(0, windowFrames));
  const endDb = dbfs(rmsOf(frames - windowFrames, frames));
  const jumpDb = Math.abs(startDb - endDb);
  if (jumpDb >= jumpLimit)
    findings.push({
      code: "loop_level_jump", level: "warning",
      startSeconds: totalSeconds - LOOP_WINDOW_SECONDS, endSeconds: LOOP_WINDOW_SECONDS,
      measured: Math.round(jumpDb * 10) / 10, limit: Math.round(jumpLimit * 10) / 10,
      message: `the loop's end sits at ${endDb.toFixed(1)} dBFS against its start's ${startDb.toFixed(1)} dBFS: a ${jumpDb.toFixed(1)}dB step every repeat, past this song's own typical ${typicalJumpDb.toFixed(1)}dB window-to-window movement`,
    });

  let stepSquare = 0, stepCount = 0;
  for (const channel of channels) for (let i = 1; i < frames; i++) { const delta = channel[i] - channel[i - 1]; stepSquare += delta * delta; stepCount++; }
  const typicalStep = Math.sqrt(stepSquare / stepCount);
  const seamStep = Math.max(...channels.map((channel) => Math.abs(channel[0] - channel[frames - 1])));
  const clickLimit = Math.max(LOOP_CLICK_FLOOR, typicalStep * LOOP_CLICK_RATIO);
  if (seamStep > clickLimit)
    findings.push({
      code: "loop_click", level: "warning",
      startSeconds: totalSeconds, endSeconds: totalSeconds,
      measured: Math.round(seamStep * 1000) / 1000, limit: Math.round(clickLimit * 1000) / 1000,
      message: `the sample at the loop seam steps by ${seamStep.toFixed(3)}, past ${clickLimit.toFixed(3)} (${LOOP_CLICK_RATIO}x this song's own typical step): audible as a click every repeat`,
    });
  return findings;
}

/** The render's actual length against what the request asked for
 * (`durationSeconds`, 10-90s per `compositionRequest`). ±0.25s is not a new
 * number: it is the exact tolerance `eval-composition.mjs`'s live evaluation
 * already asserts (`Math.abs(duration - seconds) < 0.25`) for a real Astra
 * render, so this reuses a bar this project already cleared rather than
 * inventing a stricter one. */
const DURATION_TOLERANCE_SECONDS = 0.25;
function checkDuration(audio: DecodedAudio, context: WholeSongContext): Finding[] {
  const actual = audio.left.length / audio.sampleRate;
  const delta = actual - context.durationSeconds;
  if (Math.abs(delta) <= DURATION_TOLERANCE_SECONDS) return [];
  return [{
    code: "duration_mismatch", level: "error",
    startSeconds: 0, endSeconds: actual,
    measured: Math.round(actual * 100) / 100, limit: context.durationSeconds,
    message: `rendered ${actual.toFixed(2)}s against a declared ${context.durationSeconds}s, ${Math.abs(delta).toFixed(2)}s past the ${DURATION_TOLERANCE_SECONDS}s tolerance`,
  }];
}

/** Runs every whole-song check and returns every finding, sorted by where in
 * the song it happens. Nothing here rejects a generation (see the "Whole-song
 * checks" section of GENERATIVE-COMPOSITION.md for why): findings are
 * recorded on the generation and returned to the caller, for a human or a
 * later, separate repair ticket (GEN-04) to act on. */
export function wholeSongChecks(audio: DecodedAudio, context: WholeSongContext): Finding[] {
  return [
    ...checkDuration(audio, context),
    ...checkClipping(audio),
    ...checkLevelJumps(audio),
    ...checkSilenceGaps(audio, context),
    ...checkEndingDecay(audio, context),
    ...checkLoopSeam(audio, context),
  ].sort((a, b) => a.startSeconds - b.startSeconds);
}
