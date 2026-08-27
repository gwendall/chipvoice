import { openApiSpec } from "@/lib/openapi";
import { SITE } from "@/lib/songs";

export const runtime = "nodejs";

/**
 * The MCP tool list, derived from the spec.
 *
 * Written once, in OpenAPI, and turned into every surface that describes it.
 * A hand-maintained tool list is the copy that goes stale, and an agent has no
 * way to notice that it has.
 */
export function GET() {
  const spec = openApiSpec();
  const tools = [];

  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(
      operations as Record<string, {
        operationId?: string;
        summary?: string;
        description?: string;
        parameters?: Array<{ name: string; required?: boolean; schema?: unknown; description?: string }>;
        requestBody?: { content: Record<string, { schema: unknown }> };
      }>,
    )) {
      if (!op.operationId) continue;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const parameter of op.parameters ?? []) {
        properties[parameter.name] = {
          ...(parameter.schema as object),
          description: parameter.description,
        };
        if (parameter.required) required.push(parameter.name);
      }

      const body = op.requestBody?.content["application/json"]?.schema as
        | { properties?: Record<string, unknown>; required?: string[] }
        | undefined;
      if (body?.properties) {
        Object.assign(properties, body.properties);
        required.push(...(body.required ?? []));
      }

      tools.push({
        name: op.operationId,
        description: op.description ?? op.summary,
        method: method.toUpperCase(),
        path,
        inputSchema: { type: "object", properties, required },
      });
    }
  }

  return Response.json(
    {
      name: "chipvoice",
      description:
        "Write chiptune for an emulated NES sound chip as four lines of text. Returns a shareable link and an MP3.",
      version: "0.1.0",
      homepage: SITE,
      instructions: `${SITE}/skill.md`,
      openapi: `${SITE}/.well-known/openapi.json`,
      tools,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
