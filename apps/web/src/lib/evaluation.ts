import { admitProject } from "./projects";
import { rendererIdentity } from "./project-jobs";
import { utilityWorker } from "./utility-worker";
/** Submitted bodies are evaluated in a bounded worker and never published.
 * Anonymous callers get a shorter deadline than the general utility-worker
 * default (decision 33): the evaluate render is capped to two seconds of
 * audio regardless of song length, so it finishes in well under a second for
 * normal songs (measured with the starter fixture, worker startup included:
 * about 0.2-0.5s per call, and still under 0.5s at eight times its note
 * density), and a caller stuck past 15s is far more likely wedged than still
 * working. */
export async function evaluateProject(project: unknown, owner: string) {
  await admitProject(`evaluate:${owner}`, 6);
  const result = await utilityWorker(
    owner,
    { project, evaluate: true },
    owner.startsWith("anonymous:") ? 15000 : 30000,
  );
  return {
    version: 1,
    engine: rendererIdentity(),
    ...(result.report as Record<string, unknown>),
  };
}
