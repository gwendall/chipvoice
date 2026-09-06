import { z } from "zod";
import { INTENTS, type BassIntent, type ChordIntent, type LeadIntent, type PercIntent } from "chipvoice";

const words = <W extends string>(role: keyof typeof INTENTS) => z.enum(Object.keys(INTENTS[role]) as [W, ...W[]]);

/**
 * An intent: a word per role for what it should sound like, from the
 * library's catalogue. The catalogue is the one source; the enum here, the
 * OpenAPI schema and the skill's table are all read from it.
 */
export const IntentSchema = z
  .object({
    lead: words<LeadIntent>("lead"),
    chord: words<ChordIntent>("chord"),
    bass: words<BassIntent>("bass"),
    perc: words<PercIntent>("perc"),
  })
  .partial();

/**
 * The wire format, which is deliberately the tracker format.
 *
 * An agent writes four lines of text. Nothing here is a note object or a MIDI
 * event: the point of the whole project is that a song is something you can
 * read, diff, paste into a message and hand to a model.
 */
export const PatternSchema = z.object({
  bass: z.string().max(4096),
  lead: z.string().max(4096),
  chord: z.string().max(4096),
  perc: z.string().max(4096),
  chordShape: z.array(z.array(z.number().int()).min(1).max(32)).min(1).max(256),
});

export const SongInput = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  bpm: z.number().int().min(40).max(300),
  patterns: z.array(PatternSchema).min(1).max(16),
  order: z.array(z.number().int().min(0)).min(1).max(64),
  /** Which of the five shipped machines arranges this score. */
  chip: z.enum(["2a03", "dmg", "md", "snes", "c64"]).default("2a03"),
  /** What each role should sound like. Absent roles take the default word. */
  intent: IntentSchema.optional(),
  /** Free-form. Meant for an agent to say who or what made it. */
  author: z.string().trim().max(60).optional(),
});

export type SongInput = z.infer<typeof SongInput>;

export const RenderQuery = z.object({
  /** Integer durations bound public render variants. Longer exports run locally. */
  seconds: z.coerce.number().int().min(1).max(30).optional(),
});

/** The short id: base62, eight characters. */
export const SongId = z.string().regex(/^[0-9A-Za-z]{8}$/, "not a chipvoice id");
