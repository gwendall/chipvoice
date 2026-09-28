"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * The player: Web Audio, not `<audio>` (spec: "a trigger after load starts
 * in under 10 ms"). One shared `AudioContext`, decoded buffers cached by
 * URL so replaying a sound never re-fetches or re-decodes it, and the
 * ogg -> mp3 fallback keyed on `decodeAudioData` actually rejecting (not on
 * `canPlayType`, whose answer for ogg is unreliable across browsers - see
 * docs/DECISIONS.md). iOS needs the context created or resumed inside a
 * user gesture, which `play()` always runs inside, so no separate "unlock"
 * step is needed before the first tap.
 */
interface PlayState {
  soundId: string | null;
  variant: number | null;
}

interface PlayerContextValue {
  playing: PlayState;
  /** Plays one variant of a sound; returns once the source has started
   * (not once it finishes), so a caller can show "now playing" state. */
  play: (soundId: string, files: { ogg: string; mp3: string }, variant: number) => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

function getAudioContext(ref: { current: AudioContext | null }): AudioContext {
  if (!ref.current) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ref.current = new Ctor();
  }
  if (ref.current.state === "suspended") void ref.current.resume();
  return ref.current;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const contextRef = useRef<AudioContext | null>(null);
  const bufferCache = useRef(new Map<string, Promise<AudioBuffer>>());
  const [playing, setPlaying] = useState<PlayState>({ soundId: null, variant: null });

  const decode = useCallback((context: AudioContext, url: string, fallbackUrl: string): Promise<AudioBuffer> => {
    const cached = bufferCache.current.get(url);
    if (cached) return cached;
    const promise = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .catch(() =>
        fetch(fallbackUrl)
          .then((r) => r.arrayBuffer())
          .then((bytes) => context.decodeAudioData(bytes)),
      );
    bufferCache.current.set(url, promise);
    promise.catch(() => bufferCache.current.delete(url));
    return promise;
  }, []);

  const play = useCallback(
    async (soundId: string, files: { ogg: string; mp3: string }, variant: number) => {
      const context = getAudioContext(contextRef);
      const buffer = await decode(context, files.ogg, files.mp3);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      setPlaying({ soundId, variant });
      source.onended = () => setPlaying((p) => (p.soundId === soundId && p.variant === variant ? { soundId: null, variant: null } : p));
      source.start();
    },
    [decode],
  );

  const value = useMemo(() => ({ playing, play }), [playing, play]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer must be used inside PlayerProvider");
  return value;
}
