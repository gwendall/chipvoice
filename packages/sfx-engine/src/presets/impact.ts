/**
 * Impact/hit sounds: a single strike on a material, light or heavy, built
 * directly on models/modal.ts's modal synthesis (a bank of damped resonant
 * modes per material). "body-punch" maps to modal's `flesh` material.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, modalNode, seededRange } from './helpers.js';

export type ImpactMaterial = 'wood' | 'metal' | 'stone' | 'glass' | 'plastic' | 'body';
export type ImpactWeight = 'light' | 'heavy';

export interface ImpactParams {
  material: ImpactMaterial;
  weight?: ImpactWeight;
  /** Overrides the weight's default size scale (modal.ts's `size`). */
  size?: number;
}

const LONG_RINGING = new Set<ImpactMaterial>(['metal', 'glass']);

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as ImpactParams;
  const material = p.material === 'body' ? 'flesh' : p.material;
  const weight = p.weight ?? 'light';
  const sizeBase = weight === 'heavy' ? 1.6 : 0.85;
  const size = p.size ?? sizeBase * (1 + seededRange(seed, 'impact-size', -0.06, 0.06));
  const strength = weight === 'heavy' ? 0.95 : 0.6;
  const brightness = material === 'glass' || material === 'metal' ? 0.7 : 0.4;
  const excitation = p.material === 'body' ? 'noise-burst' : 'impulse';

  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  const modalId = id();
  nodes.push(modalNode(modalId, material, { size, strength, brightness, excitation }));

  const longRinging = LONG_RINGING.has(p.material);
  const duration = longRinging ? (weight === 'heavy' ? 2.2 : 1.0) : (weight === 'heavy' ? 0.6 : 0.3);

  return { duration, nodes, output: modalId };
}

const metadata: ModelMetadata = {
  id: 'impact',
  family: 'impact',
  description: 'A single strike on a rigid (or flesh) object: modal synthesis, a bank of damped resonant modes per material (see docs/GAMESOUNDS-ENGINE.md for the modal mode tables and their "designed, not measured" caveat).',
  params: {
    material: { type: 'enum', enumValues: ['wood', 'metal', 'stone', 'glass', 'plastic', 'body'], description: '"body" is a punch/flesh impact (modal.ts\'s flesh material, excited by a soft noise burst instead of a hard impulse).', default: 'wood' },
    weight: { type: 'enum', enumValues: ['light', 'heavy'], description: 'Heavier: larger effective size, harder strike, longer render.', default: 'light' },
    size: { type: 'number', min: 0.2, max: 4, description: 'Overrides the weight\'s default size scale directly; 1 = the material\'s reference object, <1 smaller/higher-pitched, >1 larger/lower.', seedJitter: 'When omitted, size is jittered +-6% per seed around the weight\'s default.' },
  },
  examples: [
    { name: 'wood crate hit', description: 'A light strike on a wooden crate.', params: { material: 'wood', weight: 'light' }, seed: 1 },
    { name: 'heavy metal clang', description: 'A hard hit on a large metal object, long ring.', params: { material: 'metal', weight: 'heavy' }, seed: 1 },
    { name: 'glass tap', description: 'A light tap on glass.', params: { material: 'glass', weight: 'light' }, seed: 1 },
    { name: 'body punch', description: 'A heavy punch landing.', params: { material: 'body', weight: 'heavy' }, seed: 1 },
  ],
  seedJitterLabels: ['impact-size'],
};

export const impactModel: SfxModel = { metadata, compile };
