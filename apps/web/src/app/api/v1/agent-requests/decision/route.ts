import { projectRoute, readProjectBody, objectBody } from "@/lib/project-http";
import {
  requireOwnerSession,
  inspectAgentRequest,
  decideAgentRequest,
} from "@/lib/agents";
import { ProjectHttpError } from "@/lib/projects";
export const GET = projectRoute(async (request, caller) => {
  requireOwnerSession(caller);
  return inspectAgentRequest(
    new URL(request.url).searchParams.get("code") ?? "",
  );
}, true);
export const POST = projectRoute(async (request, caller) => {
  requireOwnerSession(caller);
  const b = objectBody(await readProjectBody(request, 2048), [
    "code",
    "profileId",
    "days",
    "approve",
  ]);
  if (
    typeof b.code !== "string" ||
    typeof b.profileId !== "string" ||
    typeof b.days !== "number" ||
    typeof b.approve !== "boolean"
  )
    throw new ProjectHttpError(
      422,
      "invalid_request",
      "Supply code, artist, expiry and explicit decision",
    );
  return decideAgentRequest(
    caller.userId!,
    b.code,
    b.profileId,
    b.days,
    b.approve,
  );
}, true);
