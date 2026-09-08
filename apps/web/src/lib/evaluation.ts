import { admitProject } from "./projects";
import { rendererIdentity } from "./project-jobs";
import { utilityWorker } from "./utility-worker";
/** Submitted bodies are evaluated in a bounded worker and never published. */
export async function evaluateProject(project: unknown, owner: string) {
  await admitProject(`evaluate:${owner}`, 6);
  const result = await utilityWorker({ project, evaluate: true });
  return {
    version: 1,
    engine: rendererIdentity(),
    ...(result.report as Record<string, unknown>),
  };
}
