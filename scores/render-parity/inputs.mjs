import { planPerformance, nesChip, gbChip, mdChip, snesChip, c64Chip } from '../../packages/chipvoice/dist/index.js';
import { arrangementIds, arrangementChips, loadArrangement } from '../arrangements/check.mjs';
import { nativeSources, loadNative } from '../arrangements/native-sources.mjs';
import { buildPresets } from '../instruments/presets.mjs';

/**
 * The fixed, small set of inputs MIX-14 compares across Node, Chromium,
 * Firefox and WebKit: a short excerpt of each published arrangement, on
 * every chip it plays on, plus a couple of instrument-catalogue presets per
 * chip so the C64 - which no published arrangement reaches - is covered
 * too. Every entry is a `PerformancePlan`: the same object `renderPerformance`
 * takes whether it is called from a Node script or from a browser tab, with
 * nothing more process- or DOM-specific left in it than that.
 */

// Long enough to cross a loop point and a note-off on the slowest part in
// each piece, short enough that rendering the whole set once per engine
// (Node, plus one Playwright browser each) stays a one-minute job.
export const EXCERPT_SECONDS = 6;

export const CATALOGUE_CHIPS = { '2a03': nesChip, dmg: gbChip, md: mdChip, snes: snesChip, c64: c64Chip };

async function arrangementInputs(excerptSeconds) {
  const inputs = [];
  for (const id of arrangementIds) {
    const score = await loadArrangement(id);
    const nativeSpec = nativeSources[id];
    const native = await loadNative(id);
    for (const chip of arrangementChips) {
      const isNative = chip.spec.id === nativeSpec.chip;
      const full = isNative ? native : planPerformance(score, chip, { allowLoss: true });
      // Excerpting only needs fewer seconds: renderPerformance stops once it
      // has produced `plan.seconds` of audio, regardless of what is still
      // scheduled past that point. Dropping the events past the excerpt's
      // own horizon (every `at` is an absolute cycle count at the chip's own
      // clock, the unit `schedule`/`render` already work in) changes nothing
      // about the rendered samples, and keeps a full-length piece's plan from
      // dragging its whole event log into a fixture a phone has to fetch.
      const seconds = Math.min(full.seconds, excerptSeconds);
      const horizon = Math.ceil(seconds * chip.spec.clockHz);
      const plan = { ...full, seconds, events: full.events.filter(e => e.at <= horizon) };
      inputs.push({
        id: `${id}-${chip.spec.id}`,
        kind: 'arrangement',
        chip: chip.spec.id,
        title: `${score.title} - ${chip.spec.id} (first ${seconds.toFixed(1)}s, ${isNative ? 'native commands' : 'adapted mix'})`,
        plan,
      });
    }
  }
  return inputs;
}

function probeScore(preset) {
  const percussion = preset.role === 'perc';
  const part = {
    id: 'probe', name: 'probe', role: percussion ? 'perc' : preset.role, priority: 1,
    ...(percussion ? {} : { program: preset.program }),
    notes: [{ id: 'n', tick: 0, endTick: 700, pitch: 60, velocity: 100, ...(percussion ? { drum: preset.drum } : {}) }],
  };
  return {
    version: 1, title: `probe-${preset.id}`, ticksPerBeat: 1000, endTick: 1200,
    tempos: [{ tick: 0, microsecondsPerBeat: 1000000 }], parts: [part], notices: [],
  };
}

// The same fixed probe scores/instruments/generate.mjs measures every preset
// with (middle C, held 700ms of 1200ms total), rendered with mixing bypassed
// so the DSP core's own output is what gets hashed, not the mixer's.
function presetInputs() {
  const presets = buildPresets();
  const inputs = [];
  for (const [chipId, chip] of Object.entries(CATALOGUE_CHIPS)) {
    const lead = presets.find(p => p.chip === chipId && p.role === 'lead');
    const perc = presets.find(p => p.chip === chipId && p.role === 'perc' && p.token === 'K');
    for (const preset of [lead, perc].filter(Boolean)) {
      const plan = planPerformance(probeScore(preset), chip, { mix: false });
      inputs.push({ id: preset.id, kind: 'preset', chip: chipId, title: `Instrument preset: ${preset.id}`, plan });
    }
  }
  return inputs;
}

/**
 * Every fixed input, in a stable order: arrangement excerpts, then presets.
 *
 * `excerptSeconds` defaults to the full `EXCERPT_SECONDS` the sheet and the
 * Node/Playwright check use. The published site fixture (built by
 * `build-fixture.mjs`) asks for a shorter one instead - a visitor's phone has
 * to fetch and render this set, where a CI job or a local script does not.
 */
export async function buildInputs({ excerptSeconds = EXCERPT_SECONDS } = {}) {
  return [...(await arrangementInputs(excerptSeconds)), ...presetInputs()];
}
