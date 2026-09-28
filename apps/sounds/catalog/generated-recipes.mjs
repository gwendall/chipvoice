// Procedurally generated sounds: packages/sfx-engine's 53 named presets
// (GS-02, decision 52), mapped onto the taxonomy (catalog/taxonomy.json).
// This is the generated-origin analogue of chipvoice-recipes.mjs - same
// idea (a hand-written map to categories/tags/style, a candidate ladder,
// VARIANTS_PER_GROUP survivors), different lever: chipvoice varies a
// hand-tuned shape plus a detune/duration/volume nudge; sfx-engine varies
// only its own seed (every model registers real per-seed jitter - see each
// model's own `seedJitter` metadata in packages/sfx-engine/src/presets/*.ts)
// so a plain incrementing seed ladder is enough, no escalating nudge needed.
//
// The style rule (docs/GAMESOUNDS.md's "Generated sounds" section has the
// full reasoning):
//   impact, footstep, whoosh, explosion -> realistic (all model real-world
//     physics: struck/rigid materials, walked surfaces, air movement, a
//     blast - see each model's own metadata.description).
//   scifi -> scifi (synthetic, not modeling anything real).
//   magic -> fantasy (spell/cast content, sparkle-layered).
//   ui -> minimal-ui (short, oscillator-only interface blips).
//   pickup -> judged per preset, not forced: pickup.ts's own header says
//     these are "deliberately not an 8-bit square-wave cliche" - warm,
//     bright tuned-oscillator arpeggios read as `cartoon` (coin, gem,
//     powerup, level-up), except `key`, the one physically-informed model
//     in the family (a struck-metal modal jingle), which is honestly
//     `realistic` like the impact/footstep/whoosh/explosion families it
//     shares its synthesis technique with. Nothing here is forced into
//     `cartoon`/`horror`/`cozy` to fill an empty facet - an empty facet
//     stays empty (see docs/GAMESOUNDS.md).
//
// Category choices that are not a mechanical rename of the preset id (every
// one is a genuine, existing taxonomy leaf - catalog/taxonomy.json - never a
// new category added just for this build):
//   - All 12 impact-* presets file under combat/hit ("impact, strike, hurt
//     hit"), EXCEPT impact-body-{light,heavy}, whose own description ("A
//     light/heavy body/punch impact") names combat/punch directly.
//   - whoosh-sword -> combat/sword (a swing IS the sword sound); whoosh-punch
//     -> combat/punch (alongside impact-body, distinguished by tag);
//     whoosh-pass-by and whoosh-cloth have no dedicated taxonomy leaf for a
//     generic air-movement cue, so both file under movement/dash (the
//     closest honest "burst of movement" leaf), distinguished by tag.
//   - scifi-shield-up/down -> combat/shield (an exact alias match: "shield
//     up"). scifi-power-up/down are a device/system cue, not a pickup, so
//     they file under world/machine-hum ("engine hum, drone, electric hum"),
//     not collect/powerup. scifi-computer-beep -> ui/confirm
//     ("acknowledgement" IS a confirm cue); scifi-zap has no dedicated
//     "electric" leaf, so it files under combat/hit tagged zap/electric.
//     scifi-teleport uses the magic/teleport category (a category about the
//     *event* - warp/blink - independent of the `scifi` style facet sitting
//     on top of it).
//   - magic-shimmer has no leaf of its own; it is a magic/cast variant
//     (tagged "shimmer" instead of "spell") per magic.ts's own description
//     ("cast, shimmer... layer a sparkle... over a gesture sweep").
//
// Every category below already exists in catalog/taxonomy.json; this file
// adds no new category.
export const SEED_LADDER = [1, 2, 3, 4, 5, 6, 7, 8];
export const VARIANTS_PER_GROUP = 4;

