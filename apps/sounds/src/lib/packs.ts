/**
 * Re-exports catalog/packs.ts under the `@/lib/*` alias, so every route and
 * page imports packs the same way it imports the catalogue
 * (src/lib/catalog.ts) - one relative path up out of src/ instead of a
 * different `../../../../..` on every file that needs a pack.
 */
export { getPack, PACKS, type PackDefinition } from "../../catalog/packs";
