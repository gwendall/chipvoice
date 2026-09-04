import { arrange, C64, GB_DMG, MEGA_DRIVE, NES_2A03, SNES, type Song } from "chipvoice";

/** The chips the studio offers, by the id the API stores. */
export type ChipId = "2a03" | "dmg" | "md" | "snes" | "c64";
export const CHIP_LABEL: Record<ChipId, string> = { "2a03": "NES", dmg: "Game Boy", md: "Mega Drive", snes: "SNES", c64: "C64" };

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
export function channelVoice(chip: ChipId, channel: ChannelName): string {
  return (chip === "dmg" ? GB_DMG : chip === "md" ? MEGA_DRIVE : chip === "snes" ? SNES : chip === "c64" ? C64 : NES_2A03).roles[channel];
}

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

const MINOR = [0, 3, 7];
const MAJOR = [0, 4, 7];

/**
 * The grid as a score, arranged for the chip: the same instruments the API
 * gives a song with no intent, so the studio plays what the MP3 will be.
 */
export function toSong(track: Track, bpm: number, chip: ChipId = "2a03"): Song {
  return arrange(
    {
      // The id carries the content, so editing a note while it plays restarts
      // the piece with the change in it. Identity would not: `play`
      // short-circuits on a matching id, which is what stops it restarting
      // sixty times a second.
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
    },
    chip,
  );
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
