"use client";

import { useCallback, useEffect, useState } from "react";
import type { Track } from "./song";
import { CHANNELS, type ChipId } from "./song";

/**
 * The half of the product that was missing.
 *
 * There was a complete API that nothing in the editor could reach, and an
 * editor that could not save. The song lived in the URL and nowhere else, so
 * every piece anybody wrote by hand existed only as long as its tab did.
 *
 * The two ways of holding a song both stay, because they are for different
 * moments: the URL is a draft - instant, private, disposable - and a stored
 * song is a publication, with a short id, an MP3 and a page.
 */
export interface Published {
  id: string;
  url: string;
  mp3: string;
  title: string | null;
  parentId: string | null;
  forks: number;
  measured: { loopSeconds: number; onsetsPerSecond: number; range: number } | null;
}

const KEY_STORAGE = "chipvoice.key";

export function useLibrary() {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<Published | null>(null);

  /*
   * A key arrives in the fragment, from a link in an inbox. Fragments are not
   * sent to servers and not written to proxy logs, so it exists in the address
   * bar for one paint - then it is stored and stripped.
   */
  useEffect(() => {
    const stored = localStorage.getItem(KEY_STORAGE);
    if (stored) setKey(stored);

    const hash = location.hash.slice(1);
    if (hash.startsWith("key=")) {
      const fresh = decodeURIComponent(hash.slice(4));
      localStorage.setItem(KEY_STORAGE, fresh);
      setKey(fresh);
      history.replaceState(null, "", location.pathname);
    }
  }, []);

  const headers = useCallback((): HeadersInit => {
    const base: HeadersInit = { "content-type": "application/json" };
    return key ? { ...base, authorization: `Bearer ${key}` } : base;
  }, [key]);

  const body = (track: Track, bpm: number, title: string, chip: ChipId) => ({
    chip,
    ...(title.trim() ? { title: title.trim() } : {}),
    bpm,
    order: [0],
    patterns: [
      {
        lead: track.lead.join(" "),
        chord: track.chord.join(" "),
        bass: track.bass.join(" "),
        perc: track.perc.join(" "),
        chordShape: [[0, 3, 7], [0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]],
      },
    ],
  });

  /** Handles both shapes the API refuses with, so nothing swallows a reason. */
  const readError = async (response: Response): Promise<string> => {
    try {
      const data = await response.json();
      if (Array.isArray(data.issues) && data.issues.length > 0) {
        const first = data.issues[0];
        const where = first.track
          ? `${first.track}${first.step !== undefined ? ` step ${first.step + 1}` : ""}: `
          : first.path
            ? `${first.path}: `
            : "";
        return `${where}${first.message}`;
      }
      return data.message ?? data.error ?? `error ${response.status}`;
    } catch {
      return `error ${response.status}`;
    }
  };

  const publish = useCallback(
    async (track: Track, bpm: number, title: string, chip: ChipId): Promise<Published | null> => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/songs", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body(track, bpm, title, chip)),
        });
        if (!response.ok) {
          setError(await readError(response));
          return null;
        }
        const song = (await response.json()) as Published;
        setPublished(song);
        history.replaceState(null, "", `/s/${song.id}`);
        return song;
      } catch {
        setError("could not reach the server");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [headers],
  );

  /**
   * Editing a published song forks it, because a published song never changes.
   *
   * The button says so rather than leaving it to be discovered: after
   * publishing, Save becomes Fork.
   */
  const fork = useCallback(
    async (id: string, track: Track, bpm: number, title: string, chip: ChipId): Promise<Published | null> => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/songs/${id}/fork`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body(track, bpm, title, chip)),
        });
        if (!response.ok) {
          setError(await readError(response));
          return null;
        }
        const song = (await response.json()) as Published;
        setPublished(song);
        history.replaceState(null, "", `/s/${song.id}`);
        return song;
      } catch {
        setError("could not reach the server");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [headers],
  );

  const requestKey = useCallback(async (email: string): Promise<string> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, label: "the editor" }),
      });
      const data = await response.json();
      return response.ok ? (data.message ?? "check your inbox") : (data.message ?? "that did not work");
    } catch {
      return "could not reach the server";
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(KEY_STORAGE);
    setKey(null);
  }, []);

  /** Loads a stored song into the editor, for /s/{id}. */
  const load = useCallback(async (id: string): Promise<{ track: Track; bpm: number; chip: ChipId; title: string; song: Published } | null> => {
    try {
      const response = await fetch(`/api/songs/${id}`);
      if (!response.ok) return null;
      const song = await response.json();
      const pattern = song.patterns[song.order[0]] ?? song.patterns[0];
      const track = Object.fromEntries(
        CHANNELS.map((c) => [c, String(pattern[c] ?? "").trim().split(/\s+/).filter(Boolean)]),
      ) as unknown as Track;
      setPublished(song);
      return { track, bpm: song.bpm, chip: song.chip === "dmg" || song.chip === "md" || song.chip === "snes" || song.chip === "c64" ? song.chip : "2a03", title: song.title ?? "", song };
    } catch {
      return null;
    }
  }, []);

  return { key, busy, error, published, setPublished, publish, fork, requestKey, signOut, load, setError };
}
