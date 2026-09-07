import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildAgentCatalog } from "./agent-catalog.mjs";
await mkdir("generated", { recursive: true });
const catalog = JSON.stringify(buildAgentCatalog());
await writeFile("generated/agent-catalog.json", catalog);
// Preserve floating-point register bounds through bundlers that shorten JSON numbers.
await writeFile("generated/agent-catalog-text.json", JSON.stringify(catalog));
await writeFile(
  "generated/agent-example.json",
  JSON.stringify(
    await readFile("../../docs/examples/compose-project.mjs", "utf8"),
  ),
);
