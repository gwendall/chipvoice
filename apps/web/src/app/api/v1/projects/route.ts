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
      q: q.get("q") ?? undefined,
      chip: q.get("chip") ?? undefined,
      tag: q.get("tag") ?? undefined,
      handle: q.get("handle") ?? undefined,
      mine: q.get("mine") === "1",
      favourites: q.get("favourites") === "1",
      sort: q.get("sort") ?? undefined,
      cursor: q.get("cursor") ?? undefined,
    },
    caller.userId,
  );
});
export const POST = projectRoute(async (request, caller) => {
  const body = objectBody(await readProjectBody(request), [
    "project",
    "visibility",
    "parentId",
  ]);
  if (body.parentId !== undefined && typeof body.parentId !== "string")
    throw new ProjectHttpError(
      422,
      "invalid_parent",
      "Parent must be a publication ID",
    );
  const result = await publishProject(caller.userId!, {
    project: body.project,
    visibility: (body.visibility ?? "public") as Visibility,
    parentId: body.parentId as string | undefined,
    requestKey: request.headers.get("idempotency-key") ?? "",
  });
  return Response.json(result, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}, true);
