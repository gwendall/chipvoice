import { SITE } from "./songs";

/**
 * The spec, and the single source of truth for every documentation surface.
 *
 * `/skill.md`, `/llms.txt` and the MCP manifest are all derived from this - the
 * same approach domani settled on, for the same reason: three hand-written
 * descriptions of one API is three things to forget to update, and the one that
 * goes stale is always the one an agent is reading.
 */
const SONG_BODY = {
  type: "object",
  required: ["bpm", "patterns", "order"],
  properties: {
    title: { type: "string", maxLength: 80 },
    author: { type: "string", maxLength: 60, description: "Who or what made it" },
    bpm: { type: "integer", minimum: 40, maximum: 300 },
    chip: { type: "string", enum: ["2a03"], default: "2a03" },
    order: {
      type: "array",
      items: { type: "integer", minimum: 0 },
      description: "Which patterns play, in which order. Repeats are how a song gets long.",
    },
    patterns: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["bass", "lead", "chord", "perc", "chordShape"],
        properties: {
          lead: { type: "string", description: "Pulse 1. One token per sixteenth." },
          chord: { type: "string", description: "Pulse 2, arpeggiated by chordShape." },
          bass: { type: "string", description: "Triangle. Its token count sets the pattern length." },
          perc: { type: "string", description: "Noise. K kick, S snare, H hat, O open hat." },
          chordShape: {
            type: "array",
            items: { type: "array", items: { type: "integer" } },
            description: "Semitones each chord note is arpeggiated through. [[0,3,7]] minor, [[0,4,7]] major.",
          },
        },
      },
    },
  },
} as const;

const ISSUE = {
  type: "object",
  properties: {
    level: { type: "string", enum: ["error", "warning"] },
    track: { type: "string" },
    step: { type: "integer", description: "Which sixteenth, zero-based" },
    token: { type: "string" },
    message: { type: "string" },
    silent: {
      type: "boolean",
      description:
        "True when the mistake produces no sound and no error. A mistyped note resolves to 0 Hz and is scheduled as nothing, so the only evidence is a hole in the piece.",
    },
  },
} as const;

export function openApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "chipvoice",
      version: "0.1.0",
      description:
        "Write music for a real NES sound chip as four lines of text, get back a link and an MP3. " +
        "The chip is emulated cycle by cycle, so what comes out is what the hardware would have made.",
      license: { name: "MIT" },
    },
    servers: [{ url: SITE }],
    paths: {
      "/api/validate": {
        post: {
          operationId: "validateSong",
          summary: "Check a song without storing it",
          description:
            "Call this while writing. It is free, unlimited, and returns the same issue shape as the store route, so nothing changes shape at the moment you commit.",
          tags: ["songs"],
          requestBody: { required: true, content: { "application/json": { schema: SONG_BODY } } },
          responses: {
            "200": {
              description: "Valid. May still carry warnings.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      issues: { type: "array", items: ISSUE },
                      measured: { $ref: "#/components/schemas/Measured" },
                    },
                  },
                },
              },
            },
            "422": { description: "Invalid. `issues` says what to change." },
          },
        },
      },
      "/api/songs": {
        post: {
          operationId: "createSong",
          summary: "Store a song and get its links",
          description: "Validates first. Returns a short id, a page, an MP3 and a WAV.",
          tags: ["songs"],
          requestBody: { required: true, content: { "application/json": { schema: SONG_BODY } } },
          responses: {
            "201": { description: "Stored", content: { "application/json": { schema: { $ref: "#/components/schemas/Song" } } } },
            "422": { description: "Invalid" },
            "429": { description: "Too many writes from this address" },
          },
        },
      },
      "/api/songs/{id}": {
        get: {
          operationId: "getSong",
          summary: "Fetch a song",
          tags: ["songs"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The song", content: { "application/json": { schema: { $ref: "#/components/schemas/Song" } } } },
            "404": { description: "No such song" },
          },
        },
      },
      "/api/songs/{id}/fork": {
        post: {
          operationId: "forkSong",
          summary: "Copy a song with changes",
          description:
            "Send only what differs - a fork changing one line does not restate the other three. The copy keeps a link back to its parent.",
          tags: ["songs"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: false, content: { "application/json": { schema: SONG_BODY } } },
          responses: {
            "201": { description: "The fork", content: { "application/json": { schema: { $ref: "#/components/schemas/Song" } } } },
            "404": { description: "No such parent" },
          },
        },
      },
      "/s/{id}.mp3": {
        get: {
          operationId: "getMp3",
          summary: "The audio, rendered on request",
          description:
            "Computed rather than stored: the chip is a pure function, so the same id always produces the same bytes. Cached forever. Plays in anything that plays an MP3.",
          tags: ["audio"],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            {
              name: "seconds",
              in: "query",
              required: false,
              schema: { type: "number", minimum: 1, maximum: 300 },
              description: "Defaults to two times round the loop.",
            },
          ],
          responses: { "200": { description: "audio/mpeg" }, "404": { description: "No such song" } },
        },
      },
      "/s/{id}.wav": {
        get: {
          operationId: "getWav",
          summary: "The same audio, lossless",
          tags: ["audio"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "audio/wav" } },
        },
      },
    },
    components: {
      schemas: {
        Measured: {
          type: "object",
          properties: {
            loopSeconds: { type: "number", description: "One time round, at the song's tempo" },
            onsetsPerSecond: { type: "number", description: "Notes and hits per second, all channels" },
            range: { type: "integer", description: "Melodic range in semitones" },
            steps: { type: "integer" },
          },
        },
        Song: {
          type: "object",
          properties: {
            id: { type: "string" },
            parentId: { type: "string", nullable: true },
            title: { type: "string", nullable: true },
            bpm: { type: "integer" },
            url: { type: "string" },
            mp3: { type: "string" },
            wav: { type: "string" },
            forks: { type: "integer" },
            measured: { $ref: "#/components/schemas/Measured" },
            issues: { type: "array", items: ISSUE },
          },
        },
        Issue: ISSUE,
      },
    },
  };
}

/** Endpoint rows for the skill, derived rather than written twice. */
export function endpointRows() {
  const spec = openApiSpec();
  const rows: Array<{ method: string; path: string; summary: string }> = [];
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(operations as Record<string, { summary?: string }>)) {
      rows.push({ method: method.toUpperCase(), path, summary: operation.summary ?? "" });
    }
  }
  return rows;
}
