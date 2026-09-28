// How a raw file inside a curated source archive becomes one variant of one
// catalogue Sound. Each source gets an ordered list of rules; the first
// whose `test` matches the file's base name (extension stripped, and any
// trailing take-number digits stripped - see `baseNameFor`) wins. A file
// matched by no rule is skipped, not forced into the nearest category.
//
// This file's coverage is proven, not assumed: test/mapping.test.mjs walks
// every real extracted file under apps/sounds/.artifacts/sounds/extracted/*
// (built by `pnpm sounds:fetch`) through `mapFile` and fails if any non-junk
// file (audio, not a Preview/License/desktop.ini) comes back unmapped. Rules
// below were written by reading that same file listing, not guessed.
//
// `group(name)` is the key numbered takes are pooled under to become one
// Sound's variants (spec's Variant model, 1-8 takes of the same idea). It
// defaults to category+style+tags; a rule overrides it with `group` when
// several distinctly-named files should share one Sound (see the voiceover
// packs, where e.g. "you_win" and "mission_completed" are both the win
// line).

function rule(test, category, style, tags, opts = {}) {
  return { test, category, style, tags, ...opts };
}

function prefix(...names) {
  const set = new Set(names.map((n) => n.toLowerCase()));
  return (base) => set.has(base.toLowerCase());
}

const KENNEY_IMPACT_SOUNDS = [
  rule(prefix("footstep_carpet"), "movement/footstep", "realistic", ["carpet"]),
  rule(prefix("footstep_concrete"), "movement/footstep", "realistic", ["concrete"]),
  rule(prefix("footstep_grass"), "movement/footstep", "realistic", ["grass"]),
  rule(prefix("footstep_snow"), "movement/footstep", "realistic", ["snow"]),
  rule(prefix("footstep_wood"), "movement/footstep", "realistic", ["wood"]),
  rule(prefix("impactGlass_heavy"), "objects/glass-break", "realistic", ["heavy"]),
  rule(prefix("impactGlass_light"), "objects/glass-break", "realistic", ["light"]),
  rule(prefix("impactGlass_medium"), "objects/glass-break", "realistic", ["medium"]),
  rule(prefix("impactPunch_heavy"), "combat/punch", "realistic", ["heavy"]),
  rule(prefix("impactPunch_medium"), "combat/punch", "realistic", ["medium"]),
  rule(prefix("impactBell_heavy"), "combat/hit", "realistic", ["bell", "heavy"]),
  rule(prefix("impactGeneric_light"), "combat/hit", "realistic", ["generic", "light"]),
  rule(prefix("impactMetal_heavy"), "combat/hit", "realistic", ["metal", "heavy"]),
  rule(prefix("impactMetal_light"), "combat/hit", "realistic", ["metal", "light"]),
  rule(prefix("impactMetal_medium"), "combat/hit", "realistic", ["metal", "medium"]),
  rule(prefix("impactMining"), "combat/hit", "realistic", ["mining"]),
  rule(prefix("impactPlank_medium"), "combat/hit", "realistic", ["plank", "medium"]),
  rule(prefix("impactPlate_heavy"), "combat/hit", "realistic", ["plate", "heavy"]),
  rule(prefix("impactPlate_light"), "combat/hit", "realistic", ["plate", "light"]),
  rule(prefix("impactPlate_medium"), "combat/hit", "realistic", ["plate", "medium"]),
  rule(prefix("impactSoft_heavy"), "combat/hit", "realistic", ["soft", "heavy"]),
  rule(prefix("impactSoft_medium"), "combat/hit", "realistic", ["soft", "medium"]),
  rule(prefix("impactTin_medium"), "combat/hit", "realistic", ["tin", "medium"]),
  rule(prefix("impactWood_heavy"), "combat/hit", "realistic", ["wood", "heavy"]),
  rule(prefix("impactWood_light"), "combat/hit", "realistic", ["wood", "light"]),
  rule(prefix("impactWood_medium"), "combat/hit", "realistic", ["wood", "medium"]),
];

