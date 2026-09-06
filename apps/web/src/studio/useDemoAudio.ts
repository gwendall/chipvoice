'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip, instrumentsFor, type Role } from 'chipvoice';
import { effectFor, type EffectId } from './effects';
import { musicSong, type SongDocument } from './document';
import { measure } from './metrics';
import { LivePlayback } from '../audio/LivePlayback';

export function useDemoAudio(song: SongDocument, muted: Role[], recording = false) {
  const current = useRef<Chip | null>(null);
  const playback = useRef<LivePlayback | null>(null);
  const latest = useRef({ song, muted });
  latest.current = { song, muted };
  const mounted = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState<{ step: number; orderIndex: number } | null>(null);
  const [stolen, setStolen] = useState<string[]>([]);
  const [output, setOutput] = useState<AudioNode | null>(null);
  const [effect, setEffect] = useState<{ id: EffectId; at: number } | null>(null);
  const session = useCallback(() => {
    if (!playback.current) {
      const player = new LivePlayback(new AudioContext(), () => {
        if (!mounted.current) return;
        current.current = player.current;
        setPlaying(player.playing); setLoading(player.loading); setError(player.error);
        (window as unknown as { chipvoice?: Chip }).chipvoice = player.current ?? undefined;
      });
      playback.current = player; setOutput(player.output);
    }
    return playback.current;
  }, []);
  const ensure = useCallback(async () => {
    const player = session(); await player.context.resume();
    const chip = await player.update(musicSong(latest.current.song, latest.current.muted));
    player.audition(); return chip;
  }, [session]);
  const start = useCallback(async () => {
    const chip = await session().start(musicSong(latest.current.song, latest.current.muted));
    measure('play'); return chip;
  }, [session]);
  const toggle = useCallback(async () => {
    if (playback.current?.playing) playback.current.stop();
    else await start();
  }, [start]);
  useEffect(() => {
    if (recording || !playback.current) return;
    // Coalesce slider/keyboard bursts before preparing an incoming engine.
    const timer = setTimeout(() => { void playback.current?.update(musicSong(song, muted)); }, 45);
    return () => clearTimeout(timer);
  }, [song, muted, recording]);

  const fire = useCallback(async (id: EffectId) => {
    const chip = await ensure();
    if (!chip) return;
    const { role, options } = effectFor(id, latest.current.song);
    chip.sfx(chip.spec.roles[role], options);
    setEffect({ id, at: performance.now() }); measure('effect');
  }, [ensure]);
  const preview = useCallback(async (role: Role, note: string) => {
    const chip = await ensure();
    if (!chip) return;
    const instruments = instrumentsFor(chip.spec.id, latest.current.song.intent);
    const options = role === 'perc' ? instruments.perc[note as 'K' | 'S' | 'H' | 'O'] : { note, instrument: instruments[role], duration: 0.22 };
    if (options) chip.sfx(chip.spec.roles[role], options);
  }, [ensure]);
  const recordingPosition = useCallback(() => {
    const chip = current.current;
    return chip?.audioContext.state === 'running' ? chip.quantizedPosition() : null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const player = playback.current; playback.current = null; current.current = null;
      player?.dispose(); void player?.context.close();
    };
  }, []);

  useEffect(() => {
    if (!output) return; // Nothing to poll before the first explicit audio start.
    let raf = 0;
    const scratch = { step: 0, orderIndex: 0 };
    let lastStep = -1, lastOrder = -1, lastBusy = 0;
    let lastChip: Chip | null = null;
    const tick = () => {
      const chip = current.current;
      const pos = chip?.position(scratch) ?? null;
      const step = pos?.step ?? -1, order = pos?.orderIndex ?? -1;
      if (step !== lastStep || order !== lastOrder) {
        lastStep = step; lastOrder = order;
        // React owns this snapshot; never hand it the mutable polling buffer.
        setPosition(pos ? { step, orderIndex: order } : null);
      }
      let busy = 0;
      // The five demo machines have at most ten voices.
      if (chip) for (let i = 0; i < chip.spec.voices.length; i++) {
        if (!chip.canPlay(chip.spec.voices[i].id)) busy |= 1 << i;
      }
      if (busy !== lastBusy || chip !== lastChip) {
        const voices: string[] = [];
        if (chip) for (let i = 0; i < chip.spec.voices.length; i++) if (busy & (1 << i)) voices.push(chip.spec.voices[i].id);
        lastBusy = busy; lastChip = chip; setStolen(voices);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [output]);
  return { playing, loading, error, position, stolen, output, effect, toggle, start, fire, preview, recordingPosition };
}
