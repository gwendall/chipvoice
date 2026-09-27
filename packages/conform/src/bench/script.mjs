/**
 * The capture-day test script: a published, committed sequence of 2A03
 * register writes, timed one batch per video frame (see `build-rom.mjs` for
 * why a vblank poll stands in for an NMI). This is the one thing a captured
 * unit and this repository's own core must agree on running; everything the
 * bench measures - the sync marker, the step response, the tone ladders, the
 * noise segments - is defined once, here, and consumed by the ROM builder,
 * the renderer and the comparator alike.
 *
 * A "frame" is one iteration of the ROM's main loop: wait for vblank, then
 * make zero or more writes. `NTSC_FRAME` is the same nominal cycle count
 * `packages/conform/src/roms/nes.mjs` advances vblank by - not exact NTSC
 * timing (which alternates long and short frames), but the harness's own
 * approximation, so a script built and run against the harness lands on
 * exactly the cycles this file predicts. On real hardware a frame is close
 * to but not exactly this many cycles, which is what the sync markers and
 * `compare.mjs`'s drift correction are for.
 */
export const CPU_HZ = 1789773;
export const NTSC_FRAME = 29781;

/** Pulse period for a frequency, clamped to the 11-bit register field. */
export function pulsePeriod(freqHz) {
  const p = Math.round(CPU_HZ / (16 * freqHz)) - 1;
  return Math.max(0, Math.min(2047, p));
}

/** Triangle period for a frequency, clamped to the 11-bit register field. */
export function trianglePeriod(freqHz) {
  const p = Math.round(CPU_HZ / (32 * freqHz)) - 1;
  return Math.max(0, Math.min(2047, p));
}

/** Roughly half-octave steps, 41 Hz to 14 kHz: dense enough to bracket both
 * high-pass corners (90 Hz, 440 Hz) and the low-pass corner (14 kHz) with
 * several points either side, per CONFORMANCE.md's 40 Hz-15 kHz band. */
export const FREQS = [41, 58, 82, 110, 155, 220, 310, 440, 620, 880, 1245, 1760, 2490, 3520, 4980, 7040, 9960, 14000];
/**
 * The pulse's own period register, unclamped, so the two bounds it is
 * actually subject to can be checked directly: below 58 Hz the true period
 * exceeds the 11-bit field and `pulsePeriod` would silently clamp it to the
 * wrong (sharp) frequency; above roughly 12.4 kHz the hardware mutes a pulse
 * outright once its period drops under 8 (`Pulse.output()`'s own guard,
 * `packages/chipvoice/src/chips/nes/dsp.ts`) - 14 kHz's period is 7, so it
 * would play nothing at all rather than a slightly-wrong tone.
 */
function rawPulsePeriod(freqHz) {
  return Math.round(CPU_HZ / (16 * freqHz)) - 1;
}
export const PULSE_FREQS = FREQS.filter((f) => {
  const p = rawPulsePeriod(f);
  return p >= 8 && p <= 2047;
});
/** The triangle's timer runs twice as slow, so it reaches every frequency here without either bound. */
export const TRIANGLE_FREQS = FREQS;

const TONE_HOLD = 30; // frames per tone, ~0.5 s: >= 12 cycles even at 41 Hz
const TONE_GAP = 8; // frames of silence between tones, for the noise floor and settling
const NOISE_HOLD = 48; // frames per noise segment, ~0.8 s, for a stable broadband spectrum
const NOISE_GAP = 10;
const STEP_HOLD = 20; // frames the step stays up/down, ~0.33 s: several HP time constants
const SYNC_GAP = 2; // frames between sync-marker edges

const LEN_IDX = 0; // length-counter table index 0 (value 10); halt=1 freezes it regardless
const PULSE_DUTY = 2; // 50%, an arbitrary but audible, documented choice
const VOL = 15;

/**
 * A little sequencer: `at(frame)` moves the cursor, `write(addr, value)`
 * appends a write at the cursor, `hold(frames)` advances it. Segments are
 * recorded as they are built, in cycles derived from `NTSC_FRAME` for the
 * renderer's and comparator's windowing - not what a real capture will show,
 * which is the point of measuring one.
 */
class Builder {
  constructor() {
    this.frame = 0;
    this.writes = [];
    this.segments = [];
  }
  write(addr, value) {
    this.writes.push({ frame: this.frame, addr, value });
  }
  hold(frames) {
    this.frame += frames;
  }
  segment(id, kind, frames, extra = {}) {
    const startFrame = this.frame;
    this.segments.push({ id, kind, startFrame, frames, startCycle: startFrame * NTSC_FRAME, endCycle: (startFrame + frames) * NTSC_FRAME, ...extra });
  }
}

/**
 * Builds the script: every register write with its frame number, and the
 * segment map `render.mjs` and `compare.mjs` use to know what should be
 * playing when. Deterministic - no randomness, no wall-clock time - so the
 * ROM and the corpus JSON it is committed alongside never change between
 * builds.
 */