const KENNEY_UI_AUDIO = [
  rule(prefix("click"), "ui/click", "minimal-ui", []),
  rule(prefix("mouseclick"), "ui/click", "minimal-ui", ["mouse"]),
  rule(prefix("mouserelease"), "ui/click", "minimal-ui", ["release"]),
  rule(prefix("rollover"), "ui/hover", "minimal-ui", []),
  rule(prefix("switch"), "ui/toggle", "minimal-ui", ["switch"]),
];

const KENNEY_RPG_AUDIO = [
  rule(prefix("footstep"), "movement/footstep", "fantasy", ["boot"]),
  rule(prefix("doorOpen"), "objects/door", "fantasy", ["open"]),
  rule(prefix("doorClose"), "objects/door", "fantasy", ["close"]),
  rule(prefix("creak"), "objects/door", "fantasy", ["creak"]),
  rule(prefix("chop"), "combat/sword", "fantasy", ["chop"]),
  rule(prefix("drawKnife"), "combat/sword", "fantasy", ["draw", "knife"]),
  rule(prefix("knifeSlice"), "combat/sword", "fantasy", ["slice", "knife"]),
  rule(prefix("handleCoins"), "collect/coin", "fantasy", ["handle"]),
  rule(prefix("handleSmallLeather"), "objects/pickup", "fantasy", ["leather"]),
  rule(prefix("dropLeather"), "objects/drop", "fantasy", ["leather"]),
  rule(prefix("beltHandle"), "objects/pickup", "fantasy", ["belt"]),
  rule(prefix("clothBelt"), "objects/pickup", "fantasy", ["cloth", "belt"]),
  rule(prefix("cloth"), "objects/pickup", "fantasy", ["cloth"]),
  rule(prefix("bookOpen"), "ui/open", "fantasy", ["book"]),
  rule(prefix("bookClose"), "ui/close", "fantasy", ["book"]),
  rule(prefix("bookFlip"), "ui/tab", "fantasy", ["book", "page-flip"]),
  rule(prefix("bookPlace"), "objects/drop", "fantasy", ["book"]),
  rule(prefix("metalClick"), "objects/switch", "fantasy", ["metal", "click"]),
  rule(prefix("metalLatch"), "objects/door", "fantasy", ["latch"]),
  rule(prefix("metalPot"), "objects/drop", "fantasy", ["pot", "metal"]),
];

const KENNEY_SCI_FI_SOUNDS = [
  rule(prefix("computerNoise"), "ui/notification", "scifi", ["computer"]),
  rule(prefix("doorOpen"), "objects/door", "scifi", ["open"]),
  rule(prefix("doorClose"), "objects/door", "scifi", ["close"]),
  rule(prefix("explosionCrunch"), "combat/explosion", "scifi", ["crunch"]),
  rule(prefix("lowFrequency_explosion"), "combat/explosion", "scifi", ["low", "big"]),
  rule(prefix("forceField"), "combat/shield", "scifi", ["forcefield"]),
  rule(prefix("impactMetal"), "combat/hit", "scifi", ["metal"]),
  rule(prefix("laserLarge"), "combat/shoot", "scifi", ["laser", "large"]),
  rule(prefix("laserSmall"), "combat/shoot", "scifi", ["laser", "small"]),
  rule(prefix("laserRetro"), "combat/shoot", "scifi", ["laser", "retro"]),
  rule(prefix("slime"), "voice/monster", "scifi", ["slime", "squish"]),
  rule(prefix("engineCircular"), "world/machine-hum", "scifi", ["engine", "circular"]),
  rule(prefix("spaceEngineLarge"), "world/machine-hum", "scifi", ["engine", "space", "large"]),
  rule(prefix("spaceEngineLow"), "world/machine-hum", "scifi", ["engine", "space", "low"]),
  rule(prefix("spaceEngineSmall"), "world/machine-hum", "scifi", ["engine", "space", "small"]),
  rule(prefix("spaceEngine"), "world/machine-hum", "scifi", ["engine", "space"]),
  rule(prefix("thrusterFire"), "world/machine-hum", "scifi", ["thruster"]),
];

