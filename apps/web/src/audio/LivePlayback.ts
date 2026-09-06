import {Chip, type Song} from 'chipvoice';
import {Fade} from './fade.mjs';

type Engine = {chip: Chip; fade: Fade};
/** Keeps ownership, async creation and overlap behind one playback interface.
 * Only the current engine and one incoming engine can exist. Edits during a
 * transition replace the pending score, never accumulate additional engines. */
export class LivePlayback {
  readonly output: GainNode;
  current: Chip | null = null;
  playing = false;
  loading = false;
  error = '';
  private active: Engine | null = null;
  private incoming: Engine | null = null;
  private song: Song | null = null;
  private running: Promise<Chip | null> | null = null;
  private disposed = false;
  private wake: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly context: AudioContext, private changed: () => void) {
    this.output = context.createGain();
    this.output.connect(context.destination);
  }
  update(song: Song) { this.song = song; return this.sync(); }
  async start(song: Song) {
    this.song = song; this.playing = true; this.error = ''; this.changed();
    await this.context.resume();
    return this.sync();
  }
  audition() { if (!this.playing) this.active?.fade.toValue(1, this.context.currentTime, .01); }
  stop() {
    this.playing = false;
    const at = this.context.currentTime;
    this.active?.fade.toValue(0, at, .025);
    this.incoming?.fade.toValue(0, at, .025);
    // Cancel scheduled musical events immediately; the chip's release plus
    // output fade removes the hard disconnect. Stop wins over pending creation.
    this.active?.chip.stop(); this.incoming?.chip.stop();
    this.changed();
  }
  private sync(): Promise<Chip | null> {
    if (this.running) return this.running;
    this.running = this.reconcile().finally(() => { this.running = null; });
    return this.running;
  }
  private async reconcile(): Promise<Chip | null> {
    while (!this.disposed && this.song) {
      const song = this.song;
      const active = this.active;
      if (active && active.chip.spec.id === song.chip && (!this.playing || active.chip.songId === song.id)) {
        if (this.playing && !active.chip.playing) {
          active.chip.play(song); active.fade.toValue(1);
        }
        return active.chip;
      }
      this.loading = true; this.changed();
      let chip: Chip | null = null;
      try {
        chip = await Chip.create({chip: song.chip, context: this.context});
        if (!chip) throw new Error('This browser cannot start AudioWorklet. Try a current browser over HTTPS.');
        if (this.disposed || this.song?.chip !== song.chip) { chip.dispose(); continue; }
        const fade = new Fade(this.context, this.output);
        chip.output.disconnect(); chip.output.connect(fade.node);
        const next = {chip, fade}; this.incoming = next;
        const previous = this.active;
        if (this.playing) {
          const at = this.context.currentTime + .1;
          const phase = previous?.chip.phaseAt(at) ?? previous?.chip.phaseAt() ?? undefined;
          chip.play(this.song!, phase, at);
          // Allow the new chip's note-on to reach its DSP before releasing the
          // old signal. Both remain on the same AudioContext clock.
          fade.toValue(1, at + .025);
          previous?.fade.toValue(0, at + .025);
          await this.until(at + .085);
        }
        if (this.disposed) return null;
        if (!this.playing) fade.toValue(0);
        this.active = next; this.incoming = null; this.current = chip;
        previous?.chip.dispose(); previous?.fade.disconnect();
        this.loading = false; this.changed();
        if (!this.playing) return chip;
      } catch (error) {
        chip?.dispose(); this.incoming?.fade.disconnect(); this.incoming = null;
        if (!this.disposed) {
          this.error = error instanceof Error ? error.message : 'Audio could not start.';
          this.loading = false;
          // A failed replacement keeps the working engine and Play intent.
          if (!this.active) this.playing = false;
          this.changed();
        }
        return this.current;
      }
    }
    return null;
  }
  private until(at: number) {
    return new Promise<void>(resolve => {
      this.wake = resolve;
      const poll = () => {
        if (this.disposed || this.context.currentTime >= at) { this.timer = null; this.wake = null; resolve(); }
        else this.timer = setTimeout(poll, Math.max(10, (at - this.context.currentTime) * 1000));
      };
      poll();
    });
  }
  dispose() {
    this.disposed = true; this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.wake?.(); this.wake = null;
    this.active?.chip.dispose(); this.active?.fade.disconnect();
    this.incoming?.chip.dispose(); this.incoming?.fade.disconnect();
    this.active = this.incoming = null; this.current = null;
    this.output.disconnect();
  }
}