export function buildScript() {
  const b = new Builder();

  // Silence everything first; this is also frame 0's only write, so the ROM
  // and a real console agree on where "the start" is even before the sync
  // marker's first edge.
  b.write(0x4015, 0x00);
  b.segment('init', 'silence', 4);
  b.hold(4);

  // The sync marker: three sharp DMC direct-load edges, up-down-up-down-up-down,
  // two frames apart (~33 ms). $4011 is independent of $4015 and of every
  // other register, so nothing else can smear this shape, and three evenly
  // spaced edges are not something any tone or noise segment produces by
  // accident, which is what makes it findable by cross-correlation alone.
  const syncStart = b.frame;
  for (let i = 0; i < 3; i++) {
    b.write(0x4011, 0x7f);
    b.hold(SYNC_GAP);
    b.write(0x4011, 0x00);
    b.hold(SYNC_GAP);
  }
  b.segments.push({ id: 'sync-start', kind: 'sync', startFrame: syncStart, frames: b.frame - syncStart, startCycle: syncStart * NTSC_FRAME, endCycle: b.frame * NTSC_FRAME });

  b.segment('settle-1', 'silence', 40);
  b.hold(40);

  // The step response: one hard edge up, held, one hard edge down, held.
  // What decays after each edge is the two high-pass sections' own time
  // constant (about 1.8 ms at 90 Hz, 0.36 ms at 440 Hz); twenty frames is
  // two orders of magnitude longer than either, so the tail is flat before
  // the next edge, on any first-order filter these corners could plausibly be.
  b.segment('step', 'step', STEP_HOLD * 2, { addr: 0x4011 });
  b.write(0x4011, 0x7f);
  b.hold(STEP_HOLD);
  b.write(0x4011, 0x00);
  b.hold(STEP_HOLD);

  b.segment('settle-2', 'silence', 20);
  b.hold(20);

  // Enable the four channels the tone and noise segments use. The DMC above
  // never needed $4015's bit 4: a direct load bypasses its sample reader.
  b.write(0x4015, 0x0f);

  // Pulse 1: a half-octave ladder, one channel register set once, the
  // period rewritten (and the phase restarted) at every tone. `$4001 = $08`
  // first, per the driver's own convention (see docs/chips/2a03.md's driver
  // coverage table): with the sweep off but negate set, the sweep unit's
  // overflow trap does not mute a period at or past `$400` - every tone from
  // 58 Hz up needs this, since their periods are 1928 and 1363.
  b.write(0x4001, 0x08);
  b.write(0x4000, ((PULSE_DUTY << 6) | 0x30 | VOL) & 0xff);
  for (const freq of PULSE_FREQS) {
    const period = pulsePeriod(freq);
    b.segment('pulse-tone', 'tone', TONE_HOLD, { channel: 'p1', freq });
    b.write(0x4002, period & 0xff);
    b.write(0x4003, ((LEN_IDX << 3) | ((period >> 8) & 7)) & 0xff);
    b.hold(TONE_HOLD);
    b.write(0x4000, 0x30); // silence: duty 0, halt, constant volume 0
    b.segment('pulse-gap', 'silence', TONE_GAP);
    b.hold(TONE_GAP);
    b.write(0x4000, ((PULSE_DUTY << 6) | 0x30 | VOL) & 0xff);
  }
  b.write(0x4000, 0x30);

  b.segment('settle-3', 'silence', 20);
  b.hold(20);

  // The triangle: the same ladder, extended down to 41 Hz, which the pulse
  // channel's 11-bit period cannot reach.
  b.write(0x4008, 0xff);
  for (const freq of TRIANGLE_FREQS) {
    const period = trianglePeriod(freq);
    b.segment('triangle-tone', 'tone', TONE_HOLD, { channel: 'tri', freq });
    b.write(0x400a, period & 0xff);
    b.write(0x400b, ((LEN_IDX << 3) | ((period >> 8) & 7)) & 0xff);
    b.hold(TONE_HOLD);
    b.write(0x4008, 0x00); // silence: control flag 0 reloads the linear counter with 0
    b.segment('triangle-gap', 'silence', TONE_GAP);
    b.hold(TONE_GAP);
    b.write(0x400b, ((LEN_IDX << 3) | ((period >> 8) & 7)) & 0xff);
    b.write(0x4008, 0xff);
  }
  b.write(0x4008, 0x00);

  b.segment('settle-4', 'silence', 20);
  b.hold(20);

  // Noise, both modes, one fixed period each: mode 0 is the 32767-step
  // sequence, broadband; mode 1 is the 93-step sequence, the same feedback
  // tap moved from bit 1 to bit 6, audibly more tonal. Period index 2 is
  // fast enough that both modes carry energy across the whole 40 Hz-15 kHz
  // band the bench measures.
  const NOISE_PERIOD_INDEX = 2;
  for (const mode of [0, 1]) {
    b.write(0x400c, 0x3f);
    b.segment('noise', 'noise', NOISE_HOLD, { mode });
    b.write(0x400e, ((mode << 7) | NOISE_PERIOD_INDEX) & 0xff);
    b.write(0x400f, (LEN_IDX << 3) & 0xff);
    b.hold(NOISE_HOLD);
    b.write(0x400c, 0x30);
    b.segment('noise-gap', 'silence', NOISE_GAP);
    b.hold(NOISE_GAP);
  }

  b.segment('settle-5', 'silence', 30);
  b.hold(30);

  // The end marker: identical to the start marker, for `compare.mjs` to find
  // and measure the drift between here and there against `NTSC_FRAME` * the
  // number of frames in between - the whole point of putting two of them in.
  const syncEndStart = b.frame;
  for (let i = 0; i < 3; i++) {
    b.write(0x4011, 0x7f);
    b.hold(SYNC_GAP);
    b.write(0x4011, 0x00);
    b.hold(SYNC_GAP);
  }
  b.segments.push({ id: 'sync-end', kind: 'sync', startFrame: syncEndStart, frames: b.frame - syncEndStart, startCycle: syncEndStart * NTSC_FRAME, endCycle: b.frame * NTSC_FRAME });

  b.segment('tail', 'silence', 20);
  b.hold(20);

  return { totalFrames: b.frame, writes: b.writes, segments: b.segments };
}