const KENNEY_DIGITAL_AUDIO = [
  rule(prefix("highUp"), "ui/notification", "minimal-ui", ["tone", "digital", "up"]),
  rule(prefix("highDown"), "ui/notification", "minimal-ui", ["tone", "digital", "down"]),
  rule(prefix("lowDown"), "ui/notification", "minimal-ui", ["tone", "digital", "down"]),
  rule(prefix("lowRandom"), "ui/notification", "minimal-ui", ["tone", "digital"]),
  rule(prefix("lowThreeTone"), "ui/notification", "minimal-ui", ["tone", "digital"]),
  rule(prefix("threeTone"), "ui/notification", "minimal-ui", ["tone", "digital"]),
  rule(prefix("zapTwoTone"), "magic/cast", "scifi", ["zap", "electric"]),
  rule(prefix("twoTone"), "ui/notification", "minimal-ui", ["tone", "digital"]),
  rule(prefix("tone"), "ui/notification", "minimal-ui", ["tone", "digital"]),
  rule(prefix("laser"), "combat/shoot", "scifi", ["laser"]),
  rule(prefix("pepSound"), "collect/powerup", "arcade", ["pep"]),
  rule(prefix("phaseJump"), "movement/jump", "scifi", ["phase"]),
  rule(prefix("phaserDown"), "combat/shoot", "scifi", ["phaser", "down"]),
  rule(prefix("phaserUp"), "combat/shoot", "scifi", ["phaser", "up"]),
  rule(prefix("powerUp"), "collect/powerup", "arcade", ["digital"]),
  rule(prefix("spaceTrash"), "world/machine-hum", "scifi", ["debris"]),
  rule(prefix("zapThreeToneDown"), "magic/cast", "scifi", ["zap", "electric", "down"]),
  rule(prefix("zapThreeToneUp"), "magic/cast", "scifi", ["zap", "electric", "up"]),
  rule(prefix("zap"), "magic/cast", "scifi", ["zap", "electric"]),
];

/** 17 phrase numbers (00-16) in five timbres; each timbre is a style, and the
 * 17 numbers split by index across the game/ flow categories - the filenames
 * carry no semantic label beyond timbre and number, so this split is an
 * explicit, documented, deterministic choice (catalog/sources/kenney-music-jingles.json).
 * Unlike every other source, digits here are load-bearing, so this source is
 * exempted from `baseNameFor`'s generic take-number stripping. */
const JINGLE_TIMBRE_STYLE = { HIT: "arcade", NES: "8bit", PIZZI: "cozy", SAX: "realistic", STEEL: "16bit" };
function jingleCategory(index) {
  if (index <= 3) return "game/win";
  if (index <= 7) return "game/level-up";
  if (index <= 11) return "game/achievement";
  if (index <= 14) return "game/game-over";
  return "game/checkpoint";
}
const KENNEY_MUSIC_JINGLES = [
  rule(
    (b) => /^jingles_(HIT|NES|PIZZI|SAX|STEEL)\d{2}$/.test(b),
    null,
    null,
    [],
    {
      resolve(base) {
        const m = base.match(/^jingles_(HIT|NES|PIZZI|SAX|STEEL)(\d{2})$/);
        const timbre = m[1];
        const index = parseInt(m[2], 10);
        return { category: jingleCategory(index), style: JINGLE_TIMBRE_STYLE[timbre], tags: [timbre.toLowerCase()], group: `${jingleCategory(index)}::${timbre}`, take: index };
      },
    },
  ),
];

/** Spoken English lines: filed under game/, ui/ and collect/ as voice-styled
 * alternatives, never under voice/ (the taxonomy defines voice/ as
 * non-verbal). See catalog/sources/kenney-voiceover-pack.json. Both spoken
 * takes (Male/Female folders) of the same word are pooled into one Sound's
 * variants by `group`. */
