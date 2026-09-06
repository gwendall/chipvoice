import {Fade} from './fade.mjs';

/** Decoded A/B recordings share one clock. Loading is independent of Play
 * intent; a failed or stale load cannot interrupt the current pair. */
export class BufferPlayback {
  constructor(context, changed = () => {}) {
    this.context = context; this.changed = changed;
    this.playing = false; this.loading = false; this.error = '';
    this.entries = []; this.buffers = []; this.levels = [];
    this.side = 0; this.volume = .7; this.generation = 0;
    this.group = null; this.retiring = null; this.offset = 0;
    this.cache = new Map(); this.disposed = false;
    this.output = context.createGain(); this.output.connect(context.destination);
    this.transition = Promise.resolve();
  }
  async select(entries, levels) {
    const ticket = ++this.generation;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    this.loading = true; this.error = ''; this.changed();
    try {
      const buffers = await Promise.all(entries.map(async entry => {
        const key = entry.file;
        if (this.cache.has(key)) { const buffer = this.cache.get(key); this.cache.delete(key); this.cache.set(key, buffer); return buffer; }
        const response = await fetch(key, {signal: abort.signal});
        if (!response.ok) throw new Error(`Audio unavailable (${response.status}). Try again.`);
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        if (ticket !== this.generation) return buffer;
        this.cache.set(key, buffer);
        while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
        return buffer;
      }));
      await this.transition;
      if (ticket !== this.generation || this.disposed) return false;
      this.entries = entries; this.buffers = buffers; this.levels = levels;
      this.side = Math.min(this.side, buffers.length - 1);
      if (this.playing) this.swap();
      this.loading = false; this.changed(); return true;
    } catch (error) {
      if (ticket === this.generation && !this.disposed) {
        this.error = error.message; this.loading = false;
        if (!this.group) this.playing = false;
        this.changed();
      }
      return false;
    }
  }
  phase(at = this.context.currentTime) {
    const group = this.group;
    return group ? ((group.offset + Math.max(0, at - group.at)) % group.duration) / group.duration : this.offset;
  }
  swap() {
    if (!this.buffers.length || this.disposed) return;
    const at = this.context.currentTime + .025;
    const phase = this.phase(at), previous = this.group;
    const duration = Math.min(...this.buffers.map(buffer => buffer.duration));
    const fade = new Fade(this.context, this.output);
    const parts = this.buffers.map((buffer, index) => {
      const source = this.context.createBufferSource();
      const level = new Fade(this.context, fade.node, index === this.side ? this.levels[index] * this.volume : 0);
      source.buffer = buffer; source.loop = true; source.loopEnd = duration;
      source.connect(level.node); source.start(at, phase * duration);
      return {source, level};
    });
    this.group = {parts, fade, at, offset: phase * duration, duration};
    fade.toValue(1, at); previous?.fade.toValue(0, at);
    if (previous) {
      this.retiring = previous;
      // Sources stop on the audio clock even when the main thread is busy.
      for (const part of previous.parts) part.source.stop(at + .06);
      this.transition = new Promise(resolve => {
        this.finishTransition = resolve;
        const cleanup = () => {
          if (!this.disposed && this.context.currentTime < at + .06) { this.timer = setTimeout(cleanup, 30); return; }
          this.release(previous); this.retiring = null; this.finishTransition = null; resolve();
        };
        this.timer = setTimeout(cleanup, 90);
      });
    }
  }
  async toggle() {
    if (this.playing) { this.pause(); return; }
    this.playing = true; this.changed();
    await this.context.resume();
    if (this.disposed || !this.playing) return;
    if (!this.group && this.buffers.length) this.swap();
  }
  pause() {
    this.playing = false; this.offset = this.phase();
    const group = this.group; this.group = null;
    if (group) {
      group.fade.toValue(0, this.context.currentTime, .025);
      for (const part of group.parts) {
        part.source.stop(this.context.currentTime + .03);
        part.source.onended = () => { part.source.disconnect(); part.level.disconnect(); group.fade.disconnect(); };
      }
    }
    this.retiring?.fade.toValue(0, this.context.currentTime, .025);
    this.changed();
  }
  setSide(side) {
    this.side = side;
    for (const [index, part] of (this.group?.parts ?? []).entries()) part.level.toValue(index === side ? this.levels[index] * this.volume : 0, this.context.currentTime, .015);
    this.changed();
  }
  setVolume(value) { this.volume = value; this.setSide(this.side); }
  release(group) {
    for (const part of group.parts) { try { part.source.stop(); } catch {} part.source.disconnect(); part.level.disconnect(); }
    group.fade.disconnect();
  }
  dispose() {
    this.disposed = true; this.playing = false; this.generation++; this.abort?.abort();
    clearTimeout(this.timer); this.finishTransition?.();
    if (this.group) this.release(this.group);
    if (this.retiring) this.release(this.retiring);
    this.group = this.retiring = null; this.cache.clear(); this.output.disconnect();
  }
}
