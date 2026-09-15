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
      "generate",
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
const oauthError = object({
  error: {
    enum: [
      "invalid_request",
      "invalid_grant",
      "unsupported_grant_type",
      "invalid_scope",
      "authorization_pending",
      "slow_down",
      "access_denied",
      "expired_token",
      "temporarily_unavailable",
    ],
  },
  error_description: text,
});
const oauthErrors = {
  "400": {
    description:
      "RFC 6749 section 5.2 body. authorization_pending and slow_down are routine while polling; access_denied, expired_token and invalid_grant are terminal.",
    content: json(oauthError),
  },
  "429": { description: "Rate limited. Honour Retry-After." },
  "503": { description: "Authorization service unavailable" },
};
export const artistPaths = {
  "/api/v1/oauth/device_authorization": {
    post: {
      operationId: "requestDeviceAuthorization",
      summary: "OAuth 2.0 device authorization (RFC 8628 section 3.1)",
      tags: ["artists"],
      description:
        "Standard device grant, discoverable at /.well-known/oauth-authorization-server. Form encoding is the standard; JSON is accepted. client_id is the agent's name as the owner will review it. scope is space-separated; omitted means every agent scope. Keep device_code private and show the owner only verification_uri_complete and user_code. Requests expire after ten minutes.",
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: object(
              {
                client_id: { type: "string", minLength: 1, maxLength: 60 },
                scope: {
                  type: "string",
                  description: "Space-separated agent scopes",
                },
              },
              ["client_id"],
            ),
          },
        },
      },
      responses: {
        "200": {
          description: "Device authorization response",
          content: json(
            object({
              device_code: text,
              user_code: text,
              verification_uri: text,
              verification_uri_complete: text,
              expires_in: { const: 600 },
              interval: { const: 5 },
            }),
          ),
        },
        ...oauthErrors,
      },
    },
  },
  "/api/v1/oauth/token": {
    post: {
      operationId: "exchangeDeviceCode",
      summary: "OAuth 2.0 token endpoint for the device grant (RFC 8628 section 3.4)",
      tags: ["artists"],
      description:
        "Poll with grant_type=urn:ietf:params:oauth:grant-type:device_code and device_code at most every five seconds; add five seconds on slow_down. The access token is delivered exactly once, expires after the period the owner chose, and is bound to one artist. Store it outside source control; a lost response requires a new authorization.",
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: object(
              {
                grant_type: {
                  const: "urn:ietf:params:oauth:grant-type:device_code",
                },
                device_code: text,
                client_id: text,
              },
              ["grant_type", "device_code"],
            ),
          },
        },
      },
      responses: {
        "200": {
          description: "Access token response (RFC 6749 section 5.1)",
          content: json(
            object({
              access_token: text,
              token_type: { const: "Bearer" },
              expires_in: { type: "integer" },
              scope: {
                type: "string",
                description: "Space-separated granted scopes",
              },
            }),
          ),
        },
        ...oauthErrors,
      },
    },
  },
  "/api/v1/agent-requests": {
    post: op(
      "requestAgentAccess",
      "Deprecated alias of /api/v1/oauth/device_authorization",
      object({
        requestToken: text,
        userCode: text,
        verificationUrl: text,
        expiresIn: { const: 600 },
        interval: { const: 5 },
      }),
      {
        deprecated: true,
        description:
          "The pairing API that preceded the standard device grant; same lifecycle, custom JSON field names. New agents use the OAuth endpoints. Keep requestToken private. Show the owner only verificationUrl and userCode. Requests expire after ten minutes.",
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
      "Deprecated alias of /api/v1/oauth/token",
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
        deprecated: true,
        description:
          "Poll at most every five seconds. Stop on invalid_token, denied, expired or consumed. On 429 honour Retry-After. Store the token outside source control; losing the one-time response requires a new authorization.",
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