const KENNEY_VOICEOVER_PACK = [
  rule((b) => /^([1-9]|10)$/.test(b), "game/countdown", "realistic", ["voice", "number"], { resolve: (b) => ({ category: "game/countdown", style: "realistic", tags: ["voice", "number"], group: "game/countdown::number", take: parseInt(b, 10) }) }),
  rule(prefix("level_up"), "game/level-up", "realistic", ["voice"], { group: "game/level-up::voice" }),
  rule(prefix("level"), "game/level-up", "realistic", ["voice", "word"], { group: "game/level-up::word" }),
  rule(prefix("game_over"), "game/game-over", "realistic", ["voice"], { group: "game/game-over::voice" }),
  rule(prefix("you_lose", "mission_failed"), "game/game-over", "realistic", ["voice"], { group: "game/game-over::voice" }),
  rule(prefix("its_a_tie", "time_over"), "game/game-over", "realistic", ["voice", "tie"], { group: "game/game-over::tie" }),
  rule(prefix("you_win", "mission_completed"), "game/win", "realistic", ["voice"], { group: "game/win::voice" }),
  rule(prefix("congratulations", "new_highscore", "objective_achieved"), "game/achievement", "realistic", ["voice"], { group: "game/achievement::voice" }),
  rule(prefix("correct"), "ui/confirm", "realistic", ["voice"]),
  rule(prefix("wrong"), "ui/error", "realistic", ["voice"]),
  rule(prefix("ready", "set", "go", "round", "final_round"), "game/countdown", "realistic", ["voice"], { group: "game/countdown::voice" }),
  rule(prefix("hurry_up"), "game/timer-warning", "realistic", ["voice"], { group: "game/timer-warning::voice" }),
  rule(prefix("hold", "war_hold"), "combat/block", "realistic", ["voice"], { group: "combat/block::voice" }),
  rule(prefix("power_up"), "collect/powerup", "realistic", ["voice"]),
  rule(prefix("war_reloading"), "combat/reload", "realistic", ["voice"]),
  rule(prefix("war_medic"), "collect/health", "realistic", ["voice", "medic"]),
  rule(
    prefix("war_call_for_backup", "war_cover_me", "war_fire_in_the_hole", "war_get_down", "war_go_go_go", "war_look_out", "war_rpg", "war_sniper", "war_suppressing_fire", "war_supressing_fire", "war_target_destroyed", "war_target_engaged", "war_watch_my_back"),
    "combat/shoot", "realistic", ["voice", "war"], { group: "combat/shoot::war" },
  ),
];

const KENNEY_VOICEOVER_PACK_FIGHTER = [
  rule((b) => /^([1-9]|10)$/.test(b), "game/countdown", "realistic", ["voice", "fighter", "number"], { resolve: (b) => ({ category: "game/countdown", style: "realistic", tags: ["voice", "fighter", "number"], group: "game/countdown::fighter-number", take: parseInt(b, 10) }) }),
  rule(prefix("begin", "ready", "prepare_yourself"), "game/start", "realistic", ["voice", "fighter"], { group: "game/start::fighter" }),
  rule(prefix("fight"), "game/start", "realistic", ["voice", "fight"], { group: "game/start::fighter" }),
  rule(prefix("player"), "ui/confirm", "realistic", ["voice", "player-select"], { group: "ui/confirm::fighter-player" }),
  rule(
    prefix("arcade_mode", "battle_mode", "championship_mode", "deathmatch", "story_mode", "survival_mode", "multi_kill", "sudden_death"),
    "ui/confirm", "realistic", ["voice", "mode-select"], { group: "ui/confirm::fighter-mode" },
  ),
  rule(prefix("choose_your_character"), "ui/confirm", "realistic", ["voice", "character-select"], { group: "ui/confirm::fighter-mode" }),
  rule(prefix("combo", "combo_breaker"), "combat/hit", "realistic", ["voice", "combo"], { group: "combat/hit::fighter-combo" }),
  rule(prefix("final_round", "round"), "game/countdown", "realistic", ["voice", "fighter"], { group: "game/countdown::fighter-round" }),
  rule(prefix("flawless_victory", "winner", "you_win"), "game/win", "realistic", ["voice", "fighter"], { group: "game/win::fighter" }),
  rule(prefix("game_over", "loser", "you_lose"), "game/game-over", "realistic", ["voice", "fighter"], { group: "game/game-over::fighter" }),
  rule(prefix("it's_a_tie", "tie", "tie_breaker"), "game/game-over", "realistic", ["voice", "fighter", "tie"], { group: "game/game-over::fighter-tie" }),
  rule(prefix("kill_her", "kill_him", "kill_it"), "combat/enemy-death", "realistic", ["voice", "taunt"], { group: "combat/enemy-death::fighter" }),
  rule(prefix("time"), "game/timer-warning", "realistic", ["voice", "fighter"]),
];

