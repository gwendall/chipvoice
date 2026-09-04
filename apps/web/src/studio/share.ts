import { CHANNELS, STEPS, defaultTrack, type ChipId, type Track } from "./song";

/**
 * The song lives in the URL. No accounts, no storage, no server: a link is the
 * save file, which is what BeepBox got right and what makes a demo spread.
 *
 * Encoded as the four token lines joined by newlines, then base64. Not JSON:
 * the tokens are the format, and a link somebody can half-read is friendlier
 * than an opaque blob. The first line is the tempo, followed by the chip when
 * it is not the NES, so every link made before there were two still decodes.
 */
export function encode(track: Track, bpm: number, chip: ChipId = "2a03"): string {
  const body = CHANNELS.map((c) => track[c].join(" ")).join("\n");
  const head = chip === "2a03" ? `${bpm}` : `${bpm} ${chip}`;
  return btoa(unescape(encodeURIComponent(`${head}\n${body}`)));
}

export function decode(raw: string): { track: Track; bpm: number; chip: ChipId } | null {
  try {
    const text = decodeURIComponent(escape(atob(raw)));
    const [head, ...lines] = text.split("\n");
    const [bpmText, chipText] = head.trim().split(/\s+/);
    const bpm = Number(bpmText);
    const chip: ChipId = chipText === "dmg" || chipText === "md" ? chipText : "2a03";
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300) return null;
    if (lines.length !== CHANNELS.length) return null;

    const track = defaultTrack();
    CHANNELS.forEach((channel, i) => {
      const tokens = lines[i].trim().split(/\s+/).filter(Boolean);
      // Pad or trim to the fixed length. A hand-edited link with a missing
      // token would otherwise shorten the pattern, and pattern length comes
      // from the bass line - so one lost token changes the bar for everyone.
      track[channel] = Array.from({ length: STEPS }, (_, s) => tokens[s] ?? ".");
    });
    return { track, bpm, chip };
  } catch {
    return null;
  }
}
