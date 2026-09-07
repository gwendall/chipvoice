import { PROJECT_SCHEMA, CHIP_IDS } from "chipvoice";
const json = (schema: unknown) => ({ "application/json": { schema } });
const id = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};
const auth = [{ bearerAuth: [] }, { browserSession: [] }];
const response = {
  type: "object",
  required: [
    "id",
    "parentId",
    "rootId",
    "title",
    "chip",
    "tags",
    "visibility",
    "createdAt",
    "contentHash",
    "profile",
    "favourites",
    "favourited",
    "owned",
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    chip: { enum: CHIP_IDS },
    tags: { type: "array", items: { type: "string" } },
    createdAt: { type: "integer", description: "Unix milliseconds" },
    favourites: { type: "integer" },
    favourited: { type: "boolean" },
    owned: { type: "boolean" },
    renditions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind", "status", "engine"],
        properties: {
          id: { type: "string" },
          kind: { enum: ["preview", "full"] },
          status: { type: "string" },
          engine: { type: "string" },
        },
      },
    },
    parentId: { type: ["string", "null"] },
    rootId: { type: "string" },
    project: PROJECT_SCHEMA,
    visibility: { enum: ["public", "unlisted", "private"] },
    contentHash: { type: "string" },
    profile: {
      type: "object",
      properties: {
        id: { type: "string" },
        handle: { type: ["string", "null"] },
        displayName: { type: "string" },
        bio: { type: "string" },
      },
    },
  },
  additionalProperties: true,
};
const jobResponse = {
  type: "object",
  required: [
    "id",
    "projectId",
    "kind",
    "status",
    "engine",
    "progress",
    "bytes",
    "error",
    "audio",
  ],
  properties: {
    id: { type: "string" },
    projectId: { type: "string" },
    kind: { enum: ["preview", "full"] },
    status: {
      enum: [
        "queued",
        "rendering",
        "cancelling",
        "cancelled",
        "ready",
        "failed",
      ],
    },
    engine: { type: "string", description: "SHA-256 of the bundled renderer" },
    progress: { type: "number", minimum: 0, maximum: 1 },
    bytes: { type: "integer" },
    error: { type: ["string", "null"] },
    audio: { type: ["string", "null"] },
  },
};
const issues = {
  type: "array",
  items: {
    type: "object",
    required: ["path", "code", "message", "level"],
    properties: {
      path: { type: "string" },
      code: { type: "string" },
      message: { type: "string" },
      level: { enum: ["error", "warning"] },
    },
  },
};
const validation = {
  type: "object",
  required: ["ok", "issues"],
  properties: { ok: { type: "boolean" }, issues },
};
const successSchemas: Record<string, unknown> = {
  validateProject: validation,
  listProjects: {
    type: "object",
    required: ["items", "cursor"],
    properties: {
      items: { type: "array", items: response },
      cursor: { type: ["string", "null"] },
    },
  },
  getProject: response,
  favouriteProject: response,
  unfavouriteProject: response,
  getProfile: response.properties.profile,
  editProfile: response.properties.profile,
  getProjectJob: jobResponse,
};
const errors = {
  "400": { description: "Malformed request or cursor" },
  "409": { description: "Conflicting request key, handle or audio state" },
  "401": { description: "Sign in required" },
  "404": { description: "Not found or inaccessible" },
  "413": { description: "Body exceeds 4 MB" },
  "422": {
    description: "Invalid data; issues include path/code/message/level",
  },
  "429": { description: "Shared account rate limit; Retry-After" },
  "503": { description: "Publication service unavailable" },
};
const operation = (
  operationId: string,
  summary: string,
  extra: Record<string, unknown> = {},
) => ({
  operationId,
  summary,
  tags: ["projects"],
  responses: {
    "200": {
      description: "Success",
      content: json(
        successSchemas[operationId] ?? {
          type: "object",
          required: ["ok"],
          properties: { ok: { const: true } },
        },
      ),
    },
    ...errors,
  },
  ...extra,
});
export const projectPaths = {
  "/api/v1/capabilities": {
    get: operation(
      "getProjectCapabilities",
      "Discover generated machine voices, instruments and project schema",
      {
        description:
          "Public, database-independent build catalogue. Discover targets dynamically; inspect resource conflicts, eligible voices and substitutions before composing.",
        responses: {
          "200": {
            description: "Current generated capabilities",
            content: json({
              type: "object",
              required: [
                "version",
                "engineVersion",
                "contentHash",
                "targets",
                "projectSchema",
              ],
              properties: {
                version: { const: 1 },
                engineVersion: { type: "string" },
                contentHash: { type: "string" },
                semantics: { type: "object" },
                projectSchemaVersion: { const: 1 },
                projectSchema: { type: "object" },
                targets: {
                  type: "array",
                  items: {
                    type: "object",
                    required: [
                      "id",
                      "voices",
                      "voiceConflicts",
                      "melodicPalette",
                    ],
                    properties: {
                      id: { type: "string" },
                      system: { type: "string" },
                      voices: { type: "array", items: { type: "object" } },
                      voiceConflicts: {
                        type: "array",
                        items: { type: "array", items: { type: "string" } },
                      },
                      melodicPalette: {
                        type: "array",
                        items: { type: "object" },
                      },
                      percussionVoices: {
                        type: "array",
                        items: { type: "string" },
                      },
                      excludedPerformanceVoices: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
                },
              },
            }),
          },
        },
      },
    ),
  },
  "/api/v1/validate": {
    post: operation(
      "validateProject",
      "Validate a complete project without saving",
      {
        requestBody: { required: true, content: json(PROJECT_SCHEMA) },
        responses: {
          "200": { description: "Valid", content: json(validation) },
          "422": { description: "Invalid project", content: json(validation) },
          "400": errors["400"],
          "413": errors["413"],
        },
      },
    ),
  },
  "/api/v1/projects": {
    get: operation("listProjects", "Search public active publications", {
      parameters: [
        "q",
        "chip",
        "tag",
        "handle",
        "sort",
        "cursor",
        "mine",
        "favourites",
      ].map((name) => ({
        name,
        in: "query",
        schema: { type: "string" },
        description:
          name === "sort"
            ? "recent or popular (last seven days)"
            : name === "mine" || name === "favourites"
              ? "1 enables this account-only filter"
              : "Optional filter or pagination cursor",
      })),
    }),
    post: operation("publishProject", "Publish an immutable project revision", {
      security: auth,
      parameters: [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", minLength: 8, maxLength: 80 },
        },
      ],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          required: ["project"],
          additionalProperties: false,
          properties: {
            project: PROJECT_SCHEMA,
            visibility: {
              enum: ["public", "unlisted", "private"],
              default: "public",
            },
            parentId: { type: "string" },
          },
        }),
      },
      responses: {
        "201": {
          description: "Published or identical retry",
          content: json(response),
        },
        ...errors,
      },
    }),
  },
  "/api/v1/projects/{id}": {
    get: operation("getProject", "Fetch an accessible complete publication", {
      parameters: [id],
    }),
    delete: operation("withdrawProject", "Withdraw your publication", {
      parameters: [id],
      security: auth,
    }),
  },
  "/api/v1/projects/{id}/favourite": {
    put: operation("favouriteProject", "Save a public song by another author", {
      parameters: [id],
      security: auth,
    }),
    delete: operation("unfavouriteProject", "Remove your favourite", {
      parameters: [id],
      security: auth,
    }),
  },
  "/api/v1/projects/{id}/report": {
    post: operation("reportProject", "Report an accessible publication", {
      parameters: [id],
      security: auth,
      requestBody: {
        required: true,
        content: json({
          type: "object",
          required: ["reason"],
          additionalProperties: false,
          properties: {
            reason: { type: "string", minLength: 3, maxLength: 500 },
          },
        }),
      },
    }),
  },
  "/api/v1/projects/{id}/render": {
    post: operation(
      "renderProject",
      "Queue an immutable preview or complete WAV",
      {
        parameters: [id],
        security: auth,
        description:
          "Preview: up to 30 seconds. Full: complete source, max 40 MB and 240 seconds processing. Poll the returned job; exceeding limits fails explicitly.",
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["kind"],
            additionalProperties: false,
            properties: { kind: { enum: ["preview", "full"] } },
          }),
        },
        responses: {
          "200": {
            description: "Existing ready rendition",
            content: json(jobResponse),
          },
          "202": {
            description: "Queued or rendering job",
            content: json(jobResponse),
          },
          ...errors,
        },
      },
    ),
  },
  "/api/v1/jobs/{id}": {
    get: operation(
      "getProjectJob",
      "Read job status, progress and pinned audio URL",
      { parameters: [id] },
    ),
    delete: operation(
      "cancelProjectJob",
      "Cancel your queued or running render",
      { parameters: [id], security: auth },
    ),
  },
  "/api/v1/jobs/{id}/audio": {
    get: operation(
      "downloadProjectAudio",
      "Download ready WAV after checking publication access",
      {
        parameters: [id],
        responses: {
          "200": {
            description: "Pinned WAV",
            content: {
              "audio/wav": { schema: { type: "string", format: "binary" } },
            },
          },
          ...errors,
        },
      },
    ),
  },
  "/api/v1/profile": {
    get: operation(
      "getProfile",
      "Your public profile, without email or authentication IDs",
      { security: auth },
    ),
    put: operation(
      "editProfile",
      "Reserve a unique handle and edit your profile",
      {
        security: auth,
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["handle", "displayName", "bio"],
            additionalProperties: false,
            properties: {
              handle: { type: "string", pattern: "^[a-z][a-z0-9_]{2,23}$" },
              displayName: { type: "string", maxLength: 60 },
              bio: { type: "string", maxLength: 500 },
            },
          }),
        },
      },
    ),
  },
};
