import { agentManifest as sharedAgentManifest } from "web-kit/agent-docs";
import { openApiSpec } from "./openapi";
import { SITE } from "./site";

/**
 * gamesounds.ai's configuration of `web-kit/agent-docs`'s `agentManifest`,
 * served at /.well-known/mcp.json. No `authorization` block: every endpoint
 * here is public and keyless (spec: "Reads need no key, send open CORS").
 * `capabilitiesUrl` points at GET /api/v1/categories, the closest thing this
 * catalogue-only API has to an introspection endpoint - the full taxonomy an
 * agent needs before it can pick a category to search or resolve.
 */
export function agentManifest() {
  return sharedAgentManifest({
    spec: openApiSpec(),
    name: "gamesounds.ai",
    description: "A game sound-effects bank filed by event, with variants, consistent loudness and a clear licence. Every sound is CC0-1.0.",
    version: "0.1.0",
    homepage: SITE,
    instructionsUrl: `${SITE}/skill.md`,
    capabilitiesUrl: `${SITE}/api/v1/categories`,
    openapiUrl: `${SITE}/openapi.json`,
  });
}
