import { projectRoute, readProjectBody, objectBody } from "@/lib/project-http";
import { pollAgentAccess } from "@/lib/agents";
import { ProjectHttpError } from "@/lib/projects";
export const POST = projectRoute(async (request) => {
  const body = objectBody(await readProjectBody(request, 2048), [
    "requestToken",
  ]);
  if (typeof body.requestToken !== "string" || body.requestToken.length > 200)
    throw new ProjectHttpError(
      422,
      "invalid_token",
      "Supply the private request token",
    );
  return pollAgentAccess(body.requestToken);
});
