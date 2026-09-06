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
      enum: ["2a03", "dmg", "md", "snes", "c64"],
      default: "2a03",
      description: "The NES's Ricoh 2A03, the Game Boy's DMG APU, the Mega Drive's YM2612 and SN76489, the SNES's S-DSP, or the C64's SID. The same four lines play on any, in its own idiom.",
    },
    intent: INTENT_BODY,
    order: {
      type: "array", minItems:1, maxItems:64,
      items: { type: "integer", minimum: 0 },
      description: "Which patterns play, in which order. Repeats are how a song gets long.",
    },
    patterns: {
      type: "array",
      minItems: 1, maxItems:16,
      items: {
        type: "object",
        required: ["bass", "lead", "chord", "perc", "chordShape"],
        properties: {
          lead: { type: "string", maxLength:4096, description: "Melody. One token per sixteenth." },
          chord: { type: "string", maxLength:4096, description: "Harmony, arpeggiated by chordShape." },
          bass: { type: "string", maxLength:4096, description: "Bass. Its token count sets the pattern length." },
          perc: { type: "string", maxLength:4096, description: "Drums. K kick, S snare, H hat, O open hat." },
          chordShape: {
            type: "array",
            minItems:1, maxItems:256,
            items: { type: "array", minItems:1, maxItems:32, items: { type: "integer" } },
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
    code: {type:"string",description:"For example pitch_range"},
    pattern: {type:"integer",description:"Pattern index, zero-based"},
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
        "Five machines: the NES's 2A03, the Game Boy's APU, the Mega Drive's YM2612 with its PSG the SNES's S-DSP and the C64's SID, each emulated at the clock level; what has been verified " +
        "against reference emulators, test ROMs or physical recordings is on each chip's conformance sheet under https://github.com/gwendall/chipvoice/blob/main/docs/chips/",
      license: { name: "MIT AND LGPL-2.1-or-later" },
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
        delete: {
          operationId: "deleteSong",
          summary: "Withdraw a song you published",
          description:
            "Any active key or browser session of the publishing account may withdraw it. The row stays so its forks keep their parent, but the page and the audio stop being served. A song published anonymously cannot be withdrawn by anyone - which is the honest cost of publishing without a key.",
          tags: ["songs"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Withdrawn" },
            "403": { description: "Published by another account, or anonymously" },
            "404": { description: "No such song" },
          },
        },
      },
      "/api/songs/{id}/fork": {
        post: {
          operationId: "forkSong",
          summary: "Copy a song with changes",
          description:
            "Send only what differs - a fork changing one line does not restate the other three. The copy keeps a link back to its parent. Null clears title, author or intent; unchanged inherited patterns retain compatibility with earlier publication limits.",
          tags: ["songs"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: false, content: { "application/json": { schema: { ...SONG_BODY, required: [], properties:{...SONG_BODY.properties,title:{anyOf:[SONG_BODY.properties.title,{type:"null"}]},author:{anyOf:[SONG_BODY.properties.author,{type:"null"}]},intent:{anyOf:[INTENT_BODY,{type:"null"}]}} } } } },
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
            "Rendered by the current engine in a worker. Stable URLs revalidate with ETags; bounded per-instance caching shares identical jobs. Deletion is checked even on cache hits.",
          tags: ["audio"],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            {
              name: "seconds",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 30 },
              description: "Defaults to two loops; if that exceeds 30 seconds, returns 422. Use an explicit duration or export locally.",
            },
          ],
          responses: { "200": { description: "audio/mpeg" }, "304": {description:"ETag unchanged"}, "400": {description:"Invalid duration"}, "404": { description: "No such song" }, "422": {description:"Default duration exceeds 30 seconds"}, "429": {description:"Cold render limit reached"}, "503": {description:"Worker busy or unavailable; retry after Retry-After"} },
        },
      },
      "/api/auth/signin": {
        post: { operationId: "signIn", summary: "Email a single-use browser sign-in link", tags: ["identity"], requestBody: {required:true,content:{"application/json":{schema:{type:"object",required:["email"],properties:{email:{type:"string",format:"email",maxLength:254}}}}}}, responses:{"202":{description:"Link sent; valid for 30 minutes"},"503":{description:"Database or email unavailable"},"429":{description:"Rate limited"}} },
      },
      "/api/auth/redeem": {
        get: { operationId: "redeemSignIn", summary: "Consume the link and set an HttpOnly session cookie", tags:["identity"], parameters:[{name:"token",in:"query",required:true,schema:{type:"string"}}], responses:{"302":{description:"Redirect home; valid tokens establish a 30-day session without changing API keys"}} },
      },
      "/api/auth/session": {
        delete: { operationId: "signOut", summary: "Revoke the current browser session", tags:["identity"], responses:{"200":{description:"Signed out"},"403":{description:"Cross-origin request refused"}} },
      },
      "/api/keys/{id}": {
        delete: {operationId:"revokeKey",summary:"Revoke one of your API keys; retain song ownership",tags:["identity"],parameters:[{name:"id",in:"path",required:true,schema:{type:"string"}}],responses:{"200":{description:"Revoked"},"401":{description:"Not signed in"},"404":{description:"No such key on this account"}}},
      },
      "/api/keys": {
        get: {operationId:"listKeys",summary:"List up to 100 account keys without secrets",tags:["identity"],responses:{"200":{description:"Key metadata"},"401":{description:"Not signed in"}}},
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
          summary: "The latest 50 songs this account has published",
          description:
            "Keys and browser sessions share a stable account. Reissuing a key to the same email retains access to prior publications. Anonymous publications cannot be claimed later.",
          tags: ["identity"],
          responses: {
            "200": { description: "Your songs, newest first" },
            "401": { description: "No active key or session" },
          },
        },
      },
      "/s/{id}.wav": {
        get: {
          operationId: "getWav",
          summary: "The same audio, lossless",
          description: "Same 1–30 integer seconds parameter, two-loop default, ETag revalidation and render limits as MP3.",
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
                "Whether the publication belongs to an authenticated account. This does not verify the free-text author name. The field is free text, so without this it is a claim rather than a credit.",
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
