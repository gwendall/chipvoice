// Retro chip-rendered sounds: chipvoice's own hardware voices, the whole
// catalogue's only origin (no third-party sounds, no external generation
// API - see docs/DECISIONS.md, decision 50). Every recipe here is
// a real chipvoice `SfxRecipe` (chip, channel, note, instrument, duration) -
// the exact JSON `Sound.recipe` round-trips through `renderSfx(recipe.chip,
// recipe)` to render the same sound again (packages/chipvoice/src/render-sfx.ts).
//
// Instruments come from chipvoice's own `instrumentsFor(chip, intent)` - the
// same portable-score idiom `apps/web/src/studio/effects.ts` uses for the
// studio's 4 demo effects - so every chip gets a timbre idiomatic to its own
// hardware (a 12.5% pulse lead on a NES, an FM patch on a Mega Drive, a
// filter sweep on a C64) instead of one instrument table copy-pasted five
// times. Each event below only supplies what makes it that event: a note (or
// a percussion-kit letter), a duration, and the small per-variant shape
// (slide, arp, vibrato) that turns "a lead note" into "a jump".
//
// Role -> channel per chip, read from each chip's own `spec.roles`
// (packages/chipvoice/src/chips/*/index.ts) - the same map
// `apps/web/src/studio/useDemoAudio.ts` uses to turn `chip.sfx(role, ...)`
// into a real channel:
//   nes:  lead p1, chord p2, bass tri, perc noi
//   gb:   lead ch1, chord ch2, bass ch3, perc ch4
//   md:   lead fm1, chord psg1, bass fm2, perc noise
//   snes: lead v0, chord v1, bass v2, perc v3
//   c64:  lead v1, chord v3, bass v2, perc v3 (perc shares chord's voice)
const ROLE_CHANNEL = {
  "2a03": { lead: "p1", chord: "p2", bass: "tri", perc: "noi" },
  dmg: { lead: "ch1", chord: "ch2", bass: "ch3", perc: "ch4" },
  md: { lead: "fm1", chord: "psg1", bass: "fm2", perc: "noise" },
  snes: { lead: "v0", chord: "v1", bass: "v2", perc: "v3" },
  c64: { lead: "v1", chord: "v3", bass: "v2", perc: "v3" },
};

// STYLES has no per-chip entry, so chips are grouped into the two retro
// style facets that exist: the 8-bit generation (NES, Game Boy, C64 - the
// SID predates the NES but is conventionally grouped with the 8-bit era)
// and the 16-bit generation (Mega Drive, SNES). Documented here rather than
// picked ad hoc per recipe.
const CHIP_STYLE = { "2a03": "8bit", dmg: "8bit", c64: "8bit", md: "16bit", snes: "16bit" };
const CHIPS = ["2a03", "dmg", "md", "snes", "c64"];

/**
 * One event: an id (maps straight to a taxonomy category), a title/description,
 * a role, and a `build(inst, variant)` that returns the note/instrument shape
 * for that role - `inst` is this chip's `instrumentsFor(chip, intent)` result,
 * `variant` is 0 or 1 (two variants per chip, a small, deliberate shape change
 * between them, not a random jitter).
 */
