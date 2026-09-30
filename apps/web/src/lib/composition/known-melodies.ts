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
 * 2. A small set of well-known, out-of-copyright melody incipits - four
 *    European melodies in the public domain and one Russian folk tune that
 *    is also a famous game theme (Tetris's "Type A" music), so the set is
 *    not only game themes. Each one's pitches AND rhythm are read from a
 *    published score (see its `source`). The first version checked only
 *    the note names against a letter-notation page and filled in the rhythm
 *    from memory, which left four of these five rhythms wrong under
 *    `./similarity.ts`'s own definition (each ratio is the gap INTO a note
 *    over the gap into the one before it): a real quote then missed on
 *    rhythm, while Korobeiniki's invented run of equal notes matched any
 *    stepwise line of equal notes. Decision 56's recalibration found this
 *    on the generation benchmark's 188 real generations.
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
  // ---- well-known, public-domain incipits, read from a published score (pitches and rhythm) ----
  {
    id: "twinkle-twinkle",
    title: "Twinkle, Twinkle, Little Star (\"Ah! vous dirai-je, Maman\", trad., public domain)",
    source: "Hand-encoded from memory, then verified against a published letter-notation transcription of the opening phrase, C C G G A A G-F F E E D D C, quarter notes except the two held G/C (Glow Scotland Youth Music Initiative, \"Twinkle Twinkle Little Star\", blogs.glowscotland.org.uk, read 2026-09-29), and against the score in Wikipedia's \"Twinkle, Twinkle, Little Star\" article (c4 c g' g a a g2 | f f e e d d c2, read 2026-09-30).",
    intervals: [0, 7, 0, 2, 0, -2, -2, 0, -1, 0, -2, 0, -2],
    durationRatios: [1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 0.5, 1.0, 1.0, 1.0, 1.0, 1.0],
  },
  {
    id: "ode-to-joy",
    title: "Beethoven - \"Ode to Joy\", Symphony No. 9 (public domain)",
    source: "The opening phrase, E E F G | G F E D | C C D E | E. D D: quarter notes, then the cadence's dotted quarter, eighth and half. Read from the score in Wikipedia's \"Ode to Joy\" article (in G: b b c d | d c b a | g g a b | b4. a8 a2, read 2026-09-30); the pitches match the letter-notation transcription first cited (\"Ode to Joy by Beethoven\", pianoletternotes.blogspot.com, read 2026-09-29), which gives no rhythm. Full score at IMSLP, Symphony No. 9, Op. 125, imslp.org/wiki/Symphony_No.9,_Op.125_(Beethoven,_Ludwig_van).",
    intervals: [0, 1, 2, 0, -2, -1, -2, -2, 0, 2, 2, 0, -2, 0],
    durationRatios: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.5, 0.3333],
  },
  {
    id: "fur-elise",
    title: "Beethoven - \"Fur Elise\" opening (public domain)",
    source: "The first 16 notes of the right-hand part, E D# E D# E B D C A, C E A B, E G# B: even sixteenths, with A and B each an eighth followed by a sixteenth rest. Read from the score in Wikipedia's \"Fur Elise\" article (e''16 dis'' | e'' dis'' e'' b' d'' c'' | a'8 r16 c' e' a' | b'8 r16 e' gis' b', read 2026-09-30); the first nine pitches match the note-name transcription first cited (piano.org, \"Fur Elise Piano Notes: Beethoven Guide\", read 2026-09-29), which gives no rhythm. Full score at IMSLP, Fur Elise, WoO 59, imslp.org/wiki/F%C3%BCr_Elise,_WoO_59_(Beethoven,_Ludwig_van).",
    intervals: [-1, 1, -1, 1, -5, 3, -2, -3, -9, 4, 5, 2, -7, 4, 3],
    durationRatios: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 3.0, 0.3333, 1.0, 1.0, 3.0, 0.3333, 1.0],
  },
  {
    id: "beethoven-5th-motif",
    title: "Beethoven - Symphony No. 5, opening motif (public domain)",
    source: "The four-note \"fate\" motif stated twice, G G G Eb, F F F D: three eighths into a held note, twice. Read from the score of bars 1-5 in Wikipedia's \"Symphony No. 5 (Beethoven)\" article (r8 g' g' g' | ees'2 | r8 f' f' f' | d'2~ d', read 2026-09-30); the gap from the held Eb to the next F is taken as notated, five eighths, without the fermata's extra length. The pitches match the description first cited (Eastman School of Music, \"Symphony No. 5 in C minor, Op. 67\", esm.rochester.edu, read 2026-09-29). Full score at IMSLP, Symphony No. 5, Op. 67, imslp.org/wiki/Symphony_No.5,_Op.67_(Beethoven,_Ludwig_van).",
    intervals: [0, 0, -4, 2, 0, 0, -3],
    durationRatios: [1.0, 1.0, 5.0, 0.2, 1.0, 1.0],
  },
  {
    id: "korobeiniki",
    title: "\"Korobeiniki\" (Russian folk song, public domain; the Tetris \"Type A\" theme)",
    source: "The first 16 notes of the Tetris form, E B C D C B A A C E D C B C D E: quarter, eighth, eighth throughout, with a dotted quarter on the B of the third bar. Read from setting 24502 of \"Korobeiniki\" on thesession.org, in ABC (B2 FG | A2 GF | E2 EG | B2 AG | F3 G | A2 B2, the same tune transposed, read 2026-09-30); the first eight pitches match the note-name transcription first cited (\"How to Play the Tetris Theme Song\", piano-keyboard-guide.com, read 2026-09-29), which gives no rhythm.",
    intervals: [-5, 1, 2, -2, -1, -2, 0, 3, 4, -2, -2, -1, 1, 2, 2],
    durationRatios: [0.5, 1.0, 2.0, 0.5, 1.0, 2.0, 0.5, 1.0, 2.0, 0.5, 1.0, 3.0, 0.3333, 2.0],
  },
];
