import {Fade} from './fade.mjs';
import {outputTime} from './output-clock.mjs';

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
    this.loop = true; this.pendingPhase = null; this.timeline = [];
  }
  async select(entries, levels, {restart = false} = {}) {
    const ticket = ++this.generation;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    this.loading = true; this.error = ''; this.changed();
    try {
      const buffers = await Promise.all(entries.map(async entry => {
        const key = entry.loopFadeSeconds ? `${entry.file}|${entry.loopStartSeconds??0}|${entry.loopFadeSeconds}` : entry.file;
        if (this.cache.has(key)) { const buffer = this.cache.get(key); this.cache.delete(key); this.cache.set(key, buffer); return buffer; }
        const response = await fetch(entry.file, {signal: abort.signal});
        if (!response.ok) throw new Error(`Audio unavailable (${response.status}). Try again.`);
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        // Optional playback-only seam taper. Downloads and offline reference
        // PCM stay untouched; short fades avoid an arbitrary waveform jump.
        if (entry.loopFadeSeconds) {
          const start = Math.max(0,Math.round((entry.loopStartSeconds??0)*buffer.sampleRate));
          const size = Math.max(0,Math.min(Math.round(entry.loopFadeSeconds*buffer.sampleRate),Math.floor((buffer.length-start)/2)));
          for(let channel=0;channel<buffer.numberOfChannels;channel++){
            const samples=buffer.getChannelData(channel);
            for(let i=0;i<size;i++){const gain=size>1?i/(size-1):0;samples[start+i]*=gain;samples[buffer.length-1-i]*=gain;}
          }
        }
        if (ticket !== this.generation) return buffer;
        this.cache.set(key, buffer);
        while (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
        return buffer;
      }));
      while (this.retiring) await this.transition;
      if (ticket !== this.generation || this.disposed) return false;
      this.entries = entries; this.buffers = buffers; this.levels = levels;
      this.side = Math.min(this.side, buffers.length - 1);
      if (restart) this.offset = 0;
      if (this.playing) this.swap(restart ? 0 : undefined);
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
  /** Invalidate a pending decode immediately while keeping the current music.
   * Call when preparing a replacement that is not ready to select yet. */
  cancelSelection() {
    this.generation++;this.abort?.abort();this.loading=false;this.changed();
  }
  phase(at = outputTime(this.context)) {
    let group = this.group;
    if (!group) return this.offset;
    if (at < group.at) {
      for (let i=this.timeline.length-1;i>=0;i--) if (this.timeline[i].at<=at) {group=this.timeline[i];break;}
    }
    let position = group.offset + Math.max(0, at - group.at);
    if (position >= group.duration) position = group.loop ? group.loopStart + (position - group.loopStart) % (group.duration - group.loopStart) : group.duration;
    return position / group.duration;
  }
  seek(phase) {
    if (!Number.isFinite(phase) || this.disposed) return;
    const next = Math.max(0, Math.min(1, phase));
    this.offset = next;
    if (this.playing) this.swap(next);
    this.changed();
  }
  restart() { this.seek(0); }
  setLoop(loop) {
    this.loop = loop;
    if (this.group) {
      if (this.group.ended && loop) { this.swap(this.group.loopStart/this.group.duration); this.changed(); return; }
      this.group.loop = loop;
      if(this.timeline.length)this.timeline[this.timeline.length-1].loop=loop;
      for (const part of this.group.parts) part.source.loop = loop;
    }
    this.changed();
  }
  swap(requestedPhase) {
    if (!this.buffers.length || this.disposed) return;
    if (this.retiring) { this.pendingPhase = requestedPhase ?? this.phase(this.context.currentTime); return; }
    clearTimeout(this.endTimer);
    const at = this.context.currentTime + .025;
    const phase = requestedPhase ?? this.phase(at), previous = this.group;
    const duration = Math.min(...this.buffers.map(buffer => buffer.duration));
    const loopStart = Math.max(0, Math.min(duration - .001, this.entries[0]?.loopStartSeconds ?? 0));
    const fade = new Fade(this.context, this.output);
    const parts = this.buffers.map((buffer, index) => {
      const source = this.context.createBufferSource();
      const level = new Fade(this.context, fade.node, index === this.side ? this.levels[index] * this.volume : 0);
      source.buffer = buffer; source.loop = this.loop; source.loopStart = loopStart; source.loopEnd = duration;
      source.connect(level.node); source.start(at, phase * duration);
      return {source, level};
    });
    const group = {parts, fade, at, offset: phase * duration, duration, loopStart, loop: this.loop, ended:false};
    this.group = group;
    this.timeline.push({at,offset:phase*duration,duration,loopStart,loop:this.loop});
    const audible=outputTime(this.context);
    while(this.timeline.length>1&&this.timeline[1].at<=audible)this.timeline.shift();
    if(this.timeline.length>64)this.timeline.shift();
    parts[0].source.onended = () => {
      group.ended = true;
      const finish = () => {
        if (this.disposed || this.group !== group || group.loop) return;
        if (this.phase() < 1) { this.endTimer = setTimeout(finish, 20); return; }
        this.offset = 1; this.playing = false; this.group = null;
        this.release(group); this.changed();
      };
      finish();
    };
    fade.toValue(1, at); previous?.fade.toValue(0, at);
    if (previous) {
      this.retiring = previous;
      // Sources stop on the audio clock even when the main thread is busy.
      for (const part of previous.parts) part.source.stop(at + .06);
      this.transition = new Promise(resolve => {
        this.finishTransition = resolve;
        const cleanup = () => {
          if (!this.disposed && this.context.currentTime < at + .06) { this.timer = setTimeout(cleanup, 30); return; }
          this.release(previous); this.retiring = null; this.finishTransition = null;
          const pending = this.pendingPhase; this.pendingPhase = null;
          if (pending !== null && this.playing) this.swap(pending);
          resolve();
        };
        this.timer = setTimeout(cleanup, 90);
      });
    }
  }
  async toggle() {
    if (this.playing) { this.pause(); return; }
    this.playing = true; this.changed();
    if (this.offset >= 1) this.offset = 0;
    await this.context.resume();
    if (this.disposed || !this.playing) return;
    if (!this.group && this.buffers.length) this.swap();
  }
  pause() {
    this.playing = false; this.offset = this.phase();
    this.pendingPhase = null; this.timeline.length=0; clearTimeout(this.endTimer);
    const group = this.group; this.group = null;
    if (group) {
      group.fade.toValue(0, this.context.currentTime, .025);
      for (const part of group.parts) part.source.stop(this.context.currentTime + .03);
      if (!this.retiring) {
        this.retiring = group;
        this.transition = new Promise(resolve => {
          this.finishTransition = resolve;
          group.parts[0].source.onended = () => {
            this.release(group); this.retiring = null; this.finishTransition = null;
            const pending=this.pendingPhase;this.pendingPhase=null;
            if(!this.disposed&&this.playing&&pending!==null)this.swap(pending);
            resolve();
          };
        });
      } else group.parts[0].source.onended=()=>this.release(group);
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
    clearTimeout(this.endTimer); this.pendingPhase = null;
    if (this.group) this.release(this.group);
    if (this.retiring) this.release(this.retiring);
    this.group = this.retiring = null; this.cache.clear(); this.output.disconnect();
  }
}