const SOURCES = {
  "kenney-impact-sounds": KENNEY_IMPACT_SOUNDS,
  "kenney-ui-audio": KENNEY_UI_AUDIO,
  "kenney-rpg-audio": KENNEY_RPG_AUDIO,
  "kenney-sci-fi-sounds": KENNEY_SCI_FI_SOUNDS,
  "kenney-digital-audio": KENNEY_DIGITAL_AUDIO,
  "kenney-music-jingles": KENNEY_MUSIC_JINGLES,
  "kenney-voiceover-pack": KENNEY_VOICEOVER_PACK,
  "kenney-voiceover-pack-fighter": KENNEY_VOICEOVER_PACK_FIGHTER,
};

function stripExtension(fileName) {
  return fileName.replace(/\.(ogg|wav|mp3)$/i, "");
}

/** Strips a file's extension and, for every source except the jingle pack
 * (where the number selects the category, not just the take), any trailing
 * digits - with or without a separating underscore - so `footstep_snow_002`,
 * `switch12` and `bookFlip3` all map through their word stem regardless of
 * which numbering convention the pack used. */
function baseNameFor(sourceId, fileName) {
  const stem = stripExtension(fileName);
  if (sourceId === "kenney-music-jingles") return stem;
  // The lookbehind requires a letter immediately before the trailing digit
  // group, so a purely numeric stem ("1", "10" - the voiceover packs' number
  // lines) is left untouched instead of being stripped down to "".
  return stem.replace(/(?<=[A-Za-z])_?\d+$/, "");
}

/** The take number used to order variants: the trailing digits in the
 * original stem (with or without underscore), else 1. A rule's own
 * `resolve` may override this (see the numbered voiceover lines, where the
 * spoken number IS the take order key by construction, not an accident of
 * file naming). */
function takeNumberFor(fileName) {
  const stem = stripExtension(fileName);
  const trailing = stem.match(/_?(\d+)$/);
  if (trailing) return parseInt(trailing[1], 10);
  return 1;
}

/**
 * Maps one file inside a source archive to where it lands in the catalogue,
 * or `null` if nothing in this source's rule list matches (skipped, logged
 * by the build, never forced).
 */
export function mapFile(sourceId, fileName) {
  if (/preview/i.test(fileName)) return null;
  const rules = SOURCES[sourceId];
  if (!rules) throw new Error(`mapping.mjs: no rules for source "${sourceId}"`);
  const base = baseNameFor(sourceId, fileName);
  for (const r of rules) {
    if (r.test(base)) {
      const resolved = r.resolve ? r.resolve(base) : { category: r.category, style: r.style, tags: r.tags };
      const take = resolved.take ?? takeNumberFor(fileName);
      const group = resolved.group ?? `${resolved.category}::${resolved.style}::${(resolved.tags ?? []).join(",")}`;
      return { category: resolved.category, style: resolved.style, tags: resolved.tags ?? [], group, take };
    }
  }
  return null;
}

export function sourceIds() {
  return Object.keys(SOURCES);
}
