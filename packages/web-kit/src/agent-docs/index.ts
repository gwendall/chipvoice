export type OpenApiParameter = {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
  description?: string;
};
export type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  security?: unknown;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: unknown }>;
  };
  responses?: unknown;
};
export type OpenApiSpec = {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: unknown;
};

export interface AgentManifestAuthorization {
  authorizationServer: string;
  resourceMetadata: string;
  grantTypesSupported: string[];
}

export interface AgentManifestConfig {
  spec: OpenApiSpec;
  name: string;
  description: string;
  version: string;
  engineVersion?: string;
  homepage: string;
  instructionsUrl: string;
  capabilitiesUrl: string;
  openapiUrl: string;
  /** What `path`/`query`/`headers`/`body` mean in each tool's `inputSchema`. */
  binding?: string;
  authorization?: AgentManifestAuthorization;
}

const DEFAULT_BINDING =
  "path substitutes URL segments; query encodes the query string; headers sets HTTP headers; body is the exact JSON request body.";

/** HTTP tool discovery, not a JSON-RPC MCP server: converts an OpenAPI spec's
 * operations (every one carrying an `operationId`) into a flat tool list a
 * coding agent can call directly. Bind request locations separately: a
 * header such as Idempotency-Key must never enter the JSON body. */
export function agentManifest(config: AgentManifestConfig) {
  const tools = Object.entries(config.spec.paths).flatMap(([path, operations]) =>
    Object.entries(operations)
      .filter(([, op]) => op.operationId)
      .map(([method, op]) => {
        const properties: Record<string, unknown> = {},
          required: string[] = [];
        for (const location of ["path", "query", "header", "cookie"]) {
          const parameters = op.parameters?.filter((p) => p.in === location) ?? [];
          if (!parameters.length) continue;
          const key = location === "header" ? "headers" : location;
          const mandatory = parameters.filter((p) => p.required).map((p) => p.name);
          properties[key] = {
            type: "object",
            properties: Object.fromEntries(
              parameters.map((p) => [p.name, { ...(p.schema as object), description: p.description }]),
            ),
            required: mandatory,
            additionalProperties: false,
          };
          if (mandatory.length) required.push(key);
        }
        // Endpoints that accept both JSON and form encoding (OAuth's, for example).
        const body =
          op.requestBody?.content["application/json"]?.schema ??
          op.requestBody?.content["application/x-www-form-urlencoded"]?.schema;
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
    name: config.name,
    description: config.description,
    version: config.version,
    ...(config.engineVersion !== undefined ? { engineVersion: config.engineVersion } : {}),
    transport: "http-discovery",
    binding: config.binding ?? DEFAULT_BINDING,
    homepage: config.homepage,
    instructions: config.instructionsUrl,
    capabilities: config.capabilitiesUrl,
    openapi: config.openapiUrl,
    ...(config.authorization
      ? {
          authorization: {
            authorization_server: config.authorization.authorizationServer,
            resource_metadata: config.authorization.resourceMetadata,
            grant_types_supported: config.authorization.grantTypesSupported,
          },
        }
      : {}),
    components: config.spec.components,
    tools,
  };
}
