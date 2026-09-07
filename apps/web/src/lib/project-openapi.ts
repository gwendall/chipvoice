import { PROJECT_SCHEMA } from "chipvoice";
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
  required: ["id", "project", "visibility"],
  properties: {
    id: { type: "string" },
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
const errors = {
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
  responses: { "200": { description: "Success" }, ...errors },
  ...extra,
});
export const projectPaths = {
  "/api/v1/validate": {
    post: operation(
      "validateProject",
      "Validate a complete project without saving",
      { requestBody: { required: true, content: json(PROJECT_SCHEMA) } },
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
        "409": { description: "Request key belongs to another document" },
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
          "200": { description: "Existing ready rendition" },
          "202": { description: "Queued or rendering job" },
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
      { parameters: [id] },
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
