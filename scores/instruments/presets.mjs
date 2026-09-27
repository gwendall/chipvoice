import {nesChip, gbChip, mdChip, snesChip, c64Chip, instrumentsFor} from '../../packages/chipvoice/dist/index.js';
import {performanceInstrument} from '../../packages/chipvoice/dist/performance-palette.js';

/**
 * Every preset a user can pick, exactly as the public API exposes them
 * (`/api/v1/capabilities`, built by `apps/web/scripts/agent-catalog.mjs`'s
 * `melodicPalette`/`percussionPalette`): for `lead`/`chord`/`bass`, General
 * MIDI programs 0-127 (`part.program`, the field a Performance actually
 * takes) collapse onto a handful of distinct instruments per chip -
 * `performance-palette.ts`'s own bucketing, not something this file
 * decides - and for percussion, the four kit voices a performance's default
 * kit resolves to. One row per distinct instrument actually reachable,
 * never one per program number, so this catalogue and the capabilities
 * endpoint always name the same set.
 */
export const CATALOGUE_CHIPS = [nesChip, gbChip, mdChip, snesChip, c64Chip];

// The GM percussion keys `performance.ts`'s own `resolveInstrument` reads to
// pick a kit voice (36/38/46 are its explicit cases; anything else, 42 here,
// falls into its default "H" bucket).
export const DRUM_KEYS = {K: 36, S: 38, H: 42, O: 46};

export function buildPresets() {
  const presets = [];
  for (const chip of CATALOGUE_CHIPS) {
    for (const role of ['lead', 'chord', 'bass']) {
      const groups = new Map();
      for (let program = 0; program < 128; program++) {
        const instrument = performanceInstrument(chip.spec.id, role, program);
        const key = JSON.stringify(instrument);
        if (!groups.has(key)) groups.set(key, {instrument, programs: []});
        groups.get(key).programs.push(program);
      }
      for (const {instrument, programs} of groups.values()) {
        presets.push({chip: chip.spec.id, role, id: `${chip.spec.id}-${role}-${programs[0]}`, program: programs[0], programs, instrument});
      }
    }
    const kit = instrumentsFor(chip.spec.id).perc;
    for (const token of Object.keys(DRUM_KEYS)) {
      presets.push({chip: chip.spec.id, role: 'perc', id: `${chip.spec.id}-perc-${token.toLowerCase()}`, token, drum: DRUM_KEYS[token], instrument: kit[token].instrument});
    }
  }
  return presets;
}
