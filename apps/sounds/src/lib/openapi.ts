import { STYLES } from "./catalog";
import { SITE } from "./site";

/**
 * The spec, and the single source of truth for `/openapi.json`, `/llms.txt`,
 * `/skill.md` and `/.well-known/mcp.json` - one description of this API to
 * keep in sync, not four (mirrors apps/web's src/lib/openapi.ts, the same
 * approach for the same reason).
 */
const CATEGORY = {
  type: "object",
  properties: {
    id: { type: "string", description: 'Slash-separated: "movement/jump", or a bare top-level branch like "movement".' },
    title: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    parent: { type: "string", nullable: true },
  },
};

const VARIANT = {
  type: "object",
  properties: {
    n: { type: "integer", description: "1-based position among the sound's variants." },
    sha256: { type: "string" },
    duration: { type: "number" },
    files: {
      type: "object",
      properties: { ogg: { type: "string" }, mp3: { type: "string" }, wav: { type: "string" } },
      description: "Content-addressed, immutable paths: /f/<sha256>.<ext>.",
    },
    peaks: { type: "array", items: { type: "number" }, description: "96 points, 0 to 1, for an instant waveform." },
  },
};

const SOUND = {
  type: "object",
  properties: {
    id: { type: "string" },
    category: { type: "string" },
    style: { type: "string", enum: STYLES },
    tags: { type: "array", items: { type: "string" } },
    title: { type: "string" },
    description: { type: "string" },
    license: { type: "string", description: 'SPDX id. The launch catalogue is "CC0-1.0" only.' },
    attribution: { type: "string", nullable: true },
    source: {
      type: "object",
      properties: { name: { type: "string" }, url: { type: "string" }, author: { type: "string" }, pack: { type: "string" } },
    },
    origin: { type: "string", enum: ["curated", "chipvoice", "generated"] },
    loop: {
      type: "object",
      nullable: true,
      properties: { start: { type: "number" }, end: { type: "number" } },
      description: "Phase 1 ships no loop-flagged sound; always null.",
    },
    variants: { type: "array", items: VARIANT, minItems: 1, maxItems: 8 },
    measure: {
      type: "object",
      properties: { lufs: { type: "number" }, peakDb: { type: "number" }, duration: { type: "number" } },
    },
    rank: {
      type: "object",
      properties: {
        score: { type: "number" },
        votes: { type: "integer" },
        auditions: { type: "integer" },
        kept: { type: "integer" },
        replaced: { type: "integer" },
      },
      description: "Phase 1 always writes zeros; ranking and voting are phase 2.",
    },
  },
};

const MANIFEST_CREDIT = {
  type: "object",
  properties: {
    sound: { type: "string" },
    license: { type: "string" },
    author: { type: "string" },
    source: { type: "string" },
    attribution: { type: "string", nullable: true },
  },
};

const MANIFEST = {
  type: "object",
  description: "sounds.json shape, valid against GET /schema/manifest-1.json.",
  properties: {
    $schema: { type: "string" },
    version: { type: "integer", enum: [1] },
    base: { type: "string" },
    events: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          sound: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          fallback: { type: "array", items: { type: "string" } },
        },
      },
    },
    credits: { type: "array", items: MANIFEST_CREDIT },
  },
};

const RESOLVE_RESULT = {
  type: "object",
  properties: {
    manifest: MANIFEST,
    resolved: {
      type: "array",
      items: {
        type: "object",
        properties: { event: { type: "string" }, sound: { type: "string", nullable: true }, category: { type: "string", nullable: true } },
      },
    },
    unresolved: { type: "array", items: { type: "string" }, description: "Events that matched no category or had no candidate." },
  },
};

const PACK = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    style: { type: "string", enum: STYLES },
    events: { type: "array", items: { type: "string" } },
  },
};