const EVENTS = [
  {
    category: "movement/jump", tags: ["hop"], title: "Jump", description: "A short upward pitch slide for a jump or hop.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "C5" : "D5", duration: v === 0 ? 0.22 : 0.18, instrument: { ...inst.lead, slide: v === 0 ? 1.1 : 1.6, vibrato: undefined, sustain: false } }),
  },
  {
    category: "movement/land", tags: ["thud"], title: "Land", description: "A short low thud for touching down after a jump or fall.",
    role: "perc-kick",
    build: (inst, v) => ({ note: inst.perc.K.note, duration: v === 0 ? inst.perc.K.duration : inst.perc.K.duration * 0.85, instrument: v === 0 ? inst.perc.K.instrument : { ...inst.perc.K.instrument, slide: -0.3 } }),
  },
  {
    category: "movement/dash", tags: ["sprint"], title: "Dash", description: "A quick rising blip for a dash or sprint burst.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "E5" : "F5", duration: 0.12, instrument: { ...inst.lead, slide: 2.2, vibrato: undefined, sustain: false } }),
  },
  {
    category: "collect/coin", tags: ["pickup"], title: "Coin", description: "A bright two-note arpeggio for picking up a coin.",
    role: "chord",
    build: (inst, v) => ({ note: "E6", duration: v === 0 ? 0.22 : 0.28, instrument: { ...inst.chord, arp: v === 0 ? [0, 7, 12, 7] : [0, 4, 7, 12] } }),
  },
  {
    category: "collect/gem", tags: ["jewel"], title: "Gem", description: "A shimmering high note with vibrato for a rarer pickup.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "G6" : "A6", duration: 0.3, instrument: { ...inst.lead, vibrato: { rate: 7, depth: v === 0 ? 0.3 : 0.5 }, sustain: true } }),
  },
  {
    category: "collect/powerup", tags: ["boost"], title: "Power-up", description: "A rising three-note arpeggio for a power-up or buff pickup.",
    role: "chord",
    build: (inst, v) => ({ note: "C6", duration: 0.4, instrument: { ...inst.chord, arp: v === 0 ? [0, 4, 7, 12] : [0, 5, 7, 12, 16] } }),
  },
  {
    category: "collect/xp", tags: ["experience"], title: "Experience", description: "A quick bright blip for earning experience points.",
    role: "chord",
    build: (inst, v) => ({ note: v === 0 ? "B5" : "C6", duration: 0.1, instrument: { ...inst.chord, arp: undefined } }),
  },
  {
    category: "combat/hit", tags: ["impact", "heavy"], title: "Hit", description: "A short noise burst for a melee or projectile impact.",
    role: "perc-snare",
    build: (inst, v) => ({ note: inst.perc.S.note, duration: v === 0 ? inst.perc.S.duration : inst.perc.S.duration * 0.7, instrument: inst.perc.S.instrument }),
  },
  {
    category: "combat/shoot", tags: ["laser"], title: "Shoot", description: "A short downward pitch slide, the classic chiptune laser.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "A6" : "C7", duration: 0.12, instrument: { ...inst.lead, slide: -1.4, vibrato: undefined, sustain: false } }),
  },
  {
    category: "combat/explosion", tags: ["boom"], title: "Explosion", description: "A long decaying noise burst for an explosion.",
    role: "perc-noise-long",
    build: (inst, v) => ({
      note: inst.perc.K.note,
      duration: v === 0 ? 0.4 : 0.6,
      // v1's envelope has more, slower-decaying steps (not just a longer
      // nominal duration) so it stays audible longer after trimming - a
      // longer `duration` alone can decay to silence before either variant's
      // trailing silence is cut, which would leave two variants identical.
      instrument: v === 0
        ? { ...inst.perc.K.instrument, volume: [15, 14, 13, 12, 10, 8, 7, 6, 4, 3, 2, 1], slide: -0.5 }
        : { ...inst.perc.K.instrument, volume: [15, 15, 14, 13, 12, 11, 10, 9, 7, 6, 5, 4, 3, 2, 1], slide: -0.75 },
    }),
  },
  {
    category: "combat/reload", tags: ["click"], title: "Reload", description: "A short metallic click for a weapon reload cue.",
    role: "perc-hat",
    build: (inst, v) => ({ note: inst.perc.H.note, duration: v === 0 ? inst.perc.H.duration : inst.perc.H.duration * 1.3, instrument: v === 0 ? inst.perc.H.instrument : { ...inst.perc.H.instrument, slide: 0.4 } }),
  },
  {
    category: "combat/block", tags: ["parry"], title: "Block", description: "A short flat blip for a parry or shield block.",
    role: "chord",
    build: (inst, v) => ({ note: v === 0 ? "F5" : "G5", duration: 0.08, instrument: { ...inst.chord, arp: undefined } }),
  },
  {
    category: "ui/click", tags: ["tap"], title: "Click", description: "A minimal single tick for a UI button press.",
    role: "perc-hat",
    build: (inst, v) => ({ note: inst.perc.H.note, duration: Math.min(inst.perc.H.duration, v === 0 ? 0.04 : 0.03), instrument: v === 0 ? inst.perc.H.instrument : { ...inst.perc.H.instrument, slide: 0.5 } }),
  },
  {
    category: "ui/confirm", tags: ["accept"], title: "Confirm", description: "A short upward two-note cue for an accepted action.",
    role: "chord",
    build: (inst, v) => ({ note: "C6", duration: 0.15, instrument: { ...inst.chord, arp: v === 0 ? [0, 7] : [0, 4] } }),
  },
  {
    category: "ui/error", tags: ["denied"], title: "Error", description: "A short downward buzz for an invalid or denied action.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "A4" : "G4", duration: 0.25, instrument: { ...inst.lead, slide: -0.6, vibrato: undefined, sustain: false } }),
  },
  {
    category: "ui/notification", tags: ["ping"], title: "Notification", description: "A short two-tone chime for an alert or toast.",
    role: "chord",
    build: (inst, v) => ({ note: v === 0 ? "E6" : "D6", duration: 0.18, instrument: { ...inst.chord, arp: [0, 5] } }),
  },
  {
    category: "magic/cast", tags: ["spell"], title: "Cast", description: "A rising shimmering arpeggio for casting a spell.",
    role: "lead",
    build: (inst, v) => ({ note: "A5", duration: 0.5, instrument: { ...inst.lead, arp: v === 0 ? [0, 4, 7, 12, 16] : [0, 3, 7, 10, 12], vibrato: { rate: 6, depth: 0.2 }, sustain: true } }),
  },
  {
    category: "magic/teleport", tags: ["warp"], title: "Teleport", description: "A fast rising then falling pitch sweep for a warp or blink.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "C5" : "D5", duration: 0.3, instrument: { ...inst.lead, slide: v === 0 ? 2.4 : -2.4, vibrato: undefined, sustain: false } }),
  },
  {
    category: "game/game-over", tags: ["defeat"], title: "Game over", description: "A slow falling note for a game-over or defeat cue.",
    role: "bass",
    build: (inst, v) => ({ note: v === 0 ? "C4" : "D4", duration: 1.0, instrument: { ...inst.bass, slide: -0.4, sustain: true } }),
  },
  {
    category: "game/win", tags: ["victory"], title: "Win", description: "A rising major arpeggio fanfare for a win or victory.",
    role: "chord",
    build: (inst, v) => ({ note: "C6", duration: 0.6, instrument: { ...inst.chord, arp: v === 0 ? [0, 4, 7, 12, 16, 12] : [0, 4, 7, 12] } }),
  },
  {
    category: "game/level-up", tags: ["rank-up"], title: "Level up", description: "A quick rising arpeggio for leveling up.",
    role: "chord",
    build: (inst, v) => ({ note: "G5", duration: 0.35, instrument: { ...inst.chord, arp: v === 0 ? [0, 5, 7, 12] : [0, 4, 7, 11, 12] } }),
  },
  // The events below extend chipvoice's coverage further into the taxonomy
  // (movement, collect, combat, ui, magic, objects, game and a non-verbal
  // voice/blip-speech), past the launch set above, so the catalogue clears
  // Phase 1 acceptance's 300-sound / 40-category floor without resorting to
  // a non-Kenney, non-chipvoice source.
  {
    category: "movement/footstep", tags: ["grass"], title: "Footstep", description: "A soft, short noise tick for a footstep on grass or soft ground.",
    role: "perc-hat",
    build: (inst, v) => ({ note: inst.perc.H.note, duration: v === 0 ? Math.min(inst.perc.H.duration * 0.8, 0.04) : Math.min(inst.perc.H.duration * 1.1, 0.05), instrument: v === 0 ? inst.perc.H.instrument : { ...inst.perc.H.instrument, slide: -0.2 } }),
  },
  {
    category: "movement/double-jump", tags: ["air-jump"], title: "Double jump", description: "A brighter second jump slide, for an air jump.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "D5" : "E5", duration: v === 0 ? 0.18 : 0.15, instrument: { ...inst.lead, slide: v === 0 ? 1.8 : 2.3, vibrato: undefined, sustain: false } }),
  },
  {
    category: "movement/slide", tags: ["skid"], title: "Slide", description: "A short downward skid for sliding to a stop.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "G4" : "F4", duration: v === 0 ? 0.26 : 0.32, instrument: { ...inst.lead, slide: v === 0 ? -0.35 : -0.5, vibrato: undefined, sustain: true } }),
  },
  {
    category: "movement/climb", tags: ["ladder"], title: "Climb", description: "A short tick for grabbing a ladder rung.",
    role: "perc-hat",
    build: (inst, v) => ({ note: inst.perc.H.note, duration: v === 0 ? Math.min(inst.perc.H.duration * 1.2, 0.05) : Math.min(inst.perc.H.duration * 1.5, 0.07), instrument: v === 0 ? inst.perc.H.instrument : { ...inst.perc.H.instrument, slide: 0.6 } }),
  },
  {
    category: "movement/swim", tags: ["stroke"], title: "Swim", description: "A wobbling pitch for a swim stroke.",
    role: "lead",
    build: (inst, v) => ({ note: "A4", duration: v === 0 ? 0.3 : 0.36, instrument: { ...inst.lead, vibrato: { rate: v === 0 ? 5 : 6.5, depth: v === 0 ? 0.4 : 0.55 }, sustain: true } }),
  },
  {
    category: "collect/key", tags: ["unlock-item"], title: "Key", description: "A short bright interval for picking up a key.",
    role: "chord",
    build: (inst, v) => ({ note: "A5", duration: 0.16, instrument: { ...inst.chord, arp: v === 0 ? [0, 5] : [0, 7] } }),
  },
  {
    category: "collect/ammo", tags: ["bullets"], title: "Ammo", description: "A quick metallic click for picking up ammunition.",
    role: "perc-hat",
    build: (inst, v) => ({ note: inst.perc.H.note, duration: v === 0 ? inst.perc.H.duration : inst.perc.H.duration * 0.8, instrument: { ...inst.perc.H.instrument, slide: v === 0 ? 0.3 : 0.5 } }),
  },
  {
    category: "collect/1up", tags: ["extra-life"], title: "Extra life", description: "A celebratory ascending arpeggio for an extra life.",
    role: "chord",
    build: (inst, v) => ({ note: "E6", duration: 0.55, instrument: { ...inst.chord, arp: v === 0 ? [0, 4, 7, 12, 16] : [0, 7, 12, 16, 19] } }),
  },
  {
    category: "combat/death", tags: ["defeat"], title: "Death", description: "A slow, low descending note for a player death.",
    role: "bass",
    build: (inst, v) => ({ note: v === 0 ? "C4" : "B3", duration: 1.1, instrument: { ...inst.bass, slide: v === 0 ? -0.6 : -0.8, sustain: true } }),
  },
  {
    category: "ui/cancel", tags: ["no"], title: "Cancel", description: "A short light downward blip for canceling an action.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "D5" : "C5", duration: 0.1, instrument: { ...inst.lead, slide: v === 0 ? -0.8 : -1.1, vibrato: undefined, sustain: false } }),
  },
  {
    category: "ui/back", tags: ["previous"], title: "Back", description: "A short descending two-note cue for going back.",
    role: "chord",
    build: (inst, v) => ({ note: "C6", duration: 0.14, instrument: { ...inst.chord, arp: v === 0 ? [0, -4] : [0, -7] } }),
  },
  {
    category: "ui/typewriter", tags: ["dialogue-tick"], title: "Typewriter", description: "A single dry tick for a dialogue letter blip.",
    role: "perc-hat",
    build: (inst, v) => ({ note: inst.perc.H.note, duration: v === 0 ? Math.min(inst.perc.H.duration, 0.025) : Math.min(inst.perc.H.duration, 0.02), instrument: v === 0 ? inst.perc.H.instrument : { ...inst.perc.H.instrument, slide: 0.4 } }),
  },
  {
    category: "ui/purchase", tags: ["buy"], title: "Purchase", description: "A short confident two-note confirmation for a purchase.",
    role: "chord",
    build: (inst, v) => ({ note: "G5", duration: 0.2, instrument: { ...inst.chord, arp: v === 0 ? [0, 4, 7] : [0, 5, 7] } }),
  },
  {
    category: "ui/unlock", tags: ["reveal"], title: "Unlock", description: "A rising shimmer for unlocking new content.",
    role: "chord",
    build: (inst, v) => ({ note: "D6", duration: 0.3, instrument: { ...inst.chord, arp: v === 0 ? [0, 4, 7, 11] : [0, 5, 9, 12] } }),
  },
  {
    category: "game/pause", tags: ["pause-menu"], title: "Pause", description: "A short flat two-note cue for pausing the game.",
    role: "chord",
    build: (inst, v) => ({ note: "E5", duration: 0.12, instrument: { ...inst.chord, arp: v === 0 ? [0, 3] : [0, -3] } }),
  },
  {
    category: "magic/heal", tags: ["restore"], title: "Heal", description: "A gentle rising shimmer for a healing spell.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "E5" : "F5", duration: 0.45, instrument: { ...inst.lead, slide: v === 0 ? 0.6 : 0.8, vibrato: { rate: 5, depth: 0.25 }, sustain: true } }),
  },
  {
    category: "magic/buff", tags: ["power-boost"], title: "Buff", description: "A rising major arpeggio for a stat boost.",
    role: "chord",
    build: (inst, v) => ({ note: "C5", duration: 0.35, instrument: { ...inst.chord, arp: v === 0 ? [0, 4, 7, 9] : [0, 5, 7, 9] } }),
  },
  {
    category: "magic/debuff", tags: ["curse"], title: "Debuff", description: "A short descending buzz for a curse or weakening effect.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "F4" : "E4", duration: 0.3, instrument: { ...inst.lead, slide: v === 0 ? -0.5 : -0.7, vibrato: { rate: 9, depth: 0.3 }, sustain: false } }),
  },
  {
    category: "magic/portal", tags: ["gateway"], title: "Portal", description: "A slow rising then falling sweep for a portal opening.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "A4" : "B4", duration: 0.6, instrument: { ...inst.lead, slide: v === 0 ? 1.2 : -1.2, vibrato: { rate: 4, depth: 0.3 }, sustain: true } }),
  },
  {
    category: "objects/chest", tags: ["treasure"], title: "Chest", description: "A short creaking rise for opening a chest.",
    role: "chord",
    build: (inst, v) => ({ note: "G4", duration: 0.35, instrument: { ...inst.chord, arp: v === 0 ? [0, 2, 4] : [0, 3, 5] } }),
  },
  {
    category: "objects/lever", tags: ["pull-lever"], title: "Lever", description: "A short mechanical clack for pulling a lever.",
    role: "perc-hat",
    build: (inst, v) => ({ note: inst.perc.H.note, duration: v === 0 ? inst.perc.H.duration : inst.perc.H.duration * 1.2, instrument: { ...inst.perc.H.instrument, slide: v === 0 ? -0.3 : -0.5 } }),
  },
  {
    category: "objects/throw", tags: ["toss"], title: "Throw", description: "A quick upward swoosh for throwing an object.",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "B4" : "C5", duration: 0.14, instrument: { ...inst.lead, slide: v === 0 ? 1.6 : 2.0, vibrato: undefined, sustain: false } }),
  },
  {
    category: "voice/blip-speech", tags: ["talk-blip"], title: "Blip speech", description: "A single alternating-pitch dialogue blip, in the style of retro chip dialogue text (non-verbal, not a word).",
    role: "lead",
    build: (inst, v) => ({ note: v === 0 ? "C5" : "E5", duration: 0.06, instrument: { ...inst.lead, vibrato: undefined, sustain: false } }),
  },
];

