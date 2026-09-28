/**
 * UI sounds: click, hover/tick, confirm, cancel/back, error, toggle
 * on/off, notification, text blip. All short (under 350 ms), built from
 * oscillators and envelopes - no physically-informed model needed for a
 * synthetic interface sound.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, ref, toneBlip, mixNode, sweepNode, oscNode, adsrNode, mulNode, bitcrushNode, seededRange } from './helpers.js';

export type UiKind = 'click' | 'hover' | 'confirm' | 'cancel' | 'error' | 'toggle-on' | 'toggle-off' | 'notification' | 'text-blip';

export interface UiParams {
  kind: UiKind;
  /** Overrides the kind's default base pitch, Hz. */
  baseFreq?: number;
}

const KIND_BASE_FREQ: Record<UiKind, number> = {
  click: 900, hover: 650, confirm: 520, cancel: 520, error: 220,
  'toggle-on': 400, 'toggle-off': 800, notification: 660, 'text-blip': 1400,
};

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as UiParams;
  const kind = p.kind;
  const base = p.baseFreq ?? KIND_BASE_FREQ[kind] * (1 + seededRange(seed, 'ui-pitch', -0.02, 0.02));
  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  let output: string;
  let duration: number;

  switch (kind) {
    case 'click':
      output = toneBlip(id, nodes, { shape: 'triangle', freq: base, attack: 0.0005, decay: 0.03 });
      duration = 0.06;
      break;
    case 'hover':
      output = toneBlip(id, nodes, { shape: 'sine', freq: base, attack: 0.001, decay: 0.045 });
      duration = 0.07;
      break;
    case 'confirm': {
      const a = toneBlip(id, nodes, { shape: 'sine', freq: base, attack: 0.001, decay: 0.09 });
      const b = toneBlip(id, nodes, { shape: 'sine', freq: base * 1.5, attack: 0.001, decay: 0.14 });
      const mixId = id();
      nodes.push(mixNode(mixId, [{ signal: a }, { signal: b, offsetMs: 70 }]));
      output = mixId;
      duration = 0.3;
      break;
    }
    case 'cancel': {
      const a = toneBlip(id, nodes, { shape: 'triangle', freq: base, attack: 0.001, decay: 0.09 });
      const b = toneBlip(id, nodes, { shape: 'triangle', freq: base * 0.75, attack: 0.001, decay: 0.14 });
      const mixId = id();
      nodes.push(mixNode(mixId, [{ signal: a }, { signal: b, offsetMs: 70 }]));
      output = mixId;
      duration = 0.3;
      break;
    }
    case 'error': {
      const a = toneBlip(id, nodes, { shape: 'square', freq: base, attack: 0.001, decay: 0.18 });
      const b = toneBlip(id, nodes, { shape: 'square', freq: base * 1.0595, attack: 0.001, decay: 0.18 });
      const mixId = id();
      nodes.push(mixNode(mixId, [{ signal: a, gain: 0.6 }, { signal: b, gain: 0.6 }]));
      const crushId = id();
      nodes.push(bitcrushNode(crushId, mixId, 6));
      output = crushId;
      duration = 0.25;
      break;
    }
    case 'toggle-on':
    case 'toggle-off': {
      const from = kind === 'toggle-on' ? base : base * 2;
      const to = kind === 'toggle-on' ? base * 2 : base;
      const sweepId = id();
      nodes.push(sweepNode(sweepId, from, to, 'exponential'));
      const oscId = id();
      nodes.push(oscNode(oscId, 'square', ref(sweepId)));
      const envId = id();
      nodes.push(adsrNode(envId, { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 }));
      const mulId = id();
      nodes.push(mulNode(mulId, [oscId, envId]));
      output = mulId;
      duration = 0.08;
      break;
    }
    case 'notification': {
      const a = toneBlip(id, nodes, { shape: 'sine', freq: base, attack: 0.002, decay: 0.16 });
      const b = toneBlip(id, nodes, { shape: 'sine', freq: base * 1.26, attack: 0.002, decay: 0.2 });
      const c = toneBlip(id, nodes, { shape: 'sine', freq: base * 1.5, attack: 0.002, decay: 0.28 });
      const mixId = id();
      nodes.push(mixNode(mixId, [{ signal: a, offsetMs: 0 }, { signal: b, offsetMs: 90 }, { signal: c, offsetMs: 180 }]));
      output = mixId;
      duration = 0.55;
      break;
    }
    case 'text-blip':
      output = toneBlip(id, nodes, { shape: 'square', freq: base, attack: 0.0002, decay: 0.012 });
      duration = 0.03;
      break;
  }

  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'ui',
  family: 'ui',
  description: 'Short interface sounds: click, hover/tick, confirm, cancel/back, error, toggle on/off, notification, text blip. Synthetic, oscillator-based - no physical object being modelled.',
  params: {
    kind: { type: 'enum', enumValues: ['click', 'hover', 'confirm', 'cancel', 'error', 'toggle-on', 'toggle-off', 'notification', 'text-blip'], description: 'Which UI event this sound is for.', default: 'click' },
    baseFreq: { type: 'number', unit: 'Hz', min: 100, max: 4000, description: 'Overrides the kind\'s default base pitch. Omit to use a sensible per-kind default.', seedJitter: 'When omitted (the per-kind default is used), the resolved base pitch is jittered +-2% per seed, so repeated presses of the same event vary subtly rather than sounding machine-identical. An explicit baseFreq is used exactly as given, with no jitter.' },
  },
  examples: [
    { name: 'menu click', description: 'A crisp, neutral button press.', params: { kind: 'click' }, seed: 1 },
    { name: 'confirm chime', description: 'A pleasant two-note rising confirmation.', params: { kind: 'confirm' }, seed: 1 },
    { name: 'error buzz', description: 'A dissonant, slightly crushed error tone.', params: { kind: 'error' }, seed: 1 },
    { name: 'gentle notification', description: 'A three-note ascending notification chime.', params: { kind: 'notification' }, seed: 1 },
  ],
  seedJitterLabels: ['ui-pitch'],
};

export const uiModel: SfxModel = { metadata, compile };
