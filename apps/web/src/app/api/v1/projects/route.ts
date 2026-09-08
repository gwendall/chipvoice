import { projectViewer } from "@/lib/auth";
import { projectRoute, readProjectBody, objectBody } from "@/lib/project-http";
import {
  listProjects,
  publishProject,
  ProjectHttpError,
  type Visibility,
} from "@/lib/projects";
export const runtime = "nodejs";
export const GET = projectRoute(async (request, caller) => {
  const q = new URL(request.url).searchParams;
  return listProjects(
    {
      group: q.get("group") === "1",
      q: q.get("q") ?? undefined,
      chip: q.get("chip") ?? undefined,
      tag: q.get("tag") ?? undefined,
      handle: q.get("handle") ?? undefined,
      mine: q.get("mine") === "1",
      favourites: q.get("favourites") === "1",
      sort: q.get("sort") ?? undefined,
      cursor: q.get("cursor") ?? undefined,
    },
    projectViewer(caller),
  );
});
export const POST = projectRoute(async (request, caller) => {
  const body = objectBody(await readProjectBody(request), [
    "project",
    "visibility",
    "parentId",
    "profileId",
  ]);
  if (body.parentId !== undefined && typeof body.parentId !== "string")
    throw new ProjectHttpError(
      422,
      "invalid_parent",
      "Parent must be a publication ID",
    );
  if (body.profileId !== undefined && typeof body.profileId !== "string")
    throw new ProjectHttpError(
      422,
      "invalid_profile",
      "Profile ID must be text",
    );
  if (
    caller.agent &&
    body.profileId &&
    body.profileId !== caller.agent.profileId
  )
    throw new ProjectHttpError(
      403,
      "artist_scope",
      "This agent can publish only for its authorized artist",
    );
  const result = await publishProject(caller.userId!, {
    project: body.project,
    profileId:
      caller.agent?.profileId ?? (body.profileId as string | undefined),
    viewer: projectViewer(caller),
    visibility: (body.visibility ?? "public") as Visibility,
    parentId: body.parentId as string | undefined,
    requestKey: request.headers.get("idempotency-key") ?? "",
  });
  return Response.json(result, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}, true);
