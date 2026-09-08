/** One tab, one foreground transport. Route owners may detach without destroying
 * the selected recording. An incoming source stays muted until it is ready;
 * cancellation and failures leave the previous source available. */
export type TrackInfo = { title: string; href: string; chip?: string; creator?: string;
  profileId?: string; avatar?: {palette: number; variant: number} | null; download?: string; blind?: boolean; translateTitle?: boolean };
export type Playback = {
  key: string;
  info(): TrackInfo;
  playing(): boolean;
  loading(): boolean;
  error(): string;
  duration(): number;
  position(): number;
  ready(): boolean;
  ended?(): boolean;
  play(): void | Promise<unknown>;
  pause(): void;
  seek?(seconds: number): void;
  restart(): void;
  loop?(): boolean;
  setLoop?(value: boolean): void;
  volume(value: number): void;
  dispose(): void;
};
export type QueueTrack = {id: string; title: string};
type Entry = { player: Playback; attached: boolean };
export class PlaybackSession {
  private entries = new Map<Playback, Entry>();
  active: Playback | null = null;
  pending: Playback | null = null;
  volume = .8;
  error = '';
  queue: QueueTrack[] = [];
  queueIndex = -1;
  private advance?: (track: QueueTrack) => void;
  private listeners = new Set<() => void>();
  private revision = 0;
  private signature = '';
  private ended = false;
  private intent = 0;
  private retiring: Playback | null = null;
  private retirement?: ReturnType<typeof setTimeout>;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  serverSnapshot = () => 0;
  private emit() { this.revision++; for (const listener of this.listeners) listener(); }
  attach(player: Playback) { this.entries.set(player, {player, attached: true}); player.volume(0); }
  /** Detachment cancels unfinished work, but the audible recording survives. */
  release(player: Playback) {
    const entry = this.entries.get(player); if (!entry) return;
    entry.attached = false;
    if (this.pending === player) { this.intent++;this.pending = null; player.pause(); }
    if (this.active !== player) this.destroy(player);
    this.refresh();
  }
  private destroy(player: Playback) { this.entries.delete(player); player.dispose(); }
  private retire(player: Playback) {
    this.entries.delete(player);
    if(this.retiring) { clearTimeout(this.retirement); this.retiring.dispose(); }
    this.retiring = player;
    this.retirement = setTimeout(()=>{ player.dispose(); this.retiring=null; },60);
  }
  request(player: Playback) {
    if (!this.entries.has(player)) return -1;
    if(this.pending ? this.pending!==player : this.active!==player) this.intent++;
    this.error = '';
    if (this.pending && this.pending !== player) {
      const old = this.pending; this.pending = null; old.pause(); old.volume(0);
      if (!this.entries.get(old)?.attached) this.destroy(old);
    }
    if (this.active !== player) { this.pending = player; player.volume(0); }
    this.emit();return this.intent;
  }
  audition(player: Playback, intent: number) {
    if(intent !== this.intent || !this.entries.has(player) || (this.pending!==player && this.active!==player)) return false;
    const old = this.active; this.pending = null; this.active = player;
    if (old !== player) { old?.pause(); old?.volume(0); if(old && !this.entries.get(old)?.attached) this.destroy(old); }
    player.volume(this.volume); this.clearQueue(); this.refresh();return true;
  }
  async play(player: Playback) {
    this.request(player);
    try { await player.play(); } catch { this.fail(player, 'Audio could not start. Try Play again.'); }
    this.refresh();
  }
  pause(player = this.pending ?? this.active) {
    this.intent++;
    // Pausing the persistent controls during a replacement cancels that start
    // and pauses the old recording too. No late promise may resume either.
    if (player === this.pending) { this.pending = null; player?.pause(); if(!this.active && player) { this.active=player;player.volume(this.volume); } this.active?.pause(); }
    else player?.pause();
    this.refresh();
  }
  toggle(player = this.pending ?? this.active) {
    if (!player) return;
    if (player.playing()) this.pause(player); else void this.play(player);
  }
  private fail(player: Playback, message: string) {
    if(this.pending !== player && this.active !== player) return;
    this.error = message;
    if (this.pending === player) { this.pending = null; player.pause(); player.volume(0); }
    this.emit();
  }
  setVolume(value: number) { this.volume = Math.min(1, Math.max(0, value)); this.active?.volume(this.volume); this.emit(); }
  setQueue(tracks: QueueTrack[], id: string, play: (track: QueueTrack) => void) {
    this.queue = tracks.slice(); this.queueIndex = tracks.findIndex(t => t.id === id); this.advance = play; this.emit();
  }
  clearQueue() { this.queue = []; this.queueIndex = -1; this.advance = undefined; }
  next(delta = 1) {
    const index = this.queueIndex + delta;
    if (index < 0 || index >= this.queue.length || !this.advance) return;
    this.queueIndex = index; this.advance(this.queue[index]); this.emit();
  }
  refresh() {
    const next = this.pending;
    if (next?.error()) this.fail(next, next.error());
    else if (next?.playing() && next.ready() && !next.loading()) {
      const old = this.active;
      this.pending = null; this.active = next; this.ended = false;
      old?.pause(); old?.volume(0);
      next.volume(this.volume);
      if (!next.key.startsWith('publication:')) this.clearQueue();
      if (old && old !== next && !this.entries.get(old)?.attached) this.retire(old);
    }
    const active = this.active;
    if (active?.ended?.() && !this.ended && !active.loop?.() && !this.pending) { this.ended = true; this.next(); }
    if (active?.playing()) this.ended = false;
    const signature = JSON.stringify([active?.key, active?.info(), active?.playing(), active?.loading(), active?.error(), active?.duration(), active?.loop?.(), this.pending?.key, this.pending?.info(), this.pending?.playing(), this.pending?.loading(), this.error]);
    if (signature !== this.signature) { this.signature = signature; this.emit(); }
  }
  dispose() {
    clearTimeout(this.retirement);this.retiring?.dispose();this.retiring=null;
    for (const player of this.entries.keys()) player.dispose();
    this.entries.clear(); this.active = this.pending = null; this.clearQueue(); this.error = ''; this.emit();
  }
}
export const playbackSession = new PlaybackSession();
const adapters = new WeakMap<object, Playback>();
export function registerPlayback(engine: object, player: Playback) {
  adapters.set(engine, player); playbackSession.attach(player); return player;
}
export const playbackFor = (engine: object | null | undefined) => engine ? adapters.get(engine) ?? null : null;
export function releasePlayback(engine: object | null | undefined) { const p = playbackFor(engine); if (p) playbackSession.release(p); }