// A chipvoice sound is generated, not sourced, so it has no excuse to ship
// fewer than VARIANTS_PER_GROUP takes (docs/GAMESOUNDS.md's 3-to-5 range,
// checked at build time by checkChipvoiceVariantCount). Each event's own
// `build(inst, v)` only ever picks between two hand-tuned shapes (`v === 0 ?
// X : Y`) - and for some event/chip combinations (channel mapping strips the
// field the two shapes actually differ on, e.g. `slide` on a chip/role with
// no slide-capable channel) those two shapes render to byte-identical PCM.
// So every take beyond the first gets its OWN nudge on top of its shape -
// duration and detune, the two universal SfxSpec/recipe fields (every shape
// has a duration, and `detune` is chipvoice's own top-level semitone offset,
// packages/chipvoice/src/render-sfx.ts's frameSemitones).
//
// A single fixed nudge per take is not enough, though: several of chipvoice's
// own quantization steps are coarse enough that even a real, whole-semitone
// or double-digit-percent nudge can still land on the exact same rendered
// bytes as another take, or - rarer, but seen on a Game Boy noise take -
// silence. Two concrete, verified-against-the-real-renderer cases:
//   - A noise voice (driver.ts's `frames()`) resolves its period as
//     `Math.round(noiseBase + semis)`, clamped to 0-15. A base near either
//     end of that range clamps several different nudges to the SAME
//     extreme, and a purely one-directional nudge ladder (0, -1, -2, -3...)
//     can walk a base that is already near 0 (or 15) into that same clamped
//     value every single rung.
//   - Very short takes (a UI tick, a hat) round their duration to a whole
//     60Hz engine frame (`noteFrameCount` in driver.ts); a small percentage
//     stretch can round back to the identical frame count, and an
//     instrument's own volume envelope can also just decay to silence
//     before a longer duration would have mattered anyway.
// So each take is a candidate LADDER, not a single nudge: buildChipvoice (in
// scripts/build-catalog.mjs) renders candidates in order and keeps the first
// VARIANTS_PER_GROUP that are both audible and byte-distinct from every take
// already kept, rejecting - never accepting - a collision or a silent
// render. Each parity's own ladder (see PARITY_LADDERS) alternates sign and
// grows in magnitude specifically so it cannot get stuck walking one
// direction into a clamp; STRETCH_LADDER grows independently so a duration
// collision escalates too. This is intentionally a general escape hatch, not
// a per-chip special case - the exact quantization step that collides varies
// by chip and is not worth hand-tracking per event.
const VARIANTS_PER_GROUP = 4;

