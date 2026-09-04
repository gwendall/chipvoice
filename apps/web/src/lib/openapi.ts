import { INTENTS } from "chipvoice";
import { SITE } from "./songs";

/**
 * The spec, and the single source of truth for every documentation surface.
 *
 * `/skill.md`, `/llms.txt` and the MCP manifest are all derived from this - the
 * same approach domani settled on, for the same reason: three hand-written
 * descriptions of one API is three things to forget to update, and the one that
 * goes stale is always the one an agent is reading.
 */
const INTENT_BODY = {
  type: "object",
  description:
    "What each role should sound like: a word from the catalogue, the same words on every chip, each chip playing them in its own idiom. A role left out takes the default. " +
    Object.entries(INTENTS)
      .map(([role, ws]) => `${role}: ${Object.entries(ws).map(([w, what]) => `"${w}" (${what})`).join(", ")}`)
      .join(". "),
  properties: Object.fromEntries(
    Object.entries(INTENTS).map(([role, ws]) => [role, { type: "string", enum: Object.keys(ws), default: Object.keys(ws)[0] }]),
  ),
};

const SONG_BODY = {
  type: "object",
  required: ["bpm", "patterns", "order"],
  properties: {
    title: { type: "string", maxLength: 80 },
    author: { type: "string", maxLength: 60, description: "Who or what made it" },
    bpm: { type: "integer", minimum: 40, maximum: 300 },
    chip: {
      type: "string",
      enum: ["2a03", "dmg", "md"],
      default: "2a03",
      description: "The NES's Ricoh 2A03, the Game Boy's DMG APU, or the Mega Drive's YM2612 and SN76489. The same four lines play on any, in its own idiom.",
    },
    intent: INTENT_BODY,
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
        "Write music for the sound chips of the old machines as four lines of text, get back a link and an MP3. " +
        "Three chips: the NES's 2A03, the Game Boy's APU and the Mega Drive's YM2612 with its PSG, each emulated at the clock level; what has been verified " +
        "against the hardware is on each chip's conformance sheet under https://github.com/gwendall/chipvoice/blob/main/docs/chips/",
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
      "/api/songs/{id}/delete": {
        delete: {
          operationId: "deleteSong",
          summary: "Withdraw a song you published",
          description:
            "Only the key that published it may withdraw it. The row stays so its forks keep their parent, but the page and the audio stop being served. A song published anonymously cannot be withdrawn by anyone - which is the honest cost of publishing without a key.",
          tags: ["songs"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Withdrawn" },
            "403": { description: "Published with another key, or anonymously" },
            "404": { description: "No such song" },
          },
        },
      },
      "/api/keys": {
        post: {
          operationId: "requestKey",
          summary: "Get a key, by email",
          description:
            "The key is emailed rather than returned: a secret in a response body ends up in a proxy log and a shell history, and whoever asked for it cannot tell which. A key raises the write limit from 20 a minute to 240, marks your songs as verifiably yours, and is what makes GET /api/me possible.",
          tags: ["identity"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", format: "email" },
                    label: { type: "string", description: "What it is for, so you can tell keys apart" },
                  },
                },
              },
            },
          },
          responses: { "202": { description: "On its way" }, "422": { description: "Not an email address" } },
        },
      },
      "/api/me": {
        get: {
          operationId: "listMySongs",
          summary: "Everything this key has published",
          description:
            "Without a key a lost id is a lost song, permanently - nothing anywhere records that you made it.",
          tags: ["identity"],
          responses: {
            "200": { description: "Your songs, newest first" },
            "401": { description: "No key" },
          },
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
            depth: { type: "integer", description: "0 for an original, 1 for its fork" },
            rootId: { type: "string", description: "The first ancestor. Fetch the whole family with it" },
            authorVerified: {
              type: "boolean",
              description:
                "Whether `author` came from a request carrying a key. The field is free text, so without this it is a claim rather than a credit.",
            },
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
