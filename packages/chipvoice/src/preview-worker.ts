import {compileProject, PROJECT_ENGINE_VERSION} from './project-render.js';
import {ProgressiveRenderer} from './progressive-renderer.js';
import {nesChip} from './chips/nes/index.js';
import {gbChip} from './chips/gb/index.js';
import {mdChip} from './chips/md/index.js';
import {snesChip} from './chips/snes/index.js';
import {c64Chip} from './chips/c64/index.js';
import type {MusicProject} from './project.js';
import type {PerformancePlan} from './performance.js';
const definitions = {'2a03': nesChip, dmg: gbChip, md: mdChip, snes: snesChip, c64: c64Chip};
export type PreviewRequest = {id: number; type: 'load' | 'read' | 'cancel'; project?: MusicProject; plan?: PerformancePlan; gain?: number;
  sampleRate: number; lane?: 'foreground' | 'ahead'; parts?: string[]; start: number; frames: number};
const scope = globalThis as unknown as {onmessage: (event: MessageEvent<PreviewRequest>) => void; postMessage: (value: unknown, transfer?: Transferable[]) => void};
let renderer: ProgressiveRenderer | undefined, revision = 0;
const lanes = {foreground: 0, ahead: 0};
export async function handlePreviewMessage(data: PreviewRequest) {
  if (data.type === 'cancel') {
    if (data.lane) lanes[data.lane]++; else {lanes.foreground++; lanes.ahead++;}
    return;
  }
  const ticket = data.type === 'load' ? ++revision : revision;
  const lane = data.lane ?? 'foreground', readTicket = ++lanes[lane];
  try {
    if (data.type === 'load') {
      const compiled = data.plan
        ? {plan: data.plan, gain: data.gain ?? .6, native: true, engineVersion: PROJECT_ENGINE_VERSION}
        : compileProject(data.project!, {sampleRate: data.sampleRate, parts: data.parts});
      renderer = new ProgressiveRenderer(compiled.plan, definitions[compiled.plan.chip as keyof typeof definitions], data.sampleRate, compiled.gain);
      scope.postMessage({id: data.id, seconds: renderer.frames / data.sampleRate, frames: renderer.frames,
        loopStartSeconds: compiled.plan.loopStartSeconds, losses: compiled.plan.losses, mix: compiled.plan.mix ?? null,
        native: compiled.native, engineVersion: compiled.engineVersion});
      return;
    }
    if (!renderer) throw Error('Load a project before requesting audio');
    const branch = renderer.branch(), iterator = branch.read(data.start, data.frames);
    let budget = performance.now();
    for (;;) {
      if (ticket !== revision || readTicket !== lanes[lane]) {scope.postMessage({id: data.id, cancelled: true}); return;}
      const step = iterator.next();
      if (step.done) {
        renderer.adopt(branch);
        const {left, right} = step.value;
        scope.postMessage({id: data.id, start: data.start, left, right}, [left.buffer as ArrayBuffer, right.buffer as ArrayBuffer]);
        return;
      }
      if (performance.now() - budget >= 8) {
        await new Promise(resolve => setTimeout(resolve, 0)); budget = performance.now();
      }
    }
  } catch (error) {scope.postMessage({id: data.id, error: error instanceof Error ? error.message : 'Preview failed'});}
}
