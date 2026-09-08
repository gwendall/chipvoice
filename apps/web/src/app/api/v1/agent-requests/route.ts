import { projectRoute, readProjectBody, objectBody } from "@/lib/project-http";
import { requestAgentAccess } from "@/lib/agents";
import { clientKey } from "@/lib/limit";
export const POST = projectRoute(async (request) => {
  const body = objectBody(await readProjectBody(request, 2048), [
    "label",
    "scopes",
  ]);
  return requestAgentAccess(body.label, body.scopes, clientKey(request));
});
