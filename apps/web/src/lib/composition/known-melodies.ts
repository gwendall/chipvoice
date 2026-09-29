/**
 * The known-melody reference set (decision 56, NEXT-21).
 *
 * Every entry is a short incipit - the first handful of notes, enough to
 * recognize the tune, never a whole piece - encoded ONLY as the two
 * transposition/tempo-invariant sequences `./similarity.ts` compares against
 * a generation's output: `intervals` (semitones between consecutive pitches)
 * and `durationRatios` (the ratio between each pair of consecutive
 * inter-onset gaps, aligned to `intervals[1..]`, so `durationRatios[i]`
 * pairs with `intervals[i + 1]`). No absolute pitch, no absolute timing, no
 * audio and no sheet music are stored; this is the same rule
 * `./similarity.ts` applies to a generation's own output before comparing
 * it, so a reference and a candidate are always compared on equal terms.
 *
 * Two sources, per decision 56:
 *
 * 1. The site's own familiar material - Mario, Zelda and Sonic - derived
 *    from the first 16 melody notes of the verified transcriptions already
 *    in the repo (`scores/references/{mario,zelda,sonic}.json`, decision 29;
 *    the same three songs are `scores/classics.json`'s "studio's familiar
 *    melodies"). `intervals`/`durationRatios` below were computed once from
 *    those files (first 16 notes of the `lead`/monophonic melody line) with
 *    the exact algorithm `./similarity.ts` uses, not retyped by hand; see
 *    the comment on each entry for the precise slice.
 * 2. A small set of well-known, out-of-copyright melody incipits, encoded by
 *    hand from memory of the notes only, in C (transposition makes the key
 *    irrelevant to matching) - four European melodies in the public domain
 *    and one Russian folk tune that is also a famous game theme (Tetris's
 *    "Type A" music), so the set is not only game themes.
 */

export interface KnownMelody {
  id: string;
  title: string;
  /** What this incipit is and where it came from; never a claim of
   * completeness or of the full work. */
  source: string;
  /** Semitone difference between each pair of consecutive notes. */
  intervals: number[];
  /** Ratio between each pair of consecutive inter-onset gaps, one shorter
   * than `intervals` and aligned to start at `intervals[1]`. */
  durationRatios: number[];
}

export const KNOWN_MELODIES: KnownMelody[] = [
  // ---- the site's own familiar material (decision 29's verified transcriptions) ----
  {
    id: "mario-ground-theme",
    title: "Mario - Ground Theme (Koji Kondo)",
    source: "First 16 melody notes of scores/references/mario.json (the site's own verified NSF transcription, decision 29).",
    intervals: [0, 0, -4, 4, 3, -12, 5, -5, -3, 5, 2, -1, -1, -2, 9],
    durationRatios: [1.8899, 1.0069, 0.4951, 2.0119, 2.0325, 0.9835, 0.7656, 0.9807, 1.0216, 0.6502, 1.0069, 0.4951, 2.0119, 0.6969],
  },
  {
    id: "zelda-overworld",
    title: "Zelda - Overworld (Koji Kondo)",
    source: "First 16 melody notes of scores/references/zelda.json (the site's own verified NSF transcription, decision 29).",
    intervals: [0, 0, 0, 0, 0, -2, 2, 0, 0, 0, 0, 0, -2, 2, 0],
    durationRatios: [0.125, 1.0, 1.0, 1.0, 2.0, 0.5, 5.0, 0.2, 1.0, 1.0, 1.0, 2.0, 0.5, 5.0],
  },
  {
    id: "sonic-green-hill",
    title: "Sonic - Green Hill Zone (Masato Nakamura)",
    source: "First 16 melody notes of scores/references/sonic.json (the site's own independently decoded VGM transcription, decision 29).",
    intervals: [-3, 3, -1, 1, -1, -4, 2, 7, -2, -2, -1, 1, -1, -4, 5],
    durationRatios: [2.0426, 0.5, 2.0, 0.5, 2.0, 3.0, 0.1667, 1.0, 2.0, 0.5, 2.0, 0.5, 2.0, 3.5104],
  },
  // ---- well-known, public-domain incipits, hand-encoded from memory (no source file) ----
  {
    id: "twinkle-twinkle",
    title: "Twinkle, Twinkle, Little Star (\"Ah! vous dirai-je, Maman\", trad., public domain)",
    source: "Hand-encoded from memory, then verified against a published letter-notation transcription of the opening phrase, C C G G A A G-F F E E D D C, quarter notes except the two held G/C (Glow Scotland Youth Music Initiative, \"Twinkle Twinkle Little Star\", blogs.glowscotland.org.uk, read 2026-09-29).",
    intervals: [0, 7, 0, 2, 0, -2, -2, 0, -1, 0, -2, 0, -2],
    durationRatios: [1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0],
  },
  {
    id: "ode-to-joy",
    title: "Beethoven - \"Ode to Joy\", Symphony No. 9 (public domain)",
    source: "Hand-encoded from memory, then verified against a published letter-notation transcription of the opening phrase, E E F G-G F E D-C C D E-E D D, all quarter notes (\"Ode to Joy by Beethoven\", pianoletternotes.blogspot.com, read 2026-09-29; full score at IMSLP, Symphony No. 9, Op. 125, imslp.org/wiki/Symphony_No.9,_Op.125_(Beethoven,_Ludwig_van)).",
    intervals: [0, 1, 2, 0, -2, -1, -2, -2, 0, 2, 2, 0, -2, 0],
    durationRatios: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  },
  {
    id: "fur-elise",
    title: "Beethoven - \"Fur Elise\" opening (public domain)",
    source: "Hand-encoded from memory, then verified against a published note-name transcription of the famous opening figure, E D# E D# E B D C A (piano.org, \"Fur Elise Piano Notes: Beethoven Guide\", read 2026-09-29; full score at IMSLP, Fur Elise, WoO 59, imslp.org/wiki/F%C3%BCr_Elise,_WoO_59_(Beethoven,_Ludwig_van)).",
    intervals: [-1, 1, -1, 1, -5, 3, -2, -3],
    durationRatios: [1.0, 1.0, 1.0, 2.0, 1.0, 1.0, 2.0],
  },
  {
    id: "beethoven-5th-motif",
    title: "Beethoven - Symphony No. 5, opening motif (public domain)",
    source: "Hand-encoded from memory, then verified against a published description of the four-note \"fate\" motif stated twice, G G G Eb, F F F D (Eastman School of Music, \"Symphony No. 5 in C minor, Op. 67\", esm.rochester.edu, read 2026-09-29); full score at IMSLP, Symphony No. 5, Op. 67, imslp.org/wiki/Symphony_No.5,_Op.67_(Beethoven,_Ludwig_van).",
    intervals: [0, 0, -4, 2, 0, 0, -3],
    durationRatios: [1.0, 3.0, 0.3333, 1.0, 1.0, 3.0],
  },
  {
    id: "korobeiniki",
    title: "\"Korobeiniki\" (Russian folk song, public domain; the Tetris \"Type A\" theme)",
    source: "Hand-encoded from memory, then verified against a published note-name transcription of the opening riff, E B C D C B A A (\"How to Play the Tetris Theme Song\", piano-keyboard-guide.com, read 2026-09-29).",
    intervals: [-5, 1, 2, -2, -1, -2, 0],
    durationRatios: [1.0, 1.0, 1.0, 1.0, 1.0, 2.0],
  },
];