export function openApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "gamesounds.ai",
      version: "0.1.0",
      description:
        "A game sound-effects bank filed by event, with 1 to 8 variants each, loudness-matched, every sound CC0-1.0. " +
        "Read-only, no authentication, open CORS: an agent (or a browser) calls this API directly, or uses the " +
        "gamesounds npm package's runtime and CLI, which call the same endpoints.",
      license: { name: "CC0-1.0" },
    },
    servers: [{ url: SITE }],
    paths: {
      "/api/v1/categories": {
        get: {
          operationId: "listCategories",
          summary: "The full taxonomy",
          description: "Every category, both taxonomy levels, each with its search aliases.",
          tags: ["catalogue"],
          responses: {
            "200": {
              description: "The taxonomy",
              content: { "application/json": { schema: { type: "object", properties: { categories: { type: "array", items: CATEGORY } } } } },
            },
          },
        },
      },
      "/api/v1/sounds": {
        get: {
          operationId: "searchSounds",
          summary: "Search sounds",
          description: 'Free-text search over title, description, category, tags and category aliases (e.g. "jewel" finds collect/gem).',
          tags: ["catalogue"],
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: 'Free text, e.g. "jump" or "8-bit coin".' },
            { name: "category", in: "query", schema: { type: "string" }, description: 'A category id, e.g. "movement/jump".' },
            { name: "style", in: "query", schema: { type: "string", enum: STYLES } },
            { name: "loop", in: "query", schema: { type: "boolean" }, description: "Phase 1 ships no loopable sound; true always returns none." },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
            { name: "cursor", in: "query", schema: { type: "integer", minimum: 0 }, description: "Offset into the ranked result list." },
          ],
          responses: {
            "200": {
              description: "A ranked page of sounds",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      sounds: { type: "array", items: SOUND },
                      total: { type: "integer" },
                      nextCursor: { type: "integer", nullable: true },
                    },
                  },
                },
              },
            },
            "422": { description: "Invalid cursor, style or limit" },
          },
        },
      },
      "/api/v1/sounds/{id}": {
        get: {
          operationId: "getSound",
          summary: "Fetch one sound",
          tags: ["catalogue"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "The sound", content: { "application/json": { schema: { type: "object", properties: { sound: SOUND } } } } },
            "404": { description: "No such sound" },
          },
        },
      },
      "/api/v1/sounds/{id}.zip": {
        get: {
          operationId: "downloadSound",
          summary: "Download every variant of one sound",
          description: "A zip of every variant's ogg, mp3 and wav files, plus a LICENSE.txt.",
          tags: ["catalogue"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "application/zip", content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
            "404": { description: "No such sound" },
          },
        },
      },
      "/api/v1/resolve": {
        post: {
          operationId: "resolveEvents",
          summary: "Resolve a list of game events to sounds",
          description:
            'Accepts a fully qualified category id ("ui/confirm"), a bare leaf name ("jump"), or "leaf/tag" ("hit/heavy"). ' +
            "Returns one sound per event (deterministic: highest-ranked, tie-broken by sound id) and a ready-to-write manifest.",
          tags: ["catalogue"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["events"],
                  properties: {
                    events: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 64 },
                    style: { type: "string", enum: STYLES },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Resolved (check `unresolved` for events with no match)", content: { "application/json": { schema: RESOLVE_RESULT } } },
            "422": { description: "Invalid body" },
            "429": { description: "Too many requests from this address" },
          },
        },
      },
      "/api/v1/packs": {
        get: {
          operationId: "listPacks",
          summary: "Every starter pack",
          tags: ["packs"],
          responses: {
            "200": { description: "The packs", content: { "application/json": { schema: { type: "object", properties: { packs: { type: "array", items: PACK } } } } } },
          },
        },
      },
      "/api/v1/packs/{id}": {
        get: {
          operationId: "getPack",
          summary: "One starter pack, resolved",
          tags: ["packs"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "The pack and its resolution",
              content: { "application/json": { schema: { type: "object", properties: { pack: PACK, manifest: MANIFEST, resolved: RESOLVE_RESULT.properties.resolved, unresolved: RESOLVE_RESULT.properties.unresolved } } } },
            },
            "404": { description: "No such pack" },
          },
        },
      },
      "/api/v1/packs/{id}.zip": {
        get: {
          operationId: "downloadPack",
          summary: "Download a whole pack",
          description: "A zip with one folder per event, each holding its resolved sound's every variant and format, plus a LICENSE.txt.",
          tags: ["packs"],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "application/zip", content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
            "404": { description: "No such pack" },
            "500": { description: "The pack has an event no sound currently resolves" },
          },
        },
      },
      "/schema/manifest-1.json": {
        get: {
          operationId: "getManifestSchema",
          summary: "The sounds.json JSON Schema",
          tags: ["catalogue"],
          responses: { "200": { description: "The schema", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    },
    components: {
      schemas: { Category: CATEGORY, Variant: VARIANT, Sound: SOUND, Manifest: MANIFEST, Pack: PACK },
    },
  };
}

/** Endpoint rows for llms.txt/skill.md, derived rather than written twice. */
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
