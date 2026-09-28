/**
 * Named starter packs: a style-coherent event list, resolved through the
 * same `resolveEvent`/`pickSoundForEvent` machinery POST /api/v1/resolve
 * uses (src/lib/catalog.ts), so a pack is never a second, diverging
 * resolution path. `docs/GAMESOUNDS.md`'s own spec names "8-bit platformer"
 * as the launch example (jump, land, coin, hit, death, powerup, ui/confirm,
 * ui/cancel); the Phase 1 acceptance bar requires every one of its events to
 * resolve to at least 3 candidates in the built catalogue before it ships
 * (test/packs.test.mjs proves it against generated/catalog.json).
 */
import type { Style } from "../../../packages/gamesounds/src/types.ts";

export interface PackDefinition {
  id: string;
  title: string;
  description: string;
  style: Style;
  events: string[];
}

export const PACKS: PackDefinition[] = [
  {
    id: "8-bit-platformer",
    title: "8-bit platformer",
    description: "The eight events a small 8-bit platformer needs: jump, land, coin, hit, death, power-up, confirm and cancel.",
    style: "8bit",
    events: ["movement/jump", "movement/land", "collect/coin", "combat/hit", "combat/death", "collect/powerup", "ui/confirm", "ui/cancel"],
  },
];

export function getPack(id: string): PackDefinition | null {
  return PACKS.find((p) => p.id === id) ?? null;
}
