'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip, instrumentsFor, type Role } from 'chipvoice';
import { effectFor, type EffectId } from './effects';
import { musicSong, type SongDocument } from './document';
import { measure } from './metrics';

export function useDemoAudio(song: SongDocument, muted: Role[]) {
  const current = useRef<Chip | null>(null);
  const context = useRef<AudioContext | null>(null);
  const creating = useRef<{ id: string; token: number; promise: Promise<Chip | null> } | null>(null);
  const generation = useRef(0);
  const latest = useRef({ song, muted });
  latest.current = { song, muted };
  const wantPlay = useRef(false);
  const mounted = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState<{ step: number; orderIndex: number } | null>(null);
  const [stolen, setStolen] = useState<string[]>([]);
  const [output, setOutput] = useState<AudioNode | null>(null);
  const [effect, setEffect] = useState<{ id: EffectId; at: number } | null>(null);

  const ensure = useCallback(async (): Promise<Chip | null> => {
    const id = latest.current.song.chip;
    if (current.current?.spec.id === id) {
      if (creating.current) { generation.current++; creating.current = null; setLoading(false); }
      const active = current.current;
      await active.resume();
      return mounted.current && current.current === active ? active : null;
    }
    if (creating.current?.id === id) return creating.current.promise;
    const token = ++generation.current;
    setLoading(true); setError('');
    const promise = (async () => {
      try {
        context.current ??= new AudioContext();
        await context.current.resume();
        const built = await Chip.create({ chip: id, context: context.current });
        if (!built) throw new Error('This browser cannot start AudioWorklet. Try a current browser over HTTPS.');
        if (!mounted.current || token !== generation.current || latest.current.song.chip !== id) { built.dispose(); return null; }
        const previous = current.current;
        const pos = previous?.position() ?? undefined;
        previous?.dispose();
        current.current = built;
        setOutput(built.output);
        (window as unknown as { chipvoice?: Chip }).chipvoice = built;
        if (wantPlay.current) built.play(musicSong(latest.current.song, latest.current.muted), pos);
        return built;
      } catch (e) {
        if (mounted.current && token === generation.current) { setError(e instanceof Error ? e.message : 'Audio could not start. Try Play again.'); wantPlay.current = false; }
        return null;
      } finally {
        if (creating.current?.token === token) { creating.current = null; if (mounted.current) setLoading(false); }
      }
    })();
    creating.current = { id, token, promise };
    return promise;
  }, []);

  const toggle = useCallback(async () => {
    wantPlay.current = !wantPlay.current;
    if (!wantPlay.current) { current.current?.stop(); setPlaying(false); return; }
    const chip = await ensure();
    if (chip && wantPlay.current && !chip.playing) chip.play(musicSong(latest.current.song, latest.current.muted));
    if (chip && wantPlay.current) { setPlaying(true); measure('play'); }
  }, [ensure]);

  useEffect(() => {
    if (!current.current && !creating.current) return;
    if (current.current?.spec.id !== song.chip) { void ensure(); return; }
    const chip = current.current;
    if (wantPlay.current && chip) {
      const next = musicSong(song, muted);
      if (next.id !== chip.songId) {
        const pos = chip.position() ?? undefined;
        chip.stop(); chip.play(next, pos);
      }
    }
  }, [song, muted, ensure]);

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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; generation.current++; creating.current = null;
      current.current?.dispose(); current.current = null;
      void context.current?.close(); context.current = null;
    };
  }, []);

  useEffect(() => {
    if (!output) return; // Nothing to poll before the first explicit audio start.
    let raf = 0;
    const scratch = { step: 0, orderIndex: 0 };
    let lastStep = -1, lastOrder = -1, lastBusy = 0, lastPlaying = false;
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
      const isPlaying = chip?.playing ?? false;
      if (isPlaying !== lastPlaying) { lastPlaying = isPlaying; setPlaying(isPlaying); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [output]);
  return { playing, loading, error, position, stolen, output, effect, toggle, fire, preview };
}
