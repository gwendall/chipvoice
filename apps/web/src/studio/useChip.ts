"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Chip } from "chipvoice";
import { toSong, type ChipId, type Track } from "./song";

/**
 * The chip, and where it is.
 *
 * `create` has to happen inside a user gesture, so the chip does not exist
 * until the first press. Everything here handles that null cleanly rather than
 * assuming it away: a browser without AudioWorklet gets a page that says so
 * instead of a page that throws.
 *
 * There are two chips to choose from, and switching disposes of the one
 * playing: the next press builds the other. What the studio says about
 * voices - which one an effect steals, which one a row previews on - comes
 * from the chip's own map of the song's four lines, not from names typed here.
 */
export function useChip() {
  const chipRef = useRef<Chip | null>(null);
  const [chipId, setChipId] = useState<ChipId>("2a03");
  const chipIdRef = useRef<ChipId>("2a03");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  /** Which sixteenth is sounding. -1 when silent. */
  const [step, setStep] = useState(-1);
  /** The voice an effect is holding, so the grid can show it being taken. */
  const [stolen, setStolen] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (chipRef.current) {
      chipRef.current.resume();
      return chipRef.current;
    }
    const chip = await Chip.create({ chip: chipIdRef.current });
    if (!chip) {
      setUnsupported(true);
      return null;
    }
    chipRef.current = chip;
    setReady(true);
    // Exposed on purpose. This is a playground: poking at the chip from the
    // console is half of what it is for, and it is what lets a test measure the
    // output rather than trust a status line.
    (window as unknown as { chipvoice?: Chip }).chipvoice = chip;
    return chip;
  }, []);

  /** Picks the other chip. Whatever was playing stops; the next press starts the new one. */
  const selectChip = useCallback((id: ChipId) => {
    if (id === chipIdRef.current) return;
    chipIdRef.current = id;
    setChipId(id);
    const current = chipRef.current;
    if (current) {
      current.dispose();
      chipRef.current = null;
      setReady(false);
      setPlaying(false);
      setStep(-1);
      setStolen(null);
      (window as unknown as { chipvoice?: Chip }).chipvoice = undefined;
    }
  }, []);

  // One rAF loop for the playhead. Reading the position rather than counting
  // frames is what keeps it on the sound: the sequencer schedules 200ms ahead,
  // and anything that counts locally drifts against the audio clock.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const chip = chipRef.current;
      if (chip) {
        const pos = chip.position();
        setStep(pos ? pos.step : -1);
        setPlaying(chip.playing);
        const chord = chip.spec.roles.chord;
        setStolen(chip.playing && !chip.canPlay(chord) ? chord : null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => chipRef.current?.dispose(), []);

  const play = useCallback(
    async (track: Track, bpm: number) => {
      const chip = await start();
      chip?.play(toSong(track, bpm, chipIdRef.current));
    },
    [start],
  );

  const stop = useCallback(() => {
    chipRef.current?.stop();
  }, []);

  /** The demo: a gunshot that holds the chord's voice, pulse 2 on either chip. */
  const fire = useCallback(async () => {
    const chip = await start();
    chip?.sfx(chip.spec.roles.chord, {
      note: "B6",
      instrument: { duty: 0, volume: [13, 12, 10, 8, 5, 2], slide: -3.4 },
      duration: 0.18,
    });
  }, [start]);

  /** Audition one token on its own voice, for the palette. */
  const preview = useCallback(
    async (voice: string, token: string) => {
      const chip = await start();
      if (!chip) return;
      if (voice === chip.spec.roles.perc) {
        const kit: Record<string, { note: number; volume: number[]; mode?: boolean }> = {
          K: { note: 6, volume: [13, 11, 8, 4, 2] },
          S: { note: 9, volume: [12, 10, 7, 4, 2, 1] },
          H: { note: 13, volume: [6, 3, 1], mode: true },
          O: { note: 12, volume: [8, 7, 6, 5, 4, 3, 2, 1], mode: true },
        };
        const drum = kit[token];
        if (!drum) return;
        chip.sfx(voice, {
          note: drum.note,
          instrument: { volume: drum.volume, noiseMode: drum.mode },
          duration: 0.12,
        });
        return;
      }
      chip.sfx(voice, {
        note: token,
        instrument: { duty: 1, volume: [13, 12, 11, 10, 8, 6, 4, 2] },
        duration: 0.22,
      });
    },
    [start],
  );

  /** The output node, for the scope. Null until the first press starts it. */
  const output = ready ? (chipRef.current?.output ?? null) : null;

  return { chipId, selectChip, ready, playing, unsupported, step, stolen, output, play, stop, fire, preview };
}