// Rung 0 of parity 0 is the untouched, hand-tuned canonical shape (no nudge
// at all - see applyNudge's no-op branch). Every other rung is a real,
// whole-semitone detune plus a duration stretch, both growing and
// alternating sign as the rung number rises.
const PARITY_LADDERS = [
  [0, -1, 1, -2, 2, -3, 3, -4, 4, -5],
  [1, -1, 2, -2, 3, -3, 4, -4, 5, -5],
];
const STRETCH_LADDER = [1, 1.09, 0.91, 1.18, 0.82, 1.27, 0.73, 1.36, 0.64, 1.45];
// A THIRD, independent lever, for the rare group neither of the above moves
// a single sample in: every `perc`-role recipe on the SNES is forced onto
// its one period-addressed voice (v3, `notes: "period"` in
// chips/snes/index.ts) no matter which percussion instrument (kick, snare,
// hat) the event actually reaches for, and that shared voice can render a
// long, already-decayed hit or an already-floored short tick identically
// across this whole detune/duration range - verified against the real
// renderer, not assumed (see docs/DECISIONS.md, decision 50). Shifting the
// instrument's own volume table by a small, clamped, alternating-sign amount
// changes the amplitude at every rendered frame directly, so it cannot be
// absorbed the same way duration or period can.
const VOLUME_LADDER = [0, -2, 2, -3, 3, -4, 4, -5, 5, -6];

