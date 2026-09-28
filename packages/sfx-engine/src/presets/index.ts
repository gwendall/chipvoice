/**
 * The model registry (`MODELS`, every high-level model's id -> its
 * `compile` function and metadata) and the named preset registry
 * (`PRESETS`, ~53 (model, params, seed) triples covering the gamesounds
 * taxonomy's events - see docs/GAMESOUNDS-ENGINE.md's coverage table and
 * this file's own family comments for what's covered and what was left
 * out). A `Recipe`'s `model` field is looked up in `MODELS`; `PRESETS` is
 * this package's own catalogue for the listening report, the hash fixture,
 * the perf budget and the CLAP eval - an external caller is free to ignore
 * it entirely and build any `(model, params, seed)` combination `MODELS`
 * supports.
 */
import type { Recipe } from '../recipe/types.js';
import type { NamedPreset, SfxModel } from './types.js';
import { uiModel } from './ui.js';
import { impactModel } from './impact.js';
import { footstepModel } from './footstep.js';
import { whooshModel } from './whoosh.js';
import { explosionModel } from './explosion.js';
import { scifiModel } from './scifi.js';
import { magicModel } from './magic.js';
import { pickupModel } from './pickup.js';

export const MODELS: Record<string, SfxModel> = {
  ui: uiModel,
  impact: impactModel,
  footstep: footstepModel,
  whoosh: whooshModel,
  explosion: explosionModel,
  scifi: scifiModel,
  magic: magicModel,
  pickup: pickupModel,
};

const DEFAULT_SEED = 1;

function preset(id: string, family: NamedPreset['family'], model: string, params: Record<string, unknown>, description: string): NamedPreset {
  return { id, family, model, params, seed: DEFAULT_SEED, description };
}

