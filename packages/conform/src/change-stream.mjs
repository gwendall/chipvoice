/**
 * The change stream: the value of every voice on every cycle, but only where
 * it changed, held as parallel typed arrays rather than one JS object per
 * change.
 *
 * A single dense log - a sawtooth or a triangle at an audible pitch changes
 * its bits on nearly every cycle - can hold tens of millions of changes per
 * voice, and the harness keeps two of these per log (ours and the oracle's).
 * An array of `{ cycle, voice, value }` objects costs a pointer plus an
 * object header per change on top of the three numbers it carries, and
 * `compare.mjs`'s `bestShift` used to key a `Map` on a template string built
 * from each one - both scale with the corpus, not with a constant, which is
 * what ran three seconds of three sawtoothed voices out of memory (P7-11).
 * This is the fix: three columns, no boxing, no per-change allocation.
 *
 * `cycle` is `Float64Array`: a double holds every integer up to 2^53 exactly,
 * comfortably past any clock's cycle count a log will reach (the Mega
 * Drive's 53.7 MHz clock is the fastest here, and even an hour of it is
 * three orders of magnitude short of that ceiling), where `Int32Array` would
 * wrap at 2^31. `voice` is `Uint8Array`: chips top out at a handful of
 * voices. `value` is `Int32Array`: every digital value in the harness, waveform
 * outputs, envelope counters, FM channel levels, DSP samples, fits in 32 bits
 * signed.
 *
 * This is the preferred interface for anything that produces or consumes a
 * change stream from here on: a chip wrapper pushes straight into one from
 * its `chip.trace(cycles, cb)` callback instead of collecting objects first,
 * and an oracle wrapper builds one from its subprocess's stdout as the bytes
 * arrive (`traceProcess`) instead of splitting one giant buffered string.
 * The older `{ cycle, voice, value }[]` shape - what a `trace()` not yet
 * ported to this module still returns - keeps working at the boundary:
 * `ChangeStream.from` accepts either and `cli.mjs` calls it on both sides of
 * every comparison, so a chip or oracle wrapper written against the old
 * shape needs no changes to keep passing.
 */

import { spawn } from 'node:child_process';

const INITIAL_CAPACITY = 1024;

export class ChangeStream {
  constructor(capacity = INITIAL_CAPACITY) {
    this.cycle = new Float64Array(Math.max(1, capacity));
    this.voice = new Uint8Array(Math.max(1, capacity));
    this.value = new Int32Array(Math.max(1, capacity));
    this.length = 0;
  }

  /** Appends one change, growing the backing arrays (doubling) if they are full. */
  push(cycle, voice, value) {
    if (this.length === this.cycle.length) this.grow();
    this.cycle[this.length] = cycle;
    this.voice[this.length] = voice;
    this.value[this.length] = value;
    this.length++;
  }

  grow() {
    const capacity = this.cycle.length * 2;
    const cycle = new Float64Array(capacity);
    cycle.set(this.cycle);
    this.cycle = cycle;
    const voice = new Uint8Array(capacity);
    voice.set(this.voice);
    this.voice = voice;
    const value = new Int32Array(capacity);
    value.set(this.value);
    this.value = value;
  }

  /**
   * Accepts either shape - a `ChangeStream` already, or the older
   * `{ cycle, voice, value }[]` a `trace()` not yet ported to this module
   * still returns - and always hands back a `ChangeStream`. A no-op copy
   * when it is already one.
   */
  static from(changes) {
    if (changes instanceof ChangeStream) return changes;
    const stream = new ChangeStream(changes.length || INITIAL_CAPACITY);
    for (const c of changes) stream.push(c.cycle, c.voice, c.value);
    return stream;
  }
}

/**
 * Splits a stream's entries for a set of voices into one compact
 * `{ cycle, value, length }` column pair per voice, in a single pass over
 * the data regardless of how many voices are asked for - the naive
 * `voices.map((v) => stream.filter(...))` costs one full pass per voice.
 *
 * @param {ChangeStream} stream
 * @param {number[]} voices
 * @returns {Map<number, { cycle: Float64Array, value: Int32Array, length: number }>}
 */
export function splitByVoice(stream, voices) {
  const counts = new Map();
  for (const v of voices) counts.set(v, 0);
  for (let i = 0; i < stream.length; i++) {
    const v = stream.voice[i];
    if (counts.has(v)) counts.set(v, counts.get(v) + 1);
  }
  const columns = new Map();
  const fill = new Map();
  for (const v of voices) {
    const n = counts.get(v);
    columns.set(v, { cycle: new Float64Array(n), value: new Int32Array(n), length: n });
    fill.set(v, 0);
  }
  for (let i = 0; i < stream.length; i++) {
    const v = stream.voice[i];
    const col = columns.get(v);
    if (!col) continue;
    const j = fill.get(v);
    col.cycle[j] = stream.cycle[i];
    col.value[j] = stream.value[i];
    fill.set(v, j + 1);
  }
  return columns;
}

/**
 * Runs a compiled oracle and turns its stdout into a change stream without
 * holding the whole run in memory twice over: `spawn`, not `spawnSync` with
 * a gigabyte `maxBuffer`, and each line parsed as its chunk arrives rather
 * than off one `split('\n')` of the entire buffered text. The wire format is
 * unchanged - `<cycle> <voice> <value>` in cycle order, one line per change,
 * the same text every oracle already prints - only how the Node side reads
 * it is different.
 *
 * @param {string} binary
 * @param {string[]} args
 * @param {string} input written to the child's stdin, then closed
 * @returns {Promise<ChangeStream>}
 */
export function traceProcess(binary, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    const stream = new ChangeStream();
    let carry = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      carry += chunk;
      let start = 0;
      let nl;
      while ((nl = carry.indexOf('\n', start)) >= 0) {
        pushLine(stream, carry, start, nl);
        start = nl + 1;
      }
      carry = start > 0 ? carry.slice(start) : carry;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (carry.trim().length > 0) pushLine(stream, carry, 0, carry.length);
      if (code !== 0) { reject(new Error(`the oracle failed: ${stderr}`)); return; }
      resolve(stream);
    });
    // A child that exits before reading all of stdin closes the pipe under
    // us; that is reported through its exit code above, not through this.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** One `<cycle> <voice> <value>` line, pushed straight into the stream: no intermediate array or object. */
function pushLine(stream, text, start, end) {
  if (end <= start) return;
  const sp1 = text.indexOf(' ', start);
  if (sp1 < 0 || sp1 >= end) return;
  const sp2 = text.indexOf(' ', sp1 + 1);
  if (sp2 < 0 || sp2 >= end) return;
  const cycle = Number(text.slice(start, sp1));
  const voice = Number(text.slice(sp1 + 1, sp2));
  const value = Number(text.slice(sp2 + 1, end));
  stream.push(cycle, voice, value);
}
