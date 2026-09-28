import { agentManifest as sharedAgentManifest } from "web-kit/agent-docs";
import { openApiSpec } from "./openapi";
import { DEVICE_GRANT_TYPE, PROTECTED_RESOURCE_METADATA_PATH } from "./oauth";
import { SITE } from "./songs";
import catalog from "../../generated/agent-catalog.json";

/**
 * chipvoice's own configuration of `web-kit/agent-docs`'s `agentManifest`:
 * its OpenAPI spec, name/version/engine metadata and the "Configure
 * Bearer/session credentials separately from generated music" sentence the
 * generic package's default binding text does not include, so it is passed
 * through explicitly here to keep the manifest unchanged from before this
 * package existed.
 */
export function agentManifest() {
  return sharedAgentManifest({
    spec: openApiSpec(),
    name: "chipvoice",
    description:
      "Compose, evaluate, adapt and publish complete multi-instrument music for emulated retro chips.",
    version: "0.2.0",
    engineVersion: catalog.engineVersion,
    binding:
      "path substitutes URL segments; query encodes the query string; headers sets HTTP headers; body is the exact JSON request body. Configure Bearer/session credentials separately from generated music.",
    homepage: SITE,
    instructionsUrl: `${SITE}/skill.md`,
    capabilitiesUrl: `${SITE}/api/v1/capabilities`,
    openapiUrl: `${SITE}/.well-known/openapi.json`,
    authorization: {
      authorizationServer: `${SITE}/.well-known/oauth-authorization-server`,
      resourceMetadata: `${SITE}${PROTECTED_RESOURCE_METADATA_PATH}`,
      grantTypesSupported: [DEVICE_GRANT_TYPE],
    },
  });
}
