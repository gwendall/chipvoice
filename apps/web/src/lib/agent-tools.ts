import { openApiSpec } from "./openapi";
import { SITE } from "./songs";
import catalog from "../../generated/agent-catalog.json";

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  security?: unknown;
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    schema?: unknown;
    description?: string;
  }[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: unknown }>;
  };
  responses?: unknown;
};
/** HTTP tool discovery, not a JSON-RPC MCP server. Bind request locations
 * separately: a header such as Idempotency-Key must never enter the JSON body. */
export function agentManifest() {
  const spec = openApiSpec();
  const tools = Object.entries(spec.paths).flatMap(([path, operations]) =>
    Object.entries(operations as Record<string, Operation>)
      .filter(([, op]) => op.operationId)
      .map(([method, op]) => {
        const properties: Record<string, unknown> = {},
          required: string[] = [];
        for (const location of ["path", "query", "header", "cookie"]) {
          const parameters =
            op.parameters?.filter((p) => p.in === location) ?? [];
          if (!parameters.length) continue;
          const key = location === "header" ? "headers" : location;
          const mandatory = parameters
            .filter((p) => p.required)
            .map((p) => p.name);
          properties[key] = {
            type: "object",
            properties: Object.fromEntries(
              parameters.map((p) => [
                p.name,
                { ...(p.schema as object), description: p.description },
              ]),
            ),
            required: mandatory,
            additionalProperties: false,
          };
          if (mandatory.length) required.push(key);
        }
        const body = op.requestBody?.content["application/json"]?.schema;
        if (body) {
          properties.body = body;
          if (op.requestBody?.required) required.push("body");
        }
        return {
          name: op.operationId,
          description: op.description ?? op.summary,
          method: method.toUpperCase(),
          path,
          security: op.security ?? [],
          inputSchema: {
            type: "object",
            properties,
            required,
            additionalProperties: false,
          },
          responses: op.responses,
        };
      }),
  );
  return {
    name: "chipvoice",
    description:
      "Compose, evaluate, adapt and publish complete multi-instrument music for emulated retro chips.",
    version: "0.2.0",
    engineVersion: catalog.engineVersion,
    transport: "http-discovery",
    binding:
      "path substitutes URL segments; query encodes the query string; headers sets HTTP headers; body is the exact JSON request body. Configure Bearer/session credentials separately from generated music.",
    homepage: SITE,
    instructions: `${SITE}/skill.md`,
    capabilities: `${SITE}/api/v1/capabilities`,
    openapi: `${SITE}/.well-known/openapi.json`,
    tools,
  };
}
