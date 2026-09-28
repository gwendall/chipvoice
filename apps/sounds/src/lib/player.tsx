"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { AudioFile, Sound, Variant } from "./catalog";

/**
 * The player: Web Audio, not `<audio>` (spec: "a trigger after load starts
 * in under 10 ms"). One shared `AudioContext`, decoded buffers cached by
 * URL so replaying a sound never re-fetches or re-decodes it, and the
 * ogg -> mp3 fallback keyed on `decodeAudioData` actually rejecting (not on
 * `canPlayType`, whose answer for ogg is unreliable across browsers - see
 * docs/DECISIONS.md). Creating the context does not itself need a user
 * gesture (only starting playback does - `play()` resumes it right before
 * `.start()`), so `preload()` can warm the decode cache well before the
 * first tap.
 */
interface PlayState {
  soundId: string | null;
  variant: number | null;
  /** The full sound, kept even after playback ends, so a sticky mini-player
   * can keep showing "last played" instead of flickering to empty. */
  sound: Sound | null;
  isPlaying: boolean;
  /** `AudioContext.currentTime` the current source started at. A playhead
   * reads `now() - startedAt`, never `Date.now()`, so it stays correct
   * across a backgrounded tab (the audio clock pauses too). */
  startedAt: number | null;
  duration: number | null;
}

interface PlayerContextValue {
  playing: PlayState;
  /** Plays one variant of a sound; returns once the source has started (not
   * once it finishes). Choking guard: a sound already sounding has its
   * previous voice stopped first, so holding a key that retriggers the same
   * sound never stacks unbounded voices (spec: "spam guard"). */
  play: (sound: Sound, variant: Variant) => Promise<void>;
  /** Warms the decode cache for a variant (default: the sound's first) -
   * fire-and-forget, safe to call from a hover, a keyboard selection move,
   * or an IntersectionObserver callback. Every call funnels through the
   * same bounded-concurrency decode queue `play()` uses, so preloading a
   * whole visible page of rows at once cannot open unbounded parallel
   * fetch/decode work. */
  preload: (sound: Sound, variant?: Variant) => void;
  /** True once a variant's audio is decoded and cached - components use
   * this to render an observable `data-preload-state`. */
  isReady: (sound: Sound, variant?: Variant) => boolean;
  /** `AudioContext.currentTime` right now, or 0 before any context exists -
   * a playhead's own rAF loop reads this, in the same clock `startedAt` was
   * recorded in. */
  now: () => number;
  /** How many voices are sounding right now, across every sound. The choke
   * guard keeps this from growing when the same sound is retriggered
   * rapidly - test-smoke.mjs reads it off the mini-player's own
   * `data-active-voices` attribute. */
  activeVoiceCount: number;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/** Bounds how many fetch+decode jobs run at once, so preloading a whole
 * visible list on scroll cannot open dozens of parallel network+decode
 * jobs simultaneously. */
const MAX_CONCURRENT_DECODES = 4;

function ensureContext(ref: { current: AudioContext | null }): AudioContext {
  if (!ref.current) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ref.current = new Ctor();
  }
  return ref.current;
}

function createSemaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const job = queue.shift();
    job?.();
  };
  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      });
      pump();
    });
  };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const contextRef = useRef<AudioContext | null>(null);
  const bufferCache = useRef(new Map<string, Promise<AudioBuffer>>());
  const scheduleDecode = useRef(createSemaphore(MAX_CONCURRENT_DECODES));
  // One live source per sound id - a new play() for a sound already
  // sounding stops the old voice first, the spam guard itself.
  const activeSources = useRef(new Map<string, AudioBufferSourceNode>());
  const [playing, setPlaying] = useState<PlayState>({ soundId: null, variant: null, sound: null, isPlaying: false, startedAt: null, duration: null });
  const [activeVoiceCount, setActiveVoiceCount] = useState(0);
  const [readyUrls, setReadyUrls] = useState<Set<string>>(new Set());

  const decode = useCallback((context: AudioContext, primary: AudioFile, fallback: AudioFile): Promise<AudioBuffer> => {
    const cached = bufferCache.current.get(primary.url);
    if (cached) return cached;
    const promise = scheduleDecode.current(() =>
      fetch(primary.url)
        .then((r) => r.arrayBuffer())
        .then((bytes) => context.decodeAudioData(bytes))
        .catch(() =>
          fetch(fallback.url)
            .then((r) => r.arrayBuffer())
            .then((bytes) => context.decodeAudioData(bytes)),
        ),
    );
    bufferCache.current.set(primary.url, promise);
    promise.then(
      () => setReadyUrls((s) => (s.has(primary.url) ? s : new Set(s).add(primary.url))),
      () => bufferCache.current.delete(primary.url),
    );
    return promise;
  }, []);

  const preload = useCallback(
    (sound: Sound, variant?: Variant) => {
      const v = variant ?? sound.variants[0];
      if (!v) return;
      const context = ensureContext(contextRef);
      void decode(context, v.files.ogg, v.files.mp3);
    },
    [decode],
  );

  const isReady = useCallback(
    (sound: Sound, variant?: Variant) => {
      const v = variant ?? sound.variants[0];
      return v ? readyUrls.has(v.files.ogg.url) : false;
    },
    [readyUrls],
  );

  const play = useCallback(
    async (sound: Sound, variant: Variant) => {
      const context = ensureContext(contextRef);
      if (context.state === "suspended") await context.resume();
      const buffer = await decode(context, variant.files.ogg, variant.files.mp3);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);

      const previous = activeSources.current.get(sound.id);
      if (previous) {
        try {
          previous.onended = null;
          previous.stop();
        } catch {
          /* already stopped */
        }
      }
      activeSources.current.set(sound.id, source);
      setActiveVoiceCount(activeSources.current.size);

      const startedAt = context.currentTime;
      setPlaying({ soundId: sound.id, variant: variant.n, sound, isPlaying: true, startedAt, duration: buffer.duration });
      source.onended = () => {
        if (activeSources.current.get(sound.id) === source) {
          activeSources.current.delete(sound.id);
          setActiveVoiceCount(activeSources.current.size);
        }
        setPlaying((p) => (p.soundId === sound.id && p.variant === variant.n ? { ...p, isPlaying: false } : p));
      };
      source.start();
    },
    [decode],
  );

  const now = useCallback(() => contextRef.current?.currentTime ?? 0, []);

  const value = useMemo(
    () => ({ playing, play, preload, isReady, now, activeVoiceCount }),
    [playing, play, preload, isReady, now, activeVoiceCount],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("usePlayer must be used inside PlayerProvider");
  return value;
}