export const GENERATED_MAP = [
  // --- UI (9) - minimal-ui: short, oscillator-only interface blips ---
  { preset: "ui-click", category: "ui/click", style: "minimal-ui", tags: ["tap"], title: "Click", technique: "oscillator synthesis" },
  { preset: "ui-hover", category: "ui/hover", style: "minimal-ui", tags: ["rollover"], title: "Hover", technique: "oscillator synthesis" },
  { preset: "ui-confirm", category: "ui/confirm", style: "minimal-ui", tags: ["accept"], title: "Confirm", technique: "oscillator synthesis" },
  { preset: "ui-cancel", category: "ui/cancel", style: "minimal-ui", tags: ["no"], title: "Cancel", technique: "oscillator synthesis" },
  { preset: "ui-error", category: "ui/error", style: "minimal-ui", tags: ["denied"], title: "Error", technique: "oscillator synthesis" },
  { preset: "ui-toggle-on", category: "ui/toggle", style: "minimal-ui", tags: ["on"], title: "Toggle on", technique: "oscillator synthesis" },
  { preset: "ui-toggle-off", category: "ui/toggle", style: "minimal-ui", tags: ["off"], title: "Toggle off", technique: "oscillator synthesis" },
  { preset: "ui-notification", category: "ui/notification", style: "minimal-ui", tags: ["alert"], title: "Notification", technique: "oscillator synthesis" },
  { preset: "ui-text-blip", category: "ui/typewriter", style: "minimal-ui", tags: ["dialogue-tick"], title: "Text blip", technique: "oscillator synthesis" },

  // --- Impact (12) - realistic: modal synthesis (a bank of damped
  // resonant modes per struck material) ---
  { preset: "impact-wood-light", category: "combat/hit", style: "realistic", tags: ["wood", "light"], title: "Wood hit (light)", technique: "modal synthesis" },
  { preset: "impact-wood-heavy", category: "combat/hit", style: "realistic", tags: ["wood", "heavy"], title: "Wood hit (heavy)", technique: "modal synthesis" },
  { preset: "impact-metal-light", category: "combat/hit", style: "realistic", tags: ["metal", "light"], title: "Metal hit (light)", technique: "modal synthesis" },
  { preset: "impact-metal-heavy", category: "combat/hit", style: "realistic", tags: ["metal", "heavy"], title: "Metal hit (heavy)", technique: "modal synthesis" },
  { preset: "impact-stone-light", category: "combat/hit", style: "realistic", tags: ["stone", "light"], title: "Stone hit (light)", technique: "modal synthesis" },
  { preset: "impact-stone-heavy", category: "combat/hit", style: "realistic", tags: ["stone", "heavy"], title: "Stone hit (heavy)", technique: "modal synthesis" },
  { preset: "impact-glass-light", category: "combat/hit", style: "realistic", tags: ["glass", "light"], title: "Glass hit (light)", technique: "modal synthesis" },
  { preset: "impact-glass-heavy", category: "combat/hit", style: "realistic", tags: ["glass", "heavy"], title: "Glass hit (heavy)", technique: "modal synthesis" },
  { preset: "impact-plastic-light", category: "combat/hit", style: "realistic", tags: ["plastic", "light"], title: "Plastic hit (light)", technique: "modal synthesis" },
  { preset: "impact-plastic-heavy", category: "combat/hit", style: "realistic", tags: ["plastic", "heavy"], title: "Plastic hit (heavy)", technique: "modal synthesis" },
  { preset: "impact-body-light", category: "combat/punch", style: "realistic", tags: ["body", "light"], title: "Body hit (light)", technique: "modal synthesis" },
  { preset: "impact-body-heavy", category: "combat/punch", style: "realistic", tags: ["body", "heavy"], title: "Body hit (heavy)", technique: "modal synthesis" },

  // --- Footstep (7) - realistic: technique varies by surface (see each
  // preset's own technique label; footstep.ts's own metadata.description
  // has the full breakdown) ---
  { preset: "footstep-concrete", category: "movement/footstep", style: "realistic", tags: ["concrete"], title: "Footstep (concrete)", technique: "modal synthesis" },
  { preset: "footstep-wood", category: "movement/footstep", style: "realistic", tags: ["wood"], title: "Footstep (wood)", technique: "modal synthesis" },
  { preset: "footstep-grass", category: "movement/footstep", style: "realistic", tags: ["grass"], title: "Footstep (grass)", technique: "filtered noise" },
  { preset: "footstep-gravel", category: "movement/footstep", style: "realistic", tags: ["gravel"], title: "Footstep (gravel)", technique: "PhISEM particle-collision synthesis" },
  { preset: "footstep-snow", category: "movement/footstep", style: "realistic", tags: ["snow"], title: "Footstep (snow)", technique: "PhISEM particle-collision synthesis" },
  { preset: "footstep-metal", category: "movement/footstep", style: "realistic", tags: ["metal"], title: "Footstep (metal)", technique: "modal synthesis" },
  { preset: "footstep-water-puddle", category: "movement/footstep", style: "realistic", tags: ["water", "puddle"], title: "Footstep (water puddle)", technique: "a splash layered with bubble-model stream synthesis" },

  // --- Whoosh (4) - realistic: filtered, swept noise ---
  { preset: "whoosh-sword", category: "combat/sword", style: "realistic", tags: ["swing"], title: "Sword whoosh", technique: "filtered, swept noise" },
  { preset: "whoosh-punch", category: "combat/punch", style: "realistic", tags: ["whoosh"], title: "Punch whoosh", technique: "filtered, swept noise" },
  { preset: "whoosh-pass-by", category: "movement/dash", style: "realistic", tags: ["pass-by"], title: "Fast pass-by", technique: "filtered, swept noise" },
  { preset: "whoosh-cloth", category: "movement/dash", style: "realistic", tags: ["cloth"], title: "Cloth whoosh", technique: "filtered, swept noise" },

  // --- Explosion (3) - realistic: lowpassed noise boom plus a
  // sub-oscillator thump ---
  { preset: "explosion-small", category: "combat/explosion", style: "realistic", tags: ["small"], title: "Small explosion", technique: "filtered noise plus a sub-oscillator thump" },
  { preset: "explosion-big", category: "combat/explosion", style: "realistic", tags: ["big"], title: "Big explosion", technique: "filtered noise plus a sub-oscillator thump, with a debris tail" },
  { preset: "explosion-distant", category: "combat/explosion", style: "realistic", tags: ["distant"], title: "Distant explosion", technique: "filtered noise plus a sub-oscillator thump, with algorithmic reverb" },

  // --- Sci-fi (8) - scifi: synthetic, not modeling anything real ---
  { preset: "scifi-laser", category: "combat/shoot", style: "scifi", tags: ["laser"], title: "Laser shot", technique: "swept oscillator" },
  { preset: "scifi-zap", category: "combat/hit", style: "scifi", tags: ["zap", "electric"], title: "Electric zap", technique: "ring modulation" },
  { preset: "scifi-teleport", category: "magic/teleport", style: "scifi", tags: ["warp"], title: "Teleport (sci-fi)", technique: "a vibrato-swept shimmer with reverb" },
  { preset: "scifi-shield-up", category: "combat/shield", style: "scifi", tags: ["shield-up"], title: "Shield up", technique: "filtered sweep" },
  { preset: "scifi-shield-down", category: "combat/shield", style: "scifi", tags: ["shield-down"], title: "Shield down", technique: "filtered sweep" },
  { preset: "scifi-power-up", category: "world/machine-hum", style: "scifi", tags: ["power-up"], title: "Power up", technique: "filtered sweep" },
  { preset: "scifi-power-down", category: "world/machine-hum", style: "scifi", tags: ["power-down"], title: "Power down", technique: "filtered sweep" },
  { preset: "scifi-computer-beep", category: "ui/confirm", style: "scifi", tags: ["computer-beep"], title: "Computer beep", technique: "oscillator synthesis" },

  // --- Magic (5) - fantasy: sparkle layer over a gesture sweep ---
  { preset: "magic-cast", category: "magic/cast", style: "fantasy", tags: ["spell"], title: "Cast", technique: "sparkle layer over a gesture sweep" },
  { preset: "magic-shimmer", category: "magic/cast", style: "fantasy", tags: ["shimmer"], title: "Shimmer", technique: "sparkle layer" },
  { preset: "magic-heal", category: "magic/heal", style: "fantasy", tags: ["restore"], title: "Heal", technique: "sparkle layer over a gesture sweep, with warm reverb" },
  { preset: "magic-buff", category: "magic/buff", style: "fantasy", tags: ["power-boost"], title: "Buff", technique: "sparkle layer over a gesture sweep" },
  { preset: "magic-curse", category: "magic/debuff", style: "fantasy", tags: ["curse"], title: "Curse", technique: "dark filtered noise" },

  // --- Pickup (5) - judged per preset, not forced (see this file's header):
  // coin/gem/powerup/level-up are warm tuned-oscillator arpeggios, honestly
  // `cartoon`; key is the one physically-informed (modal metal) model in
  // the family, honestly `realistic` ---
  { preset: "pickup-coin", category: "collect/coin", style: "cartoon", tags: ["coin"], title: "Coin", technique: "tuned-oscillator arpeggio" },
  { preset: "pickup-gem", category: "collect/gem", style: "cartoon", tags: ["gem"], title: "Gem", technique: "tuned-oscillator arpeggio with a sparkle layer" },
  { preset: "pickup-key", category: "collect/key", style: "realistic", tags: ["key"], title: "Key", technique: "modal synthesis" },
  { preset: "pickup-powerup", category: "collect/powerup", style: "cartoon", tags: ["powerup"], title: "Power-up", technique: "tuned-oscillator arpeggio" },
  { preset: "pickup-level-up", category: "game/level-up", style: "cartoon", tags: ["level-up"], title: "Level up", technique: "tuned-oscillator arpeggio with a sparkle layer" },
];

/**
 * One entry's own ordered seed ladder: `recipeForPreset` (sfx-engine's own
 * factory) at 44.1kHz (docs/GAMESOUNDS-ENGINE.md's "Loudness convention
 * across engines" section: rendering at the catalogue's own sample rate
 * directly, not resampling later) for each seed in SEED_LADDER. Every model
 * registers real per-seed jitter (each model's own `metadata.seedJitter`),
 * so a plain incrementing seed ladder is expected to produce
 * VARIANTS_PER_GROUP distinct, audible takes well within SEED_LADDER's
 * length for every preset - build-catalog.mjs's renderGeneratedVariants
 * still keeps only the first ones that actually are, exactly like the
 * chipvoice half, rather than assuming it.
 */
export function generatedGroups(recipeForPreset) {
  return GENERATED_MAP.map((entry) => ({
    entry,
    candidates: SEED_LADDER.map((seed) => ({
      seed,
      recipe: recipeForPreset(entry.preset, seed, 44100),
    })),
  }));
}