/**
 * Nudges an event's own shape by one rung's {detuneNudge, stretch,
 * volumeShift}, a no-op only for rung 0 of parity 0 (all three zero/1
 * together). See VARIANTS_PER_GROUP's comment for why duration, detune and
 * the volume table are the levers here.
 */
function applyNudge(shape, detuneNudge, stretch, volumeShift) {
  if (stretch === 1 && detuneNudge === 0 && volumeShift === 0) return shape;
  const instrument = shape.instrument;
  const shiftedVolume = volumeShift !== 0 && Array.isArray(instrument?.volume)
    ? instrument.volume.map((v) => Math.max(0, Math.min(15, v + volumeShift)))
    : instrument?.volume;
  return {
    ...shape,
    duration: Math.max(0.02, shape.duration * stretch),
    detune: (shape.detune ?? 0) + detuneNudge,
    ...(shiftedVolume !== instrument?.volume ? { instrument: { ...instrument, volume: shiftedVolume } } : {}),
  };
}

/**
 * One (event, chip) group's ordered candidate ladder: alternates parity
 * (event.build(inst, 0) / event.build(inst, 1), the hand-tuned shape split)
 * and climbs both parities' own nudge ladders one rung at a time, so the
 * first two candidates are exactly the two hand-tuned shapes untouched
 * (rung 0), and every candidate after that is a real, escalating nudge on
 * top of one of those two shapes. `buildChipvoice` (scripts/build-catalog.mjs)
 * renders these in order and keeps the first VARIANTS_PER_GROUP that survive
 * its own audible/distinct check - most groups never need more than the
 * first four.
 */
