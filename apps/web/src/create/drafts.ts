import { parseProject, type MusicProject } from "chipvoice";
export const DRAFT_ROOT = "chipvoice.project.v1";
export function newDraftKey() {
  return `${DRAFT_ROOT}:draft:${crypto.randomUUID()}`;
}
export function isDraftKey(key: string) {
  return (
    key === DRAFT_ROOT ||
    /^chipvoice\.project\.v1:(?:[A-Za-z0-9]{8}|draft:[A-Za-z0-9-]{36})$/.test(
      key,
    )
  );
}
export function readDraft(key: string): MusicProject | null {
  if (!isDraftKey(key)) return null;
  const saved = localStorage.getItem(key);
  return saved ? parseProject(saved) : null;
}
export function listDrafts() {
  const entries: { key: string; title: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)!;
    if (!key.startsWith(`${DRAFT_ROOT}:`) || key === `${DRAFT_ROOT}:active`)
      continue;
    try {
      const project = readDraft(key);
      if (project) entries.push({ key, title: project.title });
    } catch {
      /* Keep corrupt data available for manual recovery. */
    }
  }
  return entries.sort(
    (a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
  );
}
export function openProjectDraft(project: MusicProject) {
  const key = newDraftKey(),
    text = JSON.stringify(project);
  localStorage.setItem(key, text);
  localStorage.setItem(DRAFT_ROOT, text);
  localStorage.setItem(`${DRAFT_ROOT}:active`, key);
  return key;
}
export function draftHref(key: string) {
  const publication = /^chipvoice\.project\.v1:([A-Za-z0-9]{8})$/.exec(key);
  return publication
    ? `/p/${publication[1]}`
    : `/create?draft=${encodeURIComponent(key)}`;
}
