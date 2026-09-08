import { z } from "zod";
import catalog from "../../../generated/agent-catalog.json";
import { compositionRequest } from "./score";
const text = { type: "string" }, nullableText = { type: ["string", "null"] };
const json = (schema: unknown) => ({ "application/json": { schema } });
const auth = [{ bearerAuth: [] }, { browserSession: [] }];
export function generationPaths(publication: unknown) {
  const request = z.toJSONSchema(compositionRequest, { io: "input" });
  request.properties!.target = { enum: catalog.targets.map(target => target.id) };
  const result = {
    type: "object",
    properties: {
      id: text, status: { enum: ["queued", "composing", "validating", "saving", "rendering", "ready", "failed", "cancelled"] },
      model: text, request, createdAt: { type: "integer" }, error: nullableText,
      projectId: nullableText, renderJobId: nullableText,
      project: { anyOf: [publication, { type: "null" }] },
      render: { type: ["object", "null"], description: "Existing full render job: status, progress, WAV/MP3 and page URLs" },
      evaluation: { type: ["object", "null"], description: "Full allocation plan; audio measurements cover the first two seconds only" },
      usage: { type: ["object", "null"] },
    },
  };
  const errors = Object.fromEntries([401, 403, 404, 409, 422, 429, 503].map(status => [String(status), { description: "Explicit authentication, input, admission or availability error" }]));
  return {
    "/api/v1/generations": { post: {
      operationId: "generateComposition", summary: "Compose with the configured model and save a normal private song",
      description: "Requires server OPENAI_API_KEY; agents need generate, projects:write and render. Defaults to GPT-6 Astra. The prompt stays owner-only. Poll the generation, then use the existing project and audio URLs. No duplicate storage or automatic public posting.",
      security: auth,
      parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 80 } }],
      requestBody: { required: true, content: json(request) },
      responses: { "200": { description: "Existing completed request", content: json(result) }, "202": { description: "Composition accepted or in progress", content: json(result) }, ...errors },
    } },
    "/api/v1/generations/{id}": {
      get: { operationId: "getGeneration", summary: "Read composition progress and normal song/audio references", security: auth,
        parameters: [{ name: "id", in: "path", required: true, schema: text }],
        responses: { "200": { description: "Authorized generation, including prompt and evaluation", content: json(result) }, ...errors } },
      delete: { operationId: "cancelGeneration", summary: "Cancel model work and its unfinished render", security: auth,
        parameters: [{ name: "id", in: "path", required: true, schema: text }],
        responses: { "200": { description: "Cancelled request", content: json(result) }, ...errors } },
    },
  };
}