function groupCandidates(event, chip, inst) {
  const baseRole = event.role.startsWith("perc") ? "perc" : event.role;
  const channel = ROLE_CHANNEL[chip][baseRole];
  const style = CHIP_STYLE[chip];
  const candidates = [];
  for (let rung = 0; rung < STRETCH_LADDER.length; rung++) {
    for (const parity of [0, 1]) {
      const detuneNudge = PARITY_LADDERS[parity][rung];
      const stretch = STRETCH_LADDER[rung];
      const volumeShift = VOLUME_LADDER[rung];
      const shape = applyNudge(event.build(inst, parity), detuneNudge, stretch, volumeShift);
      candidates.push({
        category: event.category,
        style,
        tags: event.tags,
        title: event.title,
        description: event.description,
        group: `${event.category}::${chip}`,
        recipe: {
          chip,
          channel,
          note: shape.note,
          instrument: shape.instrument,
          duration: shape.duration,
          ...(shape.detune !== undefined ? { detune: shape.detune } : {}),
        },
      });
    }
  }
  return candidates;
}

/**
 * Builds every chipvoice-origin (event, chip) group's own candidate ladder -
 * `{event, chip, candidates}`, one entry per event x chip. `candidates` is
 * ordered (see groupCandidates); the build script renders from the front of
 * each list until it has VARIANTS_PER_GROUP audible, distinct takes for that
 * group, exactly like it would render a curated sound's fixed file list.
 */
export function chipvoiceGroups(instrumentsFor) {
  const out = [];
  for (const event of EVENTS) {
    for (const chip of CHIPS) {
      const inst = instrumentsFor(chip, undefined);
      out.push({ event, chip, candidates: groupCandidates(event, chip, inst) });
    }
  }
  return out;
}

export { VARIANTS_PER_GROUP };

export { CHIPS, CHIP_STYLE, ROLE_CHANNEL };
