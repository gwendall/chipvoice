import { test } from "node:test";
import assert from "node:assert/strict";
import { agentManifest } from "../dist/agent-docs/index.js";

const spec = {
  paths: {
    "/songs/{id}": {
      get: {
        operationId: "getSong",
        summary: "Fetch a song",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Song id" },
          { name: "format", in: "query", schema: { type: "string" } },
          { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "ok" } },
      },
      // No operationId: must be excluded from the tool list entirely.
      delete: {
        summary: "Undocumented internal delete",
        responses: { 204: { description: "ok" } },
      },
    },
    "/songs": {
      post: {
        operationId: "createSong",
        description: "Create a song",
        security: [{ bearer: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" } } } } },
        },
        responses: { 201: { description: "created" } },
      },
    },
  },
  components: { schemas: {} },
};

test("agentManifest converts an OpenAPI spec into a flat tool list", () => {
  const manifest = agentManifest({
    spec,
    name: "test-app",
    description: "A test app",
    version: "1.0.0",
    homepage: "https://example.test",
    instructionsUrl: "https://example.test/skill.md",
    capabilitiesUrl: "https://example.test/api/v1/capabilities",
    openapiUrl: "https://example.test/api/v1/openapi.json",
  });
  assert.equal(manifest.name, "test-app");
  assert.equal(manifest.transport, "http-discovery");
  assert.equal(manifest.tools.length, 2, "the operation with no operationId must be excluded");
  const get = manifest.tools.find((tool) => tool.name === "getSong");
  assert.equal(get.method, "GET");
  assert.equal(get.path, "/songs/{id}");
  assert.deepEqual(get.inputSchema.required.sort(), ["headers", "path"]);
  assert.deepEqual(Object.keys(get.inputSchema.properties.path.properties), ["id"]);
  assert.deepEqual(get.inputSchema.properties.path.required, ["id"]);
  assert.deepEqual(Object.keys(get.inputSchema.properties.query.properties), ["format"]);
  assert.deepEqual(get.inputSchema.properties.query.required, []);
  assert.deepEqual(Object.keys(get.inputSchema.properties.headers.properties), ["Idempotency-Key"]);

  const post = manifest.tools.find((tool) => tool.name === "createSong");
  assert.equal(post.method, "POST");
  assert.deepEqual(post.security, [{ bearer: [] }]);
  assert.ok(post.inputSchema.required.includes("body"), "a required requestBody must mark body required");
  assert.deepEqual(post.inputSchema.properties.body, { type: "object", properties: { title: { type: "string" } } });
});

test("agentManifest omits engineVersion and authorization when not configured, and includes them when they are", () => {
  const bare = agentManifest({
    spec: { paths: {} },
    name: "bare",
    description: "d",
    version: "1.0.0",
    homepage: "https://example.test",
    instructionsUrl: "https://example.test/skill.md",
    capabilitiesUrl: "https://example.test/api/v1/capabilities",
    openapiUrl: "https://example.test/api/v1/openapi.json",
  });
  assert.equal("engineVersion" in bare, false);
  assert.equal("authorization" in bare, false);
  assert.deepEqual(bare.tools, []);

  const configured = agentManifest({
    spec: { paths: {} },
    name: "configured",
    description: "d",
    version: "1.0.0",
    engineVersion: "2026.9.1",
    homepage: "https://example.test",
    instructionsUrl: "https://example.test/skill.md",
    capabilitiesUrl: "https://example.test/api/v1/capabilities",
    openapiUrl: "https://example.test/api/v1/openapi.json",
    authorization: {
      authorizationServer: "https://example.test",
      resourceMetadata: "https://example.test/.well-known/oauth-protected-resource/api/v1",
      grantTypesSupported: ["urn:ietf:params:oauth:grant-type:device_code"],
    },
  });
  assert.equal(configured.engineVersion, "2026.9.1");
  assert.deepEqual(configured.authorization, {
    authorization_server: "https://example.test",
    resource_metadata: "https://example.test/.well-known/oauth-protected-resource/api/v1",
    grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code"],
  });
});

test("agentManifest falls back to the default binding text unless one is configured", () => {
  const spec2 = { paths: {} };
  const withoutBinding = agentManifest({
    spec: spec2,
    name: "n",
    description: "d",
    version: "1.0.0",
    homepage: "https://example.test",
    instructionsUrl: "https://example.test/skill.md",
    capabilitiesUrl: "https://example.test/api/v1/capabilities",
    openapiUrl: "https://example.test/api/v1/openapi.json",
  });
  assert.match(withoutBinding.binding, /path substitutes URL segments/);
  const withBinding = agentManifest({
    spec: spec2,
    name: "n",
    description: "d",
    version: "1.0.0",
    homepage: "https://example.test",
    instructionsUrl: "https://example.test/skill.md",
    capabilitiesUrl: "https://example.test/api/v1/capabilities",
    openapiUrl: "https://example.test/api/v1/openapi.json",
    binding: "custom binding text",
  });
  assert.equal(withBinding.binding, "custom binding text");
});
