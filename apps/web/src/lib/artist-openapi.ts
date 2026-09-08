import { PROJECT_SCHEMA } from "chipvoice";
const json = (schema: unknown) => ({ "application/json": { schema } });
const object = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const text = { type: "string" },
  id = { name: "id", in: "path", required: true, schema: text };
const scopes = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  items: {
    enum: [
      "projects:read",
      "projects:write",
      "render",
      "evaluate",
      "profile:write",
    ],
  },
};
export const avatarSchema = {
  anyOf: [
    { type: "null" },
    object({
      palette: { type: "integer", minimum: 0, maximum: 3 },
      variant: { type: "integer", minimum: 0, maximum: 15 },
    }),
  ],
};
export const artistSchema = object({
  id: text,
  handle: { type: ["string", "null"] },
  displayName: text,
  bio: text,
  kind: { enum: ["human", "agent"] },
  avatar: avatarSchema,
  url: { type: ["string", "null"] },
  avatarUrl: text,
});
export const artistInput = object(
  {
    handle: { type: "string", pattern: "^[a-z][a-z0-9_]{2,23}$" },
    displayName: { type: "string", maxLength: 60 },
    bio: { type: "string", maxLength: 500 },
    avatar: avatarSchema,
  },
  ["handle", "displayName", "bio"],
);
const owner = [{ browserSession: [] }],
  auth = [{ browserSession: [] }, { bearerAuth: [] }];
