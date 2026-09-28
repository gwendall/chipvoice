/**
 * A minimal Web Audio double: just enough of AudioContext/AudioBufferSourceNode/
 * GainNode/AudioParam for src/runtime.ts to run its real logic (round-robin,
 * jitter, cooldown, voice cap, priority stealing, ducking, unlock) with no
 * browser and no real audio - src/runtime.ts's own header comment names this
 * file as the point of keeping its browser surface this small. `currentTime`
 * is a plain mutable property a test advances by hand, so cooldown and fade
 * timing are exact and instant rather than raced against a real clock.
 */

export class FakeAudioParam {
  constructor(value = 1) {
    this.value = value;
    this.calls = [];
  }
  setValueAtTime(value, time) {
    this.value = value;
    this.calls.push(["setValueAtTime", value, time]);
    return this;
  }
  linearRampToValueAtTime(value, time) {
    this.calls.push(["linearRampToValueAtTime", value, time]);
    // Applied "eagerly": tests read the ramp's final target off .value
    // right after scheduling it, rather than simulating a clock.
    this.value = value;
    return this;
  }
  cancelScheduledValues(time) {
    this.calls.push(["cancelScheduledValues", time]);
    return this;
  }
}

class FakeAudioNode {
  constructor(context) {
    this.context = context;
    this.connections = [];
  }
  connect(destination) {
    this.connections.push(destination);
    return destination;
  }
  disconnect() {
    this.connections = [];
  }
}

export class FakeGainNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.gain = new FakeAudioParam(1);
  }
}

export class FakeStereoPannerNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.pan = new FakeAudioParam(0);
  }
}

export class FakeBufferSourceNode extends FakeAudioNode {
  constructor(context) {
    super(context);
    this.buffer = null;
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.playbackRate = new FakeAudioParam(1);
    this.onended = null;
    this.startCalls = [];
    this.stopCalls = [];
    this.stopped = false;
    context.sources.push(this);
  }
  start(when = 0) {
    this.startCalls.push(when);
  }
  stop(when = 0) {
    this.stopCalls.push(when);
    this.stopped = true;
  }
  /** Not a real Web Audio method: the test's way of simulating natural
   * end-of-playback, since nothing here actually schedules audio. */
  fireEnded() {
    this.onended?.();
  }
}

export class FakeAudioBuffer {
  constructor({ duration = 1, sampleRate = 44100 } = {}) {
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.length = Math.round(duration * sampleRate);
    this.numberOfChannels = 1;
  }
}

export class FakeAudioContext {
  constructor({ hasStereoPanner = true, hasCreateBuffer = true } = {}) {
    this.currentTime = 0;
    this.state = "running";
    this.sampleRate = 44100;
    this.destination = new FakeAudioNode(this);
    this.sources = [];
    this.resumeCalls = 0;
    if (!hasStereoPanner) this.createStereoPanner = undefined;
    if (!hasCreateBuffer) this.createBuffer = undefined;
  }
  createGain() {
    return new FakeGainNode(this);
  }
  createBufferSource() {
    return new FakeBufferSourceNode(this);
  }
  createStereoPanner() {
    return new FakeStereoPannerNode(this);
  }
  createBuffer(channels, length, sampleRate) {
    return new FakeAudioBuffer({ duration: length / sampleRate, sampleRate });
  }
  /** Ignores the bytes and hands back a fresh fake buffer - what bytes decode
   * to is never what these tests are about. */
  async decodeAudioData(_bytes) {
    return new FakeAudioBuffer();
  }
  resume() {
    this.resumeCalls++;
    this.state = "running";
    return Promise.resolve();
  }
}

/** A `fetch` double that answers any URL with an empty "ok" response, so
 * `decode()` in runtime.ts has something to call `.arrayBuffer()` on. */
export function fakeFetch() {
  return async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
}