export const PRESETS: NamedPreset[] = [
  // --- UI (9): click, hover/tick, confirm, cancel/back, error, toggle on/off, notification, text blip ---
  preset('ui-click', 'ui', 'ui', { kind: 'click' }, 'A generic button press.'),
  preset('ui-hover', 'ui', 'ui', { kind: 'hover' }, 'A soft hover/tick on a menu item.'),
  preset('ui-confirm', 'ui', 'ui', { kind: 'confirm' }, 'A positive confirmation chime.'),
  preset('ui-cancel', 'ui', 'ui', { kind: 'cancel' }, 'A cancel/back action.'),
  preset('ui-error', 'ui', 'ui', { kind: 'error' }, 'An invalid-action error buzz.'),
  preset('ui-toggle-on', 'ui', 'ui', { kind: 'toggle-on' }, 'A toggle switching on.'),
  preset('ui-toggle-off', 'ui', 'ui', { kind: 'toggle-off' }, 'A toggle switching off.'),
  preset('ui-notification', 'ui', 'ui', { kind: 'notification' }, 'A gentle incoming notification.'),
  preset('ui-text-blip', 'ui', 'ui', { kind: 'text-blip' }, 'A single dialogue-text-reveal blip.'),

  // --- Impact/hit (12): light/heavy x wood/metal/stone/glass/plastic/body ---
  preset('impact-wood-light', 'impact', 'impact', { material: 'wood', weight: 'light' }, 'A light strike on wood.'),
  preset('impact-wood-heavy', 'impact', 'impact', { material: 'wood', weight: 'heavy' }, 'A heavy strike on wood.'),
  preset('impact-metal-light', 'impact', 'impact', { material: 'metal', weight: 'light' }, 'A light strike on metal.'),
  preset('impact-metal-heavy', 'impact', 'impact', { material: 'metal', weight: 'heavy' }, 'A heavy strike on metal.'),
  preset('impact-stone-light', 'impact', 'impact', { material: 'stone', weight: 'light' }, 'A light strike on stone.'),
  preset('impact-stone-heavy', 'impact', 'impact', { material: 'stone', weight: 'heavy' }, 'A heavy strike on stone.'),
  preset('impact-glass-light', 'impact', 'impact', { material: 'glass', weight: 'light' }, 'A light tap on glass.'),
  preset('impact-glass-heavy', 'impact', 'impact', { material: 'glass', weight: 'heavy' }, 'A heavy strike on glass.'),
  preset('impact-plastic-light', 'impact', 'impact', { material: 'plastic', weight: 'light' }, 'A light strike on plastic.'),
  preset('impact-plastic-heavy', 'impact', 'impact', { material: 'plastic', weight: 'heavy' }, 'A heavy strike on plastic.'),
  preset('impact-body-light', 'impact', 'impact', { material: 'body', weight: 'light' }, 'A light body/punch impact.'),
  preset('impact-body-heavy', 'impact', 'impact', { material: 'body', weight: 'heavy' }, 'A heavy body/punch impact.'),

  // --- Footstep (7): concrete/wood/grass/gravel/snow/metal/water-puddle ---
  preset('footstep-concrete', 'footstep', 'footstep', { surface: 'concrete' }, 'A footstep on concrete.'),
  preset('footstep-wood', 'footstep', 'footstep', { surface: 'wood' }, 'A footstep on a wooden floor.'),
  preset('footstep-grass', 'footstep', 'footstep', { surface: 'grass' }, 'A footstep on grass.'),
  preset('footstep-gravel', 'footstep', 'footstep', { surface: 'gravel' }, 'A footstep on gravel.'),
  preset('footstep-snow', 'footstep', 'footstep', { surface: 'snow' }, 'A footstep in snow.'),
  preset('footstep-metal', 'footstep', 'footstep', { surface: 'metal' }, 'A footstep on a metal surface.'),
  preset('footstep-water-puddle', 'footstep', 'footstep', { surface: 'water-puddle' }, 'A footstep in a shallow puddle.'),

  // --- Whoosh/swing (4): sword/punch/fast-pass-by/cloth ---
  preset('whoosh-sword', 'whoosh', 'whoosh', { kind: 'sword' }, 'A sword swing through the air.'),
  preset('whoosh-punch', 'whoosh', 'whoosh', { kind: 'punch' }, 'A fist swinging through the air.'),
  preset('whoosh-pass-by', 'whoosh', 'whoosh', { kind: 'fast-pass-by' }, 'A fast object passing close by.'),
  preset('whoosh-cloth', 'whoosh', 'whoosh', { kind: 'cloth' }, 'A cloak/cloth swinging.'),

  // --- Explosion (3): small/big/distant ---
  preset('explosion-small', 'explosion', 'explosion', { size: 'small' }, 'A small, compact explosion.'),
  preset('explosion-big', 'explosion', 'explosion', { size: 'big' }, 'A big explosion with debris.'),
  preset('explosion-distant', 'explosion', 'explosion', { size: 'distant' }, 'A big explosion heard from far away.'),

  // --- Sci-fi (8): laser/zap/teleport/shield-up-down/power-up-down/computer-beeps ---
  preset('scifi-laser', 'scifi', 'scifi', { kind: 'laser' }, 'A blaster laser shot.'),
  preset('scifi-zap', 'scifi', 'scifi', { kind: 'zap' }, 'An electric zap.'),
  preset('scifi-teleport', 'scifi', 'scifi', { kind: 'teleport' }, 'A teleport effect.'),
  preset('scifi-shield-up', 'scifi', 'scifi', { kind: 'shield-up' }, 'A shield activating.'),
  preset('scifi-shield-down', 'scifi', 'scifi', { kind: 'shield-down' }, 'A shield deactivating/breaking.'),
  preset('scifi-power-up', 'scifi', 'scifi', { kind: 'power-up' }, 'A system/device powering up.'),
  preset('scifi-power-down', 'scifi', 'scifi', { kind: 'power-down' }, 'A system/device powering down.'),
  preset('scifi-computer-beep', 'scifi', 'scifi', { kind: 'computer-beep' }, 'A computer acknowledgement beep.'),

  // --- Magic/fantasy (5): cast/shimmer/heal/buff/curse ---
  preset('magic-cast', 'magic', 'magic', { kind: 'cast' }, 'Casting a spell.'),
  preset('magic-shimmer', 'magic', 'magic', { kind: 'shimmer' }, 'A magical shimmer/sparkle.'),
  preset('magic-heal', 'magic', 'magic', { kind: 'heal' }, 'A healing effect.'),
  preset('magic-buff', 'magic', 'magic', { kind: 'buff' }, 'A positive buff effect.'),
  preset('magic-curse', 'magic', 'magic', { kind: 'curse' }, 'A dark curse effect.'),

  // --- Pickup/reward, non-retro (5): coin/gem/key/powerup/level-up-chime ---
  preset('pickup-coin', 'pickup', 'pickup', { kind: 'coin' }, 'Picking up a coin.'),
  preset('pickup-gem', 'pickup', 'pickup', { kind: 'gem' }, 'Picking up a gem.'),
  preset('pickup-key', 'pickup', 'pickup', { kind: 'key' }, 'Picking up a key.'),
  preset('pickup-powerup', 'pickup', 'pickup', { kind: 'powerup' }, 'Picking up a power-up.'),
  preset('pickup-level-up', 'pickup', 'pickup', { kind: 'level-up' }, 'Leveling up.'),
];

export function getPreset(id: string): NamedPreset {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`sfx-engine: unknown preset "${id}"`);
  return found;
}

/** Builds a full `Recipe` from a named preset, optionally overriding its
 * seed and sample rate (default: the preset's own reference seed, 48000 Hz). */
export function recipeForPreset(id: string, seed?: number, sampleRate: 44100 | 48000 = 48000): Recipe {
  const p = getPreset(id);
  return { engine: 'sfx-engine@1', model: p.model, params: p.params, seed: seed ?? p.seed, sampleRate };
}
