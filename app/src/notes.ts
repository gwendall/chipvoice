/**
 * What a cell can hold, per channel.
 *
 * The grid is one row per channel and one column per sixteenth - a tracker
 * laid flat, which is exactly the shape of the data. A piano roll would need a
 * row per pitch: four channels times fourteen pitches is fifty-six rows, which
 * is unreadable on a phone and is a different product anyway.
 *
 * So pitch is chosen from a palette and painted into cells. The palette is
 * deliberately a scale rather than every semitone: tapping at random on a
 * chromatic keyboard sounds random, and tapping at random on a minor scale
 * sounds like music, which is what a demo needs.
 */
const SCALE = ["A", "B", "C", "D", "E", "F", "G"];

function pitches(low: number, high: number): string[] {
  const out: string[] = [];
  for (let octave = low; octave <= high; octave++) {
    for (const letter of SCALE) out.push(`${letter}${octave}`);
  }
  return out;
}

export const DRUM_LABEL: Record<string, string> = {
  K: "KICK",
  S: "SNARE",
  H: "HAT",
  O: "OPEN",
};

/** The tokens a channel offers, in the order they appear in the palette. */
export function paletteFor(channel: string): string[] {
  if (channel === "perc") return ["K", "S", "H", "O"];
  if (channel === "bass") return pitches(1, 2);
  if (channel === "chord") return pitches(3, 4);
  return pitches(4, 5);
}

/** A hold, a cut, or a note. Drives how a cell is drawn. */
export function cellKind(token: string): "empty" | "cut" | "note" {
  if (token === ".") return "empty";
  if (token === "=") return "cut";
  return "note";
}
