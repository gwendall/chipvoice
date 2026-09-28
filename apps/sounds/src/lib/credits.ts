import type { Sound } from "./catalog";

/**
 * The LICENSE text a sound or pack zip carries alongside its audio - the
 * same information `Sound.license`/`.source`/`.attribution` hold in the
 * API, in the one plain-text form every archive tool and every human can
 * read without parsing JSON. Every Phase 1 sound is CC0-1.0 (see
 * docs/GAMESOUNDS.md), so `attribution` is always null today, but the text
 * still prints it when a future non-CC0 entry needs it.
 */
export function licenseText(sounds: Sound[]): string {
  const lines = [
    "gamesounds.ai - LICENSE",
    "",
    "Every sound below is listed with its licence, source and author. Most of",
    "this catalogue is CC0-1.0 (public domain dedication): no attribution is",
    "legally required, but the source is named anyway so you can find more.",
    "",
  ];
  for (const sound of sounds) {
    lines.push(`${sound.id}`);
    lines.push(`  licence: ${sound.license}`);
    lines.push(`  source: ${sound.source.name} (${sound.source.url})`);
    lines.push(`  author: ${sound.source.author}`);
    if (sound.attribution) lines.push(`  attribution required: ${sound.attribution}`);
    lines.push("");
  }
  return lines.join("\n");
}
