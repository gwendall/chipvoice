/**
 * The package's public entry point: `import { loadSounds } from "gamesounds"`.
 * Everything here is a re-export - `runtime.ts` owns the behaviour, `types.ts`
 * owns the data model - so this file is the one place that decides what is
 * public API and what stays internal.
 */
export { Bus, GameSounds, loadSounds } from "./runtime.js";
export type {
  DuckOptions,
  LoadOptions,
  ManifestSource,
  PlayHandle,
  PlayOptions,
  StopOptions,
} from "./runtime.js";

export {
  AUDIO_FORMATS,
  MANIFEST_SCHEMA_URL,
  MANIFEST_VERSION,
  STYLES,
} from "./types.js";
export type {
  AudioFile,
  AudioFormat,
  Category,
  License,
  Manifest,
  ManifestCredit,
  ManifestEvent,
  Measure,
  Origin,
  Rank,
  Sound,
  SoundSource,
  Style,
  Variant,
} from "./types.js";
