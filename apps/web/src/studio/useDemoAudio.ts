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
    let raf = 0;
    let last = '';
    const tick = () => {
      const chip = current.current;
      const pos = chip?.position() ?? null;
      const busy = chip?.spec.voices.filter(v => !chip.canPlay(v.id)).map(v => v.id) ?? [];
      const key = JSON.stringify([pos, busy, chip?.playing]);
      if (key !== last) { last = key; setPosition(pos); setStolen(busy); setPlaying(chip?.playing ?? false); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      mounted.current = false; generation.current++; creating.current = null; cancelAnimationFrame(raf);
      current.current?.dispose(); current.current = null;
      void context.current?.close(); context.current = null;
    };
  }, []);
  return { playing, loading, error, position, stolen, output, effect, toggle, fire, preview };
}