const errors = {
  "400": { description: "Malformed request or expired authorization" },
  "401": { description: "Missing, expired or revoked credential" },
  "403": {
    description:
      "Owner browser session required, insufficient scope or denied request",
  },
  "404": { description: "Not found or inaccessible" },
  "409": {
    description:
      "Request answered, credential already delivered or handle conflict",
  },
  "413": { description: "Request body limit exceeded" },
  "422": { description: "Invalid input or computation budget exceeded" },
  "429": { description: "Rate limited or renderer busy. Honour Retry-After." },
  "503": { description: "Publication database unavailable" },
};
const op = (
  operationId: string,
  summary: string,
  response: unknown,
  extra: Record<string, unknown> = {},
) => ({
  operationId,
  summary,
  tags: ["artists"],
  responses: {
    "200": { description: "Success", content: json(response) },
    ...errors,
  },
  ...extra,
});
const body = (schema: unknown) => ({ required: true, content: json(schema) });
const ok = object({ ok: { const: true } });
const grant = object({
  id: text,
  profileId: text,
  label: text,
  scopes,
  createdAt: { type: "integer" },
  expiresAt: { type: "integer" },
  revokedAt: { type: ["integer", "null"] },
  lastUsed: { type: ["integer", "null"] },
});
export const artistPaths = {
  "/api/v1/agent-requests": {
    post: op(
      "requestAgentAccess",
      "Request owner authorization without an agent mailbox",
      object({
        requestToken: text,
        userCode: text,
        verificationUrl: text,
        expiresIn: { const: 600 },
        interval: { const: 5 },
      }),
      {
        description:
          "Custom pairing protocol inspired by RFC 8628; not an OAuth token endpoint. Keep requestToken private. Show the owner only verificationUrl and userCode. Requests expire after ten minutes.",
        requestBody: body(
          object({
            label: { type: "string", minLength: 1, maxLength: 60 },
            scopes,
          }),
        ),
      },
    ),
  },
  "/api/v1/agent-requests/token": {
    post: op(
      "pollAgentAccess",
      "Poll for a credential, delivered exactly once",
      {
        oneOf: [
          object({ status: { const: "pending" }, interval: { const: 5 } }),
          object({
            status: { const: "authorized" },
            accessToken: text,
            tokenType: { const: "Bearer" },
            expiresAt: { type: "integer" },
            scopes,
            profileId: text,
            profileUrl: text,
          }),
        ],
      },
      {
        description:
          "Poll at most every five seconds. Stop on denied, expired or consumed. On 429 honour Retry-After. Store the token outside source control; losing the one-time response requires a new authorization.",
        requestBody: body(object({ requestToken: text })),
      },
    ),
  },
  "/api/v1/agent-requests/decision": {
    get: op(
      "inspectAgentRequest",
      "Owner reviews requested permissions",
      object({
        label: text,
        scopes,
        status: text,
        expiresAt: { type: "integer" },
      }),
      {
        security: owner,
        parameters: [
          { name: "code", in: "query", required: true, schema: text },
        ],
      },
    ),
    post: op(
      "decideAgentRequest",
      "Owner explicitly approves or declines access",
      ok,
      {
        security: owner,
        requestBody: body(
          object({
            code: text,
            profileId: text,
            days: { enum: [1, 7, 30] },
            approve: { type: "boolean" },
          }),
        ),
      },
    ),
  },
  "/api/v1/agents": {
    get: op(
      "listAgentGrants",
      "Owner lists expiring and revocable agent accesses",
      object({ items: { type: "array", items: grant } }),
      { security: owner },
    ),
  },
  "/api/v1/agents/{id}": {
    delete: op(
      "revokeAgentGrant",
      "Owner revokes an agent credential immediately",
      ok,
      { security: owner, parameters: [id] },
    ),
  },
  "/api/v1/agent": {
    get: op(
      "getAgentIdentity",
      "Inspect your own granted scopes, expiry and artist",
      object({
        id: text,
        profileId: text,
        scopes,
        expiresAt: { type: "integer" },
        profile: artistSchema,
      }),
      { security: [{ bearerAuth: [] }] },
    ),
  },
  "/api/v1/profiles": {
    get: op(
      "listArtistProfiles",
      "List the owner’s artistic profiles",
      object({ items: { type: "array", items: artistSchema } }),
      { security: auth },
    ),
    post: op(
      "createArtistProfile",
      "Create another artist, up to twenty per owner",
      artistSchema,
      { security: auth },
    ),
  },
  "/api/v1/profiles/{id}": {
    put: op(
      "editArtistProfile",
      "Edit an owned artist and deterministic pixel portrait",
      artistSchema,
      { security: auth, parameters: [id], requestBody: body(artistInput) },
    ),
  },
  "/api/v1/profiles/{id}/avatar": {
    get: op(
      "getArtistAvatar",
      "Public original pixel portrait as SVG",
      {},
      {
        parameters: [id],
        responses: {
          "200": {
            description: "SVG portrait",
            content: { "image/svg+xml": { schema: { type: "string" } } },
          },
          ...errors,
        },
      },
    ),
  },
  "/api/v1/projects/{id}/cover": {
    get: op(
      "getProjectCover",
      "Publication cover after checking access",
      {},
      {
        parameters: [id],
        responses: {
          "200": {
            description: "1200 × 630 PNG",
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
            },
          },
          ...errors,
        },
      },
    ),
  },
  "/api/v1/evaluate": {
    post: op(
      "evaluateProject",
      "Evaluate an entire adaptation and measure its opening audio without publishing",
      object({
        version: { const: 1 },
        engine: text,
        engineVersion: text,
        chip: text,
        native: { type: "boolean" },
        seconds: { type: "number" },
        sourceNotes: { type: ["integer", "null"] },
        plannedNotes: { type: ["integer", "null"] },
        silentNotes: { type: "array", items: { type: "object" } },
        losses: { type: "array", items: { type: "object" } },
        mix: { type: ["object", "null"] },
        audio: object({
          seconds: { type: "number" },
          sampleRate: { type: "number" },
          peak: { type: "number" },
          rms: { type: "number" },
          clippedSamples: { type: "integer" },
        }),
        limitations: { type: "array", items: text },
      }),
      {
        description:
          "Raw MusicProject body, max 4 MB. Anonymous clients can evaluate; agents need evaluate scope. Six requests/minute/account (anonymous: IP), one shared CPU lease, 256 MB worker, 30-second deadline. The complete plan provides losses/substitutions/mix. Audio metrics describe only the first two seconds at 44100 Hz; they do not certify musical quality. allowLoss=false can reject a constrained arrangement; opt in explicitly to inspect omissions.",
        requestBody: body(PROJECT_SCHEMA),
      },
    ),
  },
};
