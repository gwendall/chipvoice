import { DEFAULT_KIT, type Instrument, type Song } from "chipvoice";

/**
 * The playground's song, as the four lines of tokens the library takes.
 *
 * Tokens rather than a note model on purpose: this is the library's own format,
 * so the grid renders it cell for cell and there is no layer in between that
 * could disagree with what is heard.
 */
export const CHANNELS = ["lead", "chord", "bass", "perc"] as const;
export type ChannelName = (typeof CHANNELS)[number];

export interface Track {
  lead: string[];
  chord: string[];
  bass: string[];
  perc: string[];
}

export const CHANNEL_LABEL: Record<ChannelName, string> = {
  lead: "LEAD",
  chord: "CHORD",
  bass: "BASS",
  perc: "DRUMS",
};

/** Which chip voice each line ends up on, which is what the stealing acts on. */
export const CHANNEL_VOICE: Record<ChannelName, "p1" | "p2" | "tri" | "noi"> = {
  lead: "p1",
  chord: "p2",
  bass: "tri",
  perc: "noi",
};

export const STEPS = 64;

const split = (line: string) => line.trim().split(/\s+/);

const DEFAULT_LINES = {
  lead:
    "E4 . . . G4 . A4 . . . B4 . C5 . . . " +
    "B4 . A4 . . . . . E4 . . . . . . . " +
    "F4 . . . A4 . C5 . . . D5 . C5 . . . " +
    "B4 . . . G4 . . . A4 . . . . . = .",
  chord:
    "A3 . . . . . . . . . . . . . . . " +
    "A3 . . . . . . . E3 . . . . . . . " +
    "F3 . . . . . . . . . . . . . . . " +
    "G3 . . . . . . . . . . . . . . .",
  bass:
    "A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 . " +
    "A1 . A1 . A1 . A1 . E1 . E1 . E1 . E1 . " +
    "F1 . F1 . F1 . F1 . F1 . F1 . F1 . F1 . " +
    "G1 . G1 . G1 . G1 . G1 . G1 . B1 . B1 .",
  perc:
    "K . H . S . H . K . H K S . H . " +
    "K . H . S . H . K . H K S . H H " +
    "K . H . S . H . K . H K S . H . " +
    "K . H . S . H . K K S . S . H O",
};

export function defaultTrack(): Track {
  return {
    lead: split(DEFAULT_LINES.lead),
    chord: split(DEFAULT_LINES.chord),
    bass: split(DEFAULT_LINES.bass),
    perc: split(DEFAULT_LINES.perc),
  };
}

export function emptyTrack(): Track {
  const blank = () => Array.from({ length: STEPS }, () => ".");
  return { lead: blank(), chord: blank(), bass: blank(), perc: blank() };
}

const LEAD_INSTRUMENT: Instrument = {
  duty: 1,
  volume: [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8],
  sustain: true,
  vibrato: { depth: 0.18, rate: 8, delay: 12 },
};

const CHORD_INSTRUMENT: Instrument = {
  duty: 0,
  volume: [9, 8, 7, 7, 6],
  sustain: true,
};

const BASS_INSTRUMENT: Instrument = { volume: [15], sustain: true };

const MINOR = [0, 3, 7];
const MAJOR = [0, 4, 7];

export function toSong(track: Track, bpm: number): Song {
  return {
    // The id carries the content, so editing a note while it plays restarts the
    // piece with the change in it. Identity would not: `play` short-circuits on
    // a matching id, which is what stops it restarting sixty times a second.
    id: `pg:${bpm}:${hash(track)}`,
    bpm,
    patterns: [
      {
        lead: track.lead.join(" "),
        chord: track.chord.join(" "),
        bass: track.bass.join(" "),
        perc: track.perc.join(" "),
        chordShape: [MINOR, MINOR, MINOR, MAJOR, MAJOR],
      },
    ],
    order: [0],
    gain: 1,
    lead: LEAD_INSTRUMENT,
    chord: CHORD_INSTRUMENT,
    bass: BASS_INSTRUMENT,
    perc: DEFAULT_KIT,
  };
}

function hash(track: Track): string {
  const text = CHANNELS.map((c) => track[c].join("")).join("|");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
